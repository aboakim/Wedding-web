import crypto from 'crypto';
import { hmac } from './secret.js';

const FIVE_MIN = 5 * 60 * 1000;

export function mediaUrl({ photoId, sid, kind }) {
  const exp = Date.now() + FIVE_MIN;
  const sig = hmac(`${photoId}|${sid}|${exp}|${kind}`);
  return `/api/media/${photoId}?exp=${exp}&kind=${kind}&sid=${encodeURIComponent(sid)}&sig=${sig}`;
}

export function validMediaSig({ photoId, sid, exp, kind, sig }) {
  if (!sig || !sid || !kind || !exp || Number(exp) < Date.now()) return false;
  const expected = hmac(`${photoId}|${sid}|${exp}|${kind}`);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
