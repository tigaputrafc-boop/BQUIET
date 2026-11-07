import { json, appPassword } from '../_lib/auth.js';
const MAX_BYTES = 20 * 1024 * 1024;
const extMap = {mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav'};
function ext(name) { const m = String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/); return m?.[1] || ''; }
function signatureOK(ext, header) {
  const a = new Uint8Array(header);
  const str = (...nums) => nums.every((v,i) => a[i] === v);
  if (ext === 'wav') return str(82,73,70,70) && a[8] === 87 && a[9] === 65 && a[10] === 86 && a[11] === 69;
  if (ext === 'ogg') return str(79,103,103,83);
  if (ext === 'mp3') return str(73,68,51) || (a[0] === 255 && (a[1] & 224) === 224);
  return false;
}
export async function onRequestPost({ request, env }) {
  if (appPassword(env).length < 12 || !env.ROBLOX_API_KEY || !/^\d+$/.test(String(env.ROBLOX_CREATOR_ID || ''))) return json({ error: 'APP_PASSWORD, ROBLOX_API_KEY, atau ROBLOX_CREATOR_ID belum lengkap.' }, 503);
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES + 80_000) return json({ error: 'File lebih besar dari 20 MB.' }, 413);
  let fd;
  try { fd = await request.formData(); } catch { return json({ error: 'Format upload tidak valid.' }, 400); }
  const file = fd.get('audio');
  const title = String(fd.get('title') || '').trim().slice(0,60);
  const description = String(fd.get('description') || '').trim().slice(0,500);
  if (fd.get('rights') !== 'true') return json({ error: 'Konfirmasi hak penggunaan audio terlebih dahulu.' }, 400);
  if (!file || typeof file.arrayBuffer !== 'function' || !title) return json({ error: 'Isi nama asset dan pilih file audio.' }, 400);
  const suffix = ext(file.name);
  if (!extMap[suffix]) return json({ error: 'Upload hanya mendukung MP3, OGG, atau WAV.' }, 400);
  if (!file.size || file.size >= MAX_BYTES) return json({ error: 'Ukuran file harus kurang dari 20 MB.' }, 413);
  const header = await file.slice(0,16).arrayBuffer();
  if (!signatureOK(suffix,header)) return json({ error: 'File tidak memiliki header audio sesuai ekstensi.' }, 400);
  const creatorType = env.ROBLOX_CREATOR_TYPE === 'group' ? 'groupId' : 'userId';
  const requestBody = { assetType:'Audio', displayName:title, description,
    creationContext:{ creator:{ [creatorType]:String(env.ROBLOX_CREATOR_ID) } } };
  const body = new FormData();
  body.append('request',JSON.stringify(requestBody));
  body.append('fileContent',new Blob([file],{type:extMap[suffix]}), `audio.${suffix}`);
  let response;
  try { response = await fetch('https://apis.roblox.com/assets/v1/assets', {
    method:'POST', headers:{'x-api-key': env.ROBLOX_API_KEY}, body, signal:AbortSignal.timeout(60000)
  }); } catch { return json({ error: 'Tidak dapat menghubungi Roblox. Coba lagi nanti.' }, 502); }
  let data;try{data=await response.json();}catch{data={};}
  if (!response.ok) return json({ error:`Roblox HTTP ${response.status}: ${String(data.message || data.error?.message || 'Upload ditolak').slice(0,240)}` }, 502);
  const operation = String(data.path || '');
  const assetId = String(data.response?.assetId || data.response?.path?.match(/^assets\/(\d+)$/)?.[1] || '');
  if (!/^operations\/[a-zA-Z0-9_-]+$/.test(operation) && !/^\d+$/.test(assetId)) return json({ error:'Roblox tidak mengembalikan ID proses atau asset.' },502);
  return json({ ok:true, operation, assetId:assetId||null, state:'pending' });
}
