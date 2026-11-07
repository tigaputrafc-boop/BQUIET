import { json, appPassword, verifyPassword, newSession } from '../_lib/auth.js';
export async function onRequestPost({ request, env }) {
  const secret = appPassword(env);
  if (secret.length < 12) return json({ error: 'APP_PASSWORD belum disetel di Cloudflare.' }, 503);
  if (Number(request.headers.get('Content-Length') || 0) > 2048) return json({ error: 'Request terlalu besar.' }, 413);
  let value;
  try { value = await request.json(); } catch { return json({ error: 'Body JSON tidak valid.' }, 400); }
  if (typeof value?.password !== 'string' || value.password.length > 512 || !await verifyPassword(value.password, secret)) return json({ error: 'Password tidak sesuai.' }, 401);
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', await newSession(secret));
  return response;
}
