import crypto from 'crypto';
import { query } from '@/lib/db';
import { cookie } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';
import { sha256, token } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const body = await readJson(req).catch(() => null);
  if (!body?.token) return fail('BODY', 'Հղումը սխալ է։', 400);
  const { rows } = await query(
    `SELECT s.*, w.status, w.deleted_at FROM shares s JOIN weddings w ON w.id = s.wedding_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(String(body.token))],
  );
  const share = rows[0];
  if (!share || share.deleted_at || share.status !== 'ACTIVE') return fail('NOT_FOUND', 'Հղման ժամկետն անցել է։', 404);
  const raw = token();
  await query(
    `INSERT INTO guest_sessions (id, token_hash, wedding_id, photo_ids, expires_at)
     VALUES ($1,$2,$3,$4::uuid[], now() + interval '45 minutes')`,
    [crypto.randomUUID(), sha256(raw), share.wedding_id, share.photo_ids],
  );
  return ok({ claimed: true }, 200, { 'set-cookie': cookie('guest', raw, 45 * 60) });
});
