import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker, OEM, PSM } from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const models = fileURLToPath(new URL('../ocr-data/', import.meta.url));
const validRotations = new Set([0, 90, 180, 270]);

export async function openPdf(bytes) {
  const source = typeof bytes === 'string'
    ? { url: pathToFileURL(bytes).href }
    : { data: Uint8Array.from(bytes) };
  const task = getDocument({
    ...source,
    isEvalSupported: false,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts') + sep,
    cMapUrl: join(pdfRoot, 'cmaps') + sep,
    cMapPacked: true,
  });
  try { return await task.promise; }
  catch (error) { await task.destroy(); throw error; }
}

async function render(page, requestedScale, pixelLimit = 2300, format = 'png', rotation = 0) {
  const extra = validRotations.has(rotation) ? rotation : 0;
  const totalRotation = ((page.rotate || 0) + extra) % 360;
  const original = page.getViewport({ scale: 1, rotation: totalRotation });
  const scale = Math.min(requestedScale, pixelLimit / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale, rotation: totalRotation });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return format === 'webp' ? await canvas.encode('webp', 86) : await canvas.encode('png');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function pagePreview(doc, number, fit = false, rotation = 0) {
  const page = await doc.getPage(number);
  try { return fit ? await render(page, 1.2, 1150, 'webp', rotation) : await render(page, 1.6, 2300, 'png', rotation); }
  finally { page.cleanup(); }
}

function nativeText(items) {
  let text = '';
  let previousY;
  for (const item of items) {
    if (!('str' in item)) continue;
    const y = item.transform[5];
    if (text && !text.endsWith('\n')) text += previousY !== undefined && Math.abs(y - previousY) > 3 ? '\n' : ' ';
    text += item.str + (item.hasEOL ? '\n' : '');
    previousY = y;
  }
  return text.trim();
}

function pageLayout(blocks) {
  const lines = (blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
    .map(line => {
      const box = line.bbox;
      return { text: line.text.trim(), x: box.x0, y: (box.y0 + box.y1) / 2, height: box.y1 - box.y0 };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const line of lines) {
    const last = rows.at(-1);
    if (!last || line.y - last[0].y > Math.min(line.height, last[0].height) * .55) rows.push([line]);
    else last.push(line);
  }
  return rows.map(row => row.sort((a, b) => a.x - b.x).map(line => line.text).join(' ')).join('\n');
}

const wordPattern = /\b(?=[A-Za-z]{4,}\b)(?!([A-Za-z])\1{2,})[A-Za-z]*[AEIOUaeiou][A-Za-z]*\b/g;
const anchorPattern = /kartu\s+keluarga|kepala\s+keluarga|\bnik\b|virtual\s*claim|vclaim|sipp|peserta|eligibilitas|pasien|resume|ringkasan|diagnos|kwitansi|kuitansi|rumah\s+sakit|pemerintah|provinsi|laboratorium|radiologi|triase|triage|rujukan|rekomendasi|rawat\s+inap/gi;

export function ocrQuality(text, confidence = 0) {
  const source = String(text || '');
  const validWords = (source.match(wordPattern) || []).length;
  const anchors = (source.match(anchorPattern) || []).length;
  const score = (Number(confidence) || 0) * Math.min(1.5, validWords / 20) + anchors * 35;
  return { validWords, anchors, score };
}

export function createOcr(maxWorkers) {
  const concurrency = Math.max(1, maxWorkers || Math.min(3, Math.max(1, availableParallelism() - 1)));
  const languages = ['ind', 'eng'];
  let closed = false;
  let modelsReady;
  const ensureModels = () => modelsReady ||= Promise.all(languages.map(language => access(join(models, language + '.traineddata'))));
  const idle = [];
  const active = new Set();
  const waiters = [];
  let creating = 0;

  const spawn = async () => {
    await ensureModels();
    const worker = await createWorker(languages, OEM.LSTM_ONLY, {
      langPath: models, gzip: false, cacheMethod: 'none',
      // Failed recognition already rejects the page job, which inspectPdf handles.
      errorHandler: () => {},
    });
    if (closed) {
      await worker.terminate().catch(() => {});
      throw new Error('OCR tidak tersedia.');
    }
    return worker;
  };

  const nextWaiter = () => {
    while (waiters.length) {
      const waiter = waiters.shift();
      if (closed) {
        waiter.reject(new Error('OCR tidak tersedia.'));
        continue;
      }
      if (idle.length) {
        const worker = idle.pop();
        active.add(worker);
        waiter.resolve(worker);
        return;
      }
      if (active.size + creating < concurrency) {
        creating++;
        spawn().then(worker => {
          creating--;
          active.add(worker);
          waiter.resolve(worker);
        }, error => {
          creating--;
          waiter.reject(error);
          nextWaiter();
        });
        return;
      }
      waiters.unshift(waiter);
      return;
    }
  };

  const acquire = async () => {
    if (closed) throw new Error('OCR tidak tersedia.');
    if (idle.length) {
      const worker = idle.pop();
      active.add(worker);
      return worker;
    }
    if (active.size + creating < concurrency) {
      creating++;
      try {
        const worker = await spawn();
        active.add(worker);
        return worker;
      } finally {
        creating--;
        nextWaiter();
      }
    }
    return await new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };

  const retire = async (worker, broken = false) => {
    active.delete(worker);
    if (!worker) return;
    if (closed || broken) await worker.terminate().catch(() => {});
    else idle.push(worker);
    nextWaiter();
  };

  return {
    concurrency,
    run: async job => {
      const worker = await acquire();
      let timer;
      let settled = false;
      let broken = false;
      const limit = new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          broken = true;
          void retire(worker, true).catch(() => {});
          reject(new Error('Halaman melampaui waktu pemrosesan OCR.'));
        }, 45000);
      });
      try {
        const result = await Promise.race([Promise.resolve().then(() => job(worker)), limit]);
        settled = true;
        return result;
      } catch (error) {
        settled = true;
        throw error;
      } finally {
        clearTimeout(timer);
        if (!broken) await retire(worker, false);
      }
    },
    close: async () => {
      closed = true;
      while (waiters.length) waiters.shift().reject(new Error('OCR tidak tersedia.'));
      const pool = [...idle, ...active];
      idle.length = 0;
      active.clear();
      await Promise.allSettled(pool.map(worker => worker.terminate()));
    },
  };
}

