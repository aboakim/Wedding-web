import { query } from '@/lib/db';
import { rateLimit, userFromRequest } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';
import { charge, replay } from '@/lib/payments';
import { readCard } from '@/lib/card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  if (!(await rateLimit(`pay:${user.id}`, 15, 3600))) return fail('RATE', 'Շատ փորձ եղավ։ Փորձեք մի փոքր ուշ։', 429);
  const body = await readJson(req).catch(() => null);
  if (!body?.orderId) return fail('BODY', 'Սխալ հարցում։', 400);
  const { rows } = await query(`SELECT * FROM orders WHERE id = $1 AND user_id = $2`, [body.orderId, user.id]);
  const order = rows[0];
  if (!order) return fail('NOT_FOUND', 'Պատվերը չի գտնվել։', 404);
  if (order.status === 'PAID' || order.status === 'REFUNDED') return ok({ status: order.status });
  if (order.status === 'CANCELLED') return fail('STATE', 'Պատվերը փակված է։', 409);
  if (process.env.PAYMENT_DISABLED === '1' || process.env.PAYMENT_PROVIDER === 'live') {
    return fail('PROVIDER_DOWN', 'Վճարային համակարգը ժամանակավորապես հասանելի չէ։ Խնդրում ենք փորձել մի փոքր ուշ։', 503);
  }
  let card;
  try {
    card = readCard(body.card);
  } catch (error) {
    const messages = {
      DECLINED: 'Բանկը մերժեց քարտը։ Փորձեք այլ քարտ։',
      EXPIRY: 'Քարտի ժամկետը սխալ է կամ անցել է։',
      CVV: 'CVV-ն սխալ է։',
      HOLDER: 'Գրեք քարտատիրոջ անունը։',
    };
    return fail(error.code || 'CARD', messages[error.code] || 'Քարտի համարը սխալ է։ Օգտագործեք 4111 1111 1111 1111։', 400);
  }
  await query(
    `UPDATE orders SET status = 'PAYMENT_STARTED', updated_at = now() WHERE id = $1 AND status IN ('PENDING','FAILED','PAYMENT_STARTED')`,
    [order.id],
  );
  try {
    await charge({ ...order, status: 'PAYMENT_STARTED' }, 'success');
  } catch (error) {
    if (error.code === 'PROVIDER_DOWN') {
      return fail('PROVIDER_DOWN', 'Վճարային համակարգը ժամանակավորապես հասանելի չէ։ Խնդրում ենք փորձել մի փոքր ուշ։', 503);
    }
    if (error.code === '23505') await replay(order.id);
    else throw error;
  }
  await query(
    `UPDATE payments SET card_brand = $1, card_last4 = $2
     WHERE order_id = $3 AND status = 'SUCCEEDED' AND card_last4 IS NULL`,
    [card.brand, card.last4, order.id],
  ).catch(() => {});
  const fresh = await query(`SELECT status, amount, currency FROM orders WHERE id = $1`, [order.id]);
  return ok({
    status: fresh.rows[0].status,
    amount: Number(fresh.rows[0].amount),
    currency: fresh.rows[0].currency,
    cardBrand: card.brand,
    cardLast4: card.last4,
  });
});
