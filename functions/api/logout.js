import { json, expiredSession } from '../_lib/auth.js';
export async function onRequestPost() {
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', expiredSession());
  return response;
}
