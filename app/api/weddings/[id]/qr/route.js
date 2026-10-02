import { query } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { fail, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, { params }) => {
  const user = await userFromRequest(req);
  if (!user) return fail('AUTH', 'Մուտք գործեք։', 401);
  const { id } = await params;
  const { rows } = await query(`SELECT slug, couple_token, status FROM weddings WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [id, user.id]);
  if (!rows[0]) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  if (rows[0].status !== 'ACTIVE') return fail('PAYMENT', 'QR-ը հասանելի կլինի վճարումից հետո։', 402);
  const host = req.headers.get('host');
  const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const couple = new URL(req.url).searchParams.get('audience') === 'couple';
  if (couple && !rows[0].couple_token) return fail('NOT_FOUND', 'Հարսանիքը չի գտնվել։', 404);
  const url = couple ? `${proto}://${host}/c/${rows[0].couple_token}` : `${proto}://${host}/w/${rows[0].slug}`;
  const file = couple ? 'couple-qr' : 'guest-qr';
  const QRCode = (await import('qrcode')).default;
  const download = new URL(req.url).searchParams.get('download');
  if (new URL(req.url).searchParams.get('format') === 'png') {
    const png = await QRCode.toBuffer(url, { width: 800, margin: 1 });
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, no-store',
        ...(download ? { 'content-disposition': `attachment; filename="${file}.png"` } : {}),
      },
    });
  }
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'private, no-store',
      ...(download ? { 'content-disposition': `attachment; filename="${file}.svg"` } : {}),
    },
  });
});
