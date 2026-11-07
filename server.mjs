import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
let STORAGE, DATA, HOST, CLOUD_MODE;
const MAX_INPUT = 60 * 1024 * 1024;
const MAX_ROBLOX = 20 * 1024 * 1024;
const MAX_DURATION = 420;
const KEEP_MS = 24 * 60 * 60 * 1000;

async function loadEnv() {
  const text = await fs.readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let val = match[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[match[1]] = val;
  }
}
await loadEnv();
const STORAGE_ROOT = path.resolve(process.env.DATA_DIR || ROOT);
STORAGE = path.join(STORAGE_ROOT, 'storage');
DATA = path.join(STORAGE_ROOT, 'data', 'jobs.json');
HOST = process.env.HOST || '127.0.0.1';
CLOUD_MODE = !['127.0.0.1','localhost','::1'].includes(HOST);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
if (CLOUD_MODE && APP_PASSWORD.length < 12) {
  throw new Error('Untuk hosting publik, set APP_PASSWORD minimal 12 karakter sebelum server dijalankan.');
}
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_AGE = 24 * 60 * 60 * 1000;
function isLoggedIn(req) {
  if (!CLOUD_MODE) return true;
  const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('mono_session='))?.slice(13);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {sessions.delete(token);return false;}
  return true;
}
function equalSecret(input, correct) {
  const a=crypto.createHash('sha256').update(input).digest();
  const b=crypto.createHash('sha256').update(correct).digest();
  return crypto.timingSafeEqual(a,b);
}
async function readLoginBody(req) {
  const chunks=[];let size=0;
  for await(const c of req){ size+=c.length;if(size>2048) fail('Request terlalu besar.',413);chunks.push(c); }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Format JSON salah.');}
}
const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('PORT harus antara 1024 dan 65535.');
await fs.mkdir(STORAGE, { recursive: true });
await fs.mkdir(path.dirname(DATA), { recursive: true });
const API_KEY = process.env.ROBLOX_API_KEY?.trim() || '';
const CREATOR_ID = process.env.ROBLOX_CREATOR_ID?.trim() || '';
const CREATOR_TYPE = process.env.ROBLOX_CREATOR_TYPE?.trim().toLowerCase() || 'user';
const configured = Boolean(API_KEY && API_KEY !== 'YOUR_OPEN_CLOUD_API_KEY' && /^\d+$/.test(CREATOR_ID) && ['user', 'group'].includes(CREATOR_TYPE));
const tools = Object.fromEntries(['ffmpeg','ffprobe','yt-dlp'].map(name => {
  const r = spawnSync(name, ['-version'], { timeout: 2500, stdio: 'ignore' });
  return [name, !r.error && r.status === 0];
}));
let jobs = await fs.readFile(DATA, 'utf8').then(JSON.parse).catch(() => []);
if (!Array.isArray(jobs)) jobs = [];
for (const job of jobs) {
  if (['processing','uploading'].includes(job.state)) {
    job.state = 'error';
    job.message = job.type === 'upload' ? 'Proses terputus saat server restart. Periksa Creator Dashboard sebelum mengulang upload.' : 'Konversi terputus saat server restart. Silakan ulangi.';
  }
}
let writing = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(jobs.map(({checking, ...job}) => job), null, 2);
  writing = writing.catch(() => {}).then(async () => {
    const temp = `${DATA}.${process.pid}.tmp`;
    await fs.writeFile(temp, snapshot);
    await fs.rename(temp, DATA);
  });
  return writing;
}
await save();
function cleanJob(j) {
  const { id, type, title, state, createdAt, updatedAt, message, assetId, duration, size, format, operation, sourceJobId } = j;
  return { id, type, title, state, createdAt, updatedAt, message, assetId, duration, size, format, operation, sourceJobId, downloadable: type === 'convert' && state === 'ready' && Boolean(j.filename && existsSync(path.join(STORAGE, j.filename))) };
}
function reply(res, status, data) {
  const content = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(content), 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(content);
}
function fail(message, status=400) { const e = new Error(message); e.status = status; throw e; }
function titleSafe(s) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80); }
function update(job, state, message, extra={}) { Object.assign(job, extra, { state, message, updatedAt: new Date().toISOString() }); void save(); }
function createJob(type, title, state, message) {
  const job = { id: crypto.randomUUID(), type, title, state, message, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  jobs.unshift(job);
  jobs = jobs.slice(0, 150);
  void save();
  return job;
}
function requiredRights(fd) { if (fd.get('rights') !== 'true') fail('Konfirmasi bahwa Anda memiliki hak menggunakan audio ini.'); }
function acceptedUrl(value) {
  let u; try { u = new URL(value); } catch { fail('URL YouTube atau SoundCloud tidak valid.'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !(
    h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' ||
    h === 'soundcloud.com' || h.endsWith('.soundcloud.com')
  )) fail('Hanya URL HTTPS YouTube atau SoundCloud yang didukung.');
  return u.href;
}
async function readForm(req) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_INPUT + 1024 * 1024) fail('Ukuran upload terlalu besar (maks. 60 MB).', 413);
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_INPUT + 1024 * 1024) fail('Ukuran upload terlalu besar (maks. 60 MB).', 413);
    chunks.push(chunk);
  }
  const request = new Request(`http://${HOST}:${PORT}/`, { method:'POST', headers: {'content-type':req.headers['content-type'] || ''}, body: Buffer.concat(chunks) });
  try { return await request.formData(); } catch { fail('Form upload tidak terbaca.'); }
}
async function exec(name, args, { cwd=ROOT, timeout=180000 } = {}) {
  return new Promise((resolve,reject) => {
    const proc = spawn(name, args, { cwd, shell:false, windowsHide:true, stdio:['ignore','pipe','pipe'] });
    let stdout='', stderr='';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`${name} melewati batas waktu.`)); }, timeout);
    proc.stdout.on('data', d => { if (stdout.length < 15000) stdout += d.toString(); });
    proc.stderr.on('data', d => { if (stderr.length < 15000) stderr += d.toString(); });
    proc.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`${name} belum terinstal atau tidak ditemukan di PATH.`) : e); });
    proc.on('close', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(`${name} gagal: ${stderr.trim().slice(-380) || `exit ${code}`}`)); });
  });
}
async function probe(filepath) {
  const raw = await exec('ffprobe', ['-v','error','-show_entries','format=duration:stream=codec_type,sample_rate,channels','-of','json',filepath], { timeout:20000 });
  let info; try { info=JSON.parse(raw); } catch { fail('Metadata audio gagal dibaca.'); }
  const stream=info.streams?.find(s => s.codec_type==='audio');
  const duration=Number(info.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) fail('File tidak memiliki audio valid.');
  return { duration, channels: Number(stream.channels || 0), sampleRate:Number(stream.sample_rate || 0) };
}
async function saveInput(file, dir, allow) {
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_INPUT) fail('Pilih file audio yang valid (maks. 60 MB).');
  const ext=path.extname(file.name).toLowerCase();
  if (!allow.includes(ext)) fail(`Format ${ext || 'file'} tidak didukung.`);
  const filepath=path.join(dir, `input${ext}`);
  await fs.writeFile(filepath, Buffer.from(await file.arrayBuffer()));
  return filepath;
}
const inputFormats=['.mp3','.ogg','.wav','.flac','.m4a','.aac','.webm','.opus'];
const uploadFormats=['.mp3','.ogg','.wav','.flac'];
const contentTypes={'.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.flac':'audio/flac'};
let activeConversions=0, activeUploads=0;

