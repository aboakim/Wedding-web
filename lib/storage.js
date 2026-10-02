import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { appSecret } from './secret.js';

const root = () => path.join(process.cwd(), 'data', 'objects');
const uploads = () => path.join(process.cwd(), 'data', 'uploads');

function safeKey(key) {
  if (!/^weddings\/[0-9a-f-]{36}\/(originals|thumbnails|zips)\/[0-9a-f-]{36}(\.jpg|\.zip)?$/.test(key)) {
    throw new Error('bad storage key');
  }
  return key;
}

function fileFor(key) {
  const full = path.join(root(), safeKey(key));
  if (!full.startsWith(root())) throw new Error('bad storage key');
  return full;
}

export function partPath(photoId, part) {
  if (!/^[0-9a-f-]{36}$/.test(photoId) || !Number.isInteger(part) || part < 1) throw new Error('bad part');
  return path.join(uploads(), photoId, String(part));
}

export function signUpload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', appSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readUploadToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', appSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

export async function writePart(photoId, part, bytes) {
  const dest = partPath(photoId, part);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, bytes);
}

export async function readAssembled(photoId, partCount) {
  const chunks = [];
  for (let part = 1; part <= partCount; part += 1) {
    chunks.push(await fs.promises.readFile(partPath(photoId, part)));
  }
  return Buffer.concat(chunks);
}

export async function partExists(photoId, part) {
  try {
    await fs.promises.access(partPath(photoId, part));
    return true;
  } catch {
    return false;
  }
}

export async function removeParts(photoId) {
  await fs.promises.rm(path.join(uploads(), photoId), { recursive: true, force: true });
}

export async function putObject(key, bytes) {
  const dest = fileFor(key);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, dest);
}

export async function getObject(key) {
  try {
    return await fs.promises.readFile(fileFor(key));
  } catch {
    return null;
  }
}

export function localPath(key) {
  return fileFor(key);
}

export async function removeObject(key) {
  await fs.promises.rm(fileFor(key), { force: true });
}

export function objectExists(key) {
  return fs.existsSync(fileFor(key));
}
