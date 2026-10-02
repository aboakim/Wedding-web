import { query } from '@/lib/db';
import { guestFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { mediaUrl } from '@/lib/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const session = await guestFromRequest(req);
  if (!session || session.access === 'COUPLE') return fail('AUTH', 'Սելֆին պետք է նորից անել։', 401);
  const slug = new URL(req.url).searchParams.get('slug');
  const wedding = await query(`SELECT * FROM weddings WHERE id = $1`, [session.wedding_id]);
  const row = wedding.rows[0];
  if (!row || row.deleted_at || row.status !== 'ACTIVE' || (slug && slug !== row.slug)) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  if (row.expires_at && new Date(row.expires_at) < new Date()) return fail('EXPIRED', 'Այս հարսանիքի ժամկետն ավարտվել է։', 410);
  const created = new Date(session.created_at).getTime();
  const cap = created + 6 * 60 * 60 * 1000;
  const next = Math.min(Date.now() + 45 * 60 * 1000, cap);
  if (next > new Date(session.expires_at).getTime()) {
    await query(`UPDATE guest_sessions SET expires_at = $2 WHERE id = $1`, [session.id, new Date(next).toISOString()]);
  }
  const page = Math.max(1, Number(new URL(req.url).searchParams.get('page') || 1));
  const limit = 40;
  const { rows } = await query(
    `SELECT id FROM photos
     WHERE id = ANY($1::uuid[]) AND wedding_id = $2 AND status = 'READY'
     ORDER BY capture_time NULLS LAST, created_at
     LIMIT $3 OFFSET $4`,
    [session.photo_ids, session.wedding_id, limit, (page - 1) * limit],
  );
  const photos = rows.map((photo) => ({
    id: photo.id,
    thumb: mediaUrl({ photoId: photo.id, sid: session.id, kind: 'thumb' }),
    full: mediaUrl({ photoId: photo.id, sid: session.id, kind: 'full' }),
  }));
  return ok({
    count: session.photo_ids.length,
    couple: row.couple,
    name: row.name,
    date: row.event_date,
    allowDownloads: row.allow_downloads,
    allowSharing: row.allow_sharing,
    page,
    photos,
  });
});
