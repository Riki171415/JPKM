export function needsReason(status) {
  return ['Perlu klarifikasi', 'Tidak sesuai', 'Tidak berlaku'].includes(status);
}

export function reviewIssue(title, result) {
  if (!result?.status) return 'Pilih hasil tinjau untuk ' + title + '.';
  if (needsReason(result.status) && !result.note?.trim()) return 'Isi alasan untuk ' + title + '.';
  if (result.status === 'Perlu klarifikasi') {
    return 'Alasan untuk ' + title + ' sudah diisi. Butir masih Perlu klarifikasi. Simpan tinjauan atau ubah hasil setelah klarifikasi selesai.';
  }
  return '';
}

export function flagReviews(reviews = {}, keep = () => false) {
  return Object.fromEntries(Object.entries(reviews).map(([id,result]) =>
    [id,keep(id) ? result : {...result,status:''}]));
}