const resumeTitle = /\b(?:resume(?:\s+(?:pasien|medis|medik))?\s+rawat\s+(?:jalan|inap)|ringkasan\s+(?:medis|pulang|perawatan))\b/i;

function shouldRecoverResumeTitle(text) {
  return !resumeTitle.test(text)
    && (/\brawat\b/i.test(text) || /cetakresume/i.test(text))
    && /\b(?:dokter|pemeriksaa?n|diagnos(?:a|is)|terapi|poliklinik|klinik)\b/i.test(text)
    && !/\b(?:kuitansi|kwitansi|status kepesertaan|berkas klaim individual)\b/i.test(text);
}

async function recognizeResumeTitle(worker, image) {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  try {
    const { data } = await worker.recognize(image);
    return data.text.match(resumeTitle)?.[0] || '';
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  }
}

export async function inspectPdf(doc, ocr) {
  const pages = Array.from({ length: doc.numPages }, (_, index) => ({
    number: index + 1, text: '', read: false, ocr: false,
  }));
  const ocrQueue = [];
  let error = '';

  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number).catch(() => null);
    try {
      if (!page) throw new Error('Halaman tidak terbaca.');
      const native = await page.getTextContent().then(value => nativeText(value.items)).catch(() => '');
      Object.assign(pages[number - 1], { text: native, read: Boolean(native) });
      // Sparse text layers on scanned attachments still need OCR.
      if (native.replace(/\s/g, '').length < 450) ocrQueue.push(number);
    } catch {
      error = 'Sebagian halaman belum berhasil dibaca OCR. Periksa gambar PDF untuk konfirmasi.';
    } finally {
      page?.cleanup();
    }
  }

  let renderQueue = Promise.resolve();
  const renderPage = (number, scale = 165 / 72, pixelLimit = 2300, rotation = 0) => {
    const task = renderQueue.then(async () => {
      const page = await doc.getPage(number).catch(() => null);
      if (!page) throw new Error('Halaman tidak terbaca.');
      try { return await render(page, scale, pixelLimit, 'png', rotation); }
      finally { page.cleanup(); }
    });
    renderQueue = task.catch(() => {});
    return task;
  };

  let cursor = 0;
  const workerCount = Math.min(ocr.concurrency || 1, ocrQueue.length);
  const processPage = async number => {
    const result = pages[number - 1];
    const native = result.text;
    const tryRotation = async rot => {
      const image = await renderPage(number, 165 / 72, 2300, rot);
      const { data } = await ocr.run(worker => worker.recognize(image, {}, { text: true, blocks: true }));
      const text = data.text.trim();
      return { rot, data, text, quality: ocrQuality(text, data.confidence) };
    };

    try {
      let best = await tryRotation(0);
      const q0 = best.quality;
      const tokens0 = best.text.split(/\s+/).filter(Boolean).length;
      const ratio0 = tokens0 ? q0.validWords / tokens0 : 0;
      if (best.text && (q0.validWords < 15 || (q0.anchors === 0 && (best.data.confidence || 0) < 55 && (q0.validWords < 40 || ratio0 < 0.25)))) {
        const rot270 = await tryRotation(270);
        let candidate = rot270;
        const strong270 = rot270.quality.score > q0.score * 1.35 && rot270.quality.validWords >= 20
          && (rot270.quality.anchors >= 1 || (rot270.data.confidence || 0) >= 48);
        if (!strong270) {
          const rot90 = await tryRotation(90);
          if (rot90.quality.score > candidate.quality.score) candidate = rot90;
        }
        if (candidate.quality.score > q0.score * 1.25
            && (candidate.quality.anchors > q0.anchors || candidate.quality.validWords >= q0.validWords + 8)) {
          best = candidate;
        }
      }

      if (best.text.length > native.length) {
        Object.assign(result, {
          text: best.text, read: true, ocr: true, layout: pageLayout(best.data.blocks),
          ...(best.rot ? { rotation: best.rot } : {}),
        });
        if (shouldRecoverResumeTitle(best.text)) {
          const hiRes = await renderPage(number, 3, 3000, best.rot).catch(() => null);
          const title = hiRes ? await ocr.run(worker => recognizeResumeTitle(worker, hiRes)).catch(() => '') : '';
          if (title) result.text = title.replace(/\s+/g, ' ') + '\n' + best.text;
        }
      }
    } catch {
      error = 'Sebagian halaman belum berhasil dibaca OCR. Periksa gambar PDF untuk konfirmasi.';
    }
  };

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < ocrQueue.length) {
      const number = ocrQueue[cursor++];
      await processPage(number);
    }
  }));

  return { pages, error };
}
