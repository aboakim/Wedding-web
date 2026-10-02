import crypto from 'crypto';
import { query, clientIp } from '@/lib/db';
import { audit, rateLimit, userFromRequest } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';
import { partExists, signUpload } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PART = 4 * 1024 * 1024;
const MAX = 40 * 1024 * 1024;

export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  if (!(await rateLimit(`upload:${user.id}`, 4000, 3600))) return fail('RATE', 'Շատ փորձ եղավ։ Փորձեք մի փոքր ուշ։', 429);
  const body = await readJson(req).catch(() => null);
  if (!body) return fail('BODY', 'Սխալ հարցում։', 400);
  const weddingId = String(body.weddingId || '');
  const hash = String(body.hash || '').toLowerCase();
  const size = Number(body.size);
  const type = String(body.type || '');
  const filename = String(body.name || 'photo').slice(0, 120);
  if (!/^[0-9a-f-]{36}$/i.test(weddingId)) return fail('WEDDING', 'Հարսանիքը չի գտնվել։', 404);
  if (!/^[a-f0-9]{64}$/.test(hash)) return fail('HASH', 'Ֆայլի ստուգումը ձախողվեց։', 400);
  if (!Number.isInteger(size) || size < 1 || size > MAX) return fail('SIZE', 'Ֆայլը չափազանց մեծ է կամ դատարկ է։', 400);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail('TYPE', 'Թույլատրվում է JPEG, PNG կամ WEBP։', 400);

  const wedding = await query(
    `SELECT w.*, p.storage_limit_bytes, COALESCE(ofr.max_photos, p.max_photos) AS max_photos
     FROM weddings w
     JOIN orders o ON o.id = w.order_id
     JOIN plans p ON p.id = o.plan_id
     LEFT JOIN plan_offers ofr ON ofr.plan_id = p.id AND ofr.occasion = w.occasion
     WHERE w.id = $1 AND w.user_id = $2`,
    [weddingId, user.id],
  );
  const row = wedding.rows[0];
  if (!row || row.deleted_at) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  if (row.status !== 'ACTIVE') return fail('PAYMENT', 'Լուսանկար վերբեռնելու համար նախ հաստատեք վճարումը։', 402);

  const live = await query(
    `SELECT id, status, part_count FROM photos
     WHERE wedding_id = $1 AND expected_hash = $2 AND status IN ('UPLOADING','UPLOADED','PROCESSING','READY')`,
    [weddingId, hash],
  );
  if (live.rows[0] && live.rows[0].status !== 'UPLOADING') {
    return ok({ duplicate: true, photoId: live.rows[0].id });
  }

  const usage = await query(
    `SELECT COUNT(*)::int AS photos, COALESCE(SUM(file_size),0)::bigint AS bytes
     FROM photos WHERE wedding_id = $1 AND status NOT IN ('FAILED','DELETED')`,
    [weddingId],
  );
  const photoId = live.rows[0]?.id || crypto.randomUUID();
  if (!live.rows[0] && usage.rows[0].photos >= row.max_photos) return fail('LIMIT', 'Փաթեթի լուսանկարների սահմանը լրացել է։', 402);
  if (!live.rows[0] && Number(usage.rows[0].bytes) + size > Number(row.storage_limit_bytes)) {
    return fail('LIMIT', 'Փաթեթի հիշողության սահմանը լրացել է։', 402);
  }

  const partCount = Math.ceil(size / PART);
  if (!live.rows[0]) {
    await query(
      `INSERT INTO photos (id, wedding_id, storage_key_original, storage_key_thumbnail, expected_hash, filename, part_count, status, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'UPLOADING',$8)`,
      [
        photoId,
        weddingId,
        `weddings/${weddingId}/originals/${photoId}`,
        `weddings/${weddingId}/thumbnails/${photoId}.jpg`,
        hash,
        filename,
        partCount,
        type,
      ],
    );
    await audit(null, { userId: user.id, action: 'PHOTO_UPLOADED', resourceType: 'photo', resourceId: photoId, ip: clientIp(req) });
  }

  const parts = [];
  for (let part = 1; part <= partCount; part += 1) {
    const start = (part - 1) * PART;
    const end = Math.min(size, start + PART);
    const token = signUpload({ photoId, part, size: end - start, exp: Date.now() + 6 * 60 * 60 * 1000 });
    parts.push({
      part,
      start,
      end,
      done: await partExists(photoId, part),
      url: `/api/storage/upload?token=${encodeURIComponent(token)}`,
    });
  }
  return ok({ photoId, partSize: PART, parts, duplicate: false });
});
