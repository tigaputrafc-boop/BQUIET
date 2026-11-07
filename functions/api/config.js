import { json, appPassword } from '../_lib/auth.js';
export async function onRequestGet({ env }) {
  const creatorId = String(env.ROBLOX_CREATOR_ID || '');
  const creatorType = env.ROBLOX_CREATOR_TYPE === 'group' ? 'group' : 'user';
  const passwordReady = appPassword(env).length >= 12;
  const robloxConfigured = Boolean(passwordReady && env.ROBLOX_API_KEY && /^\d+$/.test(creatorId));
  return json({ cloudflare: true, clientConversion: true, loginConfigured: passwordReady,
    robloxConfigured, creatorType, creatorId: robloxConfigured ? creatorId : null,
    tools: { ffmpeg: true, ffprobe: true, 'yt-dlp': false } });
}
