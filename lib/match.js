import { query } from './db.js';

export async function matchThreshold() {
  if (process.env.FACE_MATCH_THRESHOLD) {
    const fromEnv = Number(process.env.FACE_MATCH_THRESHOLD);
    if (Number.isFinite(fromEnv)) return fromEnv;
  }
  const { rows } = await query(`SELECT value FROM settings WHERE key = 'FACE_MATCH_THRESHOLD'`);
  const value = Number(rows[0]?.value);
  return Number.isFinite(value) ? value : 0.5;
}

export async function matchFaces(weddingId, embedding) {
  if (!Array.isArray(embedding) || embedding.length !== 128 || embedding.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return [];
  }
  const threshold = await matchThreshold();
  const vector = `{${embedding.map((n) => Number(n).toFixed(8)).join(',')}}`;
  const { rows } = await query(
    `SELECT f.photo_id
     FROM faces f
     JOIN photos p ON p.id = f.photo_id
     JOIN weddings w ON w.id = p.wedding_id
     CROSS JOIN LATERAL unnest(f.embedding, $1::float8[]) AS u(e, q)
     WHERE f.wedding_id = $2
       AND p.status = 'READY'
       AND w.status = 'ACTIVE'
       AND w.deleted_at IS NULL
       AND (w.expires_at IS NULL OR w.expires_at > now())
     GROUP BY f.photo_id
     HAVING SQRT(SUM(power(u.e - u.q, 2))) <= $3`,
    [vector, weddingId, threshold],
  );
  return rows.map((row) => row.photo_id);
}
