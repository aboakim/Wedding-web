import crypto from 'crypto';
import { query } from './db.js';
import { sha256, token } from './secret.js';

const SESSION = 60 * 60 * 24 * 14;

export function cookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name) {
  return `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export async function createSession(userId) {
  const raw = token();
  await query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '14 days')`,
    [sha256(raw), userId],
  );
  return raw;
}

export async function userFromRequest(req) {
  const raw = readCookie(req, 'session');
  if (!raw) return null;
  const { rows } = await query(
    `SELECT u.id, u.email, u.role FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(raw)],
  );
  return rows[0] || null;
}

export async function guestFromRequest(req) {
  const raw = readCookie(req, 'guest');
  if (!raw) return null;
  const { rows } = await query(
    `SELECT * FROM guest_sessions WHERE token_hash = $1 AND expires_at > now()`,
    [sha256(raw)],
  );
  return rows[0] || null;
}

export function readCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  const hit = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

export async function endSession(req) {
  const raw = readCookie(req, 'session');
  if (raw) await query(`DELETE FROM user_sessions WHERE token_hash = $1`, [sha256(raw)]);
}

export async function rateLimit(bucket, limit, seconds) {
  const { rows } = await query(
    `INSERT INTO rate_limits (bucket, hits, reset_at)
     VALUES ($1, 1, now() + ($2 * interval '1 second'))
     ON CONFLICT (bucket) DO UPDATE SET
       hits = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.hits + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at < now() THEN now() + ($2 * interval '1 second') ELSE rate_limits.reset_at END
     RETURNING hits`,
    [bucket, seconds],
  );
  return rows[0].hits <= limit;
}

export function ipHash(ip) {
  return sha256(String(ip)).slice(0, 24);
}

export async function audit(client, { userId, action, resourceType, resourceId, ip }) {
  const runner = client?.query ? client : { query };
  await runner.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_hash) VALUES ($1,$2,$3,$4,$5)`,
    [userId || null, action, resourceType, resourceId || null, ip ? ipHash(ip) : null],
  );
}

export { SESSION };
