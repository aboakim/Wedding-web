// Benchmark the real album worker (lib/jobs.js) on N album photos, isolated from the app's data.
// Run from an empty scratch directory (process.cwd() is where data/ is created):
//   cd <scratch> && ln -s <repo>/python python && \
//   PG_PORT=54391 FACE_PYTHON=<repo>/.venv/bin/python node <repo>/eval/bench_worker.mjs <albumDir> <N> <repo>/eval/out/baseline/faces.csv
// Photos are symlinked into <scratch>/data/objects (no copies). Prints JSON timing + parity.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { query } from '../lib/db.js';
import { enqueuePhoto } from '../lib/jobs.js';
import { embedFile } from '../lib/faces.js';

const [albumDir, nArg, facesCsv] = process.argv.slice(2);
const n = Number(nArg || 100);
if (!fs.existsSync(path.join(process.cwd(), 'python', 'face_server.py'))) {
  throw new Error('run from a scratch dir containing a python -> repo/python symlink');
}
const names = fs.readdirSync(albumDir).filter((f) => /\.jpe?g$/i.test(f)).sort().slice(0, n);

// Warm the engine so boot time is not counted.
await embedFile(path.join(albumDir, names[0]));

const userId = crypto.randomUUID();
const weddingId = crypto.randomUUID();
await query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, [userId, `bench-${userId}@local`]);
await query(
  `INSERT INTO weddings (id, user_id, name, couple, slug, status, processing_status)
   VALUES ($1, $2, 'bench', 'bench', $3, 'ACTIVE', 'CREATED')`,
  [weddingId, userId, `bench-${weddingId.slice(0, 8)}`],
);
const ids = new Map();
for (const name of names) {
  const id = crypto.randomUUID();
  ids.set(id, name);
  const key = `weddings/${weddingId}/originals/${id}`;
  const dest = path.join(process.cwd(), 'data', 'objects', key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(path.join(albumDir, name), dest);
  await query(
    `INSERT INTO photos (id, wedding_id, storage_key_original, storage_key_thumbnail, filename, status)
     VALUES ($1,$2,$3,$4,$5,'UPLOADED')`,
    [id, weddingId, key, `weddings/${weddingId}/thumbnails/${id}.jpg`, name],
  );
}

const t0 = Date.now();
for (const id of ids.keys()) await enqueuePhoto(id, weddingId);
let done = 0;
while (done < names.length) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM photos WHERE wedding_id = $1 AND status IN ('READY','FAILED')`, [weddingId]);
  done = rows[0].n;
  if (Date.now() - t0 > 15 * 60 * 1000) throw new Error('timeout');
}
const seconds = (Date.now() - t0) / 1000;

const { rows } = await query(`SELECT id, status, faces FROM photos WHERE wedding_id = $1`, [weddingId]);
const expected = {};
for (const line of fs.readFileSync(facesCsv, 'utf8').trim().split('\n').slice(1)) {
  const photo = line.split(',')[0];
  expected[photo] = (expected[photo] || 0) + 1;
}
const mismatched = rows.filter((r) => r.faces !== (expected[ids.get(r.id)] || 0)).map((r) => ids.get(r.id));
console.log(JSON.stringify({
  photos: names.length,
  seconds,
  seconds_per_photo: Number((seconds / names.length).toFixed(3)),
  failed: rows.filter((r) => r.status === 'FAILED').length,
  faces: rows.reduce((s, r) => s + r.faces, 0),
  face_count_parity_with_harness: mismatched.length === 0,
  mismatched,
}));
process.exit(0);
