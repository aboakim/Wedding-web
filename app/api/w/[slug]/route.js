import { query } from '@/lib/db';
import { fail, ok, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (_req, { params }) => {
  const { slug } = await params;
  const { rows } = await query(
    `SELECT w.couple, w.name, w.event_date, w.status, w.processing_status, w.deleted_at, w.expires_at,
        COUNT(p.id) FILTER (WHERE p.status = 'READY')::int AS ready,
        COUNT(p.id) FILTER (WHERE p.status IN ('UPLOADED','PROCESSING','UPLOADING'))::int AS pending
     FROM weddings w LEFT JOIN photos p ON p.wedding_id = w.id
     WHERE w.slug = $1
     GROUP BY w.id`,
    [slug],
  );
  const row = rows[0];
  if (!row || row.deleted_at || row.status !== 'ACTIVE') return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  if (row.expires_at && new Date(row.expires_at) < new Date()) return fail('EXPIRED', 'Այս հարսանիքի ժամկետն ավարտվել է։', 410);
  return ok({
    couple: row.couple,
    name: row.name,
    date: row.event_date,
    status: row.status,
    processingStatus: row.processing_status,
    ready: row.ready,
    pending: row.pending,
  });
});
