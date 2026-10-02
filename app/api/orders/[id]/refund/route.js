import crypto from 'crypto';
import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { applyVerified, merchantId } from '@/lib/payments';
import { webhookSecret } from '@/lib/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const { rows } = await query(`SELECT * FROM orders WHERE id = $1`, [id]);
  const order = rows[0];
  if (!order) return fail('NOT_FOUND', 'Պատվերը չի գտնվել։', 404);
  const allowed = order.user_id === user.id || user.role === 'FINANCE' || user.role === 'SUPER_ADMIN';
  if (!allowed) return fail('FORBIDDEN', 'Այս գործողությունը թույլատրված չէ։', 403);
  if (user.role === 'SUPPORT') return fail('FORBIDDEN', 'Այս գործողությունը թույլատրված չէ։', 403);
  if (order.status !== 'PAID') return fail('STATE', 'Վերադարձը հնարավոր է միայն վճարված պատվերի համար։', 409);
  if (process.env.PAYMENT_DISABLED === '1') {
    return fail('PROVIDER_DOWN', 'Վճարային համակարգը ժամանակավորապես հասանելի չէ։ Խնդրում ենք փորձել մի փոքր ուշ։', 503);
  }
  await query(`UPDATE orders SET status = 'REFUND_PENDING', updated_at = now() WHERE id = $1 AND status = 'PAID'`, [order.id]);
  const eventId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  await query(
    `INSERT INTO provider_ledger (id, order_id, event_id, transaction_id, amount, currency, status, merchant_id)
     VALUES ($1,$2,$3,$4,$5,$6,'REFUNDED',$7)`,
    [crypto.randomUUID(), order.id, eventId, transactionId, order.amount, order.currency, merchantId()],
  );
  const raw = JSON.stringify({
    eventId,
    transactionId,
    orderId: order.id,
    amount: Number(order.amount),
    currency: order.currency,
    status: 'REFUNDED',
    merchantId: merchantId(),
  });
  const signature = crypto.createHmac('sha256', webhookSecret()).update(raw).digest('hex');
  await applyVerified(raw, signature);
  const fresh = await query(`SELECT status FROM orders WHERE id = $1`, [order.id]);
  return ok({ status: fresh.rows[0].status });
});
