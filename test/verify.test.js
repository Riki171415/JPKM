import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => String(url).startsWith('file:')
  ? new Response(await readFile(fileURLToPath(url)))
  : nativeFetch(url, ...rest);

const { parseGroupingText, findBillingTotal, claimMeta, auditConsistency } = await import('../static/claimInfo.js');
const { inspect, adminRows, codingRows, medicalRows, medicalRuleIdOf, procedureReferencesFor, resolveIcdDescription } = await import('../static/rules.js');
const { extractLeukocyteValues } = await import('../static/akurat/utils/clinicalLabParser.js');
const { evaluateEsiTriage } = await import('../static/akurat/utils/esiTriage.js');
const { evaluatePpkPreClaimRules } = await import('../static/akurat/utils/ppkPreClaimAnalyzer.js');
const { getTriggeredJknDocumentRules } = await import('../static/akurat/data/jknDocumentRules.js');
const { evaluatePreClaimMedicalCriteria } = await import('../static/akurat/utils/evaluatePreClaimMedicalCriteria.js');
const { assessClaimDeathEvidence } = await import('../static/akurat/utils/claimDeathEvidence.js');
const { evaluateDiabetesCodingAudit } = await import('../static/akurat/utils/diabetesCodingAudit.js');
const { evaluateProcedureDocumentation } = await import('../static/akurat/utils/procedureDocumentationAudit.js');
const { evaluateAuditCodingRules } = await import('../static/akurat/utils/auditCodingEngine.js');
const { DEFAULT_AUDIT_RULES } = await import('../static/akurat/data/defaultAuditRules.js');
const { groupAuditByService } = await import('../static/akurat/utils/auditServiceGroups.js');
const { getAuditRuleReferences, getMedicalRuleReferences } = await import('../static/akurat/utils/ruleReferences.js');
const { openPdf, createOcr, inspectPdf, pagePreview } = await import('../server/pdf.js');
const { createApplication } = await import('../server/index.js');

const extractDir = 'C:\\Users\\PUSBIKES-KEMKES\\.gemini\\antigravity\\brain\\9a675330-bb37-4296-bf1d-b80b38204423\\scratch\\extract';
const pdfDir = 'C:\\Users\\PUSBIKES-KEMKES\\Downloads\\JPKM Jabar';

test('claimInfo: parseGroupingText mempertahankan deskripsi CBG yang memuat kata PROSEDUR', () => {
  const sample = `
    KEMENTERIAN KESEHATAN REPUBLIK INDONESIA   SKTM
    Berkas Klaim Individual Pasien   09/10/2026
    Kode Rumah Sakit : 3204086   Kelas Rumah Sakit : B
    Nama RS : RSUD WELAS ASIH   Jenis Tarif : TARIF RS KELAS B PEMERINTAH
    Nomor Rekam Medis : 01117873   Tanggal Masuk : 02/10/2026
    Umur Tahun : 0   Tanggal Keluar : 09/10/2026
    Umur Hari : 267   Jenis Perawatan : 1 - Rawat Inap
    Cara Pulang : 1 - Atas Persetujuan Dokter   LOS : 8 hari
    Diagnosa Utama : J96.0 Acute respiratory failure
    Prosedur : 96.71 Continuous mechanical ventilation
    Hasil Grouping
    INA-CBG : J-1-20-III PROSEDUR SISTEM PERNAFASAN NON-KOMPLEKS (BERAT) Rp 31,562,600.00
    Total Tarif : Rp 31,562,600.00
  `;
  const parsed = parseGroupingText(sample);
  assert.equal(parsed.umurTahun, 0);
  assert.equal(parsed.cbg, 'J-1-20-III');
  assert.equal(parsed.cbgDescription, 'PROSEDUR SISTEM PERNAFASAN NON-KOMPLEKS (BERAT)');
  assert.equal(parsed.tarif, 31562600);
  assert.equal(parsed.kelasRS, 'B');
  assert.equal(parsed.kelasTarif, 'B');
});

test('claimInfo: findBillingTotal mendukung format 6 RS dan memilih total terbesar', () => {
  assert.equal(findBillingTotal([{ file: 0, number: 1, text: 'Grand total Rp 8,959,387' }]).amount, 8959387);
  assert.equal(findBillingTotal([{ file: 0, number: 1, text: 'Total Pembayaran Sub Total : 41,572,396 Biaya Administrasi: 0' }]).amount, 41572396);
  assert.equal(findBillingTotal([
    { file: 0, number: 3, text: 'TOTAL SELURUH 1.307.744' },
    { file: 0, number: 8, text: 'TOTAL SELURUH 11.936.318' },
  ]).amount, 11936318);
  assert.equal(findBillingTotal([{ file: 0, number: 1, text: 'TAGIHAN+PPN : 1,821,972' }]).amount, 1821972);
  assert.equal(findBillingTotal([{ file: 0, number: 1, text: '7.176.842 Total RS : Rp.' }]).amount, 7176842);
  assert.equal(findBillingTotal([{ file: 0, number: 1, text: 'KWITANSI RAWAT JALAN Subtotal :Rp. 144.261' }]).amount, 144261);
});

test('clinicalLabParser: menormalisasi satuan sel/uL tanpa kehilangan desimal', () => {
  const values = extractLeukocyteValues('Lekosit 9840 sel/uL\nLeukosit=3600 /ul\nLeukosit: 11.500 /mm3\nWBC 12.4 10^3/uL');
  assert.deepEqual(values.sort((a, b) => a - b), [3.6, 9.84, 11.5, 12.4]);
});

test('esiTriage: memilih baris yang tercentang pada template 5-baris dan tidak memicu False Emergency kosong', () => {
  const rsjk = `
    LEVEL TRIASE*
    ESI 1   GAWAT DARURAT KRITIS
    ESI 2   3   GAWAT DARURAT
    ESI 3   DARURAT TIDAK GAWAT
    ESI 4   DARURAT RINGAN TIDAK GAWAT
    ESI 5   TIDAK GAWAT DARURAT
  `;
  const r1 = evaluateEsiTriage(rsjk);
  assert.equal(r1.recordedLevel, 2);
  assert.equal(r1.falseEmergencyRecorded, false);

  const rsj = `EMERGENCY :   4   True Emergency   False Emergency`;
  const r2 = evaluateEsiTriage(rsj);
  assert.equal(r2.falseEmergencyRecorded, false);
});

