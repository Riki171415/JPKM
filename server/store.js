import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export class HttpError extends Error {
  constructor(status, message = 'Permintaan tidak valid.') { super(message); this.status = status; }
}

const stages = ['admin', 'coding', 'medical'];
const outcomes = ['layak', 'pending', 'dispute', 'tidak-layak'];
export const idPattern = /^[a-f0-9]{32}$/;
export const makeId = () => randomUUID().replaceAll('-', '');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message) => { throw new HttpError(400, message); };

function validDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d\d-\d\d$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(data, key, limit) {
  const value = Object.hasOwn(data, key) ? data[key] : '';
  if (typeof value !== 'string' || value.length > limit) invalid('Data episode atau keputusan tidak valid.');
  return value.trim();
}

function summary(row) {
  const state = JSON.parse(row.state);
  return { id: row.id, title: row.title, revision: row.revision, scope: state.scope || 'episode',
    approved: state.approved || [], decision: state.decision ?? null, meta: state.meta || {} };
}

function validateReview(body, previousState) {
  if (!isRecord(body) || !isRecord(body.state) || !Number.isSafeInteger(body.revision) || JSON.stringify(body.state).length > 200_000) invalid();
  const {state} = body;
  const approved = state.approved ?? [];
  const allowed = previousState.scope === 'package' ? stages.slice(0, 1) : stages;
  const prior = previousState.approved || [];
  if (!Array.isArray(approved) || approved.length > allowed.length || approved.some((value, index) => value !== allowed[index])
      || state.scope !== previousState.scope) invalid();
  const meta = state.meta === undefined ? {} : state.meta;
  const decision = state.decision;
  if (!isRecord(meta) || (decision != null && !isRecord(decision))) invalid();
  for (const [key, limit] of Object.entries({facility:180, claimNumber:100, serviceDate:10})) {
    if (cleanText(meta, key, limit) !== (meta[key] ?? '')) invalid();
  }
  if (meta.serviceDate && !validDate(meta.serviceDate)) invalid();
  if (meta.amount != null && (!Number.isSafeInteger(meta.amount) || meta.amount < 0 || meta.amount > 1_000_000_000_000)) invalid();
  if (decision == null) return;
  const status = decision.status;
  if (state.scope === 'package' || !outcomes.includes(status) || !cleanText(decision, 'reviewer', 120) || !validDate(decision.date)) invalid();
  if (!meta.facility || !meta.claimNumber || !meta.serviceDate) invalid('Isi nomor klaim, rumah sakit, dan tanggal pelayanan.');
  const reason = cleanText(decision, 'reason', 2000);
  if (status !== 'layak' && !reason) invalid('Isi dasar keputusan atau catatan tindak lanjut.');
  if (status === 'layak' && approved.length !== stages.length) invalid('Layak Klaim memerlukan penyelesaian semua tahap verifikasi.');
  if (status === 'tidak-layak' && !approved.length) invalid('Selesaikan satu tahap verifikasi sebelum menetapkan Tidak Layak.');
  if (approved.length < prior.length) invalid('Buka ulang tahap terlebih dahulu sebelum menetapkan keputusan baru.');
}

function validateMarkedPages(state, docs) {
  const stages = Object.values(state.reviews || {});
  const marks = stages.flatMap(items => Object.values(items || {}))
    .filter(result => result?.evidence !== undefined).map(result => result.evidence);
  if (!marks.length) return;
  const pages = new Map(docs.map(doc =>
    [doc.index,new Set(doc.pages.map(page => page.number))]));
  for (const evidence of marks) {
    if (!Array.isArray(evidence) || evidence.some(ref =>
      !isRecord(ref) || !pages.get(ref.file)?.has(ref.number))) {
      invalid('Halaman bukti tidak ditemukan pada berkas episode ini.');
    }
  }
}

