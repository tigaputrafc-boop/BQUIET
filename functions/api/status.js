import { json, appPassword } from '../_lib/auth.js';
function mapModeration(data) {
  const state = String(data?.moderationResult?.moderationState || '').toUpperCase();
  if (state.includes('REJECT')) return 'rejected';
  if (state.includes('APPROV')) return 'approved';
  return 'pending';
}
function getId(obj) {
  const id = String(obj?.assetId || obj?.path?.match(/^assets\/(\d+)$/)?.[1] || '');
  return /^\d+$/.test(id) ? id : null;
}
async function getRoblox(url, key) {
  const res = await fetch(url,{headers: {'x-api-key':key},signal:AbortSignal.timeout(22000)});
  let body;try{body=await res.json();}catch{body={};}
  if (!res.ok) throw new Error(`Roblox HTTP ${res.status}: ${String(body.message || body.error?.message || 'Cek status gagal').slice(0,140)}`);
  return body;
}
export async function onRequestGet({ request, env }) {
  if (appPassword(env).length < 12 || !env.ROBLOX_API_KEY) return json({ error:'API Roblox belum dikonfigurasi.' },503);
  const query = new URL(request.url).searchParams;
  let operation = query.get('operation') || '';
  let assetId = query.get('assetId') || '';
  if (!operation && !assetId) return json({ error:'operation atau assetId wajib diisi.' },400);
  if (operation && !/^operations\/[A-Za-z0-9_-]+$/.test(operation)) return json({ error:'Operation ID tidak valid.' },400);
  if (assetId && !/^\d+$/.test(assetId)) return json({ error:'Asset ID tidak valid.' },400);
  try {
    if (!assetId) {
      const op = await getRoblox(`https://apis.roblox.com/assets/v1/${operation}`,env.ROBLOX_API_KEY);
      if (op.error) return json({ state:'rejected',message:op.error.message||'Roblox menolak upload.' });
      if (!op.done) return json({ state:'pending',operation,message:'Roblox memproses upload.' });
      assetId = getId(op.response);
      if (!assetId) return json({state:'pending',operation,message:'Proses selesai, tetapi ID asset belum tersedia.'});
      if (mapModeration(op.response)!=='pending') return json({state:mapModeration(op.response),assetId,operation});
    }
    const asset = await getRoblox(`https://apis.roblox.com/assets/v1/assets/${assetId}`,env.ROBLOX_API_KEY);
    return json({ state:mapModeration(asset), assetId, operation,
      message:mapModeration(asset)==='approved'?'Roblox menyetujui audio.':mapModeration(asset)==='rejected'?'Audio ditolak moderasi Roblox.':'Audio diterima Roblox; menunggu hasil moderasi.' });
  } catch(error) { return json({error:error.message},502); }
}
