import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const PORT = 53721;
const HOST = `http://127.0.0.1:${PORT}`;
const MAX_EDGE = 1600;
const state = globalThis.__faceEngine || (globalThis.__faceEngine = { boot: null, child: null });

const NONE = 'Չկարողացանք գտնել ձեր դեմքը։ Խնդրում ենք փորձել նորից՝ լավ լուսավորության պայմաններում';
const MULTIPLE = 'Խնդրում ենք սելֆին անել այնպես, որ նկարում միայն դուք լինեք';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jpeg(input) {
  return sharp(input)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// FACE_PYTHON points at the interpreter that has python/requirements.txt installed
// (e.g. a venv). Without it: the Windows launcher on Windows, python3 elsewhere.
function pythonCommand() {
  if (process.env.FACE_PYTHON) return [process.env.FACE_PYTHON, []];
  return process.platform === 'win32' ? ['py', ['-3']] : ['python3', []];
}

function startProcess() {
  const script = path.join(process.cwd(), 'python', 'face_server.py');
  const [command, args] = pythonCommand();
  const child = spawn(command, [...args, script], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: 'ignore',
  });
  // Without this listener a missing interpreter (ENOENT) is an unhandled 'error' event and crashes the server.
  child.on('error', (error) => {
    console.error(JSON.stringify({ faceEngine: `spawn ${command} failed: ${error.code || error.message}` }));
    if (state.child === child) state.child = null;
  });
  child.on('exit', () => {
    if (state.child === child) state.child = null;
  });
  state.child = child;
}

async function healthy() {
  try {
    const res = await fetch(`${HOST}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = await res.json();
    return body.ok === true && body.dim === 512;
  } catch {
    return false;
  }
}

async function engine() {
  if (await healthy()) return;
  if (!state.boot) {
    state.boot = (async () => {
      if (!(await healthy())) startProcess();
      for (let i = 0; i < 150; i += 1) {
        if (await healthy()) return;
        await sleep(2000);
      }
      throw new Error('Մոդելները չեն բացվել։ Տեղադրեք Python գրադարանները՝ pip install -r python/requirements.txt');
    })().finally(() => {
      state.boot = null;
    });
  }
  await state.boot;
}

async function ask(buffer, mode) {
  await engine();
  const res = await fetch(`${HOST}/embed?mode=${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: buffer,
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    if (body.error === 'none') throw new Error(NONE);
    if (body.error === 'multiple') throw new Error(MULTIPLE);
    throw new Error('Նկարը չկարողացանք կարդալ։ Փորձեք նորից։');
  }
  return (body.faces || []).filter((row) => Array.isArray(row) && row.length === 512);
}

export async function embedFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return ask(await jpeg(filePath), 'album');
}

export async function embedSelfie(buffer) {
  const faces = await ask(await jpeg(buffer), 'selfie');
  if (!faces.length) throw new Error(NONE);
  if (faces.length > 1) throw new Error(MULTIPLE);
  return faces[0];
}
