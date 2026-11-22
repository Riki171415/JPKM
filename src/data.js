export const outcomes = {
  layak: 'Layak Klaim',
  pending: 'Pending Klaim',
  dispute: 'Dispute',
  'tidak-layak': 'Tidak Layak',
};

let backendMode = null; // null | 'server' | 'client'
let clientBackendPromise = null;

function getClientBackend() {
  if (!clientBackendPromise) {
    clientBackendPromise = import('./client-backend.js');
  }
  return clientBackendPromise;
}

export function isClientBackend() {
  return backendMode === 'client';
}

export async function api(path, config = {}) {
  if (backendMode === 'client') {
    const { clientApi } = await getClientBackend();
    return await clientApi(path, config);
  }

  let response;
  try {
    response = await fetch('/api' + path, { ...config, headers: { 'X-Si-Jantan': 'local', ...config.headers } });
  } catch (networkError) {
    if (backendMode === null) {
      backendMode = 'client';
      const { clientApi } = await getClientBackend();
      return await clientApi(path, config);
    }
    throw networkError;
  }

  const contentType = response.headers.get('content-type') || '';
  const isJsonResponse = contentType.includes('application/json');

  // If initial API call returns non-JSON 404/502/503 (e.g. hosted on Vercel static without Node server),
  // switch seamlessly to in-browser client backend (IndexedDB + PDF.js + Tesseract.js).
  if (backendMode === null && !isJsonResponse && (!response.ok || contentType.includes('text/html'))) {
    backendMode = 'client';
    const { clientApi } = await getClientBackend();
    return await clientApi(path, config);
  }

  if (backendMode === null && isJsonResponse) {
    backendMode = 'server';
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Permintaan belum berhasil (' + response.status + ').');
  return data;
}

export async function resolvePagePreviewUrl({ episodeId, docIndex, pageNumber, fit, rotation }) {
  if (backendMode === 'client') {
    const { renderClientPagePreview } = await getClientBackend();
    return await renderClientPagePreview(episodeId, docIndex, pageNumber, fit, rotation);
  }
  const params = new URLSearchParams();
  if (fit) params.set('size', 'fit');
  if (rotation) params.set('rot', String(rotation));
  const query = params.toString();
  return `/api/episodes/${episodeId}/pages/${docIndex}/${pageNumber}${query ? '?' + query : ''}`;
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
