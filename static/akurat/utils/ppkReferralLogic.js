// Interpretations are attached to reviewed reference rows, never inferred from
// finding the word "dan"/"atau" or from the number of OCR keyword matches.
// Keep the generated clinical wording in diagnosisPpk1.js unchanged.
const alternativeRows = new Set([
  5,6,7,8,9,10,12,13,14,15,17,18,22,23,24,26,27,29,31,32,33,34,37,38,40,42,43,44,48,
  57,59,60,61,62,64,65,67,69,72,79,80,81,82,83,84,85,97,102,103,105,107,109,110,116,119,
  124,125,126,127,128,129,132,133,134,135,137,138,140,141,143,144,145,149,150,151,154,
  155,156,157,158,162,163,164,165,166,167,168,169,170,172,173,174,177,178,180,181,183,
  187,189,190,191,192,197,199,201,203,204,205,206,211,214,216,217,218,219,224,225,226,233,238,
]);
const directRows = new Set([
  11,20,28,36,45,46,47,70,71,74,75,76,77,89,90,91,92,93,94,95,96,99,100,101,
  111,112,113,114,115,117,142,200,202,208,220,223,234,235,236,237,
]);
const conditionRows = new Set([
  16,19,21,35,39,41,52,53,54,55,63,66,86,87,108,118,131,136,148,159,160,175,176,182,
  188,193,194,196,212,213,230,231,240,
]);
const combinedRows = new Set([108,131,160,212]);
const noRoutineRows = new Set([153,171,184]);
const notes = {
  5: 'Tidak membaik setelah 3 bulan, BTA kembali positif, efek samping berat, dan TB resistan obat adalah jalur alternatif; jangan menunggu semuanya muncul.',
  6: 'Tidak membaik setelah 3 bulan, BTA kembali positif, efek samping berat, dan TB resistan obat adalah jalur alternatif; jangan menunggu semuanya muncul.',
  7: 'Dalam tiap butir, kombinasi hasil MTB, keadaan klinis, dan respons pengobatan tetap harus sesuai. Pilih satu butir lengkap, bukan satu kata saja.',
  8: 'Campak dengan salah satu komplikasi yang dicantumkan; daftar komplikasi tidak harus terjadi bersamaan.',
  10: 'Komplikasi atau malaria berat adalah indikasi alternatif. Pemberian terapi awal sebelum rujukan adalah langkah penanganan, bukan indikasi tambahan yang harus menunggu komplikasi lain.',
  15: 'Butir a memerlukan intake tidak mencukupi DAN tanda dehidrasi; butir b (komplikasi sepsis) adalah alternatif tersendiri.',
  17: 'Efek samping obat serius atau reaksi kusta sesuai kondisi yang dirinci. ENL dan reaksi tipe 1 adalah cabang kondisi, bukan syarat yang harus terjadi bersamaan.',
  24: 'Gunakan cabang sesuai keparahan/kebutuhan spesialistik, long COVID, atau kehamilan berisiko; syarat di dalam cabang tetap berlaku.',
  29: 'Bedakan indikasi rujukan karena KGB tidak mengecil dengan indikasi biopsi. Biopsi bukan syarat wajib bagi seluruh rujukan.',
  31: 'Kelompok gejala ekstraoral, tanda tidak khas, dan lesi rongga mulut merupakan alternatif; contoh di dalam kelompok tidak wajib semuanya ada.',
  32: 'Kelompok gejala ekstraoral, tanda tidak khas, dan lesi rongga mulut merupakan alternatif; contoh di dalam kelompok tidak wajib semuanya ada.',
  33: 'Kegagalan terapi, kekambuhan, atau alarm symptom merupakan alternatif. Tidak perlu seluruh alarm symptom ada.',
  38: 'Pilih kelompok umur yang sesuai. Dewasa: cukup satu indikasi a–e. Anak: cukup satu butir lengkap a–d; pada butir a, dehidrasi berat DAN keterbatasan fasilitas yang disebutkan harus sesuai. Kriteria dewasa dan anak tidak digabung.',
  62: 'Naskah menyebut minimal satu kelainan; enam kelainan bukan syarat kumulatif.',
  90: 'Infark miokard adalah alasan rujukan. Terapi awal dan pengamanan selama transfer merupakan tata laksana; jangan mensyaratkan semua komplikasi muncul.',
  97: 'Time, Age, Comorbidity, dan Complication adalah jalur pertimbangan sesuai kondisi pasien, bukan empat kelompok yang wajib terpenuhi bersamaan. Batas waktu/tekanan darah di dalam butir tetap berlaku.',
  105: 'Salah satu butir a–c cukup; khusus butir a, ukuran >6 cm DAN pertumbuhan cepat merupakan satu kombinasi.',
  108: 'Migren terus berlanjut DAN tidak hilang dengan analgesik nonspesifik merupakan satu kondisi lengkap.',
  110: 'Butir tidak membaik atau komplikasi adalah indikasi alternatif; tujuan rujukan ke dokter spesialis neurologi bukan indikasi klinis ketiga.',
  112: 'Malaria serebral memerlukan rujukan. Bagian edukasi/pencegahan bukan daftar syarat rujukan.',
  115: 'Penegakan diagnosis dan penanganan awal melekat pada alur rujukan stroke; bukan alasan untuk menunggu komplikasi lain.',
  117: 'Status epileptikus adalah indikasi rujukan setelah penanganan awal. Daftar tujuan rujukan bukan gejala yang wajib semuanya ada.',
  131: 'Tanda pneumonia yang dirinci merupakan satu kelompok: panas tidak turun 5 hari disertai batuk purulen DAN sesak napas.',
  138: 'Ikuti indikasi kegagalan respons/keparahan pada butir terkait. Nilai APE sebelum ATAU sesudah tata laksana adalah alternatif dengan ambang masing-masing.',
  143: 'Bedakan rujukan diagnosis/derajat PPOK, eksaserbasi setelah penanganan awal, dan tata laksana jangka panjang/rujuk balik; bukan tiga syarat yang harus bersamaan.',
  150: 'Batas waktu kegagalan terapi mengikuti jenis RSA: viral, pascaviral, atau bakterial. Jangan menjumlahkan atau mewajibkan ketiga batas waktu.',
  160: 'Infestasi kronis DAN tidak sensitif terhadap terapi harus sesuai dalam kondisi yang sama.',
  177: 'Butir a mensyaratkan luas DAN berat; butir b rekalsitran ATAU dependen steroid. Butir lain merupakan alternatif.',
  180: 'Butir b: tidak membaik dalam 4 minggu setelah terapi standar DAN sudah menghindari kontak. Butir kebutuhan patch test merupakan jalur tersendiri.',
  181: 'Butir b: tidak membaik dalam 4 minggu setelah terapi standar DAN sudah menghindari kontak. Butir kebutuhan patch test merupakan jalur tersendiri.',
  188: 'Akne sedang sampai berat adalah kondisi rujukan; daftar peralatan dan prognosis bukan syarat tambahan.',
  191: 'Butir a–d merupakan alternatif. Rangkaian uji tempel, uji tusuk, dan uji provokasi adalah pemeriksaan berurutan sesuai hasil, bukan tiga indikasi yang wajib bersamaan.',
  192: 'Butir a–d merupakan alternatif. Rangkaian uji tempel, uji tusuk, dan uji provokasi adalah pemeriksaan berurutan sesuai hasil, bukan tiga indikasi yang wajib bersamaan.',
  201: 'Gunakan jalur TACC atau keterbatasan pemeriksaan yang sesuai. GDP, GDPP, dan HbA1c dalam butir kontrol gula adalah alternatif; syarat durasi/terapi di dalam butir tetap berlaku.',
  203: 'Penurunan kesadaran atau hipoglikemia yang tidak teratasi sesuai batas waktu merupakan jalur berbeda. Terapi awal pada jalur penurunan kesadaran tetap harus diperhatikan.',
  206: 'Pilih kelompok gizi/umur yang sesuai; pada balita ≥6 bulan dengan BB <4 kg, umur DAN berat badan merupakan satu kombinasi.',
  212: 'Komplikasi DAN penyulit tindakan sirkumsisi disebut dalam satu kondisi; jangan mengganti hubungan ini menjadi salah satu kata yang terdeteksi.',
  216: 'Pilih kelompok trimester pasien. Tanda bahaya pada kelompok terkait merupakan alasan rujukan; jangan menggabungkan seluruh trimester sebagai syarat kumulatif.',
  217: 'Butir indikasi klinis/komplikasi dibedakan dari butir tindakan awal kegawatdaruratan sebelum rujukan. Butir a tetap memuat kombinasi gejala klinis DAN gangguan kesadaran.',
  219: 'Satu atau lebih tanda/gejala preeklampsia berat cukup sesuai naskah. Penanganan kegawatdaruratan sebelum/selama rujukan tetap dilakukan, bukan tanda klinis tambahan.',
  225: 'Perdarahan sesuai ambang merupakan indikasi. Penanganan kegawatdaruratan dan stabilisasi adalah langkah sebelum/selama rujukan, bukan indikasi alternatif.',
  226: 'Tingkat 3 ATAU 4 merupakan kondisi rujukan; tidak menunggu keduanya. Tingkat 1–2 adalah batas tindakan FKTP pada acuan ini.',
  227: 'Acuan tersimpan menulis abses mammae dan sepsis tanpa menjelaskan hubungan indikasinya. Jangan menyimpulkan keduanya wajib bersamaan hanya dari kata dan; verifikasi bagian mastitis pada naskah lengkap.',
};

