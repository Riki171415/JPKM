import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, formatDate, json, outcomes, rupiah } from './data.js';
import { Badge, ReviewDesk } from './review.jsx';
import { Minutes, Recap } from './reports.jsx';
import {
  IconCheck,
  IconClock,
  IconFileText,
  IconFolder,
  IconLayers,
  IconMoon,
  IconPanelLeft,
  IconRestore,
  IconSearch,
  IconShield,
  IconSun,
  IconTrash,
  IconUpload,
  IconX,
} from './icons.jsx';
import './styles.css';

const screens = [
  ['desk', 'Verifikasi Klaim'],
  ['recap', 'Rekap Verifikasi'],
  ['minutes', 'Berita Acara'],
];

const importModes = [
  ['episode', 'Satu episode pasien', 'Gabungkan 1–12 PDF lampiran milik pasien yang sama.'],
  ['batch', 'Banyak episode sekaligus', 'Setiap berkas PDF diimpor otomatis menjadi satu episode terpisah.'],
  ['package', 'Paket pengajuan rumah sakit', 'Pemeriksaan SPTJM, surat pengajuan, dan rekap pengajuan.'],
];

const worklistFilters = [
  ['all', 'Semua'],
  ['unstarted', 'Belum'],
  ['inprogress', 'Proses'],
  ['decided', 'Selesai'],
];

const SCHEME_KEY = 'sijantan-color-scheme';

function getSystemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getStoredScheme() {
  try {
    const val = localStorage.getItem(SCHEME_KEY);
    return val === 'light' || val === 'dark' ? val : null;
  } catch {
    return null;
  }
}

function applySchemeMeta(content) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = content;
}

function useLightDismissFallback(dialogRef, open, allowLightDismiss) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    let pressedOutside = false;
    const isOutside = event => {
      const r = dialog.getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    };
    const onDown = event => {
      pressedOutside = Boolean(allowLightDismiss && dialog.open && isOutside(event));
    };
    const onUp = event => {
      if (allowLightDismiss && pressedOutside && dialog.open && isOutside(event)) dialog.close();
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, [dialogRef, open, allowLightDismiss]);
}

