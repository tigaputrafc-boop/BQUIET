import { isAuthenticated, appPassword, json, validOrigin } from './_lib/auth.js';

const ALLOW = new Set(['/login.html', '/login.css', '/login.js', '/favicon.svg', '/api/login', '/api/config']);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !validOrigin(request)) return json({ error: 'Permintaan lintas situs ditolak.' }, 403);
  if (ALLOW.has(url.pathname)) return context.next();
  // Without a login password, the converter UI remains publicly accessible, but Roblox upload stays disabled.
  if (appPassword(env).length < 12) {
    if (isApi) return json({ error: 'Set APP_PASSWORD minimal 12 karakter di Cloudflare Pages Settings > Variables and Secrets.' }, 503);
    return context.next();
  }
  if (await isAuthenticated(request, env)) return context.next();
  if (isApi) return json({ error: 'Login diperlukan.', loginRequired: true }, 401);
  if (url.pathname !== '/login.html') return Response.redirect(`${url.origin}/login.html`, 302);
  return context.next();
}
