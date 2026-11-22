const WHO_ICD_2010 = 'https://icd.who.int/browse10/2010/en#/';
const CMS_ICD9_2010 = 'https://www.cms.gov/medicare/coding-billing/icd-10-codes/icd-9-cm-diagnosis-procedure-codes-abbreviated-and-full-code-titles';
const BA_2024 = 'https://manuver.tireg7.net/wp-content/uploads/2025/01/3760.BA-Administrasi-dg-Kemkes-tahun-2024.pdf';
const JDIH_PDF = 'https://jdih.kemkes.go.id/storage/documents/pdfs/';
const JDIH_DOC = 'https://jdih.kemkes.go.id/documents/';

const reference = (label, url, detail) => ({ label, url, detail });
const icd10 = (group, codes, detail) => reference(`WHO ICD-10 edisi 2010 — ${codes}`, WHO_ICD_2010 + group, detail);
const icd9 = (codes, detail) => reference(`CMS ICD-9-CM versi 28 (2010), daftar prosedur — ${codes}`, CMS_ICD9_2010, detail);
const ba2024 = (aspect, number, detail) => reference(`BA Kesepakatan INA-CBG 2024 No. 1247/BA/1124, Aspek ${aspect} kasus ${number}`, BA_2024, detail);
const pnpk = (number, title, url, detail) => reference(`KMK HK.01.07/MENKES/${number} — PNPK ${title}`, url, detail);

const biliaryCodes = icd10('K80-K87', 'K80.3, K80.4, K83.0, K83.1',
  'K80.3 dan K80.4 membedakan kolangitis dan kolesistitis pada batu duktus biliaris. Cocokkan lokasi batu dan diagnosis yang tertulis sebelum memilih kode kombinasi.');
const heartFailure = pnpk('4801/2021', 'Tata Laksana Gagal Jantung, bagian Diagnosis',
  'https://keslan.kemkes.go.id/unduhan/fileunduhan_1660186267_194392.pdf',
  'Rujukan klinis untuk menilai gagal jantung dan peran ekokardiografi. Perlu dasar klaim tersendiri untuk menghapus kode semata karena ekokardiografi tidak terlihat dalam data.');
const coronarySyndrome = pnpk('876/2026', 'Tata Laksana Sindrom Koroner Akut',
  'https://kemkes.go.id/id/pnpk-tata-laksana-sindrom-koroner-akut-2026',
  'Rujukan klinis untuk menilai sindrom koroner akut dan komplikasinya. Perlu butir klaim tersendiri untuk menentukan pengodean diagnosis sekunder pada kasus tertentu.');
const rehab = ba2024('Administrasi', 1, 'Mengatur pengawasan Sp.KFR dan kelengkapan protokol terapi serta reassessment. Penerapan kode diagnosis dan tindakan perlu dicocokkan dengan pelayanan yang diberikan.');
const stt = ba2024('Medis', 1, 'Memuat pilihan kondisi khusus rawat inap dan dokumen klaim untuk STT. Periksa pilihan kriterianya sesuai BA dan cocokkan hasil PA serta laporan operasi.');
const dental = ba2024('Medis', 3, 'Untuk odontektomi rawat jalan dan rawat inap, BA menunjuk PNPK impaksi gigi KMK 777/2022 dan Permenkes 3/2023.');
const dengue = pnpk('9845/2020', 'Tata Laksana Infeksi Dengue pada Dewasa',
  JDIH_DOC + 'keputusan-menteri-kesehatan-nomor-hk0107menkes98452020',
  'Rujukan klinis dengue dewasa. Untuk anak dan remaja, gunakan PNPK KMK 4636/2021. Kriteria klinis tidak menentukan sendiri aturan penagihan diagnosis sekunder.');
const kuret = icd9('69.52 dan kode tindakan menurut indikasi',
  'Entri 69.52 menjelaskan aspirasi kuretase setelah persalinan atau abortus. Jenis prosedur mengikuti laporan tindakan. Dasar wajib rawat jalan pada semua kasus BO atau mola belum ditemukan.');
