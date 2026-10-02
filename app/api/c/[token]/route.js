import crypto from 'crypto';
import { query } from '@/lib/db';
import { cookie, guestFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { mediaUrl } from '@/lib/media';
import { sha256, token } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, { params }) => {
  const { token: coupleToken } = await params;
  if (!/^[0-9a-f]{32}$/.test(coupleToken)) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  const { rows } = await query(`SELECT * FROM weddings WHERE couple_token = $1`, [coupleToken]);
  const wedding = rows[0];
  if (!wedding || wedding.deleted_at || wedding.status !== 'ACTIVE') return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  if (wedding.expires_at && new Date(wedding.expires_at) < new Date()) return fail('EXPIRED', 'Այս հարսանիքի ժամկետն ավարտվել է։', 410);

  let session = await guestFromRequest(req);
  let header;
  if (!session || session.wedding_id !== wedding.id || session.access !== 'COUPLE') {
    const raw = token();
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO guest_sessions (id, token_hash, wedding_id, photo_ids, access, expires_at)
       VALUES ($1,$2,$3,'{}'::uuid[],'COUPLE', now() + interval '14 days')`,
      [id, sha256(raw), wedding.id],
    );
    session = { id };
    header = { 'set-cookie': cookie('guest', raw, 60 * 60 * 24 * 14) };
  }

  const page = Math.max(1, Number(new URL(req.url).searchParams.get('page') || 1));
  const limit = 60;
  const total = await query(
    `SELECT COUNT(*)::int AS n FROM photos WHERE wedding_id = $1 AND status = 'READY'`,
    [wedding.id],
  );
  const photos = await query(
    `SELECT id FROM photos WHERE wedding_id = $1 AND status = 'READY'
     ORDER BY capture_time NULLS LAST, created_at
     LIMIT $2 OFFSET $3`,
    [wedding.id, limit, (page - 1) * limit],
  );
  return ok({
    couple: wedding.couple,
    occasion: wedding.occasion || 'WEDDING',
    name: wedding.name,
    date: wedding.event_date,
    count: total.rows[0].n,
    allowDownloads: wedding.allow_downloads,
    page,
    photos: photos.rows.map((photo) => ({
      id: photo.id,
      thumb: mediaUrl({ photoId: photo.id, sid: session.id, kind: 'thumb' }),
      full: mediaUrl({ photoId: photo.id, sid: session.id, kind: 'full' }),
    })),
  }, 200, header);
});
