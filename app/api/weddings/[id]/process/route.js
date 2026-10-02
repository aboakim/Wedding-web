import { NextResponse } from 'next/server';
import { getWedding, requeueErrors, stats } from '@/lib/db';
import { isAdmin } from '@/lib/guard';
import { resume } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, ctx) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Մուտք' }, { status: 401 });
  const { id } = await ctx.params;
  if (!getWedding(id)) return NextResponse.json({ error: 'Չի գտնվել' }, { status: 404 });
  const retry = new URL(req.url).searchParams.get('retry') === '1';
  if (retry) requeueErrors(id);
  resume();
  return NextResponse.json(stats(id));
}