const abscess = icd9('83.39, 86.04, 86.28',
  'Tabel membedakan eksisi lesi jaringan lunak, insisi dengan drainase, dan debridemen noneksisional. Cocokkan tindakan dengan laporan operasi. Diagnosis abses saja belum menentukan kode prosedur.');

export const additionalAuditReferences = new Map([
  ...['AUDIT-DM-E117', 'AUDIT-DM-E118'].map((id) => [id, reference(
    'WHO ICD-10 2010, Volume 2, hlm. 140 — diabetes melitus',
    'https://icd.who.int/browse10/Content/statichtml/ICD10Volume2_en_2010.pdf',
    'Periksa komplikasi yang didokumentasikan dokter. Untuk diagnosis utama, subkategori .7 dipakai bila komplikasi multipel ditetapkan bersama tanpa mengutamakan salah satunya.',
  )]),
  ['AUDIT-COD-05', biliaryCodes],
  ['AUDIT-COD-07', icd9('84.01, 84.02, 84.11, 84.91', 'Tabel membedakan amputasi jari tangan, ibu jari, jari kaki, dan amputasi yang tidak dirinci. Gunakan rincian tindakan yang terdokumentasi.')],
  ['AUDIT-COD-11', { ...dengue, detail: 'Trombositopenia merupakan temuan klinis yang relevan. Larangan menyeluruh untuk mencatatnya sebagai diagnosis sekunder belum ditemukan pada sumber ini.' }],
  ['AUDIT-COD-12', icd10('I20-I25', 'I20 dan I25', 'Tabel membedakan angina dan penyakit jantung iskemik kronis. Ketentuan menghilangkan I20 ketika keduanya tercatat perlu dicocokkan dengan jenis angina dan dasar pengodean kasus.')],
  ['AUDIT-COD-15', icd10('O60-O75', 'O70.0 dan O70.1', 'Kode untuk robekan perineum tingkat 1 dan 2 tersedia. Larangan mencatat keduanya sebagai diagnosis sekunder perlu dasar klaim tersendiri.')],
  ['AUDIT-COD-16', icd10('I10-I15', 'I11.0', 'Kode menggambarkan penyakit jantung hipertensif dengan gagal jantung. Periksa keterkaitan hipertensi dan gagal jantung pada diagnosis yang tercatat.')],
  ['AUDIT-COD-18', icd10('I10-I15', 'I13.2', 'Deskripsi I13.2 mencakup penyakit jantung dan ginjal hipertensif dengan gagal jantung dan gagal ginjal. Kode CKD saja belum membuktikan gagal ginjal.')],
  ['AUDIT-COD-23', icd10('O30-O48', 'O41.0 dan O42', 'Tabel membedakan oligohidramnion dan ketuban pecah dini. Larangan pengodean bersama untuk semua kasus masih perlu dasar spesifik.')],
  ['AUDIT-COD-26', icd9('54.59, 65.89 dan 74.-', 'Tabel mendukung pembedaan tindakan. Apakah adhesiolisis dapat dicatat terpisah harus ditentukan dari tindakan yang terdokumentasi dan butir pengodean yang berlaku.')],
  ['AUDIT-COD-29', icd10('O60-O75', 'O60.0 dan O47.0', 'Tabel membedakan persalinan prematur tanpa kelahiran dan persalinan palsu sebelum 37 minggu. Cocokkan kondisi yang akhirnya ditegakkan.')],
  ['AUDIT-COD-30', icd10('I30-I52', 'I49.3', 'I49.3 mendeskripsikan kontraksi prematur ventrikel. Larangan pengodean diagnosis sekunder pada setiap kejadian selama PCI belum terverifikasi.')],
  ['AUDIT-COD-31', icd10('D60-D64', 'D61.1', 'D61.1 mendeskripsikan anemia aplastik akibat obat. Pansitopenia setelah kemoterapi saja belum menegakkan diagnosis tersebut.')],
  ['AUDIT-COD-35', icd9('73.6 dan 75.69', 'Tabel membedakan episiotomi dan perbaikan laserasi obstetrik lain. Pembatasan 75.69 hanya untuk derajat 3 atau 4 belum terverifikasi.')],
  ['AUDIT-COD-40', icd10('G80-G83', 'G82.2', 'G82.2 mendeskripsikan paraplegia tidak spesifik. Periksa kondisi dasar dan kepentingan klinis paraplegia sebelum menyimpulkan pengodean diagnosis sekunder.')],
  ['AUDIT-COD-41', icd10('G90-G99', 'G93.5 dan rujukan S06.-', 'Periksa eksklusi kompresi otak traumatik serta jenis cedera intrakranial yang terdokumentasi sebelum menentukan kode S06.-.')],
  ['AUDIT-COD-44', icd10('N20-N23', 'N20.1 dan N20.9', 'Pesan aplikasi perlu ditinjau. N20.9 adalah batu saluran kemih yang tidak dirinci. Judul ini tidak menyatakan kode gabungan batu ureter dengan pielonefritis.')],
  ['AUDIT-COD-49', icd10('J85-J86', 'J85.1 dan J85.2', 'J85.2 mendeskripsikan abses paru tanpa pneumonia. Pesan aplikasi untuk mengganti abses paru dengan pneumonia ke J85.2 perlu dicocokkan dengan jenis pneumonia dan catatan tabular.')],
  ['AUDIT-COD-51', icd10('A90-A99', 'A90 dan A91', 'Edisi 2010 membedakan dengue klasik dan dengue hemoragik. Cocokkan diagnosis akhir episode perawatan dengan kategori yang tepat.')],
  ['AUDIT-COD-61', icd9('95.11 dan 16.21', 'Tabel membedakan fotografi fundus dan oftalmoskopi. Ketiadaan hasil foto dalam berkas tidak membuktikan bahwa oftalmoskopi dilakukan.')],
  ['AUDIT-COD-62', coronarySyndrome],
  ['AUDIT-COD-63', icd9('81.92', 'Kode menunjukkan penyuntikan zat terapeutik pada sendi atau ligamen. Ketentuan TKMKB 2020 tentang rawat inap, interval obat, dan kompetensi dokter belum ditemukan pada sumber resmi yang dapat dicocokkan.')],
  ['AUDIT-COD-65', heartFailure],
  ['AUDIT-COD-66', icd9('99.60 dan 96.04', 'Tabel membedakan RJP yang tidak dirinci dan pemasangan pipa endotrakeal. Instruksi bahwa 96.04 selalu tercakup dalam 99.60 belum terverifikasi.')],
  ['AUDIT-COD-67', icd10('K00-K14', 'K12.0 dan K12.1', 'Pesan aplikasi perlu ditinjau. K12.0 adalah afta oral berulang. K12.1 mencakup stomatitis lain, termasuk stomatitis yang tidak dirinci.')],
  ['AUDIT-COD-68', abscess],
  ['AUDIT-COD-69', icd10('P75-P78', 'P76.0–P76.9', 'Kelompok P76 membedakan penyebab obstruksi usus bayi baru lahir. Umur saja belum cukup untuk memilih P76.8.')],
  ['AUDIT-COD-70', kuret],
  ['AUDIT-COD-73', abscess],
]);

