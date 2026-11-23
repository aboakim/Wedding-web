// Run the production matching SQL (lib/match.js MATCH_SQL, expanded by lib/db.js)
// on a run's embeddings in an in-memory PGlite, and compare with eval/run_baseline.py.
// Usage: node eval/sql_parity.mjs <runDir> [threshold]
// Needs <runDir>/sql_input.json from: .venv/bin/python eval/export_sql_input.py <runDir>
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { expand } from '../lib/db.js';
import { MATCH_SQL, vectorLiteral } from '../lib/match.js';

const [runDir, thresholdArg] = process.argv.slice(2);
const threshold = Number(thresholdArg || 0.4);
const input = JSON.parse(fs.readFileSync(path.join(runDir, 'sql_input.json'), 'utf8'));
const db = new PGlite(); // in-memory only

await db.exec(`
CREATE TABLE weddings (id uuid PRIMARY KEY, status text, deleted_at timestamptz, expires_at timestamptz);
CREATE TABLE photos (id uuid PRIMARY KEY, wedding_id uuid, status text, filename text);
CREATE TABLE faces (id bigserial PRIMARY KEY, photo_id uuid, wedding_id uuid, embedding double precision[]);
CREATE INDEX faces_wedding ON faces (wedding_id);`);
const wedding = '00000000-0000-4000-8000-000000000001';
await db.query(`INSERT INTO weddings VALUES ($1, 'ACTIVE', NULL, NULL)`, [wedding]);
const photoId = new Map();
let n = 0;
for (const name of input.photos) {
  const id = `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
  photoId.set(name, id);
  await db.query(`INSERT INTO photos VALUES ($1,$2,'READY',$3)`, [id, wedding, name]);
}
for (let i = 0; i < input.embeddings.length; i += 1) {
  await db.query(`INSERT INTO faces (photo_id, wedding_id, embedding) VALUES ($1,$2,$3::float8[])`,
    [photoId.get(input.owner[i]), wedding, vectorLiteral(input.embeddings[i])]);
}
const byId = new Map([...photoId].map(([name, id]) => [id, name]));

let mismatches = 0;
const report = {};
for (const [target, ref] of Object.entries(input.refs)) {
  const sql = expand(MATCH_SQL, [vectorLiteral(ref), wedding, threshold]);
  const t0 = performance.now();
  const { rows } = await db.query(sql);
  const ms = performance.now() - t0;
  const got = rows.map((r) => [byId.get(r.photo_id), Number(r.score)]);
  const expected = Object.entries(input.expected[target]).filter(([, s]) => s >= threshold).sort((a, b) => b[1] - a[1]);
  const sameSet = got.length === expected.length && got.every(([name]) => input.expected[target][name] >= threshold);
  const maxDiff = Math.max(0, ...got.map(([name, s]) => Math.abs(s - input.expected[target][name])));
  const sorted = got.every((r, i) => i === 0 || got[i - 1][1] >= r[1]);
  if (!sameSet || maxDiff > 1e-4 || !sorted) mismatches += 1;
  report[target] = { matches: got.length, expected: expected.length, same_set: sameSet, max_score_diff: Number(maxDiff.toExponential(2)), sorted_desc: sorted, query_ms: Math.round(ms) };
}
console.log(JSON.stringify({ faces: input.embeddings.length, photos: input.photos.length, threshold, report, ok: mismatches === 0 }, null, 2));
process.exit(mismatches ? 1 : 0);
