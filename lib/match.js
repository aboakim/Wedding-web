import { query } from './db.js';

const DIM = 512;
const DEFAULT_SIMILARITY = 0.4;

export async function matchThreshold() {
  if (process.env.FACE_MATCH_SIMILARITY) {
    const fromEnv = Number(process.env.FACE_MATCH_SIMILARITY);
    if (Number.isFinite(fromEnv)) return fromEnv;
  }
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'FACE_MATCH_SIMILARITY'`);
  const value = Number(rows[0]?.value);
  return Number.isFinite(value) ? value : DEFAULT_SIMILARITY;
}

export async function matchFaces(weddingId, embedding) {
  if (!Array.isArray(embedding) || embedding.length !== DIM || embedding.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return [];
  }
  const threshold = await matchThreshold();
  const vector = `{${embedding.map((n) => Number(n).toFixed(8)).join(',')}}`;
  const { rows } = await query(
    `SELECT DISTINCT f.photo_id
     FROM faces f
     JOIN photos p ON p.id = f.photo_id
     JOIN weddings w ON w.id = p.wedding_id
     CROSS JOIN LATERAL (
       SELECT
         SUM(u.e * u.q) / NULLIF(SQRT(SUM(u.e * u.e)) * SQRT(SUM(u.q * u.q)), 0) AS sim,
         COUNT(*)::int AS n
       FROM unnest(f.embedding, $1::float8[]) AS u(e, q)
     ) scored
     WHERE f.wedding_id = $2
       AND p.status = 'READY'
       AND array_length(f.embedding, 1) = ${DIM}
       AND w.status = 'ACTIVE'
       AND w.deleted_at IS NULL
       AND (w.expires_at IS NULL OR w.expires_at > now())
       AND scored.n = ${DIM}
       AND scored.sim >= $3`,
    [vector, weddingId, threshold],
  );
  return rows.map((row) => row.photo_id);
}
