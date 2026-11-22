// Membaca data terstruktur dari halaman "Berkas Klaim Individual Pasien" (e-Klaim INA-CBG),
// total tagihan RS, serta pemeriksaan konsistensi lintas dokumen. Modul ini murni JavaScript
// tanpa dependensi sehingga dapat dipakai di peramban maupun di server Node.js.

const groupingPattern = /kla[i1l]m\s+individua[l1i]|hasil\s+grouping[\s\S]{0,60}ina.?cbg/i;
const checklistPagePattern = /template\s+dokumen\s+ajuan|no\s+persyaratan\s+kriteria\s+sesuai\s+tidak\s+sesuai/i;
const eligibilityPagePattern = /status[\s\S]{0,40}kepesertaan|sipp\.bpjs-kesehatan|vclaim\.bpjs-kesehatan|pencarian\s+(?:detail\s+)?peserta|pencarian\s+tagihan\/pembayaran\s+peserta/i;

const fields = [
  ['kodeRS', /kode\s+rumah\s+sakit/i],
  ['kelasRS', /kelas\s+rumah\s+sakit/i],
  ['namaRS', /nama\s+rs\b/i],
  ['jenisTarif', /jenis\s+tarif/i],
  ['nomorPeserta', /nomor\s+peserta/i],
  ['nomorSEP', /nomor\s+sep/i],
  ['noRM', /nomor\s+rekam\s+medis/i],
  ['tglMasuk', /tanggal\s+masuk/i],
  ['tglKeluar', /tanggal\s+keluar/i],
  ['umurTahun', /umur\s+tahun/i],
  ['umurHari', /umur\s+hari/i],
  ['jenisPerawatan', /jenis\s+perawatan/i],
  ['tglLahir', /tanggal\s+lahir/i],
  ['caraPulang', /cara\s+pulang/i],
  ['jenisKelamin', /jenis\s+kelamin/i],
  ['los', /\bLOS\b/],
  ['kelasPerawatan', /kelas\s+perawatan/i],
  ['beratLahir', /berat\s+lahir/i],
  ['registerSITB', /nomor\s+register\s+sitb/i],
  ['diagnosaUtama', /diagnos(?:a|is)\s+utama/i],
  ['diagnosaSekunder', /diagnos(?:a|is)\s+sekunder/i],
  ['prosedur', /^\s*prosedur\b(?:\s*[:;|])?/i],
  ['adl', /\bADL\s+Sub/i],
  ['hasilGrouping', /hasil\s+grouping/i],
  ['inacbg', /\bINA\s*-?\s*CBG\b(?!\s*\))/i],
  ['subAcute', /\bsub\s+acute\b/i],
  ['chronic', /(?<!sub\s)\bchronic\b/i],
  ['specialCmg', /special\s+cmg/i],
  ['totalTarif', /total\s+tarif/i],
  ['generated', /\bgenerated\b/i],
];

const singleRowKeys = new Set(['inacbg', 'subAcute', 'chronic', 'specialCmg', 'totalTarif', 'generated']);
const cleanValue = value => value.replace(/^[\s:;|.,_~=—–-]+/, '').replace(/[\s:;|_~=—–-]+$/, '').replace(/\s+/g, ' ').trim();

// Nilai kosong pada e-Klaim ditulis dengan tanda "-"; OCR kadang membacanya sebagai "HE", "i", dll.
const emptyValue = value => !value || /^[-–—=~_.]+$/.test(value) || /^(?:HE+|i+|ii\.?)$/i.test(value);

export function parseCurrency(value) {
  const text = String(value || '').replace(/\s/g, '');
  if (!/\d/.test(text)) return null;
  const number = Number(text.replace(/[.,]\d{2}$/, '').replace(/\D/g, ''));
  return Number.isSafeInteger(number) ? number : null;
}

export function isoDate(value) {
  const match = String(value || '').match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/) || String(value || '').match(/\b(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/);
  if (!match) return '';
  const [year, month, day] = match[1].length === 4 ? [match[1], match[2], match[3]] : [match[3], match[2], match[1]];
  const iso = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
}

export const daysBetween = (start, end) => Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);