test('ppkPreClaimAnalyzer & jknDocumentRules: tidak ada false positive HIV negatif, sae, dan template meninggal', () => {
  const sc = evaluatePpkPreClaimRules({
    claim: { layanan: 'Rawat Inap', diaglist: 'O82.9', proclist: '74.0' },
    documentText: 'Hasil Lab: Rapid HIV Negatif. Tindakan SC.',
  });
  const ppkSc = sc.find(item => item.id === 'PPK-SC');
  assert.equal(ppkSc.details.find(d => d.label.includes('HIV')).passed, false);

  const deathRules = getTriggeredJknDocumentRules({
    layanan: 'Rawat Inap',
    caraPulang: 'Atas Persetujuan Dokter',
    diaglist: 'A01.0',
    clinicalText: 'Cara Pulang : Izin Dokter Pindah RS Kondisi Pulang : Sembuh Meninggal < 48 jam Meninggal > 48 jam. Diagnosa: demam tifoid sae.',
  });
  assert.equal(deathRules.some(r => r.id === 'JKN-ADM-01'), false);
  assert.equal(deathRules.some(r => r.id === 'JKN-DOC-06'), false);
});

test('evaluatePreClaimMedicalCriteria: membaca PSI RISK CLASS IV / CURB-65 POIN 2 dan menduplikasi MED-PNEUMONIA dengan benar', () => {
  const claim = { layanan: 'Rawat Inap', diaglist: 'J18.9', proclist: '90.59' };
  const rules = getTriggeredJknDocumentRules({ ...claim, clinicalText: 'pneumonia CURB-65 POIN 2 PSI RISK CLASS IV' });
  const checks = evaluatePreClaimMedicalCriteria(claim, [{ index: 0 }], {
    0: { text: '[HALAMAN 1]\nDiagnosa: Pneumonia\nCURB-65 POIN 2 PSI RISK CLASS IV\nLeukosit 9.09\nBatuk, demam.\nFoto toraks: infiltrat.\nCeftriaxone 2x1 gr.' },
  }, rules, {
    clinical: 'diagnosa pneumonia curb-65 poin 2 psi risk class iv leukosit 9.09 batuk demam foto toraks infiltrat ceftriaxone',
    billing: 'ceftriaxone sodium injeksi',
  });
  const pneu = checks.find(c => c.id === 'MED-PNEUMONIA');
  assert.ok(pneu);
  assert.match(pneu.summary, /PSI: kelas\/nilai iv/i);
  assert.match(pneu.summary, /CURB-65: 2/i);
  assert.equal(checks.some(c => c.id === 'MED-JKN-DOC-08'), false);
});

test('claimDeathEvidence & MED-JKN-ADM-01: membedakan bukti meninggal afirmatif vs template, serta mendeteksi konflik status pulang', () => {
  for (const negativeText of [
    'Risiko meninggal dan riwayat keluarga meninggal.',
    'Pasien tidak meninggal.',
    'Cara Pulang: Sembuh / Dirujuk / Meninggal',
    'BILLING\nCara Pulang: Meninggal',
    'Resume medis\n☑ Pulang hidup   ☐ Meninggal',
    'Cara Pulang: ◉ Hidup  ○ Meninggal',
    'Cara Pulang: ① Sembuh ② Dirujuk ③ APS ④ Meninggal',
    'Surat Keterangan Kematian\nNama: ........\nTanggal Meninggal: ........',
  ]) {
    const res = assessClaimDeathEvidence({}, [negativeText]);
    assert.equal(res.shouldCheck, false, negativeText);
    assert.equal(res.hasConflict, false, negativeText);
  }

  for (const [text, certExpected] of [
    ['[HALAMAN 5] Resume medis\n☐ Pulang hidup   [x] Meninggal', false],
    ['[HALAMAN 5] Cara Pulang: ○ Hidup   ◉ Meninggal', false],
    ['[HALAMAN 5] Cara Pulang: 1. Sembuh 2. Dirujuk 3. APS ④ Meninggal', false],
    ['[HALAMAN 5] Pasien dinyatakan meninggal pada pukul 14.30.', false],
    ['[HALAMAN 5] Surat Keterangan Kematian\nNama Pasien: Budi\nTanggal Meninggal: 20/11/2026', true],
    ['[HALAMAN 5] LAPORAN KEMATIAN\n11.55 pasien dinyatakan meninggal dunia', true],
  ]) {
    const claim = { dischargeStatus: '1' };
    const deathAssessment = assessClaimDeathEvidence(claim, [text]);
    assert.equal(deathAssessment.shouldCheck, true, text);
    assert.equal(deathAssessment.hasConflict, true, text);
    assert.equal(deathAssessment.certificateFound, certExpected, text);
    const rules = getTriggeredJknDocumentRules(claim, deathAssessment);
    const check = evaluatePreClaimMedicalCriteria(claim, [], {}, rules, {}, deathAssessment)
      .find(c => c.id === 'MED-JKN-ADM-01');
    assert.equal(check?.status, 'PERLU_VALIDASI');
  }

  const consistent = assessClaimDeathEvidence({ caraPulang: 'Meninggal Dunia' }, ['[HALAMAN 9] Keadaan saat keluar Rumah Sakit Meninggal']);
  assert.equal(consistent.hasConflict, false);
  const rules = getTriggeredJknDocumentRules({ caraPulang: 'Meninggal Dunia' }, consistent);
  const passedCheck = evaluatePreClaimMedicalCriteria({ caraPulang: 'Meninggal Dunia' }, [], {}, rules, {}, consistent)
    .find(c => c.id === 'MED-JKN-ADM-01');
  assert.equal(passedCheck?.status, 'SESUAI');
});

test('diabetesCodingAudit: AUDIT-DM-E117/E118, komplikasi terhubung, DU vs DS, tanpa duplikasi di codingRows', () => {
  assert.ok(DEFAULT_AUDIT_RULES.some(r => r.id === 'AUDIT-DM-E117'));
  assert.ok(DEFAULT_AUDIT_RULES.some(r => r.id === 'AUDIT-DM-E118'));

  const resume = (diagnosis, partial = false) => ({ text: `[HALAMAN 3] RESUME MEDIS\nDiagnosis akhir: ${diagnosis}`, partial });
  const [plain] = evaluateDiabetesCodingAudit({ diaglist: 'E11.7' }, [resume('Diabetes melitus tipe 2')]);
  assert.equal(plain.needsReview, true);
  assert.match(plain.warning, /pertimbangkan E11\.9/i);

  const [single] = evaluateDiabetesCodingAudit({ diaglist: 'E11.8' }, [resume('DM tipe 2 dengan nefropati diabetik')]);
  assert.equal(single.needsReview, true);
  assert.match(single.warning, /pertimbangkan E11\.2/i);

  const multiDoc = resume('DM tipe 2 dengan nefropati dan retinopati diabetik');
  const [secondaryMulti] = evaluateDiabetesCodingAudit({ diaglist: 'I10,E11.7' }, [multiDoc]);
  assert.equal(secondaryMulti.needsReview, false);
  const [primaryMulti] = evaluateDiabetesCodingAudit({ diaglist: 'E11.7,I10' }, [multiDoc]);
  assert.equal(primaryMulti.needsReview, true);

  for (const ambiguousDoc of [
    resume('DM tipe 2', true),
    resume('DM tipe 2; CKD; hipertensi'),
    resume('DM tipe 2; tidak ada nefropati diabetik'),
  ]) {
    const [amb] = evaluateDiabetesCodingAudit({ diaglist: 'E11.7' }, [ambiguousDoc]);
    assert.equal(amb.needsReview, true);
    assert.doesNotMatch(amb.warning, /E11\.9/);
  }

  const fakeEp = {
    docs: [{
      index: 0,
      name: 'dm-test.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nDiagnosa Utama : I10\nDiagnosa Sekunder : E11.7', layout: '' },
        { number: 3, text: 'RESUME MEDIS\nDiagnosis akhir: DM tipe 2 dengan nefropati dan retinopati diabetik', layout: '' },
      ],
    }],
  };
  const dmRows = codingRows(inspect(fakeEp), {}).filter(r => r.id === 'AUDIT-DM-E117');
  assert.equal(dmRows.length, 1);
  assert.equal(dmRows[0].status, 'Sesuai');
  assert.equal(dmRows[0].automatic, false);
});

