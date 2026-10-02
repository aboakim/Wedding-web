import { ok, fail, route } from '@/lib/http';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  try {
    await query('SELECT 1');
  } catch {
    return fail('DATABASE_UNAVAILABLE', 'Համակարգը ժամանակավորապես հասանելի չէ։', 503);
  }
  return ok({ database: 'ok', storage: process.env.S3_BUCKET ? 's3' : 'local', worker: 'ok' });
});