function readFields(text) {
  const values = {};
  for (const line of String(text || '').split('\n')) {
    const hits = [];
    for (const [key, pattern] of fields) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      for (const match of line.matchAll(global)) hits.push({ key, start: match.index, end: match.index + match[0].length });
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = hits.filter((hit, index) => !hits.slice(0, index).some(other => hit.start < other.end));
    if (kept.length && singleRowKeys.has(kept[0].key)) {
      if (values[kept[0].key] === undefined) values[kept[0].key] = cleanValue(line.slice(kept[0].end));
      continue;
    }
    kept.forEach((hit, index) => {
      if (values[hit.key] !== undefined) return;
      values[hit.key] = cleanValue(line.slice(hit.end, kept[index + 1]?.start ?? line.length));
    });
  }
  return values;
}

function rupiahAfter(value) {
  const match = String(value || '').match(/Rp\.?\s*([\d.,]+)/i);
  return match ? parseCurrency(match[1]) : null;
}

function normalizeCbgCode(raw) {
  const parts = String(raw || '').toUpperCase().replace(/[|]/g, 'I').replace(/[\u2010-\u2014_=~]/g, '-').replace(/\s+/g, '').split('-').filter(Boolean);
  if (parts.length < 4) return String(raw || '').replace(/\s+/g, '').toUpperCase();
  parts[1] = parts[1].replace(/[IL]/g, '1').replace(/O/g, '0');
  parts[2] = parts[2].replace(/[IL]/g, '1').replace(/O/g, '0');
  if (/^[1IL]{1,4}$/.test(parts[3])) parts[3] = 'I'.repeat(parts[3].length);
  return parts.join('-');
}

const payerPattern = /\b(JPKM(?:\s+PROV\.?\s+JABAR)?|JAMKESDA(?:\s+PROV\s+JABAR)?|JAMKESOS|SKTM|JKN)\b/i;

// Menormalkan nomor kelas tarif/RS menjadi huruf A-D.
const classLetter = value => String(value || '').match(/\bKELAS\s+([A-D])\b/i)?.[1]?.toUpperCase()
  || String(value || '').trim().match(/^([A-D])\b/i)?.[1]?.toUpperCase() || '';

const cbgLinePattern = /^([A-Z0-9]{1,2}\s*[-–—]\s*[0-9ILO]\s*[-–—]\s*[0-9ILO]{2}\s*[-–—]\s*(?:0|[IVX1L|]{1,4}))\s*(.*?)\s*(?:Rp\.?\s*[\d.,]+)?$/i;
const cbgFallbackPattern = /\bINA\s*[-–—]?\s*CBG\s*[:;|]?\s*([A-Z0-9]{1,2}\s*[-–—]\s*[0-9ILO]\s*[-–—]\s*[0-9ILO]{2}\s*[-–—]\s*(?:0|[IVX1L|]{1,4}))\s+([^]*?)(?=\s*(?:Rp\.?\s*[\d.,]+|\bSub\s+Acute\b|$))/i;

