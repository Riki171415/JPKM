const req = (label, patterns, options = {}) => ({ label, patterns, ...options });
import { findMedicationAliasMatch } from './drugAliasDictionary.js';

// Rule obat non-antineoplastik dengan restriksi klinis yang dapat diverifikasi
// dari PDF klaim. Halaman mengacu pada nomor halaman PDF KMK Fornas sumber.
export const FORNAS_MEDICATION_RULES = [
  { drug: 'low molecular ferric sucrose', aliases: [/ferri(?:c)?\s+sucrose|iron\s+sucrose|besi\s+sukrosa/i], page: '112-113', requirements: [req('Pasien menjalani dialisis', [/dialisis|hemodialisis|\bHD\b|CAPD/i]), req('Defisiensi besi terdokumentasi', [/defisiensi.{0,20}(?:besi|zat besi)|ferritin|serum iron|saturasi transferin/i]), req('Hb <10 g/dL terdokumentasi', [/(?:Hb|hemoglobin)\s*[:=]?\s*(?:[0-9](?:[.,]\d+)?)/i])] },
  { drug: 'dabigatran', aliases: [/\bdabigatran\b/i], page: '113', requirements: [req('Pencegahan VTE pasca hip/knee replacement', [/VTE|venous thrombo|tromboemboli/i, /hip replacement|knee replacement|penggantian (?:sendi )?(?:panggul|lutut)/i]), req('Status pascaoperasi terdokumentasi', [/pasca.?operasi|post.?op|postoperative/i])] },
  { drug: 'enoksaparin', aliases: [/\benoksaparin|enoxaparin\b/i], page: '113', requirements: [req('Indikasi tromboemboli/ACS/hemodialisis/tirah baring berisiko', [/tromboemboli|DVT|VTE|ACS|sindrom koroner akut|hemodialisis|dialisis|tirah baring/i])] },
  { drug: 'fondaparinuks', aliases: [/\bfondaparinuks|fondaparinux\b/i], page: '114', requirements: [req('Indikasi tromboemboli, ACS, atau pascaoperasi yang sesuai', [/tromboemboli|DVT|VTE|ACS|sindrom koroner akut|operasi ortopedi|operasi abdominal/i]), req('Tidak sedang menjalani PCI/IKP', [], { forbidden: /(?:sedang|selama|sebelum).{0,30}(?:PCI|IKP|intervensi koroner perkutan)/i })] },
  { drug: 'rivaroksaban', aliases: [/\brivaroksaban|rivaroxaban\b/i], page: '115-116', requirements: [req('Indikasi VTE pasca hip/knee replacement, DVT, atau SPAF', [/VTE|DVT|deep vein thrombosis|SPAF|atrial fibrillation|fibrilasi atrium|hip replacement|knee replacement/i]), req('Dosis dan durasi/rencana kontrol terdokumentasi', [/\b10\s*mg\b|\b15\s*mg\b|\b20\s*mg\b/i, /hari|bulan|pascaoperasi|kontrol/i])] },
  { drug: 'warfarin', aliases: [/\bwarfarin\b/i], page: '116', requirements: [req('Indikasi pencegahan/terapi tromboemboli', [/tromboemboli|DVT|VTE|fibrilasi atrium|atrial fibrillation|katup/i]), req('Nilai/target INR 2-3 dan monitoring terdokumentasi', [/\bINR\b/i, /(?:2\s*[-–]\s*3|target.{0,15}INR|INR.{0,15}target)/i])] },
  { drug: 'deferasiroks/deferipron', aliases: [/\bdeferasiroks|deferasirox|deferipron(?:e)?\b/i], page: '116-117', requirements: [req('Indikasi kelebihan/kelasi besi terdokumentasi', [/kelebihan besi|iron overload|kelasi besi|thalassem|hemosiderosis|ferritin/i]), req('Usia pasien terdokumentasi', [/umur|usia|tahun|bulan/i])] },
  { drug: 'eltrombopag', aliases: [/\beltrombopag\b/i], page: '118', requirements: [req('Diagnosis ITP kronik', [/\bITP\b|idiopathic thrombocytopenic purpura|purpura trombositopenik/i]), req('Tidak respons terhadap kortikosteroid/imunoglobulin/splenektomi', [/tidak respons|refrakter|gagal|relaps/i, /kortikosteroid|imunoglobulin|splenektomi/i]), req('Trombosit <30.000/mm3 atau risiko perdarahan tinggi', [/trombosit|platelet/i, /(?:<\s*30[.,]?000|kurang dari\s*30[.,]?000)|risiko.{0,20}perdarahan/i])] },
  { drug: 'eritropoietin', aliases: [/eritropoietin|erythropoietin|epoetin/i], page: '118-121', requirements: [req('Indikasi CKD stadium 4/5/dialisis atau anemia akibat kemoterapi mielosupresif', [/CKD|gagal ginjal|dialisis|hemodialisis|CAPD|kemoterapi|myelosupresif|mielosupresif/i]), req('Nilai Hb terdokumentasi', [/(?:Hb|hemoglobin)\s*[:=]?\s*\d{1,2}(?:[.,]\d+)?/i]), req('Status besi/SI/TIBC/saturasi besi terdokumentasi untuk CKD', [/serum iron|\bSI\b|TIBC|saturasi besi|ferritin/i], { when: /CKD|gagal ginjal|dialisis|hemodialisis|CAPD/i })] },
  { drug: 'filgrastim/lenograstim', aliases: [/\bfilgrastim|lenograstim\b/i], page: '121-122', requirements: [req('Konteks pra/pascakemoterapi atau protokol FLAG/RICE', [/kemoterapi|FLAG|RICE/i]), req('Leukosit <4.000/mm3 terdokumentasi', [/leukosit|WBC/i, /(?:<\s*4[.,]?000|kurang dari\s*4[.,]?000)/i]), req('Neutrofil <1.500/mm3 terdokumentasi', [/neutrofil|ANC/i, /(?:<\s*1[.,]?500|kurang dari\s*1[.,]?500)/i])] },
  { drug: 'albumin manusia', aliases: [/human albumin|albumin (?:serum|manusia)|albumin\s+(?:5|20)\s*%/i], page: '125-126', requirements: [req('Indikasi klinis yang sesuai terdokumentasi', [/luka bakar|plasmaferesis|sindrom nefrotik|anasarka|syok|presyok|asites masif/i]), req('Kadar albumin <2,5 g/dL bila relevan', [/albumin\s*[:=]?\s*(?:[01](?:[.,]\d+)?|2(?:[.,][0-4])?)|albumin.{0,20}<\s*2[.,]5/i])] },
  { drug: 'insulin basal analog', aliases: [/insulin\s+(?:detemir|glargine)/i], page: '138-140', requirements: [req('Diagnosis diabetes melitus tipe 2', [/diabetes|DM\s*tipe\s*2|type\s*2/i]), req('HbA1c >7,5% atau >9% dengan dekompensasi terdokumentasi', [/HbA1c|A1c|gula darah rerata/i]), req('Riwayat metformin dan OAD optimal minimal 3 bulan, bila relevan', [/metformin/i, /3\s*bulan|tiga\s*bulan|dosis optimal/i])] },
  { drug: 'sildenafil untuk HAP', aliases: [/\bsildenafil\b/i], page: '156', requirements: [req('Diagnosis hipertensi arteri pulmonal', [/HAP|hipertensi arteri pulmonal|pulmonary arterial hypertension/i]), req('Diagnosis didukung echocardiography', [/echocardiograph|ekokardiograf|\becho\b/i])] },
  { drug: 'klopidogrel', aliases: [/\bklopidogrel|clopidogrel\b/i], page: '157-158', requirements: [req('Indikasi PCI, infark, stroke iskemik, PAD, atau ACS terdokumentasi', [/PCI|IKP|kateterisasi|infark|myocardial infarction|stroke iskemik|PAD|peripheral arterial|ACS|STEMI|NON.?STEMI|unstable angina/i]), req('Dosis/loading dan durasi terapi terdokumentasi', [/loading|rumatan|maintenance|75\s*mg|300\s*mg|600\s*mg/i, /hari|bulan/i])] },
  { drug: 'alteplase', aliases: [/\balteplase\b/i], page: '159-160', requirements: [req('Indikasi infark miokard akut atau stroke nonhemoragik', [/infark miokard|myocardial infarction|stroke non.?hemoragik|stroke iskemik/i]), req('Onset waktu terdokumentasi', [/onset|jam sejak|time of onset|last known well/i]), req('Skrining kontraindikasi perdarahan/operasi/koagulasi/hipertensi terdokumentasi', [/perdarahan intrakranial|cedera kepala|operasi mayor|koagulasi|hipertensi|kontraindikasi/i])] },
  { drug: 'atorvastatin/rosuvastatin', aliases: [/\batorvastatin|rosuvastatin\b/i], page: '163-166', requirements: [req('Riwayat simvastatin 40 mg selama 3 bulan atau ASCVD terdokumentasi', [/simvastatin/i, /3\s*bulan|40\s*mg/i], { unless: /ASCVD|PCI|CABG|stroke iskemik|PAD|pascainfark/i }), req('Nilai/target LDL terdokumentasi', [/\bLDL\b/i, /(?:100|55)\s*mg\/dL|target.{0,20}LDL|LDL.{0,20}target/i])] },
  { drug: 'fenofibrat', aliases: [/\bfenofibrat|fenofibrate\b/i], page: '164', requirements: [req('Hipertrigliseridemia dengan trigliserida >250 mg/dL', [/trigliserida|triglyceride/i, /(?:>\s*250|lebih dari\s*250|2[5-9]\d|[3-9]\d\d)\s*mg\/dL/i]), req('Pemeriksaan dilakukan setelah puasa', [/puasa|fasting/i])] },
  { drug: 'donepezil', aliases: [/\bdonepezil\b/i], page: '187', requirements: [req('Demensia Alzheimer ringan-sedang', [/alzheimer/i, /ringan|sedang|mild|moderate/i]), req('Pemeriksaan neurobehaviour/neuropsikiatri terdokumentasi', [/neurobehaviour|neurobehavior|neuropsikiatri|MMSE|MoCA/i])] },
  { drug: 'ranibizumab', aliases: [/\branibizumab\b/i], page: '178', requirements: [req('Indikasi wet AMD, DME, atau edema makula akibat RVO', [/wet\s*AMD|age.?related macular|DME|diabetic macular edema|RVO|retinal vein occlusion|edema makula/i]), req('Pemeriksaan OCT terdokumentasi', [/OCT|optical coherence tomography/i]), req('Untuk DME: tata laksana diabetes komprehensif terdokumentasi', [/kontrol glikemik|HbA1c|tata laksana diabetes|penanganan diabetes/i], { when: /DME|diabetic macular edema/i })] },
  { drug: 'tiotropium-olodaterol', aliases: [/tiotropium.{0,40}olodaterol|olodaterol.{0,40}tiotropium/i], page: '204', requirements: [req('PPOK berat tidak respons terhadap LABA/LAMA/LABA-ICS', [/PPOK|COPD/i, /tidak respons|gagal|refrakter/i, /LABA|LAMA|ICS/i]), req('Eosinofil >100 atau eksaserbasi berulang bila ditambah ICS', [/eosinofil|eksaserbasi/i])] },
  { drug: 'imidafenasin/solifenasin', aliases: [/\bimidafenasin|solifenasin|solifenacin\b/i], page: '205-206', requirements: [req('Diagnosis OAB atau urge urinary incontinence', [/OAB|overactive bladder|urge urinary|inkontinensia.{0,20}desakan/i]), req('Urodinamik atau asesmen minimum terdokumentasi', [/urodinamik|urinalisa|bladder diary|OABSS|residu urine/i])] },
];

