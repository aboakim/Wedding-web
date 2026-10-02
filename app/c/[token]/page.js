'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Gallery from '@/components/Gallery';
import { formatDate, occasionOwner } from '@/lib/format';

export default function CouplePage() {
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

  if (missing) return <main className="wrap narrow"><h1>Ալբոմը չի գտնվել</h1></main>;
  if (!info) return <main className="wrap"><p>Բացում ենք…</p></main>;

  return (
    <main className="wrap">
      <p className="eyebrow">{occasionOwner(info.occasion)}</p>
      <h1>{info.couple}</h1>
      <p className="lead">{formatDate(info.date)}</p>
      <p className="muted">Այստեղ բոլոր լուսանկարներն են, առանց սելֆիի։ Հյուրերի հղումը այս էջը չի բացում։</p>
      {photos.length ? (
        <Gallery photos={photos} headline={`${info.count} լուսանկար`} allowDownloads={info.allowDownloads} allowSharing={false} />
      ) : <p className="note">Լուսանկարները դեռ պատրաստվում են։</p>}
    </main>
  );
}