test('procedureDocumentationAudit & procedureReferenceIndex: aturan spesifik 03.31/03.32, batal generik, tanpa spam rutin', () => {
  const [okTap] = evaluateProcedureDocumentation({ proclist: '03.31' }, ['[HALAMAN 8] Laporan tindakan\nDilakukan punksi lumbal dan diperoleh cairan serebrospinal.']);
  assert.equal(okTap.needsReview, false);

  for (const text of [
    '[HALAMAN 1] Berkas Klaim Individual Pasien\nLaporan tindakan\nDilakukan pungsi lumbal',
    '[HALAMAN 3] Laporan tindakan\nPungsi lumbal direncanakan.',
    '[HALAMAN 4] Laporan tindakan\nPungsi lumbal tidak dilakukan.',
    '[HALAMAN 3] Laporan tindakan\nDilakukan pungsi lumbal.\nDilakukan injeksi kontras untuk mielografi.',
  ]) {
    const [badTap] = evaluateProcedureDocumentation({ proclist: '03.31' }, [text]);
    assert.equal(badTap.needsReview, true, text);
  }

  assert.equal(evaluateProcedureDocumentation({ proclist: '03.32' }, ['[HALAMAN 4] Laporan operasi\nDilakukan biopsi lesi medula spinalis.'])[0].needsReview, false);
  assert.equal(evaluateProcedureDocumentation({ proclist: '03.32' }, ['[HALAMAN 4] Laporan operasi\nDilakukan biopsi jaringan vertebra.'])[0].needsReview, true);

  const cancelledEp = {
    docs: [{
      index: 0,
      name: 'proc-cancel.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nDiagnosa Utama : A09.9\nProsedur : 90.59, 87.44, 03.31, 39.95', layout: '' },
        { number: 4, text: 'Laporan tindakan\nDilakukan punksi lumbal dan diperoleh cairan.\n39.95 hemodialisis tidak dilakukan karena batal.', layout: '' },
      ],
    }],
  };
  const procRows = codingRows(inspect(cancelledEp), {});
  assert.equal(procRows.find(r => r.id === 'AUDIT-ICD9-03.31')?.status, 'Sesuai');
  assert.equal(procRows.find(r => r.id === 'AUDIT-ICD9-39.95')?.status, 'Perlu klarifikasi');
  assert.equal(procRows.find(r => r.id === 'AUDIT-ICD9-39.95')?.automatic, true);
  assert.equal(procRows.some(r => r.id === 'AUDIT-ICD9-90.59'), false);
  assert.equal(procRows.some(r => r.id === 'AUDIT-ICD9-87.44'), false);

  const ingenix = procedureReferencesFor('96.71');
  assert.equal(ingenix.length, 1);
  assert.equal(ingenix[0].code, '96.71');
  assert.ok(ingenix[0].matches[0].page > 0);
});