export function parseGroupingText(text) {
  const raw = readFields(text);
  const value = key => emptyValue(raw[key]) ? '' : raw[key];
  const tail = String(text || '').slice(Math.max(0, String(text || '').search(/hasil\s+grouping/i)));
  const cbgMatch = String(raw.inacbg || '').match(cbgLinePattern) || tail.replace(/\s+/g, ' ').match(cbgFallbackPattern);
  const cbg = cbgMatch ? normalizeCbgCode(cbgMatch[1]) : '';
  const cbgDescription = cbgMatch?.[2]?.replace(/\s+/g, ' ').replace(/[:;|]+$/, '').trim() || '';
  const tarif = rupiahAfter(raw.totalTarif) ?? rupiahAfter(raw.inacbg);
  const los = Number(String(raw.los || '').match(/\d+/)?.[0]);
  const umurTahun = Number(String(raw.umurTahun || '').match(/\d{1,3}/)?.[0]);
  const umurHari = Number(String(raw.umurHari || '').match(/\d+/)?.[0]);
  const header = String(text || '').slice(0, 400);
  return {
    kodeRS: value('kodeRS'),
    kelasRS: classLetter(raw.kelasRS),
    namaRS: value('namaRS'),
    jenisTarif: value('jenisTarif'),
    kelasTarif: classLetter(raw.jenisTarif),
    penjamin: header.match(payerPattern)?.[1]?.toUpperCase().replace(/\s+/g, ' ') || '',
    nomorPeserta: value('nomorPeserta'),
    nomorSEP: value('nomorSEP'),
    noRM: value('noRM'),
    tglMasuk: isoDate(raw.tglMasuk),
    tglKeluar: isoDate(raw.tglKeluar),
    tglLahir: isoDate(raw.tglLahir),
    umurTahun: Number.isFinite(umurTahun) ? umurTahun : null,
    umurHari: Number.isFinite(umurHari) ? umurHari : null,
    jenisPerawatan: value('jenisPerawatan').replace(/^\d\s*-\s*/, ''),
    caraPulang: value('caraPulang').replace(/^\d\s*-\s*/, ''),
    jenisKelamin: value('jenisKelamin').replace(/^\d\s*-\s*/, ''),
    kelasPerawatan: value('kelasPerawatan').replace(/^\d\s*-\s*/, ''),
    registerSITB: value('registerSITB'),
    los: Number.isFinite(los) ? los : null,
    cbg,
    cbgDescription,
    tarif,
  };
}

const billingTotalPatterns = [
  /grand\s+total\s*:?\s*Rp\.?\s*([\d.,]{4,})/gi,
  /total\s+pembayaran[\s\S]{0,60}?sub\s+total\s*:\s*(?:Rp\.?\s*)?([\d.,]{4,})/gi,
  /grand\s+total\s*:[\s\S]{0,120}?sub\s+total\s*:\s*(?:Rp\.?\s*)?([\d.,]{4,})/gi,
  /total\s+seluruh\s*[:.]?\s*(?:Rp\.?\s*)?([\d.,]{4,})/gi,
  /tagihan\s*\+\s*ppn\s*:\s*(?:Rp\.?\s*)?([\d.,]{4,})/gi,
  /total\s+tagihan\s*:\s*(?:Rp\.?\s*)?([\d.,]{4,})/gi,
  /([\d.,]{4,})\s+total\s+rs\s*:\s*Rp/gi,
  /total\s+rs\s*:\s*Rp\.?\s*([\d.,]{4,})/gi,
  /jaminan\s+pemeliharaan\s+([\d.,]{4,})/gi,
  /total\s+bayar\s*[:.]?\s*Rp\.?\s*([\d.,]{4,})/gi,
  /(?:jumlah|total)\s+(?:yang\s+harus\s+)?(?:dibayar|bayar)\s*[:.]?\s*Rp\.?\s*([\d.,]{4,})/gi,
  /total\s+biaya\s*:?\s*Rp\.?\s*([\d.,]{4,})/gi,
  /banyaknya\s+uang[\s\S]{0,200}?Rp\.?\s*([\d.,]{4,})/gi,
];

// Mencari total tagihan rumah sakit dari halaman billing/kuitansi di semua format RS.
export function findBillingTotal(pages) {
  const billPages = pages.filter(page => {
    const text = page.text || '';
    return !groupingPattern.test(text) && !eligibilityPagePattern.test(text) && !checklistPagePattern.test(text);
  });
  for (const pattern of billingTotalPatterns) {
    const hits = [];
    for (const page of billPages) {
      const text = page.text || '';
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      for (const match of text.matchAll(global)) {
        const amount = parseCurrency(match[1]);
        if (amount && amount >= 1000) {
          hits.push({ amount, file: page.file, number: page.number, excerpt: match[0].replace(/\s+/g, ' ').slice(0, 120) });
        }
      }
    }
    if (hits.length) {
      // Pada tagihan multi-episode (mis. IGD lalu Rawat Inap), pilih total gabungan terbesar/terakhir.
      return hits.reduce((best, current) => current.amount >= best.amount ? current : best);
    }
  }
  for (const page of billPages) {
    const text = page.text || '';
    if (!/k[wu][i1l]tans[i1l]/i.test(text)) continue;
    const match = /subtotal\s*[:.]?\s*Rp\.?\s*([\d.,]{4,})/i.exec(text);
    const amount = match && parseCurrency(match[1]);
    if (amount && amount >= 1000) {
      return { amount, file: page.file, number: page.number, excerpt: match[0].replace(/\s+/g, ' ').slice(0, 120) };
    }
  }
  return null;
}

