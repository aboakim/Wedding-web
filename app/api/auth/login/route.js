import crypto from 'crypto';
import { query, clientIp } from '@/lib/db';
import { audit, cookie, createSession, rateLimit, verifyPassword } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`login:${ip}`, 10, 900))) return fail('RATE', 'Շատ փորձ եղավ։ Փորձեք մի փոքր ուշ։', 429);
  const body = await readJson(req).catch(() => null);
  if (!body) return fail('BODY', 'Սխալ հարցում։', 400);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const { rows } = await query(`SELECT id, email, password_hash FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  const stored = user?.password_hash || `scrypt$${crypto.randomBytes(16).toString('hex')}$${'00'.repeat(32)}`;
  const match = verifyPassword(password, stored);
  if (!user || !match) return fail('LOGIN', 'Էլ. փոստը կամ գաղտնաբառը սխալ է։', 401);
  await audit(null, { userId: user.id, action: 'USER_LOGIN', resourceType: 'user', resourceId: user.id, ip });
  const raw = await createSession(user.id);
  return ok({ id: user.id, email: user.email }, 200, { 'set-cookie': cookie('session', raw, 60 * 60 * 24 * 14) });
});
