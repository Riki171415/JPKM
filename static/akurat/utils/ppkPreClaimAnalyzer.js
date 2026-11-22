const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const codes = (value) => String(value || '').toUpperCase().split(/[;,|\s]+/).map((item) => item.trim()).filter(Boolean);
// Trigger aturan medis harus berasal dari kode terstruktur. Teks OCR dapat berisi
// nama obat, merek alat, billing, atau boilerplate yang kebetulan sama dengan
// singkatan medis (contoh: "SURGICAL BLADE NO.23 GEA").
const diagnosisCodesFrom = (value) => codes(value)
  .map((item) => item.replace(/^[([{]+|[\])},:]+$/g, ''))
  .filter((item) => /^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?[*!+#?]?$/.test(item));
const procedureCodesFrom = (value) => codes(value)
  .map((item) => item.replace(/^[([{]+|[\])},:]+$/g, ''))
  .filter((item) => /^[0-9]{1,2}(?:\.[0-9]{1,4})?$/.test(item));
const startsWithAny = (items, prefixes) => items.some((item) => prefixes.some((prefix) => item.startsWith(prefix)));
export const isOperativeProcedureCode = (code) => {
  const major = Number(String(code || '').split('.')[0]);
  // ICD-9-CM 87-99 berisi radiologi, laboratorium, pemeriksaan, rehabilitasi,
  // obat, oksigen, transfusi, dan tindakan non-operatif lain. Keberadaan kode
  // tersebut saja tidak boleh memicu syarat kunjungan pra-operasi.
  return Number.isInteger(major) && major >= 1 && major <= 86;
};
export const normalizeCardNumber = (value) => String(value || '').replace(/\D/g, '');
export const extractOperativeProcedureCodes = (value) => procedureCodesFrom(value).filter(isOperativeProcedureCode);
const numberOrNull = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};
const parseClinicalDate = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const months = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12 };
  let match = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = text.match(/\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})\b/);
  if (match) return Date.UTC(Number(match[3]), months[match[2]] - 1, Number(match[1]));
  match = text.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return null;
};
const ctPagesFrom = (documentText) => String(documentText || '')
  .split(/(?=\[HALAMAN\s+\d+\])/i)
  .filter((page) => /(?:ct\s*(?:scan|kepala)|hcts)/i.test(page));
const ctReportDatesFrom = (documentText) => {
  const dates = [];
  ctPagesFrom(documentText).forEach((page) => {
    const datePattern = /\b(?:tanggal\s+(?:pemeriksaan|periksa)|tgl\s+(?:pemeriksaan|periksa))\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4})/gi;
    for (const match of page.matchAll(datePattern)) {
      const parsed = parseClinicalDate(match[1]);
      if (parsed !== null) dates.push(parsed);
    }
  });
  return [...new Set(dates)].sort((a, b) => a - b);
};
const claimDateFrom = (...values) => values.map(parseClinicalDate).find((value) => value !== null) ?? null;
const patientKey = (claim) => String(claim.noKartu || claim.mrn || '').replace(/\D/g, '') || normalize(claim.nama);
const cardNumber = (claim) => normalizeCardNumber(claim.noKartu);
const episodeDate = (claim) => new Date(claim.tglSep || claim.tglMasuk || 0).getTime() || 0;
const samePatientEpisodes = (claim, allClaims) => allClaims
  .filter((candidate) => candidate !== claim && patientKey(candidate) && patientKey(candidate) === patientKey(claim))
  .sort((a, b) => episodeDate(a) - episodeDate(b));

export const buildPpkPatientEpisodeIndex = (allClaims = []) => {
  const index = new Map();
  allClaims.forEach((claim) => {
    const key = patientKey(claim);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(claim);
  });
  index.forEach((episodes) => episodes.sort((a, b) => episodeDate(a) - episodeDate(b)));
  return index;
};

