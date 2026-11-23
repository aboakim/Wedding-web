// Preprocess album + reference photos exactly as production does (lib/faces.js jpeg()).
// Usage: node eval/preprocess.mjs <albumDir> <outDir> [refFile ...]
// Writes <outDir>/album/<name>.jpg, <outDir>/refs/<name>.jpg and <outDir>/meta.json.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { jpeg } from '../lib/faces.js';

const [albumDir, outDir, ...refs] = process.argv.slice(2);
if (!albumDir || !outDir) {
  console.error('usage: node eval/preprocess.mjs <albumDir> <outDir> [refFile ...]');
  process.exit(2);
}

const JPEG = /\.(jpe?g)$/i;
const jobs = [
  ...fs.readdirSync(albumDir).filter((name) => JPEG.test(name)).sort().map((name) => ({ kind: 'album', src: path.join(albumDir, name), name })),
  ...refs.map((src) => ({ kind: 'refs', src, name: path.basename(src) })),
];
for (const kind of ['album', 'refs']) fs.mkdirSync(path.join(outDir, kind), { recursive: true });

const meta = {};
const started = Date.now();
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    try {
      const raw = await fs.promises.readFile(job.src);
      const info = await sharp(raw).rotate().metadata();
      const orient = info.orientation || 1;
      const [ow, oh] = orient >= 5 ? [info.height, info.width] : [info.width, info.height];
      const out = await jpeg(raw);
      const outInfo = await sharp(out).metadata();
      await fs.promises.writeFile(path.join(outDir, job.kind, job.name), out);
      meta[`${job.kind}/${job.name}`] = { orig_w: ow, orig_h: oh, pre_w: outInfo.width, pre_h: outInfo.height, bytes: raw.length };
    } catch (error) {
      meta[`${job.kind}/${job.name}`] = { error: String(error.message || error) };
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
const errors = Object.values(meta).filter((m) => m.error).length;
console.log(JSON.stringify({ files: jobs.length, errors, seconds: (Date.now() - started) / 1000 }));
