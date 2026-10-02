'use client';

import { useEffect, useState } from 'react';

export default function Gallery({ photos, headline, allowDownloads = true, allowSharing = true }) {
  const [active, setActive] = useState(-1);
  const [msg, setMsg] = useState('');

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
    setMsg('Պատրաստում ենք ֆայլը…');
    const created = await fetch('/api/guest/zip', { method: 'POST' });
    const started = await created.json().catch(() => ({}));
    if (!created.ok || !started.success) {
      setMsg(started.error?.message || 'Չհաջողվեց ներբեռնել');
      return;
    }
    for (let i = 0; i < 40; i += 1) {
      const res = await fetch(`/api/guest/zip?job=${started.data.jobId}`);
      const body = await res.json().catch(() => ({}));
      if (body.data?.url) {
        window.location.href = body.data.url;
        setMsg('');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setMsg('Ֆայլը դեռ պատրաստվում է։ Փորձեք մի փոքր հետո։');
  }

  async function share() {
    const res = await fetch('/api/guest/share', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      setMsg(body.error?.message || 'Չհաջողվեց');
      return;
    }
    await navigator.clipboard.writeText(body.data.url).catch(() => {});
    if (navigator.share) {
      try { await navigator.share({ title: 'Լուսանկարներ', url: body.data.url }); } catch { /* dismissed */ }
    }
    setMsg('Հղումը պատճենված է։ Այն բացում է միայն այս լուսանկարները։');
  }

  return (
    <section>
      <div className="row spread">
        <h2>{headline}</h2>
        <div className="row">
          {allowDownloads ? <button className="btn secondary" type="button" onClick={downloadAll}>Ներբեռնել բոլորը</button> : null}
          {allowSharing ? <button className="btn" type="button" onClick={share}>Կիսվել</button> : null}
        </div>
      </div>
      {msg ? <p className="note">{msg}</p> : null}
      <div className="grid">
        {photos.map((photo, index) => (
          <button key={photo.id} type="button" className="shot" onClick={() => setActive(index)}>
            <img src={photo.thumb} alt="" />
          </button>
        ))}
      </div>
      {active >= 0 ? (
        <div className="lightbox" onClick={() => setActive(-1)}>
          <div className="lightbox-card" onClick={(event) => event.stopPropagation()}>
            <img src={photos[active].full} alt="Լուսանկար" />
            <div className="row spread">
              <button className="btn secondary" type="button" onClick={() => setActive((value) => Math.max(0, value - 1))} disabled={active === 0}>Նախորդ</button>
              {allowDownloads ? <a className="btn" href={`${photos[active].full}&download=1`}>Ներբեռնել</a> : null}
              <button className="btn secondary" type="button" onClick={() => setActive((value) => Math.min(photos.length - 1, value + 1))} disabled={active === photos.length - 1}>Հաջորդ</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
