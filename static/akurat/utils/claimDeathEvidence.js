const DEATH_STATUS = /^(?:4|(?:4\s*[-–.]\s*)?meninggal(?:\s+dunia)?)$/i;
const LIVE_STATUS = /^(?:[1235](?:\s*[-–.]\s*[^/|]+)?|hidup|sembuh|membaik|dirujuk|pulang\s+paksa|(?:pulang\s+)?aps|(?:pulang\s+)?atas\s+i[zj]in\s+dokter|lain[- ]lain)$/i;
const STATUS_FIELD = /\b(?:(?:cara|status|kondisi|keadaan)\s+(?:pulang|keluar)|keadaan\s+(?:saat\s+)?(?:pulang|keluar)\s+rumah\s+sakit)\s*(?:[:=][ \t]*|(?=\s+(?:[1-5](?:\s*[-–.]\s*[^/\r\n|]+)?|hidup|sembuh|membaik|dirujuk|pulang\s+paksa|aps|meninggal(?:\s+dunia)?)[ \t]*(?:$|[\r\n]))[ \t]*)([^\r\n]+?)(?=\s+(?:tanggal\s+(?:pulang|keluar)|kelas\s+perawatan|berat\s+lahir|diagnos[ai]\s+utama|los)\s*:|[\r\n]|$)/gi;
const MARKED_DEATH = /(?:[☑☒✓✔]|\[[xX✓✔]\]|\([xX✓✔]\))[ \t]*(?:4[ \t]*[-–.)]?[ \t]*)?\bmeninggal(?:\s+dunia)?\b|\bmeninggal(?:\s+dunia)?[ \t]*[:=][ \t]*(?:[☑☒✓✔]|\[[xX✓✔]\]|\([xX✓✔]\))/i;
const SELECTED_DEATH_RADIO = /[◉⦿][ \t]*(?:4[ \t]*[-–.)]?[ \t]*)?\bmeninggal(?:\s+dunia)?\b|\bmeninggal(?:\s+dunia)?[ \t]*[:=]?[ \t]*[◉⦿][ \t]*$/i;
const FILLED_DEATH_RADIO = /●[ \t]*(?:4[ \t]*[-–.)]?[ \t]*)?\bmeninggal(?:\s+dunia)?\b/i;
const CIRCLED_DEATH_CODE = /[④⓸][ \t]*[-–.)]?[ \t]*\bmeninggal(?:\s+dunia)?\b/i;
const DEATH_STATEMENT = /\b(?:pasien\s+(?:(?:telah|sudah|dinyatakan)\s+){0,2}(?:meninggal(?:\s+dunia)?|wafat)(?=\s*(?:[.,;!?]|$)|\s+(?:pada|pukul|jam|tanggal)\b)|(?:dinyatakan|telah)\s+meninggal(?:\s+dunia)?(?=\s+(?:pada|pukul|jam|tanggal)\b))/i;
const CERTIFICATE_TITLE = /\b((?:surat\s+(?:keterangan\s+)?|laporan\s+)(?:kematian|meninggal(?:\s+dunia)?)|sertifikat\s+kematian|akta\s+kematian)(?=\s*(?:[:\r\n]|\b(?:nomor|no\.?|nama)\s*[:.]?\s|$))/i;
const CERTIFICATE_DATE = /\b(?:tanggal\s+(?:kematian|meninggal)|meninggal(?:\s+dunia)?\s+(?:pada\s+)?tanggal)\s*[:=]?\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[a-z]+\s+\d{4})\b/i;
const CERTIFICATE_IDENTITY = /\b(?:nama(?:\s+(?:pasien|almarhum(?:ah)?))?|nik)\s*:\s*[\p{L}\d]/iu;
const NON_CLINICAL_HEADING = /^\s*(?:invoice|billing|nota\s+(?:farmasi|pembayaran|tagihan)|rincian\s+(?:biaya|tagihan|tarif))\b/i;
const UNCERTAIN_CONTEXT = /\b(?:jika|apabila|bila|risiko|kemungkinan|belum|tidak|disangkal|riwayat|keluarga|contoh|simulasi)\b/i;
const findAffirmativeEvidence = (lines, pattern) => {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && !UNCERTAIN_CONTEXT.test(line.slice(0, match.index))
      && !/^\s*[,.:;!?-]?\s*(?:disangkal|tidak\s+benar)\b/i.test(line.slice(match.index + match[0].length))) return match[0];
  }
  return '';
};

export const assessClaimDeathEvidence = (claim, documents = [claim.clinicalText]) => {
  const recordedStatus = [
    claim.caraPulang, claim.cara_pulang, claim.dischargeStatus,
    claim.DISCHARGE_STATUS, claim.STATUS_PULANG, claim.CARA_PULANG,
  ].map((value) => String(value ?? '').trim()).find((value) => value && value !== '-');
  const recordedDeath = DEATH_STATUS.test(recordedStatus || '');
  let hasLiveField = false;
  let certificateFound = false;
  const evidence = [];

  documents.forEach((document, docIndex) => {
    const [preamble, ...pages] = String(document || '').split(/\[halaman\s+(\d+)\]/i);
    pages.unshift('', preamble);
    for (let i = 0; i < pages.length; i += 2) {
      const [pageNumber, text] = [pages[i], pages[i + 1]];
      if (!text?.trim() || NON_CLINICAL_HEADING.test(text)) continue;
      const statuses = [...text.matchAll(STATUS_FIELD)].map(([, status]) => status.trim());
      hasLiveField ||= statuses.some((status) => LIVE_STATUS.test(status));
      const deathField = statuses.find((status) => DEATH_STATUS.test(status));
      const lines = text.split(/(?<=[.!?;])\s+|\r?\n/);
      const marked = findAffirmativeEvidence(lines, MARKED_DEATH)
        || findAffirmativeEvidence(lines, SELECTED_DEATH_RADIO)
        || (/[○◯◦]/.test(text) && findAffirmativeEvidence(lines, FILLED_DEATH_RADIO))
        || (!/[①②③⑤⓵⓶⓷⓹]/.test(text) && findAffirmativeEvidence(statuses, CIRCLED_DEATH_CODE));
      const statement = findAffirmativeEvidence(lines, DEATH_STATEMENT);
      const titleMatch = text.slice(0, 500).match(CERTIFICATE_TITLE);
      const titleContext = titleMatch && text.slice(0, titleMatch.index).split(/\r?\n/).at(-1).slice(-45);
      const certificateTitle = titleMatch && !/\b(?:lampirkan|diminta|tidak|belum|cek|daftar|contoh)\b/i.test(titleContext) && titleMatch[1];
      const certificate = certificateTitle && (statement || (CERTIFICATE_DATE.test(text) && CERTIFICATE_IDENTITY.test(text)));
      certificateFound ||= Boolean(certificate);
      const proof = certificate ? certificateTitle : marked || statement || (deathField && `Status pulang: ${deathField}`);
      if (proof) {
        const pageLabel = pageNumber ? ` Halaman ${pageNumber}` : '';
        evidence.push(`[PDF ${docIndex + 1}${pageLabel}] ${proof}`);
      }
    }
  });

  return {
    recordedStatus,
    certificateFound,
    evidence,
    shouldCheck: recordedDeath || evidence.length > 0,
    hasConflict: evidence.length > 0 && (recordedStatus ? !recordedDeath : hasLiveField),
  };
};
