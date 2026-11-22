const complications = [
  ['E11.0', 'Koma diabetik', 'koma'],
  ['E11.1', 'Ketoasidosis diabetik', 'ketoasidosis'],
  ['E11.2', 'Nefropati diabetik', 'nefropati|penyakit ginjal kronis|gagal ginjal kronis|ckd'],
  ['E11.3', 'Retinopati diabetik', 'retinopati'],
  ['E11.3', 'Katarak diabetik', 'katarak'],
  ['E11.4', 'Neuropati diabetik', '(?:poli)?neuropati'],
  ['E11.5', 'Komplikasi sirkulasi perifer diabetik', 'ulkus kaki|gangren|angiopati perifer'],
].map(([code, label, terms]) => ({
  code,
  label,
  linked: new RegExp(`\\b(?:${terms})\\s+(?:diabetik|diabetis|diabetic|(?:akibat|karena|terkait)\\s+(?:dm|diabetes))\\b`, 'i'),
  named: new RegExp(`^(?:${terms})\\b`, 'i'),
  mentioned: new RegExp(`\\b(?:${terms})\\b`, 'i'),
}));

const TYPE_2 = /\b(?:dm|diabetes(?:\s+melitus|\s+mellitus)?)\s*(?:(?:tipe|type)\s*(?:2|ii)|t2|2)\b|\bdmti{2}\b/i;
const NONFINAL = /\b(?:suspek|curiga|kemungkinan|dugaan|ddx?|diagnos(?:is|a)\s+banding|riwayat|disangkal|belum\s+terkonfirmasi)\b/i;
const NEGATED = /\b(?:tanpa|tidak\s+(?:ada|ditemukan|tampak|terkait|berhubungan)|bukan|non[- ]?diabetik)\b/i;
const RESUME = /(?:^|\n|^.{0,700})\s*(?:resume\s+(?:pasien\s+)?(?:medis|pulang|keluar)|ringkasan\s+(?:medis|(?:pasien\s+)?pulang)|discharge\s+summary)\b/i;
const CLAIM_SHEET = /\b(?:berkas\s+klaim\s+individual\s+pasien|hasil\s+grouping|lembar\s+e[- ]?klaim|rincian\s+(?:tagihan|biaya))\b/i;
const DIAGNOSIS_FIELD = /\bdiagnos(?:is|a)(?:\s+(?:akhir|utama|sekunder|tambahan|penyerta|komplikasi|pulang))?\s*:/gi;
const NEXT_SECTION = /(?:\b(?:terapi|tindakan|prosedur|obat(?:\s+pulang)?|pemeriksaan(?:\s+fisik|\s+penunjang)?|hasil\s+laboratorium|anamnesis|riwayat\s+penyakit|kondisi\s+pulang|rencana\s+tindak\s+lanjut)\s*:|\b(?:dokter\s+penanggung\s+jawab|dpjp|printed\s+at)\b|\b(?:bandung|jakarta|bogor|bekasi|depok|cimahi|garut|tasikmalaya|cirebon),\s+\d{1,2}\s+[a-z]+\s+\d{4}\b)/i;
const GROUPING_NOTE = 'Dampak grouping belum diuji.';

export const diabetesCodingRules = ['7', '8'].map((suffix) => ({
  id: `AUDIT-DM-E11${suffix}`,
  case: `Validasi E11.${suffix} pada diabetes tipe 2`,
  category: 'Coding Audit',
  condition: {
    type: 'grouped',
    operator: 'AND',
    groups: [{ operator: 'REGEX', codes: [`^[Ee]11\\.?${suffix}[†*+]?$`] }],
  },
  validation_action: {
    warning_message: `E11.${suffix} tercatat pada klaim. Periksa diagnosis akhir dan rincian komplikasi terkait DM di resume medis. ${GROUPING_NOTE}`,
  },
  PTD: '1/2',
}));

const findDiagnosisSections = (documents) => documents.flatMap((document, index) => {
  const [first, ...pages] = String(document?.text || '').split(/\[halaman\s+(\d+)\]/i);
  pages.unshift('', first);
  const sections = [];
  for (let i = 0; i < pages.length; i += 2) {
    const page = pages[i + 1];
    if (!RESUME.test(page) || CLAIM_SHEET.test(page.slice(0, 450))) continue;
    const fields = [...page.matchAll(DIAGNOSIS_FIELD)];
    fields.forEach((field, fieldIndex) => {
      const start = field.index + field[0].length;
      const text = page.slice(start, fields[fieldIndex + 1]?.index).split(NEXT_SECTION, 1)[0].trim();
      if (text) sections.push({ text, label: `[PDF ${index + 1}${pages[i] ? ` Halaman ${pages[i]}` : ''}]` });
    });
  }
  return sections;
});

