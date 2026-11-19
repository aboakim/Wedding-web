'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Gallery from '@/components/Gallery';
import { formatDate, occasionOwner } from '@/lib/format';
import { useI18n } from '@/components/Language';

export default function CouplePage() {
  const { t, lang } = useI18n();
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const first = await fetch(`/api/c/${token}`);
      const body = await first.json().catch(() => ({}));
      if (!first.ok || !body.success) {
        if (!ignore) setMissing(true);
        return;
      }
      const all = [...body.data.photos];
      let page = 1;
      while (all.length < body.data.count && page < 20) {
        page += 1;
        const next = await fetch(`/api/c/${token}?page=${page}`);
        const more = await next.json().catch(() => ({}));
        if (!more.success || !more.data.photos.length) break;
        all.push(...more.data.photos);
      }
      if (ignore) return;
      setInfo(body.data);
      setPhotos(all);
      document.title = body.data.couple;
    })();
    return () => { ignore = true; };
  }, [token]);

  if (missing) return <main className="wrap narrow"><h1>{t('couple.missing')}</h1></main>;
  if (!info) return <main className="wrap"><p>{t('admin.loading')}</p></main>;

  return (
    <main className="wrap">
      <p className="eyebrow">{occasionOwner(info.occasion, lang)}</p>
      <h1>{info.couple}</h1>
      <p className="lead">{formatDate(info.date, lang)}</p>
      <p className="muted">{t('couple.note')}</p>
      {photos.length ? (
        <Gallery photos={photos} headline={t('couple.count', { count: info.count })} allowDownloads={info.allowDownloads} allowSharing={false} />
      ) : <p className="note">{t('couple.wait')}</p>}
    </main>
  );
}
