import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { rows } = await query(
    `SELECT w.id, w.name, w.couple, w.slug, w.occasion, w.status, w.processing_status, w.expires_at, w.deleted_at, w.order_id, o.status AS order_status,
        COUNT(p.id) FILTER (WHERE p.status <> 'DELETED')::int AS photos,
        COUNT(p.id) FILTER (WHERE p.status = 'READY')::int AS processed,
        COALESCE(SUM(p.file_size) FILTER (WHERE p.status NOT IN ('DELETED','FAILED')), 0)::bigint AS storage_bytes,
        (SELECT COUNT(*)::int FROM guest_sessions g WHERE g.wedding_id = w.id) AS guests
     FROM weddings w
     LEFT JOIN orders o ON o.id = w.order_id
     LEFT JOIN photos p ON p.wedding_id = w.id
     WHERE w.user_id = $1
     GROUP BY w.id, o.status
     ORDER BY w.created_at DESC`,
    [user.id],
  );
  return ok({ weddings: rows });
});
