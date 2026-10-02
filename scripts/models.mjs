import { access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const dir = path.join(process.cwd(), 'models');
await mkdir(dir, { recursive: true });
const base = 'https://vladmandic.github.io/face-api/model/';
const manifests = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'face_landmark_68_model-weights_manifest.json',
  'face_recognition_model-weights_manifest.json',
];

async function grab(name) {
  const dest = path.join(dir, name);
  try {
    await access(dest);
    return;
  } catch { /* download */ }
  process.stdout.write(`download ${name}\n`);
  const res = await fetch(base + name, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

for (const manifest of manifests) {
  await grab(manifest);
  const groups = JSON.parse(await readFile(path.join(dir, manifest), 'utf8'));
  for (const group of groups) {
    for (const file of group.paths) await grab(file);
  }
}
