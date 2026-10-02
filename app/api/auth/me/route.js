import { userFromRequest } from '@/lib/auth';
import { fail, ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  return ok({ id: user.id, email: user.email, role: user.role });
});
