import crypto from 'crypto';
import { guestFromRequest } from '@/lib/auth';
import { query } from '@/lib/db';
import { fail, route } from '@/lib/http';
import { hmac } from '@/lib/secret';
import { getObject } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const session = await guestFromRequest(req);
  if (!session) return fail('AUTH', 'Սելֆին պետք է նորից անել։', 401);
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job') || '';
  const exp = url.searchParams.get('exp') || '';
  const sig = url.searchParams.get('sig') || '';
  if (Number(exp) < Date.now()) return fail('URL', 'Հղման ժամկետն անցել է։', 403);
  const expected = hmac(`zip|${jobId}|${session.id}|${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('URL', 'Հղման ժամկետն անցել է։', 403);
  const { rows } = await query(
    `SELECT result FROM jobs WHERE id = $1 AND type = 'zip' AND status = 'DONE' AND payload->>'sessionId' = $2`,
    [jobId, session.id],
  );
  const key = rows[0]?.result?.key;
  if (!key) return fail('NOT_FOUND', 'Ֆայլը չի գտնվել։', 404);
  const bytes = await getObject(key);
  if (!bytes) return fail('NOT_FOUND', 'Ֆայլը չի գտնվել։', 404);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="photos.zip"',
      'cache-control': 'private, no-store',
    },
  });
});
