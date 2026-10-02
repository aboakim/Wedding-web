import crypto from 'crypto';
import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, route } from '@/lib/http';
import { hmac } from '@/lib/secret';
import { getObject } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resultOf(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

export const GET = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job') || '';
  const exp = url.searchParams.get('exp') || '';
  const sig = url.searchParams.get('sig') || '';
  if (Number(exp) < Date.now()) return fail('URL', 'Հղման ժամկետն անցել է։', 403);
  const expected = hmac(`album|${jobId}|${user.id}|${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('URL', 'Հղման ժամկետն անցել է։', 403);
  const { rows } = await query(
    `SELECT j.result FROM jobs j
     JOIN weddings w ON w.id = j.wedding_id
     WHERE j.id = $1 AND j.type = 'zip' AND j.status = 'DONE' AND j.wedding_id = $2 AND w.user_id = $3`,
    [jobId, id, user.id],
  );
  const key = resultOf(rows[0]?.result).key;
  if (!key) return fail('NOT_FOUND', 'Ֆայլը չի գտնվել։', 404);
  const bytes = await getObject(key);
  if (!bytes) return fail('NOT_FOUND', 'Ֆայլը չի գտնվել։', 404);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="wedding-photos.zip"',
      'cache-control': 'private, no-store',
    },
  });
});