export function findGroupingPage(pages) {
  return pages.find(page => groupingPattern.test(page.text || '') || groupingPattern.test(page.layout || ''));
}

const normalizeRm = value => String(value || '').replace(/\D/g, '').replace(/^0+/, '');
const dateLikeRm = value => /^\d{2}-\d{2}-\d{4}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value);

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function extractPageName(text) {
  const line = String(text || '').match(/(?:nama\s+(?:pasien|lengkap)|nama[ \t]*[:;]|sudah\s+diterima\s+dari)[ \t]*[:;]?[ \t]*([A-Z][A-Z \t.,'()-]{2,55}?)(?=[ \t]{2,}|[ \t]+(?:no\.?[ \t]*rm|no\.?[ \t]*rekam|nik\b|tgl|tanggal|umur|usia|jenis|kelamin|alamat|ruang|dokter|banyaknya|pemeriksa)\b|$|\r?\n)/i);
  if (!line) return '';
  const candidate = line[1].replace(/\s+/g, ' ').replace(/[,:;.\s]+$/, '').trim();
  if (/^(?:umur|usia|ruang|alamat|jenis|kelamin|pekerjaan|tanggal|pasien|laki|perempuan|tidak|ada)$/i.test(candidate)) return '';
  return candidate;
}

function extractPageRms(text) {
  const rms = [];
  const pattern = /(?:no\.?\s*(?:rekam\s*medis|rekam\s*medik|rm|medrek|med\.?\s*rec)|nomor\s*rm)\s*[:.]?\s*([0-9][0-9-]{4,14})/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const raw = match[1].replace(/-+$/, '');
    if (dateLikeRm(raw)) continue;
    const norm = normalizeRm(raw);
    if (norm.length >= 5) rms.push({ raw, norm });
  }
  return rms;
}

export function findPatientName(pages, claim) {
  const claimRm = normalizeRm(claim?.noRM);
  const prioritized = pages.filter(page => {
    const text = page.text || '';
    if (checklistPagePattern.test(text) || eligibilityPagePattern.test(text)) return false;
    if (claimRm) {
      const rms = extractPageRms(text);
      if (rms.length && rms.every(item => item.norm !== claimRm)) return false;
    }
    return /resume|ringkasan|surat\s+eligibilitas|surat\s+(?:rekomendasi|keterangan)|kwitansi|kuitansi|rincian|laboratorium|radiologi/i.test(text);
  });
  for (const page of prioritized) {
    const candidate = extractPageName(page.text || '');
    if (candidate && candidate.length >= 3) {
      return candidate.replace(/\s*\([LP]\)\s*$/i, '').replace(/,\s*(?:AN|TN|NY|BY\.NY)\.?\s*$/i, '').trim();
    }
  }
  return '';
}

const samePage = (a, b) => a.file === b.file && a.number === b.number;

export function auditConsistency(pages, claim, docs = {}) {
  const groupRef = claim ? [{ file: claim.file, number: claim.number }] : [];
  const tariffClassMismatch = claim?.kelasRS && claim?.kelasTarif && claim.kelasRS !== claim.kelasTarif
    ? { kelasRS: claim.kelasRS, kelasTarif: claim.kelasTarif, refs: groupRef }
    : null;
  const jknPayerOnClaim = claim?.penjamin === 'JKN'
    ? { penjamin: claim.penjamin, refs: groupRef }
    : null;
  const deathPages = pages.filter(page => !checklistPagePattern.test(page.text || '')
    && /(?:laporan|surat(?:\s+keterangan)?|sertifikat)\s+kematian/i.test(page.text || ''));
  const deathDischargeMismatch = deathPages.length && claim?.caraPulang && !/meninggal/i.test(claim.caraPulang)
    ? { caraPulang: claim.caraPulang, refs: [...groupRef, ...deathPages.map(page => ({ file: page.file, number: page.number }))] }
    : null;
  const expectedLos = claim?.tglMasuk && claim?.tglKeluar && claim.tglMasuk <= claim.tglKeluar
    ? daysBetween(claim.tglMasuk, claim.tglKeluar) + 1
    : null;
  const losMismatch = expectedLos !== null && Number.isFinite(claim?.los) && claim.los !== expectedLos
    ? { los: claim.los, expected: expectedLos, tglMasuk: claim.tglMasuk, tglKeluar: claim.tglKeluar, refs: groupRef }
    : null;

  const claimRm = normalizeRm(claim?.noRM);
  const wrongPatientPages = [];
  if (claimRm.length >= 5) {
    for (const page of pages) {
      if (page.ocr) continue;
      const text = page.text || '';
      if (!text || groupingPattern.test(text) || checklistPagePattern.test(text) || eligibilityPagePattern.test(text)) continue;
      const rms = extractPageRms(text);
      if (!rms.length || rms.some(item => item.norm === claimRm)) continue;
      const foreign = rms.find(item => editDistance(item.norm, claimRm) >= 2);
      if (!foreign) continue;
      const name = extractPageName(text);
      wrongPatientPages.push({
        file: page.file,
        number: page.number,
        rm: foreign.raw,
        name,
        excerpt: `No. RM ${foreign.raw}${name ? ' (' + name + ')' : ''} berbeda dari e-Klaim (${claim.noRM})`,
      });
    }
  }

  const claimGender = /laki/i.test(claim?.jenisKelamin || '') ? 'L' : /perempuan|wanita/i.test(claim?.jenisKelamin || '') ? 'P' : '';
  const genderMismatch = [];
  if (claimGender) {
    const checkedRefs = [...(docs.resume?.refs || []), ...(docs.ed?.refs || [])];
    for (const page of pages) {
      if (page.ocr) continue;
      if (wrongPatientPages.some(ref => samePage(ref, page))) continue;
      if (!checkedRefs.some(ref => samePage(ref, page))) continue;
      const match = (page.text || '').match(/jenis\s+kelamin[\s:.;-]*(laki[\s-]*laki|perempuan|\bL\b|\bP\b)/i)
        || (page.text || '').match(/jenis\s+kelamin[\s\S]{0,100}?\b(laki[\s-]*laki|perempuan)\b/i);
      if (!match) continue;
      const pageGender = /^l/i.test(match[1]) ? 'L' : /^p/i.test(match[1]) ? 'P' : '';
      if (pageGender && pageGender !== claimGender) {
        genderMismatch.push({
          file: page.file,
          number: page.number,
          found: match[1],
          expected: claim.jenisKelamin,
          excerpt: `Jenis kelamin pada halaman tertulis "${match[1]}", sedangkan pada e-Klaim "${claim.jenisKelamin}"`,
        });
      }
    }
  }

  return { tariffClassMismatch, jknPayerOnClaim, deathDischargeMismatch, losMismatch, wrongPatientPages, genderMismatch };
}

// Data awal untuk formulir keputusan. Semua nilai dibatasi agar lolos validasi server.
export function claimMeta(claim) {
  if (!claim) return {};
  const sep = claim.nomorSEP && !/^[-–—]+$/.test(claim.nomorSEP) ? claim.nomorSEP : '';
  const meta = {
    facility: (claim.namaRS || '').slice(0, 180).trim(),
    claimNumber: (sep || (claim.noRM ? 'RM ' + claim.noRM : '')).slice(0, 100).trim(),
    serviceDate: claim.tglMasuk || '',
  };
  if (Number.isSafeInteger(claim.tarif) && claim.tarif > 0 && claim.tarif <= 1_000_000_000_000) meta.amount = claim.tarif;
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== '' && value != null));
}

export function claimFromPages(pages) {
  const page = findGroupingPage(pages);
  if (!page) return null;
  const native = parseGroupingText(page.text || '');
  const layout = page.layout ? parseGroupingText(page.layout) : {};
  const merged = Object.fromEntries(Object.keys(native).map(key => [key, native[key] || native[key] === 0 ? native[key] : layout[key] ?? native[key]]));
  return { ...merged, file: page.file, number: page.number };
}
