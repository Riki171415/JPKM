import { JKN_DOCUMENT_RULES } from '../data/jknDocumentRules.js';
import { medicalRuleKey } from './clinicalWarningGrouping.js';
import { additionalAuditReferences, additionalMedicalReferences } from './officialRuleReferences.js';

const INA_CBG_PDF = 'https://jdih.kemkes.go.id/common/dokumen/2021permenkes021.pdf';
const BA_2023_PDF = 'https://manuver.tireg7.net/wp-content/uploads/2023/12/BA-Kesepakatan-Koding-tahun-2023-1-dan-2-bisa-di-search-dan-tanpa-surat-pengantar.pdf';
const BA_2019_COPY = 'https://id.scribd.com/document/875775288/BA-Kesepakatan-Koding-2019-Bisa-Di-Search';
const CODING_GUIDE = {
  label: 'Permenkes 26/2021, Lampiran Bab III — Koding INA-CBG',
  url: INA_CBG_PDF + '#page=24',
  detail: 'Pedoman umum pengodean. Butir khusus untuk temuan aplikasi ini masih perlu dicocokkan.',
};

const permenkes = (section, page, detail) => ({
  label: `Permenkes 26/2021, Lampiran Bab III, ${section}, hlm. ${page}`,
  url: INA_CBG_PDF + '#page=' + page,
  detail,
});

const baCase = (number, detail) => ({
  label: `BA Kesepakatan INA-CBG 2023 No. 415/BA/0623, Aspek Koding kasus ${number}`,
  url: BA_2023_PDF,
  detail,
});

const ba2019 = (aspect, number, detail) => ({
  label: `BA Kesepakatan INA-CBG 2019 No. 411/BA/0720, Aspek ${aspect} kasus ${number}`,
  url: BA_2019_COPY,
  detail,
});

