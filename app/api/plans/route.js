import { query } from '@/lib/db';
import { planFeatures } from '@/lib/format';
import { ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OCCASIONS = ['WEDDING', 'CHRISTENING', 'BIRTHDAY', 'GATHERING', 'LAST_BELL', 'PARTY', 'OTHER'];

export const GET = route(async (req) => {
  const requested = new URL(req.url).searchParams.get('occasion') || 'WEDDING';
  const occasion = OCCASIONS.includes(requested) ? requested : 'WEDDING';
  const { rows } = await query(
    `SELECT p.id, p.name, p.currency, p.storage_limit_bytes, p.retention_days, p.features,
            COALESCE(o.price, p.price) AS price,
            COALESCE(o.max_photos, p.max_photos) AS max_photos,
            COALESCE(o.photos_plus, false) AS photos_plus
     FROM plans p
     LEFT JOIN plan_offers o ON o.plan_id = p.id AND o.occasion = $1
     WHERE p.active = true
     ORDER BY COALESCE(o.price, p.price)`,
    [occasion],
  );
  return ok({
    occasion,
    plans: rows.map((row) => ({
      ...row,
      price: Number(row.price),
      max_photos: Number(row.max_photos),
      features: { ...planFeatures(row), photos_plus: row.photos_plus === true },
    })),
  });
});
