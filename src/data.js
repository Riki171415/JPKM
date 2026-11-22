export const outcomes = {
  layak: 'Layak Klaim',
  pending: 'Pending Klaim',
  dispute: 'Dispute',
  'tidak-layak': 'Tidak Layak',
};

export async function api(path, config = {}) {
  const response = await fetch('/api' + path, { ...config, headers: { 'X-Si-Jantan': 'local', ...config.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Permintaan belum berhasil (' + response.status + ').');
  return data;
}

export function json(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
}

export const rupiah = value => Number.isInteger(value) ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value) : '—';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function totalOf(rows) {
  const filled = rows.filter(row => Number.isInteger(row.meta.amount));
  if (!filled.length) return null;
  return filled.reduce((total, row) => total + row.meta.amount, 0);
}

export function exportRecap(rows) {
  const quote = value => {
    const string = String(value ?? '');
    const safe = /^[\s\uFEFF]*[=+@-]/.test(string) ? "'" + string : string;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const entries = [['Nomor klaim', 'Episode', 'Rumah sakit', 'Tanggal pelayanan', 'Nilai pengajuan (Rp)', 'Hasil', 'Dasar keputusan / tindak lanjut', 'Verifikator', 'Tanggal keputusan'],
    ...rows.map(row => [row.meta.claimNumber, row.title, row.meta.facility, row.meta.serviceDate, row.meta.amount,
      outcomes[row.decision?.status] || 'Belum diputuskan', row.decision?.reason, row.decision?.reviewer, row.decision?.date])];
  const blob = new Blob(['\uFEFF' + entries.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: 'Rekap_Verifikasi_Si_Jantan.csv' });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
