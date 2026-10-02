import { endSession, clearCookie } from '@/lib/auth';
import { ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req) => {
  await endSession(req);
  return ok({ loggedOut: true }, 200, { 'set-cookie': clearCookie('session') });
});
