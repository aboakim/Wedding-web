'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Gallery from '@/components/Gallery';
import { apiFault, useI18n } from '@/components/Language';

export default function SharePage() {
  const { t, fault } = useI18n();
  const { token } = useParams();
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const claimed = await fetch('/api/guest/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await claimed.json().catch(() => ({}));
      if (!claimed.ok || !body.success) {
        setError(apiFault(body) || { key: 'share.bad' });
        return;
      }
      const gallery = await fetch('/api/guest/photos');
      const data = await gallery.json();
      setPhotos(data.data);
    })();
  }, [token]);

  if (error) return <main className="wrap narrow"><h1>{fault(error, 'share.bad')}</h1></main>;
  if (!photos) return <main className="wrap narrow"><p>{t('admin.loading')}</p></main>;
  return (
    <main className="wrap">
      <Gallery photos={photos.photos} headline={t('share.found', { count: photos.count })} allowDownloads={photos.allowDownloads} allowSharing={false} />
      <p className="note">{t('share.note')}</p>
    </main>
  );
}
