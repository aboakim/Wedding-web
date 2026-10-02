import { query, clientIp } from '@/lib/db';
import { audit, guestFromRequest, userFromRequest } from '@/lib/auth';
import { fail, route } from '@/lib/http';
import { validMediaSig } from '@/lib/media';
import { getObject } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const sid = url.searchParams.get('sid') || '';
  const exp = url.searchParams.get('exp');
  const kind = url.searchParams.get('kind');
  const sig = url.searchParams.get('sig');
  if (!validMediaSig({ photoId: id, sid, exp, kind, sig })) return fail('URL', 'Հղման ժամկետն անցել է։', 403);

  const { rows } = await query(
    `SELECT p.*, w.user_id, w.status AS wedding_status, w.deleted_at, w.allow_downloads
     FROM photos p JOIN weddings w ON w.id = p.wedding_id WHERE p.id = $1`,
    [id],
  );
  const photo = rows[0];
  if (!photo || photo.status !== 'READY' || photo.deleted_at || photo.wedding_status !== 'ACTIVE') {
    return fail('NOT_FOUND', 'Լուսանկարը չի գտնվել։', 404);
  }

  if (sid.startsWith('user:')) {
    const user = await userFromRequest(req);
    if (!user || sid !== `user:${user.id}` || user.id !== photo.user_id) return fail('FORBIDDEN', 'Լուսանկարը հասանելի չէ։', 403);
  } else {
    const session = await guestFromRequest(req);
    const allowed = Array.isArray(session?.photo_ids) ? session.photo_ids : [];
    const couple = session?.access === 'COUPLE';
    if (!session || session.id !== sid || session.wedding_id !== photo.wedding_id || (!couple && !allowed.includes(id))) {
      return fail('FORBIDDEN', 'Լուսանկարը հասանելի չէ։', 403);
    }
  }

  const download = kind === 'full' && url.searchParams.get('download') === '1';
  if (download && !sid.startsWith('user:') && !photo.allow_downloads) return fail('DOWNLOAD', 'Ներբեռնումը անջատված է։', 403);
  const key = kind === 'thumb' ? photo.storage_key_thumbnail : photo.storage_key_original;
  const bytes = await getObject(key);
  if (!bytes) return fail('NOT_FOUND', 'Լուսանկարը չի գտնվել։', 404);
  if (download) {
    const user = await userFromRequest(req);
    await audit(null, {
      userId: user?.id || null,
      action: 'PHOTO_DOWNLOADED',
      resourceType: 'photo',
      resourceId: id,
      ip: clientIp(req),
    });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': kind === 'thumb' ? 'image/jpeg' : (photo.mime_type || 'application/octet-stream'),
      'cache-control': 'private, no-store',
      ...(download ? { 'content-disposition': `attachment; filename="${photo.id}.jpg"` } : {}),
    },
  });
});