export function evaluateDiabetesCodingAudit(claim, documents) {
  const diagnoses = String(claim.diaglist || '').toUpperCase().split(/[;,|#\s]+/).filter(Boolean);
  const triggered = diabetesCodingRules.filter((rule) => {
    const pattern = new RegExp(rule.condition.groups[0].codes[0]);
    return diagnoses.some((code) => pattern.test(code));
  });
  if (!triggered.length) return [];

  const linked = new Map();
  const diabetesEvidence = new Set();
  let uncertain = false;
  let unlinked = false;
  let withoutComplications = false;
  let unspecified = false;
  const documentsReadable = documents.length > 0 && documents.every((document) => document?.text && !document.partial);
  for (const { text, label } of findDiagnosisSections(documents)) {
    for (const clause of text.split(/\r?\n|;|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean)) {
      if (/^\((?:primary|additional|secondary|final)\s+diagnosis\)$/i.test(clause)) continue;
      const type2 = clause.match(TYPE_2);
      const describesComplication = /\bkomplikasi\b/i.test(clause) || complications.some(({ mentioned }) => mentioned.test(clause));
      const negated = NEGATED.test(clause);
      const noComplications = type2 && /\btanpa\s+komplikasi\b/i.test(clause) && !NONFINAL.test(clause);
      if (NONFINAL.test(clause) || (negated && !noComplications)) {
        uncertain ||= Boolean(type2 || describesComplication);
        continue;
      }
      const quote = `${label} ${clause.replace(/\s+/g, ' ').slice(0, 240)}`;
      if (type2) diabetesEvidence.add(quote);
      withoutComplications ||= Boolean(noComplications);
      // Follow an explicit "dengan ... dan ..." list. A comma can start a new
      // diagnosis, so later diagnoses need their own diabetic relationship.
      const direct = type2 ? clause.slice(type2.index + type2[0].length).match(/^\s+dengan\s+(?:komplikasi\s+)?(.+)/i)?.[1] : '';
      const directTerms = (direct || '').split(',')[0].split(/\s+dan\s+/i);
      const linkedHere = complications.filter(({ linked: pattern, named }) => pattern.test(clause) || directTerms.some((term) => named.test(term)));
      linkedHere.forEach((item) => linked.set(item.label, { ...item, quote }));
      const saysUnspecified = Boolean(type2 && /\bdengan\s+komplikasi\b/i.test(clause) && linkedHere.length === 0);
      unspecified ||= saysUnspecified;
      uncertain ||= Boolean(direct && !linkedHere.length && !saysUnspecified);
      unlinked ||= complications.some((item) => item.mentioned.test(clause) && !linkedHere.includes(item));
    }
  }
  const confirmed = [...linked.values()];
  const evidence = [...new Set([
    ...confirmed.map(({ quote, label }) => `${quote} (${label})`),
    ...diabetesEvidence,
  ])].slice(0, 8);
  const ambiguous = !documentsReadable || !diabetesEvidence.size || uncertain || unlinked
    || (withoutComplications && (confirmed.length > 0 || unspecified));

  return triggered.map((rule) => {
    const multiple = rule.id === 'AUDIT-DM-E117';
    const code = multiple ? 'E11.7' : 'E11.8';
    const isPrimary = diagnoses[0]?.replace(/[.†*+]/g, '') === code.replace('.', '');
    const names = confirmed.map(({ label }) => label).join(', ');
    let needsReview = true;
    let warning;
    if (!diabetesEvidence.size) {
      warning = `Perlu cek resume medis. Diagnosis akhir DM tipe 2 dan dokumentasi komplikasinya belum dapat diverifikasi untuk ${code}.`;
    } else if (ambiguous) {
      warning = `Perlu klarifikasi ${code}. Cocokkan diagnosis akhir, kelengkapan halaman, dan hubungan setiap kondisi dengan DM tipe 2.`;
    } else if (confirmed.length >= 2) {
      needsReview = !multiple || isPrimary;
      warning = multiple
        ? `Komplikasi terkait DM terbaca (${names}).${isPrimary ? ' Verifikasi apakah komplikasi multipel ditetapkan sebagai diagnosis utama tanpa satu komplikasi yang diutamakan.' : ''}`
        : `Komplikasi spesifik terbaca (${names}). Tinjau E11.8 dan pilih subkategori yang sesuai dengan dokumentasi dan posisi DU/DS.`;
    } else if (confirmed.length === 1 && !unspecified) {
      warning = `Satu komplikasi terkait DM terbaca (${names}). Tinjau ${code} dan pertimbangkan ${confirmed[0].code} bila didukung penelaahan rekam medis.`;
    } else if (unspecified) {
      warning = multiple
        ? 'Resume menyebut DM tipe 2 dengan komplikasi tanpa rincian. Klarifikasi jenis dan jumlah komplikasi sebelum mengubah E11.7.'
        : 'Resume menyebut DM tipe 2 dengan komplikasi tanpa rincian, yang dapat mendukung E11.8. Klarifikasi jenis komplikasi untuk menilai apakah tersedia kode yang lebih spesifik.';
    } else {
      warning = `${code} belum didukung bukti komplikasi pada diagnosis akhir yang terbaca. Pertimbangkan E11.9 bila penelaahan dokumen episode mengonfirmasi DM tipe 2 tanpa komplikasi.`;
    }
    return {
      ruleId: rule.id,
      case: rule.case,
      sep: String(claim.sep || ''),
      diaglist: claim.diaglist,
      proclist: claim.proclist,
      warning: `${warning} ${GROUPING_NOTE}`,
      evidence,
      needsReview,
      source: 'ocr-audit-coding',
    };
  });
}
