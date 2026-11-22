// Membaca PDF sampel dengan pipeline yang sama seperti impor, menyimpan hasil ke JSON cache.
// Pemakaian: node tools/extract-samples.js <folder PDF> <folder output> [indeks shard] [jumlah shard]
import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { openPdf, createOcr, inspectPdf } from '../server/pdf.js';

const [input, output, shard = '0', shards = '1'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const files = (await readdir(input)).filter(name => /\.pdf$/i.test(name)).sort()
  .filter((_, index) => index % Number(shards) === Number(shard));
for (const name of files) {
  const target = join(output, basename(name, '.pdf') + '.json');
  if (await access(target).then(() => true, () => false)) continue;
  const started = Date.now();
  const bytes = await readFile(join(input, name));
  const doc = await openPdf(bytes);
  const ocr = createOcr();
  try {
    const result = await inspectPdf(doc, ocr);
    await writeFile(target, JSON.stringify({ name, ...result }));
    const ocrPages = result.pages.filter(page => page.ocr).length;
    console.log(name, doc.numPages + ' hlm', ocrPages + ' OCR', Math.round((Date.now() - started) / 1000) + ' dtk', result.error || '');
  } finally {
    await ocr.close();
    await doc.destroy();
  }
}
