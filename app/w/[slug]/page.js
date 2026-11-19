'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Gallery from '@/components/Gallery';
import { formatDate } from '@/lib/format';
import { apiFault, useI18n } from '@/components/Language';

export default function GuestPage() {
  const { t, lang, fault } = useI18n();
  const { slug } = useParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState('loading');
  const [photos, setPhotos] = useState([]);
  const [flags, setFlags] = useState({ allowDownloads: true, allowSharing: true, count: 0 });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(null);

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
    setError(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      setStep('camera');
    } catch {
      setError({ key: 'guest.cameraOff' });
    }
  }

  async function sendSelfie(blob) {
    stop();
    setStep('searching');
    setError(null);
    const body = new FormData();
    body.append('slug', slug);
    body.append('consent', 'yes');
    body.append('selfie', blob, 'selfie.jpg');
    const res = await fetch('/api/guest/selfie', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      setError(apiFault(data) || { key: 'guest.fail' });
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
    if (!video?.videoWidth) {
      setError({ key: 'guest.cameraWait' });
      return;
    }
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

  if (step === 'loading') return <main className="wrap narrow guest-page"><p>{t('admin.loading')}</p></main>;
  if (step === 'missing') return <main className="wrap narrow guest-page"><h1>{t('guest.missing')}</h1></main>;
  const ready = info?.ready > 0;

  return (
    <main className={`${step === 'gallery' ? 'wrap' : 'wrap narrow'} guest-page`}>
      <p className="eyebrow">{formatDate(info?.date, lang)}</p>
      <h1>{info?.couple}</h1>
      {step === 'intro' || step === 'camera' ? (
        <div className="stack">
          <p className="lead">{t('guest.find')}</p>
          <p className="note">{t('guest.privacy')}</p>
          <label className="note desk-only"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {t('guest.consent')}</label>
          <label className="note check phone-only"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {t('guest.consent')}</label>
          {!ready ? <p className="muted">{t('guest.notReady')}</p> : null}
          {info?.pending > 0 && ready ? <p className="muted">{t('guest.partial')}</p> : null}
          {step === 'camera' ? (
            <div className="phone-camera">
              <video ref={videoRef} autoPlay playsInline muted className="preview" />
              <p className="lead desk-only">{t('guest.look')}</p>
              <button className="btn desk-only" type="button" onClick={capture}>{t('guest.capture')}</button>
              <button className="shutter phone-only" type="button" onClick={capture} aria-label={t('guest.capture')} />
            </div>
          ) : (
            <>
              <button className="btn desk-only" type="button" onClick={enableCamera} disabled={!ready || !consent}>{t('guest.start')}</button>
              <label className="muted desk-only">{t('guest.upload')}
                <input type="file" accept="image/*" capture="user" onChange={onFile} disabled={!ready || !consent} />
              </label>
              <label className="btn phone-only">
                {t('guest.capture')}
                <input className="file-input" type="file" accept="image/*" capture="user" onChange={onFile} disabled={!ready || !consent} />
              </label>
              <button className="btn secondary phone-only" type="button" onClick={enableCamera} disabled={!ready || !consent}>{t('guest.screen')}</button>
            </>
          )}
          {step === 'camera' ? <button className="btn secondary phone-only" type="button" onClick={() => { stop(); setStep('intro'); }}>{t('guest.close')}</button> : null}
          {error ? <p className="err">{fault(error, 'guest.fail')}</p> : null}
        </div>
      ) : null}
      {step === 'searching' ? <div className="stack"><div className="pulse" /><h2>{t('guest.searching')}</h2></div> : null}
      {step === 'empty' ? (
        <div className="stack">
          <h2>{t('guest.empty')}</h2>
          <button className="btn" type="button" onClick={() => setStep('intro')}>{t('guest.again')}</button>
        </div>
      ) : null}
      {step === 'gallery' ? (
        <div className="stack">
          <Gallery photos={photos} headline={t('guest.found', { count: flags.count })} allowDownloads={flags.allowDownloads} allowSharing={flags.allowSharing} />
          <button className="btn secondary" type="button" onClick={() => setStep('intro')}>{t('guest.again')}</button>
        </div>
      ) : null}
    </main>
  );
}
