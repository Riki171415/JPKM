import { evaluateAuditCodingRules } from './akurat/utils/auditCodingEngine.js';
import { getTriggeredJknDocumentRules } from './akurat/data/jknDocumentRules.js';
import { evaluateDiagnosisPpk1 } from './akurat/utils/ppkDiagnosisAnalyzer.js';
import { ppkReferralLogicText } from './akurat/utils/ppkReferralLogic.js';
import { evaluatePreClaimMedicalCriteria } from './akurat/utils/evaluatePreClaimMedicalCriteria.js';
import { evaluatePpkPreClaimRules } from './akurat/utils/ppkPreClaimAnalyzer.js';
import { recoverEklaimOcrFields } from './akurat/utils/eklaimOcrRecovery.js';
import { evaluateEsiTriage } from './akurat/utils/esiTriage.js';
import { assessClaimDeathEvidence } from './akurat/utils/claimDeathEvidence.js';
import { evaluateDiabetesCodingAudit } from './akurat/utils/diabetesCodingAudit.js';
import { evaluateProcedureDocumentation } from './akurat/utils/procedureDocumentationAudit.js';
import { buildProcedureReferenceLookup, findIndexedProcedureReferences } from './akurat/utils/procedureReferenceIndex.js';
import { getAuditRuleReferences, getMedicalRuleReferences } from './akurat/utils/ruleReferences.js';
import auditCatalog from './akurat/data/defaultAuditRules.js';
import { claimFromPages, findBillingTotal, findPatientName, auditConsistency } from './claimInfo.js';

const procedureReferenceLookup = buildProcedureReferenceLookup([]);
export const procedureReferencesFor = proclist =>
  findIndexedProcedureReferences(proclist, procedureReferenceLookup).filter(item => item.matches.length > 0);

