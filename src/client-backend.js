import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Tesseract from 'tesseract.js';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { claimFromPages, claimMeta } from '../static/claimInfo.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const { createWorker, OEM, PSM } = Tesseract;

const DB_NAME = 'SiJantanVerifikasiDB';
const DB_VERSION = 1;
const uploadLimit = 100 * 1024 * 1024;
const maxPages = 150;
const validRotations = new Set([0, 90, 180, 270]);
const stages = ['admin', 'coding', 'medical'];
const outcomes = ['layak', 'pending', 'dispute', 'tidak-layak'];
const idPattern = /^[a-f0-9]{32}$/;

class ClientHttpError extends Error {
  constructor(status, message = 'Permintaan tidak valid.') {
    super(message);
    this.status = status;
  }
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message) => { throw new ClientHttpError(400, message); };

function validDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d\d-\d\d$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(data, key, limit) {
  const value = Object.hasOwn(data, key) ? data[key] : '';
  if (typeof value !== 'string' || value.length > limit) invalid('Data episode atau keputusan tidak valid.');
  return value.trim();
}

function summary(row) {
  const state = typeof row.state === 'string' ? JSON.parse(row.state) : (row.state || {});
  return {
    id: row.id,
    title: row.title,
    revision: row.revision,
    scope: state.scope || 'episode',
    approved: state.approved || [],
    decision: state.decision ?? null,
    meta: state.meta || {},
  };
}

function validateReview(body, previousState) {
  if (!isRecord(body) || !isRecord(body.state) || !Number.isSafeInteger(body.revision) || JSON.stringify(body.state).length > 200_000) invalid();
  const { state } = body;
  const approved = state.approved ?? [];
  const allowed = previousState.scope === 'package' ? stages.slice(0, 1) : stages;
  const prior = previousState.approved || [];
  if (!Array.isArray(approved) || approved.length > allowed.length || approved.some((value, index) => value !== allowed[index])
      || state.scope !== previousState.scope) invalid();
  const meta = state.meta === undefined ? {} : state.meta;
  const decision = state.decision;
  if (!isRecord(meta) || (decision != null && !isRecord(decision))) invalid();
  for (const [key, limit] of Object.entries({ facility: 180, claimNumber: 100, serviceDate: 10 })) {
    if (cleanText(meta, key, limit) !== (meta[key] ?? '')) invalid();
  }
  if (meta.serviceDate && !validDate(meta.serviceDate)) invalid();
  if (meta.amount != null && (!Number.isSafeInteger(meta.amount) || meta.amount < 0 || meta.amount > 1_000_000_000_000)) invalid();
  if (decision == null) return;
  const status = decision.status;
  if (state.scope === 'package' || !outcomes.includes(status) || !cleanText(decision, 'reviewer', 120) || !validDate(decision.date)) invalid();
  if (!meta.facility || !meta.claimNumber || !meta.serviceDate) invalid('Isi nomor klaim, rumah sakit, dan tanggal pelayanan.');
  const reason = cleanText(decision, 'reason', 2000);
  if (status !== 'layak' && !reason) invalid('Isi dasar keputusan atau catatan tindak lanjut.');
  if (status === 'layak' && approved.length !== stages.length) invalid('Layak Klaim memerlukan penyelesaian semua tahap verifikasi.');
  if (status === 'tidak-layak' && !approved.length) invalid('Selesaikan satu tahap verifikasi sebelum menetapkan Tidak Layak.');
  if (approved.length < prior.length) invalid('Buka ulang tahap terlebih dahulu sebelum menetapkan keputusan baru.');
}

