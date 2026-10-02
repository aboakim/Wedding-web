import crypto from 'crypto';
import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { refreshWedding } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const wedding = await query(`SELECT id FROM weddings WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL`, [id, user.id]);
  if (!wedding.rows[0]) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  await query(`UPDATE jobs SET status = 'PENDING', attempts = 0, run_at = now(), error = NULL, updated_at = now() WHERE wedding_id = $1 AND type = 'process-photo' AND status = 'DEAD'`, [id]);
  const failed = await query(`SELECT id FROM photos WHERE wedding_id = $1 AND status = 'FAILED'`, [id]);
  for (const photo of failed.rows) {
    await query(
      `INSERT INTO jobs (id, type, photo_id, wedding_id, status)
       SELECT $1, 'process-photo', $2, $3, 'PENDING'
       WHERE NOT EXISTS (
         SELECT 1 FROM jobs WHERE photo_id = $2 AND type = 'process-photo' AND status IN ('PENDING','RETRY','RUNNING')
       )`,
      [crypto.randomUUID(), photo.id, id],
    );
  }
  await query(`UPDATE photos SET status = 'UPLOADED', error = NULL WHERE wedding_id = $1 AND status = 'FAILED'`, [id]);
  await refreshWedding(id);
  return ok({ retried: failed.rows.length });
});
