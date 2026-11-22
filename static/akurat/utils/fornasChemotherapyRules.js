const criterion = (label, patterns, options = {}) => ({ label, patterns, ...options });
import { findMedicationAliasMatch } from './drugAliasDictionary.js';

// Disarikan dari KMK Formularium Nasional, bagian 8.1 Antineoplastik
// (halaman PDF 71-96). Rule hanya menilai apakah bukti persyaratan tertulis
// tersedia pada PDF klaim; keputusan klinis akhir tetap pada verifikator.
export const FORNAS_CHEMOTHERAPY_RULES = [
  { drug: 'bendamustin', aliases: [/\bbendamustin(?:e)?\b/i], page: '71-72', criteria: [criterion('Diagnosis CLL stadium B/C atau Multiple Myeloma stadium II/III', [/\bCLL\b|chronic lymphocytic leukemia|multiple myeloma|mieloma multipel/i]), criterion('Untuk MM: bukti gagal terapi lini pertama', [/gagal.{0,40}(?:lini|pengobatan|terapi).{0,20}pertama|relaps|refrakter/i], { when: /multiple myeloma|mieloma multipel/i })] },
  { drug: 'temozolomid', aliases: [/\btemozolomid(?:e)?\b/i], page: '73-74', criteria: [criterion('Diagnosis glioblastoma atau anaplastic astrocytoma', [/glioblastoma|anaplastic astrocytoma|astrositoma anaplastik/i]), criterion('Siklus/rencana radioterapi dan jumlah siklus terdokumentasi', [/radioterapi|radiasi|penyinaran|siklus/i])] },
  { drug: 'gemsitabin', aliases: [/\bgemsitabin(?:e)?\b/i], page: '75', criteria: [criterion('Indikasi kanker sesuai Fornas (NSCLC, pankreas, kandung kemih, payudara, atau ovarium)', [/NSCLC|non.?small cell lung|pankreas|pancrea|bladder|kandung kemih|payudara|breast|ovarium|ovarian/i]), criterion('Stadium/lini terapi atau terapi sebelumnya terdokumentasi', [/stadium|stage|locally advanced|metast|kekambuhan|relaps|antrasiklin|platinum|paklitaksel/i])] },
  { drug: 'kapesitabin', aliases: [/\b(?:kapesitabin|capecitabine|xeloda)\b/i], page: '75-76', oral: true, criteria: [criterion('Indikasi kanker kolorektal atau kanker payudara metastatik', [/kolorektal|colorectal|payudara|breast/i]), criterion('Jika kanker payudara: bukti metastatik dan gagal antrasiklin/taksan', [/metast/i, /gagal|refrakter|progres|antrasiklin|anthracycline|taksan|taxane/i], { when: /payudara|breast/i })] },
  { drug: 'pemetreksed', aliases: [/\bpemetreksed|pemetrexed\b/i], page: '77-78', criteria: [criterion('Diagnosis non-squamous NSCLC locally advanced/metastatik', [/non.?squamous|non skuamosa/i, /NSCLC|non.?small cell lung/i, /locally advanced|metast/i]), criterion('EGFR wild type terdokumentasi', [/EGFR.{0,20}wild.?type|wild.?type.{0,20}EGFR/i]), criterion('Lini terapi dan kombinasi platinum terdokumentasi', [/lini|line|gagal|progres/i, /sisplatin|cisplatin|karboplatin|carboplatin|platinum/i])] },
  { drug: 'irinotekan', aliases: [/\birinotekan|irinotecan\b/i], page: '79', criteria: [criterion('Indikasi kanker kolorektal atau SCLC', [/kolorektal|colorectal|SCLC|small cell lung/i]), criterion('Kombinasi sesuai indikasi terdokumentasi', [/5.?FU|fluorourasil|leukovorin|kalsium folinat|sisplatin|cisplatin/i])] },
  { drug: 'bleomisin', aliases: [/\bbleomisin|bleomycin\b/i], page: '80-81', criteria: [criterion('Indikasi keganasan yang sesuai terdokumentasi', [/karsinoma|carcinoma|limfoma|lymphoma|hodgkin|germ cell|tumor|glioma|kanker/i]), criterion('Hasil Patologi Anatomi, kecuali indikasi yang dikecualikan', [/patologi anatomi|\bPA\b|histopatologi|nefroblastoma|pleurodesis|tumor otak/i])] },
  { drug: 'doksorubisin', aliases: [/\bdoksorubisin|doxorubicin\b/i], page: '81-82', criteria: [criterion('Echocardiogram sebelum siklus pertama terdokumentasi', [/echocardiogram|ekokardiograf|\becho\b|LVEF|fraksi ejeksi/i]), criterion('Dosis kumulatif/siklus terdokumentasi', [/kumulatif|cumulative|siklus|cycle/i])] },
  { drug: 'epirubisin', aliases: [/\bepirubisin|epirubicin\b/i], page: '82', criteria: [criterion('Echocardiogram sebelum siklus pertama terdokumentasi', [/echocardiogram|ekokardiograf|\becho\b|LVEF|fraksi ejeksi/i]), criterion('Dosis kumulatif/siklus terdokumentasi', [/kumulatif|cumulative|siklus|cycle/i])] },
  { drug: 'afatinib', aliases: [/\bafatinib\b/i], page: '83-84', oral: true, criteria: [criterion('NSCLC non-squamous locally advanced/metastatik', [/NSCLC|non.?small cell lung/i, /non.?squamous|non skuamosa/i, /locally advanced|metast/i]), criterion('Mutasi EGFR yang dipersyaratkan terdokumentasi', [/EGFR/i, /exon\s*(?:18|19|20|21)|L858R|L861Q|G719X|S768I/i]), criterion('Riwayat TKI/progresi terdokumentasi', [/TKI|gefitinib|erlotinib|afatinib|progres/i])] },
  { drug: 'alektinib', aliases: [/\balektinib|alectinib\b/i], page: '84-85', oral: true, criteria: [criterion('NSCLC locally advanced/metastatik', [/NSCLC|non.?small cell lung/i, /locally advanced|metast/i]), criterion('ALK positif terdokumentasi', [/ALK.{0,20}positif|ALK.?positive/i]), criterion('Riwayat inhibitor ALK sebelumnya terdokumentasi', [/belum pernah.{0,50}(?:ALK|inhibitor)|riwayat.{0,30}(?:ALK|inhibitor)/i])] },
  { drug: 'erlotinib/gefitinib', aliases: [/\berlotinib\b|\bgefitinib\b/i], page: '85-86', oral: true, criteria: [criterion('NSCLC non-squamous locally advanced/metastatik', [/NSCLC|non.?small cell lung/i, /non.?squamous|non skuamosa/i, /locally advanced|metast/i]), criterion('EGFR exon 19 atau exon 21/L858R positif', [/EGFR/i, /exon\s*(?:19|21)|L858R/i]), criterion('Riwayat TKI dan progresi terdokumentasi', [/TKI|gefitinib|erlotinib|afatinib|progres/i])] },
  { drug: 'imatinib', aliases: [/\bimatinib\b/i], page: '86', oral: true, criteria: [criterion('Indikasi CML/ALL, GIST, atau DFSP terdokumentasi', [/CML|LGK|ALL|LLA|GIST|DFSP|dermatofibrosarcoma/i]), criterion('Biomarker sesuai indikasi terdokumentasi', [/philadelphia|BCR.?ABL|CD\s*117/i])] },
  { drug: 'lapatinib', aliases: [/\blapatinib\b/i], page: '86-87', oral: true, criteria: [criterion('Kanker payudara metastatik dan postmenopause', [/payudara|breast/i, /metast/i, /post.?menopause|pascamenopause/i]), criterion('HER2 positif sesuai IHK/FISH/CISH', [/HER2/i, /IHK|IHC|FISH|CISH|3\+\+\+|2\+\+/i]), criterion('ER/PR positif dan kombinasi letrozol', [/ER|PR|reseptor hormon/i, /letrozol/i])] },
  { drug: 'lenvatinib', aliases: [/\blenvatinib\b/i], page: '87-89', oral: true, criteria: [criterion('Indikasi DTC refrakter atau HCC advanced/unresectable', [/DTC|differentiated thyroid|tiroid|HCC|hepatocellular|hepatoseluler/i]), criterion('Stadium/progresi dan terapi sebelumnya terdokumentasi', [/progres|advanced|locally advanced|metast|unresectable|radio.?ablasi|terapi sistemik/i]), criterion('Untuk HCC: Child-Pugh dan ECOG terdokumentasi', [/Child.?Pugh/i, /ECOG|performance status/i], { when: /HCC|hepatocellular|hepatoseluler/i })] },
  { drug: 'nilotinib', aliases: [/\bnilotinib\b/i], page: '89', oral: true, criteria: [criterion('Diagnosis CML/LGK terdokumentasi', [/CML|LGK|leukemia granulositik kronik/i]), criterion('Philadelphia chromosome atau BCR-ABL positif', [/philadelphia|BCR.?ABL/i]), criterion('Untuk dosis 200 mg: resistansi/intoleransi imatinib terdokumentasi', [/resistan|resisten|intoleran|imatinib/i], { when: /200\s*mg/i })] },
  { drug: 'ponatinib', aliases: [/\bponatinib\b/i], page: '89-90', oral: true, criteria: [criterion('CML fase kronik/akselerasi terdokumentasi', [/CML|LGK/i, /fase kronik|chronic phase|akselerasi|accelerated/i]), criterion('Resistansi TKI/nilotinib atau mutasi T315I', [/resistan|resisten|refrakter|T315I|nilotinib/i]), criterion('Lini terapi terdokumentasi dan bukan lini pertama', [/lini ketiga|third.?line|bukan lini pertama|not first.?line/i])] },
  { drug: 'ruksolitinib', aliases: [/\bruksolitinib|ruxolitinib\b/i], page: '90-91', oral: true, criteria: [criterion('Diagnosis myelofibrosis sesuai indikasi', [/myelofibrosis|mielofibrosis|polisitemia vera|trombositemia esensial/i]), criterion('Histopatologi biopsi sumsum tulang terdokumentasi', [/histopatologi|biopsi.{0,30}sumsum tulang|bone marrow/i])] },
  { drug: 'rituksimab', aliases: [/\brituksimab|rituximab\b/i], page: '91-92', criteria: [criterion('Diagnosis DLBCL atau CLL', [/DLBCL|diffuse large B.?cell|CLL|chronic lymphocytic leukemia/i]), criterion('CD20 positif terdokumentasi', [/CD\s*20.{0,20}positif|CD20.?positive/i])] },
  { drug: 'setuksimab', aliases: [/\bsetuksimab|cetuximab\b/i], page: '92', criteria: [criterion('Kanker kepala/leher squamous', [/kepala.{0,20}leher|head.{0,20}neck/i, /squamous|skuamosa/i]), criterion('Bukan kanker nasofaring', [], { forbidden: /nasofaring|nasopharyn/i }), criterion('Lini kedua dan kombinasi kemoterapi/radiasi', [/lini kedua|second.?line/i, /kemoterapi|chemotherapy|radiasi|radioterapi/i])] },
  { drug: 'trastuzumab', aliases: [/\btrastuzumab\b/i], page: '92-93', criteria: [criterion('Diagnosis kanker payudara stadium dini atau metastatik', [/payudara|breast/i, /stadium dini|early stage|metast/i]), criterion('HER2 sesuai IHK/FISH/CISH terdokumentasi', [/HER2/i, /IHK|IHC|FISH|CISH|3\+\+\+|2\+\+/i]), criterion('Rencana/jumlah siklus terdokumentasi', [/siklus|cycle/i])] },
  { drug: 'bortezomib', aliases: [/\bbortezomib\b/i], page: '93', criteria: [criterion('Diagnosis Multiple Myeloma', [/multiple myeloma|mieloma multipel/i]), criterion('Siklus/rencana terapi terdokumentasi', [/siklus|cycle|hari ke.?1|hari ke.?4|hari ke.?8|hari ke.?11/i])] },
  { drug: 'eribulin', aliases: [/\beribulin\b/i], page: '93-94', criteria: [criterion('Kanker payudara metastatik atau liposarkoma nonoperabel/metastatik', [/payudara|breast|liposarcoma|liposarkoma/i, /metast|non.?operable|tidak dapat dioperasi/i]), criterion('Riwayat antrasiklin dan/atau taksan sebelumnya', [/antrasiklin|anthracycline|taksan|taxane/i])] },
  { drug: 'lenalidomid', aliases: [/\blenalidomid|lenalidomide\b/i], page: '94-95', oral: true, criteria: [criterion('Indikasi Multiple Myeloma atau MDS delesi 5q', [/multiple myeloma|mieloma multipel|MDS|myelodysplastic|delesi\s*5q/i]), criterion('Status terapi/transplantasi atau transfusion-dependent terdokumentasi', [/belum pernah.{0,30}terapi|tidak memenuhi syarat.{0,30}transplant|relaps|progressive disease|bergantung.{0,30}transfusi/i]), criterion('Kombinasi terapi sesuai indikasi terdokumentasi', [/deksametason|dexamethasone|melfalan|melphalan|prednison|prednisone|monoterapi/i])] },
  { drug: 'oksaliplatin', aliases: [/\boksaliplatin|oxaliplatin\b/i], page: '95-96', criteria: [criterion('Kanker kolorektal stadium III atau metastatik', [/kolorektal|colorectal/i, /stadium\s*III|stage\s*III|metast/i])] },
];

