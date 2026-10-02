import { query } from '@/lib/db';
import { fail, ok, route } from '@/lib/http';
import { readUploadToken, writePart } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route(async (req) => {
  const payload = readUploadToken(new URL(req.url).searchParams.get('token'));
  if (!payload?.photoId || !payload.part || !payload.size) return fail('URL', 'Վերբեռնման հղման ժամկետն անցել է։', 403);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length !== payload.size || bytes.length > 4 * 1024 * 1024) return fail('SIZE', 'Ֆայլի մասը թերի է։', 400);
  const { rows } = await query(`SELECT status FROM photos WHERE id = $1`, [payload.photoId]);
  if (!rows[0] || rows[0].status !== 'UPLOADING') return fail('PHOTO', 'Այս ֆայլն արդեն փակված է։', 409);
  await writePart(payload.photoId, payload.part, bytes);
  return ok({ stored: true });
});
