import { fail, ok, route } from '@/lib/http';
import { applyVerified } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get('x-payment-signature');
  try {
    const result = await applyVerified(raw, signature);
    return ok({ received: true, duplicate: Boolean(result.duplicate) });
  } catch (error) {
    if (error.status) return fail(error.code || 'PAYMENT', 'Վճարումը չհաստատվեց։', error.status);
    throw error;
  }
});
