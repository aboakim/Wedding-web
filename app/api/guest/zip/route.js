import { guestFromRequest } from '@/lib/auth';
import { query } from '@/lib/db';
import { fail, ok, route } from '@/lib/http';
import { enqueueZip } from '@/lib/jobs';
import { hmac } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sessionZip(req) {
  const session = await guestFromRequest(req);
  if (!session) return { error: fail('AUTH', 'Սելֆին պետք է նորից անել։', 401) };
  const wedding = await query(`SELECT allow_downloads, status, deleted_at FROM weddings WHERE id = $1`, [session.wedding_id]);
  const row = wedding.rows[0];
  if (!row || row.deleted_at || row.status !== 'ACTIVE') return { error: fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404) };
  if (!row.allow_downloads) return { error: fail('DOWNLOAD', 'Ներբեռնումը անջատված է։', 403) };
  return { session };
}

export const POST = route(async (req) => {
  const found = await sessionZip(req);
  if (found.error) return found.error;
  const job = await enqueueZip(found.session);
  return ok({ jobId: job.id, status: job.status });
});

export const GET = route(async (req) => {
  const found = await sessionZip(req);
  if (found.error) return found.error;
  const jobId = new URL(req.url).searchParams.get('job');
  const { rows } = await query(
    `SELECT id, status, result FROM jobs WHERE id = $1 AND type = 'zip' AND payload->>'sessionId' = $2`,
    [jobId, found.session.id],
  );
  if (!rows[0]) return fail('NOT_FOUND', 'Ֆայլը չի գտնվել։', 404);
  if (rows[0].status !== 'DONE' || !rows[0].result?.key) return ok({ jobId, status: rows[0].status });
  const exp = Date.now() + 10 * 60 * 1000;
  const sig = hmac(`zip|${rows[0].id}|${found.session.id}|${exp}`);
  return ok({ jobId, status: 'DONE', url: `/api/guest/zip/file?job=${rows[0].id}&exp=${exp}&sig=${sig}` });
});
