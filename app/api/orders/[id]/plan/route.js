import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const body = await readJson(req).catch(() => null);
  if (!body) return fail('BODY', 'Սխալ հարցում։', 400);
  const planId = String(body.planId || '');
  const { id } = await params;
  const plan = await query(`SELECT id, price, currency FROM plans WHERE id = $1 AND active = true`, [planId]);
  if (!plan.rows[0]) return fail('PLAN', 'Փաթեթը չի գտնվել։', 404);
  const chosen = plan.rows[0];
  const wedding = await query(`SELECT occasion FROM weddings WHERE order_id = $1`, [id]);
  const occasion = wedding.rows[0]?.occasion || 'WEDDING';
  const offer = await query(
    `SELECT price FROM plan_offers WHERE plan_id = $1 AND occasion = $2`,
    [chosen.id, occasion],
  );
  const price = offer.rows[0] ? Number(offer.rows[0].price) : Number(chosen.price);
  const updated = await query(
    `UPDATE orders
     SET plan_id = $1,
         amount = CASE WHEN status = 'PAID' THEN amount ELSE $2 END,
         currency = CASE WHEN status = 'PAID' THEN currency ELSE $3 END,
         updated_at = now()
     WHERE id = $4 AND user_id = $5 AND status IN ('PENDING','FAILED','PAYMENT_STARTED','PAID')
     RETURNING id, status, amount, currency, plan_id`,
    [chosen.id, price, chosen.currency, id, user.id],
  );
  if (!updated.rows[0]) return fail('ORDER', 'Այս պատվերի փաթեթը այլևս հնարավոր չէ փոխել։', 409);
  return ok({
    ...updated.rows[0],
    amount: Number(updated.rows[0].amount),
  });
});
