// ENA ESI Handbook v5 (2025), decision points A–D:
// https://d1w2w5dpazlk1u.cloudfront.net/ENA/pdf/729e51c2-2e61-4a39-ba83-441d729c71d1.pdf
export const ESI_SOURCE = 'ENA ESI Handbook v5 (2025), keputusan A–D';
export const COLOR_TRIAGE_SOURCE = 'Kemenkes: sistem triase warna; kategori mengikuti SOP RS dan konteks pelayanan';

// ATS remains a recorded scale in its own right; never convert its number to ESI.
function readRecordedAts(text) {
  const pattern=/\b(?:ATS|A[ \t]+T[ \t]+S|Australasian\s+Triage\s+Scale)[ \t]*(?:(?:kategori|category|level|skala)[ \t]*)?[:=–-]?[ \t]*(IV|III|II|V|I|[1-5])\b/gi;
  const candidates=[...text.matchAll(pattern)].filter(m=>{
    const before=text.slice(Math.max(0,m.index-45),m.index);
    const after=text.slice(m.index+m[0].length);
    return !/(?:bukan|tidak|contoh|panduan|target|pilihan)\s*[:=]?\s*$/i.test(before)
      && !/^\s*(?:[-–/]\s*[1-5]|(?:sampai|hingga)\s+[1-5])/i.test(after);
  });
  const selected=candidates.filter(m=>{
    const before=text.slice(Math.max(0,m.index-85),m.index);
    const after=text.slice(m.index+m[0].length);
    // A selection must be attached to the ATS cell, not a check elsewhere in the form.
    return /(?:[✓✔☑√]|\[[xXvV✓✔]\]|\([xXvV✓✔]\))[ \t]*(?:\|[ \t]*)?(?:\n[ \t]*)?$/.test(before)
      || /^[ \t]*(?:\|[ \t]*)?(?:[✓✔☑√]|\[[xXvV✓✔]\]|\([xXvV✓✔]\))/.test(after)
      || /(?:hasil|kategori|tingkat|prioritas)[ \t]+(?:triase|triage)[ \t]*[:=]?[ \t]*$|(?:triase|triage)[ \t]+(?:terpilih|tercatat|pasien)[ \t]*[:=]?[ \t]*$/i.test(before);
  });
  // Multiple rows without a legible selection are a template, not recorded categories.
  const unchecked=m=>/(?:☐|□|\[\s*\]|\(\s*\))[ \t|]*$/.test(text.slice(Math.max(0,m.index-15),m.index))
    || /^[ \t|]*(?:☐|□|\[\s*\]|\(\s*\))/.test(text.slice(m.index+m[0].length));
  const records=selected.length?selected:candidates.length===1 && !unchecked(candidates[0])?candidates:[];
  return { records:records.map(m=>({level:({I:1,II:2,III:3,IV:4,V:5})[m[1].toUpperCase()]||Number(m[1]),evidence:text.slice(Math.max(0,m.index-5),m.index+m[0].length+5).trim()})),unresolved:candidates.length>0 && !records.length };
}

