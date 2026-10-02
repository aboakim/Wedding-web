import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { enqueueAlbum } from '@/lib/jobs';
import { hmac } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function owned(req, id) {
  const user = await userFromRequest(req);
  if (!user) return { error: fail('AUTH', 'Մուտք գործեք։', 401) };
  const { rows } = await query(
    `SELECT id FROM weddings WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [id, user.id],
  );
  if (!rows[0]) return { error: fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404) };
  return { user };
}

function resultOf(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

export const POST = route(async (req, { params }) => {
  const { id } = await params;
  const found = await owned(req, id);
  if (found.error) return found.error;
  const count = await query(
    `SELECT COUNT(*)::int AS n FROM photos WHERE wedding_id = $1 AND status IN ('UPLOADED','PROCESSING','READY')`,
    [id],
  );
  if (!count.rows[0].n) return fail('EMPTY', 'Նախ վերբեռնեք լուսանկարները։', 409);
  const job = await enqueueAlbum(id);
  return ok({ jobId: job.id, status: job.status });
});

export const GET = route(async (req, { params }) => {
  const { id } = await params;
  const found = await owned(req, id);
  if (found.error) return found.error;
  const jobId = new URL(req.url).searchParams.get('job') || '';
  const { rows } = await query(
    `SELECT id, status, error, result FROM jobs WHERE id = $1 AND type = 'zip' AND wedding_id = $2 AND payload->>'kind' = 'album'`,
    [jobId, id],
  );
  if (!rows[0]) return fail('NOT_FOUND', 'Ֆայլը չի գտնվել։', 404);
  if (rows[0].status === 'DEAD') return fail('ZIP', rows[0].error || 'Ֆայլը չստեղծվեց։', 422);
  const key = resultOf(rows[0].result).key;
  if (rows[0].status !== 'DONE' || !key) return ok({ jobId, status: rows[0].status });
  const exp = Date.now() + 10 * 60 * 1000;
  const sig = hmac(`album|${rows[0].id}|${found.user.id}|${exp}`);
  return ok({ jobId, status: 'DONE', url: `/api/weddings/${id}/album/file?job=${rows[0].id}&exp=${exp}&sig=${sig}` });
});
