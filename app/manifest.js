import { cookies } from 'next/headers';
import { normalizeLang, t } from '@/lib/i18n';

export default async function manifest() {
  const jar = await cookies();
  const lang = normalizeLang(jar.get('lang')?.value);
  return {
    name: t(lang, 'meta.title'),
    short_name: t(lang, 'meta.short'),
    start_url: '/',
    display: 'standalone',
    background_color: '#f3eee7',
    theme_color: '#7a2e2e',
  };
}