const urinaryStones = baCase(3, 'Membahas pengodean ISK pada kasus batu saluran kemih yang sudah tercakup dalam kode gabungan.');
const avShunt = baCase(21, 'Membahas revisi AV shunt dialisis dengan kode 39.42. Ketentuan untuk diagnosis komplikasi atau pembuatan akses pertama kali perlu diperiksa terpisah.');
const laparotomy = permenkes('B, ketentuan omit code', 42, 'Contoh laparotomi sebagai jalan masuk operasi. Laparotomi eksploratif harus dinilai sesuai tindakan yang benar-benar dilakukan.');
const anemia = ba2019('Medis', 13, 'BA memberi ketentuan berbeda menurut konteks anemia. Ketiadaan transfusi saja belum cukup untuk menghapus semua diagnosis anemia sekunder.');
const respiratoryFailure = ba2019('Medis', 17, 'BA menyediakan beberapa alternatif kriteria gagal napas. Pemeriksaan otomatis AKURAT memakai cakupan yang lebih sempit.');
const ventilation = ba2019('Koding', 201, 'Membahas ventilasi invasif, dokumentasi tindakan, dan pengodean terkait trakeostomi. Cocokkan durasi aktual pada catatan ventilator.');
const pnpkAnesthesia = {
  label: 'KMK HK.01.07/MENKES/1541/2022 — PNPK Tata Laksana Anestesiologi dan Terapi Intensif (PERDATIN), hlm. 322–325',
  url: 'https://jdih.kemkes.go.id/documents/keputusan-menteri-kesehatan-nomor-hk0107menkes15412022',
  detail: 'Indikasi ventilasi mekanik invasif: perlindungan jalan napas (obstruksi/penurunan kesadaran), gagal napas hiperkapnia atau hipoksemia, distres kardiovaskular, antisipasi perburukan, atau pembedahan dengan sedasi dalam/pelumpuh otot. Syarat: pipa napas artifisial (ETT/trakeostomi), informed consent, dan pencatatan setting ventilator.',
};
const pnpkTb = {
  label: 'KMK HK.01.07/MENKES/755/2019 — PNPK Tata Laksana Tuberkulosis & Permenkes 67/2016',
  url: 'https://jdih.kemkes.go.id/documents/keputusan-menteri-kesehatan-nomor-hk0107menkes7552019',
  detail: 'Diagnosis TB paru ditegakkan melalui pemeriksaan bakteriologis (TCM/GeneXpert, BTA mikroskopis, biakan) atau klinis-radiologis bila bakteriologis negatif, wajib dicatat pada SITB, dan diberikan terapi standar OAT (KDT/FDC RHZE tahap awal dan RH tahap lanjutan).',
};
const icdTb = {
  label: 'WHO ICD-10 Edisi 2010 — A15–A16 (Respiratory tuberculosis)',
  url: 'https://icd.who.int/browse10/2010/en#/A15-A19',
  detail: 'A15.0–A15.3 khusus TB paru yang terkonfirmasi secara bakteriologis (mikroskopis BTA/kultur/TCM) atau histologis (PA/biopsi). TB paru klinis/radiologis tanpa konfirmasi bakteriologis/histologis atau dengan hasil BTA/TCM negatif dikode pada kelompok A16.–.',
};
const tuberculousEffusion = ba2019('Koding', 90, 'Eksklusi J90 mencakup efusi pleura tuberkulosis. Hubungan etiologi perlu terdokumentasi sebelum memilih kode tuberkulosis pleura.');
const laborInduction = baCase(19, 'Membedakan induksi persalinan dengan obat dari penggunaan obat untuk augmentasi persalinan aktif.');
const stroke = {
  label: 'KMK HK.01.07/MENKES/304/2026 — PNPK Tata Laksana Stroke',
  url: 'https://jdih.kemkes.go.id/storage/documents/pdfs/KMK%20No.%20HK.01.07-MENKES-304-2026%20ttg%20Pedoman%20Nasional%20Pelayanan%20Klinis%20Tata%20Laksana%20Stroke-signed.pdf',
  detail: 'Rujukan klinis untuk evaluasi jenis stroke dan pemeriksaan pencitraan.',
};
const auditReferences = new Map([
  ...additionalAuditReferences,
  ['AUDIT-COD-01', ba2019('Koding', 2, 'Membahas urutan kode tifoid pada kehamilan dalam konteks yang dijelaskan pada kasus tersebut.')],
  ['AUDIT-COD-03', urinaryStones],
  ['AUDIT-COD-06', ba2019('Koding', 95, 'Membahas kategori K35 bila peritonitis atau perforasi berkaitan dengan apendisitis. Cocokkan jenis peritonitis dan penyebab perforasi dengan laporan operasi.')],
  ['AUDIT-COD-08', ba2019('Koding', 48, 'Membahas diabetes dengan komplikasi sirkulasi perifer bila ulkus atau gangren berkaitan dengan diabetes.')],
  ['AUDIT-COD-09', ba2019('Koding', 52, 'Contoh penggunaan pasangan dagger dan asterisk untuk polineuropati diabetik.')],
  ['AUDIT-COD-10', permenkes('A, kondisi multipel', 31, 'Contoh B20.7. Pemilihan diagnosis utama juga mempertimbangkan kondisi yang dominan, lihat halaman 30–31.')],
  ['AUDIT-COD-17', permenkes('A, kategori kombinasi', 32, 'Contoh penyakit ginjal hipertensi dengan gagal ginjal menggunakan I12.0. Cocokkan diagnosis yang terdokumentasi pada kasus yang diperiksa.')],
  ['AUDIT-COD-19', ba2019('Koding', 71, 'Membahas gagal jantung dan edema paru yang berkaitan. Periksa apakah keduanya terkonfirmasi pada rekam medis.')],
  ['AUDIT-COD-20', ba2019('Koding', 80, 'Membahas PPOK dengan pneumonia sebagai infeksi saluran napas bawah akut.')],
  ['AUDIT-COD-21', ba2019('Koding', 3, 'Membahas pengodean A09 saat tifoid sudah ditegakkan sebagai penyebab gastroenteritis.')],
  ['AUDIT-COD-22', ba2019('Koding', 83, 'Membahas pasangan dagger dan asterisk untuk pneumonia yang berkaitan dengan tifoid.')],
  ['AUDIT-COD-24', ba2019('Medis', 8, 'Membahas bukti klinis dan tata laksana syok hipovolemik sebagai diagnosis sekunder. Hubungan dengan trauma perlu ditinjau pada rekam medis.')],
  ['AUDIT-COD-25', ba2019('Medis', 68, 'Membedakan perlengketan yang merupakan bagian dari perbaikan hernia dari perlengketan di lokasi lain.')],
  ['AUDIT-COD-33', ba2019('Koding', 25, 'Membahas B20.0 pada kasus dengan diagnosis utama HIV dan diagnosis sekunder tuberkulosis.')],
  ['AUDIT-COD-34', laparotomy],
  ['AUDIT-COD-36', { ...laparotomy, detail: 'Acuan untuk membedakan laparotomi sebagai jalan masuk dari tindakan tersendiri. Pemilihan diagnosis apendisitis tetap mengikuti dokumentasi klinis dan laporan operasi.' }],
  ['AUDIT-COD-37', avShunt],
  ['AUDIT-COD-37B', avShunt],
  ['AUDIT-COD-39', ba2019('Koding', 91, 'Membahas 24.31 untuk ekstirpasi pada gingiva. Cocokkan lokasi prosedur pada laporan tindakan.')],
  ['AUDIT-COD-43', ba2019('Koding', 113, 'Membahas batu buli dengan hidronefrosis dan keterbatasan N20.9 untuk kondisi tersebut.')],
  ['AUDIT-COD-46', laborInduction],
  ['AUDIT-COD-48', ba2019('Koding', 79, 'Eksklusi J18 mencakup abses paru dengan pneumonia. Cocokkan hubungan kedua kondisi pada berkas klinis.')],
  ['AUDIT-COD-50', ba2019('Koding', 5, 'Membahas pneumonia tuberkulosis. Pastikan pneumonia terkait dengan tuberkulosis, karena kode yang muncul bersamaan belum membuktikan hubungan tersebut.')],
  ['AUDIT-COD-52', ba2019('Koding', 24, 'Memuat contoh pasangan B05.2 dan J17.1 untuk pneumonia akibat campak.')],
  ['AUDIT-COD-55', ba2019('Koding', 138, 'Memuat contoh hemoptisis sebagai bagian dari tuberkulosis paru.')],
  ['AUDIT-COD-58', baCase(28, 'Membahas episode perawatan malunion dan pengodeannya terhadap kode fraktur.')],
  ['AUDIT-COD-59', {
    label: 'WHO ICD-10 Classification of Mental and Behavioural Disorders, F06.2 dan F06.8',
    url: 'https://iris.who.int/bitstream/handle/10665/37958/9241544228_eng.pdf',
    detail: 'Aturan aplikasi terlalu luas. WHO membedakan psikosis epileptik yang tidak spesifik dari psikosis mirip skizofrenia pada epilepsi. Kode F29 dan G40 yang muncul bersama belum membuktikan hubungan tersebut.',
  }],
  ['AUDIT-COD-60', {
    ...stroke,
    detail: 'Rujukan klinis untuk mengevaluasi bukti stroke. Dasar untuk mengubah kode menjadi I64 hanya karena kode pencitraan tidak ada di TXT belum terverifikasi.',
  }],
  ['AUDIT-COD-64', anemia],
  ['AUDIT-COD-71', ventilation],
  ['AUDIT-COD-72', ventilation],
]);

