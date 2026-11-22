import { listProcedureCodes } from './procedureReferenceIndex.js';

const PROCEDURE_REPORT = /\b(?:(?:laporan|lembar|catatan)\s+(?:tindakan|operasi|prosedur|hemodialisis|anestesi|transfusi|pemberian\s+obat)|laporan\s+pemeriksaan|hasil\s+pemeriksaan|operative\s+report|procedure\s+note)\b/i;
const ADMINISTRATIVE_PAGE = /\b(?:berkas klaim individual pasien|hasil grouping|lembar e[- ]?klaim|rincian (?:biaya|tagihan)|invoice|billing)\b/i;
const PERFORMED = /\b(?:dilakukan|dikerjakan|telah\s+menjalani|berhasil\s+dilakukan|was\s+performed|diperoleh|didapatkan|diambil)\b/i;
const NOT_PERFORMED = /\b(?:rencana|direncanakan|jadwal|pertimbangkan|disarankan|indikasi|akan|riwayat|belum|batal|ditunda|gagal)\b|\btidak\s+(?:jadi|dilakukan|dikerjakan|berhasil)\b/i;
const CANCELLED = /\b(?:batal|ditunda|gagal)\b|\btidak\s+(?:jadi|dilakukan|dikerjakan|berhasil)\b/i;
const SPINAL_TAP = /\b(?:(?:pungsi|punksi)\s+lumbal|lumbal\s+(?:pungsi|punksi)|lumbar\s+puncture|spinal\s+tap)\b/i;
const MYELOGRAPHIC_INJECTION = /\b(?:injeksi|suntik(?:an)?|disuntikkan|injection(?:\s+of)?)\s+(?:(?:media|zat)\s+)?(?:kontras|contrast|dye)\b[^.;\n]{0,85}\b(?:mielograf\w*|myelograph\w*|myelogram)\b|\buntuk\s+(?:mielograf\w*|myelograph\w*|myelogram)\b/i;
const SPINAL_BIOPSY = /\b(?:biopsi|biopsy|sampel jaringan)\s+(?:(?:of|pada|dari|jaringan|lesi)\s+){0,3}(?:medul{1,2}a\s+spinalis|sumsum\s+tulang\s+belakang|meninges\s+spinal|meningen\s+spinal|spinal\s+(?:cord|meninges))\b/i;

export const PROCEDURE_DESK_REFERENCE = 'Ingenix, Coders’ Desk Reference for ICD-9-CM Procedures, edisi 2010, hlm. cetak 97 (Optum 101-300.pdf, halaman PDF 1).';

const rules = {
  '03.31': {
    label: 'Pungsi lumbal',
    procedure: SPINAL_TAP,
    review: 'Cocokkan laporan tindakan yang menyatakan pungsi lumbal telah dilakukan dan verifikasi tujuannya.',
    alternative: MYELOGRAPHIC_INJECTION,
    conflict: 'Laporan menyebut pungsi untuk mielografi. Verifikasi apakah pungsi dilakukan untuk injeksi kontras sebelum mengonfirmasi kode 03.31.',
  },
  '03.32': {
    label: 'Biopsi medula spinalis atau meninges spinal',
    procedure: SPINAL_BIOPSY,
    review: 'Cocokkan bukti pengambilan jaringan dan pastikan lokasi biopsi tertulis sebagai medula spinalis atau meninges spinal.',
  },
};

function reportSections(documentTexts) {
  return documentTexts.flatMap((text, index) => {
    const [preamble, ...pages] = String(text || '').split(/\[halaman\s+(\d+)\]/i);
    pages.unshift('', preamble);
    const result = [];
    for (let i = 0; i < pages.length; i += 2) {
      const content = pages[i + 1];
      const report = content.match(PROCEDURE_REPORT);
      if (!report || report.index > 500 || ADMINISTRATIVE_PAGE.test(content.slice(0, 450))) continue;
      const page = pages[i];
      const source = `[PDF ${index + 1}${page ? ` Halaman ${page}` : ''}]`;
      const body = content.slice(report.index + report[0].length);
      body.split(/[;\r\n]+|(?<=[.!?])\s+/).forEach((clause) => {
        const text = clause.replace(/\s+/g, ' ').trim();
        if (text) result.push({ text, source });
      });
    }
    return result;
  });
}

