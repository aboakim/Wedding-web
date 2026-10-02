import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';
import { reconcile } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  await reconcile();
  return ok({ checked: true });
});