const checkedMedicalReferences = new Map([
  ...additionalMedicalReferences,
  ['JKN-DOC-DIARE-01', ba2019('Medis', 27, 'Membahas rawat inap karena dehidrasi pada gastroenteritis dan bukti terapi cairan. Angka 4% dan kombinasi syarat lokal pada aplikasi perlu SOP tersendiri.')],
  ['JKN-DOC-ELEKTROLIT-NA', ba2019('Medis', 5, 'Membahas hiponatremia dan syarat penggunaan sebagai diagnosis sekunder. Kriteria tambahan pada aplikasi memerlukan acuan tersendiri.')],
  ['JKN-DOC-ELEKTROLIT-K', ba2019('Medis', 6, 'Membahas hipokalemia dan syarat penggunaan sebagai diagnosis sekunder. Kriteria tambahan pada aplikasi memerlukan acuan tersendiri.')],
  ['JKN-DOC-07', respiratoryFailure],
  ['JKN-COD-64', anemia],
  ['JKN-COD-72', [pnpkAnesthesia, ventilation]],
  ['JKN-PNPK-TB', [pnpkTb, icdTb]],
  ['JKN-DOC-16', urinaryStones],
  ['JKN-DOC-18', avShunt],
  ['JKN-DOC-19', laborInduction],
  ['JKN-PNPK-03', stroke],
  ['JKN-DOC-08', {
    label: 'KMK HK.01.07/MENKES/2147/2023 — PNPK Pneumonia pada Dewasa, bagian diagnosis',
    url: 'https://jdih.kemkes.go.id/common/dokumen/KMK%20No.%20HK.01.07-MENKES-2147-2023%20ttg%20Pedoman%20Nasional%20Pelayanan%20Kedokteran%20Tata%20Laksana%20Pneumonia%20Pada%20Dewasa-signed.pdf',
    detail: 'Rujukan klinis untuk diagnosis pneumonia dewasa. Status pembacaan dokumen AKURAT tetap perlu ditinjau pada berkas asli.',
  }],
  ['JKN-DOC-21', {
    label: 'KMK HK.01.07/MENKES/1914/2023 — PNPK Tata Laksana Retinopati Diabetika',
    url: 'https://jdih.kemkes.go.id/documents/keputusan-menteri-kesehatan-nomor-hk0107menkes19142023',
    detail: 'Rujukan klinis untuk retinopati diabetika. Cakupannya berbeda dari ketentuan klaim rawat inap dan indikasi vitrektomi non-diabetik.',
  }],
  ['ESI', {
    label: 'Emergency Nurses Association — Emergency Severity Index Handbook edisi 5',
    url: 'https://enau.ena.org/AssetListing/Emergency-Severity-Index-Handbook-5th-Edition-85744/Emergency-Severity-Index-Handbook-5th-Edition-15946',
    detail: 'Acuan algoritme ESI A–D. Jika formulir mencatat ATS, periksa menurut sistem ATS yang digunakan rumah sakit.',
  }],
  ['PPK-PRE-OP', permenkes('D.1.e, Episode Rawat Jalan', 53, 'Rangkaian konsultasi persiapan operasi dihitung sebagai satu episode bila didukung surat konsultasi dokter.')],
]);