test('auditCodingEngine, auditServiceGroups & ruleReferences: custom_los, PTD filter, dan rujukan resmi terstruktur', () => {
  const ventShort = evaluateAuditCodingRules({ diaglist: 'J96.0', proclist: '96.72', layanan: 'Rawat Inap', los: 2 }, DEFAULT_AUDIT_RULES);
  assert.ok(ventShort.some(f => f.ruleId === 'AUDIT-COD-71'));
  const ventLong = evaluateAuditCodingRules({ diaglist: 'J96.0', proclist: '96.72', layanan: 'Rawat Inap', los: 5 }, DEFAULT_AUDIT_RULES);
  assert.equal(ventLong.some(f => f.ruleId === 'AUDIT-COD-71'), false);

  const kuretRj = evaluateAuditCodingRules({ diaglist: 'O02.0', proclist: '69.01', layanan: 'Rawat Jalan' }, DEFAULT_AUDIT_RULES);
  assert.equal(kuretRj.some(f => f.ruleId === 'AUDIT-COD-70'), false);
  const kuretRi = evaluateAuditCodingRules({ diaglist: 'O02.0', proclist: '69.01', layanan: 'Rawat Inap' }, DEFAULT_AUDIT_RULES);
  assert.ok(kuretRi.some(f => f.ruleId === 'AUDIT-COD-70'));

  const groups = groupAuditByService(
    [{ sep: 'S1', PTD: '2', ruleId: 'AUDIT-COD-65' }, { sep: 'S2', PTD: '1', ruleId: 'AUDIT-COD-65' }],
    [],
    { excludeOutpatientEcho: true },
  );
  assert.deepEqual(groups.find(g => g.id === 'rj')?.findings || [], []);
  assert.equal(groups.find(g => g.id === 'ri')?.findings.length, 1);

  const [dmRef] = getAuditRuleReferences('AUDIT-DM-E117');
  assert.match(dmRef.label, /WHO ICD-10 2010/i);
  assert.match(dmRef.url, /^https:\/\//);
  const [pneuRef] = getMedicalRuleReferences({ id: 'MED-PNEUMONIA' });
  assert.match(pneuRef.label, /2147\/2023/i);
});

test('resolveIcdDescription & icd-dictionary.json: resolusi deskripsi dari PDF, normalisasi titik, fallback kamus & opsi exact', async () => {
  const dictPath = join(process.cwd(), 'public', 'assets', 'icd-dictionary.json');
  const dict = JSON.parse(await readFile(dictPath, 'utf8'));
  assert.ok(Object.keys(dict).length > 40000);
  assert.ok(dict['J96.0']);
  assert.ok(dict['E11.9']);
  assert.ok(dict['96.71']);
  assert.ok(dict['03.31']);

  // Prioritaskan deskripsi e-Klaim PDF dibanding kamus fallback
  assert.equal(resolveIcdDescription('J96.0', { 'J96.0': 'Acute respiratory failure' }, dict), 'Acute respiratory failure');
  // Normalisasi kode tanpa titik
  assert.equal(resolveIcdDescription('J960', {}, dict), dict['J96.0']);
  assert.equal(resolveIcdDescription('9671', {}, dict), dict['96.71']);
  // Fallback ke kategori 3 karakter saat !exact, dan kosong saat exact: true
  assert.equal(resolveIcdDescription('J96.99', {}, { J96: 'Respiratory failure' }), 'Respiratory failure');
  assert.equal(resolveIcdDescription('J96.99', {}, { J96: 'Respiratory failure' }, { exact: true }), '');
});

test('MED-VENTILATOR (96.71 / 96.72): validasi indikasi klinis, syarat invasif ETT vs NIV, durasi/LOS, dan informed consent', () => {
  assert.equal(medicalRuleIdOf('MED-VENTILATOR'), 'JKN-COD-72');

  const okEp = {
    docs: [{
      index: 0,
      name: 'vent-ok.pdf',
      pages: [
        {
          number: 1,
          text: 'Berkas Klaim Individual Pasien\nDiagnosa Utama : G40.9 Status epileptikus\nProsedur : 96.71 Continuous invasive mechanical ventilation for less than 96 consecutive hours\nLOS : 3 hari\nJenis Perawatan : 1 - Rawat Inap',
          layout: '',
        },
        {
          number: 2,
          text: 'Resume medis PICU\nIndikasi rawat ICU: gagal napas hipoksemia dengan SpO2 78%.\nDilakukan intubasi ETT no 5.\nVentilator mode PC AC PEEP 6 FiO2 80% RR 24.\nLama pemakaian ventilator 24 jam sebelum ekstubasi.\nPersetujuan tindakan intubasi dan ventilator ditandatangani keluarga.',
          layout: '',
        },
        {
          number: 3,
          text: 'Rincian biaya layanan ICU\nPemasangan Ventilator 1\nIntubasi ETT 1',
          layout: '',
        },
      ],
    }],
  };
  const okMed = medicalRows(inspect(okEp), {});
  const okVent = okMed.find(r => r.id === 'MED-VENTILATOR');
  assert.equal(okVent?.status, 'Sesuai');
  assert.equal(okVent?.automatic, false);
  assert.equal(okMed.some(r => r.id === 'MED-JKN-COD-72'), false);
  assert.ok(okVent?.checklist?.every(item => item.detected));

  const badLosEp = {
    docs: [{
      index: 0,
      name: 'vent-bad-los.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nDiagnosa Utama : J96.0\nProsedur : 96.72\nLOS : 2 hari\nJenis Perawatan : 1 - Rawat Inap', layout: '' },
        { number: 2, text: 'Resume medis ICU\nGagal napas akut, dilakukan intubasi ETT, terpasang ventilator PEEP 6 FiO2 100%, persetujuan tindakan intubasi (+) .', layout: '' },
      ],
    }],
  };
  const badLosVent = medicalRows(inspect(badLosEp), {}).find(r => r.id === 'MED-VENTILATOR');
  assert.equal(badLosVent?.status, 'Tidak sesuai');
  assert.equal(badLosVent?.automatic, true);
  assert.match(badLosVent?.summary || '', /96\.71/);

  const nivEp = {
    docs: [{
      index: 0,
      name: 'vent-niv.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nDiagnosa Utama : J96.0\nProsedur : 96.71\nLOS : 3 hari\nJenis Perawatan : 1 - Rawat Inap', layout: '' },
        { number: 2, text: 'Resume medis\nPasien sesak napas berat dan hipoksemia, dipasang CPAP non-invasif selama 12 jam di HCU.', layout: '' },
      ],
    }],
  };
  const nivVent = medicalRows(inspect(nivEp), {}).find(r => r.id === 'MED-VENTILATOR');
  assert.equal(nivVent?.status, 'Tidak sesuai');
  assert.equal(nivVent?.automatic, true);
  assert.match(nivVent?.summary || '', /93\.90/);

  const incompleteEp = {
    docs: [{
      index: 0,
      name: 'vent-incomplete.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nDiagnosa Utama : K30\nProsedur : 96.71\nLOS : 2 hari\nJenis Perawatan : 1 - Rawat Inap', layout: '' },
        { number: 2, text: 'Resume medis\nPasien dirawat di ruang ICU terpasang ventilator.', layout: '' },
      ],
    }],
  };
  const incompleteVent = medicalRows(inspect(incompleteEp), {}).find(r => r.id === 'MED-VENTILATOR');
  assert.equal(incompleteVent?.status, 'Perlu klarifikasi');
  assert.equal(incompleteVent?.automatic, true);
  assert.ok(incompleteVent?.references?.some(r => /1541\/2022/.test(r.label)));
  assert.ok(incompleteVent?.references?.some(r => /411\/BA\/0720/.test(r.label)));
});

