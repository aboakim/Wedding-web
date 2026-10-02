import crypto from 'crypto';
import { query, tx, clientIp } from '@/lib/db';
import { audit, rateLimit, userFromRequest } from '@/lib/auth';
import { fail, ok, readJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slug() {
  return crypto.randomBytes(6).toString('hex');
}

export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  if (!(await rateLimit(`order:${user.id}`, 20, 3600))) return fail('RATE', 'Շատ փորձ եղավ։ Փորձեք մի փոքր ուշ։', 429);
  const body = await readJson(req).catch(() => null);
  if (!body) return fail('BODY', 'Սխալ հարցում։', 400);
  const planId = String(body.planId || '');
  const couple = String(body.couple || '').trim();
  const name = String(body.name || couple).trim();
  const date = String(body.date || '');
  const idempotencyKey = String(body.idempotencyKey || '');
  const occasion = ['WEDDING', 'CHRISTENING', 'BIRTHDAY', 'GATHERING', 'LAST_BELL', 'PARTY', 'OTHER'].includes(body.occasion) ? body.occasion : '';
  if (!occasion) return fail('OCCASION', 'Ընտրեք առիթը։', 400);
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return fail('IDEMPOTENCY', 'Վճարման բանալին սխալ է։', 400);
  if (couple.length < 2 || couple.length > 80 || name.length > 80) return fail('NAME', 'Գրեք անունը։', 400);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('DATE', 'Ամսաթիվը սխալ է։', 400);

  const existing = await query(
    `SELECT o.id, o.status, o.amount, o.currency, o.plan_id, w.id AS wedding_id, w.slug
     FROM orders o LEFT JOIN weddings w ON w.order_id = o.id
     WHERE o.idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].user_id) {
      /* loaded below */
    }
    const owner = await query(`SELECT user_id FROM orders WHERE id = $1`, [existing.rows[0].id]);
    if (owner.rows[0].user_id !== user.id) return fail('IDEMPOTENCY', 'Այս բանալին արդեն օգտագործված է։', 409);
    return ok(existing.rows[0]);
  }

  const plan = await query(`SELECT * FROM plans WHERE id = $1 AND active = true`, [planId]);
  if (!plan.rows[0]) return fail('PLAN', 'Փաթեթը չի գտնվել։', 404);
  const chosen = plan.rows[0];
  const features = chosen.features || {};
  const offer = await query(
    `SELECT price, max_photos FROM plan_offers WHERE plan_id = $1 AND occasion = $2`,
    [chosen.id, occasion],
  );
  const price = offer.rows[0] ? Number(offer.rows[0].price) : Number(chosen.price);
  const ip = clientIp(req);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderId = crypto.randomUUID();
    const weddingId = crypto.randomUUID();
    const publicSlug = slug();
    try {
      const created = await tx(async (client) => {
        await client.query(
          `INSERT INTO orders (id, user_id, plan_id, amount, currency, status, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,'PENDING',$6)`,
          [orderId, user.id, chosen.id, price, chosen.currency, idempotencyKey],
        );
        await client.query(
          `INSERT INTO weddings (id, user_id, order_id, name, couple, event_date, slug, couple_token, occasion, status, processing_status, allow_downloads, allow_sharing)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESERVED','CREATED',$10,$11)`,
          [
            weddingId,
            user.id,
            orderId,
            name,
            couple,
            date || null,
            publicSlug,
            crypto.randomBytes(16).toString('hex'),
            occasion,
            features.downloads !== false,
            features.sharing !== false,
          ],
        );
        await audit(client, { userId: user.id, action: 'PAYMENT_CREATED', resourceType: 'order', resourceId: orderId, ip });
        await audit(client, { userId: user.id, action: 'WEDDING_CREATED', resourceType: 'wedding', resourceId: weddingId, ip });
        return { id: orderId, status: 'PENDING', amount: price, currency: chosen.currency, plan_id: chosen.id, wedding_id: weddingId, slug: publicSlug };
      });
      return ok(created, 201);
    } catch (error) {
      if (error.code === '23505' && String(error.constraint || '').includes('idem')) {
        const again = await query(
          `SELECT o.id, o.status, o.amount, o.currency, o.plan_id, w.id AS wedding_id, w.slug, o.user_id
           FROM orders o LEFT JOIN weddings w ON w.order_id = o.id WHERE o.idempotency_key = $1`,
          [idempotencyKey],
        );
        if (again.rows[0]?.user_id !== user.id) return fail('IDEMPOTENCY', 'Այս բանալին արդեն օգտագործված է։', 409);
        const row = again.rows[0];
        delete row.user_id;
        return ok(row);
      }
      if (error.code === '23505') continue;
      throw error;
    }
  }
  return fail('SLUG', 'Չհաջողվեց ստեղծել հղումը։ Փորձեք նորից։', 500);
});