function validateMarkedPages(state, docs) {
  const stageValues = Object.values(state.reviews || {});
  const marks = stageValues.flatMap(items => Object.values(items || {}))
    .filter(result => result?.evidence !== undefined).map(result => result.evidence);
  if (!marks.length) return;
  const pages = new Map(docs.map(doc => [doc.index, new Set(doc.pages.map(page => page.number))]));
  for (const evidence of marks) {
    if (!Array.isArray(evidence) || evidence.some(ref => !isRecord(ref) || !pages.get(ref.file)?.has(ref.number))) {
      invalid('Halaman bukti tidak ditemukan pada berkas episode ini.');
    }
  }
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('episodes')) {
        db.createObjectStore('episodes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('minutes')) {
        db.createObjectStore('minutes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('episode_trash')) {
        db.createObjectStore('episode_trash', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('attachment_trash')) {
        db.createObjectStore('attachment_trash', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// PDF & OCR helpers in browser
async function openPdfDoc(bytes) {
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const task = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: `${base}/pdfjs/standard_fonts/`,
    cMapUrl: `${base}/pdfjs/cmaps/`,
    cMapPacked: true,
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

async function renderPageToBlob(page, requestedScale, pixelLimit = 2300, format = 'png', rotation = 0) {
  const extra = validRotations.has(rotation) ? rotation : 0;
  const totalRotation = ((page.rotate || 0) + extra) % 360;
  const original = page.getViewport({ scale: 1, rotation: totalRotation });
  const scale = Math.min(requestedScale, pixelLimit / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale, rotation: totalRotation });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const mime = format === 'webp' ? 'image/webp' : 'image/png';
    const quality = format === 'webp' ? 0.86 : undefined;
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Gagal merender kanvas PDF.'))), mime, quality);
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
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
    if (!last || line.y - last[0].y > Math.min(line.height, last[0].height) * 0.55) rows.push([line]);
    else last.push(line);
  }
  return rows.map(row => row.sort((a, b) => a.x - b.x).map(line => line.text).join(' ')).join('\n');
}

const wordPattern = /\b(?=[A-Za-z]{4,}\b)(?!([A-Za-z])\1{2,})[A-Za-z]*[AEIOUaeiou][A-Za-z]*\b/g;
const anchorPattern = /kartu\s+keluarga|kepala\s+keluarga|\bnik\b|virtual\s*claim|vclaim|sipp|peserta|eligibilitas|pasien|resume|ringkasan|diagnos|kwitansi|kuitansi|rumah\s+sakit|pemerintah|provinsi|laboratorium|radiologi|triase|triage|rujukan|rekomendasi|rawat\s+inap/gi;

function ocrQuality(text, confidence = 0) {
  const source = String(text || '');
  const validWords = (source.match(wordPattern) || []).length;
  const anchors = (source.match(anchorPattern) || []).length;
  const score = (Number(confidence) || 0) * Math.min(1.5, validWords / 20) + anchors * 35;
  return { validWords, anchors, score };
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

function createBrowserOcr(maxWorkers) {
  const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  const concurrency = Math.max(1, maxWorkers || Math.min(2, Math.max(1, hw - 1)));
  const languages = ['ind', 'eng'];
  let closed = false;
  const idle = [];
  const active = new Set();
  const waiters = [];
  let creating = 0;

  const spawn = async () => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const worker = await createWorker(languages, OEM.LSTM_ONLY, {
      workerPath: tesseractWorkerUrl,
      corePath: `${base}/tesseract`,
      langPath: `${base}/ocr-data`,
      gzip: false,
      cacheMethod: 'none',
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
        }, 60000);
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

async function inspectBrowserPdf(doc, ocr) {
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
      try {
        return await renderPageToBlob(page, scale, pixelLimit, 'png', rotation);
      } finally {
        page.cleanup();
      }
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

// State for import lock & preview cache
let importing = false;
const previewCache = new Map();

function clearPreviewCacheForPrefix(prefix) {
  for (const [key, blobUrl] of [...previewCache.entries()]) {
    if (key.startsWith(prefix)) {
      URL.revokeObjectURL(blobUrl);
      previewCache.delete(key);
    }
  }
}

export async function renderClientPagePreview(episodeId, docIndex, pageNumber, fit = false, rot = 0) {
  const index = Number(docIndex);
  const page = Number(pageNumber);
  const rotation = [0, 90, 180, 270].includes(Number(rot)) ? Number(rot) : 0;
  if (index >= 12 || page < 1 || page > maxPages) throw new ClientHttpError(404, 'Halaman tidak ditemukan.');

  const key = `${episodeId}|${index}|${page}|${fit ? 1 : 0}|${rotation}`;
  if (previewCache.has(key)) return previewCache.get(key);

  const pdfRecord = await idbGet('pdfs', `${episodeId}:${index}`);
  if (!pdfRecord?.bytes) throw new ClientHttpError(404, 'PDF sumber tidak ditemukan.');

  const doc = await openPdfDoc(pdfRecord.bytes);
  try {
    if (page > doc.numPages) throw new ClientHttpError(404, 'Halaman tidak ditemukan.');
    const pdfPage = await doc.getPage(page);
    try {
      const blob = fit
        ? await renderPageToBlob(pdfPage, 1.2, 1150, 'webp', rotation)
        : await renderPageToBlob(pdfPage, 1.6, 2300, 'png', rotation);
      const url = URL.createObjectURL(blob);
      previewCache.set(key, url);
      while (previewCache.size > 60) {
        const [oldestKey, oldestUrl] = previewCache.entries().next().value;
        URL.revokeObjectURL(oldestUrl);
        previewCache.delete(oldestKey);
      }
      return url;
    } finally {
      pdfPage.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

async function listActiveEpisodes() {
  const [allEpisodes, trashedEps] = await Promise.all([
    idbGetAll('episodes'),
    idbGetAll('episode_trash'),
  ]);
  const trashedIds = new Set(trashedEps.map(item => item.id));
  return allEpisodes
    .filter(ep => !trashedIds.has(ep.id))
    .sort((a, b) => (b.order || 0) - (a.order || 0));
}

async function getActiveEpisode(id) {
  if (!idPattern.test(id)) throw new ClientHttpError(404, 'Episode tidak ditemukan.');
  const [ep, trashed] = await Promise.all([
    idbGet('episodes', id),
    idbGet('episode_trash', id),
  ]);
  if (!ep || trashed) throw new ClientHttpError(404, 'Episode tidak ditemukan.');
  return ep;
}

async function getActiveDocs(ep) {
  const allAttTrash = await idbGetAll('attachment_trash');
  const hidden = new Set(allAttTrash.filter(item => item.id === ep.id).map(item => item.document));
  const docs = typeof ep.payload === 'string' ? JSON.parse(ep.payload) : ep.payload;
  return docs.filter(doc => !hidden.has(doc.index));
}

async function resetEpisodeReview(ep) {
  const previous = typeof ep.state === 'string' ? JSON.parse(ep.state) : { ...ep.state };
  const state = { ...previous, approved: [], decision: null, reviews: {} };
  for (const field of ['primary', 'secondary', 'procedures', 'service', 'age']) delete state[field];
  ep.state = state;
  ep.revision = (ep.revision || 0) + 1;
  await idbPut('episodes', ep);
}

async function handleUpload(formData) {
  if (importing) throw new ClientHttpError(409, 'Satu impor sedang berjalan. Coba lagi setelah selesai.');
  importing = true;
  const docs = [];
  const ocr = createBrowserOcr();
  try {
    if (!(formData instanceof FormData)) throw new ClientHttpError(400, 'Gunakan formulir impor PDF.');
    const files = formData.getAll('pdf');
    if (!files.length || files.length > 12 || files.some(file => typeof file === 'string')) {
      throw new ClientHttpError(400, 'Pilih 1 sampai 12 PDF untuk satu episode atau paket pengajuan.');
    }
    let totalBytes = 0;
    let totalPages = 0;
    for (const file of files) {
      totalBytes += file.size || 0;
      if (totalBytes > uploadLimit) throw new ClientHttpError(413, 'Ukuran permintaan melebihi batas.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const header = new TextDecoder().decode(bytes.subarray(0, 5));
      if (header !== '%PDF-') throw new ClientHttpError(400, 'Salah satu berkas bukan PDF yang dapat dibaca.');
      const doc = await openPdfDoc(bytes).catch(() => null);
      if (!doc) throw new ClientHttpError(400, 'Salah satu PDF rusak atau terkunci.');
      const rawName = (file.name || 'Berkas.pdf').replaceAll('\\', '/').split('/').pop();
      docs.push({ doc, bytes, name: rawName });
      totalPages += doc.numPages;
      if (!doc.numPages || totalPages > maxPages) throw new ClientHttpError(400, 'Maksimal 150 halaman per episode.');
    }

    const prepared = [];
    for (const [index, item] of docs.entries()) {
      prepared.push({ index, name: item.name, ...await inspectBrowserPdf(item.doc, ocr) });
    }
    const id = makeId();
    const titleInput = formData.get('title');
    const title = ((typeof titleInput === 'string' && titleInput.trim()) || docs[0].name.replace(/\.pdf$/i, '')).slice(0, 160);
    const isPackage = formData.get('scope') === 'package';
    const meta = isPackage ? {} : claimMeta(claimFromPages(prepared.flatMap(doc => doc.pages.map(page => ({ ...page, file: doc.index })))));
    const state = { ...(isPackage ? { scope: 'package' } : {}), ...(Object.keys(meta).length ? { meta } : {}) };

    for (const [index, item] of docs.entries()) {
      await idbPut('pdfs', { key: `${id}:${index}`, id, document: index, bytes: item.bytes });
    }
    await idbPut('episodes', {
      id,
      title,
      payload: prepared,
      state,
      revision: 0,
      order: Date.now() + Math.random(),
    });
    return { id };
  } finally {
    try {
      await Promise.allSettled([ocr.close(), ...docs.map(item => item.doc.destroy())]);
    } finally {
      importing = false;
    }
  }
}

export async function clientApi(rawPath, config = {}) {
  const url = new URL(rawPath, 'http://localhost');
  const path = url.pathname;
  const method = (config.method || 'GET').toUpperCase();
  const parseBody = () => (typeof config.body === 'string' ? JSON.parse(config.body) : config.body);

  // GET /episodes
  if (path === '/episodes' && method === 'GET') {
    const active = await listActiveEpisodes();
    return active.map(summary);
  }

  // POST /episodes
  if (path === '/episodes' && method === 'POST') {
    return await handleUpload(config.body);
  }

  // DELETE /episodes
  if (path === '/episodes' && method === 'DELETE') {
    if (importing) throw new ClientHttpError(409, 'Tunggu impor PDF selesai sebelum menghapus berkas.');
    const active = await listActiveEpisodes();
    const permanent = url.searchParams.get('permanent') === '1';
    if (permanent) {
      const allPdfs = await idbGetAll('pdfs');
      const allAttTrash = await idbGetAll('attachment_trash');
      for (const ep of active) {
        await idbDelete('episodes', ep.id);
        await idbDelete('episode_trash', ep.id);
        for (const att of allAttTrash.filter(a => a.id === ep.id)) {
          await idbDelete('attachment_trash', att.key);
        }
        for (const pdf of allPdfs.filter(p => p.id === ep.id)) {
          await idbDelete('pdfs', pdf.key);
        }
        clearPreviewCacheForPrefix(`${ep.id}|`);
      }
      return { count: active.length };
    }
    const now = new Date().toISOString();
    for (const ep of active) {
      await idbPut('episode_trash', { id: ep.id, removed_at: now });
      ep.revision = (ep.revision || 0) + 1;
      await idbPut('episodes', ep);
    }
    return { count: active.length };
  }

  // GET /trash
  if (path === '/trash' && method === 'GET') {
    const [allEpisodes, epTrash, attTrash] = await Promise.all([
      idbGetAll('episodes'),
      idbGetAll('episode_trash'),
      idbGetAll('attachment_trash'),
    ]);
    const epMap = new Map(allEpisodes.map(e => [e.id, e]));
    const trashedEpIds = new Set(epTrash.map(t => t.id));

    const epItems = epTrash
      .filter(t => epMap.has(t.id))
      .sort((a, b) => String(b.removed_at).localeCompare(String(a.removed_at)))
      .map(t => ({ id: t.id, title: epMap.get(t.id).title, removed_at: t.removed_at }));

    const attItems = attTrash
      .filter(t => epMap.has(t.id) && !trashedEpIds.has(t.id))
      .sort((a, b) => String(b.removed_at).localeCompare(String(a.removed_at)))
      .map(t => {
        const ep = epMap.get(t.id);
        const docs = typeof ep.payload === 'string' ? JSON.parse(ep.payload) : ep.payload;
        return {
          id: t.id,
          title: ep.title,
          document: t.document,
          removed_at: t.removed_at,
          name: docs.find(doc => doc.index === t.document)?.name,
        };
      });

    return [...epItems, ...attItems];
  }

  // DELETE /trash
  if (path === '/trash' && method === 'DELETE') {
    if (importing) throw new ClientHttpError(409, 'Tunggu impor PDF selesai sebelum menghapus berkas.');
    const [epTrash, attTrash, allPdfs] = await Promise.all([
      idbGetAll('episode_trash'),
      idbGetAll('attachment_trash'),
      idbGetAll('pdfs'),
    ]);
    const removedDirs = new Set(epTrash.map(t => t.id));
    for (const id of removedDirs) {
      await idbDelete('episode_trash', id);
      await idbDelete('episodes', id);
      for (const pdf of allPdfs.filter(p => p.id === id)) {
        await idbDelete('pdfs', pdf.key);
      }
      clearPreviewCacheForPrefix(`${id}|`);
    }
    const grouped = new Map();
    for (const row of attTrash) {
      await idbDelete('attachment_trash', row.key);
      if (removedDirs.has(row.id)) continue;
      if (!grouped.has(row.id)) grouped.set(row.id, new Set());
      grouped.get(row.id).add(row.document);
    }
    let removedFilesCount = 0;
    for (const [epId, docSet] of grouped) {
      const ep = await idbGet('episodes', epId);
      if (!ep) continue;
      const docs = typeof ep.payload === 'string' ? JSON.parse(ep.payload) : ep.payload;
      const remaining = docs.filter(doc => !docSet.has(doc.index));
      if (!remaining.length) {
        await idbDelete('episode_trash', epId);
        await idbDelete('episodes', epId);
        for (const pdf of allPdfs.filter(p => p.id === epId)) {
          await idbDelete('pdfs', pdf.key);
        }
        clearPreviewCacheForPrefix(`${epId}|`);
        removedDirs.add(epId);
      } else {
        ep.payload = remaining;
        await idbPut('episodes', ep);
        for (const docIdx of docSet) {
          await idbDelete('pdfs', `${epId}:${docIdx}`);
          clearPreviewCacheForPrefix(`${epId}|${docIdx}|`);
          removedFilesCount++;
        }
      }
    }
    return { count: removedDirs.size + removedFilesCount };
  }

  // POST /trash/:id/restore or /trash/:id/documents/:doc/restore
  const restore = path.match(/^\/trash\/([a-f0-9]{32})(?:\/documents\/(\d+))?\/restore$/);
  if (restore && method === 'POST') {
    const [, id, docStr] = restore;
    if (docStr === undefined) {
      const existing = await idbGet('episode_trash', id);
      if (!existing) throw new ClientHttpError(404, 'Berkas tidak ditemukan di Sampah.');
      await idbDelete('episode_trash', id);
      const ep = await idbGet('episodes', id);
      if (ep) {
        ep.revision = (ep.revision || 0) + 1;
        await idbPut('episodes', ep);
      }
      return { id };
    }
    const index = Number(docStr);
    const ep = await getActiveEpisode(id);
    const key = `${id}:${index}`;
    const existing = await idbGet('attachment_trash', key);
    if (!existing) throw new ClientHttpError(404, 'Lampiran tidak ditemukan di Sampah.');
    await idbDelete('attachment_trash', key);
    await resetEpisodeReview(ep);
    return { id };
  }

  // DELETE /trash/:id/documents/:doc
  const purgeDoc = path.match(/^\/trash\/([a-f0-9]{32})\/documents\/(\d+)$/);
  if (purgeDoc && method === 'DELETE') {
    if (importing) throw new ClientHttpError(409, 'Tunggu impor PDF selesai sebelum menghapus berkas.');
    const [, id, docStr] = purgeDoc;
    const index = Number(docStr);
    const key = `${id}:${index}`;
    const existing = await idbGet('attachment_trash', key);
    if (!existing) throw new ClientHttpError(404, 'Lampiran tidak ditemukan di Sampah.');
    await idbDelete('attachment_trash', key);
    await idbDelete('pdfs', key);
    clearPreviewCacheForPrefix(`${id}|${index}|`);

    const ep = await idbGet('episodes', id);
    if (ep) {
      const docs = typeof ep.payload === 'string' ? JSON.parse(ep.payload) : ep.payload;
      const remaining = docs.filter(doc => doc.index !== index);
      if (!remaining.length) {
        await idbDelete('episode_trash', id);
        await idbDelete('episodes', id);
        clearPreviewCacheForPrefix(`${id}|`);
      } else {
        ep.payload = remaining;
        await idbPut('episodes', ep);
      }
    }
    return { count: 1 };
  }

  // DELETE /trash/:id
  const purgeTrashEp = path.match(/^\/trash\/([a-f0-9]{32})$/);
  if (purgeTrashEp && method === 'DELETE') {
    if (importing) throw new ClientHttpError(409, 'Tunggu impor PDF selesai sebelum menghapus berkas.');
    const id = purgeTrashEp[1];
    const existing = await idbGet('episode_trash', id);
    if (!existing) throw new ClientHttpError(404, 'Berkas tidak ditemukan di Sampah.');
    await idbDelete('episode_trash', id);
    await idbDelete('episodes', id);
    const [allPdfs, allAtt] = await Promise.all([idbGetAll('pdfs'), idbGetAll('attachment_trash')]);
    for (const att of allAtt.filter(a => a.id === id)) await idbDelete('attachment_trash', att.key);
    for (const pdf of allPdfs.filter(p => p.id === id)) await idbDelete('pdfs', pdf.key);
    clearPreviewCacheForPrefix(`${id}|`);
    return { count: 1 };
  }

  // DELETE /episodes/:id/documents/:doc
  const attachment = path.match(/^\/episodes\/([a-f0-9]{32})\/documents\/(\d+)$/);
  if (attachment && method === 'DELETE') {
    const [, id, docStr] = attachment;
    const index = Number(docStr);
    const ep = await getActiveEpisode(id);
    const docs = await getActiveDocs(ep);
    if (!docs.some(doc => doc.index === index)) throw new ClientHttpError(404, 'Lampiran tidak ditemukan.');
    if (docs.length === 1) {
      await idbPut('episode_trash', { id, removed_at: new Date().toISOString() });
      ep.revision = (ep.revision || 0) + 1;
      await idbPut('episodes', ep);
      return { episodeRemoved: true };
    }
    await idbPut('attachment_trash', { key: `${id}:${index}`, id, document: index, removed_at: new Date().toISOString() });
    await resetEpisodeReview(ep);
    return { episodeRemoved: false };
  }

  // GET /minutes
  if (path === '/minutes' && method === 'GET') {
    const list = await idbGetAll('minutes');
    return list
      .sort((a, b) => (b.order || 0) - (a.order || 0))
      .map(row => ({ id: row.id, number: row.number, createdAt: row.created_at, date: row.snapshot.date }));
  }

  // POST /minutes
  if (path === '/minutes' && method === 'POST') {
    const body = parseBody();
    if (!isRecord(body)) invalid('Isian berita acara tidak valid.');
    const fields = { number: 100, issuer: 180, location: 120, date: 10, start: 10, end: 10, verifier: 120, representative: 120 };
    const meta = Object.fromEntries(Object.entries(fields).map(([name, limit]) => [name, cleanText(body, name, limit)]));
    const selected = body.episodes;
    if (!Array.isArray(selected) || !selected.length || selected.length > 2000 || selected.some(item =>
      !isRecord(item) || typeof item.id !== 'string' || !idPattern.test(item.id) || !Number.isSafeInteger(item.revision))
      || Object.values(meta).some(value => !value) || !['date', 'start', 'end'].every(key => validDate(meta[key])) || meta.start > meta.end) {
      invalid('Lengkapi identitas, periode, penanda tangan, dan pilih episode yang sudah diputuskan.');
    }
    const revisions = new Map(selected.map(item => [item.id, item.revision]));
    if (revisions.size !== selected.length) invalid('Satu episode hanya dapat dipilih sekali.');

    const activeEps = await listActiveEpisodes();
    const rows = activeEps.filter(row => revisions.has(row.id)).map(summary);
    if (rows.length !== revisions.size || rows.some(item => item.scope !== 'episode' || !item.decision || item.revision !== revisions.get(item.id))) {
      throw new ClientHttpError(409, 'Hasil verifikasi berubah. Muat ulang rekap sebelum menyimpan berita acara.');
    }
    if (rows.some(item => !validDate(item.meta.serviceDate) || item.meta.serviceDate < meta.start || item.meta.serviceDate > meta.end)) {
      invalid('Semua episode yang dipilih harus memiliki tanggal pelayanan dalam periode berita acara.');
    }
    const existingMinutes = await idbGetAll('minutes');
    if (existingMinutes.some(m => m.number === meta.number)) {
      throw new ClientHttpError(409, 'Nomor berita acara sudah pernah digunakan.');
    }
    const report = { ...meta, id: makeId(), rows };
    await idbPut('minutes', {
      id: report.id,
      number: report.number,
      created_at: new Date().toISOString(),
      order: Date.now(),
      snapshot: report,
    });
    return report;
  }

  // GET /minutes/:id
  const minutesMatch = path.match(/^\/minutes\/([a-f0-9]{32})$/);
  if (minutesMatch && method === 'GET') {
    const row = await idbGet('minutes', minutesMatch[1]);
    if (!row) throw new ClientHttpError(404, 'Berita acara tidak ditemukan.');
    return row.snapshot;
  }

  // /episodes/:id or /episodes/:id/review
  const episodeMatch = path.match(/^\/episodes\/([a-f0-9]{32})(?:\/(review))?$/);
  if (episodeMatch) {
    const [, id, action] = episodeMatch;
    if (!action && method === 'GET') {
      const ep = await getActiveEpisode(id);
      const docs = await getActiveDocs(ep);
      const state = typeof ep.state === 'string' ? JSON.parse(ep.state) : ep.state;
      return { id: ep.id, title: ep.title, docs, state, revision: ep.revision };
    }
    if (!action && method === 'DELETE') {
      if (importing) throw new ClientHttpError(409, 'Tunggu impor PDF selesai sebelum menghapus berkas.');
      const ep = await getActiveEpisode(id);
      if (url.searchParams.get('permanent') === '1') {
        await idbDelete('episodes', id);
        await idbDelete('episode_trash', id);
        const [allPdfs, allAtt] = await Promise.all([idbGetAll('pdfs'), idbGetAll('attachment_trash')]);
        for (const att of allAtt.filter(a => a.id === id)) await idbDelete('attachment_trash', att.key);
        for (const pdf of allPdfs.filter(p => p.id === id)) await idbDelete('pdfs', pdf.key);
        clearPreviewCacheForPrefix(`${id}|`);
        return { count: 1 };
      }
      await idbPut('episode_trash', { id, removed_at: new Date().toISOString() });
      ep.revision = (ep.revision || 0) + 1;
      await idbPut('episodes', ep);
      return { count: 1 };
    }
    if (action === 'review' && method === 'PUT') {
      const body = parseBody();
      const ep = await getActiveEpisode(id);
      if (Number.isSafeInteger(body?.revision) && ep.revision !== body.revision) {
        throw new ClientHttpError(409, 'Episode berubah di jendela lain. Muat ulang sebelum menyimpan.');
      }
      const prevState = typeof ep.state === 'string' ? JSON.parse(ep.state) : ep.state;
      const docs = await getActiveDocs(ep);
      validateReview(body, prevState);
      validateMarkedPages(body.state, docs);
      ep.state = body.state;
      ep.revision = (ep.revision || 0) + 1;
      await idbPut('episodes', ep);
      return { revision: ep.revision };
    }
  }

  throw new ClientHttpError(404, 'Halaman tidak ditemukan.');
}
