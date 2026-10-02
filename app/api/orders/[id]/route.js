import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { planFeatures } from '@/lib/format';
import { fail, ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const { rows } = await query(
    `SELECT o.id, o.status, o.amount, o.currency, o.plan_id, o.created_at,
            w.id AS wedding_id, w.slug, w.couple, w.occasion, w.status AS wedding_status,
            p.name AS plan_name, COALESCE(ofr.max_photos, p.max_photos) AS max_photos, p.features,
            COALESCE(ofr.photos_plus, false) AS photos_plus,
            pay.card_brand, pay.card_last4
     FROM orders o
     LEFT JOIN weddings w ON w.order_id = o.id
     LEFT JOIN plans p ON p.id = o.plan_id
     LEFT JOIN plan_offers ofr ON ofr.plan_id = p.id AND ofr.occasion = w.occasion
     LEFT JOIN LATERAL (
       SELECT card_brand, card_last4 FROM payments
       WHERE order_id = o.id AND status = 'SUCCEEDED'
       ORDER BY created_at DESC LIMIT 1
     ) pay ON true
     WHERE o.id = $1 AND o.user_id = $2`,
    [id, user.id],
  );
  if (!rows[0]) return fail('NOT_FOUND', 'Պատվերը չի գտնվել։', 404);
  const row = rows[0];
  return ok({
    ...row,
    amount: Number(row.amount),
    max_photos: Number(row.max_photos),
    features: { ...planFeatures(row), photos_plus: row.photos_plus === true },
  });
});
