const CHEMOTHERAPY_REGIMEN_PATTERNS = [
  /\b(?:regimen|protokol|siklus|cycle)\s*[:=-]?\s*(?:kemoterapi|kemo|chemotherapy)\b/i,
  /\b(?:kemoterapi|chemotherapy)\s*[:=-]?\s*(?:regimen|protocol|siklus|cycle)\b/i,
  /\b(?:regimen|protokol|siklus|cycle)\s*[:=-]?\s*(?:AC(?:-?T)?|FAC|FEC|TC|TCHP|FOLFOX|FOLFIRI|CAPOX|XELOX|CHOP|R-?CHOP|ABVD|BEP|EP|EC|CMF)\b/i,
  /\b(?:AC-?T|FAC|FEC|TCHP|FOLFOX|FOLFIRI|CAPOX|XELOX|R-?CHOP|ABVD|BEP|CMF)\s*(?:regimen|protocol|siklus|cycle)\b/i, // Wajib ada penanda "regimen" atau "siklus" agar singkatan tidak false-positive
];

const normalizeCodes = (value) => String(value || '')
  .toUpperCase()
  .split(/[;,|\s]+/)
  .map((code) => code.replace(/^[([{]+|[\])},:]+$/g, ''))
  .filter(Boolean);

export const detectChemotherapyRegimen = (pdfText) => {
  const text = String(pdfText || '').replace(/\s+/g, ' ');
  const pattern = CHEMOTHERAPY_REGIMEN_PATTERNS.find((candidate) => candidate.test(text));
  if (!pattern) return { detected: false, evidence: '' };

  const match = text.match(pattern);
  const start = Math.max(0, (match?.index || 0) - 45);
  const end = Math.min(text.length, (match?.index || 0) + (match?.[0]?.length || 0) + 70);
  return {
    detected: true,
    evidence: text.slice(start, end).trim(),
  };
};

export const evaluateChemotherapyCoding = ({ pdfText, diaglist, proclist }) => {
  const regimen = detectChemotherapyRegimen(pdfText);
  const detectedDrugs = detectChemotherapyDrugs(pdfText);
  if (!regimen.detected && !detectedDrugs.length) return null;

  const diagnoses = normalizeCodes(diaglist);
  const procedures = normalizeCodes(proclist);
  const oralChemotherapy = detectedDrugs.some((drug) => drug.oral) || /\b(?:kemoterapi\s+oral|kemo\s+oral|oral\s+chemotherapy|capecitabine|capecitabin|imatinib|gefitinib|erlotinib|osimertinib|sunitinib|sorafenib|lapatinib|nilotinib|dasatinib|temozolomide|temozolomid)\b/i.test(String(pdfText || '')) || ORAL_CHEMOTHERAPY_ALIAS_PATTERN.test(String(pdfText || ''));
  const hasZ511 = diagnoses.includes('Z51.1') || diagnoses.includes('Z511');
  const has9925 = oralChemotherapy || procedures.includes('99.25') || procedures.includes('9925');
  const missingCodes = [!hasZ511 && 'Z51.1', !has9925 && '99.25'].filter(Boolean);

  return {
    id: 'MED-CHEMOTHERAPY-CODING',
    title: 'Kelengkapan koding regimen kemoterapi',
    status: missingCodes.length ? 'PERLU_VALIDASI' : 'SESUAI',
    summary: missingCodes.length
      ? `Regimen kemoterapi terdeteksi pada PDF, tetapi kode ${missingCodes.join(' dan ')} belum ditemukan pada klaim.`
      : oralChemotherapy
        ? 'Kemoterapi oral terdeteksi pada PDF; kode Z51.1 sudah tercantum dan 99.25 tidak diwajibkan.'
        : 'Regimen kemoterapi terdeteksi pada PDF; kode Z51.1 dan 99.25 sudah tercantum pada klaim.',
    evidence: [regimen.evidence ? `Bukti PDF: "...${regimen.evidence}..."` : '', ...detectedDrugs.slice(0, 5).map((drug) => `Obat terdeteksi: ${drug.term} — ${chemotherapyCategoryLabel(drug.category)}`), oralChemotherapy ? 'Rute oral terdeteksi; pengecualian 99.25 diterapkan.' : ''].filter(Boolean),
    details: [
      { label: 'Diagnosis ICD-10 Z51.1 tercantum', passed: hasZ511 },
      { label: oralChemotherapy ? 'Kemoterapi oral: ICD-9-CM 99.25 tidak diwajibkan' : 'Prosedur ICD-9-CM 99.25 tercantum', passed: has9925 },
    ],
  };
};

export const evaluateOralChemotherapyOutpatientCancerCodes = ({ pdfText, diaglist, careType }) => {
  const detectedDrugs = detectChemotherapyDrugs(pdfText);
  const oralChemotherapy = detectedDrugs.some((drug) => drug.oral)
    || ORAL_CHEMOTHERAPY_ALIAS_PATTERN.test(String(pdfText || ''));
  const outpatient = /rawat\s*jalan|rajal|RJTL/i.test(String(careType || ''));
  const cancerCodes = normalizeCodes(diaglist)
    .filter((code) => /^(?:C\d{2}|D(?:0\d|1\d|2\d|3\d|4[0-8]))(?:\.\w+)?$/.test(code));
  if (!oralChemotherapy || !outpatient || !cancerCodes.length) return null;

  return {
    id: 'ORAL-CHEMO-RAJAL-CANCER-CODE-REVIEW',
    title: 'Review kode kanker pada kemoterapi oral rawat jalan',
    status: 'PERLU_VALIDASI',
    summary: `Kemoterapi oral rawat jalan terdeteksi bersama kode ${cancerCodes.join(', ')}. Tinjau dan hapus kode neoplasma C00–D48 dari diagnosis sekunder sesuai kaidah koding; aplikasi tidak menghapus otomatis.`,
    details: [
      { label: 'Kemoterapi oral terdeteksi', passed: true },
      { label: 'Layanan rawat jalan', passed: true },
      { label: `Kode kanker untuk ditinjau: ${cancerCodes.join(', ')}`, passed: false },
    ],
    evidence: detectedDrugs.slice(0, 5)
      .map((drug) => `Obat terdeteksi: ${drug.term} — ${chemotherapyCategoryLabel(drug.category)}`),
  };
};
import { ORAL_CHEMOTHERAPY_ALIAS_PATTERN } from './drugAliasDictionary.js';
import { chemotherapyCategoryLabel, detectChemotherapyDrugs } from './chemotherapyDrugCatalog.js';
