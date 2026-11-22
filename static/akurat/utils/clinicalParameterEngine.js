const response = await fetch(new URL('../data/jknClinicalParameterSchema.json', import.meta.url));
if (!response.ok) throw new Error('Skema klinis gagal dimuat.');
const schema = await response.json();

const schemaIndex = new Map(schema.rules.map((rule) => [rule.id, rule]));
const NON_REGEX_PREFIX = /^(?:kalkulasi|logika|ekstraksi|verifikasi|evaluasi|pemeriksaan|ada\s|tanggal\s*&|kesesuaian)/i;

const cleanPattern = (value) => String(value || '')
  .replaceAll('°', '\\s*°?')
  .replaceAll('�?', '\\s*°?')
  // Hasil OCR tabel sering memisahkan label dan nilai dengan spasi/kolom,
  // bukan tanda ':' atau '=' seperti narasi klinis.
  .replaceAll('\\s*[:=]\\s*', '\\s*(?:[:=]|[-–—])?\\s*')
  .trim();

const canonicalName = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const displayMatch = (match) => {
  const captures = match.slice(1).filter((value) => value !== undefined && value !== '');
  return captures.length ? captures.join(' | ') : match[0];
};

const extractWithPattern = (text, extraction) => {
  if (!extraction || NON_REGEX_PREFIX.test(extraction)) return [];
  try {
    const matcher = new RegExp(cleanPattern(extraction), 'gi');
    const values = [];
    for (const match of text.matchAll(matcher)) {
      const value = displayMatch(match).trim();
      if (value && !values.includes(value)) values.push(value);
      if (values.length >= 8) break;
    }
    return values;
  } catch {
    return [];
  }
};

const firstNumber = (values = []) => {
  const value = String(values[0] || '').match(/-?\d+(?:[.,]\d+)?/)?.[0];
  return value === undefined ? null : Number(value.replace(',', '.'));
};

const calculation = (name, value, result, formula, operands = []) => ({ name, value, result, source: formula, operands });

const allNumbers = (text, pattern, limit = 12) => {
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(matcher)].slice(0, limit).map((match) => Number(String(match[1]).replace(',', '.'))).filter(Number.isFinite);
};

const numberNear = (text, labels, min = -Infinity, max = Infinity) => allNumbers(text, new RegExp(`(?:${labels})\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)`, 'gi')).find((value) => value >= min && value <= max) ?? null;

const hasNonNegatedMatch = (text, pattern) => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  for (const match of String(text || '').matchAll(new RegExp(pattern.source, flags))) {
    const prefix = String(text || '').slice(Math.max(0, match.index - 45), match.index);
    if (!/(?:tanpa|tidak\s+(?:ada|terdapat|ditemukan)|disangkal|negatif)\s*(?:tanda\s*|bukti\s*)?(?:surat\s*)?$/i.test(prefix)) return true;
  }
  return false;
};

const parsedDate = (text, labels) => {
  const match = text.match(new RegExp(`(?:${labels})[^\\d]{0,30}(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{2,4})(?:[^\\d]{0,12}(\\d{1,2})[:.]?(\\d{2}))?`, 'i'));
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0));
  return Number.isNaN(date.getTime()) ? null : date;
};

