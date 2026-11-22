// Seed alias merek untuk OCR offline. KFA tetap menjadi sumber kanonik untuk
// sinkronisasi produk aktual (POA/93xxxxxx), nama dagang, NIE, dan produsen.
export const DRUG_BRAND_ALIASES = {
  bendamustin: ['Ribomustin', 'Treanda', 'Bendeka'],
  temozolomid: ['Temodal', 'Temodar'],
  gemsitabin: ['Gemzar'],
  kapesitabin: ['Xeloda'],
  pemetreksed: ['Alimta'],
  irinotekan: ['Campto', 'Camptosar'],
  bleomisin: ['Bleocin'],
  doksorubisin: ['Adriamycin', 'Caelyx', 'Doxil'],
  epirubisin: ['Farmorubicin'],
  afatinib: ['Giotrif', 'Gilotrif'],
  alektinib: ['Alecensa'],
  'erlotinib/gefitinib': ['Tarceva', 'Iressa'],
  imatinib: ['Glivec', 'Gleevec'],
  lapatinib: ['Tykerb', 'Tyverb'],
  lenvatinib: ['Lenvima'],
  nilotinib: ['Tasigna'],
  ponatinib: ['Iclusig'],
  ruksolitinib: ['Jakavi', 'Jakafi'],
  rituksimab: ['MabThera', 'Rituxan', 'Truxima', 'Rixathon'],
  setuksimab: ['Erbitux'],
  trastuzumab: ['Herceptin', 'Herclon', 'Herzuma', 'Kanjinti', 'Ogivri'],
  bortezomib: ['Velcade'],
  eribulin: ['Halaven'],
  lenalidomid: ['Revlimid'],
  oksaliplatin: ['Eloxatin'],
  'low molecular ferric sucrose': ['Venofer'],
  dabigatran: ['Pradaxa'],
  enoksaparin: ['Clexane', 'Lovenox'],
  fondaparinuks: ['Arixtra'],
  rivaroksaban: ['Xarelto'],
  warfarin: ['Coumadin'],
  'deferasiroks/deferipron': ['Exjade', 'Jadenu', 'Ferriprox'],
  eltrombopag: ['Revolade', 'Promacta'],
  eritropoietin: ['Eprex', 'Recormon', 'Mircera'],
  'filgrastim/lenograstim': ['Neupogen', 'Granocyte', 'Zarzio'],
  'albumin manusia': ['Albutein', 'Albuminar'],
  'insulin basal analog': ['Lantus', 'Levemir', 'Basaglar', 'Toujeo'],
  'sildenafil untuk HAP': ['Revatio'],
  klopidogrel: ['Plavix'],
  alteplase: ['Actilyse'],
  'atorvastatin/rosuvastatin': ['Lipitor', 'Crestor'],
  fenofibrat: ['Lipanthyl', 'Tricor'],
  donepezil: ['Aricept'],
  ranibizumab: ['Lucentis'],
  'tiotropium-olodaterol': ['Spiolto', 'Stiolto'],
  'imidafenasin/solifenasin': ['Uritos', 'Vesicare'],
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const findMedicationAliasMatch = (text, canonicalName, genericPatterns = []) => {
  for (const pattern of genericPatterns) {
    const match = String(text || '').match(pattern);
    if (match) return { match, detectedAs: match[0], aliasType: 'generic' };
  }
  for (const brand of DRUG_BRAND_ALIASES[canonicalName] || []) {
    const pattern = new RegExp(`\\b${escapeRegex(brand).replace(/\\\s+/g, '\\s+')}\\b`, 'i');
    const match = String(text || '').match(pattern);
    if (match) return { match, detectedAs: match[0], aliasType: 'brand' };
  }
  return null;
};

export const ORAL_CHEMOTHERAPY_ALIAS_PATTERN = /\b(?:xeloda|temodal|temodar|giotrif|gilotrif|alecensa|tarceva|iressa|glivec|gleevec|tykerb|tyverb|lenvima|tasigna|iclusig|jakavi|jakafi|revlimid)\b/i;
