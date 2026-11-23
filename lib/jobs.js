import crypto from 'crypto';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import { query, tx } from './db.js';
import { embedFile } from './faces.js';
import { getObject, localPath, objectExists, putObject, removeObject, removeParts, removeWeddingObjects } from './storage.js';
import { reconcile } from './payments.js';

let timer;
let ticking = false;

function delaySeconds(attempts) {
  const table = process.env.NODE_ENV === 'production' ? [60, 300, 900, 1800] : [5, 15, 30, 60];
  return table[Math.min(Math.max(attempts, 1) - 1, table.length - 1)];
}

export async function enqueuePhoto(photoId, weddingId) {
  await query(
    `INSERT INTO jobs (id, type, photo_id, wedding_id, status)
     SELECT $1, 'process-photo', $2, $3, 'PENDING'
     WHERE NOT EXISTS (
       SELECT 1 FROM jobs WHERE photo_id = $2 AND type = 'process-photo' AND status IN ('PENDING','RETRY','RUNNING')
     )`,
    [crypto.randomUUID(), photoId, weddingId],
  );
}

export async function enqueueAlbum(weddingId) {
  const existing = await query(
    `SELECT id, status, result FROM jobs
     WHERE type = 'zip' AND wedding_id = $1 AND payload->>'kind' = 'album'
       AND status IN ('PENDING','RETRY','RUNNING','DONE')
       AND created_at > now() - interval '2 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [weddingId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO jobs (id, type, wedding_id, status, payload) VALUES ($1,'zip',$2,'PENDING',$3)`,
    [id, weddingId, { kind: 'album' }],
  );
  return { id, status: 'PENDING', result: null };
}

export async function enqueueZip(session) {
  const existing = await query(
    `SELECT id, status, result FROM jobs
     WHERE type = 'zip' AND payload->>'sessionId' = $1 AND status IN ('PENDING','RETRY','RUNNING','DONE')
       AND created_at > now() - interval '2 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [session.id],
  );
  if (existing.rows[0]) return existing.rows[0];
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO jobs (id, type, wedding_id, status, payload) VALUES ($1,'zip',$2,'PENDING',$3)`,
    [id, session.wedding_id, { sessionId: session.id }],
  );
  return { id, status: 'PENDING', result: null };
}

export async function refreshWedding(weddingId) {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS n FROM photos WHERE wedding_id = $1 AND status <> 'DELETED' GROUP BY status`,
    [weddingId],
  );
  const map = Object.fromEntries(rows.map((row) => [row.status, row.n]));
  const ready = map.READY || 0;
  const failed = map.FAILED || 0;
  const uploading = map.UPLOADING || 0;
  const uploaded = map.UPLOADED || 0;
  const processing = map.PROCESSING || 0;
  const total = ready + failed + uploading + uploaded + processing;
  let next = 'CREATED';
  if (total === 0) next = 'CREATED';
  else if ((processing > 0 || uploaded > 0) && ready > 0) next = 'PARTIALLY_READY';
  else if (processing > 0 || uploaded > 0) next = 'PROCESSING';
  else if (uploading > 0 && ready > 0) next = 'PARTIALLY_READY';
  else if (uploading > 0) next = 'UPLOADING';
  else if (ready > 0 && failed > 0) next = 'PARTIALLY_READY';
  else if (ready > 0) next = 'READY';
  else next = 'FAILED';
  await query(
    `UPDATE weddings SET processing_status = $2, updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [weddingId, next],
  );
}

async function processPhoto(job) {
  const { rows } = await query(`SELECT * FROM photos WHERE id = $1`, [job.photo_id]);
  const photo = rows[0];
  if (!photo || photo.status === 'DELETED' || photo.status === 'READY') return;
  if (!photo.storage_key_original || !objectExists(photo.storage_key_original)) {
    throw new Error('original missing');
  }
  await query(`UPDATE photos SET status = 'PROCESSING', error = NULL WHERE id = $1`, [photo.id]);
  const embeddings = await embedFile(localPath(photo.storage_key_original));
  const thumb = await sharp(localPath(photo.storage_key_original))
    .rotate()
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
  await putObject(photo.storage_key_thumbnail, thumb);
  await tx(async (client) => {
    await client.query(`DELETE FROM faces WHERE photo_id = $1`, [photo.id]);
    for (const embedding of embeddings) {
      const vector = `{${embedding.map((n) => Number(n).toFixed(8)).join(',')}}`;
      await client.query(
        `INSERT INTO faces (photo_id, wedding_id, embedding) VALUES ($1,$2,$3::float8[])`,
        [photo.id, photo.wedding_id, vector],
      );
    }
    await client.query(
      `UPDATE photos SET status = 'READY', faces = $2, error = NULL WHERE id = $1 AND status <> 'DELETED'`,
      [photo.id, embeddings.length],
    );
  });
}