test('MED-TB (JKN-PNPK-TB): validasi terapi OAT, Register SITB, penunjang TCM/BTA/Toraks, dan kesesuaian subkode A15.* vs A16.*', () => {
  const okA150Ep = {
    docs: [{
      index: 0,
      name: 'tb-bact-ok.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nNomor Register SITB : 2026000123456789\nDiagnosa Utama : A15.0 Tuberculosis of lung, confirmed by sputum microscopy\nJenis Perawatan : 1 - Rawat Inap', layout: '' },
        { number: 2, text: 'Resume Medis\nDiagnosis: TB Paru terkonfirmasi bakteriologis.\nPemeriksaan TCM-TB: MTB DETECTED.\nPewarnaan BTA Sputum: Positif (2+).\nTerapi: DOTS Paket OAT 4KDT (RHZE) 1x4 tab.', layout: '' },
        { number: 3, text: 'Rincian Biaya Pelayanan\nDOTS PAKET OAT KATEGORI 1 (RHZE)   1   0', layout: '' },
      ],
    }],
  };
  const okTb = medicalRows(inspect(okA150Ep), {}).find(r => r.id === 'MED-TB');
  assert.equal(okTb?.status, 'Sesuai');
  assert.equal(okTb?.automatic, false);
  assert.ok(okTb?.checklist?.every(item => item.detected));
  assert.ok(okTb?.references?.some(r => /755\/2019/.test(r.label)));

  const noOatNegTcmEp = {
    docs: [{
      index: 0,
      name: 'tb-no-oat-neg.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nNomor Register SITB : 2026000107500873\nDiagnosa Utama : R57.1\nDiagnosa Sekunder : A15.2\nJenis Perawatan : 1 - Rawat Inap', layout: '' },
        { number: 2, text: 'Resume Medis\nDiagnosa Sekunder: Susp TB dengan bronchopneumonia.\nPemeriksaan TCM - TB: MTB NOT DETECTED (Negatif).\nPewarnaan BTA SPUTUM: Tidak ditemukan bakteri tahan asam.\nObat Pulang: Levofloxacin 1x750 mg.', layout: '' },
      ],
    }],
  };
  const badTb = medicalRows(inspect(noOatNegTcmEp), {}).find(r => r.id === 'MED-TB');
  assert.equal(badTb?.status, 'Tidak sesuai');
  assert.equal(badTb?.automatic, true);
  assert.match(badTb?.summary || '', /tidak ditemukan pemberian\/riwayat OAT/i);
  assert.equal(badTb?.checklist?.find(c => c.label.includes('Obat Anti Tuberkulosis'))?.detected, false);

  const clinWrittenAsA152Ep = {
    docs: [{
      index: 0,
      name: 'tb-klinis-a152.pdf',
      pages: [
        { number: 1, text: 'Berkas Klaim Individual Pasien\nNomor Register SITB : 2026000107632266\nDiagnosa Utama : A15.2\nJenis Perawatan : 1 - Rawat Inap', layout: '' },
        { number: 2, text: 'Resume Medis\nDiagnosa Medis: TB PARU KLINIS KASUS BARU.\nRiwayat OAT -\nThorax PA: Tampak infiltrat dan kavitas, Kesimpulan: TB paru aktif.\nTerapi: DOTS. PAKET RHZE KAT 1 1x4 tab.', layout: '' },
      ],
    }],
  };
  const mismatchTb = medicalRows(inspect(clinWrittenAsA152Ep), {}).find(r => r.id === 'MED-TB');
  assert.equal(mismatchTb?.status, 'Perlu klarifikasi');
  assert.equal(mismatchTb?.automatic, true);
  assert.match(mismatchTb?.summary || '', /A16\.2/);
  assert.equal(mismatchTb?.checklist?.find(c => c.label.includes('Obat Anti Tuberkulosis'))?.detected, true);
  assert.equal(mismatchTb?.checklist?.find(c => c.label.includes('Kesesuaian subkode A15.2'))?.detected, false);
});