const definitions = {
  ANY: ['Cukup salah satu indikasi lengkap (ATAU)', 'Antarindikasi bersifat alternatif. Semua syarat yang melekat pada satu indikasi terpilih tetap harus terpenuhi; satu gejala/kata belum tentu mewakili satu indikasi lengkap.'],
  ALL: ['Syarat dalam satu indikasi harus bersama (DAN)', 'Kondisi gabungan pada butir ini dibaca sebagai satu indikasi lengkap. Cocokkan seluruh unsur kondisi tersebut pada bukti klinis.'],
  DIRECT: ['Diagnosis/kondisi ini merupakan indikasi rujukan', 'Ikuti kondisi diagnosis dan tahap penanganan awal yang tertulis. Daftar tindakan awal, tujuan rujukan, atau komplikasi bukan syarat yang harus semuanya terjadi.'],
  CONDITIONAL: ['Satu indikasi dengan syarat yang melekat', 'Cocokkan kondisi lengkap, termasuk derajat, durasi, terapi sebelumnya, atau konteks yang disebutkan; bukan sekadar kecocokan satu kata.'],
  NO_ROUTINE: ['Tidak ada indikasi rujukan rutin pada acuan ini', 'Pernyataan ini berlaku pada kondisi yang dimaksud acuan. Tidak otomatis meniadakan kebutuhan rujukan karena kondisi lain pada pasien.'],
  REVIEW: ['Hubungan kriteria belum dapat dipastikan dari acuan tersimpan', 'Jangan menetapkan harus semua atau cukup salah satu secara otomatis. Cocokkan bagian kriteria rujukan pada naskah KMK dan klarifikasi ke DPJP.'],
};

