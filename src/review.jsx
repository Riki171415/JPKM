import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  categories, decisions, inspect, adminRows, codingRows, medicalRows,
  medicalRuleIdOf, procedureReferencesFor, parseDiagnosisCodes, parseProcedureCodes, resolveIcdDescription,
} from '../static/rules.js';
import { useIcdDictionary } from './icd.js';
import { claimMeta } from '../static/claimInfo.js';
import { formatDate, outcomes, resolvePagePreviewUrl, rupiah, today } from './data.js';
import { needsReason, flagReviews } from './review-validation.js';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconCheck,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFileText,
  IconInfo,
  IconPanelLeft,
  IconRotateCw,
  IconScale,
  IconTrash,
  IconX,
  IconXCircle,
  IconZoomIn,
  IconZoomOut,
} from './icons.jsx';

const optional = new Set(['jpkm', 'procedure', 'identity', 'intervention', 'frequency']);
const codes = ['primary', 'secondary', 'procedures', 'age'];
const labelTone = {
  'Sesuai': 'layak',
  'Tidak sesuai': 'tidak-layak',
  'Tidak berlaku': 'neutral',
  'Perlu klarifikasi': 'pending',
};
const verdictMeta = {
  'Sesuai': { tone: 'layak', Icon: IconCheck },
  'Perlu klarifikasi': { tone: 'pending', Icon: IconClock },
  'Tidak sesuai': { tone: 'tidak-layak', Icon: IconX },
  'Tidak berlaku': { tone: 'neutral', Icon: IconInfo },
};
const decisionChoices = [
  ['layak', 'Layak Klaim', IconCheckCircle],
  ['pending', 'Pending Klaim', IconClock],
  ['dispute', 'Dispute', IconScale],
  ['tidak-layak', 'Tidak Layak', IconXCircle],
];

const cleanNonEmpty = obj => Object.fromEntries(Object.entries(obj || {}).filter(([, value]) => value !== '' && value != null));

function BadgeIcon({ status }) {
  if (status === 'layak') return <IconCheckCircle className="badge-icon" />;
  if (status === 'pending') return <IconClock className="badge-icon" />;
  if (status === 'dispute') return <IconScale className="badge-icon" />;
  if (status === 'tidak-layak') return <IconXCircle className="badge-icon" />;
  return <IconInfo className="badge-icon" />;
}

export function Badge({ status, children }) {
  const tone = status || 'neutral';
  return (
    <span className={'badge tone-' + tone}>
      <BadgeIcon status={tone} />
      <span>{children || outcomes[status] || 'Belum diputuskan'}</span>
    </span>
  );
}

function Field({ label, hint, className = '', ...props }) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={className ? 'field ' + className : 'field'}>
      <label htmlFor={id}>{label}</label>
      {hint && <span id={hintId} className="field-hint">{hint}</span>}
      <input id={id} aria-describedby={hint ? hintId : undefined} {...props} />
    </div>
  );
}

function SelectField({ label, className = '', children, ...props }) {
  const id = useId();
  return (
    <div className={className ? 'field ' + className : 'field'}>
      <label htmlFor={id}>{label}</label>
      <select id={id} {...props}>{children}</select>
    </div>
  );
}