test('regression 19 PDF sampel dari Downloads\\JPKM Jabar', async (t) => {
  const hasExtracts = await access(extractDir).then(() => true, () => false);
  if (!hasExtracts) return t.skip('Folder cache ekstrak tidak tersedia.');
  const files = (await readdir(extractDir)).filter(n => n.endsWith('.json')).sort();
  assert.equal(files.length, 19);

  const byName = new Map();
  for (const file of files) {
    const data = JSON.parse(await readFile(join(extractDir, file), 'utf8'));
    const info = inspect({ docs: [{ index: 0, name: data.name, pages: data.pages }] });
    const adm = adminRows(info, {});
    const cod = codingRows(info, {});
    const med = medicalRows(info, {});
    byName.set(data.name, { info, adm, cod, med });

    assert.notEqual(info.age, '', `Usia harus terbaca untuk ${data.name}`);
    assert.ok(/^[A-Z]\d{2}/.test(info.primary), `Diagnosis utama harus terbaca untuk ${data.name}`);
    assert.ok(info.claim?.cbg, `Kode INA-CBG harus terbaca untuk ${data.name}`);
    assert.ok(info.cbgDescription, `Deskripsi INA-CBG harus terbaca untuk ${data.name}`);
    assert.ok(info.claim?.tarif > 0, `Tarif INA-CBG harus terbaca untuk ${data.name}`);
    assert.ok(info.billingTotal?.amount > 0, `Billing total harus terbaca untuk ${data.name}`);
    assert.ok(info.codeDescriptions[info.primary], `Deskripsi diagnosis utama harus terekstrak dari e-Klaim untuk ${data.name}`);
  }

  // Kasus spesifik terverifikasi
  const acute = byName.get('Acute respiratory (ada ETT).pdf');
  assert.equal(acute.info.age, '0');
  assert.equal(acute.info.codeDescriptions['J96.0'], 'Acute respiratory failure');
  assert.match(acute.info.codeDescriptions['A09.9'] || '', /Gastroenteritis/i);
  assert.match(acute.info.codeDescriptions['J18.0'] || '', /Bronchopneumonia/i);
  assert.match(acute.info.codeDescriptions['B05.9'] || '', /Measles/i);
  assert.match(acute.info.codeDescriptions['96.71'] || '', /mechanical ventilation/i);
  assert.match(acute.info.codeDescriptions['90.59'] || '', /Microscopic examination/i);
  const taufik = byName.get('RSJ - TAUFIK RAMDHANI.pdf');
  assert.match(taufik.info.codeDescriptions['F13.2'] || '', /dependence syndrome/i);
  const deathMismatch = acute.cod.find(r => r.id === 'discharge-death-mismatch');
  assert.equal(deathMismatch?.status, 'Perlu klarifikasi');
  assert.equal(deathMismatch?.automatic, true);
  assert.ok(deathMismatch?.refs?.some(ref => ref.number === 20));
  const acuteAdm01 = acute.med.find(r => r.id === 'MED-JKN-ADM-01');
  assert.equal(acuteAdm01?.status, 'Perlu klarifikasi');
  assert.equal(acuteAdm01?.automatic, true);
  assert.ok(acuteAdm01?.refs?.some(ref => ref.number === 20));
  const acutePneu = acute.med.find(r => r.id === 'MED-PNEUMONIA');
  assert.equal(acutePneu?.summary.includes('9.84'), true);
  assert.equal(acutePneu?.status, 'Tidak sesuai');
  assert.equal(acutePneu?.automatic, true);

  const acuteVent = acute.med.find(r => r.id === 'MED-VENTILATOR');
  assert.ok(acuteVent, 'Acute respiratory harus memiliki MED-VENTILATOR');
  assert.match(acuteVent.title, /96\.71/);
  assert.doesNotMatch(acuteVent.title, /trakeostomi|tracheostomy/i);
  assert.equal(acuteVent.status, 'Perlu klarifikasi');
  assert.equal(acuteVent.automatic, true);
  assert.equal(acute.med.some(r => r.id === 'MED-JKN-COD-72'), false);
  assert.ok(acuteVent.refs.some(r => r.number === 13));
  assert.ok(acuteVent.checklist.find(c => c.label.includes('Indikasi klinis'))?.detected);
  assert.ok(acuteVent.checklist.find(c => c.label.includes('antarmuka invasif'))?.detected);
  assert.ok(acuteVent.checklist.find(c => c.label.includes('pemantauan intensif'))?.detected);
  assert.ok(acuteVent.checklist.find(c => c.label.includes('billing/BHP'))?.detected);
  assert.ok(acuteVent.references?.some(r => /1541\/2022/.test(r.label)));
  assert.ok(acuteVent.references?.some(r => /411\/BA\/0720/.test(r.label)));

  for (const name of ['Hadi ranap.pdf', 'RSP - HADI PRAMONO.pdf']) {
    const entry = byName.get(name);
    const adm01 = entry.med.find(r => r.id === 'MED-JKN-ADM-01');
    assert.equal(adm01?.status, 'Sesuai', `MED-JKN-ADM-01 harus Sesuai di ${name}`);
    assert.equal(adm01?.automatic, false, `MED-JKN-ADM-01 tidak boleh flag di ${name}`);
    const vent = entry.med.find(r => r.id === 'MED-VENTILATOR');
    assert.ok(vent, `MED-VENTILATOR harus ada di ${name}`);
    assert.match(vent.title, /96\.71/);
    assert.doesNotMatch(vent.title, /trakeostomi|tracheostomy/i);
    assert.ok(vent.checklist.find(c => c.label.includes('Indikasi klinis'))?.detected);
    assert.ok(vent.checklist.find(c => c.label.includes('antarmuka invasif'))?.detected);
    assert.ok(vent.checklist.find(c => c.label.includes('informed consent'))?.detected);
    assert.ok(vent.checklist.find(c => c.label.includes('billing/BHP'))?.refs?.some(r => r.number === 2));
  }

  const dmCase = byName.get('getfilepasien (1).pdf');
  const dmAudit = dmCase.cod.find(r => r.id === 'AUDIT-DM-E117');
  assert.equal(dmAudit?.status, 'Perlu klarifikasi');
  assert.equal(dmAudit?.automatic, true);
  assert.ok(dmAudit?.refs?.some(ref => ref.number === 9));
  assert.match(dmAudit?.summary || '', /E11\.9/);
  assert.ok(dmAudit?.references?.some(ref => /WHO ICD-10 2010/i.test(ref.label)));
  const dmTb = dmCase.med.find(r => r.id === 'MED-TB');
  assert.ok(dmTb, 'getfilepasien (1).pdf harus memiliki MED-TB');
  assert.equal(dmTb.status, 'Perlu klarifikasi');
  assert.equal(dmTb.automatic, true);
  assert.equal(dmTb.checklist.find(c => c.label.includes('Obat Anti Tuberkulosis'))?.detected, true);
  assert.equal(dmTb.checklist.find(c => c.label.includes('billing farmasi'))?.detected, true);
  assert.equal(dmTb.checklist.find(c => c.label.includes('Kesesuaian subkode A15.2'))?.detected, false);
  assert.match(dmTb.summary, /A16\.2/);

  for (const name of ['Chellyne ranap.pdf', 'RSP - SONI UMBARA.pdf']) {
    const entry = byName.get(name);
    const tb = entry.med.find(r => r.id === 'MED-TB');
    assert.ok(tb, `MED-TB harus ada di ${name}`);
    assert.equal(tb.status, 'Sesuai', `MED-TB harus Sesuai di ${name}`);
    assert.equal(tb.automatic, false, `MED-TB tidak boleh flag di ${name}`);
    assert.ok(tb.checklist.every(c => c.detected), `Semua checklist MED-TB harus PASS di ${name}`);
  }

  const risman = byName.get('RSJ - RISMANWAN ARIYANDI.pdf');
  assert.equal(risman.info.primary, 'F20.0');
  assert.equal(risman.med.find(r => r.id === 'MED-ESI').summary.includes('Non-emergency'), false);

  const bunga = byName.get('Bunga Cantika.pdf');
  assert.ok(bunga.cod.some(r => r.id === 'tariff-class-mismatch'));

  const muslim = byName.get('Muhamad Muslim.pdf');
  assert.ok(muslim.cod.some(r => r.id === 'tariff-class-mismatch'));

  const salma = byName.get('RSWA - By Ny SALMA NOVIYANTI.pdf');
  assert.deepEqual(salma.info.consistency.wrongPatientPages.map(p => p.number), [10, 11, 12]);
  assert.ok(salma.adm.some(r => r.id === 'patient-mismatch'));
  assert.ok(salma.adm.some(r => r.id === 'gender-mismatch'));
  assert.equal(salma.med.some(r => r.id === 'MED-JKN-ADM-01'), false);

  const rahmat = byName.get('RSJK - RAHMAT.pdf');
  for (const id of ['grouping', 'resume', 'billing', 'identity']) {
    assert.equal(rahmat.adm.find(r => r.id === id)?.status, 'Sesuai', `${id} harus berstatus Sesuai di RSJK - RAHMAT.pdf`);
  }
  assert.equal(rahmat.adm.find(r => r.id === 'jkn')?.status, 'Perlu klarifikasi');
  const rahmatPbiNonTb = [
    ...adminRows(rahmat.info, { category: 'pbi' }),
    ...rahmat.cod,
    ...rahmat.med.filter(r => r.id !== 'MED-TB'),
  ];
  assert.equal(rahmatPbiNonTb.some(r => r.automatic || r.status !== 'Sesuai'), false, 'RSJK - RAHMAT.pdf selain temuan MED-TB harus 0 temuan meragukan');
  const rahmatTb = rahmat.med.find(r => r.id === 'MED-TB');
  assert.ok(rahmatTb, 'RSJK - RAHMAT.pdf harus memicu MED-TB karena A15.2 tanpa OAT dan TCM negatif');
  assert.equal(rahmatTb.status, 'Tidak sesuai');
  assert.equal(rahmatTb.automatic, true);
  assert.equal(rahmatTb.checklist.find(c => c.label.includes('Obat Anti Tuberkulosis'))?.detected, false);
  assert.ok(rahmatTb.refs.some(r => r.number === 13 || r.number === 14));
  assert.equal(rahmat.cod.find(r => r.id === 'primary')?.status, 'Sesuai');
  assert.equal(rahmat.med.find(r => r.id === 'episode')?.status, 'Sesuai');
  assert.equal(rahmat.med.find(r => r.id === 'MED-ESI')?.status, 'Sesuai');
  assert.equal(rahmat.med.find(r => r.id === 'MED-ESI')?.automatic, false);
  assert.equal(rahmat.med.find(r => r.id === 'MED-JKN-DOC-14')?.status, 'Sesuai');
  assert.equal(rahmat.med.find(r => r.id === 'MED-JKN-DOC-14')?.automatic, false);

  const sawon = byName.get('Sawon Ranap.pdf');
  const sawonPneu = sawon.med.find(r => r.id === 'MED-PNEUMONIA');
  assert.equal(sawonPneu?.status, 'Sesuai');
  assert.equal(sawonPneu?.automatic, false);

  const tita = byName.get('RSJK - TITA SRI MULYATI.pdf');
  const titaSc = tita.med.find(r => r.id === 'PPK-SC');
  assert.equal(titaSc?.status, 'Sesuai');
  assert.equal(titaSc?.automatic, false);

  for (const [name, entry] of byName) {
    if (name !== 'RSWA - By Ny SALMA NOVIYANTI.pdf') {
      assert.equal(entry.info.consistency.wrongPatientPages.length, 0, `Tidak boleh ada false positive wrongPatientPages di ${name}`);
    }
    if (name !== 'RSKK - MUHAMAD UWAIS ARBIYAN.pdf') {
      assert.equal(entry.med.some(r => r.id === 'MED-ENSEFALOPATI'), false, `Tidak boleh ada false positive ensefalopati di ${name}`);
    }
    if (!['Acute respiratory (ada ETT).pdf', 'Hadi ranap.pdf', 'RSP - HADI PRAMONO.pdf'].includes(name)) {
      assert.equal(entry.med.some(r => r.id === 'MED-VENTILATOR'), false, `MED-VENTILATOR tidak boleh aktif tanpa 96.7x/31.x di ${name}`);
    }
    if (!['Chellyne ranap.pdf', 'RSP - SONI UMBARA.pdf', 'getfilepasien (1).pdf', 'RSJK - RAHMAT.pdf'].includes(name)) {
      assert.equal(entry.med.some(r => r.id === 'MED-TB'), false, `MED-TB tidak boleh aktif tanpa A15/A16 di ${name}`);
    }
  }
});