export function getPpkReferralLogic(entry) {
  const row = Number(entry.sourceRow ?? entry.row);
  const mode = combinedRows.has(row) ? 'ALL' : alternativeRows.has(row) ? 'ANY' : directRows.has(row) ? 'DIRECT' : conditionRows.has(row) ? 'CONDITIONAL' : noRoutineRows.has(row) ? 'NO_ROUTINE' : 'REVIEW';
  const [label, explanation] = definitions[mode];
  const amended = /1936/.test(entry.basis || '');
  return {
    mode, label, explanation, note: notes[row] || '',
    sourceUrl: amended ? 'https://jdih.kemkes.go.id/storage/documents/pdfs/2022kepmenkes1936.pdf' : 'https://puskesmaslabuapi-dikes.lombokbaratkab.go.id/media/Kepmenkes_nomor_HK.01.07_MENKES_1186_2022_-_PPK_Dokter_Mei_2022.pdf',
    sourceSection: `${entry.section || ''} · ${entry.group || entry.title || entry.diagnosis || ''} · Kriteria rujukan`,
    evidenceStatus: 'Belum diverifikasi terhadap bukti klinis pasien',
  };
}

export function ppkReferralLogicText(logic) {
  return logic ? [logic.label, logic.explanation, logic.note].filter(Boolean).join(' ') : '';
}