function payloadOf(job) {
  if (!job.payload) return {};
  if (typeof job.payload === 'string') {
    try { return JSON.parse(job.payload); } catch { return {}; }
  }
  return job.payload;
}

async function packPhotos(weddingId, rows) {
  if (!rows.length) throw new Error('empty');
  if (rows.length > 200) throw new Error('too many');
  let total = 0;
  const packed = {};
  for (let index = 0; index < rows.length; index += 1) {
    const bytes = await getObject(rows[index].storage_key_original);
    if (!bytes) continue;
    total += bytes.length;
    if (total > 400 * 1024 * 1024) throw new Error('too large');
    const name = String(rows[index].filename || `photo-${index + 1}.jpg`).replace(/[^\w.\-]+/g, '_');
    packed[`${String(index + 1).padStart(3, '0')}-${name}`] = new Uint8Array(bytes);
  }
  if (!Object.keys(packed).length) throw new Error('empty');
  const zipped = Buffer.from(zipSync(packed, { level: 0 }));
  const key = `weddings/${weddingId}/zips/${crypto.randomUUID()}.zip`;
  await putObject(key, zipped);
  return key;
}

async function buildZip(job) {
  const payload = payloadOf(job);
  if (payload.kind === 'album') {
    const wedding = await query(`SELECT * FROM weddings WHERE id = $1`, [job.wedding_id]);
    const row = wedding.rows[0];
    if (!row || row.status !== 'ACTIVE' || row.deleted_at) throw new Error('downloads disabled');
    const photos = await query(
      `SELECT id, filename, storage_key_original FROM photos
       WHERE wedding_id = $1 AND status IN ('UPLOADED','PROCESSING','READY')
       ORDER BY capture_time NULLS LAST, created_at`,
      [job.wedding_id],
    );
    const key = await packPhotos(job.wedding_id, photos.rows);
    await query(`UPDATE jobs SET result = $2::jsonb WHERE id = $1`, [job.id, JSON.stringify({ key })]);
    return;
  }
  const sessionId = payload.sessionId;
  const { rows } = await query(`SELECT * FROM guest_sessions WHERE id = $1 AND expires_at > now()`, [sessionId]);
  const session = rows[0];
  if (!session) throw new Error('session expired');
  const wedding = await query(`SELECT * FROM weddings WHERE id = $1`, [session.wedding_id]);
  const row = wedding.rows[0];
  if (!row?.allow_downloads || row.status !== 'ACTIVE' || row.deleted_at) throw new Error('downloads disabled');
  const photos = session.access === 'COUPLE'
    ? await query(
      `SELECT id, filename, storage_key_original FROM photos
       WHERE wedding_id = $1 AND status IN ('UPLOADED','PROCESSING','READY')
       ORDER BY capture_time NULLS LAST, created_at`,
      [session.wedding_id],
    )
    : await query(
      `SELECT id, storage_key_original FROM photos
       WHERE id = ANY($1::uuid[]) AND wedding_id = $2 AND status = 'READY'
       ORDER BY capture_time NULLS LAST, created_at`,
      [session.photo_ids, session.wedding_id],
    );
  const key = await packPhotos(session.wedding_id, photos.rows);
  await query(`UPDATE jobs SET result = $2::jsonb WHERE id = $1`, [job.id, JSON.stringify({ key })]);
}

const PURGE_GRACE = `interval '30 days'`;
const ZIP_MAX_AGE = `interval '1 day'`;

async function purgeWedding(weddingId) {
  const photos = await query(`SELECT id FROM photos WHERE wedding_id = $1`, [weddingId]);
  for (const photo of photos.rows) await removeParts(photo.id).catch(() => {});
  await removeWeddingObjects(weddingId);
  // Consent records hold no biometric data and are kept as evidence of consent.
  await tx(async (client) => {
    await client.query(`DELETE FROM faces WHERE wedding_id = $1`, [weddingId]);
    await client.query(`DELETE FROM jobs WHERE wedding_id = $1`, [weddingId]);
    await client.query(`DELETE FROM guest_sessions WHERE wedding_id = $1`, [weddingId]);
    await client.query(`DELETE FROM shares WHERE wedding_id = $1`, [weddingId]);
    await client.query(`DELETE FROM photos WHERE wedding_id = $1`, [weddingId]);
    await client.query(`DELETE FROM weddings WHERE id = $1`, [weddingId]);
  });
}

