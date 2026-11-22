export const TARIFF_COMPONENT_FIELDS = {
  prosedur_non_bedah: ['PROSEDUR_NON_BEDAH'],
  prosedur_bedah: ['PROSEDUR_BEDAH'],
  konsultasi: ['KONSULTASI'],
  tenaga_ahli: ['TENAGA_AHLI'],
  keperawatan: ['KEPERAWATAN'],
  penunjang: ['PENUNJANG'],
  radiologi: ['RADIOLOGI'],
  laboratorium: ['LABORATORIUM'],
  pelayanan_darah: ['PELAYANAN_DARAH'],
  rehabilitasi: ['REHABILITASI'],
  kamar_akomodasi: ['KAMAR_AKOMODASI'],
  rawat_intensif: ['RAWAT_INTENSIF'],
  obat: ['OBAT'],
  alkes: ['ALKES'],
  bmhp: ['BMHP'],
  sewa_alat: ['SEWA_ALAT'],
  obat_kronis: ['OBAT_KRONIS'],
  obat_kemoterapi: ['OBAT_KEMO', 'OBAT_KEMOTERAPI'],
};

const codesFrom = (value) => String(value || '')
  .toUpperCase()
  .split(/[;,|\s]+/)
  .map((code) => code.replace(/^[([{]+|[\])},:]+$/g, ''))
  .filter(Boolean);

const hasPositiveTariff = (components, key) => Number(components?.[key] || 0) > 0;
const hasCode = (codes, pattern) => codes.some((code) => pattern.test(code));

const ORAL_CHEMOTHERAPY_PATTERN = new RegExp(`(?:\\b(?:kemoterapi\\s+oral|kemo\\s+oral|oral\\s+chemotherapy|obat\\s+kemoterapi\\s+oral|capecitabine|capecitabin|imatinib|gefitinib|erlotinib|osimertinib|sunitinib|sorafenib|lapatinib|nilotinib|dasatinib|temozolomide|temozolomid)\\b)|(?:${ORAL_CHEMOTHERAPY_ALIAS_PATTERN.source})`, 'i');

const makeCheck = (id, title, requirements, summary) => {
  const missing = requirements.filter((item) => !item.passed).map((item) => item.codeLabel);
  return {
    id,
    title,
    status: missing.length ? 'PERLU_VALIDASI' : 'SESUAI',
    summary: missing.length ? `${summary}; belum ditemukan ${missing.join(' dan ')}.` : `${summary}; koding terkait sudah lengkap.`,
    details: requirements.map(({ label, passed }) => ({ label, passed })),
  };
};

export const evaluateTariffMedicalCoding = ({ tariffComponents, diaglist, proclist, clinicalText = '' }) => {
  const diagnoses = codesFrom(diaglist);
  const procedures = codesFrom(proclist);
  const checks = [];

  if (hasPositiveTariff(tariffComponents, 'radiologi')) {
    checks.push(makeCheck('TARIF-RADIOLOGI-CODING', 'Koding tindakan atas tarif Radiologi', [
      { codeLabel: 'prosedur radiologi ICD-9-CM 87.xx/88.xx', label: 'Prosedur radiologi ICD-9-CM 87.xx–88.xx tercantum', passed: hasCode(procedures, /^(?:87|88)\.?\d{1,2}$/) },
    ], 'Komponen tarif Radiologi terisi'));
  }

  if (hasPositiveTariff(tariffComponents, 'rehabilitasi')) {
    checks.push(makeCheck('TARIF-REHABILITASI-CODING', 'Koding atas tarif Rehabilitasi', [
      { codeLabel: 'diagnosis ICD-10 Z50.-', label: 'Diagnosis ICD-10 Z50.- tercantum', passed: hasCode(diagnoses, /^Z50\.?\w+$/) },
      { codeLabel: 'prosedur rehabilitasi ICD-9-CM 93.xx', label: 'Prosedur rehabilitasi ICD-9-CM 93.xx tercantum', passed: hasCode(procedures, /^93\.?\d{1,2}$/) },
    ], 'Komponen tarif Rehabilitasi terisi'));
  }

  if (hasPositiveTariff(tariffComponents, 'pelayanan_darah')) {
    checks.push(makeCheck('TARIF-DARAH-CODING', 'Koding atas tarif Pelayanan Darah', [
      { codeLabel: 'diagnosis anemia ICD-10 D50–D64', label: 'Diagnosis anemia ICD-10 D50–D64 tercantum', passed: hasCode(diagnoses, /^D(?:5\d|6[0-4])(?:\.\w+)?$/) },
      { codeLabel: 'prosedur transfusi ICD-9-CM 99.0x', label: 'Prosedur transfusi darah ICD-9-CM 99.0x tercantum', passed: hasCode(procedures, /^99\.?0\d$/) },
    ], 'Komponen tarif Pelayanan Darah terisi'));
  }

  if (hasPositiveTariff(tariffComponents, 'obat_kemoterapi')) {
    const detectedDrugs = detectChemotherapyDrugs(clinicalText);
    const oralChemotherapy = detectedDrugs.some((drug) => drug.oral) || ORAL_CHEMOTHERAPY_PATTERN.test(String(clinicalText || ''));
    const requirements = [
      { codeLabel: 'diagnosis ICD-10 Z51.1', label: 'Diagnosis ICD-10 Z51.1 tercantum', passed: hasCode(diagnoses, /^Z51\.?1$/) },
    ];
    if (!oralChemotherapy) {
      requirements.push({ codeLabel: 'prosedur kemoterapi ICD-9-CM 99.25', label: 'Prosedur kemoterapi ICD-9-CM 99.25 tercantum', passed: hasCode(procedures, /^99\.?25$/) });
    }
    const check = makeCheck('TARIF-KEMOTERAPI-CODING', 'Koding atas tarif Obat Kemoterapi', requirements, oralChemotherapy ? 'Komponen tarif Obat Kemoterapi terisi dan kemoterapi oral terdeteksi' : 'Komponen tarif Obat Kemoterapi terisi');
    check.evidence = detectedDrugs.slice(0, 5).map((drug) => `Obat terdeteksi: ${drug.term} — ${chemotherapyCategoryLabel(drug.category)}`);
    if (oralChemotherapy) check.evidence.push('Kemoterapi oral terdeteksi: kode prosedur 99.25 tidak diwajibkan.');
    checks.push(check);

  }

  return checks;
};
import { ORAL_CHEMOTHERAPY_ALIAS_PATTERN } from './drugAliasDictionary.js';
import { chemotherapyCategoryLabel, detectChemotherapyDrugs } from './chemotherapyDrugCatalog.js';
