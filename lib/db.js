import fs from 'fs';
import net from 'net';
import path from 'path';
import pg from 'pg';
import { migrate } from './migrate.js';

const PORT = Number(process.env.PG_PORT || 54329);
const state = globalThis.__weddingDb || (globalThis.__weddingDb = { pool: null, starting: null, worker: false });

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startEmbedded() {
  if (globalThis.__pglite?.server) return;
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const dir = path.join(process.cwd(), 'data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  if (db.waitReady) await db.waitReady;
  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: '127.0.0.1',
    maxConnections: 30,
  });
  await server.start();
  globalThis.__pglite = { db, server };
}

async function ensureServer() {
  if (process.env.DATABASE_URL) return;
  if (await portOpen(PORT)) return;
  const lock = path.join(process.cwd(), 'data', 'pg.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await fs.promises.open(lock, 'wx');
  } catch {
    for (let i = 0; i < 90; i += 1) {
      if (await portOpen(PORT)) return;
      await sleep(1000);
    }
    throw new Error('database start timeout');
  }
  try {
    await startEmbedded();
  } finally {
    await handle.close();
    await fs.promises.unlink(lock).catch(() => {});
  }
}

export async function ready() {
  if (state.pool) return state.pool;
  if (!state.starting) {
    state.starting = (async () => {
      await ensureServer();
      const next = new pg.Pool({
        connectionString: connectionString(),
        max: 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      });
      try {
        await next.query('SELECT 1');
      } catch (error) {
        await next.end().catch(() => {});
        throw error;
      }
      state.pool = next;
      await migrate((text, params) => state.pool.query(text, params));
      if (!state.worker) {
        state.worker = true;
        const { startWorker } = await import('./jobs.js');
        startWorker();
      }
      return state.pool;
    })().catch((error) => {
      state.starting = null;
      state.pool = null;
      throw error;
    });
  }
  return state.starting;
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) return `ARRAY[${value.map(literal).join(',')}]`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function expand(text, params = []) {
  if (!params?.length) return text;
  return text.replace(/\$(\d+)/g, (token, number) => {
    const index = Number(number) - 1;
    return index < params.length ? literal(params[index]) : token;
  });
}

async function run(text, params) {
  const db = await ready();
  return db.query(expand(text, params));
}

export async function query(text, params) {
  try {
    return await run(text, params);
  } catch (error) {
    if (!state.pool) {
      console.error('DB_BOOT_FAIL', error);
      const down = new Error('database unavailable');
      down.code = 'DB_DOWN';
      throw down;
    }
    throw error;
  }
}

export async function tx(fn) {
  const db = await ready();
  const client = await db.connect();
  const wrapped = {
    query(text, params) {
      return client.query(expand(text, params));
    },
  };
  try {
    await wrapped.query('BEGIN');
    const result = await fn(wrapped);
    await wrapped.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function clientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}
