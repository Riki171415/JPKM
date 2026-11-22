import { useEffect, useId, useMemo, useState } from 'react';
import { api, json, exportRecap, formatDate, outcomes, rupiah, today, totalOf } from './data.js';
import { Badge } from './review.jsx';
import {
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconFileText,
  IconLayers,
  IconPrinter,
  IconScale,
  IconXCircle,
} from './icons.jsx';

const filterRows = (rows, { status, query, start, end }) => {
  const term = query.trim().toLowerCase();
  return rows.filter(row => {
    const date = row.meta.serviceDate || '';
    const result = row.decision?.status || 'unreviewed';
    return (!status || status === result)
      && (!start || date >= start)
      && (!end || (date && date <= end))
      && (!term || [row.title, row.meta.facility, row.meta.claimNumber].some(value => value?.toLowerCase().includes(term)));
  });
};

function TileIcon({ id }) {
  if (id === 'layak') return <IconCheckCircle />;
  if (id === 'pending') return <IconClock />;
  if (id === 'dispute') return <IconScale />;
  if (id === 'tidak-layak') return <IconXCircle />;
  return <IconLayers />;
}

function StatusTiles({ rows, active, choose }) {
  return (
    <div className="status-grid">
      <button
        type="button"
        className={'surface status-tile tile-total' + (active === '' ? ' current' : '')}
        onClick={() => choose('')}
      >
        <div className="tile-head">
          <span>Total episode</span>
          <TileIcon id="total" />
        </div>
        <strong className="tabular">{rows.length}</strong>
        <small className="tabular">{rupiah(totalOf(rows))}</small>
      </button>
      {Object.entries(outcomes).map(([id, label]) => {
        const matching = rows.filter(row => row.decision?.status === id);
        return (
          <button
            type="button"
            key={id}
            className={'surface status-tile tile-' + id + (active === id ? ' current' : '')}
            onClick={() => choose(active === id ? '' : id)}
          >
            <div className="tile-head">
              <span>{label}</span>
              <TileIcon id={id} />
            </div>
            <strong className="tabular">{matching.length}</strong>
            <small className="tabular">{rupiah(totalOf(matching))}</small>
          </button>
        );
      })}
    </div>
  );
}

