import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function readOrCreate(name) {
  const file = path.join(process.cwd(), 'data', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

export function appSecret() {
  return process.env.APP_SECRET || readOrCreate('secret');
}

export function webhookSecret() {
  return process.env.PAYMENT_WEBHOOK_SECRET || readOrCreate('webhook.secret');
}

export function hmac(value) {
  return crypto.createHmac('sha256', appSecret()).update(value).digest('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function token() {
  return crypto.randomBytes(32).toString('base64url');
}