// Deleted weddings and weddings past their plan retention (expires_at) are removed
// for good after a 30-day grace period. Guest zip files are removed after 1 day.
async function purge() {
  for (let round = 0; round < 100; round += 1) {
    const { rows } = await query(
      `SELECT id FROM weddings
       WHERE (deleted_at IS NOT NULL AND deleted_at < now() - ${PURGE_GRACE})
          OR (expires_at IS NOT NULL AND expires_at < now() - ${PURGE_GRACE})
       LIMIT 10`,
    );
    if (!rows.length) break;
    for (const wedding of rows) await purgeWedding(wedding.id);
  }
  const zips = await query(
    `SELECT id, result FROM jobs
     WHERE type = 'zip' AND result ? 'key' AND created_at < now() - ${ZIP_MAX_AGE}`,
  );
  for (const job of zips.rows) {
    const result = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
    await removeObject(result.key).catch(() => {});
    await query(`UPDATE jobs SET result = NULL, updated_at = now() WHERE id = $1`, [job.id]);
  }
}

async function schedulePurge() {
  await query(
    `INSERT INTO jobs (id, type, status, run_at)
     SELECT $1, 'purge', 'PENDING', now() + interval '1 day'
     WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE type = 'purge' AND status IN ('PENDING','RETRY','RUNNING'))`,
    [crypto.randomUUID()],
  );
}

async function claim() {
  return tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM jobs WHERE status IN ('PENDING','RETRY') AND run_at <= now()
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!rows[0]) return null;
    await client.query(
      `UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
      [rows[0].id],
    );
    return { ...rows[0], attempts: rows[0].attempts + 1 };
  });
}

async function finish(job, error) {
  if (!error) {
    await query(`UPDATE jobs SET status = 'DONE', error = NULL, updated_at = now() WHERE id = $1`, [job.id]);
  } else {
    const message = String(error.message || 'failed').slice(0, 300);
    const model = message.includes('Մոդելները');
    const permanent = /missing|disabled|expired|too many|too large|corrupt/.test(message);
    if (!model && (permanent || job.attempts >= 5)) {
      await query(`UPDATE jobs SET status = 'DEAD', error = $2, updated_at = now() WHERE id = $1`, [job.id, message]);
      if (job.photo_id) {
        await query(`UPDATE photos SET status = 'FAILED', error = $2 WHERE id = $1 AND status <> 'DELETED'`, [job.photo_id, message]);
      }
    } else {
      await query(
        `UPDATE jobs SET status = 'RETRY', error = $2, run_at = now() + ($3 * interval '1 second'), updated_at = now() WHERE id = $1`,
        [job.id, message, model ? 20 : delaySeconds(job.attempts)],
      );
      if (job.photo_id) {
        await query(`UPDATE photos SET status = 'UPLOADED', error = $2 WHERE id = $1 AND status = 'PROCESSING'`, [job.photo_id, message]);
      }
    }
  }
  if (job.wedding_id && job.type === 'process-photo') await refreshWedding(job.wedding_id);
  // The purge job is no longer pending once finished, so queue the next daily run.
  if (job.type === 'purge') await schedulePurge();
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await query(
      `UPDATE jobs SET status = 'RETRY', run_at = now(), error = 'interrupted'
       WHERE status = 'RUNNING' AND updated_at < now() - interval '3 minutes'`,
    );
    await query(
      `INSERT INTO jobs (id, type, photo_id, wedding_id, status)
       SELECT gen_random_uuid(), 'process-photo', p.id, p.wedding_id, 'PENDING'
       FROM photos p
       WHERE p.status = 'UPLOADED'
         AND NOT EXISTS (
           SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.type = 'process-photo' AND j.status IN ('PENDING','RETRY','RUNNING')
         )
       LIMIT 3`,
    ).catch(() => {});
    const job = await claim();
    if (job) {
      try {
        if (job.type === 'process-photo') await processPhoto(job);
        else if (job.type === 'zip') await buildZip(job);
        else if (job.type === 'purge') await purge();
        await finish(job, null);
      } catch (error) {
        await finish(job, error);
      }
    } else if (Date.now() % 5 === 0) {
      await reconcile().catch(() => {});
    }
  } finally {
    ticking = false;
  }
}

export function startWorker() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error) => console.error(JSON.stringify({ worker: error.message })));
  }, 1500);
  schedulePurge().catch(() => {});
  tick().catch(() => {});
}