export const PPK_PRECLAIM_THEMES = [
  { id: 'PPK-GEA', title: 'Diare dengan volume depletion' },
  { id: 'PPK-STROKE-SEQUELAE', title: 'Konfirmasi gejala sisa stroke atau serangan baru' },
  { id: 'PPK-VENTILATOR', title: 'Ventilator berulang' },
  { id: 'PPK-DISPEPSIA', title: 'Dispepsia LOS 2 hari' },
  { id: 'PPK-INJEKSI-IA', title: 'Frekuensi injeksi intraartikular' },
  { id: 'PPK-MRI', title: 'MRI berulang' },
  { id: 'PPK-SELF-REFERRAL', title: 'Self-referral dengan LOS kunjungan pertama 1 hari' },
  { id: 'PPK-SC', title: 'Indikasi Mutlak Sectio Caesarea (SC)' },
  { id: 'PPK-PRE-OP', title: 'Kunjungan Pra-Tindakan/Pra-OP' },
];

const makeCheck = (id, status, summary, details, evidence = []) => ({
  id,
  title: PPK_PRECLAIM_THEMES.find((theme) => theme.id === id)?.title || id,
  status,
  summary,
  details,
  evidence,
  criteriaLogic: id === 'PPK-GEA'
    ? 'Aturan UR tambahan pengguna, terpisah dari indikasi rujukan KMK: tanda dehidrasi DAN terapi rehidrasi spesifik DAN satu alasan klinis berat harus terdokumentasi. Di dalam kelompok alasan klinis, cukup salah satu kondisi yang disebutkan. Daftar indikasi rujukan KMK tetap dibaca sesuai hubungan syarat per diagnosis.'
    : null,
  source: id === 'PPK-GEA'
    ? 'DIAGNOSIS PPK 1.xlsx — A09, kategori kemampuan 4A; syarat mutlak UR pengguna'
    : id === 'PPK-PRE-OP'
      ? 'Permenkes Nomor 26 Tahun 2021 — rangkaian konsultasi medis untuk persiapan operasi dihitung sebagai satu episode'
      : 'Syarat mutlak Utilization Review pengguna',
});