const medicalReferences = new Map(JKN_DOCUMENT_RULES.map(rule => [rule.id, rule.source]));
const medicalCatalogAlias = {
  'MED-DIARE-RANAP': 'JKN-DOC-DIARE-01',
  'MED-HIPONATREMIA': 'JKN-DOC-ELEKTROLIT-NA',
  'MED-HIPOKALEMIA': 'JKN-DOC-ELEKTROLIT-K',
  'MED-PNEUMONIA': 'JKN-DOC-08',
  'MED-VENTILATOR': 'JKN-COD-72',
  'MED-TB': 'JKN-PNPK-TB',
  'PPK-GEA': 'JKN-DOC-DIARE-01',
};

export function getAuditRuleReferences(ruleId, caseName) {
  if (ruleId === 'AUDIT-COD-18' && caseName === 'Efusi Pleura dengan TB Paru') return [tuberculousEffusion];
  return [auditReferences.get(ruleId) || CODING_GUIDE];
}

export function getMedicalRuleReferences(check) {
  const ruleId = medicalCatalogAlias[check.id] || medicalRuleKey(check.id);
  const checkedRaw = checkedMedicalReferences.get(ruleId);
  const checkedReferences = Array.isArray(checkedRaw) ? checkedRaw : checkedRaw ? [checkedRaw] : [];
  const evidenceReferences = (check.evidence || []).flatMap(value => {
    const reference = typeof value === 'string' && value.match(/^(?:Acuan|Sumber):\s*(.+)$/i);
    return reference ? [reference[1].trim()] : [];
  });
  const recorded = [...new Set([check.source, ...evidenceReferences, medicalReferences.get(ruleId)]
    .filter(value => value && value !== 'Katalog verifikasi medis JKN'))]
    .filter(label => ruleId !== 'JKN-COD-72' && ruleId !== 'JKN-PNPK-TB');
  return [
    ...checkedReferences,
    ...recorded.map(label => ({
      label,
      detail: ruleId === 'JKN-PMK-01'
        ? 'Acuan historis katalog. Permenkes 1501/2010 sudah dicabut.'
        : 'Acuan tercatat di katalog AKURAT. Gunakan dokumen asal untuk memeriksa cakupan butirnya.',
    })),
  ];
}
