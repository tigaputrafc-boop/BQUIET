const textEncoder = new TextEncoder();
const COOKIE = 'mono_auth';
const TTL = 24 * 60 * 60 * 1000;

function base64Url(bytes) {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret, content) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(content))));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function appPassword(env) { return String(env.APP_PASSWORD || ''); }
export async function verifyPassword(candidate, correct) {
  // Compare derived hashes to avoid string timing disclosure.
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(String(candidate || ''))));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(correct)));
  let diff = 0; for (let i = 0; i < 32; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function newSession(secret) {
  const payload = `${Date.now() + TTL}.${base64Url(crypto.getRandomValues(new Uint8Array(18)))}`;
  const signature = await hmac(secret, payload);
  return `${COOKIE}=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}
export function expiredSession() { return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`; }
export async function isAuthenticated(request, env) {
  const secret = appPassword(env);
  if (secret.length < 12) return false;
  const match = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)mono_auth=([^;]+)/);
  const token = match?.[1];
  if (!token || token.length > 250) return false;
  const fields = token.split('.');
  if (fields.length !== 3) return false;
  const [expiry, nonce, signature] = fields;
  if (!/^\d{13}$/.test(expiry) || !/^[\w-]{24}$/.test(nonce) || !/^[\w-]{43}$/.test(signature)) return false;
  const end = Number(expiry);
  if (end < Date.now() || end > Date.now() + TTL + 60_000) return false;
  return safeEqual(signature, await hmac(secret, `${expiry}.${nonce}`));
}
export function validOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
