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

// One row per matching photo with its best face score (max cosine over the
// photo's faces), best first. Exported so eval can run the exact production SQL.
export const MATCH_SQL = `SELECT f.photo_id, MAX(scored.sim) AS score
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
       AND scored.sim >= $3
     GROUP BY f.photo_id
     ORDER BY score DESC, f.photo_id`;

export function vectorLiteral(embedding) {
  return `{${embedding.map((n) => Number(n).toFixed(8)).join(',')}}`;
}

// Returns [{ photoId, score }] sorted by score, best first.
export async function matchFaces(weddingId, embedding) {
  if (!Array.isArray(embedding) || embedding.length !== DIM || embedding.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return [];
  }
  const threshold = await matchThreshold();
  const { rows } = await query(MATCH_SQL, [vectorLiteral(embedding), weddingId, threshold]);
  return rows.map((row) => ({ photoId: row.photo_id, score: Number(row.score) }));
}
