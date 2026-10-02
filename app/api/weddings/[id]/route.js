import { query, clientIp } from '@/lib/db';
import { audit, userFromRequest } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';
import { mediaUrl } from '@/lib/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function load(id, userId) {
  const { rows } = await query(`SELECT * FROM weddings WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] || null;
}

export const GET = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const wedding = await load(id, user.id);
  if (!wedding) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  const counts = await query(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(file_size),0)::bigint AS bytes
     FROM photos WHERE wedding_id = $1 AND status <> 'DELETED' GROUP BY status`,
    [id],
  );
  const guests = await query(`SELECT COUNT(*)::int AS n FROM guest_sessions WHERE wedding_id = $1`, [id]);
  const failed = await query(
    `SELECT id, filename, error FROM photos WHERE wedding_id = $1 AND status = 'FAILED' ORDER BY created_at DESC LIMIT 20`,
    [id],
  );
  const preview = await query(
    `SELECT id FROM photos WHERE wedding_id = $1 AND status = 'READY' AND storage_key_thumbnail IS NOT NULL
     ORDER BY capture_time NULLS LAST, created_at DESC LIMIT 12`,
    [id],
  );
  const sid = `user:${user.id}`;
  return ok({
    wedding: {
      id: wedding.id,
      name: wedding.name,
      couple: wedding.couple,
      occasion: wedding.occasion || 'WEDDING',
      slug: wedding.slug,
      coupleToken: wedding.couple_token,
      date: wedding.event_date,
      status: wedding.status,
      processingStatus: wedding.processing_status,
      expiresAt: wedding.expires_at,
      deletedAt: wedding.deleted_at,
      allowDownloads: wedding.allow_downloads,
      allowSharing: wedding.allow_sharing,
    },
    counts: counts.rows,
    guests: guests.rows[0].n,
    failed: failed.rows,
    preview: preview.rows.map((row) => ({ id: row.id, thumb: mediaUrl({ photoId: row.id, sid, kind: 'thumb' }) })),
  });
});

export const POST = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const wedding = await load(id, user.id);
  if (!wedding) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  const body = await readJson(req).catch(() => null);
  if (!body || body.confirm !== wedding.couple) return fail('CONFIRM', 'Ջնջելու համար գրեք զույգի անունը ճիշտ։', 400);
  await query(
    `UPDATE weddings SET status = 'ARCHIVED', processing_status = 'ARCHIVED', deleted_at = now(), updated_at = now() WHERE id = $1`,
    [id],
  );
  await audit(null, { userId: user.id, action: 'WEDDING_DELETED', resourceType: 'wedding', resourceId: id, ip: clientIp(req) });
  return ok({ status: 'ARCHIVED' });
});
