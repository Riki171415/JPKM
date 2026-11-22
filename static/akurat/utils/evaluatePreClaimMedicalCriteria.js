// Source: C:/AkuratiDRG/src/components/ClaimDocumentChecklist.jsx, evaluatePreClaimMedicalCriteria.
import { JKN_CLINICAL_HARD_RULES } from '../data/jknDocumentRules.js';
import { evaluateClinicalParameterSchema } from './clinicalParameterEngine.js';
import { extractLeukocyteValues } from './clinicalLabParser.js';
import { extractSputumCulture } from './sputumCulture.js';
import { evaluateChemotherapyCoding, evaluateOralChemotherapyOutpatientCancerCodes } from './chemotherapyCodingRule.js';
import { evaluateTariffMedicalCoding } from './tariffMedicalCodingRules.js';
import { evaluateFornasChemotherapyRules } from './fornasChemotherapyRules.js';
import { evaluateFornasMedicationRules } from './fornasMedicationRules.js';
const pdfFileKey = file => String(file.index);

export const evaluatePreClaimMedicalCriteria = (claim, files, ocrResults, referenceRules = [], sectionsOrDeath = {}, deathArg = null) => {
  const hasDeathShape = Boolean(sectionsOrDeath && ('shouldCheck' in sectionsOrDeath || 'hasConflict' in sectionsOrDeath));
  const sections = hasDeathShape ? {} : (sectionsOrDeath || {});
  const deathAssessment = deathArg || (hasDeathShape ? sectionsOrDeath : sections.deathAssessment) || null;
  const checks = [];
  const rawClinicalText = files.map((file) => ocrResults[pdfFileKey(file)]?.text || '').join('\n[HALAMAN 0]\n');
  const text = rawClinicalText.toLowerCase().replace(/\s+/g, ' ');
  const diagnoses = String(claim.diaglist || '').toUpperCase().split(/[;,|\s]+/)
    .map((item) => item.replace(/^[([{]+|[\])},:]+$/g, ''))
    .filter((item) => /^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?[*!+#?]?$/.test(item));
  const billingStart = text.search(/(?:rincian\s+(?:biaya(?:\s+pelayanan)?|tagihan|harga|tarif)|rekap(?:itulasi)?\s+(?:biaya|tagihan|harga|tarif)|bukti\s+(?:pembayaran|bayar)|k(?:w)?itansi|nota\s+(?:pembayaran|tagihan|biaya|farmasi|radiologi|obat)|nota\s+farmasi|\bnota\s+\w+\b(?:[^.]{0,30}farmasi)|farmasi\b(?:[^.]{0,40}(?:obat|resep|billing))|\binvoice\b|\bbilling\b|2\.\s*farmasi|lembar\s+obat)/);
  const billingEnd = billingStart >= 0 ? text.slice(billingStart).search(/\[halaman\s+13\]/) : -1;
  const billingText = sections.billing ?? (billingStart >= 0 ? text.slice(billingStart, billingEnd > 0 ? billingStart + billingEnd : undefined) : '');
  const clinicalText = sections.clinical ?? (billingText ? text.replace(billingText, ' ') : (text.match(/\[halaman\s+3\]([\s\S]*)/)?.[1] || text));
  const extractedAge = text.match(/umur\s+tahun\s*:\s*(\d{1,3})/)?.[1] || text.match(/umur\s*:\s*(\d{1,3})\s*(?:tahun|th)/)?.[1];
  const age = Number(claim.umurTahun ?? extractedAge);
  const isChild = Number.isFinite(age) && age < 18;
  const valuesNear = (labels, min, max) => {
    const directMatches = [...clinicalText.matchAll(new RegExp(`(?:${labels})[^0-9a-z]{0,25}(\\d{1,3}(?:[.,]\\d+)?)`, 'gi'))]
      .map((match) => Number(match[1].replace(',', '.')))
      .filter((value) => Number.isFinite(value) && value >= min && value <= max);

    const tableMatches = [];
    files.forEach((file) => {
      const rawText = ocrResults[pdfFileKey(file)]?.text || '';
      if (!rawText) return;
      const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
      const labelRe = new RegExp(`^(?:${labels})$`, 'i');
      const labelIdx = lines.findIndex((l) => labelRe.test(l));
      if (labelIdx >= 0) {
        const hemoIdx = lines.findIndex((l, i) => i < labelIdx && /^hemoglobin$/i.test(l));
        if (hemoIdx >= 0) {
          const offset = labelIdx - hemoIdx;
          const firstNumIdx = lines.findIndex((l, i) => i > labelIdx && /^\d{1,3}(?:[.,]\d+)?$/.test(l));
          if (firstNumIdx >= 0 && lines[firstNumIdx + offset]) {
            const val = Number(lines[firstNumIdx + offset].replace(',', '.'));
            if (Number.isFinite(val) && val >= min && val <= max) {
              tableMatches.push(val);
            }
          }
        }
      }
    });

    return [...new Set([...tableMatches, ...directMatches])];
  };
  const evidenceSnippets = (source, pattern, limit = 3) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    const snippets = [];
    const pageMarkers = [...source.matchAll(/\[halaman\s+(\d+)\]/gi)];
    let pageMarkerIndex = 0;
    let currentPdfNumber = 1;
    let currentPageNumber = null;
    for (const match of source.matchAll(matcher)) {
      while (pageMarkerIndex < pageMarkers.length && pageMarkers[pageMarkerIndex].index < match.index) {
        const markerPage = pageMarkers[pageMarkerIndex][1];
        if (markerPage === '0') {
          currentPdfNumber += 1;
          currentPageNumber = null;
        }
        else currentPageNumber = markerPage;
        pageMarkerIndex += 1;
      }
      const nextMarker = pageMarkers[pageMarkerIndex]?.index ?? source.length;
      if (match.index + match[0].length > nextMarker) continue;
      const marker = pageMarkers[pageMarkerIndex - 1];
      const contentStart = marker ? marker.index + marker[0].length : 0;
      const snippet = source.slice(Math.max(contentStart, match.index - 20), Math.min(nextMarker, match.index + match[0].length + 25))
        .replace(/\[halaman\s+\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const sourceLabel = currentPageNumber ? `PDF ${currentPdfNumber} · Halaman ${currentPageNumber}` : 'Halaman tidak diketahui';
      const formatted = `[${sourceLabel}] "...${snippet}..."`;
      if (snippet && !snippets.includes(formatted)) snippets.push(formatted);
      if (snippets.length >= limit) break;
    }
    return snippets;
  };

  const chemotherapyCodingCheck = evaluateChemotherapyCoding({
    pdfText: text,
    diaglist: claim.diaglist,
    proclist: claim.proclist,
  });
  // Jika komponen tarif kemo tersedia, gunakan rule berbasis tarif di bawah agar
  // satu episode tidak menghasilkan dua warning kemoterapi yang identik.
  if (chemotherapyCodingCheck && Number(claim.tariffComponents?.obat_kemoterapi || 0) <= 0) checks.push(chemotherapyCodingCheck);
  const oralChemotherapyCancerCodeCheck = evaluateOralChemotherapyOutpatientCancerCodes({
    pdfText: text,
    diaglist: claim.diaglist,
    careType: claim.layanan,
  });
  if (oralChemotherapyCancerCodeCheck) checks.push(oralChemotherapyCancerCodeCheck);
  checks.push(...evaluateTariffMedicalCoding({
    tariffComponents: claim.tariffComponents,
    diaglist: claim.diaglist,
    proclist: claim.proclist,
    clinicalText: `${text} ${claim.cbgDescription || ''}`,
  }));
  checks.push(...evaluateFornasChemotherapyRules(text));
  checks.push(...evaluateFornasMedicationRules(text));

  if (claim.layanan === 'Rawat Inap' && diagnoses.some((code) => /^(A09|K52|R19\.7)/.test(code))) {
    const percentages = [...clinicalText.matchAll(/(?:dehidrasi|defisit|kehilangan(?: berat badan| cairan)?)[^%]{0,80}?(\d{1,2}(?:[.,]\d+)?)\s*%/gi)].map((match) => Number(match[1].replace(',', '.'))).filter(Number.isFinite);
    const dehydrationPercent = percentages.find((value) => value >= 4);
    const signGroups = [/mata cekung|sunken eyes/, /mukosa kering|mulut kering/, /turgor|skin pinch/, /haus|tidak mampu minum|sulit minum/, /takikardi|nadi cepat|nadi lemah/, /hipotensi|tekanan darah turun/, /capillary refill|crt/, /oliguri|diuresis|produksi urin/, /letargi|apatis|penurunan kesadaran/].filter((pattern) => pattern.test(clinicalText)).length;
    const symptomBurden = /(?:frekuensi|bab|diare)[^.;]{0,60}(?:kali|x\/hari)|muntah persisten|tidak toleran oral/.test(clinicalText);
    const rehydrationEvidence = /rehidrasi|ringer lactat|ringer laktat|nacl|cairan intravena|infus/.test(clinicalText);
    const hasElectrolyteDisturbance = diagnoses.some((code) => /^E87\.[0-8]/.test(code)) || /hipokalemia|hiponatremia|kcl|drip kcl/i.test(clinicalText);
    const percentagePassed = dehydrationPercent !== undefined;
    const signsPassed = signGroups >= 2;
    const isJustified = (percentagePassed && signsPassed && rehydrationEvidence) || (hasElectrolyteDisturbance && rehydrationEvidence);
    checks.push({
      id: 'MED-DIARE-RANAP',
      title: 'Indikasi rawat inap diare/dehidrasi',
      status: isJustified ? 'SESUAI' : 'PERLU_VALIDASI',
      summary: percentagePassed
        ? `Defisit dehidrasi ${dehydrationPercent}% terdeteksi; ${signGroups} kelompok tanda klinis ditemukan.`
        : hasElectrolyteDisturbance
          ? `Persentase dehidrasi numerik belum eksplisit, namun rawat inap terjustifikasi oleh komplikasi gangguan elektrolit (E87.*) dan terapi rehidrasi/koreksi.`
          : 'Persentase derajat dehidrasi minimal 4% belum terdokumentasi secara eksplisit.',
      details: [
        { label: 'Tabel/persentase dehidrasi ≥4%', passed: percentagePassed },
        { label: 'Minimal 2 kelompok tanda klinis dehidrasi', passed: signsPassed },
        { label: 'Komplikasi gangguan elektrolit (E87.* / hipokalemia)', passed: hasElectrolyteDisturbance },
        { label: 'Frekuensi diare/muntah atau kegagalan oral', passed: symptomBurden },
        { label: 'Rencana/bukti rehidrasi dan monitoring', passed: rehydrationEvidence }
      ]
    });
  }

  const procedures = String(claim.proclist || '').toUpperCase().split(/[;,|\s]+/)
    .map((item) => item.replace(/^[([{]+|[\])},:]+$/g, ''))
    .filter((item) => /^[0-9]{1,2}(?:\.[0-9]{1,4})?$/.test(item));
  const sttProcedurePrefixes = ['86.3', '83.39', '85.21', '77.68', '40.2', '38.60', '86.11', '83.21', '40.11'];
  const isAbscess = diagnoses.some((code) => /^L02/.test(code));
  const sttTriggered = referenceRules.some((rule) => rule.id === 'JKN-DOC-12') || diagnoses.some((code) => /^(D21|D23|D48\.1|C49|L02)/.test(code)) || procedures.some((code) => sttProcedurePrefixes.some((prefix) => code.startsWith(prefix)));
  if (sttTriggered) {
    const dimensionMatches = [...clinicalText.matchAll(/(?:ukuran|dimensi|massa|tumor|lesi)?[^.;]{0,45}?(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm)\b/gi)];
    const dimensions = dimensionMatches.map((match) => {
      const factor = match[4].toLowerCase() === 'mm' ? 0.1 : 1;
      return [match[1], match[2], match[3]].filter(Boolean).map((value) => Number(value.replace(',', '.')) * factor);
    }).filter((values) => values.every(Number.isFinite));
    const flattenedDimensions = dimensions.flat();
    const maximumDimension = flattenedDimensions.length ? Math.max(...flattenedDimensions) : null;
    const deep = /\bdeep\b|di\s*bawah\s*fas[ci]a|subfas[ci]al|intramuskular|menginfiltrasi\s*(?:otot|tendon|fas[ci]a)|jaringan\s*dalam/i.test(clinicalText);
    const superficial = /superficial|superfisial|di\s*atas\s*fas[ci]a|kutis|subkutis/i.test(clinicalText) && !deep;
    const vital = /pembuluh\s*darah\s*utama|saraf\s*utama|saluran\s*(?:napas|pernapasan)|(?:mengenai|infiltrasi|meluas\s*ke)[^.;]{0,35}tulang/i.test(clinicalText);
    const malignant = /maligna|malignan|malignant|ganas|sarkoma|\bc49(?:\.|\b)/i.test(clinicalText);
    const benign = /benigna|benign|jinak|\bd(?:21|23)(?:\.|\b)/i.test(clinicalText);
    const uncertain = /uncertain|perilaku\s*(?:tidak\s*menentu|tidak\s*diketahui)|\bd(?:37|38|39|40|41|42|43|44|45|46|47|48)(?:\.|\b)/i.test(clinicalText);
    const generalAnesthesia = /anestesi\s*umum|general\s*anesth|narkose\s*umum|\bga\b/i.test(clinicalText);
    const localAnesthesia = /anestesi\s*lokal|local\s*anesth/i.test(clinicalText);
    const reconstruction = /skin\s*graft|\bftsg\b|\bstsg\b|flap\s*graft|rekonstruksi/i.test(clinicalText);
    const headNeck = /head\s*(?:and|&)\s*neck|kepala\s*(?:dan|&)\s*leher/i.test(clinicalText);
    const breast = /mammae|payudara|breast/i.test(clinicalText);
    const pedisBone = /(?:pedis|tarsal|kaki)[^.;]{0,70}(?:tulang|erosi\s*tulang)|(?:tulang|erosi\s*tulang)[^.;]{0,70}(?:pedis|tarsal|kaki)/i.test(clinicalText);
    const lymphNode = /kelenjar\s*getah\s*bening|limfadenopati|lymph\s*node/i.test(clinicalText);
    const hemangiomaSkin = /hemangioma[^.;]{0,50}(?:kulit|kutis|subkutis)|(?:kulit|kutis|subkutis)[^.;]{0,50}hemangioma/i.test(clinicalText);
    const excision = /eksisi|excision|pengangkatan\s*(?:seluruh\s*)?(?:massa|tumor|lesi)/i.test(clinicalText);
    const biopsy = /biopsi|biopsy/i.test(clinicalText);
    const biopsyOnly = biopsy && !excision;
    const pathologyDocumented = /patologi\s*anatomi|histopatologi|hasil\s*pa|no\.?\s*pa/i.test(text);
    const operationDocumented = /laporan\s*operasi|lap\.?\s*op|tindakan\s*(?:eksisi|biopsi|insisi|drainase|debridement)/i.test(text);
    const sizeAndVital = maximumDimension !== null && maximumDimension > 4 && vital;
    const inpatientReasons = [
      generalAnesthesia && 'narkose/anestesi umum',
      deep && 'tumor deep/di bawah fascia',
      sizeAndVital && 'ukuran >4 cm disertai struktur vital',
      malignant && 'histopatologi ganas',
      reconstruction && 'rekonstruksi/graft',
      headNeck && 'lokasi kepala-leher',
      isAbscess && 'abses dengan komplikasi/intervensi bedah',
    ].filter(Boolean);
    const isInpatient = /rawat\s*inap|ritl/i.test(String(claim.layanan || ''));
    const inpatientPassed = !isInpatient || inpatientReasons.length > 0;

    let expectedCodes = [];
    let codingBasis = '';
    if (isAbscess) {
      expectedCodes = ['86.04', '86.28'];
      codingBasis = 'diagnosis abses kulit (L02.*) lazimnya insisi & drainase (86.04) atau debridement (86.28), bukan eksisi STT (83.39)';
    } else if (biopsyOnly && lymphNode) { expectedCodes = ['40.11']; codingBasis = 'biopsi kelenjar getah bening'; }
    else if (biopsyOnly && deep) { expectedCodes = ['83.21']; codingBasis = 'biopsi jaringan lunak dalam'; }
    else if (biopsyOnly && superficial) { expectedCodes = ['86.11']; codingBasis = 'biopsi kulit/subkutis'; }
    else if (excision && breast) { expectedCodes = ['85.21']; codingBasis = 'eksisi lokal lesi payudara'; }
    else if (excision && pedisBone) { expectedCodes = ['77.68']; codingBasis = 'eksisi lokal lesi tulang pedis/tarsal'; }
    else if (excision && lymphNode && !malignant) { expectedCodes = ['40.2']; codingBasis = 'eksisi kelenjar getah bening; subkode akhir mengikuti lokasi'; }
    else if (excision && deep) { expectedCodes = ['83.39']; codingBasis = 'eksisi lesi otot/tendon/fascia/jaringan lunak dalam'; }
    else if (excision && superficial) { expectedCodes = ['86.3']; codingBasis = 'eksisi lokal kulit/subkutis'; }
    if (hemangiomaSkin && procedures.some((code) => code.startsWith('38.60'))) { expectedCodes = ['86.3']; codingBasis = 'hemangioma kulit tidak konsisten dengan kode eksisi pembuluh 38.60 menurut blueprint pengguna'; }
    const codedSttProcedures = procedures.filter((code) => [...sttProcedurePrefixes, '86.04', '86.28'].some((prefix) => code.startsWith(prefix)));
    const billingProcedureEvidence = evidenceSnippets(billingText, /eksisi|excision|biopsi|biopsy|insisi|drainase|debridement|86\.3|83\.39|85\.21|77\.68|40\.2|38\.60|86\.11|83\.21|40\.11|86\.04|86\.28/i, 4);
    const codingPassed = expectedCodes.length > 0 && codedSttProcedures.some((code) => expectedCodes.some((expected) => code.startsWith(expected)));
    const actionKnown = biopsyOnly || excision || isAbscess;
    const billingPassed = !billingText || billingProcedureEvidence.length > 0;
    const passed = (isAbscess ? true : pathologyDocumented) && operationDocumented && inpatientPassed && actionKnown && codingPassed && billingPassed;
    const biology = malignant ? 'ganas/maligna' : benign ? 'jinak/benigna' : uncertain ? 'uncertain/unknown' : isAbscess ? 'infeksi/abses' : 'belum terklasifikasi';
    const depth = deep ? 'deep' : superficial ? 'superficial' : 'belum terdokumentasi';
    checks.push({
      id: 'MED-STT',
      title: 'Validasi STT, tindakan, dan kelayakan rawat inap',
      status: passed ? 'SESUAI' : 'PERLU_VALIDASI',
      summary: isAbscess && !codingPassed
        ? `Abses Kulit (L02.*) dikoding sebagai eksisi STT (${codedSttProcedures.join('/') || '83.39'}). Kaidah koding tindakan abses lazimnya Insisi & Drainase (86.04) atau Debridement (86.28).`
        : `Ukuran maksimum ${maximumDimension === null ? 'belum ditemukan' : `${maximumDimension.toFixed(2).replace(/\.00$/, '')} cm`}; kedalaman ${depth}; histopatologi ${biology}. ${isInpatient ? (inpatientPassed ? `Indikasi ranap terdeteksi: ${inpatientReasons.join(', ')}.` : 'Indikasi rawat inap belum ditemukan.') : 'Episode bukan rawat inap.'}`,
      evidence: [
        `Dimensi OCR: ${dimensions.length ? dimensions.map((items) => `${items.join(' × ')} cm`).join(' | ') : 'tidak ditemukan'}`,
        `Tindakan OCR: ${isAbscess ? 'prosedur penanganan abses' : biopsyOnly ? 'biopsi tanpa bukti eksisi' : excision ? (biopsy ? 'eksisi; istilah biopsi juga ditemukan dan perlu dibaca sesuai konteks PA' : 'eksisi') : 'tidak ditemukan'}`,
        `Kode prosedur klaim: ${codedSttProcedures.length ? codedSttProcedures.join(', ') : 'tidak ditemukan'}`,
        `Tindakan/kode pada billing: ${billingProcedureEvidence.length ? billingProcedureEvidence.join(' | ') : 'tidak ditemukan'}`,
        `Rekomendasi kode: ${expectedCodes.length ? `${expectedCodes.join('/')} — ${codingBasis}` : 'belum dapat ditentukan karena jenis tindakan/kedalaman/lokasi belum cukup'}`,
        `Dasar rawat inap: ${inpatientReasons.length ? inpatientReasons.join(', ') : 'tidak ditemukan'}`,
        ...evidenceSnippets(clinicalText, /(?:ukuran|dimensi|massa|tumor|lesi)[^.;]{0,90}(?:cm|mm)|deep|superficial|di\s*bawah\s*fas[ci]a|patologi\s*anatomi|histopatologi|anestesi\s*umum|skin\s*graft|rekonstruksi|insisi|drainase|abses/i, 5),
      ],
      details: [
        { label: 'Dimensi tumor dan satuan terdokumentasi', passed: maximumDimension !== null || isAbscess },
        { label: 'Kedalaman terhadap fascia/jaringan terdokumentasi', passed: deep || superficial || isAbscess },
        { label: 'Laporan operasi/tindakan tersedia', passed: operationDocumented },
        { label: isAbscess ? 'Hasil PA/histopatologi (tidak wajib jika murni abses)' : 'Hasil PA/histopatologi tersedia', passed: isAbscess || pathologyDocumented },
        { label: 'Jenis tindakan tidak ambigu', passed: actionKnown },
        { label: `Kode prosedur sesuai (${expectedCodes.length ? expectedCodes.join('/') : '86.04/86.28'})`, passed: codingPassed },
        { label: 'Kelayakan rawat inap berdasarkan minimal satu kriteria', passed: inpatientPassed },
        { label: 'Anestesi terdokumentasi', passed: generalAnesthesia || localAnesthesia },
        { label: billingText ? 'Tindakan/kode tindakan tercatat pada billing' : 'Billing tidak tersedia untuk cross-check (tidak memblokir)', passed: billingPassed },
        { label: 'Struktur vital dinilai', passed: vital || isAbscess || /tidak\s*(?:mengenai|melibatkan)[^.;]{0,40}(?:saraf|pembuluh|tulang|saluran\s*napas)/i.test(clinicalText) },
        { label: 'Rekonstruksi/graft dinilai', passed: reconstruction || isAbscess || /tanpa\s*(?:rekonstruksi|graft)|tidak\s*(?:memerlukan|dilakukan)\s*(?:rekonstruksi|graft)/i.test(clinicalText) },
      ],
    });
  }

  if (diagnoses.some((code) => code.startsWith('E87.1'))) {
    const sodiumValues = valuesNear('natrium|sodium|na', 80, 180);
    const lowest = sodiumValues.length ? Math.min(...sodiumValues) : null;
    const diagnosisWritten = /hiponatr(?:emia|emi)/.test(clinicalText);
    const symptoms = /kejang|penurunan kesadaran|letargi|koma|dehidrasi berat/.test(clinicalText);
    const encephalopathy = diagnoses.some((code) => code.startsWith('G93.4')) || /(?:ensefalopati|encephalopathy)/i.test(clinicalText);
    const labPassed = lowest !== null && lowest < 135;
    const populationPassed = isChild ? lowest !== null && (lowest < 130 || symptoms) : labPassed;
    const encephalopathyPassed = !encephalopathy || (lowest !== null && lowest < 120);
    const therapy = /nacl\s*(?:0[,.]9|3)\s*%|salin(?:e)? hipertonik|restriksi cairan|koreksi natrium/.test(clinicalText);
    const ivTherapy = /infus|intravena|\biv\b|drip|nacl/.test(clinicalText);
    const basePassed = labPassed && populationPassed && encephalopathyPassed && diagnosisWritten && therapy;
    const clinicalTherapyEvidence = evidenceSnippets(clinicalText, /nacl\s*(?:0[,.]9|3)\s*%|salin(?:e)? hipertonik|restriksi cairan|koreksi natrium/i);
    const billingTherapyEvidence = evidenceSnippets(billingText, /nacl\s*(?:0[,.]9|3)\s*%|salin(?:e)? hipertonik|sodium chloride/i);
    const passed = basePassed && billingTherapyEvidence.length > 0;
    checks.push({ id: 'MED-HIPONATREMIA', title: 'Validasi klinis hiponatremia (E87.1)', status: passed ? 'SESUAI' : 'PERLU_VALIDASI', summary: lowest === null ? 'Nilai natrium tidak berhasil ditemukan pada hasil laboratorium.' : `Natrium terendah ${lowest} mEq/L; ${sodiumValues.length} hasil terdeteksi.`, evidence: [`Nilai Na: ${sodiumValues.length ? sodiumValues.join(', ') : 'tidak ditemukan'}`, clinicalTherapyEvidence.length ? 'Terapi klinis: Ditemukan' : 'Terapi klinis: Tidak ditemukan', billingTherapyEvidence.length ? 'Billing: Ditemukan' : 'Billing: Tidak ditemukan'], details: [{ label: 'Nilai Na memenuhi kriteria', passed: labPassed && populationPassed }, { label: 'Diagnosis tertulis pada resume/CPPT', passed: diagnosisWritten }, { label: 'Kriteria ensefalopati Na <120 bila relevan', passed: encephalopathyPassed }, { label: 'Terapi spesifik hiponatremia', passed: therapy, snippets:clinicalTherapyEvidence }, { label: 'Terapi tercatat pada billing', passed: billingTherapyEvidence.length > 0, snippets:billingTherapyEvidence, billing:true }, { label: 'Terapi intravena bila ada gangguan organ sedang/berat', passed: !symptoms || ivTherapy }, { label: 'Pemeriksaan elektrolit serial', passed: sodiumValues.length >= 2 }] });
  }

  if (diagnoses.some((code) => code.startsWith('E87.6'))) {
    const potassiumValues = valuesNear('kalium|potassium|(?<!e)k', 1, 9);
    const lowest = potassiumValues.length ? Math.min(...potassiumValues) : null;
    const diagnosisWritten = /hipokal(?:emia|emi)/.test(clinicalText);
    const symptoms = /kelemahan otot|hipoton|perut kembung|distensi abdomen|aritmi|bising usus menurun|ileus/.test(clinicalText);
    const encephalopathy = diagnoses.some((code) => code.startsWith('G93.4')) || /(?:ensefalopati|encephalopathy)/i.test(clinicalText);
    const labPassed = lowest !== null && lowest < 3.5;
    const populationPassed = isChild ? lowest !== null && (lowest < 3 || symptoms) : labPassed;
    const encephalopathyPassed = !encephalopathy || (lowest !== null && lowest < 2.5);
    const potassiumTherapy = /\bkcl\b|\bksr\b|potassium chloride|kalium (?:oral|tablet|intravena|iv)|koreksi kalium/.test(clinicalText);
    const ivTherapy = /(?:kcl|kalium|potassium)[^.;]{0,80}(?:infus|intravena|\biv\b|drip)|(?:infus|intravena|\biv\b|drip)[^.;]{0,80}(?:kcl|kalium|potassium)/.test(clinicalText);
    const oralTherapy = /(?:kcl|ksr|kalium|potassium)[^.;]{0,60}(?:oral|tablet|tab)|(?:oral|tablet|tab)[^.;]{0,60}(?:kcl|ksr|kalium|potassium)/.test(clinicalText);
    const routePassed = lowest === null ? false : lowest < 3 ? ivTherapy : (oralTherapy || ivTherapy);
    const clinicalTherapyEvidence = evidenceSnippets(clinicalText, /\bkcl\b|\bksr\b|potassium chloride|kalium (?:oral|tablet|intravena|iv)|koreksi kalium/i);
    const billingTherapyEvidence = evidenceSnippets(billingText, /\bkcl\b|\bksr\b|potassium chloride|kalium/i);
    const billingPassed = billingTherapyEvidence.length > 0;
    const passed = labPassed && populationPassed && encephalopathyPassed && diagnosisWritten && potassiumTherapy && routePassed && billingPassed;
    checks.push({ id: 'MED-HIPOKALEMIA', title: 'Validasi klinis hipokalemia (E87.6)', status: passed ? 'SESUAI' : 'PERLU_VALIDASI', summary: lowest === null ? 'Nilai kalium tidak berhasil ditemukan pada hasil laboratorium.' : `Kalium terendah ${lowest} mEq/L; ${potassiumValues.length} hasil terdeteksi.`, evidence: [`Nilai K: ${potassiumValues.length ? potassiumValues.join(', ') : 'tidak ditemukan'}`, clinicalTherapyEvidence.length ? 'Terapi klinis: Ditemukan' : 'Terapi klinis: Tidak ditemukan', billingTherapyEvidence.length ? 'Billing: Ditemukan' : 'Billing: Tidak ditemukan'], details: [{ label: 'Nilai K memenuhi kriteria', passed: labPassed && populationPassed }, { label: 'Diagnosis tertulis pada resume/CPPT', passed: diagnosisWritten }, { label: 'Kriteria ensefalopati K <2,5 bila relevan', passed: encephalopathyPassed }, { label: 'Terapi koreksi kalium terdokumentasi', passed: potassiumTherapy, snippets:clinicalTherapyEvidence }, { label: 'Terapi kalium tercatat pada billing', passed: billingPassed, snippets:billingTherapyEvidence, billing:true }, { label: lowest !== null && lowest < 3 ? 'K <3: koreksi intravena' : 'K 3,00-3,50: koreksi oral/IV', passed: routePassed }, { label: 'Pemeriksaan kalium serial', passed: potassiumValues.length >= 2 }] });
  }

  if (diagnoses.some((code) => /^(J09|J10|J11|J12|J13|J14|J15|J16|J17|J18|J44\.0|J44\.1)/.test(code))) {
    const radiologyEvidence = /infiltrat|infiltrate|konsolidasi|consolidation|bronkopneumonia/.test(clinicalText);
    const clinicalSignals = [/batuk/, /demam|suhu\s*(?:>|≥)?\s*38/, /sesak|dispnea|dyspnea/, /ronki|crackles/, /takipnea|rr\s*(?:>|≥)/, /saturasi[^.;]{0,30}(?:<|≤)\s*94|hipoksem/].filter((pattern) => pattern.test(clinicalText)).length;
    const leukocytes = [...new Set([
      ...valuesNear('leukosit|lekosit|lekocit|leucocyte|leukocyte|wbc', 0.1, 100),
      ...files.flatMap((file) => extractLeukocyteValues(ocrResults[pdfFileKey(file)]?.text || '')),
    ])];
    const antibiotic = /antibiotik|amoxic|ampic|ceftria|cefotax|levoflox|levofloksasin|azithro|meropenem|moxifloxacin|ciproflo|gentamicin|sulbactam|clindamycin/.test(clinicalText);
    const diagnosisWritten = /pneumonia|bronkopneumonia/.test(clinicalText);

    // PSI / CURB-65 scoring detection
    const psiScore = /\bpsi\b|\bport\s+score\b|pneumonia\s+severity\s+index/i.test(clinicalText);
    const curb65 = /\bcurb[\s-]?65\b/i.test(clinicalText);
    const severityScore = psiScore || curb65;
    const psiClass = clinicalText.match(/\b(?:psi|port)\b\s*(?:risk\s*)?(?:score|skor|kelas|class|kategori|grade|poin)?\s*[:=]?\s*(IV|III|II|V|I|\d+)\b/i)?.[1] || null;
    const curb65Value = clinicalText.match(/\bcurb[\s-]?65\b\s*(?:score|skor|nilai|poin|point)?\s*[:=]?\s*([0-5])\b/i)?.[1] || null;
    const severityScoreEvidence = evidenceSnippets(clinicalText, /\bpsi\b\s*(?:risk\s*)?(?:score|skor|kelas|class)?|\bport\s+score\b|pneumonia\s+severity\s+index|\bcurb[\s-]?65\b/i, 2);

    // Sputum culture / gram stain detection
    const cultureReport = extractSputumCulture(rawClinicalText);
    const sputumCulture = cultureReport.detected || /kultur\s*(?:sputum|dahak|bakteri)|sputum\s*(?:kultur|culture|c\/s|cs\b)|biakan\s*sputum/.test(clinicalText);
    const gramStain = /gram\s*(?:sputum|stain|pewarnaan|pulasan)|pewarnaan\s*gram|sputum\s*gram|apusan\s*sputum/.test(clinicalText);
    const sputumMicro = sputumCulture || gramStain;
    const sputumEvidence = [...cultureReport.evidence, ...evidenceSnippets(clinicalText, /kultur\s*sputum|biakan\s*sputum|gram\s*sputum|pewarnaan\s*gram|sputum\s*(?:kultur|c\/s|gram)/i, 2)].slice(0, 2);

    const basePassed = radiologyEvidence && clinicalSignals >= 2 && leukocytes.length > 0 && antibiotic && diagnosisWritten;
    const antibioticEvidence = evidenceSnippets(clinicalText, /antibiotik|amoxic|ampic|ceftria|cefotax|levoflox|levofloksasin|azithro|meropenem|moxifloxacin|ciproflo|gentamicin|sulbactam|clindamycin/i);
    const billingAntibioticEvidence = evidenceSnippets(billingText, /amoxic|ampic|ceftria|cefotax|levoflox|levoprox|levocin|levoquin|cravit|tavanic|levofloksasin|azithro|meropenem|moxifloxacin|augment|sulbactam|ciproflo|ciproxin|gentamicin|metronidazol|cotrimoxazol|doxycyclin|clindamycin|erythromycin|rifampicin|isoniazid|piperacillin|tazobactam/i);
    const passed = basePassed && billingAntibioticEvidence.length > 0;
    checks.push({
      id: 'MED-PNEUMONIA',
      title: 'Validasi klinis pneumonia',
      status: passed && severityScore ? 'SESUAI' : 'TIDAK_SESUAI',
      summary: `${clinicalSignals} gejala klinis; leukosit ${leukocytes.length ? leukocytes[0] : 'tidak ditemukan'}. PSI: ${psiScore ? (psiClass ? `kelas/nilai ${psiClass}` : 'tercatat, nilai belum terbaca') : 'tidak ditemukan'}. CURB-65: ${curb65 ? (curb65Value ?? 'tercatat, nilai belum terbaca') : 'tidak ditemukan'}. Mikrobiologi (bila terindikasi): ${sputumCulture ? 'Kultur ✓' : 'Kultur –'} / ${gramStain ? 'Gram ✓' : 'Gram –'}.`,
      evidence: [
        leukocytes.length ? `Leukosit: ${leukocytes[0]}` : null,
        psiScore ? `PSI: ${psiClass ? `kelas/nilai ${psiClass}` : 'tercatat'}` : null,
        curb65 ? `CURB-65: ${curb65Value ?? 'tercatat'}` : null,
        sputumMicro ? `Sputum Mikro: Ditemukan` : null,
        cultureReport.organisms.length ? `Hasil kultur sputum: ${cultureReport.organisms.join(', ')}` : null,
        ...sputumEvidence,
        antibioticEvidence.length ? `Antibiotik Klinis: Ditemukan` : null,
        billingAntibioticEvidence.length ? `Antibiotik Billing: Tercatat` : null
      ].filter(Boolean),
      details: [
        { label: 'Diagnosis pneumonia tertulis di resume/CPPT', passed: diagnosisWritten },
        { label: 'Infiltrat/konsolidasi pada hasil radiologi', passed: radiologyEvidence },
        { label: 'Minimal 2 gejala/parameter klinis', passed: clinicalSignals >= 2 },
        { label: 'Nilai leukosit tersedia', passed: leukocytes.length > 0 },
        { label: `Skor prognosis: ${psiScore ? `PSI${psiClass ? ` kelas ${psiClass}` : ''}` : '–'} / ${curb65 ? `CURB-65${curb65Value ? ` nilai ${curb65Value}` : ''}` : '–'} (cukup salah satu)`, passed: severityScore },
        { label: 'Kultur sputum/Gram bila ada indikasi mikrobiologi', passed: sputumMicro, snippets:sputumEvidence },
        { label: 'Terapi antibiotik terdokumentasi di catatan klinis', passed: antibioticEvidence.length > 0, snippets:antibioticEvidence },
        { label: 'Antibiotik tercatat pada billing/resep', passed: billingAntibioticEvidence.length > 0, snippets:billingAntibioticEvidence, billing:true },
      ],
    });
  }

  const encephalopathyTriggered = diagnoses.some((code) => /^(G93\.[14]|K72|I67\.4|G92|B22\.0)/.test(code))
    || referenceRules.some((rule) => rule.id === 'JKN-DOC-06');
  if (encephalopathyTriggered) {
    const diagnosisWritten = /(?:ensefalopati|encephalopathy)/i.test(clinicalText);
    const gcsMatches = [...clinicalText.matchAll(/gcs\s*[:=]?\s*([3-9]|1[0-5])\b/gi)].map((m) => Number(m[1]));
    const hasConsciousnessDepression = /delirium|somnolen|sopor|apatis|koma|penurunan\s*(?:tingkat\s*)?kesadaran|altered\s*mental\s*status/i.test(clinicalText) || gcsMatches.some((v) => v < 15);
    const serialMonitoring = /monitoring[^.;]{0,50}(?:gcs|kesadaran)|gcs[^.;]{0,80}gcs|evaluasi\s*kesadaran|gcs\s*serial|gcs\s*e\d\s*[mv]\d/i.test(clinicalText) || gcsMatches.length >= 2;
    const neuroConsult = /konsul(?:tasi)?\s*(?:saraf|neuro|sp\.?\s*s|sp\.?\s*n)|jawaban\s*konsul[^.;]{0,30}(?:saraf|neuro|sp\.?\s*s|sp\.?\s*n)|dpjp\s*neurologi/i.test(clinicalText);
    const neuroImagingOrJustification = /ct\s*(?:scan)?\s*kepala|head\s*ct|mri\s*(?:kepala|otak|brain)|\beeg\b|elektroensefalo|hemodinamik\s+tidak\s+stabil|syok|shock|vasopresor|inotropik|pasien\s*tidak\s*transportable/i.test(clinicalText);

    const sepsisRelated = diagnoses.some((c) => /^(A40|A41|R57\.2)/.test(c)) || /sepsis|syok\s*septik/i.test(clinicalText);
    const hepaticRelated = diagnoses.some((c) => /^(K70|K72|K74|B15|B16|B17|B18|B19)/.test(c)) || /hepatik|sirosis|hati|lactulose|laktulosa/i.test(clinicalText);
    const uremicRelated = diagnoses.some((c) => /^(N18|N19)/.test(c)) || /urem|hemodial|cuci\s*darah/i.test(clinicalText);
    const metabolicRelated = diagnoses.some((c) => /^(E87\.[16])/.test(c)) || /hiponatr|hipokal/i.test(clinicalText);

    const consultEvidence = evidenceSnippets(clinicalText, /konsul(?:tasi)?\s*(?:saraf|neuro|sp\.?\s*s|sp\.?\s*n)|jawaban\s*konsul/i, 2);
    const imagingEvidence = evidenceSnippets(clinicalText, /ct\s*(?:scan)?\s*kepala|mri\s*(?:kepala|otak)|\beeg\b|hemodinamik\s+tidak\s+stabil/i, 2);

    const passed = diagnosisWritten && hasConsciousnessDepression && (serialMonitoring || neuroConsult || neuroImagingOrJustification);

    checks.push({
      id: 'MED-ENSEFALOPATI',
      title: 'Validasi klinis ensefalopati (G93.4 / K72 / I67.4)',
      status: passed ? 'SESUAI' : 'PERLU_VALIDASI',
      summary: !diagnosisWritten
        ? 'Diagnosis ensefalopati belum tertulis pada resume/CPPT.'
        : !hasConsciousnessDepression
        ? 'Bukti objektif penurunan kesadaran atau GCS < 15 belum ditemukan.'
        : !serialMonitoring && !neuroConsult
        ? 'Perlu dilengkapi monitoring GCS serial atau lembar konsultasi Dokter Spesialis Saraf.'
        : 'Kriteria klinis ensefalopati terpenuhi.',
      evidence: [
        `Penurunan kesadaran: ${hasConsciousnessDepression ? (gcsMatches.length ? `GCS: ${gcsMatches.join(', ')}` : 'Ditemukan tanda klinis') : 'Tidak ditemukan'}`,
        consultEvidence.length ? 'Konsul Sp.S/Sp.N: Ditemukan' : 'Konsul Sp.S/Sp.N: Tidak ditemukan',
        imagingEvidence.length ? 'Penunjang/Justifikasi: Ditemukan' : 'Penunjang/Justifikasi: Tidak ditemukan',
        sepsisRelated ? 'Etiologi: Sepsis' : hepaticRelated ? 'Etiologi: Penyakit Hati/Hepatik' : uremicRelated ? 'Etiologi: Penyakit Ginjal/Uremik' : metabolicRelated ? 'Etiologi: Gangguan Elektrolit' : null,
      ].filter(Boolean),
      details: [
        { label: 'Diagnosis ensefalopati tertulis pada resume/CPPT', passed: diagnosisWritten },
        { label: 'Penurunan GCS (<15) atau catatan gangguan kesadaran', passed: hasConsciousnessDepression },
        { label: 'Monitoring kesadaran berkala (GCS serial)', passed: serialMonitoring },
        { label: 'Lembar konsultasi Dokter Spesialis Saraf (Sp.S/Sp.N)', passed: neuroConsult, snippets:consultEvidence },
        { label: 'CT Scan Kepala / EEG / Justifikasi Hemodinamik Tidak Stabil', passed: neuroImagingOrJustification, snippets:imagingEvidence },
      ],
    });
  }

  const ventTriggered = procedures.some((code) => /^96\.7(?:0|1|2)?$/.test(code) || /^31\.[12](?:\d)?$/.test(code))
    || referenceRules.some((rule) => rule.id === 'JKN-COD-72');
  if (ventTriggered) {
    const ventCodes = procedures.filter((code) => /^96\.7(?:0|1|2)?$/.test(code));
    const trachCodes = procedures.filter((code) => /^31\.[12](?:\d)?$/.test(code));
    const hasVentilator = ventCodes.length > 0 || referenceRules.some((rule) => rule.id === 'JKN-COD-72');
    const has9671 = ventCodes.includes('96.71');
    const has9672 = ventCodes.includes('96.72');
    const hasTracheostomy = trachCodes.length > 0;

    const respIndPattern = /gagal\s+na[pf]as|respiratory\s+failure|hipoksem|hiperkapn|asidosis\s+respiratorik|\bapne[au]\b|henti\s+na[pf]as|distres\s+(?:na[pf]as|perna[pf]asan)|retraksi|desaturasi|spo2\s*[:=]?\s*(?:[1-8]\d(?:\.\d+)?)\s*%?|pao2\s*[:=]?\s*(?:[1-5]\d(?:\.\d+)?)\b|paco2\s*[:=]?\s*(?:[5-9]\d|1\d{2})\b/i;
    const airwayIndPattern = /gcs\s*[:=]?\s*(?:[3-8]\b|e[12]\s*[mv]\d)|penurunan\s*(?:tingkat\s*)?kesadaran|\bkoma\b|\bcoma\b|obstruksi\s+jalan\s+na[pf]as|tidak\s+sadar/i;
    const cardioIndPattern = /\bsyok\b|\bshock\b|henti\s+jantung|cardiac\s+arrest|\brjp\b|resusitasi\s+jantung\s+paru|noradrenalin|norepinephrine|vasopresor|dopamin|dobutamin/i;
    const respSnippets = evidenceSnippets(clinicalText, respIndPattern, 2);
    const airwaySnippets = evidenceSnippets(clinicalText, airwayIndPattern, 2);
    const cardioSnippets = evidenceSnippets(clinicalText, cardioIndPattern, 2);
    const matchedIndCategories = [
      respSnippets.length && 'gagal napas/apnea/hipoksemia',
      airwaySnippets.length && 'penurunan kesadaran/proteksi jalan napas',
      cardioSnippets.length && 'syok/distres kardiovaskular/pasca-RJP',
    ].filter(Boolean);
    const indicationEvidence = [...new Set([...respSnippets, ...airwaySnippets, ...cardioSnippets])].slice(0, 3);
    const indicationPassed = indicationEvidence.length > 0;

    const invasiveAirwayPattern = /\bintubasi\b|\bett\b|endo\s*trak(?:h)?eal|pipa\s+endotrakeal|laringoskop|trakeostom|tracheostom|kanul\s+trakea/i;
    const nivPattern = /\bcpap\b|\bbipap\b|\bhfnc\b|\bniv\b|non[- ]?invasif\s+ventilat/i;
    const airwayEvidence = evidenceSnippets(clinicalText, invasiveAirwayPattern, 3);
    const billingInvasive = evidenceSnippets(billingText, /intubasi|\bett\b|endo\s*trak|trakeostom|tracheostom/i, 2);
    const invasiveAirwayPassed = airwayEvidence.length > 0;
    const nivOnlyConflict = hasVentilator && !invasiveAirwayPassed && !billingInvasive.length && nivPattern.test(clinicalText);

    const settingPattern = /\bpeep\b|\bfio2\b|tidal\s+volume|\bpc\s*ac\b|\bpcv\b|\bvcv\b|\bsimv\b|\bacv\b|\bpip\b\s*[:=]?\s*\d|mode\s+(?:ventilator|pc|vc|simv|psv|ac)|(?:dengan|pakai|pasang|terpasang)\s+v[ei]ntilator|ventilator\s+(?:pc|vc|simv|tgl|tanggal)|venti\s*\+/i;
    const icuPattern = /\b(?:p|n)?icu\b|intensive\s+care|intensif\s+care|perawatan\s+intensif/i;
    const monitoringEvidence = [...new Set([
      ...evidenceSnippets(clinicalText, settingPattern, 2),
      ...evidenceSnippets(clinicalText, icuPattern, 2),
    ])].slice(0, 3);
    const monitoringPassed = settingPattern.test(clinicalText);

    const losRaw = claim.los ?? claim.LOS ?? claim._los ?? claim.LAMA_RAWAT;
    const losVal = losRaw === null || losRaw === undefined || losRaw === '' ? NaN : Number(losRaw);
    const losConflict9672 = has9672 && Number.isFinite(losVal) && losVal <= 3;
    const durationPattern = /(?:lama|durasi)\s+(?:pemakaian\s+)?ventilator[^.;]{0,40}\d+\s*(?:jam|hari)|\d+\s*(?:jam|hari)[^.;]{0,30}ventilator|ekstubasi|weaning|lepas\s+ventilator|(?:mulai|pasang|intubasi)[^.;]{0,40}(?:jam|pukul)\s*\d{1,2}[:.]\d{2}/i;
    const durationEvidence = evidenceSnippets(clinicalText, durationPattern, 2);
    const durationPassed = !losConflict9672 && durationEvidence.length > 0;

    const consentPattern = /persetujuan\s+(?:tindakan\s+)?[^.;]{0,160}(?:ett|intubasi|endo\s*trak|ventilator|trakeostom|tracheostom)|informed\s+consent[^.;]{0,100}(?:ett|intubasi|ventilator|trakeostom)|surat\s+(?:pernyataan|persetujuan)(?:\s*\/\s*(?:pernyataan|persetujuan))?[^.;]{0,120}(?:icu|picu|nicu|intensif|intubasi|ventilator)/i;
    const consentEvidence = evidenceSnippets(clinicalText, consentPattern, 2);
    const consentPassed = consentEvidence.length > 0;

    const trachEvidence = hasTracheostomy
      ? evidenceSnippets(clinicalText, /laporan\s+(?:operasi|tindakan)[^.;]{0,80}trakeostom|tracheostom/i, 2)
      : [];
    const trachPassed = !hasTracheostomy || trachEvidence.length > 0;

    const billingVentEvidence = evidenceSnippets(
      billingText,
      /ventilator|intubasi|\bett\b|endo\s*trak|breathing\s+circuit|filter\s+hme|closed\s+suction|suction\s+cath|trakeostom|tracheostom|\b(?:p|n)?icu\b/i,
      3,
    );
    const billingPassed = !billingText || billingVentEvidence.length > 0;

    const ventPassed = !losConflict9672 && !nivOnlyConflict
      && indicationPassed && invasiveAirwayPassed && monitoringPassed
      && durationPassed && consentPassed && trachPassed && billingPassed;
    const ventStatus = (losConflict9672 || nivOnlyConflict) ? 'TIDAK_SESUAI' : (ventPassed ? 'SESUAI' : 'PERLU_VALIDASI');

    const title = hasTracheostomy && hasVentilator
      ? `Validasi Indikasi & Syarat Ventilator Invasif + Trakeostomi (${[...trachCodes, ...ventCodes].join(', ')})`
      : has9672
      ? 'Validasi Indikasi & Syarat Ventilator Invasif ≥96 Jam (96.72)'
      : has9671
      ? 'Validasi Indikasi & Syarat Ventilator Invasif <96 Jam (96.71)'
      : hasTracheostomy
      ? `Validasi Trakeostomi (${trachCodes.join(', ')})`
      : `Validasi Indikasi & Syarat Ventilator Invasif (${ventCodes.join(', ') || '96.7x'})`;

    const summary = losConflict9672
      ? `Kode 96.72 (ventilator ≥96 jam) tercatat dengan LOS ${losVal} hari (≤3 hari). Durasi rawat tidak mencukupi untuk ≥96 jam; koreksi ke 96.71 bila ventilasi invasif terbukti <96 jam.`
      : nivOnlyConflict
      ? `Dokumen hanya menunjukkan ventilasi non-invasif (CPAP/BiPAP/HFNC) tanpa bukti intubasi ETT atau trakeostomi. Kode 96.71/96.72 khusus ventilasi invasif; pertimbangkan 93.90 (CPAP/BiPAP) bila non-invasif.`
      : ventPassed
      ? `Indikasi (${matchedIndCategories.join(', ')}), antarmuka invasif (ETT/trakeostomi), setting ventilator, durasi, informed consent, dan kesesuaian billing terpenuhi.`
      : [
          indicationPassed ? `Indikasi terbaca: ${matchedIndCategories.join(', ')}.` : 'Indikasi klinis (gagal napas/apnea/GCS rendah/syok) belum terbaca.',
          invasiveAirwayPassed ? 'Bukti ETT/trakeostomi terbaca.' : 'Bukti intubasi ETT/trakeostomi belum terbaca.',
          !durationPassed ? 'Durasi jam mulai–selesai pada flowsheet intensif perlu diverifikasi (<96 jam vs ≥96 jam).' : null,
          !consentPassed ? 'Informed consent intubasi/ventilator/ICU belum terbaca OCR.' : null,
        ].filter(Boolean).join(' ');

    const recommendations = [
      'Indikasi pemasangan ventilator invasif (PNPK PERDATIN hlm. 322–323): gagal napas hipoksemia atau hiperkapnia, apnea/henti napas, perlindungan jalan napas (GCS rendah/koma/obstruksi), distres kardiovaskular/syok, atau kebutuhan sedasi dalam pascaoperasi intensif.',
      'Syarat koding 96.71 (<96 jam) / 96.72 (≥96 jam): wajib melalui ETT/trakeostomi (bukan CPAP/BiPAP/HFNC 93.90 dan bukan pemakaian rutin intraoperatif), disertai catatan setting (mode, FiO2, PEEP, RR), jam mulai–selesai pada flowsheet ICU/PICU, dan informed consent.',
      ...(losConflict9672 ? ['Koreksi 96.72 ke 96.71 karena LOS ≤ 3 hari tidak memenuhi ambang ≥96 jam.'] : []),
      ...(nivOnlyConflict ? ['Periksa apakah tindakan sebenarnya hanya CPAP/BiPAP/HFNC non-invasif (93.90 / 93.96).'] : []),
      ...(!durationPassed && !losConflict9672 ? ['Cocokkan jam mulai intubasi/ventilator hingga lepas/meninggal pada flowsheet ICU/PICU untuk memastikan kategori <96 jam (96.71) atau ≥96 jam (96.72).'] : []),
      ...(!consentPassed ? ['Periksa halaman pindai surat persetujuan tindakan (informed consent) intubasi, ventilator, atau perawatan ICU/PICU.'] : []),
      ...(hasTracheostomy && !trachPassed ? ['Lampirkan atau cocokkan laporan operasi tindakan trakeostomi (31.1/31.2x).'] : []),
    ];

    checks.push({
      id: 'MED-VENTILATOR',
      title,
      status: ventStatus,
      summary,
      source: 'KMK HK.01.07/MENKES/1541/2022 (PNPK Anestesiologi & Terapi Intensif, hlm. 322–325); BA Kesepakatan INA-CBG 2019 Kasus 201',
      recommendations,
      parameters: [
        `Kode prosedur terpicu: ${[...ventCodes, ...trachCodes].join(', ') || '96.7x'}`,
        matchedIndCategories.length ? `Kategori indikasi klinis: ${matchedIndCategories.join(', ')}` : 'Kategori indikasi klinis: belum terbaca OCR',
        Number.isFinite(losVal) ? `LOS episode: ${losVal} hari (${has9672 ? 'klaim ≥96 jam / 96.72' : has9671 ? 'klaim <96 jam / 96.71' : 'durasi perlu verifikasi'})` : null,
      ].filter(Boolean),
      evidence: [
        ...indicationEvidence,
        ...airwayEvidence,
        ...monitoringEvidence,
        ...durationEvidence,
        ...consentEvidence,
        ...trachEvidence,
      ],
      details: [
        { label: 'Indikasi klinis pemasangan (gagal napas/apnea/GCS rendah/syok/pasca-RJP)', passed: indicationPassed, snippets: indicationEvidence },
        { label: 'Syarat antarmuka invasif: bukti ETT / intubasi atau trakeostomi (bukan NIV 93.90)', passed: invasiveAirwayPassed && !nivOnlyConflict, snippets: airwayEvidence },
        { label: 'Syarat pemantauan intensif: setting ventilator (mode/PEEP/FiO2/RR/TV) tercatat', passed: monitoringPassed, snippets: monitoringEvidence },
        { label: `Syarat durasi & LOS: flowsheet jam ventilator sesuai ${has9672 ? '96.72 (≥96 jam)' : '96.71 (<96 jam)'}`, passed: durationPassed, snippets: durationEvidence },
        { label: 'Syarat administrasi klinis: informed consent intubasi / ventilator / ruang intensif', passed: consentPassed, snippets: consentEvidence },
        ...(hasTracheostomy ? [{ label: 'Syarat tindakan bedah: laporan operasi trakeostomi (31.1/31.2x)', passed: trachPassed, snippets: trachEvidence }] : []),
        { label: billingText ? 'Cross-check billing/BHP (ventilator/ETT/circuit/ruang intensif)' : 'Billing tidak tersedia untuk cross-check (tidak memblokir)', passed: billingPassed, snippets: billingVentEvidence, billing: true },
      ],
    });
  }

  const tbCodes = diagnoses.filter((code) => /^A1[56](?:\.[0-9A-Z]+)?$/i.test(code));
  const tbTriggered = tbCodes.length > 0 || referenceRules.some((rule) => rule.id === 'JKN-PNPK-TB');
  if (tbTriggered) {
    const hasA15 = tbCodes.some((code) => code.startsWith('A15'));
    const hasA152 = tbCodes.includes('A15.2');
    const hasA16 = tbCodes.some((code) => code.startsWith('A16'));

    const clinicalWithoutSuspectTb = clinicalText
      .replace(/\b(?:susp(?:ek(?:t)?)?\.?|curiga|ddx?\/?|diagnosis\s+banding|ruang\s+suspek|riwayat)\s+(?:tb|tuberkulosis|tuberculosis|kp)\b[^.;\n]{0,45}/gi, ' ')
      .replace(/\b(?:tb|tuberkulosis|tuberculosis)\s*(?:\(-\)|negatif)\b/gi, ' ');
    const definitiveTbPattern = /\b(?:tb\s+paru|tb\s+on\s+oat|tuberkulosis(?:\s+paru)?|tuberculosis|tb\s+klinis|tb\s+aktif|tb\s+kasus\s+baru|tb\s+relaps|tb\s+anak|tb\s+milier|kp\s+(?:aktif|dupleks|on\s+oat))\b/i;
    const suspectTbPattern = /\b(?:susp(?:ek(?:t)?)?\.?|curiga)\s+(?:tb|tuberkulosis|tuberculosis)\b[^.;\n]{0,45}/i;
    const definitiveTbEvidence = evidenceSnippets(clinicalWithoutSuspectTb, definitiveTbPattern, 2);
    const suspectTbEvidence = evidenceSnippets(clinicalText, suspectTbPattern, 2);
    const diagnosisPassed = definitiveTbEvidence.length > 0;
    const suspectOnlyConflict = !diagnosisPassed && suspectTbEvidence.length > 0;
    const clinicalTbOnlyWritten = /\btb\s+paru\s+klinis\b|\btb\s+klinis\b/i.test(clinicalText);

    const oatRegimenPattern = /\b(?:rhze|rhz|4\s*kdt|2\s*kdt|oat\s*(?:fdc|kdt|kategori|kat|anak|lini|lanjut(?:kan)?|tahap|fase|paket)|(?:fdc|kdt)\s*(?:oat|tb|kat|tahap|\d)|dots[\s.]*(?:paket\s*)?(?:rhze|rhz|oat)|paket\s+rhze|(?:on|terapi|pengobatan|minum|dapat|lanjut(?:kan)?)\s+oat|oat\s+(?:on|bulan|hari|minggu|usut)|rifampi[cs]in|isoniazid|\binh\b|pyrazinamid|pirazinamid|ethambutol|etambutol|streptomy[cs]in|streptomisin|rifastar|rimstar|rimcure|pro\s*tb)\b|(?<!riwayat\s+)\boat\b(?!\s*(?:[-–]|[:=]\s*[-–]|\(-\)|negatif|tidak\s+ada|disangkal|belum))/i;
    const clinicalOatEvidence = evidenceSnippets(clinicalText, oatRegimenPattern, 3);
    const billingOatEvidence = evidenceSnippets(billingText, oatRegimenPattern, 3);
    const oatPassed = clinicalOatEvidence.length > 0 || billingOatEvidence.length > 0;

    const bactPosPattern = /(?:tcm|gene\s*xpert|xpert)(?![^.;\n]{0,45}not\s+detected)[^.;\n]{0,45}\bmtb\s+detected\b|\bmtb\s+detected\b|(?:bta|bakteri\s+tahan\s+asam)(?![^.;\n]{0,35}(?:tidak\s+ditemukan|negatif|gram))[^.;\n]{0,25}(?:positif|\(\+\)|\+[123]|[123]\+|scanty)|(?<!tidak\s+)ditemukan\s+bakteri\s+tahan\s+asam|kultur[^.;\n]{0,35}(?:m\.?\s*tuberculosis|mtb)\s+positif/i;
    const bactNegPattern = /\bmtb\s+not\s+detected\b|(?:tcm|gene\s*xpert|xpert)[^.;\n]{0,40}(?:not\s+detected|negatif|\(-\))|(?:bta|bakteri\s+tahan\s+asam)[^.;\n]{0,40}(?:negatif|\(-\)|tidak\s+ditemukan)|tidak\s+ditemukan\s+bakteri\s+tahan\s+asam/i;
    const histologyTbPattern = /(?:histopatologi|patologi\s+anatomi|hasil\s+pa|biopsi|fnab)[^.;\n]{0,80}(?:tuberkul|granulom|kaseosa|caseous|langhans|radang\s+kronik\s+spesifik)|(?:granulom\w*|nekrosis\s+kaseosa|sel\s+datia\s+langhans)/i;
    const radiologyTbPattern = /(?:thorax|toraks|rontgen|x[\s-]*foto\s+thorax|foto\s+dada)[^.;\n]{0,180}(?:infiltrat|fibroinfiltrat|kavitas|cavity|konsolidasi|milier|tb\s+paru)|(?:infiltrat|fibroinfiltrat|kavitas)[^.;\n]{0,120}(?:tb\s+paru|paru|suprahiler|apeks|lapang(?:an)?\s+(?:atas|paru))|kesimpulan\s*:\s*tb\s+paru/i;

    const bactPosEvidence = evidenceSnippets(clinicalText, bactPosPattern, 2);
    const bactNegEvidence = evidenceSnippets(clinicalText, bactNegPattern, 2);
    const histologyEvidence = evidenceSnippets(clinicalText, histologyTbPattern, 2);
    const radiologyEvidence = evidenceSnippets(clinicalText, radiologyTbPattern, 2);

    const hasConfirmedBactOrHist = bactPosEvidence.length > 0 || histologyEvidence.length > 0;
    const bactNegConflict = hasA15 && bactNegEvidence.length > 0 && !hasConfirmedBactOrHist;
    const workupEvidence = [...new Set([
      ...bactPosEvidence,
      ...histologyEvidence,
      ...radiologyEvidence,
      ...bactNegEvidence,
    ])].slice(0, 3);
    const workupPassed = hasA15
      ? hasConfirmedBactOrHist
      : (radiologyEvidence.length > 0 || bactPosEvidence.length > 0 || histologyEvidence.length > 0);

    const subcodePassed = hasA152
      ? histologyEvidence.length > 0
      : hasA15
      ? hasConfirmedBactOrHist
      : (diagnosisPassed && (radiologyEvidence.length > 0 || oatPassed));

    const sitbFromClaim = String(claim.registerSITB || '').trim();
    const sitbFromText = text.match(/\b(?:nomor\s+)?register\s+sitb\s*[:=.]?\s*(\d{8,20})\b/i)?.[1] || '';
    const sitbNumber = sitbFromClaim || sitbFromText;
    const sitbEvidence = evidenceSnippets(clinicalText, /\b(?:nomor\s+)?register\s+sitb\s*[:=.]?\s*\d{8,20}\b/i, 1);
    const sitbPassed = Boolean(sitbNumber);

    const tbPassed = diagnosisPassed && oatPassed && workupPassed && subcodePassed && sitbPassed && !bactNegConflict && !suspectOnlyConflict;
    const tbStatus = (!oatPassed && (bactNegConflict || suspectOnlyConflict))
      ? 'TIDAK_SESUAI'
      : (tbPassed ? 'SESUAI' : 'PERLU_VALIDASI');

    const summary = (!oatPassed && (bactNegConflict || suspectOnlyConflict))
      ? `Kode ${tbCodes.join(', ')} diajukan, tetapi tidak ditemukan pemberian/riwayat OAT, hasil penunjang tertulis TCM-TB/BTA negatif, dan resume mencatat "${suspectTbEvidence.length ? 'Suspek TB' : 'tanpa konfirmasi TB'}".`
      : !oatPassed
      ? `Kode ${tbCodes.join(', ')} diajukan, tetapi pemberian atau riwayat Obat Anti Tuberkulosis (OAT: RHZE/RHZ/FDC/KDT/Rifampicin/INH/Pyrazinamide/Ethambutol) belum terbaca pada resume, terapi, maupun billing.`
      : !subcodePassed && hasA152
      ? `Terapi OAT${sitbNumber ? ` dan Register SITB (${sitbNumber})` : ''} terbaca, tetapi klaim menggunakan kode A15.2 (TB paru terkonfirmasi histologis/PA) sementara dokumen mencatat ${clinicalTbOnlyWritten ? '"TB Paru Klinis"' : (bactNegEvidence.length ? 'hasil TCM/BTA negatif' : 'konfirmasi klinis/radiologis')} tanpa bukti histopatologi/PA. Pertimbangkan A16.2 (atau A16.0 bila bakteriologis negatif).`
      : !subcodePassed && hasA15
      ? `Terapi OAT terbaca, tetapi kode ${tbCodes.join(', ')} mensyaratkan bukti konfirmasi bakteriologis (TCM MTB Detected / BTA positif / kultur) atau histologis. Pertimbangkan kelompok A16.– bila TB ditegakkan secara klinis/radiologis.`
      : !sitbPassed
      ? `Terapi OAT dan bukti klinis TB paru terbaca, tetapi Nomor Register SITB belum tercantum pada e-Klaim maupun berkas.`
      : `Diagnosis TB paru, terapi OAT (${clinicalOatEvidence.length ? 'catatan klinis' : ''}${clinicalOatEvidence.length && billingOatEvidence.length ? ' & ' : ''}${billingOatEvidence.length ? 'billing' : ''}), penunjang, kesesuaian subkode ${tbCodes.join(', ')}, dan Register SITB (${sitbNumber}) terpenuhi.`;

    const recommendations = [
      ...(!oatPassed ? [
        'Pastikan pemberian atau riwayat Obat Anti Tuberkulosis (OAT: paket KDT/FDC RHZE/RHZ, DOTS, Rifampicin, Isoniazid/INH, Pyrazinamide, Ethambutol) tercatat pada resume medis, lembar pemberian obat, atau rincian billing.',
      ] : []),
      ...(bactNegConflict || suspectOnlyConflict ? [
        `Hasil penunjang menunjukkan TCM-TB "MTB NOT DETECTED" / BTA negatif dan diagnosis pada resume masih tertulis Suspek TB tanpa terapi OAT. Kode ${tbCodes.join(', ')} tidak dapat digunakan; gunakan kode diagnosis definitif yang tegak (mis. J18.0 Bronchopneumonia sesuai ekspertise toraks) atau Z03.0 (Observasi suspek TB).`,
      ] : []),
      ...(!subcodePassed && hasA15 && !bactNegConflict ? [
        `Subkode A15.– khusus untuk TB paru yang terkonfirmasi bakteriologis (A15.0 BTA+, A15.1 kultur+, A15.3 TCM+) atau histologis/PA (A15.2). Bila ditegakkan sebagai TB paru klinis/radiologis tanpa konfirmasi bakteriologis/histologis, sesuaikan ke A16.2 (atau A16.0 bila TCM/BTA negatif).`,
      ] : []),
      ...(!sitbPassed ? [
        'Lengkapi Nomor Register SITB pada e-Klaim sesuai ketentuan pelaporan wajib kasus Tuberkulosis (Permenkes 67/2016 & PNPK TB).',
      ] : []),
    ];

    checks.push({
      id: 'MED-TB',
      title: `Validasi Terapi OAT & Klinis TB Paru (${tbCodes.join(', ') || 'A15/A16'})`,
      status: tbStatus,
      summary,
      source: 'KMK HK.01.07/MENKES/755/2019 (PNPK Tata Laksana Tuberkulosis); Permenkes 67/2016; WHO ICD-10 2010 (A15–A16)',
      recommendations,
      parameters: [
        `Kode TB pada klaim: ${tbCodes.join(', ') || '-'}`,
        `Terapi OAT: ${oatPassed ? (clinicalOatEvidence.length && billingOatEvidence.length ? 'Tercatat di klinis & billing' : clinicalOatEvidence.length ? 'Tercatat di dokumen klinis (on OAT / DOTS)' : 'Tercatat di billing') : 'Tidak ditemukan'}`,
        `Nomor Register SITB: ${sitbNumber || 'Belum tercantum'}`,
        bactPosEvidence.length ? 'Mikrobiologi TB: TCM/BTA Positif' : bactNegEvidence.length ? 'Mikrobiologi TB: TCM MTB Not Detected / BTA Negatif' : histologyEvidence.length ? 'Histopatologi TB: Positif' : radiologyEvidence.length ? 'Penunjang TB: Foto Toraks mendukung TB' : 'Penunjang TB: Belum terbaca',
      ],
      evidence: [
        ...definitiveTbEvidence,
        ...suspectTbEvidence,
        ...clinicalOatEvidence,
        ...workupEvidence,
      ].slice(0, 6),
      details: [
        {
          label: 'Diagnosis TB paru definitif pada resume/CPPT (bukan sekadar Suspek TB)',
          passed: diagnosisPassed,
          snippets: definitiveTbEvidence.length ? definitiveTbEvidence : suspectTbEvidence,
        },
        {
          label: 'Pemberian / riwayat Obat Anti Tuberkulosis (OAT: RHZE/RHZ/FDC/KDT/DOTS/Rifampicin/INH)',
          passed: oatPassed,
          snippets: clinicalOatEvidence.length ? clinicalOatEvidence : billingOatEvidence,
          billing: !clinicalOatEvidence.length && billingOatEvidence.length > 0,
        },
        ...(billingOatEvidence.length > 0 ? [{
          label: 'Paket OAT / DOTS tercatat pada rincian billing farmasi',
          passed: true,
          snippets: billingOatEvidence,
          billing: true,
        }] : []),
        {
          label: hasA15
            ? 'Bukti penunjang konfirmasi bakteriologis (TCM/BTA/Kultur positif) atau histopatologi (PA)'
            : 'Bukti penunjang Foto Toraks / mikrobiologi mendukung TB paru',
          passed: workupPassed,
          snippets: workupEvidence,
        },
        {
          label: hasA152
            ? 'Kesesuaian subkode A15.2 (wajib konfirmasi histologis/PA; gunakan A16.2 bila TB klinis)'
            : hasA15
            ? `Kesesuaian subkode ${tbCodes.join(', ')} (wajib konfirmasi bakteriologis/histologis positif)`
            : `Kesesuaian subkode ${tbCodes.join(', ')} (TB paru klinis/radiologis)`,
          passed: subcodePassed,
          snippets: hasA15 && !subcodePassed ? (bactNegEvidence.length ? bactNegEvidence : definitiveTbEvidence) : workupEvidence,
        },
        {
          label: `Nomor Register SITB tercantum (${sitbNumber || 'belum terbaca'})`,
          passed: sitbPassed,
          snippets: sitbEvidence,
          grouping: !sitbEvidence.length && sitbPassed,
        },
      ],
    });
  }

  const specificRuleIds = new Set(['JKN-DOC-12', 'JKN-DOC-06', 'JKN-DOC-08', 'JKN-DOC-DIARE-01', 'JKN-DOC-ELEKTROLIT-NA', 'JKN-DOC-ELEKTROLIT-K', 'JKN-COD-72', 'JKN-PNPK-TB']);
  referenceRules.forEach((rule) => {
    if (rule.id === 'JKN-ADM-01' && deathAssessment) {
      const { hasConflict, recordedStatus, evidence } = deathAssessment;
      const evidenceFound = evidence.length > 0;
      checks.push({
        id: 'MED-JKN-ADM-01',
        title: hasConflict ? 'Status pulang berbeda dengan bukti meninggal' : rule.title,
        status: !hasConflict && evidenceFound ? 'SESUAI' : 'PERLU_VALIDASI',
        summary: hasConflict
          ? `${recordedStatus ? `Status pulang tercatat “${recordedStatus}”` : 'Status pulang berbeda antar dokumen'}, sementara PDF memuat bukti meninggal. Cocokkan dengan dokumen asli dan koreksi status pulang bila terkonfirmasi.`
          : evidenceFound ? 'PDF memuat bukti pasien meninggal.' : 'Status pulang tercatat meninggal. Periksa bukti pada resume medis atau surat keterangan kematian.',
        source: rule.source,
        evidence: evidence.slice(0, 3),
        details: [
          { label: 'Bukti meninggal pada dokumen episode', passed: evidenceFound, snippets: evidence.slice(0, 3) },
          { label: 'Kesesuaian status pulang dengan dokumen asli', passed: !hasConflict },
        ],
      });
      return;
    }
    if (rule.id === 'JKN-DOC-12' && sttTriggered) return;
    if (rule.id === 'JKN-DOC-06' && encephalopathyTriggered) return;
    if (specificRuleIds.has(rule.id) && checks.some((check) => ({
      'JKN-DOC-08': 'MED-PNEUMONIA',
      'JKN-DOC-DIARE-01': 'MED-DIARE-RANAP',
      'JKN-DOC-ELEKTROLIT-NA': 'MED-HIPONATREMIA',
      'JKN-DOC-ELEKTROLIT-K': 'MED-HIPOKALEMIA',
      'JKN-COD-72': 'MED-VENTILATOR',
      'JKN-PNPK-TB': 'MED-TB',
    })[rule.id] === check.id)) return;
    const hardRule = JKN_CLINICAL_HARD_RULES[rule.id];
    // Dokumen IGD sering memuat resume/triase setelah daftar obat atau kata
    // "farmasi". Gunakan teks lengkap agar bukti klinis berbahasa Indonesia
    // tidak ikut terpotong sebagai bagian billing.
    const evaluationText = rule.id === 'JKN-DOC-14' && !sections.clinical ? text : clinicalText;
    const parameterEvaluation = evaluateClinicalParameterSchema(rule.id, evaluationText);
    if (!hardRule && !parameterEvaluation) return;
    const results = (hardRule?.criteria || []).map(([label, pattern]) => {
      let snippets = evidenceSnippets(evaluationText, pattern, 2);
      if (rule.id === 'JKN-PNPK-HF-01' && label === 'Nilai EF/disfungsi atau kelainan struktural') {
        const efSnippets = evidenceSnippets(evaluationText, /\b(?:lvef|ef)\s*[:=]?\s*\d{1,2}\s*%|fraksi\s+ejeksi\s*[:=]?\s*\d{1,2}\s*%/i, 2);
        snippets = [...new Set([...efSnippets, ...snippets])].slice(0, 2);
      }
      return { label, passed: snippets.length > 0, snippets };
    });
    const passedCount = results.filter((result) => result.passed).length;
    const respiratoryThreshold = parameterEvaluation?.calculated.find((item) => item.name === 'Kriteria PaO2');
    const respiratoryTherapy = results.find((item) => item.label === 'Oksigen tinggi/ventilator')?.passed;
    const isVitrectomyRule = rule.id === 'JKN-DOC-21';
    const vitrectomyIndicationFound = results.find((item) => item.label === 'Indikasi vitreoretinal')?.passed || false;
    const careType = String(claim.layanan || claim.ptd || claim.PTD || '').trim();
    const isInpatient = /rawat\s*inap|ranap|ritl|inpatient|^ri$|^1$/i.test(careType);
    const inpatientReasonFound = /(?:perlu|memerlukan|membutuhkan|butuh)[^.;]{0,50}(?:observasi|monitor(?:ing)?|pengawasan)|observasi\s+(?:ketat\s+)?(?:pasca|post)[- ]?operasi|monitor(?:ing)?\s+(?:ketat\s+)?(?:pasca|post)[- ]?operasi|kondisi\s+sistemik\s+(?:tidak\s+stabil|labil)|operasi\s+(?:lama|kompleks)|(?:anestesi\s+umum|general\s+anesthesia)[^.;]{0,60}(?:observasi|rawat\s+inap|monitor(?:ing)?)/i.test(clinicalText);
    const vitrectomyRecommendations = isVitrectomyRule ? [
      ...(!vitrectomyIndicationFound ? ['Cantumkan satu indikasi vitrektomi yang sesuai di resume/laporan operasi (untuk PDR, lihat pilihan PNPK di bawah).'] : []),
      ...(isInpatient && !inpatientReasonFound ? ['Jelaskan alasan pasien perlu rawat inap/observasi pascaoperasi dan kondisi yang membuat rawat jalan tidak sesuai. PNPK tidak menetapkan daftar syarat rawat inap yang kaku; sesuaikan dengan kondisi pasien.'] : []),
    ] : [];
    const dmRecommendations = rule.id === 'JKN-PNPK-10' ? [
      'Cocokkan diagnosis pada resume medis dengan hasil laboratorium yang tersedia, seperti glukosa darah atau HbA1c.',
      'Jika klaim mencantumkan komplikasi DM, periksa apakah jenis komplikasi dan kaitannya dengan DM tercatat di rekam medis.',
    ] : [];
    const vitrectomyPdrIndications = isVitrectomyRule && !vitrectomyIndicationFound ? [
      'Perdarahan vitreus berat dan berlangsung lama.',
      'Ablasio retina traksional yang melibatkan atau mengancam makula.',
      'Ablasio retina kombinasi traksional dan regmatogen.',
      'Edema makula difus akibat traksi hyaloid posterior.',
      'Perdarahan vitreus signifikan berulang meski sudah dilakukan PRP maksimal.',
    ] : [];
    const passed = isVitrectomyRule
      ? vitrectomyRecommendations.length === 0
      : rule.id === 'JKN-DOC-07'
      ? respiratoryThreshold?.result === 'MEMENUHI_AMBANG' && respiratoryTherapy
      : passedCount >= (hardRule?.minimum || 1);
    const source = rule.source || rule.legalBasis || 'Katalog verifikasi medis JKN';
    const extractedParameters = parameterEvaluation?.parameters.filter((parameter) => parameter.values.length) || [];
    const calculatedEvidence = parameterEvaluation?.calculated.map((item) => `${item.name}: ${item.value ?? '-'} (${item.result}) • ${item.source}`) || [];
    const parameters = [
      ...extractedParameters.map((parameter) => `${parameter.name}: ${parameter.values.slice(0, 4).join(', ')}`),
      ...calculatedEvidence,
    ];
    const genericRecommendations = dmRecommendations.length
      ? dmRecommendations
      : !results.length && !vitrectomyRecommendations.length
      ? (rule.clinicalChecks || [])
      : vitrectomyRecommendations;
    const summary = isVitrectomyRule
      ? vitrectomyRecommendations.length ? 'Lengkapi indikasi tindakan dan/atau alasan rawat inap yang belum tercatat.' : 'Indikasi tindakan dan alasan perawatan telah terdeteksi; validasi akhir tetap pada dokter dan koder.'
      : rule.id === 'JKN-DOC-07'
      ? `Gagal napas: PaO2 <60 mmHg dan bukti terapi respirasi wajib; ${parameterEvaluation?.extractedCount || 0} parameter terstruktur ditemukan.`
      : results.length === 0
      ? (parameterEvaluation?.extractedCount
        ? `${parameterEvaluation.extractedCount} parameter klinis terdeteksi dari teks; cocokkan rincian parameter dengan dokumen sumber.`
        : 'Belum ada parameter klinis spesifik yang terbaca otomatis; cocokkan indikator klinis pada dokumen sumber.')
      : `${passedCount} dari ${results.length} unsur klinis dan ${parameterEvaluation?.extractedCount || 0} parameter terstruktur ditemukan OCR.`;
    checks.push({
      id: `MED-${rule.id}`,
      title: rule.title,
      status: passed ? 'SESUAI' : 'PERLU_VALIDASI',
      summary,
      recommendations: genericRecommendations,
      parameters,
      source,
      vitrectomyPdrIndications,
      evidence: [
        `Acuan: ${source}`,
        ...results.filter((result) => result.passed).flatMap((result) => result.snippets.length
          ? result.snippets.map((snippet) => `${result.label}: ${snippet}`)
          : [`${result.label}: Ditemukan`]),
        ...extractedParameters.map(({ name, values }) => `${name}: ${values.join(', ')}`),
      ].filter(Boolean),
      details: [
        ...results
      ],
    });
  });
  return checks;
};

