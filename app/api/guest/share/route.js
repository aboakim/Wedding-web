import { query } from '@/lib/db';
import { guestFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { sha256, token } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const session = await guestFromRequest(req);
  if (!session) return fail('AUTH', 'Սելֆին պետք է նորից անել։', 401);
  const wedding = await query(`SELECT slug, allow_sharing, status, deleted_at FROM weddings WHERE id = $1`, [session.wedding_id]);
  const row = wedding.rows[0];
  if (!row || row.deleted_at || row.status !== 'ACTIVE') return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  if (!row.allow_sharing) return fail('SHARING', 'Կիսվելը անջատված է։', 403);
  const raw = token();
  await query(
    `INSERT INTO shares (token_hash, wedding_id, photo_ids, expires_at) VALUES ($1,$2,$3::uuid[], now() + interval '12 hours')`,
    [sha256(raw), session.wedding_id, session.photo_ids],
  );
  const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  return ok({ url: `${proto}://${req.headers.get('host')}/s/${raw}` });
});
