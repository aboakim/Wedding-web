import crypto from 'crypto';
import { query, tx } from './db.js';
import { webhookSecret } from './secret.js';
import { audit } from './auth.js';

const MERCHANT = () => process.env.PAYMENT_MERCHANT_ID || 'wedding-local';

function sign(raw) {
  return crypto.createHmac('sha256', webhookSecret()).update(raw).digest('hex');
}

function signed(raw, header) {
  const expected = sign(raw);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function applyVerified(raw, signature) {
  if (!signed(raw, signature)) {
    const error = new Error('bad signature');
    error.status = 401;
    error.code = 'SIGNATURE';
    throw error;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    const error = new Error('bad json');
    error.status = 400;
    error.code = 'BODY';
    throw error;
  }
  const { eventId, transactionId, orderId, amount, currency, status, merchantId } = body;
  if (!eventId || !transactionId || !orderId || !Number.isInteger(amount) || !currency || !status) {
    const error = new Error('incomplete');
    error.status = 400;
    error.code = 'BODY';
    throw error;
  }
  if (merchantId !== MERCHANT()) {
    const error = new Error('merchant');
    error.status = 400;
    error.code = 'MERCHANT';
    throw error;
  }

  return tx(async (client) => {
    const inserted = await client.query(
      `INSERT INTO payments (id, order_id, provider, provider_transaction_id, provider_event_id, amount, currency, status, raw_reference)
       VALUES ($1,$2,'sandbox',$3,$4,$5,$6,$7,$8)
       ON CONFLICT (provider_event_id) DO NOTHING
       RETURNING id`,
      [crypto.randomUUID(), orderId, transactionId, eventId, amount, currency, status, raw.slice(0, 1500)],
    );
    if (!inserted.rowCount) return { duplicate: true };

    const found = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = found.rows[0];
    if (!order || Number(order.amount) !== Number(amount) || order.currency !== currency) {
      const error = new Error('amount');
      error.status = 400;
      error.code = 'AMOUNT';
      throw error;
    }

    if (status === 'SUCCEEDED' && order.status !== 'PAID' && order.status !== 'REFUNDED') {
      await client.query(`UPDATE orders SET status = 'PAID', updated_at = now() WHERE id = $1`, [orderId]);
      await client.query(
        `UPDATE weddings w SET status = 'ACTIVE',
           expires_at = now() + (p.retention_days * interval '1 day'),
           updated_at = now()
         FROM orders o JOIN plans p ON p.id = o.plan_id
         WHERE w.order_id = o.id AND o.id = $1 AND w.status = 'RESERVED'`,
        [orderId],
      );
      await audit(client, { userId: order.user_id, action: 'PAYMENT_CONFIRMED', resourceType: 'order', resourceId: orderId });
    } else if (status === 'FAILED' && (order.status === 'PENDING' || order.status === 'PAYMENT_STARTED')) {
      await client.query(`UPDATE orders SET status = 'FAILED', updated_at = now() WHERE id = $1`, [orderId]);
    } else if (status === 'REFUNDED' && (order.status === 'PAID' || order.status === 'REFUND_PENDING')) {
      await client.query(`UPDATE orders SET status = 'REFUNDED', updated_at = now() WHERE id = $1`, [orderId]);
      await client.query(
        `UPDATE weddings SET status = 'ARCHIVED', processing_status = 'ARCHIVED', deleted_at = COALESCE(deleted_at, now()), updated_at = now() WHERE order_id = $1`,
        [orderId],
      );
      await audit(client, { userId: order.user_id, action: 'REFUND_CREATED', resourceType: 'order', resourceId: orderId });
    }
    return { duplicate: false, status: order.status };
  });
}

export async function charge(order, outcome) {
  if (process.env.PAYMENT_DISABLED === '1') {
    const error = new Error('provider down');
    error.code = 'PROVIDER_DOWN';
    throw error;
  }
  const eventId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const status = outcome === 'fail' ? 'FAILED' : 'SUCCEEDED';
  await query(
    `INSERT INTO provider_ledger (id, order_id, event_id, transaction_id, amount, currency, status, merchant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [crypto.randomUUID(), order.id, eventId, transactionId, order.amount, order.currency, status, MERCHANT()],
  );
  const raw = JSON.stringify({
    eventId,
    transactionId,
    orderId: order.id,
    amount: Number(order.amount),
    currency: order.currency,
    status,
    merchantId: MERCHANT(),
  });
  try {
    return await applyVerified(raw, sign(raw));
  } catch (error) {
    return { queued: true, error: error.code || 'WEBHOOK' };
  }
}

export async function replay(orderId) {
  const { rows } = await query(
    `SELECT * FROM provider_ledger WHERE order_id = $1 AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const raw = JSON.stringify({
    eventId: row.event_id,
    transactionId: row.transaction_id,
    orderId: row.order_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: 'SUCCEEDED',
    merchantId: row.merchant_id,
  });
  return applyVerified(raw, sign(raw));
}

export async function reconcile() {
  const seconds = process.env.NODE_ENV === 'production' ? 600 : 20;
  const { rows } = await query(
    `SELECT l.* FROM provider_ledger l
     JOIN orders o ON o.id = l.order_id
     WHERE l.status = 'SUCCEEDED' AND o.status IN ('PENDING','PAYMENT_STARTED')
       AND l.created_at < now() - ($1 * interval '1 second')`,
    [seconds],
  );
  for (const row of rows) {
    const raw = JSON.stringify({
      eventId: row.event_id,
      transactionId: row.transaction_id,
      orderId: row.order_id,
      amount: Number(row.amount),
      currency: row.currency,
      status: 'SUCCEEDED',
      merchantId: row.merchant_id,
    });
    await applyVerified(raw, sign(raw)).catch(() => {});
  }
}

export function merchantId() {
  return MERCHANT();
}
