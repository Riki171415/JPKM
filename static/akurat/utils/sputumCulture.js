// Read each page separately: a sputum label on one page must not validate
// an unrelated culture (e.g. urine) elsewhere in the patient's PDF.
const ORGANISM = /\b(?:Klebsiella|Escherichia|Pseudomonas|Acinetobacter|Staphylococcus|Streptococcus|Enterobacter|Enterococcus|Haemophilus|Moraxella|Serratia|Proteus|Candida)\s+(?:[a-z]{3,}(?:-[a-z]+)?|spp?\.?)\b/gi;
const SPECIMEN = /\b(?:spesimen|specimen|sampel|bahan)\s*[:=|-]?\s*(sputum|dahak)\b/gi;
const NEXT_SPECIMEN = /\b(?:spesimen|specimen|sampel|bahan)\s*[:=|-]/i;
const CULTURE_EXAM = /\b(?:kultur|culture|biakan)\b|identifikasi\s+dan\s+uji\s+kepekaan\s+bakteri/i;
const NEGATIVE_RESULT = /tidak\s+(?:ada\s+)?(?:pertumbuhan|tumbuh)|no\s+growth|(?:hasil|kultur|biakan)\s*[:=|-]?\s*negatif/i;

export function extractSputumCulture(rawText = '') {
  const evidence = [];
  const organisms = new Set();
  let pdfNumber = 1;
  let pageNumber = null;
  for (const part of String(rawText).split(/(\[halaman\s+\d+\])/i)) {
    const marker = part.match(/^\[halaman\s+(\d+)\]$/i);
    if (marker) {
      if (Number(marker[1]) === 0) { pdfNumber += 1; pageNumber = null; }
      else pageNumber = Number(marker[1]);
      continue;
    }
    const page = part.replace(/\s+/g, ' ').trim();
    for (const specimen of page.matchAll(SPECIMEN)) {
      const start = specimen.index;
      const afterLabel = start + specimen[0].length;
      const tail = page.slice(afterLabel, afterLabel + 1200);
      const nextSpecimen = tail.search(NEXT_SPECIMEN);
      const report = specimen[0] + tail.slice(0, nextSpecimen < 0 ? undefined : nextSpecimen);
      if (!CULTURE_EXAM.test(report)) continue;
      const found = [...report.matchAll(ORGANISM)].map((match) => match[0]);
      // "Hasil kultur: Terlampir" alone only points to an attachment;
      // require an actual organism or an explicit negative culture result.
      if (!found.length && !NEGATIVE_RESULT.test(report)) continue;
      found.forEach((name) => organisms.add(name));
      const source = pageNumber ? `PDF ${pdfNumber} · Halaman ${pageNumber}` : 'Halaman tidak diketahui';
      evidence.push(`[${source}] "${report.slice(0, 600).trim()}"`);
    }
  }
  return { detected: evidence.length > 0, organisms: [...organisms], evidence };
}
