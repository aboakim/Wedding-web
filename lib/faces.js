import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

let apiPromise;
let chain = Promise.resolve();
const MAX_EDGE = 1280;

function lock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

async function api() {
  if (!apiPromise) {
    apiPromise = loadModels().catch((error) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
}

async function loadModels() {
  const faceapi = await import('@vladmandic/face-api/dist/face-api.node-wasm.js');
  const tf = faceapi.tf;
  const wasmDir = path.join(process.cwd(), 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist');
  if (tf.wasm?.setWasmPaths) tf.wasm.setWasmPaths(wasmDir + path.sep);
  try {
    await tf.setBackend('wasm');
    await tf.ready();
  } catch {
    await import('@tensorflow/tfjs-backend-cpu');
    await tf.setBackend('cpu');
    await tf.ready();
  }
  const dir = path.join(process.cwd(), 'models');
  const manifest = path.join(dir, 'ssd_mobilenetv1_model-weights_manifest.json');
  if (!fs.existsSync(manifest)) {
    throw new Error('Մոդելները չկան։ Գործարկեք npm run models');
  }
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(dir);
  return faceapi;
}

async function detect(input, options) {
  const faceapi = await api();
  const tf = faceapi.tf;
  const { data, info } = await sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
  try {
    const found = await faceapi.detectAllFaces(tensor, options).withFaceLandmarks().withFaceDescriptors();
    return found;
  } finally {
    tensor.dispose();
  }
}

export function embedFile(filePath) {
  return lock(async () => {
    const faceapi = await api();
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35, maxResults: 30 });
    const found = await detect(filePath, options);
    return found.map((row) => Array.from(row.descriptor));
  });
}

export function embedSelfie(buffer) {
  return lock(async () => {
    const faceapi = await api();
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 5 });
    const found = await detect(buffer, options);
    if (!found.length) {
      throw new Error('Չկարողացանք գտնել ձեր դեմքը։ Խնդրում ենք փորձել նորից՝ լավ լուսավորության պայմաններում');
    }
    if (found.length > 1) {
      throw new Error('Խնդրում ենք սելֆին անել այնպես, որ նկարում միայն դուք լինեք');
    }
    return Array.from(found[0].descriptor);
  });
}
