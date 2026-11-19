'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFault, useI18n } from '@/components/Language';

export default function Gallery({ photos, headline, allowDownloads = true, allowSharing = true }) {
  const { t, fault } = useI18n();
  const [active, setActive] = useState(-1);
  const [msg, setMsg] = useState(null);
  const touchX = useRef(0);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') setActive(-1);
      if (event.key === 'ArrowRight') setActive((value) => (value >= 0 ? Math.min(photos.length - 1, value + 1) : value));
      if (event.key === 'ArrowLeft') setActive((value) => (value > 0 ? value - 1 : value));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length]);

  async function downloadAll() {
    setMsg({ key: 'gallery.preparing' });
    const created = await fetch('/api/guest/zip', { method: 'POST' });
    const started = await created.json().catch(() => ({}));
    if (!created.ok || !started.success) {
      setMsg(apiFault(started) || { key: 'gallery.downloadFail' });
      return;
    }
    for (let i = 0; i < 40; i += 1) {
      const res = await fetch(`/api/guest/zip?job=${started.data.jobId}`);
      const body = await res.json().catch(() => ({}));
      if (body.data?.url) {
        window.location.href = body.data.url;
        setMsg(null);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setMsg({ key: 'gallery.later' });
  }

  async function share() {
    const res = await fetch('/api/guest/share', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      setMsg(apiFault(body) || { key: 'gallery.shareFail' });
      return;
    }
    await navigator.clipboard.writeText(body.data.url).catch(() => {});
    if (navigator.share) {
      try { await navigator.share({ title: t('gallery.shareTitle'), url: body.data.url }); } catch { /* dismissed */ }
    }
    setMsg({ key: 'gallery.copied' });
  }

  return (
    <section>
      <div className="row spread actions">
        <h2>{headline}</h2>
        <div className="row actions">
          {allowDownloads ? <button className="btn secondary" type="button" onClick={downloadAll}>{t('gallery.downloadAll')}</button> : null}
          {allowSharing ? <button className="btn" type="button" onClick={share}>{t('gallery.share')}</button> : null}
        </div>
      </div>
      {msg ? <p className="note">{fault(msg)}</p> : null}
      <div className="grid">
        {photos.map((photo, index) => (
          <button key={photo.id} type="button" className="shot" onClick={() => setActive(index)}>
            <img src={photo.thumb} alt="" />
          </button>
        ))}
      </div>
      {active >= 0 ? (
        <div className="lightbox" onClick={() => setActive(-1)}>
          <div
            className="lightbox-card"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => { touchX.current = event.changedTouches[0].clientX; }}
            onTouchEnd={(event) => {
              const delta = event.changedTouches[0].clientX - touchX.current;
              if (delta > 48) setActive((value) => Math.max(0, value - 1));
              if (delta < -48) setActive((value) => Math.min(photos.length - 1, value + 1));
            }}
          >
            <img src={photos[active].full} alt={t('gallery.alt')} />
            <div className="row spread actions">
              <button className="btn secondary" type="button" onClick={() => setActive((value) => Math.max(0, value - 1))} disabled={active === 0}>{t('gallery.prev')}</button>
              {allowDownloads ? <a className="btn" href={`${photos[active].full}&download=1`}>{t('gallery.download')}</a> : null}
              <button className="btn secondary" type="button" onClick={() => setActive((value) => Math.min(photos.length - 1, value + 1))} disabled={active === photos.length - 1}>{t('gallery.next')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