export const stages = [['admin', 'Administrasi'], ['coding', 'Audit Coding'], ['medical', 'Verifikasi Medis']];
export const categories = {
  pbi: 'Masa tunggu PBI APBD/APBN', pgot: 'PGOT tanpa NIK', odgj: 'ODGJ tanpa NIK',
  inactive: 'Peserta JKN nonmandiri nonaktif', disaster: 'Bencana di luar masa tanggap darurat',
  outbreak: 'Kejadian Luar Biasa', kipi: 'Kejadian Ikutan Pasca Imunisasi',
  violence: 'Penganiayaan atau kekerasan seksual', napza: 'NAPZA',
};
export const decisions = ['Sesuai', 'Perlu klarifikasi', 'Tidak sesuai', 'Tidak berlaku'];
const checklistPattern = /template\s+dokumen\s+ajuan|no\s+persyaratan\s+kriteria\s+sesuai\s+tidak\s+sesuai/i;
const docRules = {
  grouping: ['Berkas Klaim Individual INA-CBG', /kla[i1l]m\s+individua[l1i]|hasil\s+grouping[\s\S]{0,60}ina.?cbg/i],
  resume: ['Resume medis', /\bresume\b(?![\s:.-]*tagihan)|ringkasan\s+(?:pasien\s+)?(?:medis|pulang|keluar|perawatan)|discharge\s+summary|cetakresumenoreg/i],
  billing: ['Rincian biaya', /rincian\s+(?:biaya|tagihan|pelayanan)|daftar\s+rincian\s+biaya|\bbilling\b|#inv\b|uraian\s+harga\s+satuan|total\s+pembayaran[\s\S]{0,60}sub\s+total|total\s+seluruh\s+[\d.,]+|\bk[wu][i1l]tans[i1l]\b[\s\S]{0,2200}(?:\bqty\b|total\s+bayar|rincian|tarif\s+rp|subtotal)/i],
  receipt: ['Kuitansi', /\bk[wu][i1l]tans[i1l]\b/i],
  identity: ['Dokumen identitas', /k[a4]rtu\s+(?:kelu[a4o]r?g|tanda\s+penduduk|identitas\s+anak)|kelu[a4o]rg[a4][\s\S]{0,180}[hn]ama\s+kepala\s+keluarga|[hn]ama\s+kepala\s+keluarga[\s\S]{0,180}(?:desa|kelurahan)|provinsi[\s\S]{0,110}(?:kabupaten|kota)[\s\S]{0,120}\bnik\b|berlaku\s+hingga[\s\S]{0,30}seumur\s+hidup|\bnik\b[\s\S]{0,160}(?:tempat|tgl|tanggal)\s*lahir[\s\S]{0,160}(?:jenis\s+kelamin|agama|kewarganegaraan)|tempat[\s/]+(?:tgl|tg|tanggal|igi)[\s.]*lahi?r[\s\S]{0,180}kelamin[\s\S]{0,180}kewarganegaraan|data\s+personal[\s\S]{0,300}nomor\s+kartu\s+keluarga|nomor\s+induk\s+kependudukan|(?:surat|resi)\s+(?:keterangan\s+)?(?:pembuatan\s+)?(?:ktp|kk)|surat\s+keterangan\s+lahir|kutipan\s+akta\s+kelahiran/i],
  jkn: ['Hasil pengecekan JKN', /status[\s\S]{0,40}kepesertaan|sipp\.bpjs-kesehatan|vclaim\.bpjs-kesehatan|virtual\s*claim|pembuatan\s+sep\s+rawat|pencarian\s+(?:detail\s+)?peserta[\s\S]{0,220}(?:nokapst|detail\s+peserta|bpjs)|(?:data|peserta)(?:\s+peserta)?\s+tidak\s+ditemukan[\s\S]{0,260}(?:peserta|sep|rujukan|bpjs)|penangguhan\s+(?:pembayaran|aktivasi)|pengecekan\s+kepesertaan/i],
  social: ['Surat rekomendasi / keterangan sosial', /surat\s+(?:keterangan|rekomendasi).*(?:sosial|pbi|tidak\s+mampu)|dinas\s+sosial|puskesos|pusat\s+keseja(?:h)?teraan\s+sosial|kesejahteraan\s+sosial|lapad\s+ruhama|pengusulan\s+pbpu\s+pemda|linjamsos/i],
  referral: ['Surat rujukan / kontrol', /surat\s+(?:rujukan|kontro[l1i])|^\s*rujukan\s+(?:umum|pasien)/im],
  admission: ['Perintah / pengantar rawat inap', /(?:perintah|instruksi|pengantar|permintaan)\s+rawat|surat\s+keterangan\s+rencana\s+inap|\bspri\b|perlu\s+dirawat/i],
  jpkm: ['Surat Peserta JPKM', /surat[\s\S]{0,55}peserta[\s\S]{0,200}jpkm|no\s+jpkm[\s\S]{0,200}surat[\s\S]{0,45}peserta/i],
  ed: ['Asesmen atau triase IGD', /triase|tr[i1]age|(?:asesmen|assesmen|pengkajian|pemeriksaan)\s+awal\s+medis|asesmen\s+instalasi\s+gawat\s+darurat|surat\s+keterangan\s+gawat\s+darurat|awal\s+medis[\s\S]{0,320}\bigd\b/i],
  lab: ['Hasil laboratorium', /hasil\s+(?:pemeriksaa+n\s+)?laboratorium|instalasi\s+laboratorium|laboratorium\s+klini[ks]/i],
  radiology: ['Hasil radiologi', /hasil\s+(?:pemeriksaa+n\s+)?radiologi|(?:instalasi|unit)\s+radiologi/i],
  procedure: ['Laporan tindakan / operasi', /laporan\s+(?:operasi|tindakan)|catatan\s+operasi/i],
  therapy: ['Lembar terapi / pemberian obat', /lembar[\s\S]{0,28}terapi|catatan\s+pemberian\s+obat|\bresep\b/i],
  progress: ['Catatan perkembangan', /\bcppt\b|catatan\s+perkembangan/i],
  sptjm: ['SPTJM pimpinan RS', /\bsptjm\b|tanggung\s+jawab\s+mutlak/i],
  submission: ['Surat pengajuan klaim', /surat\s+pengajuan\s+klaim|perihal\s*[:;-]?\s*pengajuan\s+klaim/i],
  recap: ['Rekapitulasi pasien / pengajuan', /rekap(?:itulasi)?\s+(?:pasien|klaim|pengajuan)/i],
};

export function evidence(page, pattern) {
  for (const content of [page.text, page.layout].filter(Boolean)) {
    const match = pattern.exec(content);
    if (match) return { file: page.file, number: page.number, excerpt: content.slice(Math.max(0, match.index - 18), match.index + match[0].length + 62).replace(/\s+/g, ' ') };
  }
  return null;
}

const unique = values => [...new Set(values)];
export const parseDiagnosisCodes = text => [...String(text).toUpperCase().matchAll(/\b[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?\b/g)].map(match => match[0]);
export const parseProcedureCodes = text => [...String(text).matchAll(/(?<![\d.])\d{2}\.\d{1,3}(?![\d.])/g)].map(match => match[0]);
const diagnosisCodes = parseDiagnosisCodes;
const procedureCodes = parseProcedureCodes;

function extractCodeDescriptions(block, codePattern) {
  const source = String(block || '');
  if (!source.trim()) return {};
  const flags = codePattern.flags.includes('g') ? codePattern.flags : codePattern.flags + 'g';
  const matches = [...source.matchAll(new RegExp(codePattern.source, flags))];
  const result = {};
  matches.forEach((match, index) => {
    const code = match[0].toUpperCase();
    const raw = source.slice(match.index + match[0].length, matches[index + 1]?.index ?? source.length);
    const cleaned = raw
      .replace(/^[\s:;\-–—|]+/, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s:;|\-–—]+$/, '')
      .trim();
    if (!cleaned || /^[-–—=~_.]+$/.test(cleaned) || !/[A-Za-z]{3,}/.test(cleaned)) return;
    if (!result[code]) result[code] = cleaned.slice(0, 180);
  });
  return result;
}

export function resolveIcdDescription(code, pdfDescriptions = {}, dictionary = null, { exact = false } = {}) {
  const raw = String(code || '').trim().toUpperCase().replace(/[†*+!?]+$/, '');
  if (!raw || raw === '-') return '';
  const dotted = raw.match(/^([A-Z]\d{2})([A-Z0-9]{1,4})$/)?.[0]
    ? raw.replace(/^([A-Z]\d{2})([A-Z0-9]{1,4})$/, '$1.$2')
    : /^(\d{2})(\d{1,2})$/.test(raw) ? raw.replace(/^(\d{2})(\d{1,2})$/, '$1.$2') : '';
  const noDot = raw.replace(/\./g, '');
  const lookup = source => source?.[raw] || (dotted && source?.[dotted]) || source?.[noDot] || '';
  const exactHit = lookup(pdfDescriptions) || lookup(dictionary);
  if (exactHit || exact) return exactHit;
  const base = raw.includes('.') ? raw.split('.')[0] : dotted ? dotted.split('.')[0] : '';
  return (base && (pdfDescriptions?.[base] || dictionary?.[base])) || '';
}
const docsFor = (pages, pattern) => pages.map(page => evidence(page, pattern)).filter(Boolean);
const refsFor = (...groups) => [...new Map(groups.flat().map(ref => [ref.file + ':' + ref.number, ref])).values()];
const samePage = (a, b) => a.file === b.file && a.number === b.number;
const hasRef = (refs, ref) => refs.some(item => samePage(item, ref));
const triagePattern = /\btr[i1l][a4](?:[s5][e3]|[g9][e3])\b|\b(?:ats|esi)\s*(?:level\s*)?[1-5]\b|australasian\s+triage/i;
const inpatient = service => /rawat\s*inap|ranap|ritl|^RI$/i.test(service);
const emergency = service => /\bIGD\b|gawat\s+darurat/i.test(service);
const references = /\b(?:BA|PNPK|PPK|TKMKB|Fornas|Permenkes|KMK|SOP|ICD-10|ICD-9-CM)\b|berita acara|kesepakatan|formularium nasional/i;
const rp = value => Number.isInteger(value) ? 'Rp ' + value.toLocaleString('id-ID') : '';
const guideline = source => source && references.test(source) && !/akurat|blueprint|pengguna/i.test(source)
  ? 'Acuan terdaftar: ' + source
  : 'Acuan spesifik perlu dikonfirmasi pada BA Kesepakatan, PPK, PNPK, atau ketentuan TKMKB yang berlaku.';
const lineBlock = (text, start, end) => {
  const found = text.match(start);
  if (!found) return '';
  const following = text.slice(found.index + found[0].length);
  const stopAt = following.search(end);
  return (stopAt < 0 ? following : following.slice(0, stopAt)).slice(0, 1600);
};

export function inspect(episode) {
  const pages = episode.docs.flatMap(doc => doc.pages.map(page => ({ ...page, file: doc.index })));
  const nonChecklistPages = pages.filter(page => !checklistPattern.test(page.text || ''));
  const docs = Object.fromEntries(Object.entries(docRules).map(([id, [name, pattern]]) => [id, { name, refs: docsFor(nonChecklistPages, pattern) }]));
  // Pencarian peserta JKN memiliki label "Resume tagihan", "Pilih Rujukan", dan "Total tagihan".
  // Bukti dari halaman tersebut tidak mewakili resume, rujukan, atau billing rumah sakit.
  const isEligibilityPage = ref => hasRef(docs.jkn.refs, ref);
  for (const id of ['resume', 'billing', 'referral', 'ed', 'social']) {
    docs[id].refs = docs[id].refs.filter(ref => !isEligibilityPage(ref));
  }
  const socialLetterPattern = /puskesos|dinas\s+sosial|surat\s+rekomendasi[\s\S]{0,200}linjamsos|surat\s+keterangan\s+tidak\s+mampu/i;
  const ktpKkPattern = /k[a4]rtu\s+kelu|[hn]ama\s+kepala\s+keluarga|berlaku\s+hingga[\s\S]{0,25}seumur\s+hidup/i;
  docs.identity.refs = docs.identity.refs.filter(ref => {
    const page = pages.find(item => samePage(item, ref));
    const text = page?.text || '';
    return !socialLetterPattern.test(text) || ktpKkPattern.test(text);
  });
  docs.ed.refs = docs.ed.refs.filter(ref => !hasRef(docs.billing.refs, ref) && !hasRef(docs.receipt.refs, ref) && !hasRef(docs.grouping.refs, ref));
  docs.social.refs = docs.social.refs.filter(ref => !hasRef(docs.grouping.refs, ref) && !hasRef(docs.billing.refs, ref) && !hasRef(docs.receipt.refs, ref));

  const groupRef = docs.grouping.refs[0];
  const groupPage = groupRef && pages.find(page => samePage(page, groupRef));
  const grouping = groupPage?.layout || groupPage?.text || '';
  const formats = [grouping, groupPage?.text || ''];
  const endPrimary = /diagnos(?:a|is)\s+sekunder|\bprosedur\b|hasil\s+grouping|ina.?cbg/i;
  const endProcedure = /hasil\s+grouping|ina.?cbg|adl\s+sub|tarif|total|versi|dicetak/i;
  const extract = (parser, start, end) => formats.map(text => parser(lineBlock(text, start, end))).find(values => values.length) || [];
  const primary = extract(diagnosisCodes, /diagnos(?:a|is)\s+utama/i, endPrimary)[0] || '';
  const secondary = unique(extract(diagnosisCodes, /diagnos(?:a|is)\s+sekunder/i, /\bprosedur\b|hasil\s+grouping|ina.?cbg/i));
  const procedures = extract(procedureCodes, /\bprosedur\b/i, endProcedure);
  const codeDescriptions = {};
  const mergeDescriptions = (block, pattern) => {
    for (const [code, desc] of Object.entries(extractCodeDescriptions(block, pattern))) {
      if (!codeDescriptions[code]) codeDescriptions[code] = desc;
    }
  };
  for (const text of [groupPage?.text || '', grouping]) {
    if (!text) continue;
    mergeDescriptions(lineBlock(text, /diagnos(?:a|is)\s+utama/i, endPrimary), /\b[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?\b/g);
    mergeDescriptions(lineBlock(text, /diagnos(?:a|is)\s+sekunder/i, /\bprosedur\b|hasil\s+grouping|ina.?cbg/i), /\b[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?\b/g);
    mergeDescriptions(lineBlock(text, /\bprosedur\b/i, endProcedure), /(?<![\d.])\d{2}\.\d{1,3}(?![\d.])/g);
  }
  const claim = claimFromPages(pages);
  const age = claim?.umurTahun != null ? String(claim.umurTahun) : (grouping.match(/(?:umur|usia)\s*(?:tahun)?\s*[:=]?\s*(\d{1,3})\b/i)?.[1] || '');
  const context = grouping + '\n' + (groupPage?.text || '');
  const service = inpatient(context) ? 'Rawat Inap'
    : /(?:jenis|tipe)\s+(?:pelayanan|layanan|rawat)\s*:?\s*(?:IGD|gawat\s+darurat)/i.test(context) ? 'IGD'
    : /rawat\s+jalan/i.test(context) ? 'Rawat Jalan' : '';
  const jknPages = pages.filter(page => isEligibilityPage(page));
  const jknOptions = [
    ['NON AKTIF', /\bnon\s*aktif\b|\btidak\s+aktif\b/i],
    ['PENANGGUHAN PEMBAYARAN', /penangguhan\s+pembayaran/i],
    ['PENANGGUHAN AKTIVASI', /penangguhan\s+aktivasi/i],
    ['TIDAK DITANGGUNG', /\btidak\s+ditanggung\b/i],
    ['PESERTA / DATA TIDAK DITEMUKAN', /\b(?:data|peserta)(?:\s+peserta)?\s+tidak\s+ditemukan\b/i],
    ['BELUM TERDAFTAR', /\b(?:belum|tidak)\s+terdaftar\b|bukan\s+peserta\s+jkn/i],
  ];
  const statuses = jknOptions.flatMap(([label, pattern]) => {
    const refs = docsFor(jknPages, pattern);
    return refs.length ? [{ label, refs }] : [];
  });
  const jknSegmentOptions = [
    ['PBPU DAN BP PEMERINTAH DAERAH', /pbpu\s+dan\s+bp\s+pemerintah\s+daerah/i, false],
    ['PBI JAMINAN KESEHATAN', /\bpbi\s+jaminan\s+kesehatan\b|\bpbi\s+apb[nd]\b/i, false],
    ['PPU', /\b(?:ppu|pekerja\s+penerima\s+upah)\b/i, false],
    ['PEKERJA MANDIRI', /\bpekerja\s+mandiri\b/i, true],
    ['PBPU MANDIRI', /\bpbpu\b(?!\s+dan\s+bp\s+pemerintah\s+daerah)/i, true],
    ['BUKAN PEKERJA', /\bbukan\s+pekerja\b/i, false],
  ];
  const jknSegment = jknSegmentOptions.map(([label, pattern, mandiri]) => {
    const refs = docsFor(jknPages, pattern);
    return refs.length ? { label, mandiri, refs } : null;
  }).find(Boolean) || null;

  const nonChecklistText = nonChecklistPages.map(page => page.text || '').join('\n');
  const hasNapza = /\bIPWL\b|\bbnn\b|perawatan\s+narkoba|\bF1[0-9](?:\.\d+)?\b/i.test(nonChecklistText) || /^F1[0-9]/i.test(primary);
  const hasPbiProposal = /proses\s+(?:pengusulan|pendaftaran)\s+(?:pbi|pbpu\s+pemda)|lapad\s+ruhama/i.test(nonChecklistText)
    || (statuses.some(item => item.label === 'PESERTA / DATA TIDAK DITEMUKAN' || item.label === 'BELUM TERDAFTAR') && docs.social.refs.length > 0);
  const hasInactiveStatus = statuses.some(item => ['NON AKTIF', 'TIDAK DITANGGUNG', 'PENANGGUHAN PEMBAYARAN', 'PENANGGUHAN AKTIVASI'].includes(item.label));
  const suggestedCategory = hasNapza
    ? { id: 'napza', reason: 'Terdeteksi asesmen IPWL, rujukan BNN, atau diagnosis gangguan penggunaan zat.' }
    : hasPbiProposal
    ? { id: 'pbi', reason: 'Terdeteksi surat rekomendasi Dinsos/Puskesos atau keterangan proses pengusulan PBI/PBPU Pemda.' }
    : hasInactiveStatus && (!jknSegment || !jknSegment.mandiri)
    ? { id: 'inactive', reason: 'Status JKN nonaktif/tidak ditanggung' + (jknSegment ? ' pada segmen ' + jknSegment.label : '') + '.' }
    : null;

  const extracted = recoverEklaimOcrFields({}, grouping);
  const billingTotal = findBillingTotal(pages);
  const patientName = findPatientName(pages, claim);
  const consistency = auditConsistency(pages, claim, docs);
  return {
    pages, docs, primary, secondary, procedures, codeDescriptions, age, service, statuses, jknSegment, suggestedCategory,
    cbgDescription: claim?.cbgDescription || extracted.cbgDescription || '',
    claim, billingTotal, patientName, consistency,
  };
}

function row(id, title, summary, refs = [], status = 'Perlu klarifikasi', extra = {}) {
  return { id, title, summary, refs, status, ...extra };
}

export function adminRows(info, state) {
  const { docs, statuses, jknSegment, pages, claim, billingTotal, consistency } = info;
  const required = (id, text) => row(
    id,
    docs[id].name,
    text || (docs[id].refs.length ? 'Dokumen terdeteksi. Cocokkan isinya pada halaman bukti.' : 'Dokumen belum terkonfirmasi. Periksa halaman dan lampiran.'),
    docs[id].refs,
    docs[id].refs.length ? 'Sesuai' : 'Perlu klarifikasi',
  );
  if (state.scope === 'package') return ['sptjm', 'submission', 'recap'].map(id => required(id));
  const category = state.category || '';
  const service = state.service || info.service;
  const billingSummary = billingTotal
    ? 'Total tagihan RS terbaca ' + rp(billingTotal.amount) + (claim?.tarif ? ' (tarif INA-CBG ' + rp(claim.tarif) + ')' : '') + '. Cocokkan rincian pada halaman bukti.'
    : '';
  const billingRefs = refsFor(docs.billing.refs, billingTotal ? [billingTotal] : []);
  const rows = [
    required('grouping'),
    required('resume'),
    row('billing', docs.billing.name, billingSummary || (docs.billing.refs.length ? 'Dokumen terdeteksi. Cocokkan isinya pada halaman bukti.' : 'Dokumen belum terkonfirmasi. Periksa halaman dan lampiran.'), billingRefs, (docs.billing.refs.length || billingTotal) ? 'Sesuai' : 'Perlu klarifikasi'),
  ];
  if (!['odgj', 'pgot'].includes(category)) rows.push(required('identity', 'Periksa dokumen identitas sesuai usia dan kondisi pasien.'));
  if (['inactive', 'pbi', 'disaster', 'outbreak', 'kipi', 'violence', 'napza'].includes(category) || statuses.length) {
    const inactiveStatuses = new Set(['NON AKTIF', 'TIDAK DITANGGUNG', 'PENANGGUHAN PEMBAYARAN', 'PENANGGUHAN AKTIVASI']);
    const hasCompatibleStatus = statuses.some(status => inactiveStatuses.has(status.label));
    const hasMissingStatus = statuses.some(status => ['PESERTA / DATA TIDAK DITEMUKAN', 'BELUM TERDAFTAR'].includes(status.label));
    const compatibleInactive = category === 'inactive' && hasCompatibleStatus && !hasMissingStatus && !jknSegment?.mandiri;
    const compatiblePbi = category === 'pbi' && (hasCompatibleStatus || hasMissingStatus) && !jknSegment?.mandiri;
    const compatible = compatibleInactive || compatiblePbi;
    const observed = statuses.map(status => status.label).join(' / ');
    rows.push(row('jkn', 'Hasil pengecekan JKN', compatible
      ? observed + (compatiblePbi
        ? ' terbaca. Bukti status sesuai untuk jalur masa tunggu PBI APBD/APBN.'
        : ' terbaca. Bukti status sesuai untuk jalur JKN nonmandiri nonaktif.')
      : observed ? 'Terbaca ' + observed + '. Konfirmasi arti dan kecocokan dengan kategori.' : 'Status belum terkonfirmasi dari teks yang terbaca.',
    refsFor(docs.jkn.refs, ...statuses.map(status => status.refs)), compatible ? 'Sesuai' : 'Perlu klarifikasi'));
  }
  if (category === 'inactive' || jknSegment) {
    const segSummary = jknSegment
      ? jknSegment.mandiri
        ? 'Terbaca segmen ' + jknSegment.label + ' (peserta mandiri — perhatikan ketentuan jalur nonmandiri JPKM).'
        : 'Terbaca segmen ' + jknSegment.label + '. Konfirmasi kesesuaian segmen nonmandiri pada bukti JKN.'
      : 'Konfirmasi bahwa peserta termasuk segmen nonmandiri dari bukti JKN.';
    const segMatch = ['inactive', 'pbi'].includes(category) && jknSegment && !jknSegment.mandiri;
    rows.push(row('segment', 'Segmen peserta JKN', segSummary, refsFor(docs.jkn.refs, jknSegment?.refs || []),
      jknSegment?.mandiri ? 'Perlu klarifikasi' : (segMatch ? 'Sesuai' : 'Perlu klarifikasi'),
      { automatic: Boolean(jknSegment?.mandiri && ['inactive', 'pbi'].includes(category)) }));
  }
  if (['pbi', 'pgot', 'odgj', 'napza'].includes(category)) rows.push(required('social', category === 'pbi'
    ? 'Cocokkan rekomendasi Dinas Sosial dan/atau Dinas Kesehatan kabupaten/kota, keterangan masa tunggu PBI, dan masa berlaku 3 bulan.'
    : category === 'napza' ? 'Cocokkan keterangan masa tunggu PBI dari instansi terkait.'
    : 'Cocokkan penerbit yang berwenang, keterangan kategori tanpa NIK, dan masa berlaku 3 bulan.'));
  if (category && service === 'Rawat Jalan' && !['disaster', 'outbreak', 'kipi'].includes(category)) rows.push(required('referral'));
  if (category && service === 'Rawat Inap') rows.push(required('admission'));
  const special = {
    disaster: [['Bukti korban bencana', /(?:korban|akibat)\s+bencana/i], ['Keterangan masa tanggap darurat', /masa\s+tanggap\s+darurat/i], ['Bukti tidak dijamin sumber lain', /tidak\s+dijamin/i]],
    outbreak: [['Keterangan korban KLB', /kejadian\s+luar\s+biasa|\bKLB\b/i], ['Laporan surveilans KLB', /surveilans/i], ['Bukti tidak dijamin sumber lain', /tidak\s+dijamin/i]],
    kipi: [['Keterangan imunisasi dan KIPI', /kejadian\s+ikutan\s+pasca\s+imunisasi|\bKIPI\b/i], ['Laporan surveilans KIPI', /surveilans/i], ['Bukti tidak dijamin sumber lain', /tidak\s+dijamin/i]],
    violence: [['Surat keterangan instansi berwenang', /kepolisian|dp3akb|dinas\s+sosial/i], ['Berita acara penanganan korban', /berita\s+acara/i]],
    napza: [['Keterangan atau asesmen IPWL', /\bIPWL\b/i], ['Bukti penjaminan Kemenkes episode terkait', /penjaminan|kementerian\s+kesehatan/i], ['Bukti penginputan SELARAS', /\bselaras\b/i]],
  };
  for (const [index, [label, pattern]] of (special[category] || []).entries()) {
    const refs = docsFor(pages, pattern);
    rows.push(row('special-' + index, label, 'Konfirmasi dokumen, isi dan cakupannya untuk kategori ini.', refs, refs.length ? 'Sesuai' : 'Perlu klarifikasi'));
  }
  if (docs.jpkm.refs.length) rows.push(row('jpkm', docs.jpkm.name, 'Dokumen pendukung terdeteksi.', docs.jpkm.refs, 'Sesuai'));
  if (consistency?.wrongPatientPages.length) {
    rows.push(row('patient-mismatch', 'Potensi lampiran pasien lain (No. RM berbeda)',
      'Ditemukan halaman dengan nomor rekam medis atau identitas yang berbeda dari Berkas Klaim Individual (' + claim?.noRM + '). Periksa apakah ada halaman salah selip.',
      consistency.wrongPatientPages, 'Perlu klarifikasi',
      { automatic: true, actions: consistency.wrongPatientPages.map(item => 'Hlm. ' + item.number + ': ' + item.excerpt) }));
  }
  if (consistency?.jknPayerOnClaim) {
    rows.push(row('claim-payer', 'Penjamin pada Berkas Klaim Individual tertulis JKN',
      'Berkas Klaim Individual mencantumkan penjamin JKN. Pastikan pengajuan memang ditujukan untuk JPKM Jawa Barat dan lampiran sesuai.',
      consistency.jknPayerOnClaim.refs, 'Perlu klarifikasi', { automatic: true }));
  }
  if (consistency?.genderMismatch.length) {
    rows.push(row('gender-mismatch', 'Perbedaan jenis kelamin antar dokumen',
      consistency.genderMismatch.map(item => 'Hlm. ' + item.number + ': tertulis ' + item.found).join('; ')
      + ' (pada e-Klaim tertulis ' + claim?.jenisKelamin + '). Konfirmasi identitas pasien.',
      refsFor(docs.grouping.refs, consistency.genderMismatch), 'Perlu klarifikasi', { automatic: true }));
  }
  return rows;
}

function getCodes(info, state) {
  const secondary = state.secondary == null ? info.secondary : diagnosisCodes(state.secondary);
  const primary = state.primary == null ? info.primary : diagnosisCodes(state.primary)[0] || '';
  const procedures = state.procedures == null ? info.procedures : procedureCodes(state.procedures);
  return {
    primary, secondary, procedures, diaglist: [primary, ...secondary].filter(Boolean).join(','), proclist: procedures.join(','),
    layanan: state.service || info.service, umurTahun: state.age || info.age || undefined, cbgDescription: info.cbgDescription,
    los: info.claim?.los, caraPulang: info.claim?.caraPulang, tglMasuk: info.claim?.tglMasuk, tglKeluar: info.claim?.tglKeluar,
    sep: info.claim?.nomorSEP, mrn: info.claim?.noRM, registerSITB: info.claim?.registerSITB,
  };
}

function clinicalContext(info) {
  const d = info.docs;
  const billingEvidence = refsFor(d.billing.refs, d.receipt.refs);
  const wrongPages = info.consistency?.wrongPatientPages || [];
  const isExcludedPage = page => checklistPattern.test(page.text || '') || wrongPages.some(ref => samePage(ref, page));
  const admin = refsFor(d.jkn.refs, d.grouping.refs, d.identity.refs, d.social.refs, d.jpkm.refs, d.sptjm.refs, d.submission.refs, d.recap.refs);
  const clinicalHeaders = refsFor(d.resume.refs, d.ed.refs, d.radiology.refs, d.procedure.refs, d.progress.refs);
  const pricedLinePattern = /\d{1,3}(?:[.,]\d{3})+\s+\d+(?:[.,]\d+)?\s+\d{1,3}(?:[.,]\d{3})+|(?:subtotal|total\s+bayar)\s*[:.]?\s*Rp\.?\s*[\d.,]{4,}/i;
  const billingSet = new Set(billingEvidence.map(ref => `${ref.file}:${ref.number}`));
  for (const page of info.pages) {
    const key = `${page.file}:${page.number}`;
    if (billingSet.has(key) || !billingSet.has(`${page.file}:${page.number - 1}`)) continue;
    if (isExcludedPage(page) || admin.some(ref => samePage(ref, page)) || clinicalHeaders.some(ref => samePage(ref, page))) continue;
    if (pricedLinePattern.test(page.text || '')) {
      billingSet.add(key);
      billingEvidence.push({ file: page.file, number: page.number, excerpt: 'Lanjutan rincian biaya / kuitansi' });
    }
  }
  const clinicalPages = info.pages.filter(page => !isExcludedPage(page) && !admin.some(ref => samePage(page, ref))
    && !billingEvidence.some(ref => samePage(page, ref)));
  const billingPages = info.pages.filter(page => !isExcludedPage(page) && billingEvidence.some(ref => samePage(page, ref)) && !admin.some(ref => samePage(page, ref)));
  const files = unique(info.pages.map(page => page.file)).map(index => ({ index }));
  const marked = pages => pages.map(page => '[HALAMAN ' + page.number + ']\n' + (page.text || page.layout || '')).join('\n');
  const locate = (snippets, pages) => refsFor((snippets || []).flatMap(item => {
    if (typeof item !== 'string') return [];
    const marker = item.match(/\[PDF\s+(\d+)[^\]]*?Halaman\s+(\d+)\]/i);
    const page = marker && pages.find(p => p.file === files[Number(marker[1]) - 1]?.index && p.number === Number(marker[2]));
    return page ? [{ file: page.file, number: page.number, excerpt: item.slice(marker.index + marker[0].length).replace(/^\s*[:\-–—]?\s*/, '').trim() }] : [];
  }));
  return { billingEvidence, admin, clinicalPages, billingPages, files, marked, locate };
}

function parseEvidenceQuotes(snippets, pages, files) {
  const seen = new Set();
  const quotes = [];
  for (const item of snippets || []) {
    if (typeof item !== 'string') continue;
    const marker = item.match(/\[PDF\s+(\d+)[^\]]*?Halaman\s+(\d+)\]/i);
    if (!marker) continue;
    const page = pages.find(p => p.file === files[Number(marker[1]) - 1]?.index && p.number === Number(marker[2]));
    if (!page) continue;
    const quote = item.slice(marker.index + marker[0].length).replace(/^\s*[:\-–—]?\s*/, '').trim();
    if (!quote) continue;
    const key = `${page.file}:${page.number}:${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push({ file: page.file, number: page.number, quote });
  }
  return quotes;
}

function attachReferences(refList, fallbackSource) {
  const references = (refList || []).filter(ref => ref && typeof ref.label === 'string' && ref.label.trim());
  const validUrl = url => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '');
  return {
    source: references[0]?.label || guideline(fallbackSource),
    references: references.map(ref => ({
      label: ref.label.trim(),
      ...(ref.detail ? { detail: String(ref.detail).trim() } : {}),
      ...(validUrl(ref.url) ? { url: validUrl(ref.url) } : {}),
    })),
  };
}

export function codingRows(info, state) {
  const codes = getCodes(info, state);
  const { clinicalPages, files, marked, locate } = clinicalContext(info);
  const clinicalDocTexts = files.map(file => marked(clinicalPages.filter(page => page.file === file.index)));
  const clinicalDocEntries = clinicalDocTexts.map(text => ({ text, partial: false }));
  const claimRefs = info.docs.grouping.refs;
  const clinicalRefs = refsFor(info.docs.resume.refs, info.docs.procedure.refs, info.docs.ed.refs);
  const primaryRefs = refsFor(claimRefs, clinicalRefs);
  const procRefs = refsFor(claimRefs, info.docs.procedure.refs);
  const procReferenceDetails = procedureReferencesFor(codes.proclist).map(({ code, matches }) =>
    `${code} (Ingenix ICD-9-CM 2010): ` + matches.map(m => `${m.file}, hlm. PDF ${m.page}`).join(' · '));
  const rows = [
    row('primary', 'Ketepatan diagnosis utama', 'Bandingkan diagnosis utama pada hasil grouping dan resume medis.', primaryRefs, (codes.primary && primaryRefs.length) ? 'Sesuai' : 'Perlu klarifikasi'),
    row('secondary', 'Diagnosis sekunder dan spesifisitas', 'Tinjau kode dan urutannya, serta dukungan dokumentasi untuk diagnosis tambahan.', primaryRefs, primaryRefs.length ? 'Sesuai' : 'Perlu klarifikasi'),
    row('procedure', 'Ketepatan kode prosedur', 'Cocokkan kode tindakan yang diajukan dengan bukti pelaksanaan. Pilih Tidak berlaku bila episode tidak mengajukan prosedur.', procRefs, procRefs.length ? 'Sesuai' : 'Perlu klarifikasi', procReferenceDetails.length ? { details: procReferenceDetails } : {}),
  ];
  const { tariffClassMismatch, deathDischargeMismatch, losMismatch } = info.consistency || {};
  const deathAssessment = assessClaimDeathEvidence(codes, clinicalDocTexts);
  if (tariffClassMismatch) {
    rows.push(row('tariff-class-mismatch', 'Ketidaksesuaian kelas tarif INA-CBG dengan kelas RS',
      `Kelas RS tercatat Kelas ${tariffClassMismatch.kelasRS}, sedangkan Jenis Tarif INA-CBG menggunakan Tarif RS Kelas ${tariffClassMismatch.kelasTarif}. Konfirmasi ulang grouping e-Klaim dan penetapan tarif.`,
      tariffClassMismatch.refs, 'Perlu klarifikasi', { automatic: true, source: guideline('Permenkes Tarif INA-CBG / ketentuan penjaminan JPKM') }));
  }
  if (deathDischargeMismatch || deathAssessment.hasConflict) {
    const deathRefs = refsFor(deathDischargeMismatch?.refs || [], claimRefs, locate(deathAssessment.evidence, clinicalPages));
    const deathPagesLabel = deathRefs.filter(ref => !claimRefs.some(c => samePage(c, ref))).map(ref => 'hlm. ' + ref.number).join(', ');
    const recordedStatus = deathDischargeMismatch?.caraPulang || deathAssessment.recordedStatus;
    rows.push(row('discharge-death-mismatch', 'Ketidaksesuaian cara pulang dengan laporan kematian',
      `Cara pulang pada klaim tertulis "${recordedStatus || 'hidup/izin dokter'}", tetapi ditemukan bukti kematian pada ${deathPagesLabel || 'dokumen klinis'}. Konfirmasi status pulang dan revisi grouping bila perlu.`,
      deathRefs, 'Perlu klarifikasi', {
        automatic: true,
        evidenceQuotes: parseEvidenceQuotes(deathAssessment.evidence, clinicalPages, files),
      }));
  }
  if (losMismatch) {
    rows.push(row('los-mismatch', 'Selisih lama rawat (LOS) dengan tanggal masuk–keluar',
      `LOS e-Klaim tertulis ${losMismatch.los} hari, sedangkan rentang ${losMismatch.tglMasuk} s.d. ${losMismatch.tglKeluar} adalah ${losMismatch.expected} hari.`,
      losMismatch.refs, 'Perlu klarifikasi', { automatic: true }));
  }
  const conflicts = [...[codes.primary, ...codes.secondary], ...codes.procedures].filter((code, index, all) => all.indexOf(code) !== index);
  if (conflicts.length) rows.push(row('duplicate', 'Kode berulang', unique(conflicts).join(', ') + ' muncul lebih dari sekali. Konfirmasi berdasarkan konteks episode.', claimRefs, 'Perlu klarifikasi', { automatic: true }));

  const diabetesFindings = evaluateDiabetesCodingAudit(codes, clinicalDocEntries);
  const diabetesRuleIds = new Set(diabetesFindings.map(finding => finding.ruleId));
  for (const finding of diabetesFindings) {
    const dmRefs = locate(finding.evidence, clinicalPages);
    const refMeta = attachReferences(getAuditRuleReferences(finding.ruleId, finding.case));
    rows.push(row(finding.ruleId, finding.case, finding.warning, refsFor(dmRefs, claimRefs), finding.needsReview ? 'Perlu klarifikasi' : 'Sesuai', {
      ...refMeta,
      automatic: finding.needsReview,
      evidenceQuotes: parseEvidenceQuotes(finding.evidence, clinicalPages, files),
    }));
  }

  // An OCR failure in the principal field must not promote a secondary code to principal.
  const applicableRules = codes.primary ? auditCatalog : auditCatalog.filter(rule => !rule.requires_primary?.length);
  for (const finding of evaluateAuditCodingRules(codes, applicableRules).filter(f => !diabetesRuleIds.has(f.ruleId))) {
    const cited = finding.warning.match(/TKMKB\s+(?:Tahun\s+)?\d{4}|BA\s+Kesepakatan\s+Koding(?:\s+\d{4})?/i)?.[0];
    const refMeta = attachReferences(getAuditRuleReferences(finding.ruleId, finding.case), cited);
    rows.push(row(finding.ruleId, finding.case, finding.warning, refsFor(claimRefs, clinicalRefs), 'Perlu klarifikasi', {
      ...refMeta,
      automatic: true,
      docs: finding.requiredDocuments.map(doc => typeof doc === 'string' ? doc : doc.label).filter(Boolean),
    }));
  }

  const procedureAudits = evaluateProcedureDocumentation(codes, clinicalDocTexts, {
    describeCode: code => resolveIcdDescription(code, info.codeDescriptions, null, { exact: true }),
    referenceLookup: procedureReferenceLookup,
  });
  for (const finding of procedureAudits) {
    if (!finding.hasSpecificRule && !finding.inconsistent) continue;
    const procAuditRefs = refsFor(locate(finding.evidence, clinicalPages), procRefs);
    const procReferences = finding.reference ? [{ label: finding.reference, detail: 'Rujukan deskripsi prosedur ICD-9-CM 2010.' }] : [];
    rows.push(row(finding.ruleId, finding.case, finding.warning, procAuditRefs, finding.needsReview ? 'Perlu klarifikasi' : 'Sesuai', {
      source: finding.reference || guideline('ICD-9-CM'),
      references: procReferences,
      automatic: finding.needsReview,
      evidenceQuotes: parseEvidenceQuotes(finding.evidence, clinicalPages, files),
    }));
  }

  for (const rule of getTriggeredJknDocumentRules(codes).filter(rule => rule.codingGuidance
    && (rule.id !== 'JKN-DOC-14' || inpatient(codes.layanan)))) {
    let title = rule.title;
    if (rule.id === 'JKN-COD-72') {
      const ventCodes = codes.procedures.filter(c => /^96\.7(?:0|1|2)?$/.test(c));
      const hasTrach = codes.procedures.some(c => /^31\.[12]/.test(c));
      if (!hasTrach && ventCodes.length) title = 'Ventilator Mekanik Invasif (' + ventCodes.join(', ') + ')';
    }
    const refMeta = attachReferences(getMedicalRuleReferences(rule), rule.source);
    rows.push(row('COD-' + rule.id, title, rule.codingGuidance, refsFor(claimRefs, clinicalRefs), 'Perlu klarifikasi', {
      ...refMeta,
      automatic: true,
      docs: (rule.requiredDocuments || []).map(doc => doc.label),
    }));
  }
  return rows;
}

const medicalSources = {
  'MED-STT': 'JKN-DOC-12',
  'MED-ENSEFALOPATI': 'JKN-DOC-06',
  'MED-HIPONATREMIA': 'JKN-DOC-ELEKTROLIT-NA',
  'MED-HIPOKALEMIA': 'JKN-DOC-ELEKTROLIT-K',
  'MED-DIARE-RANAP': 'JKN-DOC-DIARE-01',
  'MED-PNEUMONIA': 'JKN-DOC-08',
  'MED-VENTILATOR': 'JKN-COD-72',
  'MED-TB': 'JKN-PNPK-TB',
};

export const medicalRuleIdOf = checkId => medicalSources[checkId] || String(checkId || '').replace(/^MED-/, '');

function triageRow(pages, service, info, codes) {
  const form = docsFor(pages, triagePattern);
  const triagePages = pages.filter(page => form.some(ref => samePage(page, ref)));
  const assessments = triagePages.map(page => {
    const plain = evaluateEsiTriage(page.text || '');
    const result = plain.triageDocumented || !page.layout ? plain : evaluateEsiTriage(page.layout);
    return { page, result };
  });
  const documented = assessments.filter(({ result }) => result.triageDocumented);
  const values = unique(documented.flatMap(({ result }) => [
    ...result.atsRecords.map(record => 'ATS ' + record.level),
    ...result.colorRecords.map(record => record.category),
    ...result.recorded.map(record => 'ESI ' + record.level),
    result.falseEmergencyRecorded ? 'Non-emergency tercatat' : null,
  ]).filter(Boolean));
  const categoryRefs = form.filter(ref => documented.some(({ page }) => samePage(page, ref)));
  const summary = !form.length ? 'Teks triase belum terdeteksi. Periksa visual PDF, terutama formulir hasil pindai.'
    : !documented.length ? 'Dokumen triase terdeteksi. Pilihan kategorinya perlu diperiksa pada halaman bukti.'
    : 'Dokumen triase terdeteksi. Cocokkan kategori yang terbaca dengan pilihan pada formulir.'
      + (values.length ? ' Hasil baca: ' + values.join(', ') + '.' : '');
  const isNewbornOrRehab = info.claim?.umurHari === 0 || /^(?:P0\d|Z3[78])/.test(codes.primary || '')
    || /\bIPWL\b/i.test(pages.map(page => page.text || '').join('\n'));
  const hasConflictOrFalse = assessments.some(({ result }) => result.falseEmergencyRecorded || result.localConflict
    || result.discrepancy || result.recordedColor === 'Hitam' || result.requiresReview);
  const hasNonUrgent = documented.some(({ result }) => result.recorded.some(r => r.level >= 4)
    || result.atsRecords.some(r => r.level >= 4) || result.colorRecords.some(r => r.category === 'Hijau'));
  const triagePassed = form.length > 0 && documented.length > 0 && !hasConflictOrFalse && !hasNonUrgent;
  return row('MED-ESI', 'Triase IGD', summary, form, triagePassed ? 'Sesuai' : 'Perlu klarifikasi', {
    automatic: !triagePassed,
    source: guideline('Permenkes Nomor 47 Tahun 2018 tentang Pelayanan Kegawatdaruratan dan SOP triase IGD rumah sakit'),
    checklist: [
      { label: 'Formulir atau catatan triase', detected: form.length > 0, refs: form },
      { label: 'Kategori triase yang dipilih', detected: documented.length > 0, refs: categoryRefs },
    ],
    actions: [
      ...(inpatient(service) ? ['Konfirmasi apakah pasien masuk melalui IGD atau langsung rawat inap.'] : []),
      ...(!form.length && isNewbornOrRehab ? ['Jika pasien lahir di RS atau masuk rawat inap elektif/rehabilitasi tanpa melalui IGD, pilih Tidak berlaku dan catat alasannya.'] : []),
      'Cocokkan kategori dengan asesmen awal, tanda vital, dan catatan pelayanan IGD.',
    ],
  });
}

export function medicalRows(info, state) {
  const d = info.docs;
  const codes = getCodes(info, state);
  const { clinicalPages, billingPages, files, marked, locate } = clinicalContext(info);
  const clinical = refsFor(d.resume.refs, d.ed.refs, d.lab.refs, d.radiology.refs, d.procedure.refs, d.therapy.refs, d.progress.refs)
    .filter(ref => clinicalPages.some(page => samePage(page, ref)));
  const onlyClinical = (...groups) => refsFor(...groups).filter(ref => clinicalPages.some(page => samePage(page, ref)));
  const base = (id, title, summary, refs) => row(id, title, summary, refs, refs.length ? 'Sesuai' : 'Perlu klarifikasi');
  const rows = [
    base('episode', 'Dokumentasi klinis episode', 'Periksa diagnosis, pelayanan, dan kondisi akhir sesuai jenis layanan.', onlyClinical(d.resume.refs, d.ed.refs)),
    base('diagnosis', 'Dukungan klinis untuk diagnosis', 'Tinjau asesmen dokter, pemeriksaan, dan penunjang yang relevan.', clinical),
    base('indication', 'Indikasi jenis layanan dan lama perawatan', 'Cocokkan alasan pelayanan dan, untuk rawat inap, kebutuhan perawatan sesuai catatan dokter.', onlyClinical(d.admission.refs, d.ed.refs, d.resume.refs, d.progress.refs)),
    base('intervention', 'Kesesuaian tindakan, obat, dan penunjang', 'Periksa indikasi dan bukti pelaksanaan item yang diajukan.', onlyClinical(d.procedure.refs, d.therapy.refs, d.lab.refs, d.radiology.refs)),
    base('guideline', 'Kesesuaian dengan standar klinis', 'Nilai pedoman yang berlaku dan catat justifikasi klinis.', clinical),
    base('consistency', 'Konsistensi rekam medis dan klaim', 'Bandingkan resume dan bukti klinis dengan kode pada tab Audit Coding.', clinical),
    base('frequency', 'Kewajaran frekuensi dan pemanfaatan', 'Tinjau pengulangan atau potensi duplikasi berdasarkan catatan layanan dan billing.', refsFor(d.billing.refs, d.progress.refs, d.therapy.refs)),
  ];
  if (inpatient(codes.layanan) || emergency(codes.layanan)) rows.push(triageRow(clinicalPages, codes.layanan, info, codes));
  const clinicalDocTexts = files.map(file => marked(clinicalPages.filter(page => page.file === file.index)));
  const ocr = Object.fromEntries(files.map((file, idx) => [String(file.index), { text: clinicalDocTexts[idx] }]));
  const sectionText = pages => files.map(file => marked(pages.filter(page => page.file === file.index))).join('\n[HALAMAN 0]\n').toLowerCase().replace(/\s+/g, ' ');
  const text = clinicalPages.map(page => page.text).join('\n');
  const deathAssessment = assessClaimDeathEvidence(codes, clinicalDocTexts);
  const triggered = getTriggeredJknDocumentRules({ ...codes, clinicalText: text }, deathAssessment)
    .filter(rule => rule.id !== 'JKN-DOC-14' || inpatient(codes.layanan));
  const checks = evaluatePreClaimMedicalCriteria(codes, files, ocr, triggered, {
    clinical: sectionText(clinicalPages), billing: sectionText(billingPages),
  }, deathAssessment);
  // Evaluasi urutan kunjungan memerlukan dataset longitudinal dengan identitas terverifikasi.
  const needsHistory = new Set(['PPK-MRI', 'PPK-PRE-OP', 'PPK-SELF-REFERRAL']);
  checks.push(...evaluatePpkPreClaimRules({ claim: codes, relatedClaims: [], documentText: text })
    .filter(check => !needsHistory.has(check.id)));
  const ruleOf = check => medicalRuleIdOf(check.id);
  for (const check of checks) {
    const checklist = (check.details || []).map(item => ({
      label: item.label, detected: item.passed === true,
      refs: item.grouping ? d.grouping.refs : locate(item.snippets || [], item.billing ? billingPages : clinicalPages),
      locate: true,
    }));
    const cited = refsFor(
      locate(check.evidence || [], clinicalPages),
      check.id === 'MED-JKN-ADM-01' ? locate(deathAssessment.evidence, clinicalPages) : [],
    );
    const fallbackSource = check.source || triggered.find(rule => rule.id === ruleOf(check))?.source || check.basis;
    const refMeta = attachReferences(getMedicalRuleReferences({ ...check, source: fallbackSource }), fallbackSource);
    const passed = check.status === 'SESUAI';
    const rowStatus = passed ? 'Sesuai' : check.status === 'TIDAK_SESUAI' ? 'Tidak sesuai' : 'Perlu klarifikasi';
    rows.push(row(check.id, check.title, check.summary, refsFor(cited, ...checklist.map(item => item.refs)), rowStatus, {
      ...refMeta,
      automatic: !passed,
      checklist,
      actions: (check.recommendations || []).filter(Boolean),
      parameters: (check.parameters || []).filter(Boolean),
      evidenceQuotes: parseEvidenceQuotes([
        ...(check.evidence || []),
        ...(check.id === 'MED-JKN-ADM-01' ? deathAssessment.evidence : []),
      ], clinicalPages, files),
      details: [...(check.evidence || []), ...(check.vitrectomyPdrIndications || [])]
        .filter(item => typeof item === 'string' && !/^Acuan:|akurat|blueprint pengguna/i.test(item)),
    }));
  }
  if (!inpatient(codes.layanan)) {
    for (const finding of evaluateDiagnosisPpk1(codes, text)) {
      rows.push(row(finding.id, 'Indikasi rujukan · ' + finding.title, finding.summary,
        onlyClinical(d.referral.refs), 'Perlu klarifikasi', {
          source: guideline(finding.basis),
          automatic: true,
          actions: finding.recommendations,
          details: [finding.referralCriteria, ppkReferralLogicText(finding.referralLogic)].filter(Boolean),
        }));
    }
  }
  for (const trigger of triggered.filter(rule => !checks.some(check => ruleOf(check) === rule.id))) {
    const refMeta = attachReferences(getMedicalRuleReferences(trigger), trigger.source);
    rows.push(row(trigger.id, trigger.title, 'Cocokkan dokumen bersyarat dengan indikator pada acuan.',
      [], 'Perlu klarifikasi', {
        ...refMeta,
        automatic: true,
        docs: (trigger.requiredDocuments || []).map(doc => doc.label),
      }));
  }
  return rows;
}
