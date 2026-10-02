import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const wedding = await query(`SELECT id, processing_status, status FROM weddings WHERE id = $1 AND user_id = $2`, [id, user.id]);
  if (!wedding.rows[0]) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS n FROM photos WHERE wedding_id = $1 AND status <> 'DELETED' GROUP BY status`,
    [id],
  );
  const map = Object.fromEntries(rows.map((row) => [row.status, row.n]));
  const uploaded = (map.UPLOADED || 0) + (map.PROCESSING || 0) + (map.READY || 0) + (map.FAILED || 0);
  const uploading = map.UPLOADING || 0;
  return ok({
    status: wedding.rows[0].status,
    processingStatus: wedding.rows[0].processing_status,
    upload: { done: uploaded, total: uploaded + uploading },
    ai: { done: map.READY || 0, failed: map.FAILED || 0, total: uploaded },
  });
});
