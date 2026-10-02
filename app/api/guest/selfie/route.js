import crypto from 'crypto';
import { query, clientIp } from '@/lib/db';
import { cookie, rateLimit } from '@/lib/auth';
import { embedSelfie } from '@/lib/faces';
import { fail, ok, route } from '@/lib/http';
import { matchFaces } from '@/lib/match';
import { sha256, token } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_SECONDS = 45 * 60;

export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!(await rateLimit(`selfie:${ip}`, 8, 3600))) return fail('RATE', 'Շատ փորձ եղավ։ Փորձեք մի փոքր ուշ։', 429);
  const form = await req.formData();
  const slug = String(form.get('slug') || '');
  const consent = String(form.get('consent') || '');
  const file = form.get('selfie');
  if (consent !== 'yes') return fail('CONSENT', 'Շարունակելու համար հաստատեք, որ համաձայն եք։', 400);
  if (!file || typeof file === 'string') return fail('SELFIE', 'Սելֆին չի ուղարկվել։', 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 50 || bytes.length > 8 * 1024 * 1024) {
    bytes.fill(0);
    return fail('SELFIE', 'Սելֆին չափազանց մեծ է կամ դատարկ է։', 400);
  }
  const wedding = await query(
    `SELECT id, status, deleted_at, expires_at FROM weddings WHERE slug = $1`,
    [slug],
  );
  const row = wedding.rows[0];
  if (!row || row.deleted_at || row.status !== 'ACTIVE') {
    bytes.fill(0);
    return fail('NOT_FOUND', 'Հարսանիքը դեռ բացված չէ։', 404);
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    bytes.fill(0);
    return fail('EXPIRED', 'Այս հարսանիքի ժամկետն ավարտվել է։', 410);
  }
  let embedding;
  try {
    embedding = await embedSelfie(bytes);
  } catch (error) {
    bytes.fill(0);
    return fail('FACE', error.message, 422);
  }
  bytes.fill(0);
  const photoIds = await matchFaces(row.id, embedding);
  embedding.fill(0);
  const policy = await query(`SELECT value FROM settings WHERE key = 'POLICY_VERSION'`);
  const raw = token();
  const sessionId = crypto.randomUUID();
  await query(
    `INSERT INTO guest_sessions (id, token_hash, wedding_id, photo_ids, expires_at)
     VALUES ($1,$2,$3,$4::uuid[], now() + ($5 * interval '1 second'))`,
    [sessionId, sha256(raw), row.id, photoIds, SESSION_SECONDS],
  );
  await query(
    `INSERT INTO consents (id, guest_session_id, policy_version) VALUES ($1,$2,$3)`,
    [crypto.randomUUID(), sessionId, policy.rows[0]?.value || '2026-10-02'],
  );
  return ok({ count: photoIds.length }, 200, { 'set-cookie': cookie('guest', raw, SESSION_SECONDS) });
});
