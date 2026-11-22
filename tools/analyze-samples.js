// Menjalankan aturan Si Jantan terhadap hasil baca PDF sampel (JSON dari extract-samples.js).
// Pemakaian: node tools/analyze-samples.js <folder JSON> [filter nama]
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => String(url).startsWith('file:')
  ? new Response(await readFile(fileURLToPath(url)))
  : nativeFetch(url, ...rest);
const { inspect, adminRows, codingRows, medicalRows } = await import('../static/rules.js');

const [folder, filter = ''] = process.argv.slice(2);
const names = (await readdir(folder)).filter(name => name.endsWith('.json') && name.toLowerCase().includes(filter.toLowerCase())).sort();
const refs = list => list.map(ref => ref.number).join(',') || '-';
const totals = { count: 0, age: 0, primary: 0, cbgDescription: 0, billingTotal: 0, resume: 0, billing: 0, identity: 0, jkn: 0, admission: 0, consistency: 0, coding: 0, medical: 0 };

for (const name of names) {
  const data = JSON.parse(await readFile(join(folder, name), 'utf8'));
  const episode = { docs: [{ index: 0, name: data.name, pages: data.pages }] };
  const info = inspect(episode);
  const state = {};
  const admin = adminRows(info, state);
  const coding = codingRows(info, state).filter(row => row.automatic);
  const medical = medicalRows(info, state).filter(row => row.automatic);
  const consCount = admin.filter(row => ['patient-mismatch', 'claim-payer', 'gender-mismatch'].includes(row.id)).length
    + coding.filter(row => ['tariff-class-mismatch', 'discharge-death-mismatch', 'los-mismatch'].includes(row.id)).length;

  totals.count++;
  if (info.age !== '') totals.age++;
  if (info.primary) totals.primary++;
  if (info.cbgDescription) totals.cbgDescription++;
  if (info.billingTotal?.amount) totals.billingTotal++;
  if (info.docs.resume.refs.length) totals.resume++;
  if (info.docs.billing.refs.length) totals.billing++;
  if (info.docs.identity.refs.length) totals.identity++;
  if (info.docs.jkn.refs.length) totals.jkn++;
  if (info.docs.admission.refs.length) totals.admission++;
  if (consCount) totals.consistency++;
  if (coding.length) totals.coding++;
  if (medical.length) totals.medical++;

  console.log('\n=== ' + data.name + ' (' + data.pages.length + ' hlm, ' + data.pages.filter(p => p.ocr).length + ' OCR, ' + data.pages.filter(p => !p.read).length + ' kosong)');
  console.log('  pasien:', info.patientName || '?', '| layanan:', info.service || '?', '| dx utama:', info.primary || '?', '| dx sek:', info.secondary.join(' ') || '-', '| prosedur:', info.procedures.join(' ') || '-', '| usia:', info.age === '' ? '?' : info.age);
  console.log('  CBG:', info.claim?.cbg || '?', '-', info.cbgDescription || '?', '| tarif:', info.claim?.tarif ?? '?', '| tagihan RS:', info.billingTotal?.amount ?? '?', '| JKN:', info.statuses.map(s => s.label).join('/') || '-', '| segmen:', info.jknSegment?.label || '-', '| saran:', info.suggestedCategory?.id || '-');
  console.log('  dokumen:', Object.entries(info.docs).map(([id, doc]) => id + '[' + refs(doc.refs) + ']').join(' '));
  console.log('  admin:', admin.map(row => row.id + (row.refs.length ? '✓' : '✗')).join(' '));
  console.log('  coding otomatis:', coding.map(row => row.id).join(' ') || '-');
  console.log('  medis otomatis:', medical.map(row => row.id).join(' ') || '-');
}

console.log('\n=== RINGKASAN (' + totals.count + ' berkas) ===');
console.log(JSON.stringify(totals));
