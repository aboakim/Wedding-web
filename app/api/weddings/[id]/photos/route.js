import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { addPhoto, getWedding, newId, photoFile } from '@/lib/db';
import { isAdmin } from '@/lib/guard';
import { kick } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req, ctx) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Մուտք' }, { status: 401 });
  const { id } = await ctx.params;
  const wedding = getWedding(id);
  if (!wedding) return NextResponse.json({ error: 'Չի գտնվել' }, { status: 404 });
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Ֆայլ չկա' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) {
    return NextResponse.json({ error: 'Ֆայլի չափը պետք է լինի մինչև 30ՄԲ' }, { status: 400 });
  }
  const photoId = newId();
  try {
    const image = sharp(buffer).rotate().flatten({ background: '#ffffff' });
    await image.clone().jpeg({ quality: 90 }).toFile(photoFile(id, photoId));
    await image.clone().resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toFile(photoFile(id, photoId, true));
  } catch {
    return NextResponse.json({ error: 'Այս ֆայլը չի կարդացվում' }, { status: 400 });
  }
  addPhoto(id, photoId);
  kick();
  return NextResponse.json({ id: photoId });
}
