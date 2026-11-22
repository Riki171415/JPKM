import diagnosisPpk1 from '../data/diagnosisPpk1.js';
import { getPpkReferralLogic } from './ppkReferralLogic.js';

const normalizeCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const splitCodes = (value) => String(value || '').split(/[;,|\s]+/).map((code) => code.trim()).filter(Boolean);
const normalizeText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP_WORDS = new Set([
  'adalah', 'apabila', 'dalam', 'dengan', 'dilakukan', 'ditemukan', 'dokter', 'fasilitas', 'harus', 'hingga',
  'karena', 'kesehatan', 'kondisi', 'lainnya', 'layanan', 'melakukan', 'memerlukan', 'mengalami', 'menunjukkan',
  'merupakan', 'pasien', 'pelayanan', 'pemeriksaan', 'penanganan', 'pengobatan', 'perbaikan', 'perlu', 'rujukan',
  'segera', 'sekunder', 'setelah', 'sesuai', 'spesialis', 'terdapat', 'tidak', 'untuk', 'yang',
]);

const codeMatches = (claimCode, referenceCode) => {
  const claim = normalizeCode(claimCode);
  const reference = normalizeCode(referenceCode);
  if (!claim || !reference) return false;
  const broadReference = /-/.test(referenceCode) || !/[.]/.test(referenceCode) || reference.length <= 3;
  return broadReference ? claim.startsWith(reference) : claim === reference;
};

const salientTerms = (entry) => {
  const diagnosisTerms = new Set(normalizeText(entry.diagnosis).split(' '));
  return [...new Set(normalizeText(entry.referralCriteria).split(' '))]
    .filter((term) => term.length >= 6 && !STOP_WORDS.has(term) && !diagnosisTerms.has(term));
};

export const findDiagnosisPpk1Matches = (diaglist) => {
  const claimCodes = splitCodes(diaglist);
  return diagnosisPpk1.filter((entry) => claimCodes.some((claimCode) => codeMatches(claimCode, entry.icdCode)));
};

export const evaluateDiagnosisPpk1 = (claim, documentText = '') => {
  const clinicalText = normalizeText(`${claim.keterangan || ''} ${documentText}`);
  return findDiagnosisPpk1Matches(claim.diaglist).map((entry) => {
    const matchedTerms = salientTerms(entry).filter((term) => clinicalText.includes(term)).slice(0, 8);
    const criteriaDetected = matchedTerms.length >= 2;
    return {
      id: `PPK1-${entry.row}`,
      status: criteriaDetected ? 'WARNING' : 'PERLU_VALIDASI',
      title: entry.group || entry.diagnosis,
      diagnosis: entry.diagnosis,
      icdCode: entry.icdCode,
      competency: entry.competency,
      referralCriteria: entry.referralCriteria,
      referralLogic: getPpkReferralLogic(entry),
      basis: entry.basis,
      section: entry.section,
      sourceRow: entry.row,
      matchedTerms,
      recommendations: [
        'Cocokkan alasan rujukan pada resume/surat rujukan dengan kriteria dan bukti pemeriksaan.',
        'Jika belum jelas, klarifikasi ke DPJP dan catat alasan layanan RS sesuai fakta klinis.',
        'Casemix memeriksa kembali dokumen dan kesesuaian kode setelah klarifikasi.',
      ],
      summary: `Diagnosis ini termasuk kompetensi PPK 1/FKTP. ` + (criteriaDetected
        ? 'Kata terkait kriteria rujukan terbaca; konfirmasi konteksnya pada dokumen asli.'
        : 'Alasan layanan RS belum terkonfirmasi dari teks yang terbaca.'),
    };
  });
};

export const DIAGNOSIS_PPK1_COUNT = diagnosisPpk1.length;
