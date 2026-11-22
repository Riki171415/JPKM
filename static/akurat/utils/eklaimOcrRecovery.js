const parseCurrency = (value) => Number(String(value || '').replace(/[.,]\d{2}\s*$/, '').replace(/\D/g, '')) || 0;

const OCR_SEPARATOR = '[-‐‑‒–—_=~]';

export const normalizeOcrCbgCode = (value) => {
  const parts = String(value || '').toUpperCase().replace(/[|]/g, 'I').replace(/[\u2010-\u2014_=~]/g, '-').replace(/\s+/g, '').split('-').filter(Boolean);
  if (parts.length < 4) return String(value || '').trim().toUpperCase();
  if (/^[3J]$/.test(parts[0])) parts[0] = 'J';
  parts[1] = parts[1].replace(/[IL]/g, '1').replace(/O/g, '0');
  parts[2] = parts[2].replace(/[IL]/g, '1').replace(/O/g, '0');
  if (/^[1IL]{1,4}$/.test(parts.at(-1))) parts[parts.length - 1] = 'I'.repeat(parts.at(-1).length);
  return parts.join('-');
};

export const recoverEklaimOcrFields = (episode, ocrText) => {
  const text = String(ocrText || '').replace(/\s+/g, ' ').trim();
  const hasStructuralMarkers = /(?:Berkas\s+Kla[il1]m|Hasil\s+Grouping)/i.test(text)
    && /INA\s*-?\s*CBG/i.test(text);
  if (!hasStructuralMarkers) return episode;

  const rawCbg = text.match(new RegExp(`INA\\s*${OCR_SEPARATOR}?\\s*CBG\\s*[:;|]?\\s*([A-Z0-9]{1,2}\\s*${OCR_SEPARATOR}\\s*[0-9ILO]\\s*${OCR_SEPARATOR}\\s*[0-9ILO]{2}\\s*${OCR_SEPARATOR}\\s*[IV1L|]{1,4})`, 'i'))?.[1] || '';
  const cbg = normalizeOcrCbgCode(rawCbg);
  const tariffText = text.match(/Total\s+Tarif\s*[:;|]?\s*(?:Rp\s*)?([\d.,]+)/i)?.[1] || '';
  const groupingTail = text.slice(Math.max(0, text.search(/Hasil\s+Grouping/i)));
  const cbgTariffText = rawCbg
    ? groupingTail.slice(Math.max(0, groupingTail.indexOf(rawCbg) + rawCbg.length)).match(/\bRp\s*([\d.,]+)/i)?.[1] || ''
    : '';
  // Nilai di baris INA-CBG lebih andal daripada baris Total Tarif pada OCR
  // karena digit 9 pada font e-Klaim kerap terbaca sebagai 0.
  const nominal = parseCurrency(cbgTariffText) || parseCurrency(tariffText);
  const description = rawCbg
    ? text.slice(text.indexOf(rawCbg) + rawCbg.length).match(/^\s*([^]*?)(?=\s+Rp\s+[\d.,]+)/i)?.[1]?.trim() || ''
    : '';

  return {
    ...episode,
    cbg: cbg || episode?.cbg,
    cbgDescription: description || episode?.cbgDescription,
    nominal: nominal || episode?.nominal,
    hasEklaim: true,
    source: episode?.source === 'pdf-eklaim' ? episode.source : 'pdf-eklaim-recovered',
    keterangan: episode?.hasEklaim ? episode.keterangan : 'Episode e-Klaim dipulihkan dari hasil OCR halaman grouping',
  };
};