export const evaluatePpkPreClaimRules = ({ claim, allClaims = [], relatedClaims, documentText = '' }) => {
  const results = [];
  const diagnosisCodes = diagnosisCodesFrom(claim.diaglist);
  const procedureCodes = procedureCodesFrom(claim.proclist);
  const text = normalize(`${claim.keterangan || ''} ${claim.diaglist || ''} ${claim.proclist || ''} ${documentText}`);
  const inpatient = claim.layanan === 'Rawat Inap' || /rawat inap|ritl/.test(normalize(claim.layanan));
  const los = numberOrNull(claim.los);
  const age = numberOrNull(claim.umurTahun);
  const adult = age === null ? !/anak|pediatri|bayi|neonat/.test(text) : age >= 18;
  const related = relatedClaims || samePatientEpisodes(claim, allClaims);

  const isGea = startsWithAny(diagnosisCodes, ['A09', 'K52', 'R19.7']);
  if (isGea && inpatient && adult && los !== null && los >= 1 && los <= 3) {
    const dehydration = /dehidrasi|volume depletion|hipovolem|mata cekung|mukosa kering|turgor|oliguri|takikardi|hipotensi/.test(text);
    const specificTreatment = /rehidrasi|ringer lactat|ringer laktat|nacl|oralit|cairan intravena|infus/.test(text);
    const severeReason = /dehidrasi berat|penurunan kesadaran|nyeri perut (?:signifikan|hebat)|tidak (?:dapat|mampu|bisa) minum|gagal oral|syok hipovolem/.test(text);
    const supported = dehydration && specificTreatment && severeReason;
    results.push(makeCheck('PPK-GEA', supported ? 'KONFIRMASI' : 'TIDAK_LAYAK', supported
      ? 'GEA dewasa RI LOS 1–3 hari memiliki bukti klinis/terapi; tetap wajib konfirmasi penjaminan RJTL.'
      : 'GEA dewasa RI LOS 1–3 hari tanpa bukti lengkap dehidrasi berat dan tatalaksana spesifik diarahkan ke RJTL.', [
      { label: 'Pasien dewasa', passed: adult },
      { label: `LOS 1–3 hari (${los} hari)`, passed: true },
      { label: 'Tanda volume depletion/dehidrasi terdokumentasi', passed: dehydration },
      { label: 'Tatalaksana rehidrasi spesifik terdokumentasi', passed: specificTreatment },
      { label: 'Alasan klinis rujukan/ranap PPK-1 terdokumentasi', passed: severeReason },
    ]));
  }

  const strokeCodes = startsWithAny(diagnosisCodes, ['I60', 'I61', 'I62', 'I63', 'I64', 'I69']);
  const priorStroke = related.some((episode) => startsWithAny(diagnosisCodesFrom(episode.diaglist), ['I60', 'I61', 'I62', 'I63', 'I64', 'I69']));
  if (strokeCodes && (priorStroke || startsWithAny(diagnosisCodes, ['I69']) || /stroke lama|sequela|sekuele|hemiparese lama/.test(text))) {
    const ctPages = ctPagesFrom(documentText);
    const ctReportDates = ctReportDatesFrom(documentText);
    const episodeStart = claimDateFrom(claim.tglMasuk, claim.tglSep, claim.tanggalMasuk, claim.tanggalSep);
    const episodeEnd = claimDateFrom(claim.tglPulang, claim.tanggalPulang) ?? episodeStart;
    const hasPreviousPhrase = ctPages.some((page) => /ct[^.;]{0,80}(?:sebelum|terdahulu|lama|previous)|(?:sebelum|terdahulu|lama|previous)[^.;]{0,80}ct/i.test(page));
    const hasCurrentPhrase = ctPages.some((page) => /ct[^.;]{0,80}(?:saat ini|terbaru|sekarang|current)|(?:saat ini|terbaru|sekarang|current)[^.;]{0,80}ct/i.test(page));
    const hasPrevious = hasPreviousPhrase
      || (episodeStart !== null && ctReportDates.some((date) => date < episodeStart));
    const hasCurrent = hasCurrentPhrase
      || (episodeStart !== null && ctReportDates.some((date) => date >= episodeStart && date <= episodeEnd + 86400000));
    const lesionDifference = /(?:beda|berbeda|perubahan)[^.;]{0,80}(?:letak|lokasi|lesi)|(?:letak|lokasi|lesi)[^.;]{0,80}(?:beda|berbeda|baru)/.test(text);
    const bothCt = hasPrevious && hasCurrent && (ctReportDates.length >= 2 || (hasPreviousPhrase && hasCurrentPhrase && ctPages.length >= 2));
    const status = bothCt && lesionDifference ? 'SESUAI' : 'KONFIRMASI';
    const summary = bothCt
      ? (lesionDifference ? 'CT Scan kepala lama dan terbaru tersedia dengan perbedaan letak lesi; mendukung stroke serangan baru.' : 'CT Scan kepala lama dan terbaru tersedia, tetapi perbedaan letak lesi belum tegas; konfirmasi sequelae vs serangan baru.')
      : hasCurrent && !hasPrevious
        ? 'CT Scan kepala pada episode ini terlampir; CT Scan kepala sebelum episode belum ditemukan untuk membandingkan diagnosis sequelae dengan kemungkinan serangan baru.'
        : hasPrevious && !hasCurrent
          ? 'CT Scan kepala sebelum episode terlampir; hasil CT Scan kepala pada episode ini belum ditemukan untuk membandingkan diagnosis sequelae dengan kemungkinan serangan baru.'
          : 'CT Scan kepala sebelum episode dan saat ini belum dapat diidentifikasi sebagai dua pemeriksaan terpisah; konfirmasi sequelae vs serangan baru.';
    const strokeCheck = makeCheck('PPK-STROKE-SEQUELAE', status, summary.replace(/sequelae/g, 'gejala sisa stroke'), [
      { label: 'Hasil CT Scan kepala sebelum episode terlampir/terbaca', passed: hasPrevious },
      { label: 'Hasil CT Scan kepala pada episode ini terlampir/terbaca', passed: hasCurrent },
      { label: 'Dua hasil CT Scan kepala dapat dibandingkan', passed: bothCt },
      { label: 'Perbedaan letak lesi stroke terdokumentasi', passed: lesionDifference },
    ]);
    strokeCheck.recommendations = [
      bothCt
        ? 'Minta DPJP menjelaskan apakah keluhan merupakan gejala sisa stroke atau serangan baru, berdasarkan hasil CT dan pemeriksaan klinis.'
        : 'Periksa arsip hasil CT Scan kepala pembanding. Jika tersedia, lampirkan; jika tidak, minta DPJP menjelaskan dasar diagnosis pada resume medis.',
      'Cocokkan kode diagnosis dengan diagnosis akhir DPJP. Perubahan kode dilakukan setelah klarifikasi.',
    ];
    strokeCheck.availableEvidence = [
      hasCurrent && 'CT Scan kepala pada perawatan ini sudah teridentifikasi.',
      hasPrevious && 'CT Scan kepala sebelum perawatan ini sudah teridentifikasi.',
    ].filter(Boolean);
    strokeCheck.owner = 'DPJP dan coder / casemix';
    results.push(strokeCheck);
  }

  const ventilator = startsWithAny(procedureCodes, ['96.70', '96.71', '96.72']);
  const previousVentilator = related.filter((episode) => startsWithAny(procedureCodesFrom(episode.proclist), ['96.70', '96.71', '96.72']));
  if (ventilator && previousVentilator.length) {
    const crossCheck = normalize(claim.kroscekCA);
    const confirmed = /sesuai|acc|approve|ya|valid/.test(crossCheck) && !/tidak|belum/.test(crossCheck);
    results.push(makeCheck('PPK-VENTILATOR', confirmed ? 'SESUAI' : 'KONFIRMASI', confirmed
      ? `Ventilator berulang terdeteksi dan kolom kroscek CA menyatakan “${claim.kroscekCA}”.`
      : `Ventilator berulang terdeteksi (${previousVentilator.length + 1} episode); wajib konfirmasi sesuai kolom kroscek CA.`, [
      { label: 'Terdapat episode ventilator sebelumnya', passed: true },
      { label: 'Kolom kroscek CA tersedia', passed: Boolean(crossCheck) },
      { label: 'Kroscek CA menyatakan sesuai/ACC', passed: confirmed },
    ]));
  }

  const dyspepsia = startsWithAny(diagnosisCodes, ['K30']);
  if (dyspepsia && inpatient && adult && los === 2) {
    results.push(makeCheck('PPK-DISPEPSIA', 'TIDAK_LAYAK', 'Dispepsia dewasa rawat inap LOS 2 hari diarahkan ke penjaminan RJTL.', [
      { label: 'Diagnosis dispepsia dewasa', passed: true },
      { label: 'Rawat inap LOS tepat 2 hari', passed: true },
      { label: 'Rekomendasi penjaminan RJTL', passed: false },
    ]));
  }

  const intraArticular = startsWithAny(procedureCodes, ['81.92']);
  if (intraArticular) {
    const priorIa = related.filter((episode) => startsWithAny(procedureCodesFrom(episode.proclist), ['81.92']));
    const sequence = priorIa.filter((episode) => episodeDate(episode) <= episodeDate(claim) || !episodeDate(claim)).length + 1;
    const region = normalize(claim.regioTindakan || text.match(/(?:lutut|bahu|siku|panggul|pergelangan|ankle|knee|shoulder)(?:\s+(?:kanan|kiri|dextra|sinistra))?/)?.[0]);
    const priorRegions = new Set(priorIa.map((episode) => normalize(episode.regioTindakan)).filter(Boolean));
    const differentRegion = Boolean(region && priorRegions.size && !priorRegions.has(region));
    const status = sequence <= 5 ? 'SESUAI' : differentRegion ? 'KONFIRMASI' : 'TIDAK_LAYAK';
    results.push(makeCheck('PPK-INJEKSI-IA', status, sequence <= 5
      ? `Injeksi intraartikular ke-${sequence}: dapat dijamin (rentang ke-1 sampai ke-5).`
      : differentRegion ? `Injeksi ke-${sequence}, tetapi regio/sisi berbeda terdeteksi; konfirmasi kembali ke RS.` : `Injeksi intraartikular ke-${sequence} atau lebih: tidak layak, kecuali terbukti beda regio/sisi.`, [
      { label: `Urutan injeksi terhitung ke-${sequence}`, passed: sequence <= 5 },
      { label: 'Regio/sisi tindakan tersedia', passed: Boolean(region) },
      { label: 'Beda regio/sisi dibanding episode sebelumnya', passed: differentRegion },
    ], region ? [`Regio/sisi: ${region}`] : []));
  }

  const mri = startsWithAny(procedureCodes, ['88.91', '88.92', '88.93', '88.94', '88.95', '88.96', '88.97']);
  if (mri) {
    const priorMri = related.filter((episode) => startsWithAny(procedureCodesFrom(episode.proclist), ['88.91', '88.92', '88.93', '88.94', '88.95', '88.96', '88.97']));
    const sequence = priorMri.filter((episode) => episodeDate(episode) <= episodeDate(claim) || !episodeDate(claim)).length + 1;
    results.push(makeCheck('PPK-MRI', sequence === 1 ? 'SESUAI' : 'TIDAK_LAYAK', sequence === 1
      ? 'MRI pertama: dapat dijamin sesuai syarat UR.'
      : `MRI ke-${sequence}: tidak dijamin; beda regio bukan alasan fragmentasi dan seharusnya dilakukan dalam episode yang sama.`, [
      { label: `MRI merupakan pemeriksaan ke-1 (terhitung ke-${sequence})`, passed: sequence === 1 },
      { label: 'Tidak ada fragmentasi MRI lintas episode', passed: sequence === 1 },
    ]));
  }

  const referralText = normalize(`${claim.statusRujukan || ''} ${claim.keterangan || ''}`);
  const selfReferral = /self.?referral|rujuk diri|dirujuk oleh rs sendiri|rujukan internal antar rs/.test(referralText) || normalize(claim.statusRujukan).includes('self');
  if (selfReferral && inpatient) {
    const allEpisodes = [...related, claim].filter((episode) => episode.layanan === 'Rawat Inap').sort((a, b) => episodeDate(a) - episodeDate(b));
    const position = Math.max(0, allEpisodes.indexOf(claim)) + 1;
    const firstLos = numberOrNull(allEpisodes[0]?.los);
    const firstVisitOneDay = firstLos === 1;
    results.push(makeCheck('PPK-SELF-REFERRAL', position === 1 ? 'SESUAI' : 'TIDAK_LAYAK', position === 1
      ? 'Self-referral RI kunjungan pertama: penjaminan pada RI pertama di RS yang merujuk.'
      : `Self-referral RI kunjungan ke-${position}: tidak layak dijamin di RS perujuk; potensi kecurangan FKRTL perlu ditindaklanjuti.`, [
      { label: 'Kunjungan pertama memiliki LOS 1 hari', passed: firstVisitOneDay },
      { label: 'Episode ini adalah RI pertama', passed: position === 1 },
      { label: 'Tidak ada RI kedua hasil self-referral', passed: position === 1 },
    ], ['Acuan pengguna: PMK 16/2019 — potensi self-referral sebagai jenis kecurangan FKRTL']));
  }

  // PPK-SC dipicu oleh kode ICD O82 (Single delivery by caesarean section)
  // atau kode prosedur ICD-9-CM 74.- (operasi sesar) yang terbaca dari field
  // diaglist/proclist terstruktur. Deteksi berbasis teks (keyword "SC",
  // "sectio caesarea", dsb.) tetap dihapus karena rentan false-positive dari
  // OCR billing, riwayat anamnesis, atau singkatan laboratorium.
  const sectioCaesarea = startsWithAny(diagnosisCodes, ['O82'])
    || startsWithAny(procedureCodes, ['74.0', '74.1', '74.2', '74.4', '74.99']);
  if (sectioCaesarea) {
    // Kehadiran pemeriksaan DJJ/CTG saja bukan bukti fetal distress. Harus ada
    // diagnosis O68 atau kesimpulan klinis abnormal/compromised, dan CTG harus
    // benar-benar terdokumentasi sebagai pemeriksaan pendukung.
    const fetalDistressDocumented = startsWithAny(diagnosisCodes, ['O68'])
      || /fetal (?:distress|compromised)|gawat janin|distres janin|(?:ctg|cardiotocogra(?:f|ph))[a-z]*[^.;]{0,80}(?:abnormal|patologis|non.?reassuring)|(?:abnormal|patologis|non.?reassuring)[^.;]{0,80}(?:ctg|cardiotocogra(?:f|ph))/i.test(text);
    const ctgDocumented = /\bctg\b|cardiotocogra(?:f|ph)/i.test(text)
      || startsWithAny(procedureCodes, ['75.32']);
    const fetalDistressCtg = fetalDistressDocumented && ctgDocumented;
    const cpd = /\bdkp\b|\bcpd\b|cephalopelvic|panggul sempit|disproporsi/i.test(text) || startsWithAny(diagnosisCodes, ['O33']);
    const previaTotalis = /previa total/i.test(text) || startsWithAny(diagnosisCodes, ['O44.1']);
    const lintang = /letak lintang|transverse lie/i.test(text) || startsWithAny(diagnosisCodes, ['O32.2']);
    const induksi = /gagal induksi|failed induction/i.test(text) || startsWithAny(diagnosisCodes, ['O61']);
    const textWithoutNegativeHiv = text.replace(/(?:rapid\s+)?(?:anti[-\s]?)?hiv\s*[:=]?\s*(?:negatif|negative|non\s*reaktif|nonreactive|\bnr\b|\(-\)|-(?=\s|$))/gi, ' ');
    const hiv = /\bhiv\b|\bb20\b|immunodeficiency/i.test(textWithoutNegativeHiv) || startsWithAny(diagnosisCodes, ['B20']);
    const distosia = /distosia bahu|shoulder dystocia/i.test(text) || startsWithAny(diagnosisCodes, ['O66.0']);

    const hasAbsolute = fetalDistressCtg || cpd || previaTotalis || lintang || induksi || hiv || distosia;
    
    results.push(makeCheck('PPK-SC', hasAbsolute ? 'SESUAI' : 'KONFIRMASI', hasAbsolute
      ? 'Indikasi mutlak SC terdeteksi (sesuai kriteria sistem) pada riwayat medis/koding.'
      : 'SC terdeteksi tanpa indikasi mutlak yang jelas. Jika ini adalah indikasi relatif, maka tidak harus dilakukan persalinan dengan SC; konfirmasi urgensi.', [
      { label: 'Fetal distress dibuktikan CTG', passed: fetalDistressCtg },
      { label: 'DKP atau CPD', passed: cpd },
      { label: 'Plasenta previa totalis', passed: previaTotalis },
      { label: 'Letak lintang', passed: lintang },
      { label: 'Gagal induksi', passed: induksi },
      { label: 'Pasien HIV / B20', passed: hiv },
      { label: 'Bayi dengan distosia bahu', passed: distosia },
    ]));
  }

  const operativeProcedures = procedureCodes.filter(isOperativeProcedureCode);
  const hasOperation = sectioCaesarea || operativeProcedures.length > 0;
  if (inpatient && hasOperation && episodeDate(claim) > 0) {
    const currentCard = cardNumber(claim);
    const preOpVisits = related.filter((episode) => {
      const sameCard = currentCard && cardNumber(episode) === currentCard;
      const isRj = episode.layanan !== 'Rawat Inap' && !/rawat inap|ritl/i.test(episode.layanan);
      const isBefore = episodeDate(episode) <= episodeDate(claim);
      const within30Days = (episodeDate(claim) - episodeDate(episode)) <= 30 * 24 * 60 * 60 * 1000;
      return sameCard && isRj && isBefore && within30Days;
    });

    if (preOpVisits.length > 0) {
      const outpatientSeps = [...new Set(preOpVisits.map((episode) => String(episode.sep || '').trim()).filter(Boolean))];
      const inpatientSep = String(claim.sep || '').trim() || '-';
      const outpatientLabel = outpatientSeps.length ? outpatientSeps.join(', ') : 'nomor SEP belum tersedia';
      results.push(makeCheck('PPK-PRE-OP', 'KONFIRMASI',
        `SEP Rawat Jalan ${outpatientLabel} tidak ditagihkan terpisah karena merupakan rangkaian konsultasi/persiapan operasi untuk SEP Rawat Inap ${inpatientSep}, yang terdeteksi memiliki tindakan operatif. Pastikan surat konsultasi dokter untuk persiapan operasi terlampir.`, [
        { label: 'Nomor kartu peserta sama', passed: true },
        { label: 'Ditemukan SEP Rawat Jalan sebelum rawat inap', passed: true },
        { label: 'Episode Rawat Inap memiliki tindakan operatif', passed: true },
        { label: 'Surat konsultasi dokter untuk persiapan operasi perlu diverifikasi', passed: false },
      ], [
        `Nomor kartu: ${currentCard}`,
        `SEP Rawat Jalan: ${outpatientLabel}`,
        `SEP Rawat Inap: ${inpatientSep}`,
        ...(operativeProcedures.length ? [`Kode tindakan operatif: ${operativeProcedures.join(', ')}`] : []),
      ]));
    }
  }

  return results;
};