function readLocalTriage(text) {
  const colors = [];
  const addColor = (category, evidence, index, length) => {
    const prefix = text.slice(Math.max(0, index - 35), index);
    const suffix = text.slice(index + length);
    if (/(?:bukan|tidak|contoh|pilihan|panduan)\s*$/i.test(prefix)) return;
    // A list of available form options does not identify the selected option.
    if (/^\s*[,/|–-]\s*(?:hitam|merah|kuning|hijau)\b/i.test(suffix)) return;
    colors.push({ category: category[0].toUpperCase() + category.slice(1).toLowerCase(), evidence });
  };
  // Some records put the color after the explicitly recorded ESI level:
  // "TRIASE ESI 2/MERAH". Keep this separate from plain ESI parsing so the
  // numeric level and the color remain distinct recorded fields.
  const esiColorPattern = /\b(?:triase|triage)\s+(?:ESI|E\s+S\s+I)\s*(?:(?:level|tingkat|skor|score)\s*)?[:=]?\s*(?:IV|III|II|V|I|[1-5])\s*\/\s*(hitam|merah|kuning|hijau)\b/gi;
  for (const match of text.matchAll(esiColorPattern)) addColor(match[1], match[0], match.index, match[0].length);
  const pattern = /\b(?:triase|triage|kategori\s+triase|kode\s+triase|warna\s+triase|label\s+triase)\s*(?:(?:pasien|igd|warna|kategori|kode|prioritas)\s*){0,3}[:=–-]?\s*(hitam|merah|kuning|hijau)\b/gi;
  for (const match of text.matchAll(pattern)) {
    addColor(match[1], match[0], match.index, match[0].length);
  }
  const emergencyConclusionPattern = /\b(?:kesimpulan\s+emergensi|hasil\s+(?:triase|triage))\s*[:=]?\s*(?:kategori\s+)?(hitam|merah|kuning|hijau)\b/gi;
  for (const match of text.matchAll(emergencyConclusionPattern)) {
    addColor(match[1], match[0], match.index, match[0].length);
  }
  const nonEmergency = [...text.matchAll(/\bfalse\s*[-–]?\s*emergency\b|\bnon\s*[-–]?\s*(?:emergency|emergensi|gawat\s+darurat)\b|\btidak\s+gawat\s+darurat\b/gi)]
    .filter((m) => {
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const lineBefore = text.slice(lineStart, m.index);
      const before = text.slice(Math.max(0, m.index - 90), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 45);
      if (/(?:tidak|tanpa|bukan|disangkal|negatif|belum|riwayat|rencana|edukasi|bila|jika)\b[^.;\n]{0,65}$/i.test(before)) return false;
      if (/(?:☐|□|\[\s*\]|\(\s*\)|\/)\s*$/.test(lineBefore)) return false;
      if (/\besi\s*[1-5]\b/i.test(lineBefore) && !/(?:[✓✔☑√]|\[[ \t]*[xXvV✓✔34][ \t]*\]|[34](?=[ \t]))/.test(lineBefore)) return false;
      if (/\btrue\s+emergency\b/i.test(lineBefore) && !/(?:[✓✔☑√]|\[[ \t]*[xXvV✓✔34][ \t]*\]|[34])[ \t]*$/i.test(lineBefore)) return false;
      if (/^\s*(?:\/|\(\s*\*\s*pilih\s+salah\s+satu)/i.test(after)) return false;
      return true;
    }).map((m) => m[0]);
  return { colors, nonEmergency };
}

function readRecordedEsi(text) {
  const pattern = /\b(?:ESI|E\s+S\s+I|Emergency\s+Severity\s+Index)[ \t]*(?:(?:level|tingkat|skor|score)[ \t]*)?[:=-]?[ \t]*(IV|III|II|V|I|[1-5])\b/gi;
  const candidates = [...text.matchAll(pattern)].filter((m) => {
    const before = text.slice(Math.max(0, m.index - 45), m.index);
    const after = text.slice(m.index + m[0].length);
    return !/(?:target|contoh|panduan|bukan|tidak|pilihan)\s*[:=]?\s*$/i.test(before)
      && !/^\s*(?:[-–/]\s*[1-5]|(?:sampai|hingga)\s+[1-5])/i.test(after);
  });
  const selected = candidates.filter((m) => {
    const before = text.slice(Math.max(0, m.index - 85), m.index);
    const after = text.slice(m.index + m[0].length);
    return /(?:[✓✔☑√]|\[[ \t]*[xXvV✓✔34][ \t]*\]|\([ \t]*[xXvV✓✔][ \t]*\)|(?:^|[\s|])[34])[ \t]*(?:\|[ \t]*)?(?:\n[ \t]*)?$/.test(before)
      || /^[ \t]*(?:\|[ \t]*)?(?:[✓✔☑√]|\[[ \t]*[xXvV✓✔34][ \t]*\]|\([ \t]*[xXvV✓✔][ \t]*\)|[34](?=[ \t]+\S))/.test(after)
      || /(?:hasil|kategori|tingkat|prioritas|level)[ \t]+(?:triase|triage|esi)[ \t]*[:=]?[ \t]*$|(?:triase|triage)[ \t]+(?:terpilih|tercatat|pasien)[ \t]*[:=]?[ \t]*$/i.test(before);
  });
  const unchecked = (m) => /(?:☐|□|\[\s*\]|\(\s*\))[ \t|]*$/.test(text.slice(Math.max(0, m.index - 15), m.index))
    || /^[ \t|]*(?:☐|□|\[\s*\]|\(\s*\))/.test(text.slice(m.index + m[0].length));
  const records = selected.length ? selected : candidates.length === 1 && !unchecked(candidates[0]) ? candidates : [];
  return {
    records: records.map((m) => ({ level: ({ I: 1, II: 2, III: 3, IV: 4, V: 5 })[m[1].toUpperCase()] || Number(m[1]), evidence: m[0] })),
    unresolved: candidates.length > 0 && !records.length,
  };
}

const positive = (text, pattern) => [...text.matchAll(new RegExp(pattern.source, 'gi'))].filter((m) => {
  const before = text.slice(Math.max(0, m.index - 90), m.index);
  return !/(?:tidak|tanpa|bukan|disangkal|negatif|belum|riwayat|rencana|edukasi|bila|jika)\b[^.;\n]{0,65}$/i.test(before);
}).map((m) => m[0]);

const numeric = (text, label) => {
  const values = [...text.matchAll(new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`, 'gi'))]
    .map((m) => Number(m[1].replace(',', '.')));
  return values.length && new Set(values).size === 1 ? values[0] : null;
};

// Only explicitly delimited initial assessment is eligible for inference.
// Keep line/page boundaries: later ward care must not redefine arrival acuity.
const initialSections = (text) => {
  const start = /(?:(?:^|\[halaman\s+\d+\]\s*)tri(?:ase|age)(?:\s+igd)?\b|lembar\s+tri(?:ase|age)(?:\s+igd)?|asesmen\s+awal\s+igd|penilaian\s+awal\s+igd|tri(?:ase|age)\s+igd|tri(?:ase|age)\s+(?:ESI|E\s+S\s+I)\s*(?:(?:level|tingkat|skor|score)\s*)?[:=-]?\s*(?:IV|III|II|V|I|[1-5]))/gi;
  return [...text.matchAll(start)].map((m) => {
    const tail = text.slice(m.index + m[0].length);
    const stop = tail.search(/\[halaman\s+\d+\]|\b(?:cppt|resume\s+medis|catatan\s+perkembangan|asesmen\s+rawat\s+inap|nota\s+(?:billing|farmasi)|rincian\s+biaya|akhir\s+triase)\b/i);
    return tail.slice(0, stop < 0 ? undefined : stop).trim();
  }).filter(Boolean);
};

const RESOURCES = [
  ['Laboratorium', /(?:rencana|order|perlu|pemeriksaan)\s+(?:laboratorium|lab|darah\s+lengkap|elektrolit|urinalisis)/i, 1],
  ['EKG/radiografi', /(?:rencana|order|perlu|pemeriksaan)\s+(?:ekg|ecg|rontgen|radiografi|foto\s+toraks)/i, 1],
  ['CT/MRI/USG', /(?:rencana|order|perlu|pemeriksaan)\s+(?:ct\s*(?:scan)?|mri|usg|ultrasonografi|angiografi)/i, 1],
  ['Hidrasi IV', /(?:rencana|perlu|order)\s+(?:hidrasi\s+iv|cairan\s+intravena|cairan\s+iv)/i, 1],
  ['Obat IV/IM/nebulisasi', /(?:rencana|perlu|order)\s+(?:obat\s+(?:iv|im)|nebulisasi)/i, 1],
  ['Konsultasi spesialis', /(?:rencana|perlu|order)\s+(?:konsul(?:tasi)?\s+spesialis)/i, 1],
  ['Prosedur sederhana', /(?:rencana|perlu|order)\s+(?:jahit\s+luka|penjahitan|kateter\s+urin)/i, 1],
  ['Sedasi prosedural', /(?:rencana|perlu|order)\s+sedasi\s+prosedural/i, 2],
];

export function evaluateEsiTriage(sourceText) {
  const text = String(sourceText || '').replace(/\r/g, '');
  const esi = readRecordedEsi(text);
  const recorded = esi.records;
  const levels = [...new Set(recorded.map((r) => r.level))];
  const sections = initialSections(text);
  const localTriage = readLocalTriage(text);
  const ats=readRecordedAts(text);
  const atsLevels=[...new Set(ats.records.map(r=>r.level))];
  const recordedAtsLevel=atsLevels.length===1?atsLevels[0]:null;
  const warnings = [];
  const reasons = [];
  let estimatedLevel = null;
  let resourceCount = null;
  const resources = [];
  if (sections.length === 1) {
    const initial = sections[0];
    const life = positive(initial, /henti\s+(?:jantung|napas)|cardiac\s+arrest|apnea|tanpa\s+nadi|tidak\s+teraba\s+nadi|distres\s+(?:napas|pernapasan)\s+berat|resusitasi\s+jantung\s+paru|dilakukan\s+(?:rjp|intubasi\s+emergensi|defibrilasi)|memerlukan\s+(?:rjp|intubasi\s+segera|resusitasi\s+segera)/i);
    const risk = positive(initial, /risiko\s+tinggi|high\s+risk|disorientasi\s+akut|kebingungan\s+akut|penurunan\s+kesadaran\s+akut|distres\s+berat|nyeri\s+dada\s+akut[^.;\n]{0,40}(?:curiga|suspek)\s+(?:sindrom\s+koroner\s+akut|ska|acs)|defisit\s+neurologis\s+fokal\s+akut|nyeri\s+berat\s+(?:disertai|dengan)\s+(?:distres|meringis|gelisah)/i);
    const age = numeric(initial, '(?:usia|umur)');
    const ageYears = /(?:usia|umur)\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:tahun|thn|th)\b/i.test(initial) ? age : null;
    const hr = numeric(initial, 'nadi|heart\\s*rate|hr');
    const rr = numeric(initial, 'rr|frekuensi\\s*napas|respiratory\\s*rate');
    const spo2 = numeric(initial, 'spo2|saturasi');
    const gcs = numeric(initial, 'gcs');
    const systolic = numeric(initial, '(?:td|tekanan\\s+darah)');
    const pain = numeric(initial, '(?:nrs|vas|skor\\s+nyeri)');
    const abnormalVitals = (hr !== null && hr > 100) || (rr !== null && rr > 20) || (spo2 !== null && spo2 < 92);
    if (life.length) { estimatedLevel = 1; reasons.push(...life); }
    else if (risk.length) { estimatedLevel = 2; reasons.push(...risk); }
    else {
      const excludedA = /(?:tidak|tanpa)\s+(?:memerlukan\s+|kebutuhan\s+)?(?:intervensi\s+penyelamatan\s+nyawa|tindakan\s+penyelamatan\s+nyawa|resusitasi)/i.test(initial);
      const excludedB = /(?:tidak\s+ada|tanpa|bukan)\s+(?:kondisi\s+)?risiko\s+tinggi/i.test(initial)
        && /(?:tidak\s+ada|tanpa)\s+(?:nyeri|distres)\s+berat/i.test(initial) && gcs === 15;
      const stable = /(?:hemodinamik|kondisi\s+klinis|pasien)\s+stabil/i.test(initial);
      if (ageYears === null || ageYears <= 18) warnings.push('Estimasi berbasis sumber daya memerlukan usia dewasa >18 tahun; triase anak perlu penilaian khusus.');
      if (hr === null || rr === null || spo2 === null) warnings.push('Nadi, frekuensi napas, atau SpO2 awal belum lengkap/berbeda.');
      if ((hr !== null && hr <= 0) || (rr !== null && rr <= 0) || (spo2 !== null && (spo2 <= 0 || spo2 > 100))) warnings.push('Nilai tanda vital tidak valid; periksa pembacaan OCR.');
      if ((systolic !== null && systolic < 90) || (pain !== null && pain >= 7)) warnings.push('Hipotensi atau skor nyeri tinggi memerlukan penilaian klinis sebelum estimasi berbasis sumber daya.');
      if (abnormalVitals) warnings.push('Tanda vital memerlukan penilaian ulang kegawatan; tidak otomatis dikonversi menjadi ESI 2.');
      const stated = numeric(initial, '(?:jumlah|kebutuhan)\\s+(?:jenis\\s+)?sumber\\s+daya');
      for (const [name, pattern, weight] of RESOURCES) {
        const matches = positive(initial, pattern);
        if (matches.length) { resources.push({ name, weight, evidence: matches[0] }); }
      }
      const noResources = /(?:tidak\s+memerlukan|tanpa\s+kebutuhan)\s+sumber\s+daya/i.test(initial);
      // One observed order does not prove no further resources are anticipated.
      const complete = /rencana\s+sumber\s+daya\s+lengkap/i.test(initial);
      const observed = resources.reduce((sum, r) => sum + r.weight, 0);
      resourceCount = stated !== null && Number.isInteger(stated) && stated >= 0 ? stated
        : noResources ? 0 : complete || observed >= 2 ? observed : null;
      if (resourceCount !== null && resourceCount < observed) { warnings.push('Jumlah sumber daya bertentangan dengan rencana tertulis.'); resourceCount = null; }
      if (!excludedA || !excludedB || !stable) warnings.push('Eksklusi kebutuhan penyelamatan nyawa, risiko tinggi, nyeri/distres berat, dan stabilitas awal belum lengkap.');
      if (resourceCount === null) warnings.push('Kebutuhan sumber daya belum dapat dipastikan; ketiadaan order tidak dianggap nol.');
      if (!warnings.length) {
        estimatedLevel = resourceCount >= 2 ? 3 : resourceCount === 1 ? 4 : 5;
        reasons.push(`Asesmen awal stabil, keputusan A–B disangkal eksplisit; ${resourceCount} jenis sumber daya direncanakan.`);
      }
    }
  } else if (sections.length) warnings.push('Ditemukan beberapa asesmen awal; pilih episode/waktu triase sebelum estimasi.');
  else if (ats.records.length || recorded.length || localTriage.colors.length || localTriage.nonEmergency.length) warnings.push('Estimasi ESI lokal tidak dihitung karena bagian asesmen awal tidak dapat dipisahkan dari OCR; kategori/nilai triase yang tercatat tetap dipertahankan.');
  else warnings.push('Bagian triase/asesmen awal IGD belum ditemukan; bukti selama rawat inap tidak digunakan untuk estimasi.');
  const recordedLevel = levels.length === 1 ? levels[0] : null;
  const colorValues = [...new Set(localTriage.colors.map((item) => item.category))];
  const recordedColor = colorValues.length === 1 ? colorValues[0] : null;
  const falseEmergencyRecorded = localTriage.nonEmergency.length > 0;
  const triageDocumented = ats.records.length > 0 || recorded.length > 0 || colorValues.length > 0 || falseEmergencyRecorded;
  const relevant = triageDocumented || /\bigd\b|triase|triage|gawat\s+darurat/i.test(text);
  const documentationMissing = relevant && !triageDocumented;
  const documentationAction = documentationMissing
    ? ats.unresolved ? 'Lembar/tabel triase ATS ditemukan, tetapi centang atau penanda kategorinya belum terbaca oleh OCR. Konfirmasi pilihan pada formulir asli; jangan menyatakan triase belum diisi atau meminta konversi ke ESI.' : 'Kategori triase belum ditemukan pada dokumen OCR. Periksa lembar triase asli dan lengkapi kategori ATS, warna/status kegawatdaruratan, atau nilai ESI sesuai sistem RS berdasarkan asesmen petugas triase; jangan menyalin estimasi otomatis sebagai nilai tercatat.'
    : atsLevels.length > 1 || levels.length > 1 || colorValues.length > 1 ? 'Cocokkan waktu/episode dan konfirmasi kategori triase pada lembar asli.' : null;
  if (documentationAction) warnings.push(documentationAction);
  if (atsLevels.length > 1) warnings.push(`Kategori ATS tercatat berbeda: ${atsLevels.join(', ')}; konfirmasi waktu/episode dan tanda pilihan pada lembar asli.`);
  if (ats.unresolved) warnings.push('Tabel ATS ditemukan, tetapi tanda pilihan kategorinya belum terbaca. Periksa centang/penanda pada lembar asli; daftar ATS 1–5 bukan kategori pasien.');
  if (levels.length > 1) warnings.push(`Nilai ESI tercatat berbeda: ${levels.join(', ')}; perlu verifikasi waktu/episode.`);
  if (colorValues.length > 1) warnings.push(`Warna triase berbeda: ${colorValues.join(', ')}; konfirmasi episode/waktu, jangan pilih otomatis.`);
  if (falseEmergencyRecorded) warnings.push('False emergency/non-emergency adalah istilah tercatat, bukan keputusan otomatis menolak klaim; cocokkan kondisi awal dan SOP RS.');
  const localConflict = estimatedLevel === 1 && (recordedColor === 'Hijau' || falseEmergencyRecorded);
  if (localConflict) warnings.push('Kategori ringan/non-emergency tercatat bersama bukti kebutuhan penyelamatan nyawa awal; verifikasi segera kategori dan waktu asesmen.');
  if (falseEmergencyRecorded && ['Merah', 'Hitam'].includes(recordedColor)) warnings.push('Kategori warna dan status non-emergency bertentangan; verifikasi catatan asli.');
  if (recordedColor === 'Hitam') warnings.push('Hitam hanya dibaca sebagai kategori tercatat; verifikasi kondisi/status pasien dan SOP, bukan estimasi kematian dari OCR.');
  const discrepancy = recordedLevel !== null && estimatedLevel !== null && recordedLevel !== estimatedLevel;
  if (discrepancy) warnings.push(`ESI tercatat ${recordedLevel} berbeda dengan estimasi ${estimatedLevel}; verifikasi lembar triase.`);
  const requiresReview = !triageDocumented || atsLevels.length > 1 || sections.length > 1 || levels.length > 1 || colorValues.length > 1 || localConflict || falseEmergencyRecorded || recordedColor === 'Hitam' || discrepancy;
  return { recordedAtsLevel, atsRecords:ats.records, atsSelectionUnresolved:ats.unresolved, recordedLevel, recorded, estimatedLevel, resourceCount, resources, reasons, warnings, discrepancy,
    documentationMissing, documentationAction, relevant, requiresReview, source: ESI_SOURCE,
    recordedColor, colorRecords: localTriage.colors, falseEmergencyRecorded, nonEmergencyEvidence: localTriage.nonEmergency,
    triageDocumented, localConflict, estimatedColor: estimatedLevel === 1 ? 'Merah (dugaan dari bukti penyelamatan nyawa, perlu validasi)' : null };
}

export function buildEsiMedicalCheck(text) {
  const result = evaluateEsiTriage(text);
  if (!result.relevant) return null;
  const recordedCategory = result.recordedAtsLevel !== null || result.recordedLevel !== null || result.recordedColor !== null || result.falseEmergencyRecorded;
  const unresolvedNote = result.documentationAction
    || (result.requiresReview ? 'Cocokkan catatan triase asli, waktu/episode, dan sistem triase yang digunakan RS.'
      : 'Kategori triase tercatat. Estimasi ESI lokal bukan syarat bila kategori/nilai sudah dicatat sesuai sistem RS.');
  return {
    id: 'MED-ESI', title: result.atsSelectionUnresolved && !result.triageDocumented ? 'Triase ATS — pilihan belum terbaca' : result.documentationMissing ? 'Triase belum tercantum — lengkapi kategori triase' : result.requiresReview ? 'Triase IGD — perlu konfirmasi' : 'Triase IGD — tercatat', status: result.requiresReview ? 'PERLU_VALIDASI' : 'SESUAI',
    summary: `ATS tercatat: ${result.recordedAtsLevel !== null ? `ATS ${result.recordedAtsLevel}` : result.atsRecords.length ? 'berbeda antarcatatan' : result.atsSelectionUnresolved ? 'tabel ditemukan, pilihan belum terbaca' : 'belum ditemukan'}. Triase warna: ${result.recordedColor ?? (result.colorRecords.length ? 'berbeda antarcatatan' : 'belum ditemukan')}. Status false emergency/non-emergency: ${result.falseEmergencyRecorded ? 'tercatat' : 'belum ditemukan'}. ESI tercatat: ${result.recordedLevel ?? (result.recorded.length ? 'berbeda antarcatatan' : 'belum ditemukan; tidak wajib dikonversi dari ATS/warna')}. Perkiraan skor ESI: ${result.estimatedLevel ?? 'belum dapat ditentukan dari bukti OCR'}. ${result.estimatedColor ? `Dugaan kategori: ${result.estimatedColor}. ` : ''}${unresolvedNote} Kategori triase saja tidak menentukan kelayakan klaim.`,
    evidence: [...result.atsRecords.map(r=>`ATS tercatat: ${r.evidence}`), ...result.recorded.map((r) => `Tercatat: ${r.evidence}`), ...result.colorRecords.map((r) => `Warna tercatat: ${r.evidence}`), ...result.nonEmergencyEvidence.map((value) => `Status tercatat: ${value}`), ...result.reasons, ...result.resources.map((r) => `${r.name}: ${r.evidence}`), ...result.warnings, `Acuan: ${result.source}; ${COLOR_TRIAGE_SOURCE}`],
    details: [
      { label: 'Kategori triase ATS/warna/ESI tercatat ditemukan', passed: result.triageDocumented },
      { label: 'Tidak ada konflik atau nilai triase berbeda', passed: !result.requiresReview },
      { label: 'Estimasi ESI lokal tersedia atau tidak diperlukan', passed: result.estimatedLevel !== null || recordedCategory },
      ...(result.recordedLevel !== null && result.estimatedLevel !== null
        ? [{ label: 'ESI tercatat dan estimasi sesuai', passed: !result.discrepancy }] : []),
      ...(result.localConflict ? [{ label: 'Kategori tercatat perlu dicocokkan dengan bukti penyelamatan nyawa', passed: false }] : []),
    ],
  };
}
