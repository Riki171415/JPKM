import { createServer } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { openPdf, createOcr, inspectPdf, pagePreview } from './pdf.js';
import { openStore, HttpError, makeId } from './store.js';
import { claimFromPages, claimMeta } from '../static/claimInfo.js';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const dist = join(root, 'dist');
const uploadLimit = 100 * 1024 * 1024;
const maxPages = 150;
const secureHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; frame-ancestors 'none'; img-src 'self' blob:",
};
const mediaTypes = { js:'text/javascript; charset=utf-8', css:'text/css; charset=utf-8', json:'application/json', svg:'image/svg+xml', png:'image/png', woff2:'font/woff2' };
const response = (body, status=200, type='text/plain; charset=utf-8') => new Response(body,{status,headers:{...secureHeaders,'Content-Type':type}});
const json = (body,status=200) => response(JSON.stringify(body),status,'application/json; charset=utf-8');

async function limitedBody(req,max) {
  if (Number(req.headers.get('content-length')) > max) throw new HttpError(413,'Ukuran permintaan melebihi batas.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req.body || []) {
    size += chunk.length;
    if (size > max) throw new HttpError(413,'Ukuran permintaan melebihi batas.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}

async function requestJson(req) {
  const body = await limitedBody(req, 1_000_000);
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new HttpError(400,'Isian JSON tidak valid.'); }
}

export async function createApplication({
  dataDir = process.env.SIJANTAN_DATA || join(process.env.LOCALAPPDATA || root,'SiJantanVerifikasi'),
  port = Number(process.env.SIJANTAN_PORT || 8766),
} = {}) {
  dataDir = resolve(dataDir);
  await mkdir(dataDir,{recursive:true});
  const store = openStore(dataDir);
  let importing = false;
  const previews = new Map();
  const rendering = new Map();
  let previewBytes = 0;
  const allowedHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);

  async function upload(req) {
    if (importing) throw new HttpError(409,'Satu impor sedang berjalan. Coba lagi setelah selesai.');
    importing = true;
    const docs = [];
    const ocr = createOcr();
    try {
      const contentType = req.headers.get('content-type') || '';
      if (!/^multipart\/form-data\b/i.test(contentType)) throw new HttpError(400,'Gunakan formulir impor PDF.');
      const body = await limitedBody(req,uploadLimit);
      let form;
      try { form = await new Response(body,{headers:{'Content-Type':contentType}}).formData(); }
      catch { throw new HttpError(400,'Formulir impor belum terbaca.'); }
      const files = form.getAll('pdf');
      if (!files.length || files.length > 12 || files.some(file=>typeof file === 'string'))
        throw new HttpError(400,'Pilih 1 sampai 12 PDF untuk satu episode atau paket pengajuan.');
      let total = 0;
      for (const file of files) {
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.subarray(0,5).toString() !== '%PDF-') throw new HttpError(400,'Salah satu berkas bukan PDF yang dapat dibaca.');
        const doc = await openPdf(bytes).catch(()=>null);
        if (!doc) throw new HttpError(400,'Salah satu PDF rusak atau terkunci.');
        docs.push({doc,bytes,name:basename((file.name || 'Berkas.pdf').replaceAll('\\','/'))});
        total += doc.numPages;
        if (!doc.numPages || total > maxPages) throw new HttpError(400,'Maksimal 150 halaman per episode.');
      }
      const prepared = [];
      for (const [index,item] of docs.entries()) prepared.push({index,name:item.name,...await inspectPdf(item.doc,ocr)});
      const id = makeId();
      const target = join(dataDir,id);
      const titleInput = form.get('title');
      const title = ((typeof titleInput === 'string' && titleInput.trim()) || docs[0].name.replace(/\.pdf$/i,'')).slice(0,160);
      const isPackage = form.get('scope') === 'package';
      const meta = isPackage ? {} : claimMeta(claimFromPages(prepared.flatMap(doc => doc.pages.map(page => ({ ...page, file: doc.index })))));
      const state = { ...(isPackage ? { scope: 'package' } : {}), ...(Object.keys(meta).length ? { meta } : {}) };
      await mkdir(target);
      try {
        for (const [index,item] of docs.entries()) await writeFile(join(target,index + '.pdf'),item.bytes);
        store.create({id,title,docs:prepared,state});
      } catch (error) {
        await rm(target,{recursive:true,force:true});
        throw error;
      }
      return json({id},201);
    } finally {
      try { await Promise.allSettled([ocr.close(), ...docs.map(item=>item.doc.destroy())]); }
      finally { importing = false; }
    }
  }

  async function preview(id,document,number,fit,rot = 0) {
    const index = Number(document);
    const page = Number(number);
    const rotation = [0, 90, 180, 270].includes(Number(rot)) ? Number(rot) : 0;
    if (index >= 12 || page < 1 || page > maxPages) throw new HttpError(404,'Halaman tidak ditemukan.');
    if (!store.documentExists(id,index)) throw new HttpError(404,'Lampiran tidak ditemukan.');
    const filename = join(dataDir,id,index + '.pdf');
    const source = await stat(filename).catch(()=>null);
    if (!source?.isFile()) throw new HttpError(404,'PDF sumber tidak ditemukan.');
    const key = [filename,source.mtimeMs,source.size,page,fit,rotation].join('|');
    const type = fit ? 'image/webp' : 'image/png';
    const cached = previews.get(key);
    if (cached) {
      previews.delete(key);
      previews.set(key,cached);
      return response(cached,200,type);
    }
    if (!rendering.has(key)) rendering.set(key,(async () => {
      const doc = await openPdf(filename);
      try {
        if (page > doc.numPages) throw new HttpError(404,'Halaman tidak ditemukan.');
        const bytes = await pagePreview(doc,page,fit,rotation);
        if (bytes.length <= 32 * 1024 * 1024) {
          previews.set(key,bytes);
          previewBytes += bytes.length;
          while (previews.size > 80 || previewBytes > 32 * 1024 * 1024) {
            const [oldest,image] = previews.entries().next().value;
            previewBytes -= image.length;
            previews.delete(oldest);
          }
        }
        return bytes;
      } finally { await doc.destroy(); }
    })().finally(()=>rendering.delete(key)));
    return response(await rendering.get(key),200,type);
  }

  async function cleanupFiles({ removedDirs = [], removedFiles = [] }) {
    for (const id of removedDirs) {
      const dirPath = join(dataDir, id);
      const dirPrefix = dirPath + sep;
      for (const [key, image] of [...previews.entries()]) {
        if (key.startsWith(dirPrefix)) {
          previewBytes -= image.length;
          previews.delete(key);
        }
      }
      await rm(dirPath, { recursive: true, force: true });
    }
    for (const { id, document } of removedFiles) {
      const filePath = join(dataDir, id, String(document) + '.pdf');
      const filePrefix = filePath + '|';
      for (const [key, image] of [...previews.entries()]) {
        if (key.startsWith(filePrefix)) {
          previewBytes -= image.length;
          previews.delete(key);
        }
      }
      await rm(filePath, { force: true });
    }
  }

  async function handle(req) {
    try {
      const url = new URL(req.url);
      const host = req.headers.get('host') || url.host;
      if (!allowedHosts.has(host) || (req.method !== 'GET' && req.headers.get('X-Si-Jantan') !== 'local'))
        throw new HttpError(403,'Akses dibatasi ke aplikasi lokal.');
      const path = url.pathname;
      const method = req.method;
      if (path === '/' && method === 'GET') {
        const file = await readFile(join(dist,'index.html')).catch(()=>null);
        return file ? response(file,200,'text/html; charset=utf-8') : response('Jalankan npm run build atau npm run dev terlebih dahulu.',503);
      }
      if (method === 'GET' && /^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) {
        const file = await readFile(join(dist,'assets',basename(path))).catch(()=>null);
        if (file) return response(file,200,mediaTypes[path.split('.').at(-1)] || 'application/octet-stream');
      }
      if (path === '/api/episodes' && method === 'GET') return json(store.list());
      if (path === '/api/episodes' && method === 'POST') return await upload(req);
      if (path === '/api/episodes' && method === 'DELETE') {
        if (importing) throw new HttpError(409,'Tunggu impor PDF selesai sebelum menghapus berkas.');
        if (url.searchParams.get('permanent') === '1') {
          const result = store.purgeEpisode();
          await cleanupFiles(result);
          return json({ count: result.count });
        }
        return json(store.trash());
      }
      if (path === '/api/trash' && method === 'GET') return json(store.listTrash());
      if (path === '/api/trash' && method === 'DELETE') {
        if (importing) throw new HttpError(409,'Tunggu impor PDF selesai sebelum menghapus berkas.');
        const result = store.purgeTrash();
        await cleanupFiles(result);
        return json({ count: result.count });
      }
      const restore = path.match(/^\/api\/trash\/([a-f0-9]{32})(?:\/documents\/(\d+))?\/restore$/);
      if (restore && method === 'POST') return json(restore[2] === undefined
        ? store.restore(restore[1]) : store.restoreDocument(restore[1],Number(restore[2])));
      const purgeDoc = path.match(/^\/api\/trash\/([a-f0-9]{32})\/documents\/(\d+)$/);
      if (purgeDoc && method === 'DELETE') {
        if (importing) throw new HttpError(409,'Tunggu impor PDF selesai sebelum menghapus berkas.');
        const result = store.purgeTrashDocument(purgeDoc[1], Number(purgeDoc[2]));
        await cleanupFiles(result);
        return json({ count: result.count });
      }
      const purgeTrashEp = path.match(/^\/api\/trash\/([a-f0-9]{32})$/);
      if (purgeTrashEp && method === 'DELETE') {
        if (importing) throw new HttpError(409,'Tunggu impor PDF selesai sebelum menghapus berkas.');
        const result = store.purgeTrash(purgeTrashEp[1]);
        await cleanupFiles(result);
        return json({ count: result.count });
      }
      const attachment = path.match(/^\/api\/episodes\/([a-f0-9]{32})\/documents\/(\d+)$/);
      if (attachment && method === 'DELETE') return json(store.trashDocument(attachment[1],Number(attachment[2])));
      if (path === '/api/minutes' && method === 'GET') return json(store.listMinutes());
      if (path === '/api/minutes' && method === 'POST') return json(store.createMinutes(await requestJson(req)),201);
      const minutes = path.match(/^\/api\/minutes\/([a-f0-9]{32})$/);
      if (minutes && method === 'GET') return json(store.getMinutes(minutes[1]));
      const episode = path.match(/^\/api\/episodes\/([a-f0-9]{32})(?:\/(review|pages\/(\d+)\/(\d+)))?$/);
      if (episode) {
        const [,id,action,document,page] = episode;
        if (!action && method === 'GET') return json(store.get(id));
        if (!action && method === 'DELETE') {
          if (importing) throw new HttpError(409,'Tunggu impor PDF selesai sebelum menghapus berkas.');
          if (url.searchParams.get('permanent') === '1') {
            const result = store.purgeEpisode(id);
            await cleanupFiles(result);
            return json({ count: result.count });
          }
          return json(store.trash(id));
        }
        if (action === 'review' && method === 'PUT') return json(store.review(id,await requestJson(req)));
        if (document !== undefined && method === 'GET') return await preview(id,document,page,url.searchParams.get('size') === 'fit',url.searchParams.get('rot'));
      }
      throw new HttpError(404,'Halaman tidak ditemukan.');
    } catch (error) {
      if (error instanceof HttpError) return json({error:error.message},error.status);
      console.error('Kesalahan internal Si Jantan:',error.name,error.code || '');
      return json({error:'Terjadi kesalahan internal. Periksa konsol Si Jantan.'},500);
    }
  }

  const server = createServer(async (req,res) => {
    try {
      const method = req.method;
      const url = new URL(req.url,'http://127.0.0.1:' + port);
      const request = new Request(url,{method,headers:req.headers,
        ...(!['GET','HEAD'].includes(method) ? {body:Readable.toWeb(req),duplex:'half'} : {})});
      const result = await handle(request);
      res.writeHead(result.status,Object.fromEntries(result.headers));
      if (result.body) await pipeline(Readable.fromWeb(result.body),res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(400,secureHeaders);
      res.end();
    }
  });
  server.on('close',()=>store.close());
  return {handle,server,close:()=>store.close()};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SIJANTAN_PORT || 8766);
  const { server } = await createApplication({port});
  server.on('error',error=>{
    console.error(error.code === 'EADDRINUSE' ? 'Port ' + port + ' sudah dipakai. Tutup server lama atau pilih SIJANTAN_PORT lain.' : 'Server tidak dapat berjalan: ' + error.code);
    process.exitCode = 1;
  });
  server.listen(port,'127.0.0.1',()=>console.log('Si Jantan berjalan di http://127.0.0.1:' + port));
}