async function processConvert(job, fd) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'monoaudio-'));
  let outFile;
  try {
    update(job,'processing','Mengambil sumber dan memproses audio...');
    const incoming=fd.get('audio');
    let source;
    if (incoming instanceof File && incoming.size) {
      source = await saveInput(incoming, dir, inputFormats);
    } else {
      if (!tools['yt-dlp']) throw new Error('yt-dlp belum terinstal. Instal agar URL YouTube/SoundCloud dapat diproses.');
      await exec('yt-dlp', [
        '--no-playlist','--no-progress','--no-warnings','--no-part',
        '--max-filesize','60M','--socket-timeout','15','--retries','2',
        '--match-filter','duration <= 420',
        '-f','bestaudio/best','-o','input.%(ext)s', '--', job.url
      ],{cwd:dir,timeout:155000});
      const names=await fs.readdir(dir);
      const candidate=names.find(n => /^input\.[a-z0-9]+$/i.test(n));
      if (!candidate) throw new Error('Audio tidak berhasil diunduh dari sumber.');
      source=path.join(dir,candidate);
    }
    const stats=await fs.stat(source);
    if (stats.size > MAX_INPUT) throw new Error('Sumber audio melebihi 60 MB.');
    const info=await probe(source);
    if (info.duration / job.speed > MAX_DURATION + 0.5) throw new Error('Durasi audio setelah konversi maksimal 7 menit untuk Roblox.');
    outFile=path.join(STORAGE, `${job.id}.${job.format}`);
    const args=['-y','-hide_banner','-loglevel','error','-i',source,'-map','0:a:0','-vn','-af',`atempo=${job.speed},volume=${job.gain}dB`,'-ar','44100','-ac','2'];
    if (job.format === 'ogg') args.push('-c:a','libvorbis','-q:a','5');
    else if (job.format === 'wav') args.push('-c:a','pcm_s16le');
    else args.push('-c:a','libmp3lame','-b:a','192k');
    args.push(outFile);
    await exec('ffmpeg',args,{timeout:110000});
    const outputInfo=await probe(outFile);
    const {size}=await fs.stat(outFile);
    if (size > MAX_INPUT) throw new Error('Hasil audio melebihi 60 MB. Gunakan MP3/OGG.');
    update(job,'ready','Audio siap diunduh atau dikirim ke Roblox.', {filename:path.basename(outFile),size,duration:Math.round(outputInfo.duration),url:undefined});
  } catch (e) {
    if (outFile) await fs.rm(outFile,{force:true}).catch(()=>{});
    update(job,'error',e.message);
  } finally { activeConversions--; await fs.rm(dir,{recursive:true,force:true}).catch(()=>{}); }
}
function mapModeration(obj) {
  const raw=String(obj?.moderationResult?.moderationState || '').toUpperCase();
  if (raw.includes('REJECT')) return 'rejected';
  if (raw.includes('APPROV')) return 'approved';
  return 'pending';
}
async function apiRoblox(url, options={}) {
  const res=await fetch(url,{...options,headers:{'x-api-key': API_KEY,...options.headers},signal:AbortSignal.timeout(45000)});
  const text=await res.text();
  let data; try { data=JSON.parse(text); } catch { data={message:text.slice(0,250)}; }
  if (!res.ok) throw new Error(`Roblox HTTP ${res.status}: ${data.message || data.error?.message || 'Permintaan gagal.'}`);
  return data;
}
function getAssetId(obj) { const raw=String(obj?.assetId || obj?.path?.match(/^assets\/(\d+)$/)?.[1] || ''); return /^\d+$/.test(raw) ? raw : null; }
async function refreshStatus(job, force=false) {
  if (job.type !== 'upload' || !['pending','approved','rejected'].includes(job.state)) return;
  if (!force && Date.now() - (job.lastChecked || 0) < 18000) return;
  if (job.checking) return;
  job.checking=true;
  job.lastChecked=Date.now();
  try {
    if (!job.assetId && job.operation) {
      const opId=job.operation.replace(/^operations\//,'');
      if (!/^[a-zA-Z0-9_-]+$/.test(opId)) throw new Error('Operation ID Roblox tidak valid.');
      const result=await apiRoblox(`https://apis.roblox.com/assets/v1/operations/${opId}`);
      if (result.error) { update(job,'error',result.error.message || 'Roblox menolak proses upload.'); return; }
      if (!result.done) { update(job,'pending','Roblox sedang memproses upload.'); return; }
      const assetId=getAssetId(result.response);
      if (!assetId) { update(job,'error','Roblox tidak mengembalikan Asset ID.'); return; }
      job.assetId=assetId;
      const status=mapModeration(result.response);
      if (status !== 'pending') { update(job,status,status==='approved'?'Audio telah disetujui Roblox.':'Audio ditolak moderasi Roblox.'); return; }
    }
    if (job.assetId) {
      const asset=await apiRoblox(`https://apis.roblox.com/assets/v1/assets/${job.assetId}`);
      const status=mapModeration(asset);
      update(job,status,status==='approved'?'Audio telah disetujui Roblox.':status==='rejected'?'Audio ditolak moderasi Roblox.':'Menunggu keputusan moderasi Roblox.');
    }
  } catch(e) {
    job.message=`Cek status gagal sementara: ${e.message}`;
    job.updatedAt=new Date().toISOString(); void save();
  } finally { delete job.checking; }
}
async function processUpload(job, filepath, originalFilename) {
  try {
    const contentType=contentTypes[path.extname(originalFilename).toLowerCase()];
    const info=await probe(filepath);
    const size=(await fs.stat(filepath)).size;
    if (size >= MAX_ROBLOX) throw new Error('File harus kurang dari 20 MB untuk Roblox.');
    if (info.duration > MAX_DURATION) throw new Error('Audio lebih dari 7 menit.');
    if (info.sampleRate > 48000) throw new Error('Sample rate melebihi 48 kHz. Konversi dulu sebelum upload.');
    if (![1,2,3,6].includes(info.channels)) throw new Error('Jumlah channel tidak didukung Roblox.');
    const body=new FormData();
    const creator={ [CREATOR_TYPE === 'group' ? 'groupId':'userId']: CREATOR_ID };
    body.append('request',JSON.stringify({assetType:'Audio',displayName:job.title,description:job.description,creationContext:{creator}}));
    body.append('fileContent',new Blob([await fs.readFile(filepath)],{type:contentType}),`audio${path.extname(originalFilename).toLowerCase()}`);
    const data=await apiRoblox('https://apis.roblox.com/assets/v1/assets',{method:'POST',body});
    const operation=String(data.path || '');
    const assetId=getAssetId(data.response);
    if (!/^operations\/[A-Za-z0-9_-]+$/.test(operation) && !assetId) throw new Error('Respons Roblox tidak berisi operation ID.');
    update(job,'pending','Diterima Roblox; menunggu proses dan moderasi.',{operation,assetId:assetId||undefined});
    void refreshStatus(job,true);
  } catch(e) { update(job,'error',e.message); }
  finally {activeUploads--; if (filepath.startsWith(os.tmpdir())) await fs.rm(path.dirname(filepath),{recursive:true,force:true}).catch(()=>{});}
}
async function cleanOld() {
  const cutoff=Date.now()-KEEP_MS;
  for (const j of jobs) if (j.type==='convert' && j.filename && new Date(j.createdAt).getTime() < cutoff) {
    await fs.rm(path.join(STORAGE,j.filename),{force:true}).catch(()=>{});
    delete j.filename;
    if (j.state==='ready') {j.state='expired';j.message='File hasil konversi sudah kedaluwarsa setelah 24 jam.';}
  }
  void save();
}
await cleanOld();
setInterval(()=>void cleanOld(),60*60*1000).unref();
setInterval(()=>{const now=Date.now();for(const [key,expiry] of sessions)if(expiry<now)sessions.delete(key);for(const [key,value] of loginAttempts)if(value.until<now)loginAttempts.delete(key);},60*60*1000).unref();
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
async function serveStatic(res, pathname) {
  const file=path.join(PUBLIC, pathname === '/' ? 'index.html':pathname);
  if (!file.startsWith(PUBLIC + path.sep)) return reply(res,403,{error:'Forbidden'});
  try {
    const data=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':data.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(data);
  } catch { reply(res,404,{error:'Halaman tidak ditemukan.'}); }
}
const server=http.createServer(async(req,res)=>{
  try {
    const host = req.headers.host || '';
    if ((!CLOUD_MODE && ![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(host)) ||
        (CLOUD_MODE && !/^[a-z0-9.-]+(?::\d+)?$/i.test(host))) return reply(res,403,{error:'Host tidak diizinkan.'});
    const origin=req.headers.origin;
    if (origin) {
      let same=false;
      try {const u=new URL(origin);same=u.host===host && ['http:','https:'].includes(u.protocol);}catch{}
      if(!same) return reply(res,403,{error:'Origin tidak diizinkan.'});
    }
    const {pathname}=new URL(req.url,`http://${HOST}:${PORT}`);
    if(req.method==='GET'&&pathname==='/healthz') return reply(res,200,{ok:true});
    if (CLOUD_MODE && req.method==='POST' && pathname==='/api/login') {
      const ip=req.socket.remoteAddress || 'unknown';
      const now=Date.now();
      const attempt=loginAttempts.get(ip) || {count:0,until:now+10*60*1000};
      if (now>attempt.until) {attempt.count=0;attempt.until=now+10*60*1000;}
      if (attempt.count>=8) return reply(res,429,{error:'Terlalu banyak percobaan login. Coba lagi nanti.'});
      const body=await readLoginBody(req);
      if (typeof body.password!=='string' || !equalSecret(body.password,APP_PASSWORD)) {
        attempt.count++;loginAttempts.set(ip,attempt);
        return reply(res,401,{error:'Password salah.'});
      }
      loginAttempts.delete(ip);
      const token=crypto.randomBytes(32).toString('hex');
      sessions.set(token,now+SESSION_AGE);
      res.setHeader('Set-Cookie',`mono_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`);
      return reply(res,200,{ok:true});
    }
    if(CLOUD_MODE && !isLoggedIn(req)) {
      if (req.method==='GET' && ['/', '/login', '/login.html','/login.css','/login.js','/favicon.svg'].includes(pathname))
        return serveStatic(res,pathname==='/' || pathname==='/login' ? '/login.html' : pathname);
      if (pathname.startsWith('/api/')) return reply(res,401,{error:'Silakan login terlebih dahulu.'});
      res.writeHead(302,{'Location':'/'});return res.end();
    }
    if(req.method==='POST'&&pathname==='/api/logout') {
      const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('mono_session='))?.slice(13);
      if(token) sessions.delete(token);
      res.setHeader('Set-Cookie','mono_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
      return reply(res,200,{ok:true});
    }
    if(req.method==='GET'&&pathname==='/api/config') return reply(res,200,{robloxConfigured:configured,creatorType:configured?CREATOR_TYPE:null,creatorId:configured?CREATOR_ID:null,tools});
    if(req.method==='GET'&&pathname==='/api/jobs') {
      void Promise.allSettled(jobs.filter(j=>j.type==='upload'&&j.state==='pending').slice(0,8).map(j=>refreshStatus(j)));
      return reply(res,200,{jobs:jobs.map(cleanJob)});
    }
    const refreshMatch=pathname.match(/^\/api\/jobs\/([a-f\d-]+)\/refresh$/);
    if(req.method==='POST'&&refreshMatch) {
      const job=jobs.find(j=>j.id===refreshMatch[1]);
      if(!job) return reply(res,404,{error:'Job tidak ditemukan.'});
      await refreshStatus(job,true);
      return reply(res,200,{job:cleanJob(job)});
    }
    const downloadMatch=pathname.match(/^\/api\/jobs\/([a-f\d-]+)\/download$/);
    if(req.method==='GET'&&downloadMatch) {
      const j=jobs.find(x=>x.id===downloadMatch[1]);
      if(!j||j.type!=='convert'||j.state!=='ready'||!j.filename) return reply(res,404,{error:'File tidak tersedia.'});
      const file=path.join(STORAGE,j.filename);
      const st=await fs.stat(file).catch(()=>null);
      if (!st) return reply(res,404,{error:'File telah kedaluwarsa.'});
      const safe=(j.title.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,48)||'audio').replace(/[\\"\r\n]/g,'');
      res.writeHead(200,{'Content-Type':contentTypes['.'+j.format]||'application/octet-stream','Content-Length':st.size,'Content-Disposition':`attachment; filename="${safe.replace(/[^\x20-\x7e]/g,'_')}.${j.format}"`,'X-Content-Type-Options':'nosniff'});
      createReadStream(file).pipe(res); return;
    }
    if(req.method==='POST'&&pathname==='/api/convert') {
      if(!tools.ffmpeg||!tools.ffprobe) return reply(res,503,{error:'FFmpeg dan FFprobe perlu diinstal terlebih dahulu.'});
      if(activeConversions>=2) return reply(res,429,{error:'Maksimal 2 konversi bersamaan.'});
      const fd=await readForm(req); requiredRights(fd);
      const file=fd.get('audio');
      const url=String(fd.get('url')||'').trim();
      if(!(file instanceof File && file.size) && !url) fail('Masukkan URL atau pilih file audio.');
      const format=String(fd.get('format')||'mp3');
      const speed=Number(fd.get('speed')||1), gain=Number(fd.get('gain')||0);
      if(!['mp3','ogg','wav'].includes(format)||!Number.isFinite(speed)||speed<0.75||speed>1.5||!Number.isFinite(gain)||gain< -6||gain>12) fail('Pengaturan konversi tidak valid.');
      if(!file || !(file instanceof File) || !file.size) acceptedUrl(url);
      const title=titleSafe(fd.get('title'))|| (file instanceof File && file.size ? path.parse(file.name).name.slice(0,80) : 'Audio Conversion');
      const j=createJob('convert',title,'processing','Menyiapkan proses...');
      j.url=(file instanceof File && file.size)? undefined:acceptedUrl(url);
      j.speed=speed;j.gain=gain;j.format=format;
      activeConversions++;
      void processConvert(j,fd);
      return reply(res,202,{job:cleanJob(j)});
    }
    if(req.method==='POST'&&pathname==='/api/upload') {
      if(!configured) return reply(res,503,{error:'Isi ROBLOX_API_KEY dan ROBLOX_CREATOR_ID pada .env terlebih dahulu.'});
      if(activeUploads>=2) return reply(res,429,{error:'Maksimal 2 upload bersamaan.'});
      const fd=await readForm(req);requiredRights(fd);
      const title=titleSafe(fd.get('title'));
      if(!title||title.length>60) fail('Nama asset wajib diisi (maks. 60 karakter).');
      const description=String(fd.get('description')||'').trim().slice(0,500);
      const sourceId=String(fd.get('jobId')||'');
      let filepath, originalFilename;
      if(sourceId) {
        const source=jobs.find(j=>j.id===sourceId && j.type==='convert' && j.state==='ready');
        if(!source?.filename || !uploadFormats.includes('.'+source.format)) fail('Hasil konversi tidak tersedia atau format tidak didukung Roblox.');
        filepath=path.join(STORAGE,source.filename);originalFilename=source.filename;
      } else {
        const input=fd.get('audio');
        if(!(input instanceof File)||!input.size) fail('Pilih file atau hasil konversi dahulu.');
        if(input.size>=MAX_ROBLOX) fail('File untuk Roblox harus kurang dari 20 MB.');
        const dir=await fs.mkdtemp(path.join(os.tmpdir(),'monoupload-'));
        try { filepath=await saveInput(input,dir,uploadFormats); originalFilename=input.name; }
        catch(e) {await fs.rm(dir,{recursive:true,force:true});throw e;}
      }
      const j=createJob('upload',title,'uploading','Mengirim audio ke Roblox...');
      j.description=description;j.sourceJobId=sourceId||undefined;
      activeUploads++; void processUpload(j,filepath,originalFilename);
      return reply(res,202,{job:cleanJob(j)});
    }
    if(req.method==='GET'&&!pathname.startsWith('/api/')) return serveStatic(res,pathname);
    reply(res,404,{error:'Endpoint tidak ditemukan.'});
  } catch(e) { console.error('[Request error]',e.message); reply(res,e.status||500,{error:e.status?e.message:'Terjadi kesalahan server: '+e.message}); }
});
server.listen(PORT,HOST,()=>console.log(`\nMono Audio Studio: http://${HOST}:${PORT} | Public login: ${CLOUD_MODE?'ON':'local only'}\nFFmpeg: ${tools.ffmpeg?'OK':'missing'} | yt-dlp: ${tools['yt-dlp']?'OK':'missing'} | Roblox API: ${configured?'configured':'not configured'}\n`));