function ClaimSummary({ info, show, primary = '', secondary = [], procedures = [], describeIcd = () => '' }) {
  const claim = info.claim;
  if (!claim) return null;
  const bill = info.billingTotal;
  const classMismatch = claim.kelasRS && claim.kelasTarif && claim.kelasRS !== claim.kelasTarif;
  const dates = [
    claim.tglMasuk ? formatDate(claim.tglMasuk) + (claim.tglKeluar && claim.tglKeluar !== claim.tglMasuk ? ' – ' + formatDate(claim.tglKeluar) : '') : '',
    claim.los != null ? claim.los + ' hari' : '',
  ].filter(Boolean).join(' · ');

  return (
    <section className="claim-strip" aria-label="Ringkasan data klinis dan klaim">
      <dl>
        <div>
          <dt>Pasien</dt>
          <dd className="claim-primary-val">{info.patientName || '—'}</dd>
          <dd className="claim-sub-val">{[claim.umurTahun != null ? claim.umurTahun + ' th' : '', claim.jenisKelamin, claim.caraPulang].filter(Boolean).join(' · ') || '—'}</dd>
        </div>
        <div>
          <dt>Fasilitas Kesehatan</dt>
          <dd className="claim-primary-val">{claim.namaRS || '—'}</dd>
          <dd className="claim-sub-val">
            {claim.kelasRS ? <span className="pill-meta">Kelas RS {claim.kelasRS}</span> : null}
            {claim.kelasTarif ? (
              <span className={classMismatch ? 'pill-meta pill-warn' : 'pill-meta'}>
                Tarif Kelas {claim.kelasTarif}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>No. RM &amp; SEP</dt>
          <dd className="mono-stack">
            {claim.noRM && <span className="code-chip">RM {claim.noRM}</span>}
            {claim.nomorSEP && <span className="code-chip">{claim.nomorSEP}</span>}
            {!claim.noRM && !claim.nomorSEP && '—'}
          </dd>
        </div>
        <div>
          <dt>Layanan &amp; Rawat</dt>
          <dd className="claim-primary-val">{claim.jenisPerawatan || info.service || '—'}</dd>
          <dd className="claim-sub-val tabular">{dates || '—'}</dd>
        </div>
        <div>
          <dt>Grouping INA-CBG</dt>
          <dd className="claim-cbg-wrap">
            {claim.cbg ? <span className="code-chip code-accent">{claim.cbg}</span> : <span>—</span>}
            {claim.cbgDescription && <span className="claim-sub-val">{claim.cbgDescription}</span>}
          </dd>
        </div>
        <div className="claim-finance">
          <dt>Perbandingan Finansial</dt>
          <dd className="finance-pair">
            <span><small>Tarif INA-CBG</small> <strong className="tabular">{rupiah(claim.tarif)}</strong></span>
            {bill && (
              <span>
                <small>Tagihan RS</small>{' '}
                <button type="button" className="text-button inline-link tabular" onClick={() => show(bill.file, bill.number)}>
                  {rupiah(bill.amount)} (hlm. {bill.number})
                </button>
              </span>
            )}
          </dd>
        </div>
        <div className="claim-jump">
          <button type="button" className="small secondary-btn" onClick={() => show(claim.file, claim.number)}>
            <IconFileText />
            <span>e-Klaim (hlm. {claim.number})</span>
          </button>
        </div>
      </dl>
      {(primary || secondary.length > 0 || procedures.length > 0) && (
        <div className="claim-icd-grid">
          <div className="claim-icd-col">
            <h3 className="claim-icd-heading">Diagnosis ICD-10</h3>
            {(primary || secondary.length > 0) ? (
              <ul className="claim-icd-list">
                {primary && (
                  <li className="claim-icd-item">
                    <span className="code-chip code-accent">{primary}</span>
                    <span className="icd-role-tag">Utama</span>
                    <span className="claim-icd-desc">{describeIcd(primary) || 'Deskripsi belum tersedia'}</span>
                  </li>
                )}
                {secondary.map((code, index) => (
                  <li key={code + ':' + index} className="claim-icd-item">
                    <span className="code-chip">{code}</span>
                    <span className="claim-icd-desc">{describeIcd(code) || 'Deskripsi belum tersedia'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="claim-sub-val">Tidak ada kode diagnosis.</p>
            )}
          </div>
          <div className="claim-icd-col">
            <h3 className="claim-icd-heading">Prosedur ICD-9-CM</h3>
            {procedures.length > 0 ? (
              <ul className="claim-icd-list">
                {procedures.map((code, index) => (
                  <li key={code + ':' + index} className="claim-icd-item">
                    <span className="code-chip">{code}</span>
                    <span className="claim-icd-desc">{describeIcd(code) || 'Deskripsi belum tersedia'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="claim-sub-val">Tidak ada kode prosedur.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Finding({ item, locked, change, show, many, previewOnly, proof }) {
  const { saved, effectiveStatus, isAuto } = item;
  const [showNote, setShowNote] = useState(false);

  const refsList = (item.references || []).filter(ref => ref && typeof ref.label === 'string' && ref.label.trim());
  const notes = [
    ...(refsList.length ? [] : [item.source]),
    ...(item.details || []),
    ...(item.parameters || []),
  ].filter(note => typeof note === 'string' && note.trim());
  const evidenceQuotes = (item.evidenceQuotes || []).filter(q => q && typeof q.quote === 'string' && q.quote.trim());
  const checks = (item.checklist || []).filter(check => typeof check.label === 'string' && check.label.trim());
  const documents = (item.docs || []).filter(doc => typeof doc === 'string' && doc.trim());
  const actions = (item.actions || []).filter(action => typeof action === 'string' && action.trim());
  const marks = saved?.evidence || [];
  const isActive = ref => ref.file === proof[0] && ref.number === proof[1];
  const currentMarked = marks.some(isActive);
  const pageLabel = ref => (many ? 'PDF ' + (ref.file + 1) + ' · ' : '') + 'hlm. ' + ref.number;

  const reasonRequired = needsReason(effectiveStatus);
  const noteOpen = showNote || reasonRequired || Boolean(saved?.note?.trim());
  const availableDecisions = decisions.filter(value => value !== 'Tidak berlaku' || optional.has(item.id) || item.source);
  const activeTone = effectiveStatus ? labelTone[effectiveStatus] : (item.automatic ? 'pending' : 'neutral');

  const badgeStatus = effectiveStatus
    ? labelTone[effectiveStatus]
    : (item.automatic ? 'pending' : 'neutral');
  const badgeText = isAuto
    ? 'Sesuai · PDF'
    : (saved?.status || (item.automatic ? 'Perlu klarifikasi' : 'Belum ditinjau'));

  return (
    <article className={'finding finding-' + activeTone}>
      <div className="finding-head">
        <div>
          <div className="finding-meta-row">
            <span className="domain-tag">{item.stageLabel}</span>
            {item.source && <span className="finding-source">{item.source}</span>}
          </div>
          <h3>{item.title}</h3>
        </div>
        <Badge status={badgeStatus}>{badgeText}</Badge>
      </div>

      {item.automatic && (
        <div className="attention" role="note">
          <IconAlertTriangle className="attention-icon" />
          <div>
            <strong>Perhatian aturan klinis</strong>
            <p>{item.summary}</p>
          </div>
        </div>
      )}

      <div className="verification-checks">
        {!item.automatic && <p>{item.summary}</p>}
        {item.automatic && !checks.length && !documents.length && !actions.length && (
          <p>Cocokkan kode atau data pemicu temuan dengan halaman dokumen sumber, lalu tetapkan hasil tinjau.</p>
        )}
        {!!checks.length && (
          <ul className="checklist-items">
            {checks.map((check, index) => {
              const verified = check.detected && (!check.locate || check.refs?.length);
              return (
                <li key={index} className="checklist-row">
                  <div className="checklist-line">
                    <span className={verified ? 'check-pill check-read' : 'check-pill check-review'}>
                      {verified ? <IconCheck /> : <IconClock />}
                      <span>{check.detected ? (check.locate && !check.refs?.length ? 'Lokasi belum pasti' : 'Terbaca') : 'Perlu dicek'}</span>
                    </span>
                    <span className="check-label">{check.label}</span>
                  </div>
                  {!!check.refs?.length && (
                    <div className="evidence indicator-evidence">
                      {check.refs.map(ref => (
                        <button
                          key={ref.file + ':' + ref.number}
                          type="button"
                          title={ref.excerpt}
                          aria-current={isActive(ref) ? 'location' : undefined}
                          onClick={() => show(ref.file, ref.number)}
                        >
                          {pageLabel(ref)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!!documents.length && <p className="doc-needed"><b>Dokumen yang dicari:</b> {documents.join(', ')}</p>}
        {!!actions.length && <ul className="action-bullets">{actions.map((action, index) => <li key={index}>{action}</li>)}</ul>}
      </div>

      {!!item.refs.length && (
        <div className="evidence">
          <span className="proof-caption">Halaman bukti</span>
          {item.refs.map((ref, index) => (
            <button
              key={index}
              type="button"
              title={ref.excerpt}
              aria-current={isActive(ref) ? 'location' : undefined}
              onClick={() => show(ref.file, ref.number)}
            >
              {pageLabel(ref)}
            </button>
          ))}
        </div>
      )}

      {!!evidenceQuotes.length && (
        <ul className="evidence-quotes" aria-label="Kutipan bukti dokumen">
          {evidenceQuotes.map((q, index) => (
            <li key={q.file + ':' + q.number + ':' + index} className="evidence-quote-item">
              <button
                type="button"
                className="small evidence-quote-jump"
                aria-current={isActive(q) ? 'location' : undefined}
                onClick={() => show(q.file, q.number)}
              >
                {pageLabel(q)}
              </button>
              <span className="evidence-quote-text">{q.quote}</span>
            </li>
          ))}
        </ul>
      )}

      {!!marks.length && (
        <div className="evidence verified-evidence">
          <span className="proof-caption">Ditandai verifikator</span>
          {marks.map(ref => (
            <button
              key={ref.file + ':' + ref.number}
              type="button"
              aria-current={isActive(ref) ? 'location' : undefined}
              onClick={() => show(ref.file, ref.number)}
            >
              {pageLabel(ref)}
            </button>
          ))}
        </div>
      )}

      {!previewOnly && !locked && (
        <div className="evidence">
          <button
            type="button"
            className="mark-evidence"
            aria-pressed={currentMarked}
            onClick={() => change({
              evidence: currentMarked
                ? marks.filter(ref => !isActive(ref))
                : [...marks, { file: proof[0], number: proof[1] }],
            })}
          >
            {currentMarked ? 'Lepas tanda' : 'Tandai ditemukan di'} {pageLabel({ file: proof[0], number: proof[1] })}
          </button>
        </div>
      )}

      {(notes.length > 0 || refsList.length > 0) && (
        <details className="rule-details">
          <summary>Dasar aturan dan rincian bukti</summary>
          {!!refsList.length && (
            <ul className="ref-list">
              {refsList.map((ref, index) => (
                <li key={index} className="ref-item">
                  <strong className="ref-label">{ref.label}</strong>
                  {ref.detail && <p className="ref-detail">{ref.detail}</p>}
                  {ref.url && (
                    <a className="ref-link" href={ref.url} target="_blank" rel="noopener noreferrer">
                      Buka rujukan resmi ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notes.map((note, index) => <p key={index}>{note}</p>)}
        </details>
      )}

      {!previewOnly && (
        <div className="verdict-controls">
          <div className="verdict-pills-row">
            <div className="verdict-pills" role="group" aria-label={'Hasil tinjau untuk ' + item.title}>
              {availableDecisions.map(value => {
                const meta = verdictMeta[value];
                const IconComp = meta.Icon;
                const selected = effectiveStatus === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={locked}
                    aria-pressed={selected}
                    className={'verdict-btn verdict-' + meta.tone + (selected ? ' is-selected' : '')}
                    onClick={() => change({ status: value })}
                  >
                    <IconComp />
                    <span>{value}</span>
                  </button>
                );
              })}
            </div>
            {!noteOpen && !locked && (
              <button type="button" className="small text-button note-toggle-btn" onClick={() => setShowNote(true)}>
                + Catatan
              </button>
            )}
          </div>
          {noteOpen && (
            <Field
              label={reasonRequired ? 'Alasan keputusan (wajib)' : 'Catatan verifikator (opsional)'}
              placeholder={reasonRequired ? 'Jelaskan alasan atau tindak lanjut yang diperlukan…' : 'Tambahkan catatan klinis/administrasi jika perlu'}
              maxLength={500}
              value={saved?.note || ''}
              disabled={locked}
              onChange={event => change({ note: event.target.value })}
            />
          )}
        </div>
      )}
    </article>
  );
}

function EvidenceImage({ episodeId, docIndex, page, nextPage, nextRotation, fit, rotation, zoomed }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [resolvedSrc, setResolvedSrc] = useState('');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setResolvedSrc('');
    resolvePagePreviewUrl({ episodeId, docIndex, pageNumber: page, fit, rotation })
      .then(url => {
        if (!active) return;
        const withRetry = attempt && !url.startsWith('blob:')
          ? url + (url.includes('?') ? '&' : '?') + 'retry=' + attempt
          : url;
        setResolvedSrc(withRetry);
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => { active = false; };
  }, [episodeId, docIndex, page, fit, rotation, attempt]);

  useEffect(() => {
    if (status !== 'ready' || !nextPage) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      resolvePagePreviewUrl({ episodeId, docIndex, pageNumber: nextPage, fit: true, rotation: nextRotation })
        .then(url => {
          if (!url.startsWith('blob:')) {
            fetch(url, { signal: controller.signal }).then(result => result.body?.cancel()).catch(() => {});
          }
        })
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [status, episodeId, docIndex, nextPage, nextRotation]);

  return (
    <div className="page-sheet" aria-busy={status === 'loading'}>
      {status === 'loading' && <p className="viewer-message" role="status">Memuat halaman {page}…</p>}
      {status === 'error' && (
        <div className="viewer-message" role="alert">
          <p>Halaman {page} belum dapat dimuat.</p>
          <button type="button" onClick={() => { setStatus('loading'); setAttempt(attempt + 1); }}>Coba lagi</button>
        </div>
      )}
      {resolvedSrc && (
        <img
          key={attempt}
          className={zoomed ? 'zoomed' : ''}
          hidden={status !== 'ready'}
          src={resolvedSrc}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
          alt={'Halaman ' + page + ' dari berkas PDF aktif'}
        />
      )}
    </div>
  );
}

function EvidenceViewer({ episode, file, page, setProof, zoomed, setZoomed, removeDocument, busy }) {
  const doc = episode.docs.find(item => item.index === file) || episode.docs[0];
  const pageObj = doc?.pages.find(item => item.number === page);
  const detectedRot = pageObj?.rotation || 0;
  const [rotation, setRotation] = useState(detectedRot);
  useEffect(() => { setRotation(detectedRot); }, [file, page, detectedRot]);
  const previewKey = `${episode.id}:${doc.index}:${page}:${!zoomed}:${rotation}`;
  const nextObj = doc.pages.find(item => item.number === page + 1);
  const nextPage = !zoomed && page < doc.pages.length ? page + 1 : 0;
  const nextRotation = nextObj?.rotation || 0;
  const readStatus = pageObj?.ocr ? 'OCR' : pageObj?.read ? 'Teks asli' : 'Belum terbaca';
  const docSelectId = useId();
  const jumpSelectId = useId();

  return (
    <aside className="surface viewer" id="viewer" aria-label="Penampil dokumen PDF">
      <div className="viewer-header">
        <div>
          <p className="eyebrow">DOKUMEN SUMBER</p>
          <h2>Penampil PDF</h2>
        </div>
        <div className="viewer-tools">
          <button type="button" className="small" onClick={() => setRotation(value => (value + 90) % 360)} title="Putar 90 derajat">
            <IconRotateCw />
            <span>Putar 90°</span>
          </button>
          <button type="button" className="small" onClick={() => setZoomed(!zoomed)}>
            {zoomed ? <IconZoomOut /> : <IconZoomIn />}
            <span>{zoomed ? 'Pas layar' : 'Perbesar'}</span>
          </button>
        </div>
      </div>

      <div className="viewer-doc-row">
        <label htmlFor={docSelectId} className="visually-hidden">Pilih lampiran PDF</label>
        <select id={docSelectId} value={doc.index} onChange={event => setProof(Number(event.target.value), 1)}>
          {episode.docs.map(item => <option key={item.index} value={item.index}>{item.name}</option>)}
        </select>
        <button
          type="button"
          className="small file-remove"
          disabled={busy}
          onClick={() => removeDocument(doc.index)}
          aria-label={'Hapus lampiran ' + doc.name}
        >
          <IconTrash />
          <span>Hapus</span>
        </button>
      </div>

      <div className="viewer-nav-bar">
        <div className="page-nav">
          <button type="button" className="icon-btn" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => setProof(doc.index, page - 1)}>
            <IconChevronLeft />
          </button>
          <label htmlFor={jumpSelectId} className="visually-hidden">Loncat ke halaman</label>
          <select id={jumpSelectId} className="page-jump tabular" value={page} onChange={event => setProof(doc.index, Number(event.target.value))}>
            {doc.pages.map(item => <option key={item.number} value={item.number}>Hlm. {item.number} / {doc.pages.length}</option>)}
          </select>
          <button type="button" className="icon-btn" aria-label="Halaman berikutnya" disabled={page >= doc.pages.length} onClick={() => setProof(doc.index, page + 1)}>
            <IconChevronRight />
          </button>
        </div>
        <div className="viewer-meta-pills">
          <span className="viewer-pill">{readStatus}</span>
          {rotation > 0 && <span className="viewer-pill">{rotation}°</span>}
        </div>
      </div>

      <div className="viewer-stage">
        <EvidenceImage
          key={previewKey}
          episodeId={episode.id}
          docIndex={doc.index}
          page={page}
          nextPage={nextPage}
          nextRotation={nextRotation}
          fit={!zoomed}
          rotation={rotation}
          zoomed={zoomed}
        />
      </div>
    </aside>
  );
}

export function ReviewDesk({
  episode,
  edit,
  save,
  notify,
  saving,
  markDirty,
  managing,
  removeDocument,
  onDeleteEpisode,
  askConfirm,
  sidebarCollapsed,
  onToggleSidebar,
}) {
  const [proof, setProof] = useState([episode.docs[0].index, 1]);
  const [zoomed, setZoomed] = useState(false);
  const [domainFilter, setDomainFilter] = useState('all');
  const [passedOpen, setPassedOpen] = useState(false);
  const passedDialogRef = useRef(null);
  const passedTitleId = useId();
  const reasonId = useId();

  useEffect(() => {
    const dialog = passedDialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    let pressedOutside = false;
    const isOutside = event => {
      const r = dialog.getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    };
    const onDown = event => { pressedOutside = Boolean(dialog.open && isOutside(event)); };
    const onUp = event => { if (pressedOutside && dialog.open && isOutside(event)) dialog.close(); pressedOutside = false; };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, [passedOpen]);

  const info = useMemo(() => inspect(episode), [episode.docs]);
  const state = episode.state;
  const isPackage = state.scope === 'package';
  const groupingFiles = [...new Set(info.docs.grouping.refs.map(ref => ref.file))];
  const mixed = !isPackage && groupingFiles.length > 1;
  const [analysisFile, setAnalysisFile] = useState(groupingFiles[0]);
  const selectedFile = groupingFiles.includes(analysisFile) ? analysisFile : groupingFiles[0];
  const analysisInfo = useMemo(
    () => (mixed ? inspect({ docs: episode.docs.filter(doc => doc.index === selectedFile) }) : info),
    [mixed, episode.docs, selectedFile, info],
  );

  const usingSuggestedCategory = Boolean(!isPackage && !state.category && info.suggestedCategory?.id);
  const effectiveCategory = state.category || info.suggestedCategory?.id || '';
  const { primary, secondary, procedures, age, service } = state;
  const confirmedInput = (mixed ? analysisInfo.primary : state.primary ?? info.primary).trim();
  const foundMain = /^[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?$/i.test(confirmedInput);
  const effectiveProceduresText = (mixed ? undefined : state.procedures) ?? (Array.isArray(analysisInfo.procedures) ? analysisInfo.procedures.join(', ') : analysisInfo.procedures);
  const procRefs = useMemo(() => procedureReferencesFor(effectiveProceduresText), [effectiveProceduresText]);
  const icdDict = useIcdDictionary();
  const effectivePrimary = mixed
    ? analysisInfo.primary
    : (state.primary == null ? analysisInfo.primary : parseDiagnosisCodes(state.primary)[0] || '');
  const effectiveSecondary = mixed
    ? analysisInfo.secondary
    : (state.secondary == null ? analysisInfo.secondary : parseDiagnosisCodes(state.secondary));
  const effectiveProcedures = mixed
    ? analysisInfo.procedures
    : (state.procedures == null ? analysisInfo.procedures : parseProcedureCodes(state.procedures));
  const describeIcd = code => resolveIcdDescription(code, analysisInfo.codeDescriptions, icdDict);
  const primaryDesc = describeIcd(effectivePrimary);

  const rawItems = useMemo(() => {
    const admin = adminRows(info, { ...state, category: effectiveCategory }).map(row => ({ ...row, stage: 'admin', stageLabel: 'Administrasi' }));
    if (isPackage) return admin;
    const draft = mixed ? {} : { primary, secondary, procedures, age, service };
    const medical = medicalRows(analysisInfo, draft).map(row => ({ ...row, stage: 'medical', stageLabel: 'Verifikasi Medis' }));
    const passedMedicalRuleIds = new Set(
      medical.filter(row => !row.automatic && row.status === 'Sesuai').map(row => medicalRuleIdOf(row.id)),
    );
    const coding = codingRows(analysisInfo, draft).map(row => {
      const baseRow = { ...row, stage: 'coding', stageLabel: 'Audit Coding' };
      if (baseRow.id.startsWith('COD-') && passedMedicalRuleIds.has(baseRow.id.slice(4))) {
        return { ...baseRow, status: 'Sesuai', automatic: false };
      }
      return baseRow;
    });
    return [...admin, ...coding, ...medical];
  }, [info, analysisInfo, state, effectiveCategory, isPackage, mixed, primary, secondary, procedures, age, service]);

  const allItems = useMemo(() => {
    return rawItems.map(item => {
      const previewOnly = mixed && item.stage !== 'admin';
      const saved = previewOnly ? undefined : state.reviews?.[item.stage]?.[item.id];
      const autoEligible = !item.automatic && item.status === 'Sesuai';
      const effectiveStatus = saved?.status || (autoEligible ? 'Sesuai' : '');
      const isAuto = !saved?.status && autoEligible;
      const needsAttention = Boolean(item.automatic || !autoEligible || (saved?.status && saved.status !== 'Sesuai'));
      return { ...item, previewOnly, saved, autoEligible, effectiveStatus, isAuto, needsAttention };
    });
  }, [rawItems, mixed, state.reviews]);

  const filteredItems = useMemo(() => {
    if (domainFilter === 'all') return allItems;
    return allItems.filter(item => item.stage === domainFilter);
  }, [allItems, domainFilter]);

  const attentionItems = useMemo(() => {
    const priority = item => (item.effectiveStatus === 'Tidak sesuai' ? 2 : (item.automatic || item.effectiveStatus === 'Perlu klarifikasi' ? 1 : 0));
    return filteredItems
      .filter(item => item.needsAttention)
      .sort((a, b) => priority(b) - priority(a));
  }, [filteredItems]);
  const allCleanItems = useMemo(() => allItems.filter(item => !item.needsAttention), [allItems]);

  const allAttentionItems = allItems.filter(item => item.needsAttention);
  const totalAttention = allAttentionItems.length;
  const totalClean = allItems.length - totalAttention;

  const prefill = useMemo(() => claimMeta(analysisInfo.claim), [analysisInfo.claim]);
  const [form, setForm] = useState(() => ({
    facility: '',
    claimNumber: '',
    serviceDate: '',
    amount: '',
    ...prefill,
    ...cleanNonEmpty(state.meta),
    status: '',
    reason: '',
    reviewer: state.reviewer || state.decision?.reviewer || '',
    date: today(),
    ...cleanNonEmpty(state.decision),
  }));

  const show = (file, page) => {
    setProof([file, page]);
    if (window.innerWidth < 960) document.getElementById('viewer')?.scrollIntoView({ block: 'start' });
  };

  const change = (name, value) => edit(previous => {
    const next = { ...previous, [name]: value };
    if (['category', 'service'].includes(name)) {
      const current = previous.reviews || {};
      const shared = new Set(['grouping', 'resume', 'billing', 'identity', 'jpkm', 'patient-mismatch', 'claim-payer', 'gender-mismatch']);
      next.reviews = { ...current, admin: flagReviews(current.admin, id => shared.has(id)) };
      if (name === 'service') {
        next.reviews.coding = flagReviews(current.coding);
        next.reviews.medical = flagReviews(current.medical);
      }
    }
    if (codes.includes(name)) {
      const current = previous.reviews || {};
      next.reviews = { ...current, coding: flagReviews(current.coding), medical: flagReviews(current.medical) };
      next.codesConfirmed = false;
    }
    return next;
  });

  const changeFinding = (itemStage, id, patch) => edit(previous => ({
    ...previous,
    reviews: {
      ...previous.reviews,
      [itemStage]: {
        ...previous.reviews?.[itemStage],
        [id]: { ...previous.reviews?.[itemStage]?.[id], ...patch },
      },
    },
  }));

  const buildMergedReviews = () => {
    const next = {};
    for (const key of ['admin', 'coding', 'medical']) {
      if (state.reviews?.[key]) next[key] = { ...state.reviews[key] };
    }
    for (const item of allItems) {
      if (item.previewOnly) continue;
      if (!next[item.stage]?.[item.id]?.status && item.autoEligible) {
        next[item.stage] = {
          ...next[item.stage],
          [item.id]: { ...(next[item.stage]?.[item.id] || {}), status: 'Sesuai' },
        };
      }
    }
    return next;
  };

  const buildMetaPayload = () => {
    const rawAmount = form.amount;
    const numericAmount = rawAmount === '' || rawAmount === null || rawAmount === undefined
      ? null
      : Number(rawAmount);
    return {
      facility: String(form.facility || '').trim(),
      claimNumber: String(form.claimNumber || '').trim(),
      serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(String(form.serviceDate || '')) ? String(form.serviceDate) : '',
      amount: Number.isSafeInteger(numericAmount) && numericAmount >= 0 ? numericAmount : null,
    };
  };

  const saveDraft = async () => {
    const reviewer = String(form.reviewer || state.reviewer || '').trim();
    const merged = buildMergedReviews();
    if (isPackage) {
      await save({ ...state, reviewer, reviews: merged }, 'Draf tinjauan paket disimpan.');
      return;
    }
    const typed = mixed
      ? {}
      : Object.fromEntries(codes.map(id => [id, state[id] ?? (Array.isArray(analysisInfo[id]) ? analysisInfo[id].join(', ') : analysisInfo[id])]));
    await save({
      ...state,
      ...(effectiveCategory ? { category: effectiveCategory } : {}),
      ...typed,
      codesConfirmed: foundMain || Boolean(state.codesConfirmed),
      reviewer,
      meta: buildMetaPayload(),
      reviews: merged,
    }, 'Draf tinjauan disimpan.');
  };

  const finishPackage = async () => {
    const reviewer = String(form.reviewer || '').trim();
    if (!reviewer) return notify('Isi nama verifikator.', true);
    const merged = buildMergedReviews();
    await save({ ...state, reviewer, reviews: merged, approved: ['admin'] }, 'Paket pengajuan selesai diverifikasi.');
  };

  const reasonSuggestions = useMemo(() => {
    const lines = [];
    for (const item of allItems) {
      if (item.previewOnly) continue;
      const st = item.effectiveStatus;
      if (st === 'Tidak sesuai' || st === 'Perlu klarifikasi') {
        lines.push(`${item.title}: ${item.saved?.note?.trim() || item.summary}`);
      } else if (item.automatic && st === '') {
        lines.push(`${item.title}: ${item.summary}`);
      } else if (item.saved?.note?.trim()) {
        lines.push(`${item.title}: ${item.saved.note.trim()}`);
      }
    }
    return lines.join('\n').slice(0, 1950);
  }, [allItems]);

  const submitDecision = async event => {
    event.preventDefault();
    if (!form.status) return notify('Pilih hasil keputusan klaim terlebih dahulu.', true);
    const reviewer = String(form.reviewer || '').trim();
    if (!reviewer) return notify('Isi nama verifikator.', true);
    const meta = buildMetaPayload();
    if (!meta.facility || !meta.claimNumber || !meta.serviceDate) {
      return notify('Lengkapi nomor klaim, nama rumah sakit, dan tanggal pelayanan.', true);
    }
    const reason = String(form.reason || '').trim();
    if (form.status !== 'layak' && !reason) {
      return notify('Isi dasar keputusan atau catatan tindak lanjut.', true);
    }

    if (form.status === 'layak') {
      const openItems = allItems.filter(item => !item.previewOnly && item.needsAttention);
      const tidakSesuaiCount = openItems.filter(item => item.effectiveStatus === 'Tidak sesuai').length;
      const klarifikasiCount = openItems.filter(item => item.effectiveStatus === 'Perlu klarifikasi').length;
      const unreviewedCount = openItems.filter(item => !item.effectiveStatus).length;
      if (tidakSesuaiCount || klarifikasiCount || unreviewedCount) {
        const parts = [];
        if (tidakSesuaiCount) parts.push(`${tidakSesuaiCount} Tidak sesuai`);
        if (klarifikasiCount) parts.push(`${klarifikasiCount} Perlu klarifikasi`);
        if (unreviewedCount) parts.push(`${unreviewedCount} belum ditinjau`);
        const choice = await askConfirm({
          title: 'Konfirmasi Layak Klaim',
          message: `Masih terdapat ${parts.join(', ')} pada daftar indikator.\nTetap simpan keputusan akhir sebagai Layak Klaim?`,
          primaryLabel: 'Tetap simpan Layak',
          cancelLabel: 'Batal',
          tone: 'warning',
        });
        if (choice !== 'primary') return;
      }
    }

    const decision = {
      status: form.status,
      reviewer,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(form.date || '')) ? String(form.date) : today(),
      reason,
    };
    const nextApproved = (form.status === 'layak' || form.status === 'tidak-layak')
      ? ['admin', 'coding', 'medical']
      : (state.approved || []);
    const typed = mixed
      ? {}
      : Object.fromEntries(codes.map(id => [id, state[id] ?? (Array.isArray(analysisInfo[id]) ? analysisInfo[id].join(', ') : analysisInfo[id])]));

    await save({
      ...state,
      ...(effectiveCategory ? { category: effectiveCategory } : {}),
      ...typed,
      codesConfirmed: foundMain || Boolean(state.codesConfirmed),
      reviewer,
      approved: nextApproved,
      reviews: buildMergedReviews(),
      meta,
      decision,
    }, 'Keputusan verifikasi disimpan dan tercatat di Rekap Verifikasi.');
  };

  const disabled = saving || managing;
  const missingMeta = !form.claimNumber?.trim() || !form.facility?.trim() || !form.serviceDate;
  const [codesOpen, setCodesOpen] = useState(() => !foundMain);
  const [metaOpen, setMetaOpen] = useState(() => missingMeta);
  const openPassedDialog = () => {
    setPassedOpen(true);
    passedDialogRef.current?.showModal();
  };
  const showAndClosePassed = (fileIdx, pageNum) => {
    show(fileIdx, pageNum);
    passedDialogRef.current?.close();
  };
  const numericAmount = form.amount === '' || form.amount === null ? null : Number(form.amount);
  const metaSummaryLabel = [
    form.claimNumber?.trim() || 'No. klaim kosong',
    form.facility?.trim() || 'RS kosong',
    Number.isInteger(numericAmount) ? rupiah(numericAmount) : 'Nominal kosong',
  ].join(' · ');

  return (
    <div className="review-desk">
      <section className="surface episode-heading">
        <div className="case-top-bar">
          <div className="case-title-wrap">
            <button
              type="button"
              className="small sidebar-toggle"
              aria-expanded={!sidebarCollapsed}
              onClick={onToggleSidebar}
              title={sidebarCollapsed ? 'Tampilkan antrean episode' : 'Sembunyikan antrean agar tampilan lebih luas'}
            >
              <IconPanelLeft />
              <span>{sidebarCollapsed ? 'Antrean' : 'Luaskan'}</span>
            </button>
            <div>
              <p className="eyebrow">{isPackage ? 'PAKET PENGAJUAN RS' : 'VERIFIKASI SATU LAYAR · EPISODE KLAIM'}</p>
              <h2>{episode.title}</h2>
              <p className="muted tabular">
                {episode.docs.length} berkas PDF · {info.pages.filter(row => row.read).length}/{info.pages.length} halaman terbaca ·{' '}
                <strong>{totalAttention} meragukan / tidak sesuai</strong> · {totalClean} terpenuhi OCR
              </p>
            </div>
          </div>
          <div className="case-top-actions">
            {!isPackage ? (
              <Badge status={state.decision?.status} />
            ) : (
              <Badge status={state.approved?.includes('admin') ? 'layak' : 'neutral'}>
                {state.approved?.includes('admin') ? 'Paket selesai' : 'Belum selesai'}
              </Badge>
            )}
            <button
              type="button"
              className="small file-remove"
              disabled={disabled}
              onClick={() => onDeleteEpisode(episode.id)}
              aria-label={'Hapus episode ' + episode.title}
            >
              <IconTrash />
              <span>Hapus</span>
            </button>
          </div>
        </div>

        {!isPackage && (
          <ClaimSummary
            info={analysisInfo}
            show={show}
            primary={effectivePrimary}
            secondary={effectiveSecondary}
            procedures={effectiveProcedures}
            describeIcd={describeIcd}
          />
        )}

        {!isPackage && (
          <div className="quick-context-bar">
            <div className="quick-context-fields">
              <SelectField
                label="Jenis layanan"
                disabled={disabled}
                value={state.service ?? info.service}
                onChange={event => change('service', event.target.value)}
              >
                <option value="">Pilih layanan</option>
                {['Rawat Jalan', 'Rawat Inap', 'IGD'].map(value => <option key={value}>{value}</option>)}
              </SelectField>
              <SelectField
                label={usingSuggestedCategory ? 'Kategori sasaran JPKM (otomatis dari PDF)' : 'Kategori sasaran JPKM'}
                disabled={disabled}
                value={effectiveCategory}
                onChange={event => change('category', event.target.value)}
              >
                <option value="">Pilih kategori sasaran</option>
                {Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </SelectField>
            </div>

            <details className="inline-disclosure" open={codesOpen} onToggle={event => setCodesOpen(event.currentTarget.open)}>
              <summary>
                <span>Kode ICD-10, prosedur &amp; usia ({confirmedInput ? confirmedInput + (primaryDesc ? ' — ' + primaryDesc : '') : 'belum terbaca'})</span>
              </summary>
              <div className="inline-disclosure-body">
                <div className="fields">
                  {codes.map((id, index) => (
                    <Field
                      key={id}
                      label={['Diagnosis utama (ICD-10)', 'Diagnosis sekunder', 'Kode prosedur (ICD-9-CM)', 'Usia (tahun)'][index]}
                      disabled={disabled || mixed}
                      value={(mixed ? undefined : state[id]) ?? (Array.isArray(analysisInfo[id]) ? analysisInfo[id].join(', ') : analysisInfo[id])}
                      maxLength={180}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      onChange={event => change(id, event.target.value)}
                    />
                  ))}
                </div>
                {!!procRefs.length && (
                  <div className="proc-ref-strip">
                    <span className="proof-caption">Rujukan Ingenix ICD-9-CM 2010:</span>
                    <ul className="proc-ref-list">
                      {procRefs.map(({ code, matches }) => {
                        const desc = describeIcd(code);
                        return (
                          <li key={code}>
                            <code>{code}</code>{desc ? ' — ' + desc : ''} · {matches.map(m => `${m.file}, hlm. PDF ${m.page}`).join(' · ')}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {(!isPackage && totalAttention > 0) && (
          <div className="triage-toolbar">
            {totalAttention > 4 ? (
              <div className="triage-pills" role="group" aria-label="Saring bagian temuan">
                {[
                  ['all', `Semua (${allAttentionItems.length})`],
                  ['admin', `Administrasi (${allAttentionItems.filter(i => i.stage === 'admin').length})`],
                  ['coding', `Audit Coding (${allAttentionItems.filter(i => i.stage === 'coding').length})`],
                  ['medical', `Verifikasi Medis (${allAttentionItems.filter(i => i.stage === 'medical').length})`],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={domainFilter === key ? 'pill-btn is-active' : 'pill-btn'}
                    onClick={() => setDomainFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : <div />}

            <button
              type="button"
              className="small jump-decision-btn"
              onClick={() => document.getElementById('decision-panel')?.scrollIntoView({ block: 'start' })}
            >
              <IconArrowDown />
              <span>Langsung ke Keputusan</span>
            </button>
          </div>
        )}
      </section>

      {mixed && (
        <section className="surface screening-summary">
          <strong>{groupingFiles.length} PDF memiliki halaman grouping individual</strong>
          <p>Untuk menjaga akurasi, temuan coding dan medis ditampilkan sebagai pratinjau per PDF. Impor terpisah bila ingin menyimpannya per klaim.</p>
          <SelectField
            label="PDF untuk pratinjau Audit Coding dan Verifikasi Medis"
            value={selectedFile}
            onChange={event => {
              const file = Number(event.target.value);
              setAnalysisFile(file);
              show(file, info.docs.grouping.refs.find(ref => ref.file === file).number);
            }}
          >
            {episode.docs.filter(doc => groupingFiles.includes(doc.index)).map(doc => (
              <option key={doc.index} value={doc.index}>{doc.name}</option>
            ))}
          </SelectField>
        </section>
      )}

      <div className="review-split">
        <div className="triage-column">
          <section className="surface review-panel" aria-labelledby="attention-heading">
            {!attentionItems.length ? (
              <div className="clean-banner clean-banner-row" role="status">
                <div className="clean-banner-copy">
                  <IconCheckCircle />
                  <div>
                    <h2 id="attention-heading">
                      {totalAttention === 0
                        ? `Semua ${totalClean} aturan OCR & PDF terpenuhi`
                        : 'Tidak ada temuan meragukan pada bagian ini'}
                    </h2>
                    <p>
                      {totalAttention === 0
                        ? 'Tidak ada temuan yang meragukan atau tidak sesuai. Klaim siap langsung diputuskan di bawah.'
                        : 'Semua aturan pada filter ini sudah terpenuhi otomatis dari OCR PDF.'}
                    </p>
                  </div>
                </div>
                {totalClean > 0 && (
                  <button type="button" className="small passed-link-btn" onClick={openPassedDialog}>
                    Lihat rincian ({totalClean})
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="panel-head-row">
                  <div>
                    <h2 id="attention-heading">Temuan Meragukan / Tidak Sesuai</h2>
                    <p className="muted tabular">
                      {totalClean} aturan lainnya sudah terpenuhi otomatis dari OCR PDF
                    </p>
                  </div>
                  <div className="actions">
                    {totalClean > 0 && (
                      <button type="button" className="small passed-link-btn" onClick={openPassedDialog}>
                        Lihat yang terpenuhi ({totalClean})
                      </button>
                    )}
                    <span className="count-pill tabular">{attentionItems.length}</span>
                  </div>
                </div>
                {attentionItems.map(item => (
                  <Finding
                    key={item.stage + ':' + item.id}
                    item={item}
                    locked={disabled || item.previewOnly}
                    previewOnly={item.previewOnly}
                    show={show}
                    many={episode.docs.length > 1}
                    change={patch => changeFinding(item.stage, item.id, patch)}
                    proof={proof}
                  />
                ))}
              </>
            )}
          </section>

          <section id="decision-panel" className="surface review-panel decision-card" aria-labelledby="decision-heading">
            <div className="section-head">
              <div>
                <h2 id="decision-heading">{isPackage ? 'Penetapan Paket Pengajuan' : 'Keputusan Verifikasi Klaim'}</h2>
                <p className="muted">
                  {isPackage
                    ? 'Lengkapi nama verifikator dan selesaikan pemeriksaan paket pengajuan.'
                    : 'Pilih keputusan akhir dan simpan langsung dari satu layar.'}
                </p>
              </div>
              {!isPackage && <Badge status={form.status || state.decision?.status} />}
            </div>

            {isPackage ? (
              <div className="fields">
                <Field
                  className="span-2"
                  label="Nama verifikator"
                  disabled={disabled}
                  maxLength={120}
                  placeholder="Nama petugas verifikator"
                  value={form.reviewer}
                  onChange={event => {
                    const value = event.target.value;
                    setForm(c => ({ ...c, reviewer: value }));
                    markDirty();
                  }}
                />
              </div>
            ) : (
              <form id="decision-form" onSubmit={submitDecision} onChange={markDirty}>
                <fieldset className="decision-selector">
                  <legend>Hasil verifikasi klaim</legend>
                  <div className="decision-grid">
                    {decisionChoices.map(([id, label, IconComp]) => {
                      const activeChoice = form.status === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={disabled}
                          aria-pressed={activeChoice}
                          className={'decision-option option-' + id + (activeChoice ? ' is-selected' : '')}
                          onClick={() => {
                            setForm(current => ({ ...current, status: id }));
                            markDirty();
                          }}
                        >
                          <IconComp />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="fields decision-fields">
                  <Field
                    label="Nama verifikator"
                    maxLength={120}
                    required
                    disabled={disabled}
                    placeholder="Nama petugas verifikator"
                    value={form.reviewer}
                    onChange={event => setForm(c => ({ ...c, reviewer: event.target.value }))}
                  />
                  <Field
                    label="Tanggal keputusan"
                    type="date"
                    required
                    disabled={disabled}
                    value={form.date}
                    onChange={event => setForm(c => ({ ...c, date: event.target.value }))}
                  />
                </div>

                <div className="decision-reason-wrap field">
                  <div className="reason-label-row">
                    <label htmlFor={reasonId}>
                      {form.status && form.status !== 'layak' ? 'Dasar keputusan / tindak lanjut (wajib)' : 'Catatan keputusan (opsional)'}
                    </label>
                    {reasonSuggestions && (
                      <button
                        type="button"
                        className="small text-button"
                        disabled={disabled}
                        onClick={() => {
                          setForm(c => ({ ...c, reason: reasonSuggestions }));
                          markDirty();
                        }}
                      >
                        Isi dari temuan
                      </button>
                    )}
                  </div>
                  <textarea
                    id={reasonId}
                    maxLength={2000}
                    rows={3}
                    disabled={disabled}
                    required={Boolean(form.status && form.status !== 'layak')}
                    placeholder="Ringkas dasar klinis/administrasi atau alasan pending/dispute…"
                    value={form.reason}
                    onChange={event => setForm(c => ({ ...c, reason: event.target.value }))}
                  />
                </div>

                <details className="inline-disclosure" open={metaOpen} onToggle={event => setMetaOpen(event.currentTarget.open)}>
                  <summary>
                    <span>Identitas &amp; nominal klaim ({metaSummaryLabel})</span>
                  </summary>
                  <div className="fields inline-disclosure-body">
                    <Field
                      label="Nomor klaim / SEP"
                      maxLength={100}
                      required
                      disabled={disabled}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={form.claimNumber}
                      onChange={event => setForm(c => ({ ...c, claimNumber: event.target.value }))}
                    />
                    <Field
                      label="Nama rumah sakit"
                      maxLength={180}
                      required
                      disabled={disabled}
                      value={form.facility}
                      onChange={event => setForm(c => ({ ...c, facility: event.target.value }))}
                    />
                    <Field
                      label="Tanggal pelayanan"
                      type="date"
                      required
                      disabled={disabled}
                      value={form.serviceDate}
                      onChange={event => setForm(c => ({ ...c, serviceDate: event.target.value }))}
                    />
                    <Field
                      label="Nilai pengajuan (Rp)"
                      type="number"
                      min={0}
                      max={1000000000000}
                      step={1}
                      disabled={disabled}
                      value={form.amount ?? ''}
                      onChange={event => setForm(c => ({ ...c, amount: event.target.value }))}
                    />
                  </div>
                </details>
              </form>
            )}

            <div className="panel-action-bar">
              <button type="button" disabled={disabled} onClick={() => void saveDraft()}>
                Simpan draf
              </button>
              {isPackage ? (
                <button type="button" className="primary" disabled={disabled} onClick={() => void finishPackage()}>
                  Selesaikan Paket
                </button>
              ) : (
                <button type="submit" form="decision-form" className="primary" disabled={disabled}>
                  Simpan Keputusan
                </button>
              )}
            </div>
          </section>
        </div>

        <EvidenceViewer
          episode={episode}
          file={proof[0]}
          page={proof[1]}
          setProof={show}
          zoomed={zoomed}
          setZoomed={setZoomed}
          removeDocument={removeDocument}
          busy={disabled}
        />
      </div>

      <dialog
        id="passed-rules-dialog"
        ref={passedDialogRef}
        className="passed-dialog"
        closedby="any"
        aria-labelledby={passedTitleId}
        onClose={() => setPassedOpen(false)}
      >
        <div className="dialog-head">
          <div>
            <h2 id={passedTitleId}>Aturan Terpenuhi Otomatis ({allCleanItems.length})</h2>
            <p className="muted">Sudah terpenuhi otomatis dari pembacaan OCR &amp; PDF. Ubah status bila Anda ingin meninjau ulang atau memindahkannya ke daftar temuan.</p>
          </div>
        </div>
        <div className="passed-dialog-list">
          {allCleanItems.map(item => (
            <Finding
              key={item.stage + ':' + item.id}
              item={item}
              locked={disabled || item.previewOnly}
              previewOnly={item.previewOnly}
              show={showAndClosePassed}
              many={episode.docs.length > 1}
              change={patch => changeFinding(item.stage, item.id, patch)}
              proof={proof}
            />
          ))}
          {!allCleanItems.length && <p className="muted">Tidak ada aturan di daftar terpenuhi.</p>}
        </div>
        <div className="actions end dialog-foot">
          <button type="button" autoFocus onClick={() => passedDialogRef.current?.close()}>Tutup</button>
        </div>
      </dialog>
    </div>
  );
}
