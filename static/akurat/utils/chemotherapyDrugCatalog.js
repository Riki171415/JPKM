// Daftar lokal dari "DANI - daftar obat kemoterapi fix.xlsx" (80 baris).
// Istilah dibuat tanpa dosis agar tetap cocok terhadap variasi resep dan hasil OCR.
const GROUPS = {
  ORAL: [
    'alkeran', 'binecap', 'erlotinibe', 'gefitero', 'getana', 'hydroxy urea',
    'imafer', 'iclusig', 'imatero', 'jakavi', 'lenvima', 'ledomid', 'niltib',
    'tasigna', 'capecitabine', 'votrien', 'vilena',
  ],
  INJEKSI: [
    'adcetris', 'brexel', 'bleocin', 'bortecade', 'cyclophosphamide',
    'carboplatin', 'cisplatin', 'calcium folinate', 'doxo', 'dacarbazin',
    'docetaxel', 'endoxan', 'epirubicin', 'erbitux', 'fludara', 'fluorouracil',
    'fonkopac', 'fytosid', 'etoposid', 'fontrexed', 'gemcikal', 'holoxan',
    'halaven', 'herzemab', 'irinotecan', 'ibandronic acid', 'methotrexat',
    'oxaliplatin', 'paclitaxel', 'rexta', 'rituxikal', 'redditux', 'uromitexan',
    'uromesan', 'vincristin', 'vinorelbine',
  ],
  ADJUVAN: [
    'aromasin', 'atz', 'avestran', 'billuron', 'bicastra', 'endrolin', 'lebrest',
    'nateran', 'tamofen', 'zoladex', 'zolenic', 'zoledronic acid',
  ],
};

// Koreksi keselamatan: TYKERB pada sumber tertulis "KEMO INJEKSI", tetapi bentuk
// sediaannya tablet dan alias kanonik lapatinib adalah terapi oral.
GROUPS.ORAL.push('tykerb');

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const CHEMOTHERAPY_DRUG_CATALOG = Object.entries(GROUPS).flatMap(([category, terms]) =>
  terms.map((term) => ({ term, category, oral: category === 'ORAL' })),
);

export const detectChemotherapyDrugs = (text) => {
  const normalized = normalize(text);
  return CHEMOTHERAPY_DRUG_CATALOG.filter(({ term }) => {
    const words = normalize(term).split(' ').map(escapeRegex).join('\\s+');
    return new RegExp(`(?:^|\\s)${words}(?:\\s|$)`, 'i').test(normalized);
  });
};

export const chemotherapyCategoryLabel = (category) => ({
  ORAL: 'Kemoterapi oral',
  INJEKSI: 'Kemoterapi injeksi',
  ADJUVAN: 'Terapi adjuvan/penunjang onkologi',
})[category] || category;