const asPhrase = (text) => ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const toEvidence = ({ source, text }) => `${source} ${text.slice(0, 250)}`;

export function evaluateProcedureDocumentation(claim, documentTexts = [], { describeCode, referenceLookup } = {}) {
  const codes = listProcedureCodes(claim.proclist);
  if (!codes.length) return [];
  const report = reportSections(documentTexts);

  return codes.map((code) => {
    const rule = rules[code];
    const base = {
      ruleId: `AUDIT-ICD9-${code}`,
      hasSpecificRule: Boolean(rule),
      sep: String(claim.sep || ''),
      diaglist: claim.diaglist,
      proclist: claim.proclist,
      source: 'ocr-audit-coding',
    };
    if (!rule) {
      const label = String(describeCode?.(code) || '').trim();
      const labelPhrase = asPhrase(label);
      const explicitCode = new RegExp(`(?:^|[^a-z0-9.])${code.replace('.', '\\.')}(?![a-z0-9]|\\.\\d)`, 'i');
      const matchingNames = labelPhrase.length > 5 ? report.filter(({ text }) => asPhrase(text).includes(labelPhrase)) : [];
      const mentions = report.filter(({ text }) => explicitCode.test(text));
      const relatedMentions = [...matchingNames, ...mentions];
      const inconsistent = relatedMentions.some(({ text }) => NOT_PERFORMED.test(text) && CANCELLED.test(text));
      const candidate = !inconsistent && matchingNames.some(({ text }) => PERFORMED.test(text) && !NOT_PERFORMED.test(text));
      const ref = referenceLookup?.get(code)?.[0];
      const warning = inconsistent
        ? 'Laporan memuat keterangan tindakan batal, tertunda, atau gagal. Cocokkan hasil akhir tindakan sebelum mengonfirmasi kode.'
        : candidate
          ? 'Nama tindakan dan keterangan pelaksanaan terbaca. Verifikasi rincian pada laporan dan kecocokan dengan kode.'
          : matchingNames.length || mentions.length
            ? 'Nama atau kode muncul di laporan. Konfirmasi bahwa tindakan benar-benar dilakukan dan rincian mendukung kode yang dicantumkan.'
            : 'Bukti spesifik tindakan belum dapat diverifikasi. Periksa laporan asli dan cocokkan rincian tindakan dengan kode.';
      return {
        ...base,
        case: label ? `Dokumentasi ${code} · ${label}` : `Dokumentasi ${code}`,
        warning,
        reference: ref ? `Ingenix ICD-9-CM 2010 · ${ref.file}, halaman PDF ${ref.page} (hasil indeks OCR).` : '',
        evidence: [...new Set(relatedMentions.map(toEvidence))].slice(0, 4),
        needsReview: true,
        inconsistent,
        candidate,
      };
    }
    const related = report.filter(({ text }) => rule.procedure.test(text));
    const confirmed = related.filter(({ text }) => PERFORMED.test(text) && !NOT_PERFORMED.test(text));
    const confirmedPages = new Set(confirmed.map(({ source }) => source));
    const conflict = rule.alternative ? report.filter(({ text, source }) =>
      confirmedPages.has(source) && !NOT_PERFORMED.test(text) && rule.alternative.test(text)) : [];
    const inconsistent = related.some(({ text }) => NOT_PERFORMED.test(text) && CANCELLED.test(text));
    const supported = confirmed.length > 0 && !conflict.length && !inconsistent;
    const evidence = (conflict.length ? conflict : supported ? confirmed : related)
      .slice(0, 4).map(toEvidence);
    const explanation = supported ? 'Laporan memuat bukti tindakan dilakukan.'
      : conflict.length ? rule.conflict
        : inconsistent ? 'Laporan memuat keterangan tindakan batal, tertunda, atau gagal. Cocokkan hasil akhir tindakan sebelum mengonfirmasi kode.'
          : report.length ? rule.review : 'Perlu cek laporan tindakan. Bukti pelaksanaan belum dapat diverifikasi dari PDF yang terbaca.';
    return {
      ...base,
      case: `Dokumentasi ${code} · ${rule.label}`,
      warning: explanation,
      reference: PROCEDURE_DESK_REFERENCE,
      evidence,
      needsReview: !supported,
      inconsistent,
    };
  });
}