export function Recap({ rows, onOpen, onMinutes }) {
  const [filters, setFilters] = useState({ status: '', query: '', start: '', end: '' });
  const qId = useId();
  const sId = useId();
  const startId = useId();
  const endId = useId();
  const field = (id, value) => setFilters(current => ({ ...current, [id]: value }));
  const hasFilters = Boolean(filters.status || filters.query.trim() || filters.start || filters.end);
  const base = filterRows(rows, { ...filters, status: '' });
  const visible = filterRows(base, { ...filters, query: '', start: '', end: '' });
  const selected = visible.filter(row => row.decision);

  return (
    <section className="report-layout">
      <StatusTiles rows={base} active={filters.status} choose={status => field('status', status)} />
      <section className="surface table-panel">
        <div className="section-head">
          <div>
            <h2 id="recap-table-title">Daftar hasil verifikasi</h2>
            <p className="muted tabular">{visible.length} episode · {selected.length} sudah diputuskan</p>
          </div>
          <div className="actions">
            {hasFilters && (
              <button type="button" className="small" onClick={() => setFilters({ status: '', query: '', start: '', end: '' })}>
                Reset filter
              </button>
            )}
            <button type="button" disabled={!visible.length} onClick={() => exportRecap(visible)}>
              <IconDownload />
              <span>Unduh CSV</span>
            </button>
            <button type="button" className="primary" disabled={!selected.length} onClick={() => onMinutes(selected.map(row => row.id))}>
              <IconFileText />
              <span>Buat berita acara</span>
            </button>
          </div>
        </div>

        <search className="filters">
          <div className="field">
            <label htmlFor={qId}>Cari nomor klaim, episode, atau RS</label>
            <input id={qId} value={filters.query} onChange={event => field('query', event.target.value)} placeholder="Cari dalam rekap" />
          </div>
          <div className="field">
            <label htmlFor={sId}>Status</label>
            <select id={sId} value={filters.status} onChange={event => field('status', event.target.value)}>
              <option value="">Semua status</option>
              {Object.entries(outcomes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              <option value="unreviewed">Belum diputuskan</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={startId}>Pelayanan mulai</label>
            <input id={startId} type="date" value={filters.start} max={filters.end || undefined} onChange={event => field('start', event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={endId}>Pelayanan sampai</label>
            <input id={endId} type="date" value={filters.end} min={filters.start || undefined} onChange={event => field('end', event.target.value)} />
          </div>
        </search>

        <div tabIndex={0} role="region" aria-labelledby="recap-table-title" className="table-scroll">
          <table className="recap-table">
            <caption className="visually-hidden">Daftar hasil verifikasi klaim JPKM Jawa Barat</caption>
            <thead>
              <tr>
                <th scope="col">Nomor / episode</th>
                <th scope="col">Rumah sakit</th>
                <th scope="col">Tanggal layanan</th>
                <th scope="col" className="numeric">Nilai pengajuan</th>
                <th scope="col">Hasil</th>
                <th scope="col">Dasar / tindak lanjut</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.id}>
                  <th scope="row">
                    <button type="button" className="text-button" onClick={() => onOpen(row.id)}>
                      {row.meta.claimNumber || row.title}
                    </button>
                    {row.meta.claimNumber && <small>{row.title}</small>}
                  </th>
                  <td>{row.meta.facility || '—'}</td>
                  <td className="tabular">{formatDate(row.meta.serviceDate)}</td>
                  <td className="numeric tabular">{rupiah(row.meta.amount)}</td>
                  <td>
                    <Badge status={row.decision?.status} />
                    {row.decision?.date && <small className="tabular">{formatDate(row.decision.date)}</small>}
                  </td>
                  <td className="break">{row.decision?.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <div className="empty-table">Belum ada episode sesuai filter yang dipilih.</div>}
        </div>
      </section>
    </section>
  );
}

function PrintMinutes({ report }) {
  return (
    <article className="minutes-paper surface">
      <p className="print-tag">DOKUMEN VERIFIKASI LOKAL</p>
      <div className="minutes-title">
        <p>{report.issuer}</p>
        <h2>Berita Acara Hasil Verifikasi Klaim</h2>
        <p>JPKM Provinsi Jawa Barat · Si Jantan</p>
        <p className="tabular">Nomor {report.number}</p>
      </div>
      <p>
        Pada tanggal {formatDate(report.date)} di {report.location}, hasil verifikasi klaim untuk periode pelayanan{' '}
        {formatDate(report.start)} sampai {formatDate(report.end)} dicatat sebagai berikut.
      </p>
      <table className="minutes-summary">
        <thead>
          <tr>
            <th scope="col">Hasil verifikasi</th>
            <th scope="col" className="numeric">Episode</th>
            <th scope="col" className="numeric">Nilai pengajuan tercatat</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(outcomes).map(([id, label]) => {
            const items = report.rows.filter(row => row.decision.status === id);
            return (
              <tr key={id}>
                <td>{label}</td>
                <td className="numeric tabular">{items.length}</td>
                <td className="numeric tabular">{rupiah(totalOf(items))}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <th className="numeric tabular">{report.rows.length}</th>
            <th className="numeric tabular">{rupiah(totalOf(report.rows))}</th>
          </tr>
        </tfoot>
      </table>
      <h3>Rincian hasil per episode</h3>
      <table className="minutes-detail">
        <thead>
          <tr>
            <th scope="col">No.</th>
            <th scope="col">Nomor klaim / RS</th>
            <th scope="col">Tanggal pelayanan</th>
            <th scope="col">Hasil</th>
            <th scope="col">Dasar / tindak lanjut</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => (
            <tr key={row.id}>
              <td className="tabular">{index + 1}</td>
              <td>{row.meta.claimNumber || row.title}<small>{row.meta.facility || '—'}</small></td>
              <td className="tabular">{formatDate(row.meta.serviceDate)}</td>
              <td>{outcomes[row.decision.status]}</td>
              <td className="break">{row.decision.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="minutes-note">
        Nilai pengajuan diringkas dari nominal yang sudah diisi pada rekap. Perubahan keputusan setelah berita acara disimpan dicatat pada rekap aktif.
      </p>
      <div className="signatures">
        <div><p>Verifikator</p><strong>{report.verifier}</strong></div>
        <div><p>Perwakilan rumah sakit</p><strong>{report.representative}</strong></div>
      </div>
    </article>
  );
}

function MinutesInput({ idKey, label, form, setForm, params = {} }) {
  const inputId = useId();
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        value={form[idKey]}
        required
        maxLength={idKey === 'issuer' ? 180 : idKey === 'number' ? 100 : 120}
        onChange={event => setForm(current => ({ ...current, [idKey]: event.target.value }))}
        {...params}
      />
    </div>
  );
}

export function Minutes({ rows, chosen, onRecap, notify }) {
  const dated = useMemo(() => rows.filter(row => row.decision && row.meta.serviceDate), [rows]);
  const [ids, setIds] = useState(() => new Set(chosen.length ? chosen : []));
  const selected = dated.filter(row => ids.has(row.id));
  const dates = selected.map(row => row.meta.serviceDate).sort();
  const [form, setForm] = useState({
    number: '', issuer: '', location: '', date: today(),
    start: dates[0] || '', end: dates.at(-1) || '',
    verifier: '', representative: '',
  });
  const [archive, setArchive] = useState([]);
  const [report, setReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const archiveSelectId = useId();

  const refresh = async () => setArchive(await api('/minutes'));
  useEffect(() => { refresh().catch(error => notify(error.message, true)); }, []);

  const view = async id => {
    try { setReport(await api('/minutes/' + id)); }
    catch (error) { notify(error.message, true); }
  };

  const save = async event => {
    event.preventDefault();
    if (!selected.length) return notify('Pilih sekurangnya satu episode yang sudah ditetapkan dan memiliki tanggal pelayanan.', true);
    setSaving(true);
    try {
      const saved = await api('/minutes', json('POST', { ...form, episodes: selected.map(row => ({ id: row.id, revision: row.revision })) }));
      setReport(saved);
      await refresh();
      notify('Berita acara disimpan dan siap dicetak.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="minutes-layout">
      <aside className="surface minutes-controls">
        <div className="section-head">
          <h2>Arsip berita acara</h2>
          <span className="count-pill tabular">{archive.length}</span>
        </div>
        <div className="field">
          <label htmlFor={archiveSelectId}>Pilih dokumen berita acara</label>
          <select id={archiveSelectId} value={report?.id || ''} onChange={event => event.target.value ? void view(event.target.value) : setReport(null)}>
            <option value="">Buat berita acara baru</option>
            {archive.map(item => <option key={item.id} value={item.id}>{item.number} · {formatDate(item.date)}</option>)}
          </select>
        </div>
        {report && (
          <div className="minutes-sidebar-actions">
            <button type="button" className="primary" onClick={() => window.print()}>
              <IconPrinter />
              <span>Cetak / Simpan PDF</span>
            </button>
            <button type="button" onClick={() => setReport(null)}>Buat berita acara baru</button>
          </div>
        )}
      </aside>

      {report ? (
        <PrintMinutes report={report} />
      ) : (
        <form className="surface table-panel minutes-form" onSubmit={save}>
          <div className="section-head">
            <div>
              <h2>Susun berita acara</h2>
              <p className="muted">Isi identitas dokumen, lalu pilih episode yang akan dimuat.</p>
            </div>
            <button type="button" onClick={onRecap}>Lihat rekap</button>
          </div>
          <div className="fields form-grid">
            <MinutesInput idKey="number" label="Nomor berita acara" form={form} setForm={setForm} />
            <MinutesInput idKey="issuer" label="Unit atau instansi penerbit" form={form} setForm={setForm} />
            <MinutesInput idKey="location" label="Tempat" form={form} setForm={setForm} />
            <MinutesInput idKey="date" label="Tanggal berita acara" form={form} setForm={setForm} params={{ type: 'date' }} />
            <MinutesInput idKey="start" label="Periode layanan mulai" form={form} setForm={setForm} params={{ type: 'date', max: form.end || undefined }} />
            <MinutesInput idKey="end" label="Periode layanan sampai" form={form} setForm={setForm} params={{ type: 'date', min: form.start || undefined }} />
            <MinutesInput idKey="verifier" label="Nama verifikator" form={form} setForm={setForm} />
            <MinutesInput idKey="representative" label="Nama perwakilan rumah sakit" form={form} setForm={setForm} />
          </div>
          <div className="selection-head">
            <h3>Episode yang dimuat</h3>
            <span className="tabular">{selected.length} dipilih</span>
          </div>
          <div className="selection-list">
            {dated.map(row => (
              <label className="checkbox pick" key={row.id}>
                <input
                  type="checkbox"
                  checked={ids.has(row.id)}
                  onChange={event => {
                    const checked = event.target.checked;
                    setIds(previous => {
                      const next = new Set(previous);
                      if (checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    });
                  }}
                />
                <span>
                  <strong>{row.meta.claimNumber || row.title}</strong>
                  <small>{row.meta.facility || '—'} · {formatDate(row.meta.serviceDate)}</small>
                </span>
                <Badge status={row.decision.status} />
              </label>
            ))}
            {!dated.length && <p className="muted">Belum ada episode dengan keputusan dan tanggal pelayanan tersimpan.</p>}
          </div>
          <div className="panel-action-bar">
            <button className="primary" type="submit" disabled={saving || !selected.length}>Simpan berita acara</button>
          </div>
        </form>
      )}
    </section>
  );
}
