const uniqueNumbers = (values) => [...new Set(values.filter(Number.isFinite))];

const parseLeukocyte = (raw) => {
  const clean = String(raw || '').trim();
  let num;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(clean)) num = Number(clean.replace(/[.,]/g, ''));
  else num = Number(clean.replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  // Nilai lab satuan sel/uL (mis. 9840, 3600, 11.500) dikonversi ke 10^3/uL.
  if (num >= 500 && num <= 200000) return Math.round((num / 1000) * 100) / 100;
  return num >= 0.1 && num <= 100 ? num : null;
};

const parseNumber = (value) => Number(String(value).replace(',', '.'));

// PDF laboratorium digital sering menyimpan seluruh nama pemeriksaan terlebih
// dahulu, lalu seluruh nilai pada kolom berikutnya. Akibatnya label "Lekosit"
// dan nilainya dapat berjauhan walaupun secara visual berada pada satu baris.
export const extractLeukocyteValues = (sourceText) => {
  const text = String(sourceText || '');
  const directResults = [...text.matchAll(/(?:leukosit|lekosit|lekocit|leucocyte|leukocyte|wbc)(?!\s*(?:urin|urine))[^0-9a-z\n]{0,20}(\d{1,3}(?:[.,]\d{3})|\d{1,6}(?:[.,]\d+)?)/gi)]
    .map((match) => parseLeukocyte(match[1]))
    .filter((value) => value !== null);
  const tableResults = [];

  const pages = text.split(/(?=\[halaman\s+\d+\])/i);
  pages.forEach((page) => {
    if (!/hasil\s+pemeriksaan\s+laboratorium/i.test(page)
      || !/darah\s+lengkap/i.test(page)
      || !/hemoglobin/i.test(page)
      || !/(?:leukosit|lekosit|lekocit)/i.test(page)) return;

    const labelBlock = page.match(/hemoglobin[\s\S]{0,900}?basofil\s*%?/i);
    if (!labelBlock) return;
    const start = (labelBlock.index || 0) + labelBlock[0].length;
    const values = [...page.slice(start, start + 700).matchAll(/(?<![a-z])\d{1,3}(?:[.,]\d+)?(?![a-z])/gi)]
      .map((match) => parseNumber(match[0]));

    // Urutan awal kolom hasil CBC: Hb, Ht, leukosit, trombosit, eritrosit.
    if (values.length >= 5 && values[2] >= 0.1 && values[2] <= 100) tableResults.push(values[2]);
  });

  // Nilai hasil rekonstruksi tabel didahulukan. Pada halaman rekap, pola
  // langsung kadang menangkap batas rujukan "5.2 - 11.0" sebagai hasil.
  return uniqueNumbers([...tableResults, ...directResults]).filter((value) => value >= 0.1 && value <= 100);
};
