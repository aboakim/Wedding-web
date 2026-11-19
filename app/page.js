'use client';

import Link from 'next/link';
import { OCCASIONS, occasionLabel } from '@/lib/format';
import { useI18n } from '@/components/Language';

export default function HomePage() {
  const { t, lang } = useI18n();
  return (
    <main className="wrap mid">
      <p className="eyebrow">{t('home.eyebrow')}</p>
      <h1>{t('home.title')}</h1>
      <p className="lead">{t('home.lead')}</p>
      <div className="occasions">
        {OCCASIONS.map((item) => (
          <Link key={item.id} className="occasion" href={`/admin/new?occasion=${item.id}`}>{item.emoji} {occasionLabel(item.id, lang)}</Link>
        ))}
      </div>
      <div className="row">
        <Link className="btn secondary" href="/login">{t('home.login')}</Link>
        <Link className="btn secondary" href="/register">{t('home.register')}</Link>
      </div>
    </main>
  );
}