export const additionalMedicalReferences = new Map([
  ['JKN-DOC-01', icd10('O30-O48', 'O42', 'Kode O42 membedakan ketuban pecah dini menurut waktu mulai persalinan. Dasar pemeriksaan klinis dan dokumen wajib masih perlu dicocokkan.')],
  ['JKN-DOC-02', reference('Kemenkes — PNPK Tata Laksana Batu Saluran Kemih (2022), bagian SWL', 'https://keslan.kemkes.go.id/unduhan/fileunduhan_1681540059_988188.pdf', 'Rujukan klinis untuk pemilihan ESWL menurut lokasi dan karakteristik batu. Bukti tindakan tetap mengacu pada dokumentasi asli.')],
  ['JKN-DOC-03', icd9('49.46', 'Kode mendeskripsikan eksisi hemoroid. Derajat hemoroid, pilihan anestesi, dan kriteria rawat inap perlu dasar klinis atau klaim tersendiri.')],
  ['JKN-DOC-04', icd10('O85-O92', 'O90.3', 'Kode mendeskripsikan kardiomiopati pada masa nifas. Kriteria diagnosis dan bukti klinis peripartum perlu dicocokkan dengan pedoman yang berlaku.')],
  ['JKN-DOC-05', icd9('21.21 dan 31.42', 'Tabel membedakan rinoskopi dan laringoskopi atau trakeoskopi lain. Cocokkan dengan struktur dan prosedur yang tertulis pada laporan tindakan.')],
  ['JKN-DOC-09', icd10('M65-M68', 'M65', 'Kategori mencakup sinovitis dan tenosinovitis. Jumlah temuan klinis dan persyaratan pemeriksaan dalam aturan aplikasi belum terverifikasi dari tabel kode.')],
  ['JKN-DOC-10', pnpk('1488/2023', 'Tata Laksana Glaukoma', 'https://jdih.kemkes.go.id/common/dokumen/KMK%20No.%20HK.01.07-MENKES-1488-2023%20ttg%20Pedoman%20Nasional%20Pelayanan%20Kedokteran%20Tata%20Laksana%20Glaukoma-signed.pdf', 'Rujukan klinis glaukoma. Kriteria khusus untuk glaukoma absolut dan pengodeannya perlu dicocokkan dengan dokumentasi kasus.')],
  ['JKN-DOC-11', icd9('94.26 dan 94.27', 'Tabel membedakan terapi listrik subkonvulsif dan terapi kejut listrik lainnya. Cocokkan jenis prosedur dan dokumentasi tindakan sebelum memilih kode.')],
  ['JKN-DOC-12', stt],
  ['JKN-DOC-13', dental],
  ['JKN-DOC-14', ba2024('Medis', 2, 'Gunakan matriks penjaminan dan penagihan IGD dalam lampiran, termasuk pembedaan episode IGD rawat inap dan rawat jalan.')],
  ['JKN-DOC-15', biliaryCodes],
  ['JKN-DOC-17', icd10('E10-E14', 'E11.8 dan E11.9', 'Tabel membedakan diabetes dengan komplikasi yang tidak dirinci dan diabetes tanpa komplikasi. Hubungan kausal dan pemilihan diagnosis utama tetap perlu dokumentasi kasus.')],
  ['JKN-DOC-20', pnpk('1492/2023', 'Tata Laksana Penyakit/Kelainan Jaringan Pulpa dan Periradikuler', JDIH_DOC + 'keputusan-menteri-kesehatan-nomor-hk0107menkes14922023', 'Rujukan klinis pemeriksaan, diagnosis, dan tata laksana. Kode prosedur dan kelengkapan klaim perlu diperiksa terpisah.')],
  ['JKN-DOC-22', dengue],
  ['JKN-DOC-23', pnpk('875/2026', 'Tata Laksana Demam Tifoid pada Dewasa', JDIH_PDF + '2026kepmenkes875.pdf', 'Rujukan klinis untuk diagnosis tifoid dewasa, termasuk penilaian pemeriksaan penunjang. Cakupan paratifoid dan pasien anak perlu rujukan yang sesuai.')],
  ['JKN-PNPK-HF-01', heartFailure],
  ['JKN-PNPK-01', pnpk('4722/2021', 'Tata Laksana Sepsis pada Anak', JDIH_PDF + '2021kepmenkes4722.pdf', 'Rujukan untuk evaluasi sepsis anak. Cakupan neonatal dan rincian pemeriksaan otomatis perlu ditinjau sesuai umur dan protokol yang berlaku.')],
  ['JKN-PNPK-02', reference('Kemenkes — PNPK Hiperbilirubinemia (2019), bagian evaluasi dan fototerapi', 'https://kemkes.go.id/id/pnpk-2019---tata-laksana-hiperbilirubinemia', 'Periksa kurva dan indikasi fototerapi atau transfusi tukar berdasarkan karakteristik bayi. PNPK adalah rujukan klinis.')],
  ['JKN-PNPK-04', pnpk('214/2019', 'Tata Laksana Asfiksia', JDIH_PDF + '2019kepmenkes214.pdf', 'Rujukan klinis untuk evaluasi asfiksia dan resusitasi neonatus. Penetapan diagnosis membutuhkan evaluasi klinis dan dokumentasi bayi.')],
  ['JKN-PNPK-05', pnpk('555/2019', 'Tata Laksana Luka Bakar', JDIH_DOC + 'keputusan-menteri-kesehatan-nomor-hk0107menkes5552019', 'Rujukan klinis untuk luas, kedalaman, dan tata laksana luka bakar. Verifikasi dokumen klaim mengikuti ketentuan yang berlaku.')],
  ['JKN-PNPK-06', reference('Kemenkes — PNPK Tata Laksana Malnutrisi pada Dewasa (2019)', 'https://keslan.kemkes.go.id/unduhan/fileunduhan_1610416412_498969.pdf', 'Cakupan PNPK ini adalah dewasa. Gunakan acuan sesuai kelompok usia dan kriteria diagnosis yang tercatat.')],
  ['JKN-PNPK-07', pnpk('67/2026', 'Tatalaksana Katarak pada Dewasa', JDIH_PDF + '2026kepmenkes067.pdf', 'Rujukan klinis untuk evaluasi dan tatalaksana katarak dewasa. Dokumen ini mencabut KMK 557/2018.')],
  ['JKN-PNPK-08', coronarySyndrome],
  ['JKN-BA-20', kuret],
  ['JKN-PNPK-09', pnpk('1634/2023', 'Tata Laksana Ginjal Kronik', 'https://jdih.kemkes.go.id/common/dokumen/KMK%20No.%20HK.01.07-MENKES-1634-2023%20ttg%20Pedoman%20Nasional%20Pelayanan%20Kedokteran%20Tata%20Laksana%20Ginjal%20Kronik-signed.pdf', 'Cakupan PNPK ini adalah penyakit ginjal kronik. Evaluasi gagal ginjal akut memerlukan rujukan tersendiri.')],
  ['JKN-BA-21', rehab],
  ['JKN-PNPK-10', pnpk('302/2026', 'Tata Laksana Diabetes Melitus Tipe 2 Dewasa', JDIH_PDF + '2026kepmenkes302.pdf', 'Rujukan klinis untuk diagnosis dan pengelolaan diabetes tipe 2 dewasa, termasuk penggunaan dan keterbatasan HbA1c.')],
  ['JKN-PNPK-11', pnpk('1355/2022', 'Tata Laksana Karsinoma Sel Hati pada Dewasa', JDIH_PDF + '2022kepmenkes1355.pdf', 'Rujukan klinis untuk diagnosis, penentuan stadium, tata laksana, dan evaluasi respons pada orang dewasa.')],
  ['JKN-PMK-01', reference('Permenkes 1/2026 — Bab II Pasal 4 dan Bab XII Pasal 174', JDIH_DOC + 'peraturan-menteri-kesehatan-nomor-1-tahun-2026', 'Pasal 174 mencabut Permenkes 1501/2010. Skrining AKURAT tidak menetapkan KLB. Daftar diagnosis pemicu dari katalog lama perlu ditinjau sesuai regulasi baru.')],
  ['PRB-POTENTIAL', reference('KMK HK.01.07/MENKES/1645/2024 — Lampiran Bab II A–B', JDIH_DOC + 'keputusan-menteri-kesehatan-nomor-hk0107menkes16452024', 'Mengatur kriteria rujuk balik penyakit kronis. Penanda AKURAT adalah skrining kandidat yang perlu dikonfirmasi dengan kondisi klinis dan penilaian DPJP.')],
  ['TARIF-REHABILITASI-CODING', rehab],
]);
