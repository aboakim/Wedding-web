import crypto from 'crypto';
import { query, clientIp } from '@/lib/db';
import { audit, cookie, createSession, hashPassword, rateLimit } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`register:${ip}`, 40, 3600))) return fail('RATE', 'Շատ փորձ եղավ։ Փորձեք մի փոքր ուշ։', 429);
  const body = await readJson(req).catch(() => null);
  if (!body) return fail('BODY', 'Սխալ հարցում։', 400);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return fail('EMAIL', 'Մուտքագրեք ճիշտ էլ. փոստ։', 400);
  if (password.length < 8 || password.length > 200) return fail('PASSWORD', 'Գաղտնաբառը պետք է լինի առնվազն 8 նիշ։', 400);
  const id = crypto.randomUUID();
  try {
    await query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1,$2,$3,'PHOTOGRAPHER')`,
      [id, email, hashPassword(password)],
    );
  } catch (error) {
    if (error.code === '23505') return fail('EMAIL_TAKEN', 'Այս էլ. փոստն արդեն գրանցված է։', 409);
    throw error;
  }
  await audit(null, { userId: id, action: 'USER_REGISTERED', resourceType: 'user', resourceId: id, ip });
  const raw = await createSession(id);
  return ok({ id, email }, 201, { 'set-cookie': cookie('session', raw, 60 * 60 * 24 * 14) });
});