const snippetAround = (text, pattern) => {
  const match = text.match(pattern);
  if (!match) return '';
  const start = Math.max(0, (match.index || 0) - 45);
  const end = Math.min(text.length, (match.index || 0) + match[0].length + 80);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
};

export const evaluateFornasChemotherapyRules = (pdfText) => {
  const text = String(pdfText || '');
  if (!text.trim()) return [];

  return FORNAS_CHEMOTHERAPY_RULES.flatMap((rule) => {
    const medicationMatch = findMedicationAliasMatch(text, rule.drug, rule.aliases);
    if (!medicationMatch) return [];
    const applicableCriteria = rule.criteria.filter((item) => !item.when || item.when.test(text));
    const details = applicableCriteria.map((item) => ({
      label: item.label,
      passed: item.patterns.every((pattern) => pattern.test(text)) && (!item.forbidden || !item.forbidden.test(text)),
    }));
    const missing = details.filter((item) => !item.passed).map((item) => item.label);
    const drugEvidence = snippetAround(text, new RegExp(medicationMatch.match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    return [{
      id: `FORNAS-KEMO-${rule.drug.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
      title: `Kriteria Fornas obat ${rule.drug}`,
      genericName: rule.drug,
      detectedAs: medicationMatch.detectedAs,
      aliasType: medicationMatch.aliasType,
      status: missing.length ? 'PERLU_VALIDASI' : 'SESUAI',
      summary: missing.length
        ? `${rule.drug} terdeteksi, tetapi ${missing.length} kriteria Fornas belum terbukti pada PDF.`
        : `${rule.drug} terdeteksi dan seluruh bukti kriteria Fornas yang diperiksa tersedia pada PDF.`,
      evidence: [
        drugEvidence ? `Bukti obat: "...${drugEvidence}..."` : '',
        `Sumber: KMK Formularium Nasional bagian 8.1, halaman PDF ${rule.page}.`,
        rule.oral ? 'Sediaan/rute oral teridentifikasi dari ketentuan Fornas.' : '',
      ].filter(Boolean),
      details,
    }];
  });
};