test('server/pdf.js: auto-rotasi 270° pada RSKK yang dipindai miring dan preview rotasi', async (t) => {
  const target = join(pdfDir, 'RSKK - MUHAMAD UWAIS ARBIYAN.pdf');
  if (!await access(target).then(() => true, () => false)) return t.skip('PDF sampel tidak tersedia.');
  const doc = await openPdf(await readFile(target));
  const ocr = createOcr(2);
  try {
    const result = await inspectPdf(doc, ocr);
    const p7 = result.pages[6];
    const p9 = result.pages[8];
    assert.equal(p7.rotation, 270);
    assert.match(p7.text, /KARTU KELUARGA/i);
    assert.equal(p9.rotation, 270);
    assert.match(p9.text, /VirtualClaim|Eligibilitas/i);
    const img = await pagePreview(doc, 7, true, 270);
    assert.equal(img.subarray(0, 4).toString(), 'RIFF');
  } finally {
    await ocr.close();
    await doc.destroy();
  }
});

test('server/index.js: impor PDF nyata mengisi meta otomatis, mendukung ?rot=270, review, dan berita acara', async (t) => {
  const sample = join(pdfDir, 'Bunga Cantika.pdf');
  if (!await access(sample).then(() => true, () => false)) return t.skip('PDF sampel tidak tersedia.');
  const tempDir = await mkdtemp(join(tmpdir(), 'sijantan-test-'));
  const app = await createApplication({ dataDir: tempDir, port: 8799 });
  try {
    const form = new FormData();
    form.append('scope', 'episode');
    form.append('pdf', new Blob([await readFile(sample)], { type: 'application/pdf' }), 'Bunga Cantika.pdf');
    const upRes = await app.handle(new Request('http://127.0.0.1:8799/api/episodes', {
      method: 'POST',
      headers: { host: '127.0.0.1:8799', 'X-Si-Jantan': 'local' },
      body: form,
    }));
    assert.equal(upRes.status, 201);
    const { id } = await upRes.json();

    const listRes = await app.handle(new Request('http://127.0.0.1:8799/api/episodes', { headers: { host: '127.0.0.1:8799' } }));
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].meta.facility, 'RSTP SIDAWANGI');
    assert.equal(list[0].meta.claimNumber, '146/PUSKESOS/X/2026');
    assert.equal(list[0].meta.serviceDate, '2026-10-18');
    assert.equal(list[0].meta.amount, 189200);

    const prevRes = await app.handle(new Request(`http://127.0.0.1:8799/api/episodes/${id}/pages/0/1?size=fit&rot=270`, { headers: { host: '127.0.0.1:8799' } }));
    assert.equal(prevRes.status, 200);
    assert.equal(prevRes.headers.get('content-type'), 'image/webp');
    const prevBytes = Buffer.from(await prevRes.arrayBuffer());
    assert.equal(prevBytes.subarray(0, 4).toString(), 'RIFF');

    const epRes = await app.handle(new Request(`http://127.0.0.1:8799/api/episodes/${id}`, { headers: { host: '127.0.0.1:8799' } }));
    const ep = await epRes.json();
    assert.equal(ep.docs[0].pages.length, 9);

    const put = async (state, revision) => {
      const res = await app.handle(new Request(`http://127.0.0.1:8799/api/episodes/${id}/review`, {
        method: 'PUT',
        headers: { host: '127.0.0.1:8799', 'X-Si-Jantan': 'local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, revision }),
      }));
      assert.equal(res.status, 200);
      return (await res.json()).revision;
    };

    const rev1 = await put({
      ...ep.state,
      approved: ['admin'],
      category: 'inactive',
      service: 'Rawat Jalan',
      reviewer: 'Verifikator Uji',
      reviews: { admin: { grouping: { status: 'Sesuai', note: '' } } },
    }, ep.revision);

    const rev2 = await put({
      ...ep.state,
      approved: ['admin'],
      category: 'inactive',
      service: 'Rawat Jalan',
      reviewer: 'Verifikator Uji',
      meta: ep.state.meta,
      decision: { status: 'pending', reviewer: 'Verifikator Uji', date: '2026-11-22', reason: 'Konfirmasi kelas tarif RS' },
    }, rev1);

    const minRes = await app.handle(new Request('http://127.0.0.1:8799/api/minutes', {
      method: 'POST',
      headers: { host: '127.0.0.1:8799', 'X-Si-Jantan': 'local', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: 'BA/001/JPKM/2026',
        issuer: 'Dinas Kesehatan Provinsi Jawa Barat',
        location: 'Bandung',
        date: '2026-11-22',
        start: '2026-10-01',
        end: '2026-10-31',
        verifier: 'Verifikator Uji',
        representative: 'Perwakilan RS',
        episodes: [{ id, revision: rev2 }],
      }),
    }));
    assert.equal(minRes.status, 201);
  } finally {
    app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('server/index.js: soft-delete, restore, hapus permanen dari Sampah, dan bersihkan PDF di disk', async (t) => {
  const sample = join(pdfDir, 'Bunga Cantika.pdf');
  if (!await access(sample).then(() => true, () => false)) return t.skip('PDF sampel tidak tersedia.');
  const sampleBytes = await readFile(sample);
  const tempDir = await mkdtemp(join(tmpdir(), 'sijantan-purge-'));
  const app = await createApplication({ dataDir: tempDir, port: 8798 });
  const headers = { host: '127.0.0.1:8798', 'X-Si-Jantan': 'local' };
  const uploadOne = async (title, count = 1) => {
    const form = new FormData();
    form.append('scope', 'episode');
    form.append('title', title);
    for (let i = 0; i < count; i++) {
      form.append('pdf', new Blob([sampleBytes], { type: 'application/pdf' }), `${title}-${i}.pdf`);
    }
    const res = await app.handle(new Request('http://127.0.0.1:8798/api/episodes', { method: 'POST', headers, body: form }));
    assert.equal(res.status, 201);
    return (await res.json()).id;
  };
  try {
    const id1 = await uploadOne('Uji Satu', 1);
    const id2 = await uploadOne('Uji Lampiran', 2);
    const id3 = await uploadOne('Uji Kosongkan', 1);

    // Pastikan direktori & file fisik ada
    assert.equal(await access(join(tempDir, id1, '0.pdf')).then(() => true, () => false), true);
    assert.equal(await access(join(tempDir, id2, '1.pdf')).then(() => true, () => false), true);

    // 1. Soft delete id1 & verifikasi GET /api/trash lalu restore
    const delSoft = await app.handle(new Request(`http://127.0.0.1:8798/api/episodes/${id1}`, { method: 'DELETE', headers }));
    assert.equal(delSoft.status, 200);
    assert.equal((await delSoft.json()).count, 1);

    const trash1 = await (await app.handle(new Request('http://127.0.0.1:8798/api/trash', { headers: { host: headers.host } }))).json();
    assert.equal(trash1.length, 1);
    assert.equal(trash1[0].id, id1);

    const restRes = await app.handle(new Request(`http://127.0.0.1:8798/api/trash/${id1}/restore`, { method: 'POST', headers }));
    assert.equal(restRes.status, 200);
    // File masih ada setelah soft-delete & restore
    assert.equal(await access(join(tempDir, id1, '0.pdf')).then(() => true, () => false), true);

    // 2. Soft delete id1 lagi lalu hapus permanen satu item via DELETE /api/trash/:id
    await app.handle(new Request(`http://127.0.0.1:8798/api/episodes/${id1}`, { method: 'DELETE', headers }));
    const purgeOne = await app.handle(new Request(`http://127.0.0.1:8798/api/trash/${id1}`, { method: 'DELETE', headers }));
    assert.equal(purgeOne.status, 200);
    assert.equal((await purgeOne.json()).count, 1);
    assert.equal(await access(join(tempDir, id1)).then(() => true, () => false), false);

    // 3. Soft delete lampiran index 1 di id2 + soft delete id3, lalu kosongkan Sampah via DELETE /api/trash
    const delAtt = await app.handle(new Request(`http://127.0.0.1:8798/api/episodes/${id2}/documents/1`, { method: 'DELETE', headers }));
    assert.equal(delAtt.status, 200);
    await app.handle(new Request(`http://127.0.0.1:8798/api/episodes/${id3}`, { method: 'DELETE', headers }));

    const trash2 = await (await app.handle(new Request('http://127.0.0.1:8798/api/trash', { headers: { host: headers.host } }))).json();
    assert.equal(trash2.length, 2);

    const emptyTrashRes = await app.handle(new Request('http://127.0.0.1:8798/api/trash', { method: 'DELETE', headers }));
    assert.equal(emptyTrashRes.status, 200);
    assert.equal((await emptyTrashRes.json()).count, 2);
    assert.equal(await access(join(tempDir, id2, '1.pdf')).then(() => true, () => false), false);
    assert.equal(await access(join(tempDir, id2, '0.pdf')).then(() => true, () => false), true);
    assert.equal(await access(join(tempDir, id3)).then(() => true, () => false), false);

    // 4. Hapus permanen langsung semua episode aktif via DELETE /api/episodes?permanent=1
    const purgeAll = await app.handle(new Request('http://127.0.0.1:8798/api/episodes?permanent=1', { method: 'DELETE', headers }));
    assert.equal(purgeAll.status, 200);
    assert.equal((await purgeAll.json()).count, 1);
    assert.equal(await access(join(tempDir, id2)).then(() => true, () => false), false);

    const remainingEps = await (await app.handle(new Request('http://127.0.0.1:8798/api/episodes', { headers: { host: headers.host } }))).json();
    const remainingTrash = await (await app.handle(new Request('http://127.0.0.1:8798/api/trash', { headers: { host: headers.host } }))).json();
    assert.equal(remainingEps.length, 0);
    assert.equal(remainingTrash.length, 0);
  } finally {
    app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('server/store.js: verifikasi 1 layar menetapkan 3 tahap + Layak Klaim sekaligus & lanjut Berita Acara', async (t) => {
  const sample = join(pdfDir, 'Bunga Cantika.pdf');
  if (!await access(sample).then(() => true, () => false)) return t.skip('PDF sampel tidak tersedia.');
  const tempDir = await mkdtemp(join(tmpdir(), 'sijantan-oneclick-'));
  const app = await createApplication({ dataDir: tempDir, port: 8797 });
  const headers = { host: '127.0.0.1:8797', 'X-Si-Jantan': 'local' };
  try {
    const form = new FormData();
    form.append('scope', 'episode');
    form.append('pdf', new Blob([await readFile(sample)], { type: 'application/pdf' }), 'Bunga Cantika.pdf');
    const upRes = await app.handle(new Request('http://127.0.0.1:8797/api/episodes', { method: 'POST', headers, body: form }));
    assert.equal(upRes.status, 201);
    const { id } = await upRes.json();

    const ep = await (await app.handle(new Request(`http://127.0.0.1:8797/api/episodes/${id}`, { headers: { host: headers.host } }))).json();
    assert.deepEqual(ep.state.approved || [], []);

    const putRes = await app.handle(new Request(`http://127.0.0.1:8797/api/episodes/${id}/review`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: ep.revision,
        state: {
          ...ep.state,
          category: 'inactive',
          service: 'Rawat Jalan',
          reviewer: 'Verifikator Cepat',
          codesConfirmed: true,
          approved: ['admin', 'coding', 'medical'],
          reviews: {
            admin: { grouping: { status: 'Sesuai', note: '' } },
            coding: {},
            medical: {},
          },
          meta: ep.state.meta,
          decision: {
            status: 'layak',
            reviewer: 'Verifikator Cepat',
            date: '2026-11-22',
            reason: 'Seluruh dokumen dan kode diverifikasi satu layar.',
          },
        },
      }),
    }));
    assert.equal(putRes.status, 200);
    const { revision } = await putRes.json();

    const minRes = await app.handle(new Request('http://127.0.0.1:8797/api/minutes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: 'BA/1CLICK/JPKM/2026',
        issuer: 'Dinas Kesehatan Provinsi Jawa Barat',
        location: 'Bandung',
        date: '2026-11-22',
        start: '2026-10-01',
        end: '2026-10-31',
        verifier: 'Verifikator Cepat',
        representative: 'Perwakilan RS',
        episodes: [{ id, revision }],
      }),
    }));
    assert.equal(minRes.status, 201);
  } finally {
    app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