const snippetAround = (text, pattern) => {
  const match = text.match(pattern);
  if (!match) return '';
  return text.slice(Math.max(0, (match.index || 0) - 45), Math.min(text.length, (match.index || 0) + match[0].length + 90)).replace(/\s+/g, ' ').trim();
};

export const evaluateFornasMedicationRules = (pdfText) => {
  const text = String(pdfText || '');
  if (!text.trim()) return [];

  return FORNAS_MEDICATION_RULES.flatMap((rule) => {
    const medicationMatch = findMedicationAliasMatch(text, rule.drug, rule.aliases);
    if (!medicationMatch) return [];
    const applicable = rule.requirements.filter((item) => !item.when || item.when.test(text));
    const details = applicable.map((item) => ({
      label: item.label,
      passed: (item.unless?.test(text) || item.patterns.every((pattern) => pattern.test(text)))
        && (!item.forbidden || !item.forbidden.test(text)),
    }));
    const missing = details.filter((item) => !item.passed);
    return [{
      id: `FORNAS-OBAT-${rule.drug.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
      title: `Kriteria Fornas obat ${rule.drug}`,
      genericName: rule.drug,
      detectedAs: medicationMatch.detectedAs,
      aliasType: medicationMatch.aliasType,
      status: missing.length ? 'PERLU_VALIDASI' : 'SESUAI',
      summary: missing.length
        ? `${rule.drug} terdeteksi, tetapi ${missing.length} kriteria Fornas belum terbukti pada PDF.`
        : `${rule.drug} terdeteksi dan bukti kriteria Fornas yang diperiksa tersedia pada PDF.`,
      evidence: [
        `Bukti obat: "...${snippetAround(text, new RegExp(medicationMatch.match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))}..."`,
        `Sumber: KMK Formularium Nasional, halaman PDF ${rule.page}.`,
      ],
      details,
    }];
  });
};