function ConfirmDialog({ request, onResolve }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  useLightDismissFallback(dialogRef, Boolean(request), true);

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const value = dialog.returnValue || 'cancel';
    dialog.returnValue = '';
    onResolve(value);
  };

  return (
    <dialog
      id="confirm-dialog"
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onClose={handleClose}
    >
      {request && (
        <form method="dialog" className="confirm-form">
          <h2 id={titleId}>{request.title}</h2>
          <p id={messageId} className="confirm-body">{request.message}</p>
          <div className="actions end confirm-actions">
            {request.secondaryLabel && (
              <button type="submit" value="secondary" className="secondary-btn">
                {request.secondaryLabel}
              </button>
            )}
            <button type="submit" value="cancel" autoFocus>
              {request.cancelLabel || 'Batal'}
            </button>
            <button
              type="submit"
              value="primary"
              className={request.tone === 'danger' ? 'danger-btn' : 'primary'}
            >
              {request.primaryLabel || 'Lanjutkan'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function getRowBucket(row) {
  if (row.decision?.status || (row.scope === 'package' && row.approved?.includes('admin'))) return 'decided';
  if (row.approved?.length || row.revision > 0) return 'inprogress';
  return 'unstarted';
}

function App() {
  const [screen, setScreen] = useState('desk');
  const [rows, setRows] = useState([]);
  const [trash, setTrash] = useState([]);
  const [active, setActive] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [importMode, setImportMode] = useState('episode');
  const [importProgress, setImportProgress] = useState('');
  const [batchProgress, setBatchProgress] = useState(null);
  const [importError, setImportError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [managing, setManaging] = useState(false);
  const [trashError, setTrashError] = useState('');
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [workFilter, setWorkFilter] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chosen, setChosen] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const importDialogRef = useRef(null);
  const trashDialogRef = useRef(null);
  const fileInputRef = useRef(null);
  const confirmResolverRef = useRef(null);
  const titleInputId = useId();
  const fileInputId = useId();
  const searchInputId = useId();

  useLightDismissFallback(importDialogRef, importOpen, !uploading);
  useLightDismissFallback(trashDialogRef, trashOpen, true);

  const askConfirm = useCallback(config => {
    if (confirmResolverRef.current) confirmResolverRef.current('cancel');
    return new Promise(resolve => {
      confirmResolverRef.current = resolve;
      setConfirmState(config);
    });
  }, []);

  const resolveConfirm = useCallback(value => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(value || 'cancel');
  }, []);

  const notify = useCallback((text, error = false) => setToast({ text, error }), []);

  const reload = useCallback(async () => {
    const [epRows, trashRows] = await Promise.all([api('/episodes'), api('/trash')]);
    setRows(epRows);
    setTrash(trashRows);
  }, []);

  useEffect(() => {
    reload().catch(error => notify(error.message, true));
  }, [reload, notify]);

  useEffect(() => {
    const onStorage = event => {
      if (event.key === SCHEME_KEY) {
        const stored = event.newValue;
        applySchemeMeta(stored === 'light' || stored === 'dark' ? stored : 'light dark');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const label = screens.find(([id]) => id === screen)?.[1] || 'Verifikasi Klaim';
    document.title = screen === 'desk' && active?.title
      ? `${active.title} · ${label} | Si Jantan`
      : `${label} | Si Jantan JPKM Jabar`;
  }, [screen, active?.title]);

  useEffect(() => {
    const guard = event => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const toggleTheme = () => {
    const systemDark = getSystemDark();
    const stored = getStoredScheme();
    const currentlyDark = stored ? stored === 'dark' : systemDark;
    const target = currentlyDark ? 'light' : 'dark';
    const systemTheme = systemDark ? 'dark' : 'light';
    try {
      if (target === systemTheme) {
        localStorage.removeItem(SCHEME_KEY);
        applySchemeMeta('light dark');
      } else {
        localStorage.setItem(SCHEME_KEY, target);
        applySchemeMeta(target);
      }
    } catch {
      applySchemeMeta(target);
    }
  };

  const canLeave = useCallback(async () => {
    if (!dirty) return true;
    const choice = await askConfirm({
      title: 'Perubahan belum disimpan',
      message: 'Ada perubahan tinjauan yang belum disimpan. Lanjutkan dan abaikan perubahan tersebut?',
      primaryLabel: 'Abaikan perubahan',
      cancelLabel: 'Tetap di halaman',
      tone: 'warning',
    });
    return choice === 'primary';
  }, [dirty, askConfirm]);

  const navigate = async target => {
    if (target === screen || saving || loading || managing) return;
    if (!await canLeave()) return;
    if (dirty) { setActive(null); setDirty(false); }
    setToast(null);
    setScreen(target);
  };

  const open = async (id, force = false) => {
    if (loading || saving || managing) return;
    if (!force && !await canLeave()) return;
    setLoading(true);
    try {
      setActive(await api('/episodes/' + id));
      setDirty(false);
      setScreen('desk');
      setToast(null);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setLoading(false);
    }
  };

  const edit = next => {
    setActive(current => ({ ...current, state: typeof next === 'function' ? next(current.state) : next }));
    setDirty(true);
  };

  const save = async (state, message) => {
    if (saving || managing) return false;
    setSaving(true);
    try {
      const result = await api('/episodes/' + active.id + '/review', json('PUT', { state, revision: active.revision }));
      setActive({ ...active, state, revision: result.revision });
      setDirty(false);
      notify(message);
      await reload();
      return true;
    } catch (error) {
      notify(error.message, true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openImport = async (mode = 'episode') => {
    if (saving || managing) return;
    if (!await canLeave()) return;
    setImportMode(mode);
    setImportError('');
    setImportProgress('');
    setBatchProgress(null);
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImportOpen(true);
    importDialogRef.current?.showModal();
  };

  const busy = loading || saving || uploading || managing;

  const remove = async id => {
    if (busy) return;
    const affectsActive = !id || active?.id === id;
    const targetRow = id ? rows.find(row => row.id === id) : null;
    const choice = await askConfirm({
      title: id ? `Hapus episode "${targetRow?.title || 'berkas'}"?` : 'Bersihkan semua daftar PDF?',
      message: (id
        ? 'Pilih Pindahkan ke Sampah agar masih dapat dipulihkan, atau Hapus Permanen untuk menghapus catatan dan berkas PDF dari penyimpanan lokal.'
        : `Semua (${rows.length}) episode dan berkas PDF di Daftar Kerja akan dipindahkan ke Sampah atau dihapus permanen.`)
        + (affectsActive && dirty ? '\n\nCatatan: Perubahan yang belum disimpan akan dibuang.' : ''),
      secondaryLabel: 'Pindahkan ke Sampah',
      primaryLabel: 'Hapus Permanen',
      cancelLabel: 'Batal',
      tone: 'danger',
    });
    if (choice !== 'primary' && choice !== 'secondary') return;

    const permanent = choice === 'primary';
    setManaging(true);
    try {
      const suffix = (id ? '/' + id : '') + (permanent ? '?permanent=1' : '');
      const { count } = await api('/episodes' + suffix, { method: 'DELETE' });
      if (affectsActive) { setActive(null); setDirty(false); }
      setChosen(current => id ? current.filter(value => value !== id) : []);
      await reload();
      notify(permanent ? `${count} entri dan PDF dihapus permanen.` : `${count} entri dipindahkan ke Sampah.`);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setManaging(false);
    }
  };

  const showTrash = async () => {
    setManaging(true);
    setTrashError('');
    setTrashOpen(true);
    trashDialogRef.current?.showModal();
    try {
      setTrash(await api('/trash'));
    } catch (error) {
      setTrashError(error.message);
    } finally {
      setManaging(false);
    }
  };

  const removeDocument = async index => {
    if (busy || !active) return;
    if (active.docs.length === 1) return remove(active.id);
    const doc = active.docs.find(d => d.index === index);
    const choice = await askConfirm({
      title: `Hapus lampiran "${doc?.name || 'PDF'}"?`,
      message: 'PDF lampiran dipindahkan ke Sampah. Verifikasi episode perlu ditinjau ulang karena lampiran berubah.'
        + (dirty ? '\nPerubahan yang belum disimpan akan dibuang.' : ''),
      primaryLabel: 'Pindahkan ke Sampah',
      cancelLabel: 'Batal',
      tone: 'danger',
    });
    if (choice !== 'primary') return;
    setManaging(true);
    try {
      await api('/episodes/' + active.id + '/documents/' + index, { method: 'DELETE' });
      setActive(await api('/episodes/' + active.id));
      setDirty(false);
      await reload();
      notify('Lampiran PDF dipindahkan ke Sampah. Tinjau kembali episode ini.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setManaging(false);
    }
  };

  const restore = async ({ id, document: attachment }) => {
    if (attachment !== undefined) {
      const choice = await askConfirm({
        title: 'Pulihkan lampiran PDF?',
        message: 'Verifikasi episode terkait perlu diulang karena lampirannya berubah.'
          + (active?.id === id && dirty ? '\nPerubahan yang belum disimpan akan dibuang.' : ''),
        primaryLabel: 'Pulihkan',
        cancelLabel: 'Batal',
      });
      if (choice !== 'primary') return;
    }
    setManaging(true);
    setTrashError('');
    try {
      await api('/trash/' + id + (attachment === undefined ? '' : '/documents/' + attachment) + '/restore', { method: 'POST' });
      if (attachment !== undefined && active?.id === id) {
        setActive(await api('/episodes/' + id));
        setDirty(false);
      }
      await reload();
      notify('Berkas dipulihkan ke daftar kerja.');
    } catch (error) {
      setTrashError(error.message);
    } finally {
      setManaging(false);
    }
  };

  const purgeTrashItem = async ({ id, document: attachment, title, name }) => {
    const label = name ? `${name} (${title})` : title;
    const choice = await askConfirm({
      title: 'Hapus permanen dari Sampah?',
      message: `Berkas "${label}" dan PDF sumbernya akan dihapus permanen dari penyimpanan lokal.`,
      primaryLabel: 'Hapus Permanen',
      cancelLabel: 'Batal',
      tone: 'danger',
    });
    if (choice !== 'primary') return;
    setManaging(true);
    setTrashError('');
    try {
      const endpoint = '/trash/' + id + (attachment === undefined ? '' : '/documents/' + attachment);
      await api(endpoint, { method: 'DELETE' });
      await reload();
      notify('Berkas dihapus permanen.');
    } catch (error) {
      setTrashError(error.message);
    } finally {
      setManaging(false);
    }
  };

  const emptyTrash = async () => {
    if (!trash.length) return;
    const choice = await askConfirm({
      title: 'Kosongkan seluruh Sampah?',
      message: `${trash.length} item di Sampah beserta berkas PDF di penyimpanan lokal akan dihapus permanen dan tidak dapat dipulihkan.`,
      primaryLabel: 'Kosongkan Sampah',
      cancelLabel: 'Batal',
      tone: 'danger',
    });
    if (choice !== 'primary') return;
    setManaging(true);
    setTrashError('');
    try {
      const { count } = await api('/trash', { method: 'DELETE' });
      await reload();
      notify(`${count} item di Sampah dihapus permanen.`);
    } catch (error) {
      setTrashError(error.message);
    } finally {
      setManaging(false);
    }
  };

  const handleFilePick = filesList => {
    const arr = Array.from(filesList || []).filter(file => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
    setSelectedFiles(arr);
    setImportError('');
  };

  const handleDrop = event => {
    event.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const dropped = Array.from(event.dataTransfer?.files || []).filter(file => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
    if (!dropped.length) {
      setImportError('Pilih berkas dengan format PDF (.pdf).');
      return;
    }
    if (fileInputRef.current && typeof DataTransfer !== 'undefined') {
      const dt = new DataTransfer();
      for (const file of dropped) dt.items.add(file);
      fileInputRef.current.files = dt.files;
    }
    setSelectedFiles(dropped);
    setImportError('');
  };

  const submitImport = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const files = Array.from(form.elements.pdf.files || []);
    if (!files.length) return;
    setUploading(true);
    setImportError('');
    try {
      if (importMode === 'batch') {
        const createdIds = [];
        const failures = [];
        setBatchProgress({ done: 0, total: files.length });
        for (const [index, file] of files.entries()) {
          setImportProgress(`Membaca & OCR berkas ${index + 1} dari ${files.length}: ${file.name}…`);
          const payload = new FormData();
          payload.append('scope', 'episode');
          payload.append('pdf', file);
          try {
            const result = await api('/episodes', { method: 'POST', body: payload });
            createdIds.push(result.id);
          } catch (error) {
            failures.push(`${file.name}: ${error.message}`);
          }
          setBatchProgress({ done: index + 1, total: files.length });
        }
        await reload();
        if (!createdIds.length) {
          setImportError(failures.join(' | '));
          return;
        }
        form.reset();
        setSelectedFiles([]);
        importDialogRef.current?.close();
        await open(createdIds[0], true);
        if (failures.length) {
          notify(`${createdIds.length} episode diimpor; ${failures.length} gagal (${failures[0]}).`, true);
        } else {
          notify(`${createdIds.length} episode berhasil diimpor.`);
        }
      } else {
        if (files.length > 12) {
          setImportError('Maksimal 12 PDF untuk satu episode atau paket. Gunakan mode Banyak episode sekaligus untuk berkas terpisah.');
          return;
        }
        setBatchProgress(null);
        setImportProgress('Sedang membaca halaman PDF & mengekstrak teks klinis…');
        const result = await api('/episodes', { method: 'POST', body: new FormData(form) });
        form.reset();
        setSelectedFiles([]);
        importDialogRef.current?.close();
        await reload();
        await open(result.id, true);
      }
    } catch (error) {
      notify(error.message, true);
      setImportError(error.message);
    } finally {
      setImportProgress('');
      setBatchProgress(null);
      setUploading(false);
    }
  };

  const episodes = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter(row => {
      const matchesQuery = !term || [row.title, row.meta.facility, row.meta.claimNumber].some(value => value?.toLowerCase().includes(term));
      if (!matchesQuery) return false;
      if (workFilter === 'all') return true;
      return getRowBucket(row) === workFilter;
    });
  }, [rows, query, workFilter]);

  const claims = useMemo(() => rows.filter(row => row.scope === 'episode'), [rows]);
  const decidedCount = useMemo(() => claims.filter(row => Boolean(row.decision?.status)).length, [claims]);

  const handleQueueKeyDown = (event, index) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const nextIdx = event.key === 'ArrowDown' ? Math.min(episodes.length - 1, index + 1) : Math.max(0, index - 1);
    const nextRow = episodes[nextIdx];
    if (!nextRow) return;
    const container = event.currentTarget.closest('.worklist-items');
    const buttons = container?.querySelectorAll('.queue-item-btn');
    buttons?.[nextIdx]?.focus();
    if (nextRow.id !== active?.id && !busy) void open(nextRow.id);
  };

  return (
    <>
      <a href="#main-content" className="skip-link visually-hidden">Lewati ke konten utama</a>

      <header className="mast">
        <div className="brand">
          <span className="monogram" aria-hidden="true"><IconShield /></span>
          <div>
            <strong>Si Jantan</strong>
            <span>JPKM JAWA BARAT</span>
          </div>
        </div>

        <nav aria-label="Navigasi utama">
          {screens.map(([id, label]) => {
            const count = id === 'desk' ? rows.length : id === 'recap' ? decidedCount : null;
            return (
              <button
                key={id}
                type="button"
                aria-current={screen === id ? 'page' : undefined}
                onClick={() => void navigate(id)}
              >
                <span>{label}</span>
                {count !== null && <span className="nav-pill tabular">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="mast-actions">
          <span className="connection"><i aria-hidden="true" /><span>Lokal</span></span>
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            <span className="theme-branch theme-to-dark">
              <IconMoon />
              <span className="theme-label">Gelap</span>
            </span>
            <span className="theme-branch theme-to-light">
              <IconSun />
              <span className="theme-label">Terang</span>
            </span>
          </button>
          {screen === 'desk' && (
            <button type="button" className="primary mast-import-btn" onClick={() => void openImport('episode')}>
              <IconUpload />
              <span>Impor PDF</span>
            </button>
          )}
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {(!active || screen !== 'desk') && (
          <div className="introduce">
            <div>
              <p className="eyebrow">WORKSTATION VERIFIKASI KLAIM · JPKM JAWA BARAT</p>
              <h1>{screens.find(([id]) => id === screen)?.[1]}</h1>
            </div>
            {screen === 'desk' && sidebarCollapsed && (
              <button type="button" className="small" onClick={() => setSidebarCollapsed(false)}>
                <IconPanelLeft />
                <span>Tampilkan antrean ({rows.length})</span>
              </button>
            )}
          </div>
        )}

        {active && screen === 'desk' && <h1 className="visually-hidden">Verifikasi Klaim — {active.title}</h1>}

        {toast && (
          <div className={'toast ' + (toast.error ? 'danger' : '')} role={toast.error ? 'alert' : 'status'}>
            <span>{toast.text}</span>
            <button type="button" aria-label="Tutup pemberitahuan" onClick={() => setToast(null)}>
              <IconX />
            </button>
          </div>
        )}

        {screen === 'desk' && (
          <div className={'desk' + (sidebarCollapsed ? ' desk-collapsed' : '')}>
            {!sidebarCollapsed && (
              <aside className="surface worklist" aria-label="Antrean episode klaim">
                <div className="section-head">
                  <h2>Antrean klaim</h2>
                  <span className="count-pill tabular">{rows.length}</span>
                </div>

                <search className="worklist-search">
                  <label htmlFor={searchInputId} className="visually-hidden">Cari episode, rumah sakit, atau nomor SEP</label>
                  <div className="search-input-wrap">
                    <IconSearch className="search-icon" />
                    <input
                      id={searchInputId}
                      placeholder="Cari episode, RS, SEP…"
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                    />
                    {query && (
                      <button
                        type="button"
                        className="search-clear"
                        aria-label="Hapus pencarian"
                        onClick={() => setQuery('')}
                      >
                        <IconX />
                      </button>
                    )}
                  </div>
                </search>

                <div className="worklist-filters" role="group" aria-label="Filter status antrean">
                  {worklistFilters.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={workFilter === key ? 'pill-btn is-active' : 'pill-btn'}
                      onClick={() => setWorkFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="worklist-items">
                  {episodes.map((row, index) => {
                    const isSelected = active?.id === row.id;
                    const metaLine = [row.meta.facility, row.meta.serviceDate ? formatDate(row.meta.serviceDate) : ''].filter(Boolean).join(' · ');
                    const isPackageDone = row.scope === 'package' && row.approved?.includes('admin');
                    const statusLabel = outcomes[row.decision?.status]
                      || (isPackageDone ? 'Selesai' : row.scope === 'package' ? 'Paket' : (row.approved?.length || row.revision > 0 ? 'Draf tersimpan' : 'Belum ditinjau'));
                    const statusClass = row.decision?.status || (isPackageDone ? 'layak' : (row.approved?.length || row.revision > 0 ? 'proses' : 'baru'));
                    return (
                      <div key={row.id} className={'queue-card' + (isSelected ? ' selected' : '')}>
                        <button
                          type="button"
                          className="queue-item-btn"
                          disabled={busy}
                          onKeyDown={event => handleQueueKeyDown(event, index)}
                          onClick={() => row.id !== active?.id && void open(row.id)}
                        >
                          <strong className="queue-title">{row.title}</strong>
                          {metaLine && <span className="queue-meta tabular">{metaLine}</span>}
                          <span className="queue-foot">
                            <span className={'queue-status status-' + statusClass}>
                              {row.decision?.status === 'layak' || isPackageDone ? <IconCheck /> : <IconClock />}
                              <span>{statusLabel}</span>
                            </span>
                            {Number.isInteger(row.meta.amount) && <span className="queue-amount tabular">{rupiah(row.meta.amount)}</span>}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="queue-delete-btn"
                          disabled={busy}
                          aria-label={'Hapus ' + row.title}
                          title={'Hapus ' + row.title}
                          onClick={() => void remove(row.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    );
                  })}
                  {!episodes.length && (
                    <p className="muted empty-queue">
                      {rows.length ? 'Tidak ada episode yang cocok dengan filter.' : 'Antrean kosong. Impor berkas PDF untuk memulai.'}
                    </p>
                  )}
                </div>

                <div className="worklist-footer">
                  <button type="button" className="small" disabled={busy} onClick={() => void showTrash()}>
                    <IconTrash />
                    <span>Sampah ({trash.length})</span>
                  </button>
                  <button type="button" className="small file-remove" disabled={busy || !rows.length} onClick={() => void remove()}>
                    Bersihkan semua
                  </button>
                </div>
              </aside>
            )}

            {active ? (
              <ReviewDesk
                key={active.id + '/' + active.docs.map(doc => doc.index).join(',')}
                episode={active}
                edit={edit}
                save={save}
                notify={notify}
                saving={saving}
                managing={managing}
                removeDocument={removeDocument}
                onDeleteEpisode={remove}
                askConfirm={askConfirm}
                markDirty={() => setDirty(true)}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed(current => !current)}
              />
            ) : (
              <section className="surface empty-workspace">
                <div className="empty-badge">
                  <IconFileText />
                </div>
                <h2>{loading ? 'Memuat episode klaim…' : 'Siap melakukan verifikasi klaim'}</h2>
                <p className="empty-lead">
                  Pilih episode dari antrean di sebelah kiri, atau impor berkas klaim PDF baru untuk menjalankan skrining aturan INA-CBG, coding, dan kriteria medis otomatis.
                </p>

                <div className="quick-import-grid">
                  <button type="button" className="quick-mode-card" onClick={() => void openImport('episode')}>
                    <IconUpload />
                    <strong>Satu Episode Pasien</strong>
                    <small>Gabungkan 1–12 berkas PDF milik pasien yang sama.</small>
                  </button>
                  <button type="button" className="quick-mode-card" onClick={() => void openImport('batch')}>
                    <IconLayers />
                    <strong>Banyak Episode (Batch)</strong>
                    <small>Impor banyak file PDF sekaligus menjadi episode terpisah.</small>
                  </button>
                  <button type="button" className="quick-mode-card" onClick={() => void openImport('package')}>
                    <IconFolder />
                    <strong>Paket Pengajuan RS</strong>
                    <small>Periksa SPTJM, surat pengajuan, dan rekap tagihan RS.</small>
                  </button>
                </div>

                <ol className="workflow-steps">
                  <li><strong>1. Impor PDF</strong><span>Unggah berkas satuan atau massal untuk ekstraksi klinis otomatis</span></li>
                  <li><strong>2. Cek Perhatian</strong><span>Indikator bersih terisi otomatis; cukup periksa temuan yang ditandai</span></li>
                  <li><strong>3. Putuskan &amp; Cetak</strong><span>Simpan keputusan langsung, unduh rekap CSV, atau buat Berita Acara</span></li>
                </ol>
              </section>
            )}
          </div>
        )}

        {screen === 'recap' && (
          <Recap
            rows={claims}
            onOpen={open}
            onMinutes={selection => {
              setChosen(selection);
              setScreen('minutes');
              setToast(null);
            }}
          />
        )}

        {screen === 'minutes' && (
          <Minutes rows={claims} chosen={chosen} onRecap={() => void navigate('recap')} notify={notify} />
        )}
      </main>

      <dialog
        id="trash"
        ref={trashDialogRef}
        closedby="any"
        aria-labelledby="trash-title"
        onClose={() => setTrashOpen(false)}
      >
        <div className="dialog-head">
          <div>
            <h2 id="trash-title">Sampah</h2>
            <p className="muted">Pulihkan berkas ke antrean atau hapus permanen dari penyimpanan lokal.</p>
          </div>
        </div>
        {trashError && <p className="error-text" role="alert">{trashError}</p>}
        {managing && <p className="muted" role="status">Memproses berkas…</p>}
        {!managing && !trashError && !trash.length && <p className="muted empty-trash">Sampah kosong.</p>}
        <ul className="trash-list">
          {trash.map(row => {
            const label = row.name ? `${row.name} · ${row.title}` : row.title;
            return (
              <li key={row.id + '/' + (row.document ?? 'ep')}>
                <span className="trash-name">{label}</span>
                <div className="trash-row-actions">
                  <button
                    type="button"
                    className="small"
                    disabled={managing}
                    aria-label={'Pulihkan ' + label}
                    onClick={() => void restore(row)}
                  >
                    <IconRestore />
                    <span>Pulihkan</span>
                  </button>
                  <button
                    type="button"
                    className="small file-remove"
                    disabled={managing}
                    aria-label={'Hapus permanen ' + label}
                    onClick={() => void purgeTrashItem(row)}
                  >
                    <IconTrash />
                    <span>Hapus permanen</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="actions between dialog-foot">
          <button
            type="button"
            className="danger-btn"
            disabled={managing || !trash.length}
            onClick={() => void emptyTrash()}
          >
            <IconTrash />
            <span>Kosongkan Sampah</span>
          </button>
          <button type="button" onClick={() => trashDialogRef.current?.close()}>Tutup</button>
        </div>
      </dialog>

      <dialog
        id="import"
        ref={importDialogRef}
        closedby={uploading ? 'none' : 'any'}
        aria-labelledby="import-title"
        onClose={() => setImportOpen(false)}
        onCancel={event => { if (uploading) event.preventDefault(); }}
      >
        <form onSubmit={submitImport}>
          <h2 id="import-title">Impor berkas klaim PDF</h2>
          <input type="hidden" name="scope" value={importMode === 'package' ? 'package' : 'episode'} />

          <fieldset className="radio-group">
            <legend>Mode impor</legend>
            {importModes.map(([value, title, desc]) => (
              <label key={value} className="radio-option">
                <input
                  type="radio"
                  name="importMode"
                  value={value}
                  checked={importMode === value}
                  disabled={uploading}
                  onChange={() => { setImportMode(value); setImportError(''); }}
                />
                <span>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {importMode !== 'batch' && (
            <div className="field dialog-field">
              <label htmlFor={titleInputId}>Nama episode atau pengajuan (opsional)</label>
              <input
                id={titleInputId}
                name="title"
                maxLength={160}
                placeholder="Kosongkan untuk memakai nama berkas PDF"
              />
            </div>
          )}

          <div
            className={'dropzone' + (dragOver ? ' is-dragover' : '')}
            onDragOver={event => { event.preventDefault(); if (!uploading) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <label htmlFor={fileInputId} className="dropzone-label">
              <IconUpload />
              <span>Pilih atau seret berkas PDF ke sini</span>
              <small>
                {importMode === 'batch'
                  ? 'Bisa memilih banyak file PDF sekaligus; tiap file menjadi 1 episode.'
                  : 'Maksimal 12 PDF & total 150 halaman per episode.'}
              </small>
            </label>
            <input
              id={fileInputId}
              ref={fileInputRef}
              name="pdf"
              type="file"
              accept=".pdf,application/pdf"
              multiple
              required
              autoFocus
              disabled={uploading}
              onChange={event => handleFilePick(event.target.files)}
            />
          </div>

          {!!selectedFiles.length && (
            <ul className="selected-files">
              {selectedFiles.map((file, idx) => (
                <li key={file.name + '-' + idx}>
                  <span>{file.name}</span>
                  <small className="tabular">{(file.size / 1048576).toFixed(2)} MB</small>
                </li>
              ))}
            </ul>
          )}

          {importError && <p className="error-text" role="alert">{importError}</p>}

          {uploading && (
            <div className="import-status" role="status">
              <progress value={batchProgress ? batchProgress.done : undefined} max={batchProgress ? batchProgress.total : undefined} />
              <p className="muted">{importProgress || 'Sedang membaca halaman PDF…'}</p>
            </div>
          )}

          <div className="actions end dialog-foot">
            <button disabled={uploading} type="button" onClick={() => importDialogRef.current?.close()}>Tutup</button>
            <button className="primary" disabled={uploading} type="submit">Impor dan baca</button>
          </div>
        </form>
      </dialog>

      <ConfirmDialog request={confirmState} onResolve={resolveConfirm} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
