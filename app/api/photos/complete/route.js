import crypto from 'crypto';
import sharp from 'sharp';
import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';
import { enqueuePhoto, refreshWedding } from '@/lib/jobs';
import { putObject, readAssembled, removeParts } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function captureTime(exif) {
  if (!exif) return null;
  const match = exif.toString('latin1').match(/20\d{2}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/);
  if (!match) return null;
  const [date, time] = match[0].split(' ');
  const parsed = new Date(`${date.replaceAll(':', '-')}T${time}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const body = await readJson(req).catch(() => null);
  if (!body?.photoId) return fail('BODY', 'Սխալ հարցում։', 400);
  const { rows } = await query(
    `SELECT p.*, w.user_id, w.status AS wedding_status, w.deleted_at
     FROM photos p JOIN weddings w ON w.id = p.wedding_id WHERE p.id = $1`,
    [body.photoId],
  );
  const photo = rows[0];
  if (!photo || photo.user_id !== user.id) return fail('NOT_FOUND', 'Լուսանկարը չի գտնվել։', 404);
  if (photo.status === 'READY' || photo.status === 'UPLOADED' || photo.status === 'PROCESSING') return ok({ photoId: photo.id, status: photo.status });
  if (photo.status !== 'UPLOADING' || photo.wedding_status !== 'ACTIVE' || photo.deleted_at) return fail('STATE', 'Վերբեռնումը հնարավոր չէ շարունակել։', 409);

  let assembled;
  try {
    assembled = await readAssembled(photo.id, photo.part_count);
  } catch {
    return fail('PARTS', 'Վերբեռնումը դեռ ամբողջական չէ։', 409);
  }
  const hash = crypto.createHash('sha256').update(assembled).digest('hex');
  const mime = sniff(assembled);
  if (hash !== photo.expected_hash || !mime) {
    await removeParts(photo.id);
    await query(`UPDATE photos SET status = 'FAILED', error = 'integrity' WHERE id = $1`, [photo.id]);
    await refreshWedding(photo.wedding_id);
    return fail('HASH', 'Ֆայլը վնասված է կամ կրկնությունը չհամընկավ։', 400);
  }
  let width = null;
  let height = null;
  let taken = null;
  try {
    const meta = await sharp(assembled, { failOn: 'none' }).metadata();
    width = meta.width || null;
    height = meta.height || null;
    taken = captureTime(meta.exif);
  } catch {
    await removeParts(photo.id);
    await query(`UPDATE photos SET status = 'FAILED', error = 'corrupt' WHERE id = $1`, [photo.id]);
    return fail('TYPE', 'Լուսանկարը չի կարդացվում։', 400);
  }
  await putObject(photo.storage_key_original, assembled);
  await query(
    `UPDATE photos SET status = 'UPLOADED', file_hash = $2, file_size = $3, mime_type = $4, width = $5, height = $6, capture_time = $7, error = NULL
     WHERE id = $1`,
    [photo.id, hash, assembled.length, mime, width, height, taken],
  );
  await removeParts(photo.id);
  await enqueuePhoto(photo.id, photo.wedding_id);
  await refreshWedding(photo.wedding_id);
  return ok({ photoId: photo.id, status: 'UPLOADED' });
});
