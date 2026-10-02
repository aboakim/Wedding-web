'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Gallery from '@/components/Gallery';

export default function SharePage() {
  const { token } = useParams();
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const claimed = await fetch('/api/guest/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await claimed.json().catch(() => ({}));
      if (!claimed.ok || !body.success) {
        setError(body.error?.message || 'Հղումը չի բացվում');
        return;
      }
      const gallery = await fetch('/api/guest/photos');
      const data = await gallery.json();
      setPhotos(data.data);
    })();
  }, [token]);

  if (error) return <main className="wrap narrow"><h1>{error}</h1></main>;
  if (!photos) return <main className="wrap narrow"><p>Բացում ենք…</p></main>;
  return (
    <main className="wrap">
      <Gallery photos={photos.photos} headline={`Գտանք ${photos.count} լուսանկար`} allowDownloads={photos.allowDownloads} allowSharing={false} />
      <p className="note">Այս հղումը միայն այս հյուրի լուսանկարներն է բացում։</p>
    </main>
  );
}
