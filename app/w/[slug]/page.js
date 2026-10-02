'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Gallery from '@/components/Gallery';
import { formatDate } from '@/lib/format';

export default function GuestPage() {
  const { slug } = useParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState('loading');
  const [photos, setPhotos] = useState([]);
  const [flags, setFlags] = useState({ allowDownloads: true, allowSharing: true, count: 0 });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    (async () => {
      const pub = await fetch(`/api/w/${slug}`);
      const meta = await pub.json().catch(() => ({}));
      if (!pub.ok || !meta.success) {
        if (!ignore) setStep('missing');
        return;
      }
      const mine = await fetch(`/api/guest/photos?slug=${slug}`);
      const gallery = await mine.json().catch(() => ({}));
      if (ignore) return;
      setInfo(meta.data);
      document.title = meta.data.couple;
      if (mine.ok && gallery.success) {
        setPhotos(gallery.data.photos);
        setFlags(gallery.data);
        setStep(gallery.data.count ? 'gallery' : 'empty');
      } else setStep('intro');
    })();
    return () => { ignore = true; };
  }, [slug]);

  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (step === 'camera' && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [step]);

  function stop() {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function enableCamera() {
    setError('');
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      setStep('camera');
    } catch {
      setError('Տեսախցիկը հասանելի չէ։ Կարող եք վերբեռնել սելֆի։');
    }
  }

  async function sendSelfie(blob) {
    stop();
    setStep('searching');
    setError('');
    const body = new FormData();
    body.append('slug', slug);
    body.append('consent', 'yes');
    body.append('selfie', blob, 'selfie.jpg');
    const res = await fetch('/api/guest/selfie', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      setError(data.error?.message || 'Չհաջողվեց');
      setStep('intro');
      return;
    }
    const galleryRes = await fetch(`/api/guest/photos?slug=${slug}`);
    const gallery = await galleryRes.json();
    setPhotos(gallery.data?.photos || []);
    setFlags(gallery.data || { count: data.data.count });
    setStep(data.data.count ? 'gallery' : 'empty');
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 900 / (video.videoWidth || 900));
    canvas.width = Math.round((video.videoWidth || 640) * scale);
    canvas.height = Math.round((video.videoHeight || 800) * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    await sendSelfie(blob);
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await sendSelfie(file);
  }

  if (step === 'loading') return <main className="wrap narrow"><p>Բացում ենք…</p></main>;
  if (step === 'missing') return <main className="wrap narrow"><h1>Ալբոմը չի գտնվել</h1></main>;
  const ready = info?.ready > 0;

  return (
    <main className={step === 'gallery' ? 'wrap' : 'wrap narrow'}>
      <p className="eyebrow">{formatDate(info?.date)}</p>
      <h1>{info?.couple}</h1>
      {step === 'intro' || step === 'camera' ? (
        <div className="stack">
          <p className="lead">Գտիր քո լուսանկարները</p>
          <p className="note">Ձեր սելֆին օգտագործվում է այս առիթի լուսանկարներում ձեզ գտնելու համար։ Ձեր լուսանկարը և դեմքի տվյալները կօգտագործվեն միայն այս նպատակով։ Սելֆին չի պահվում։</p>
          <label className="note"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Համաձայն եմ</label>
          {!ready ? <p className="muted">Լուսանկարները դեռ պատրաստ չեն։ Մի փոքր հետո նորից փորձեք։</p> : null}
          {info?.pending > 0 && ready ? <p className="muted">Մի մասը դեռ մշակվում է։</p> : null}
          {step === 'camera' ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="preview" />
              <p className="lead">Նայեք տեսախցիկին և արեք սելֆի</p>
              <button className="btn" type="button" onClick={capture}>Սելֆի անել</button>
            </>
          ) : (
            <button className="btn" type="button" onClick={enableCamera} disabled={!ready || !consent}>Անել սելֆի</button>
          )}
          <label className="muted">Կամ վերբեռնեք սելֆի
            <input type="file" accept="image/*" capture="user" onChange={onFile} disabled={!ready || !consent} />
          </label>
          {error ? <p className="err">{error}</p> : null}
        </div>
      ) : null}
      {step === 'searching' ? <div className="stack"><div className="pulse" /><h2>Փնտրում ենք ձեր լուսանկարները...</h2></div> : null}
      {step === 'empty' ? (
        <div className="stack">
          <h2>Ձեր լուսանկարները չգտնվեցին</h2>
          <button className="btn" type="button" onClick={() => setStep('intro')}>Նոր սելֆի</button>
        </div>
      ) : null}
      {step === 'gallery' ? (
        <div className="stack">
          <Gallery photos={photos} headline={`Գտանք ${flags.count} լուսանկար`} allowDownloads={flags.allowDownloads} allowSharing={flags.allowSharing} />
          <button className="btn secondary" type="button" onClick={() => setStep('intro')}>Նոր սելֆի</button>
        </div>
      ) : null}
    </main>
  );
}