const objectiveCalculations = (ruleId, text, parameters) => {
  const byName = new Map(parameters.map((parameter) => [canonicalName(parameter.name), parameter]));
  const parameter = (name) => byName.get(canonicalName(name));
  const value = (name) => firstNumber(parameter(name)?.values);
  const rawValues = (name) => parameter(name)?.values || [];
  const numericValues = (name) => (parameter(name)?.values || [])
    .map((item) => firstNumber([item]))
    .filter(Number.isFinite);
  const missing = (name, operands, formula) => calculation(name, null, `TIDAK_DAPAT_DIHITUNG: ${operands.filter((item) => item[1] === null).map((item) => item[0]).join(', ')} belum ditemukan`, formula, operands);
  const results = [];

  if (ruleId === 'JKN-PNPK-02') {
    const serial = allNumbers(text, /bilirubin\s*total\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi);
    results.push(serial.length >= 2
      ? calculation('Penurunan bilirubin', Math.round((serial[0] - serial.at(-1)) * 100) / 100, 'BERHASIL_DIHITUNG', 'Bilirubin awal - bilirubin akhir', [['awal', serial[0]], ['akhir', serial.at(-1)]])
      : missing('Penurunan bilirubin', [['bilirubin awal', serial[0] ?? null], ['bilirubin akhir', serial[1] ?? null]], 'Bilirubin awal - bilirubin akhir'));
  }

  if (ruleId === 'JKN-PNPK-04') {
    const apgar5 = value('Apgar Menit 5');
    results.push(apgar5 === null ? missing('Klasifikasi Apgar menit 5', [['Apgar menit 5', null]], 'Pemetaan nilai Apgar pada blueprint')
      : calculation('Klasifikasi Apgar menit 5', apgar5, apgar5 <= 3 ? 'P21.0_BERAT' : apgar5 <= 7 ? 'P21.1_SEDANG_RINGAN' : 'TIDAK_MEMENUHI_RENTANG_P21', '0–3 → P21.0; 4–7 → P21.1 (blueprint pengguna)', [['Apgar menit 5', apgar5]]));
  }

  if (ruleId === 'JKN-DOC-01') {
    const rupture = parsedDate(text, 'ketuban\\s+pecah|jam\\s+pecah');
    const labor = parsedDate(text, 'mulai\\s+(?:bersalin|persalinan|inpartu)|onset\\s+(?:persalinan|inpartu)');
    if (rupture && labor) {
      const hours = Math.round(((labor - rupture) / 3600000) * 10) / 10;
      results.push(calculation('Selisih ketuban pecah–persalinan', hours, hours < 24 ? 'KURANG_24_JAM' : '24_JAM_ATAU_LEBIH', 'Jam mulai persalinan - jam ketuban pecah', [['pecah', rupture.toISOString()], ['persalinan', labor.toISOString()]]));
    } else results.push(missing('Selisih ketuban pecah–persalinan', [['jam pecah', rupture], ['jam persalinan', labor]], 'Jam mulai persalinan - jam ketuban pecah'));
  }

  if (ruleId === 'JKN-DOC-02') {
    const sizeMatch = text.match(/(?:batu[^.;]{0,60})?(\d+(?:[.,]\d+)?)\s*(cm|mm)/i);
    const mm = sizeMatch ? Number(sizeMatch[1].replace(',', '.')) * (sizeMatch[2].toLowerCase() === 'cm' ? 10 : 1) : null;
    results.push(mm === null ? missing('Ukuran batu terstandardisasi', [['ukuran/satuan', null]], 'cm × 10; mm tetap') : calculation('Ukuran batu terstandardisasi', mm, mm < 20 ? 'KURANG_20_MM' : '20_MM_ATAU_LEBIH', 'Konversi ukuran terbesar ke mm', [['nilai asli', sizeMatch[0]]]));
  }

  if (ruleId === 'JKN-DOC-04') {
    const delivery = parsedDate(text, 'tanggal\\s+(?:salin|persalinan)|melahirkan');
    const admission = parsedDate(text, 'tanggal\\s+masuk|masuk\\s+(?:rs|rumah sakit)');
    results.push(delivery && admission ? calculation('Selisih persalinan–masuk RS', Math.floor((admission - delivery) / 86400000), 'BERHASIL_DIHITUNG', 'Tanggal masuk - tanggal persalinan', [['persalinan', delivery.toISOString()], ['masuk', admission.toISOString()]]) : missing('Selisih persalinan–masuk RS', [['tanggal persalinan', delivery], ['tanggal masuk', admission]], 'Tanggal masuk - tanggal persalinan'));
  }

  if (ruleId === 'JKN-DOC-06') {
    const emvMatches = [...text.matchAll(/gcs\s*(?:e([1-4])\s*m([1-6])\s*v([1-5])|e([1-4])\s*v([1-5])\s*m([1-6]))/gi)]
      .map((match) => (match[1] ? Number(match[1]) + Number(match[2]) + Number(match[3]) : Number(match[4]) + Number(match[5]) + Number(match[6])));
    const directMatches = [...text.matchAll(/gcs\s*[:=]?\s*([3-9]|1[0-5])\b/gi)].map((match) => Number(match[1]));
    const allGcs = [...emvMatches, ...directMatches].filter((val) => val >= 3 && val <= 15);
    if (allGcs.length >= 2) {
      const drop = Math.max(0, allGcs[0] - Math.min(...allGcs));
      results.push(calculation('GCS awal–terendah', drop, drop >= 2 ? 'PENURUNAN_SIGNIFIKAN' : 'BERHASIL_DIHITUNG', 'GCS awal - GCS terendah', [['GCS serial', allGcs.join(', ')]]));
    } else if (allGcs.length === 1) {
      results.push(calculation('Nilai GCS', allGcs[0], allGcs[0] < 15 ? 'PENURUNAN_KESADARAN' : 'NORMAL', 'GCS tunggal terdeteksi', [['GCS', allGcs[0]]]));
    } else {
      results.push(missing('GCS serial', [['GCS atau E/M/V', null]], 'GCS awal - GCS terendah'));
    }
  }

  if (ruleId === 'JKN-DOC-08') {
    const pao2 = numberNear(text, 'pao2|po2', 1, 800);
    let fio2 = numberNear(text, 'fio2', 0.01, 100);
    if (fio2 !== null && fio2 > 1) fio2 /= 100;
    results.push(pao2 !== null && fio2 !== null ? calculation('Rasio PaO2/FiO2', Math.round((pao2 / fio2) * 10) / 10, 'BERHASIL_DIHITUNG', 'PaO2 ÷ FiO2', [['PaO2', pao2], ['FiO2', fio2]]) : missing('Rasio PaO2/FiO2', [['PaO2', pao2], ['FiO2', fio2]], 'PaO2 ÷ FiO2'));
  }

  if (ruleId === 'JKN-DOC-12') {
    const dimensions = text.match(/(?:ukuran|dimensi|massa|tumor|lesi)?[^.;]{0,45}?(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm)\b/i);
    if (dimensions) {
      const factor = dimensions[4].toLowerCase() === 'mm' ? 0.1 : 1;
      const nums = dimensions.slice(1, 4).filter(Boolean).map((item) => Number(item.replace(',', '.')) * factor);
      const maximum = Math.max(...nums);
      results.push(calculation('Ukuran maksimum tumor', maximum, maximum > 4 ? 'DI_ATAS_4_CM' : 'TIDAK_DI_ATAS_4_CM', 'max(dimensi); mm dikonversi ke cm', [['dimensi cm', nums.join(' × ')]]));
      results.push(nums.length === 3
        ? calculation('Estimasi volume massa', Math.round(nums.reduce((a, b) => a * b, 0.52) * 100) / 100, 'BERHASIL_DIHITUNG_CM3', 'panjang × lebar × tinggi × 0,52', [['dimensi cm', nums.join(' × ')]])
        : missing('Estimasi volume massa', [['dimensi ketiga', null]], 'P × L × T × 0,52'));
    } else results.push(missing('Ukuran/volume tumor', [['dua/tiga dimensi + satuan', null]], 'max dimensi; P × L × T × 0,52'));
    const deep = /\bdeep\b|di\s*bawah\s*fas[ci]a|subfas[ci]al|intramuskular|menginfiltrasi\s*(?:otot|tendon|fas[ci]a)|jaringan\s*dalam/i.test(text);
    const vital = /pembuluh\s*darah\s*utama|saraf\s*utama|saluran\s*(?:napas|pernapasan)|(?:mengenai|infiltrasi|meluas\s*ke)[^.;]{0,35}tulang/i.test(text);
    const generalAnesthesia = /anestesi\s*umum|general\s*anesth|narkose\s*umum|\bga\b/i.test(text);
    const malignant = /maligna|malignan|malignant|ganas|sarkoma|\bc49(?:\.|\b)/i.test(text);
    const reconstruction = /skin\s*graft|\bftsg\b|\bstsg\b|flap\s*graft|rekonstruksi/i.test(text);
    const headNeck = /head\s*(?:and|&)\s*neck|kepala\s*(?:dan|&)\s*leher/i.test(text);
    const maximumResult = results.find((item) => item.name === 'Ukuran maksimum tumor');
    const sizeAndVital = maximumResult?.result === 'DI_ATAS_4_CM' && vital;
    const reasons = [generalAnesthesia && 'ANESTESI_UMUM', deep && 'DEEP', sizeAndVital && 'UKURAN_DI_ATAS_4_CM_DAN_STRUKTUR_VITAL', malignant && 'GANAS', reconstruction && 'REKONSTRUKSI', headNeck && 'HEAD_NECK'].filter(Boolean);
    results.push(calculation('Kriteria rawat inap STT', reasons.join(', ') || null, reasons.length ? 'MINIMAL_SATU_KRITERIA_DITEMUKAN' : 'TIDAK_ADA_KRITERIA_DITEMUKAN', 'OR: anestesi umum; deep; >4 cm + struktur vital; ganas; rekonstruksi; head-neck (blueprint pengguna)', [['kriteria', reasons.join(', ') || null]]));
    const biopsy = /biopsi|biopsy/i.test(text);
    const excision = /eksisi|excision|pengangkatan\s*(?:seluruh\s*)?(?:massa|tumor|lesi)/i.test(text);
    results.push(calculation('Klasifikasi tindakan STT', excision ? 'EKSISI' : biopsy ? 'BIOPSI' : null, excision && biopsy ? 'EKSISI_DENGAN_REFERENSI_BIOPSI_PERLU_CEK_KONTEKS_PA' : biopsy || excision ? 'JENIS_TINDAKAN_DITEMUKAN' : 'TIDAK_DITEMUKAN', 'Biopsi hanya dipilih bila bukti eksisi tidak ditemukan; kode akhir wajib validasi koder', [['biopsi', biopsy], ['eksisi', excision]]));
  }

  if (ruleId === 'JKN-DOC-10') {
    const right = value('Nilai TIO Kanan');
    const left = value('Nilai TIO Kiri');
    const maximum = [right, left].filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
    results.push(maximum === null ? missing('TIO maksimum', [['TIO OD/OS', null]], 'max(TIO OD, TIO OS)') : calculation('TIO maksimum', maximum, maximum > 30 ? 'DI_ATAS_30_MMHG' : 'TIDAK_DI_ATAS_30_MMHG', 'max(TIO OD, TIO OS); ambang dari blueprint pengguna', [['OD', right], ['OS', left]]));
  }

  if (ruleId === 'JKN-DOC-14') {
    const arrival = parsedDate(text, 'masuk\\s+igd|jam\\s+masuk\\s+igd|triase');
    const transfer = parsedDate(text, 'pindah\\s+(?:ranap|rawat inap|bangsal)|jam\\s+pindah');
    results.push(arrival && transfer ? calculation('Durasi observasi IGD', Math.round(((transfer - arrival) / 3600000) * 10) / 10, 'BERHASIL_DIHITUNG_JAM', 'Jam pindah ranap - jam masuk IGD', [['masuk', arrival.toISOString()], ['pindah', transfer.toISOString()]]) : missing('Durasi observasi IGD', [['jam masuk IGD', arrival], ['jam pindah ranap', transfer]], 'Jam pindah ranap - jam masuk IGD'));
  }

  if (ruleId === 'JKN-DOC-15') {
    const bilirubin = numberNear(text, 'bilirubin\\s+(?:total)?', 0, 100);
    const cbdStone = /batu[^.;]{0,50}(?:cbd|duktus\s+koledokus)|(?:cbd|duktus\s+koledokus)[^.;]{0,50}batu/i.test(text);
    results.push(calculation('Bukti objektif obstruksi bilier', bilirubin, cbdStone || (bilirubin !== null && bilirubin > 2) ? 'TERPICU' : bilirubin === null ? 'TIDAK_DAPAT_DINILAI_LENGKAP' : 'TIDAK_TERPICU', 'Batu CBD ATAU bilirubin total >2 mg/dL (ambang blueprint pengguna)', [['batu CBD', cbdStone], ['bilirubin', bilirubin]]));
  }

  if (ruleId === 'JKN-PNPK-03') {
    const onset = parsedDate(text, 'onset\\s+(?:stroke|gejala)|last\\s+known\\s+well|lkw');
    const admission = parsedDate(text, 'tanggal\\s+masuk|masuk\\s+(?:rs|igd|rumah sakit)');
    results.push(onset && admission ? calculation('Selisih onset–masuk RS', Math.round(((admission - onset) / 3600000) * 10) / 10, 'BERHASIL_DIHITUNG_JAM', 'Jam masuk RS - last known well/onset', [['onset', onset.toISOString()], ['masuk', admission.toISOString()]]) : missing('Selisih onset–masuk RS', [['onset/LKW', onset], ['jam masuk', admission]], 'Jam masuk RS - last known well/onset'));
  }

  if (ruleId === 'JKN-DOC-03') {
    const gradeText = text.match(/(?:hemoroid[^.;]{0,30})?(?:grade|derajat)\s*(iv|iii|ii|i|[1-4])/i)?.[1]?.toUpperCase();
    const grades = { I: 1, II: 2, III: 3, IV: 4 };
    const grade = gradeText ? grades[gradeText] || Number(gradeText) : null;
    results.push(grade === null ? missing('Konversi grade hemoroid', [['grade', null]], 'Romawi/angka → 1–4') : calculation('Konversi grade hemoroid', grade, 'BERHASIL_DIKONVERSI', 'Romawi/angka → 1–4', [['teks', gradeText]]));
  }

  if (ruleId === 'JKN-PNPK-05') {
    const tbsa = numberNear(text, 'tbsa|luas\\s+luka\\s+bakar', 0, 100);
    const weight = numberNear(text, 'bb|berat\\s+badan', 0.2, 400);
    results.push(tbsa !== null && weight !== null ? calculation('Kebutuhan cairan Parkland 24 jam', Math.round(4 * weight * tbsa), 'BERHASIL_DIHITUNG_ML', '4 mL × kgBB × %TBSA', [['BB kg', weight], ['TBSA %', tbsa]]) : missing('Kebutuhan cairan Parkland 24 jam', [['BB', weight], ['TBSA', tbsa]], '4 mL × kgBB × %TBSA'));
  }

  if (ruleId === 'JKN-PNPK-06') {
    const weight = numberNear(text, 'bb|berat\\s+badan', 1, 400);
    let height = numberNear(text, 'tb|tinggi\\s+badan', 0.3, 250);
    if (height !== null && height > 3) height /= 100;
    results.push(weight !== null && height !== null ? calculation('IMT hasil kalkulasi', Math.round((weight / (height ** 2)) * 100) / 100, 'BERHASIL_DIHITUNG_KG_M2', 'BB kg ÷ (TB meter)²', [['BB kg', weight], ['TB m', height]]) : missing('IMT hasil kalkulasi', [['BB', weight], ['TB', height]], 'BB kg ÷ (TB meter)²'));
    const usual = numberNear(text, 'bb\\s+(?:biasa|sebelum|awal)', 1, 400);
    const current = numberNear(text, 'bb\\s+(?:sekarang|saat ini|aktual)', 1, 400);
    results.push(usual !== null && current !== null && usual > 0 ? calculation('Penurunan berat badan', Math.round((((usual - current) / usual) * 100) * 10) / 10, 'BERHASIL_DIHITUNG_PERSEN', '(BB biasa - BB sekarang) ÷ BB biasa × 100%', [['BB biasa', usual], ['BB sekarang', current]]) : missing('Penurunan berat badan', [['BB biasa', usual], ['BB sekarang', current]], '(BB biasa - BB sekarang) ÷ BB biasa × 100%'));
  }

  if (ruleId === 'JKN-PNPK-08') {
    const troponins = allNumbers(text, /(?:hs[-\s]?ctn\s*[ti]?|troponin\s*[ti]?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi);
    results.push(troponins.length >= 2 ? calculation('Perubahan troponin serial', Math.round((troponins.at(-1) - troponins[0]) * 1000) / 1000, troponins.at(-1) === troponins[0] ? 'TIDAK_ADA_PERUBAHAN_NUMERIK' : 'ADA_PERUBAHAN_NUMERIK', 'Troponin akhir - troponin awal; signifikansi mengikuti nilai rujukan laboratorium', [['serial', troponins.join(', ')]]) : missing('Perubahan troponin serial', [['minimal dua troponin', troponins.length >= 2 ? troponins : null]], 'Troponin akhir - troponin awal'));
  }

  if (ruleId === 'JKN-BA-20') {
    const obstetric = /abortus|sisa\s+(?:konsepsi|plasenta)|retained\s+product/i.test(text);
    const gynecology = /perdarahan\s+(?:uterus|disfungsional)|hiperplasia\s+endometrium|neoplasma/i.test(text);
    const aspiration = /kuret\s+(?:isap|aspirasi)|aspirasi\s+vakum|vacuum\s+aspiration/i.test(text);
    results.push(calculation('Pemetaan rumpun tindakan kuretase', aspiration ? '69.51/69.52' : obstetric ? '69.02' : gynecology ? '69.09' : null, aspiration ? 'ASPIRASI_TERDETEKSI' : obstetric ? 'RUMPUN_OBSTETRI_TERDETEKSI' : gynecology ? 'RUMPUN_GINEKOLOGI_TERDETEKSI' : 'TIDAK_DAPAT_DIPETAKAN', 'Pemetaan teks diagnosis/laporan operasi sesuai blueprint; kode akhir wajib validasi koder', [['obstetri', obstetric], ['ginekologi', gynecology], ['aspirasi', aspiration]]));
  }

  if (ruleId === 'JKN-PNPK-09') {
    const baseline = value('Kreatinin Serum Awal') ?? numberNear(text, 'kreatinin\\s+(?:baseline|awal)', 0.01, 30);
    const peak = value('Kreatinin Serum Peak') ?? numberNear(text, 'kreatinin\\s+(?:peak|puncak|tertinggi)', 0.01, 30);
    results.push(baseline !== null && peak !== null && baseline > 0 ? calculation('Rasio kreatinin peak/baseline', Math.round((peak / baseline) * 100) / 100, 'BERHASIL_DIHITUNG', 'Kreatinin peak ÷ baseline', [['baseline', baseline], ['peak', peak]]) : missing('Rasio kreatinin peak/baseline', [['baseline', baseline], ['peak', peak]], 'Kreatinin peak ÷ baseline'));
  }

  if (ruleId === 'JKN-PNPK-10') {
    const fpg = value('GDP / Glukosa Darah Puasa');
    const pp2 = value('GD2PP / Glukosa 2 Jam PP');
    const randomSeries = numericValues('GDS dengan Gejala / Glukosa Darah Sewaktu');
    const random = randomSeries.length ? Math.max(...randomSeries) : null;
    const a1c = value('HbA1c / Glycated Hemoglobin');
    const acr = value('Rasio ACR Urine / Albumin-to-Creatinine');
    const classicSymptoms = /poliuria|polidipsia|polifagia|penurunan\s+(?:berat\s+badan|bb)/i.test(text);
    const a1cExclusion = /anemia\s+sel\s+sabit|kehamilan|hemodialisis|perdarahan\s+akut|transfusi[^.;]{0,50}(?:baru|terkini)|eritropoetin/i.test(text);
    results.push(calculation('Klasifikasi GDP', fpg, fpg === null ? 'TIDAK_DAPAT_DINILAI' : fpg >= 126 ? 'RENTANG_DIABETES' : fpg >= 100 ? 'RENTANG_PREDIABETES' : 'DI_BAWAH_RENTANG', 'Ambang blueprint v4; diagnosis akhir memerlukan PNPK dan konteks pemeriksaan', [['GDP', fpg]]));
    results.push(calculation('Klasifikasi GD2PP', pp2, pp2 === null ? 'TIDAK_DAPAT_DINILAI' : pp2 >= 200 ? 'RENTANG_DIABETES' : pp2 >= 140 ? 'RENTANG_PREDIABETES' : 'DI_BAWAH_RENTANG', 'Ambang blueprint v4', [['GD2PP', pp2]]));
    results.push(calculation('GDS dan gejala klasik', random, random === null ? 'TIDAK_DAPAT_DINILAI' : random >= 200 && classicSymptoms ? 'RENTANG_DENGAN_GEJALA_KLASIK' : random >= 200 ? 'NILAI_TINGGI_TANPA_BUKTI_GEJALA' : 'DI_BAWAH_RENTANG', 'GDS maksimum terdokumentasi ≥200 + gejala klasik pada blueprint v4', [['serial GDS', randomSeries.join(', ') || null], ['GDS maksimum', random], ['gejala klasik', classicSymptoms]]));
    results.push(calculation('Klasifikasi HbA1c', a1c, a1c === null ? 'TIDAK_DAPAT_DINILAI' : a1cExclusion ? 'HASIL_BERPOTENSI_TIDAK_VALID' : a1c >= 6.5 ? 'RENTANG_DIABETES' : a1c >= 5.7 ? 'RENTANG_PREDIABETES' : 'DI_BAWAH_RENTANG', 'Ambang dan pengecualian blueprint v4', [['HbA1c', a1c], ['eksklusi', a1cExclusion]]));
    results.push(calculation('Kategori ACR', acr, acr === null ? 'TIDAK_DAPAT_DINILAI' : acr >= 300 ? 'A3_300_ATAU_LEBIH' : acr >= 30 ? 'A2_30_SAMPAI_299' : 'A1_DI_BAWAH_30', 'Kategorisasi numerik ACR; keputusan terapi tetap validasi klinis', [['ACR', acr]]));
  }

  if (ruleId === 'JKN-PNPK-11') {
    const afp = value('AFP / Alpha-Fetoprotein');
    const pivka = value('PIVKA-II / Des-g-Carboxy-Prothrombin');
    results.push(calculation('Kombinasi AFP/PIVKA-II', `${afp ?? '-'} / ${pivka ?? '-'}`, afp === null && pivka === null ? 'TIDAK_DAPAT_DINILAI' : afp !== null && pivka !== null && afp >= 10 && pivka >= 40 ? 'KEDUANYA_MENCAPAI_AMBANG_BLUEPRINT' : 'BELUM_KEDUANYA_MENCAPAI_AMBANG', 'AFP ≥10 dan PIVKA-II ≥40 sesuai blueprint v4; bukan penentu diagnosis tunggal', [['AFP', afp], ['PIVKA-II', pivka]]));
    const arterial = /arterial[^.;]{0,50}(?:hyperenhancement|hipervaskular)|hipervaskular[^.;]{0,50}fase\s+arteri/i.test(text);
    const washout = /washout|pelunturan[^.;]{0,40}(?:porta|delayed|lambat)/i.test(text);
    results.push(calculation('Pola radiologi tiga fase', null, arterial && washout ? 'ARTERIAL_ENHANCEMENT_DAN_WASHOUT_DITEMUKAN' : arterial || washout ? 'BUKTI_RADIOLOGI_SEBAGIAN' : 'TIDAK_DITEMUKAN', 'Korelasi dua temuan teks radiologi; interpretasi radiolog tetap utama', [['arterial enhancement', arterial], ['washout', washout]]));
  }

  if (ruleId === 'JKN-DOC-21') {
    const tioValues = numericValues('Tekanan Intraokular TIO');
    const tioMin = tioValues.length ? Math.min(...tioValues) : null;
    const tioMax = tioValues.length ? Math.max(...tioValues) : null;
    const hypotony = tioMin !== null && tioMin < 6;
    const ocularHypertension = tioMax !== null && tioMax > 21;
    results.push(calculation('Rentang TIO terdokumentasi', tioValues.join(', ') || null, !tioValues.length ? 'TIDAK_DITEMUKAN' : hypotony && ocularHypertension ? 'HIPOTONI_DAN_HIPERTENSI_OKULAR_TEREKAM' : hypotony ? 'HIPOTONI_BERAT_DI_BAWAH_6' : ocularHypertension ? 'DI_ATAS_21_MMHG' : 'RENTANG_6_SAMPAI_21_MMHG', 'min/max TIO terdokumentasi; lateralisasi tetap diperiksa pada teks sumber', [['serial TIO', tioValues.join(', ') || null], ['minimum', tioMin], ['maksimum', tioMax]]));

    const indicationValues = rawValues('Indikasi Utama Bedah Vitreoretinal');
    const contextualPcr = /(?:operasi|fakoemulsifikasi|phaco|katarak|kapsul)[^.;]{0,100}\bpcr\b|\bpcr\b[^.;]{0,100}(?:ruptur|kapsul|vitrektomi\s*anterior)/i.test(text);
    const labPcrOnly = /(?:swab|sars|covid|spesimen|laboratorium)[^.;]{0,60}\bpcr\b/i.test(text) && !contextualPcr;
    const indications = [...indicationValues, ...(contextualPcr ? ['PCR dalam konteks operasi/kapsul posterior'] : [])];
    results.push(calculation('Indikasi utama vitrektomi', indications.join(', ') || null, indications.length ? 'INDIKASI_TEREKSTRAK_PERLU_KORELASI_LAPORAN_OPERASI' : labPcrOnly ? 'PCR_LAB_DIABAIKAN_BUKAN_INDIKASI' : 'INDIKASI_TIDAK_DITEMUKAN', 'Daftar indikasi blueprint; PCR harus mempunyai konteks operasi/kapsul posterior', [['indikasi', indications.join(', ') || null], ['PCR laboratorium saja', labPcrOnly]]));

    const durationMonths = rawValues('Durasi Gejala Vitreoretinal').map((item) => {
      const amount = firstNumber([item]);
      if (amount === null) return null;
      if (/hari/i.test(item)) return amount / 30;
      if (/minggu/i.test(item)) return amount / 4.345;
      return amount;
    }).filter(Number.isFinite);
    const vitreousHemorrhage = /perdarahan\s*vitreus|vitreous\s*h(?:a?e)?morrhage/i.test(text);
    const emergency = /\bcito\b|emergen|gawat|endoftalmitis|ablasio\s*retina|retinal\s*detachment|ruptur\s*kapsul\s*posterior/i.test(text) || contextualPcr;
    const persistent = /menetap|persisten|tidak\s*(?:ada\s*)?(?:resorpsi|terserap)|belum\s*(?:resorpsi|terserap)/i.test(text);
    const duration = durationMonths.length ? Math.max(...durationMonths) : null;
    const durationResult = !vitreousHemorrhage || emergency ? 'TIDAK_BERLAKU_KHUSUS_NON_CITO_PERDARAHAN_VITREUS' : duration === null ? 'DURASI_BELUM_DITEMUKAN' : duration > 6 ? 'DI_ATAS_6_BULAN_PERLU_VALIDASI' : persistent ? 'MAKSIMAL_6_BULAN_DAN_PERSISTENSI_TEREKAM' : 'DURASI_MEMENUHI_PERSISTENSI_BELUM_TEREKAM';
    results.push(calculation('Durasi perdarahan vitreus non-cito', duration === null ? null : Math.round(duration * 100) / 100, durationResult, 'Konversi hari/minggu/bulan; ambang maksimal 6 bulan sesuai blueprint pengguna', [['perdarahan vitreus', vitreousHemorrhage], ['cito/pengecualian', emergency], ['durasi bulan', duration], ['menetap/tidak resorpsi', persistent]]));

    const tamponade = /silicone\s*oil|minyak\s*silikon|\bc3f8\b|\bsf6\b|tamponade/i.test(text);
    const peeling = /peeling\s*(?:membran|ilm)|ilm\s*peeling|epiretinal\s*membrane/i.test(text);
    const scleral = /scleral\s*buckl(?:e|ing)|sabuk\s*sklera|cerclage/i.test(text);
    const anterior = /anterior\s*approach|vitrektomi\s*anterior|anterior\s*vitrectomy/i.test(text);
    const posterior = /posterior\s*approach|vitrektomi\s*posterior|posterior\s*vitrectomy|pars\s*plana\s*vitrectomy|\bppv\b/i.test(text);
    const candidates = [tamponade && '14.75—tamponade', peeling && '14.9—peeling membran', scleral && '14.41/14.49—scleral buckling', anterior && '14.73—pendekatan anterior', posterior && '14.74—pendekatan posterior/PPV'].filter(Boolean);
    results.push(calculation('Kandidat validasi kode prosedur vitreoretinal', candidates.join(', ') || null, candidates.length ? 'BUKTI_TINDAKAN_DITEMUKAN_VALIDASI_KODER_WAJIB' : 'TINDAKAN_SPESIFIK_BELUM_DITEMUKAN', 'Pemetaan kandidat dari blueprint pengguna; tidak mengubah kode klaim otomatis', [['tamponade', tamponade], ['peeling', peeling], ['scleral buckling', scleral], ['anterior', anterior], ['posterior/PPV', posterior]]));

    const complications = rawValues('Komplikasi Okular Pascaprosedur');
    results.push(calculation('Komplikasi okular pascaprosedur', complications.join(', ') || null, complications.length ? 'KOMPLIKASI_TEREKSTRAK_PERLU_KORELASI_TANGGAL' : 'TIDAK_DITEMUKAN', 'Komplikasi harus dibedakan dari indikasi pra-operasi', [['komplikasi', complications.join(', ') || null]]));
  }

  if (ruleId === 'JKN-DOC-20') {
    const necrosis = /nekrosis\s+pulpa/i.test(text);
    const irreversible = /pulpitis\s+irreversibel/i.test(text);
    const vitalityNegative = /(?:tes\s+vitalitas|tes\s+termal|ept)[^.;]{0,30}negatif/i.test(text);
    const rootCanal = /(?:23\.70|perawatan\s+saluran\s+akar|pulpektomi)/i.test(text);
    const radiology = /radiografi\s+periapikal|rontgen\s+(?:gigi|periapikal)|radiolusensi\s+periapikal/i.test(text);
    results.push(calculation('Konsistensi PSA', null, rootCanal && (necrosis || irreversible) && (vitalityNegative || radiology) ? 'BUKTI_KLINIS_DAN_TINDAKAN_KONSISTEN' : rootCanal ? 'TINDAKAN_DITEMUKAN_BUKTI_KLINIS_BELUM_LENGKAP' : 'TINDAKAN_PSA_TIDAK_DITEMUKAN', 'Cross-check diagnosis pulpa, vitalitas/radiografi, dan tindakan; bukan pengganti penilaian dokter gigi', [['nekrosis/irreversibel', necrosis || irreversible], ['vitalitas negatif', vitalityNegative], ['radiografi', radiology], ['PSA', rootCanal]]));
  }

  if (ruleId === 'JKN-DOC-22') {
    const plateletSeries = numericValues('Trombosit Dengue Serial').map((item) => (item > 0 && item <= 1000 ? item * 1000 : item));
    const plateletMin = plateletSeries.length ? Math.min(...plateletSeries) : null;
    const hematocritSeries = numericValues('Hematokrit Dengue Serial');
    const hematocritBaseline = hematocritSeries[0] ?? null;
    const hematocritPeak = hematocritSeries.length ? Math.max(...hematocritSeries) : null;
    const hematocritRise = hematocritBaseline > 0 && hematocritPeak !== null ? Math.round((((hematocritPeak - hematocritBaseline) / hematocritBaseline) * 100) * 10) / 10 : null;
    const leakageText = hasNonNegatedMatch(text, /efusi\s*pleura|pleural\s*effusion|asites|ascites|hemokonsentrasi|haemoconcentration|plasma\s*leak(?:age)?|hipoproteinemia|hipoalbuminemia/i);
    const leakage = leakageText || (hematocritRise !== null && hematocritRise >= 20);
    const bleeding = hasNonNegatedMatch(text, /hematemesis|melena|epistaksis|gusi\s*berdarah|hematuria|perdarahan\s*(?:aktif|hebat|masif)|severe\s*bleeding/i);
    const shock = hasNonNegatedMatch(text, /dengue\s*shock\s*syndrome|\bdss\b|syok|shock|hipotensi/i);
    const organ = hasNonNegatedMatch(text, /gagal\s*organ|gangguan\s*organ|respiratory\s*distress|ensefalopati|hepatitis\s*berat/i);
    const severeBleeding = hasNonNegatedMatch(text, /perdarahan\s*(?:hebat|masif)|severe\s*bleeding/i) || (bleeding && shock);
    const confirmed = /\bns\s*1\b[^.;]{0,25}(?:positif|reaktif)|dengue\s*(?:igm|pcr)[^.;]{0,25}(?:positif|reaktif)|(?:positif|reaktif)[^.;]{0,25}(?:\bns\s*1\b|dengue\s*(?:igm|pcr))/i.test(text);
    const a90 = /\bA90\b/i.test(text);
    const a91 = /\bA91\b/i.test(text);
    const d696 = /\bD69\.6\b/i.test(text);
    results.push(calculation('Serial trombosit dengue', plateletMin, plateletMin === null ? 'TIDAK_DITEMUKAN' : plateletMin < 100000 ? 'TROMBOSITOPENIA_TEREKAM' : 'TIDAK_DI_BAWAH_100000', 'Nilai <=1000 diasumsikan dalam satuan 10^3/µL; satuan sumber tetap wajib diperiksa', [['serial /µL', plateletSeries.join(', ') || null], ['minimum /µL', plateletMin]]));
    results.push(calculation('Kenaikan hematokrit dengue', hematocritRise, hematocritRise === null ? 'TIDAK_DAPAT_DIHITUNG' : hematocritRise >= 20 ? 'KENAIKAN_20_PERSEN_ATAU_LEBIH' : 'DI_BAWAH_20_PERSEN', '(Hct puncak - Hct awal) ÷ Hct awal × 100%; baseline klinis harus diverifikasi', [['serial Hct', hematocritSeries.join(', ') || null], ['awal', hematocritBaseline], ['puncak', hematocritPeak]]));
    results.push(calculation('Klasifikasi bukti dengue', null, leakage || shock || organ || severeBleeding ? 'BUKTI_DHF_ATAU_SEVERE_DENGUE_DITEMUKAN' : confirmed ? 'BUKTI_INFEKSI_DENGUE_TANPA_LEAKAGE_TEREKAM' : 'BUKTI_BELUM_CUKUP', 'Pemisahan diagnosis individual A90/A91 berdasarkan bukti klinis; bukan penetapan KLB', [['konfirmasi dengue', confirmed], ['kebocoran plasma', leakage], ['perdarahan', bleeding], ['perdarahan berat', severeBleeding], ['syok', shock], ['gangguan organ', organ]]));
    results.push(calculation('Konsistensi kode dengue', `${a90 ? 'A90 ' : ''}${a91 ? 'A91 ' : ''}${d696 ? 'D69.6' : ''}`.trim() || null, a90 && a91 ? 'A90_DAN_A91_BERSAMA_PERLU_KOREKSI' : a91 && d696 ? 'A91_DAN_D69_6_DUPLIKASI_MENURUT_BLUEPRINT_AUDIT' : a91 && !leakage && !shock && !organ && !severeBleeding ? 'A91_BELUM_DIDUKUNG_BUKTI_UTAMA' : a90 && (leakage || shock || organ || severeBleeding) ? 'A90_TIDAK_KONSISTEN_DENGAN_BUKTI_BERAT' : 'TIDAK_ADA_KONFLIK_UTAMA_TEREKAM', 'Skrining konsistensi; kode akhir ditetapkan koder/dokter', [['A90', a90], ['A91', a91], ['D69.6', d696]]));
    const plateletTransfusion = /transfusi\s*trombosit|platelet\s*transfusion|\bTC\b[^.;]{0,30}transfusi/i.test(text);
    const userThreshold = plateletMin !== null && ((plateletMin < 50000 && bleeding) || plateletMin < 20000);
    results.push(calculation('Konteks transfusi trombosit dengue', plateletMin, !plateletTransfusion ? 'TRANSFUSI_TIDAK_TEREKAM' : userThreshold ? 'AMBANG_BLUEPRINT_PENGGUNA_TERPICU_VALIDASI_WHO_TETAP_WAJIB' : 'TRANSFUSI_TEREKAM_TANPA_AMBANG_BLUEPRINT', 'Ambang pengguna: <50.000 + perdarahan atau <20.000; WHO menyatakan bukti profilaksis platelet terbatas', [['minimum trombosit', plateletMin], ['perdarahan', bleeding], ['transfusi', plateletTransfusion]]));
  }

  if (ruleId === 'JKN-DOC-23') {
    const widalO = numericValues('Widal O Titer');
    const widalH = numericValues('Widal H Titer');
    const oMin = widalO.length ? Math.min(...widalO) : null;
    const oMax = widalO.length ? Math.max(...widalO) : null;
    const fourfold = oMin > 0 && oMax / oMin >= 4;
    const culturePositive = /(?:kultur\s*(?:darah|feses)|blood\s*culture)[^.;]{0,80}(?:salmonella\s*(?:typhi|paratyphi)|positif|positive)/i.test(text);
    const tubexPositive = /tubex[^.;]{0,30}(?:positif|reaktif|\b[4-9]\b)/i.test(text);
    const widalSupport = oMax !== null && (oMax >= 320 || fourfold);
    results.push(calculation('Bukti laboratorium tifoid', null, culturePositive ? 'KULTUR_POSITIF' : tubexPositive ? 'TUBEX_MENDUKUNG' : widalSupport ? 'WIDAL_MEMENUHI_BLUEPRINT_TETAPI_TIDAK_BOLEH_TUNGGAL' : widalO.length || widalH.length ? 'WIDAL_TEREKSTRAK_BELUM_MEMENUHI_BLUEPRINT' : 'BUKTI_LAB_TIDAK_DITEMUKAN', 'Kultur diprioritaskan; Widal tunggal memiliki keterbatasan', [['kultur positif', culturePositive], ['Tubex mendukung', tubexPositive], ['Widal O serial', widalO.join(', ') || null], ['Widal H serial', widalH.join(', ') || null], ['kenaikan O >=4 kali', fourfold]]));
    const intake = /intake\s*sulit|sulit\s*(?:makan|minum)|tidak\s*bisa\s*(?:makan|minum)|asupan\s*tidak\s*adekuat/i.test(text);
    const vomiting = /muntah\s*(?:terus|persisten|berulang|berlebihan|profus)|mual[^.;]{0,30}muntah/i.test(text);
    const consciousness = /delirium|somnolen|penurunan\s*kesadaran|gcs\s*[:=]?\s*(?:[3-9]|1[0-4])\b/i.test(text);
    const temperatures = numericValues('Suhu Hiperpireksia Tifoid');
    const maxTemperature = temperatures.length ? Math.max(...temperatures) : null;
    const hyperpyrexia = maxTemperature !== null && maxTemperature >= 40;
    const admissionReasons = [intake && 'INTAKE_SULIT', vomiting && 'MUNTAH_BERLEBIHAN', consciousness && 'PENURUNAN_KESADARAN', hyperpyrexia && 'HIPERPIREKSIA'].filter(Boolean);
    results.push(calculation('Alasan rawat inap tifoid', admissionReasons.join(', ') || null, admissionReasons.length ? 'MINIMAL_SATU_KRITERIA_BLUEPRINT_DITEMUKAN' : 'KRITERIA_BLUEPRINT_BELUM_DITEMUKAN', 'OR empat kriteria rawat inap dari blueprint pengguna; keputusan klinis tetap DPJP', [['intake sulit', intake], ['muntah berlebihan', vomiting], ['penurunan kesadaran', consciousness], ['suhu maksimum', maxTemperature]]));
    const a01 = /\bA01(?:\.\d)?\b/i.test(text);
    const a09 = /\bA09\b/i.test(text);
    const a020 = /\bA02\.0\b/i.test(text);
    const pregnant = /hamil|kehamilan|gravid|trimester/i.test(text);
    const o988 = /\bO98\.8\b/i.test(text);
    results.push(calculation('Konsistensi kode tifoid', null, a01 && a09 ? 'A01_DAN_A09_PERLU_TINJAU_INCLUDES_BLUEPRINT' : a01 && a020 ? 'A01_DAN_A02_0_PERLU_TINJAU_JENIS_SALMONELLA' : pregnant && a01 && !o988 ? 'KEHAMILAN_DENGAN_A01_PERLU_TINJAU_O98_8' : 'TIDAK_ADA_KONFLIK_UTAMA_TEREKAM', 'Skrining konflik kode dari blueprint pengguna; urutan DU/DS wajib validasi koder', [['A01.-', a01], ['A09', a09], ['A02.0', a020], ['kehamilan', pregnant], ['O98.8', o988]]));
  }

  if (ruleId === 'JKN-PPK-01') {
    const mpap = numberNear(text, 'tekanan\\s+arteri\\s+pulmoner(?:\\s+rerata)?|mpap', 0, 150);
    const pari = numberNear(text, 'pari|pulmonary\\s+arteriolar\\s+resistance(?:\\s+index)?', 0, 30);
    const lvpw = numberNear(text, 'lvpw|ketebalan\\s+dinding\\s+belakang\\s+lv', 0, 30);
    const lvmi = numberNear(text, 'lv\\s*mass\\s*index|lvmi', 0, 300);
    results.push(calculation('Parameter fisiologis BCPS', `${mpap ?? '-'} / ${pari ?? '-'}`, mpap === null || pari === null ? 'TIDAK_DAPAT_DINILAI_LENGKAP' : mpap < 20 && pari < 4 ? 'MEMENUHI_DUA_AMBANG_BLUEPRINT' : 'TIDAK_MEMENUHI_DUA_AMBANG_BLUEPRINT', 'mPAP <20 mmHg dan PARi <4 WU.m² menurut blueprint v4; keputusan operasi tetap tim BTKV', [['mPAP', mpap], ['PARi', pari]]));
    results.push(calculation('Parameter LV untuk ASO', `${lvpw ?? '-'} / ${lvmi ?? '-'}`, lvpw === null && lvmi === null ? 'TIDAK_DAPAT_DINILAI' : (lvpw !== null && lvpw < 3) || (lvmi !== null && lvmi < 40) ? 'AMBANG_KONTRAINDIKASI_BLUEPRINT_TERPICU' : 'AMBANG_TIDAK_TERPICU', 'LVPW <3 mm atau LV mass index <40 g/m² menurut blueprint v4', [['LVPW', lvpw], ['LVMI', lvmi]]));
  }

  if (ruleId === 'JKN-PMK-01') {
    const disease = /kolera|pes|dbd|dengue|demam\s*t(?:i|y)foid|typhoid|paratyphoid|polio|campak|difteri|pertusis|rabies|antraks|leptospirosis/i.test(text);
    const authorityStatus = hasNonNegatedMatch(text, /(?:ditetapkan|penetapan|keputusan|surat\s+(?:penetapan|keputusan))[^.;]{0,80}(?:klb|wabah)|(?:klb|wabah)[^.;]{0,80}(?:ditetapkan|penetapan|keputusan|dinas\s+kesehatan|kepala\s+daerah|menteri)/i);
    const report = /laporan\s+w1|formulir\s+w1|laporan\s+24\s*jam/i.test(text);
    const laboratory = /kultur|isolasi\s+(?:virus|kuman)|\bpcr\b|serologi|ns1|igm/i.test(text);
    results.push(calculation('Pemisahan kasus dan status KLB', null, !disease ? 'PENYAKIT_POTENSI_KLB_TIDAK_DITEMUKAN' : authorityStatus ? 'KASUS_DAN_BUKTI_STATUS_DITEMUKAN' : 'KASUS_DITEMUKAN_STATUS_KLB_BELUM_TERBUKTI', 'Diagnosis individual tidak otomatis sama dengan penetapan status KLB', [['penyakit', disease], ['penetapan/status', authorityStatus]]));
    results.push(calculation('Bukti pelaporan dan laboratorium', null, report && laboratory ? 'KEDUANYA_DITEMUKAN' : report || laboratory ? 'BUKTI_SEBAGIAN' : 'TIDAK_DITEMUKAN', 'Cross-check W1/24 jam dan bukti laboratorium', [['pelaporan', report], ['laboratorium', laboratory]]));
  }
  return results;
};

const respiratoryCalculations = (parameters) => {
  const byName = new Map(parameters.map((parameter) => [parameter.name.toLowerCase(), parameter]));
  const number = (...names) => {
    for (const name of names) {
      const result = firstNumber(byName.get(name.toLowerCase())?.values);
      if (Number.isFinite(result)) return result;
    }
    return null;
  };
  const ph = number('pH');
  const pao2 = number('PaO2');
  const paco2 = number('PaCO2');
  const hco3 = number('HCO3');
  const saturation = number('SaO2 / SpO2');
  let fio2 = number('FiO2');
  if (fio2 !== null && fio2 > 1) fio2 /= 100;
  const pfRatio = pao2 !== null && fio2 !== null && fio2 > 0 ? Math.round((pao2 / fio2) * 10) / 10 : null;
  return [
    { name: 'Interpretasi pH', value: ph, result: ph === null ? 'TIDAK_DITEMUKAN' : ph < 7.35 ? 'ASIDOSIS' : ph > 7.45 ? 'ALKALOSIS' : 'RENTANG_NORMAL', source: 'Buku Ajar ICU Kemenkes: pH 7,35–7,45' },
    { name: 'Kriteria PaO2', value: pao2, result: pao2 === null ? 'TIDAK_DITEMUKAN' : pao2 < 60 ? 'MEMENUHI_AMBANG' : 'TIDAK_MEMENUHI_AMBANG', source: 'Pedoman Kemenkes: PaO2 <60 mmHg' },
    { name: 'Kriteria PaCO2', value: paco2, result: paco2 === null ? 'TIDAK_DITEMUKAN' : paco2 > 50 ? 'HIPERKAPNIA' : 'TIDAK_HIPERKAPNIA', source: 'Pedoman Kemenkes: PaCO2 >50 mmHg' },
    { name: 'HCO3', value: hco3, result: hco3 === null ? 'TIDAK_DITEMUKAN' : 'TEREKSTRAK', source: 'Bukti AGD; interpretasi kompensasi memerlukan konteks klinis' },
    { name: 'Saturasi', value: saturation, result: saturation === null ? 'TIDAK_DITEMUKAN' : saturation < 92 ? 'PERLU_AGD' : 'TIDAK_MEMENUHI_PEMICU', source: 'Pedoman Kemenkes: SaO2 <92% memerlukan AGD' },
    { name: 'FiO2', value: fio2, result: fio2 === null ? 'TIDAK_DITEMUKAN_TIDAK_DIANGGAP_021' : 'TEREKSTRAK', source: 'Nilai wajib berasal dari dokumen' },
    { name: 'Rasio PaO2/FiO2', value: pfRatio, result: pfRatio === null ? 'TIDAK_DAPAT_DIHITUNG' : 'BERHASIL_DIHITUNG', source: 'Perhitungan objektif; bukan keputusan tunggal diagnosis' },
  ];
};

export const evaluateClinicalParameterSchema = (ruleId, sourceText) => {
  const rule = schemaIndex.get(ruleId);
  if (!rule) return null;
  const text = String(sourceText || '').replace(/\s+/g, ' ');
  const parameters = rule.parameters.map((parameter) => ({
    ...parameter,
    values: extractWithPattern(text, parameter.extraction),
  }));
  const extractedCount = parameters.filter((parameter) => parameter.values.length).length;
  const calculated = ruleId === 'JKN-DOC-07' ? respiratoryCalculations(parameters) : objectiveCalculations(ruleId, text, parameters);
  return {
    ...rule,
    parameters,
    extractedCount,
    calculated,
  };
};

export const getClinicalSchemaRule = (ruleId) => schemaIndex.get(ruleId) || null;