export function openStore(dataDir) {
  const db = new DatabaseSync(join(dataDir, 'review.sqlite3'));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS history (
      episode TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revision INTEGER NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS minutes (
      id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, snapshot TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS episode_trash (
      id TEXT PRIMARY KEY, removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attachment_trash (
      id TEXT NOT NULL, document INTEGER NOT NULL, removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(id,document)
    );
  `);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const active = 'NOT EXISTS (SELECT 1 FROM episode_trash t WHERE t.id=episodes.id)';
  const findEpisode = db.prepare('SELECT * FROM episodes WHERE id=? AND '+active);
  const listEpisodes = db.prepare('SELECT id,title,state,revision FROM episodes WHERE '+active+' ORDER BY rowid DESC');
  const addTrash = db.prepare('INSERT INTO episode_trash(id) VALUES(?)');
  const trashedAttachments = db.prepare('SELECT document FROM attachment_trash WHERE id=?');
  const activeDocs = row => {
    const hidden = new Set(trashedAttachments.all(row.id).map(item => item.document));
    return JSON.parse(row.payload).filter(doc => !hidden.has(doc.index));
  };
  const bump = db.prepare('UPDATE episodes SET revision=revision+1 WHERE id=?');
  const getEpisode = id => {
    const row = idPattern.test(id) ? findEpisode.get(id) : undefined;
    if (!row) throw new HttpError(404, 'Episode tidak ditemukan.');
    return row;
  };
  const resetReview = row => {
    const previous = JSON.parse(row.state);
    const state = {...previous, approved:[], decision:null, reviews:{}};
    for (const field of ['primary','secondary','procedures','service','age']) delete state[field];
    const revision = row.revision + 1;
    const saveHistory = db.prepare('INSERT OR IGNORE INTO history(episode,revision,state) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM history WHERE episode=? AND revision=?)');
    saveHistory.run(row.id,row.revision,row.state,row.id,row.revision);
    db.prepare('UPDATE episodes SET state=?,revision=? WHERE id=?').run(JSON.stringify(state),revision,row.id);
  };
  return {
    close: () => db.close(),
    list: () => listEpisodes.all().map(summary),
    documentExists: (id, index) => {
      const row = idPattern.test(id) ? findEpisode.get(id) : undefined;
      return Boolean(row && activeDocs(row).some(doc => doc.index === index));
    },
    listTrash: () => [
      ...db.prepare('SELECT e.id,e.title,t.removed_at FROM episode_trash t JOIN episodes e ON e.id=t.id ORDER BY t.removed_at DESC,t.rowid DESC').all(),
      ...db.prepare('SELECT e.id,e.title,e.payload,t.document,t.removed_at FROM attachment_trash t JOIN episodes e ON e.id=t.id WHERE NOT EXISTS (SELECT 1 FROM episode_trash p WHERE p.id=t.id) ORDER BY t.removed_at DESC').all()
        .map(({payload, ...entry}) => ({...entry, name:JSON.parse(payload).find(doc => doc.index === entry.document)?.name})),
    ],
    trash: id => transaction(() => {
      const ids = id ? [getEpisode(id).id] : listEpisodes.all().map(row=>row.id);
      for (const entry of ids) {addTrash.run(entry);bump.run(entry);}
      return {count:ids.length};
    }),
    purgeEpisode: id => transaction(() => {
      const ids = id ? [getEpisode(id).id] : listEpisodes.all().map(row => row.id);
      const delAtt = db.prepare('DELETE FROM attachment_trash WHERE id=?');
      const delTrash = db.prepare('DELETE FROM episode_trash WHERE id=?');
      const delHist = db.prepare('DELETE FROM history WHERE episode=?');
      const delEp = db.prepare('DELETE FROM episodes WHERE id=?');
      for (const entry of ids) {
        delAtt.run(entry);
        delTrash.run(entry);
        delHist.run(entry);
        delEp.run(entry);
      }
      return { count: ids.length, removedDirs: ids, removedFiles: [] };
    }),
    restore: id => transaction(() => {
      if (!idPattern.test(id) || !db.prepare('DELETE FROM episode_trash WHERE id=?').run(id).changes)
        throw new HttpError(404,'Berkas tidak ditemukan di Sampah.');
      bump.run(id);
      return {id};
    }),
    purgeTrash: id => transaction(() => {
      const delAtt = db.prepare('DELETE FROM attachment_trash WHERE id=?');
      const delTrash = db.prepare('DELETE FROM episode_trash WHERE id=?');
      const delHist = db.prepare('DELETE FROM history WHERE episode=?');
      const delEp = db.prepare('DELETE FROM episodes WHERE id=?');
      if (id !== undefined) {
        if (!idPattern.test(id) || !db.prepare('SELECT 1 FROM episode_trash WHERE id=?').get(id))
          throw new HttpError(404, 'Berkas tidak ditemukan di Sampah.');
        delTrash.run(id);
        delAtt.run(id);
        delHist.run(id);
        delEp.run(id);
        return { count: 1, removedDirs: [id], removedFiles: [] };
      }
      const removedDirs = db.prepare('SELECT id FROM episode_trash').all().map(row => row.id);
      for (const entry of removedDirs) {
        delTrash.run(entry);
        delAtt.run(entry);
        delHist.run(entry);
        delEp.run(entry);
      }
      const attRows = db.prepare('SELECT id, document FROM attachment_trash').all();
      const grouped = new Map();
      for (const row of attRows) {
        if (!grouped.has(row.id)) grouped.set(row.id, new Set());
        grouped.get(row.id).add(row.document);
      }
      const removedFiles = [];
      const findRaw = db.prepare('SELECT payload FROM episodes WHERE id=?');
      const updPayload = db.prepare('UPDATE episodes SET payload=? WHERE id=?');
      for (const [epId, docSet] of grouped) {
        const ep = findRaw.get(epId);
        delAtt.run(epId);
        if (!ep) continue;
        const remaining = JSON.parse(ep.payload).filter(doc => !docSet.has(doc.index));
        if (!remaining.length) {
          delTrash.run(epId);
          delHist.run(epId);
          delEp.run(epId);
          removedDirs.push(epId);
        } else {
          updPayload.run(JSON.stringify(remaining), epId);
          for (const docIdx of docSet) removedFiles.push({ id: epId, document: docIdx });
        }
      }
      return { count: removedDirs.length + removedFiles.length, removedDirs, removedFiles };
    }),
    purgeTrashDocument: (id, index) => transaction(() => {
      if (!idPattern.test(id) || !Number.isSafeInteger(index) ||
          !db.prepare('DELETE FROM attachment_trash WHERE id=? AND document=?').run(id, index).changes)
        throw new HttpError(404, 'Lampiran tidak ditemukan di Sampah.');
      const ep = db.prepare('SELECT payload FROM episodes WHERE id=?').get(id);
      if (!ep) return { count: 1, removedDirs: [], removedFiles: [{ id, document: index }] };
      const remaining = JSON.parse(ep.payload).filter(doc => doc.index !== index);
      if (!remaining.length) {
        db.prepare('DELETE FROM attachment_trash WHERE id=?').run(id);
        db.prepare('DELETE FROM episode_trash WHERE id=?').run(id);
        db.prepare('DELETE FROM history WHERE episode=?').run(id);
        db.prepare('DELETE FROM episodes WHERE id=?').run(id);
        return { count: 1, removedDirs: [id], removedFiles: [] };
      }
      db.prepare('UPDATE episodes SET payload=? WHERE id=?').run(JSON.stringify(remaining), id);
      return { count: 1, removedDirs: [], removedFiles: [{ id, document: index }] };
    }),
    trashDocument: (id, index) => transaction(() => {
      const row = getEpisode(id);
      const docs = activeDocs(row);
      if (!docs.some(doc => doc.index === index)) throw new HttpError(404,'Lampiran tidak ditemukan.');
      if (docs.length === 1) {
        addTrash.run(id);
        bump.run(id);
        return {episodeRemoved:true};
      }
      db.prepare('INSERT INTO attachment_trash(id,document) VALUES(?,?)').run(id,index);
      resetReview(row);
      return {episodeRemoved:false};
    }),
    restoreDocument: (id, index) => transaction(() => {
      const row = getEpisode(id);
      if (!db.prepare('DELETE FROM attachment_trash WHERE id=? AND document=?').run(id,index).changes)
        throw new HttpError(404,'Lampiran tidak ditemukan di Sampah.');
      resetReview(row);
      return {id};
    }),
    create: ({id,title,docs,state}) => db.prepare('INSERT INTO episodes(id,title,payload,state) VALUES(?,?,?,?)')
      .run(id, title, JSON.stringify(docs), JSON.stringify(state)),
    get: id => {
      const row = getEpisode(id);
      return {id:row.id,title:row.title,docs:activeDocs(row),state:JSON.parse(row.state),revision:row.revision};
    },
    review: (id, body) => transaction(() => {
      const row = getEpisode(id);
      if (Number.isSafeInteger(body?.revision) && row.revision !== body.revision)
        throw new HttpError(409, 'Episode berubah di jendela lain. Muat ulang sebelum menyimpan.');
      validateReview(body, JSON.parse(row.state));
      validateMarkedPages(body.state,activeDocs(row));
      const state = JSON.stringify(body.state);
      const revision = row.revision + 1;
      db.prepare('UPDATE episodes SET state=?, revision=? WHERE id=?').run(state,revision,id);
      db.prepare('INSERT INTO history(episode,revision,state) VALUES(?,?,?)').run(id,revision,state);
      return {revision};
    }),
    listMinutes: () => db.prepare('SELECT id,number,created_at,snapshot FROM minutes ORDER BY rowid DESC').all()
      .map(row => ({id:row.id,number:row.number,createdAt:row.created_at,date:JSON.parse(row.snapshot).date})),
    getMinutes: id => {
      const row = db.prepare('SELECT snapshot FROM minutes WHERE id=?').get(id);
      if (!row) throw new HttpError(404, 'Berita acara tidak ditemukan.');
      return JSON.parse(row.snapshot);
    },
    createMinutes: body => {
      if (!isRecord(body)) invalid('Isian berita acara tidak valid.');
      const fields = {number:100,issuer:180,location:120,date:10,start:10,end:10,verifier:120,representative:120};
      const meta = Object.fromEntries(Object.entries(fields).map(([name,limit])=>[name,cleanText(body,name,limit)]));
      const selected = body.episodes;
      if (!Array.isArray(selected) || !selected.length || selected.length > 2000 || selected.some(item =>
        !isRecord(item) || typeof item.id !== 'string' || !idPattern.test(item.id) || !Number.isSafeInteger(item.revision))
        || Object.values(meta).some(value=>!value) || !['date','start','end'].every(key=>validDate(meta[key])) || meta.start > meta.end)
        invalid('Lengkapi identitas, periode, penanda tangan, dan pilih episode yang sudah diputuskan.');
      const revisions = new Map(selected.map(item=>[item.id,item.revision]));
      if (revisions.size !== selected.length) invalid('Satu episode hanya dapat dipilih sekali.');
      return transaction(() => {
        const rows = listEpisodes.all().filter(row=>revisions.has(row.id)).map(summary);
        if (rows.length !== revisions.size || rows.some(item=>item.scope !== 'episode' || !item.decision || item.revision !== revisions.get(item.id)))
          throw new HttpError(409, 'Hasil verifikasi berubah. Muat ulang rekap sebelum menyimpan berita acara.');
        if (rows.some(item=>!validDate(item.meta.serviceDate) || item.meta.serviceDate < meta.start || item.meta.serviceDate > meta.end))
          invalid('Semua episode yang dipilih harus memiliki tanggal pelayanan dalam periode berita acara.');
        if (db.prepare('SELECT 1 FROM minutes WHERE number=?').get(meta.number))
          throw new HttpError(409, 'Nomor berita acara sudah pernah digunakan.');
        const report = {...meta,id:makeId(),rows};
        db.prepare('INSERT INTO minutes(id,number,snapshot) VALUES(?,?,?)').run(report.id,report.number,JSON.stringify(report));
        return report;
      });
    },
  };
}
