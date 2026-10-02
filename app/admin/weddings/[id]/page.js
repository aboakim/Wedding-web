'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { occasionOwner, occasionOwners, occasionTitle } from '@/lib/format';

async function fileHash(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function WeddingDesk() {
  const { id } = useParams();
  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [link, setLink] = useState('');
  const [zipNote, setZipNote] = useState('');
  const [step, setStep] = useState('photos');

  async function load() {
    const res = await fetch(`/api/weddings/${id}`);
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const body = await res.json();
    if (!body.success) return;
    setInfo(body.data);
    setLink(`${window.location.origin}/w/${body.data.wedding.slug}`);
    const status = await fetch(`/api/weddings/${id}/processing-status`);
    const state = await status.json();
    if (state.success) setProgress(state.data);
  }

  useEffect(() => {
    load();
    if (sessionStorage.getItem(`share:${id}`) === '1') setStep('links');
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [id]);

  async function sendFile(file) {
    const hash = await fileHash(file);
    const opened = await fetch('/api/photos/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weddingId: id, name: file.name, size: file.size, hash, type: file.type || 'image/jpeg' }),
    });
    const ticket = await opened.json();
    if (!ticket.success) throw new Error(ticket.error?.message || 'Չհաջողվեց');
    if (ticket.data.duplicate) return;
    for (const part of ticket.data.parts) {
      if (part.done) continue;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
        const put = await fetch(part.url, { method: 'PUT', body: file.slice(part.start, part.end) });
        ok = put.ok;
      }
      if (!ok) throw new Error('Կապն ընդհատվեց։ Կարող եք նույն ֆայլը նորից ընտրել։');
    }
    const done = await fetch('/api/photos/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId: ticket.data.photoId }),
    });
    const finished = await done.json();
    if (!finished.success) throw new Error(finished.error?.message || 'Չհաջողվեց');
  }

  async function onFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    setError('');
    let done = 0;
    setUpload({ done: 0, total: files.length });
    for (const file of files) {
      try {
        await sendFile(file);
      } catch (err) {
        setError(err.message);
      }
      done += 1;
      setUpload({ done, total: files.length });
    }
    load();
    if (files.length) document.getElementById('share')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function downloadAll() {
    setError('');
    setZipNote('Պատրաստում ենք բոլոր նկարների ֆայլը…');
    const opened = await fetch(`/api/weddings/${id}/album`, { method: 'POST' });
    const job = await opened.json().catch(() => ({}));
    if (!job.success) {
      setZipNote('');
      setError(job.error?.message || 'Ֆայլը չստեղծվեց');
      return;
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const res = await fetch(`/api/weddings/${id}/album?job=${job.data.jobId}`);
      const body = await res.json().catch(() => ({}));
      if (body.data?.url) {
        setZipNote('');
        window.location.href = body.data.url;
        return;
      }
      if (!body.success) {
        setZipNote('');
        setError(body.error?.message || 'Ֆայլը չստեղծվեց');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setZipNote('');
    setError('Ֆայլը դեռ պատրաստվում է։ Փորձեք մի փոքր հետո։');
  }

  async function retry() {
    await fetch(`/api/weddings/${id}/retry`, { method: 'POST' });
    load();
  }

  async function remove() {
    const res = await fetch(`/api/weddings/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });
    const body = await res.json();
    if (!body.success) {
      setError(body.error?.message || 'Չհաջողվեց');
      return;
    }
    window.location.href = '/admin';
  }

  if (!info) return <main className="wrap"><p>Բացում ենք…</p></main>;
  const wedding = info.wedding;
  const aiTotal = progress?.ai.total || 0;
  const aiDone = progress?.ai.done || 0;
  const aiPercent = aiTotal ? Math.round((aiDone / aiTotal) * 100) : 0;
  const uploadPercent = upload?.total ? Math.round((upload.done / upload.total) * 100) : 0;
  const coupleLink = wedding.coupleToken ? `${window.location.origin}/c/${wedding.coupleToken}` : '';
  const hasPhotos = Boolean(info.preview.length || progress?.upload.done);

  function confirmPhotos() {
    sessionStorage.setItem(`share:${id}`, '1');
    setStep('links');
    setTimeout(() => document.getElementById('share')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  return (
    <main className="wrap desk">
      <Link className="back" href="/admin">Վահանակ</Link>
      <section className="invite">
        <p className="eyebrow">{occasionTitle(wedding.occasion)}</p>
        <h1>{wedding.couple}</h1>
        <p className="ornament" aria-hidden="true">✦</p>
        <div className="pills">
          <span>{label(wedding.processingStatus)}</span>
          <span>{label(wedding.status)}</span>
        </div>
      </section>

      <section className="stats">
        <div className="stat">
          <b>{progress ? `${progress.upload.done}/${progress.upload.total}` : '—'}</b>
          <span>Վերբեռնված</span>
        </div>
        <div className="stat">
          <b>{progress ? `${aiDone}/${aiTotal}` : '—'}</b>
          <span>Մշակված</span>
        </div>
        <div className="stat">
          <b>{info.guests}</b>
          <span>Հյուր</span>
        </div>
      </section>

      {aiTotal ? (
        <section className="card progress">
          <div className="row spread">
            <span>Դեմքերի մշակում</span>
            <b>{aiPercent}%</b>
          </div>
          <div className="bar"><span style={{ width: `${aiPercent}%` }} /></div>
        </section>
      ) : null}

      {wedding.status === 'ACTIVE' && step === 'photos' ? (
        <section className="card stack">
          <h2>Լուսանկարներ</h2>
          <p className="muted">Ընտրեք JPEG, PNG կամ WebP։ Ընդհատված ֆայլը կարելի է նորից ընտրել և շարունակել։</p>
          <label className="drop">
            <span>Ընտրել լուսանկարներ</span>
            <span className="muted">կամ մի քանի ֆայլ միանգամից</span>
            <input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFiles} />
          </label>
          {upload ? (
            <div className="stack">
              <div className="row spread">
                <span>Վերբեռնում</span>
                <b>{upload.done} / {upload.total}</b>
              </div>
              <div className="bar"><span style={{ width: `${uploadPercent}%` }} /></div>
            </div>
          ) : null}
          {info.preview.length ? (
            <div className="mini">
              {info.preview.map((photo) => <img key={photo.id} src={photo.thumb} alt="" />)}
            </div>
          ) : null}
          {progress?.ai.failed ? <p className="err">{progress.ai.failed} լուսանկար չմշակվեց։ Մնացածը հասանելի է։</p> : null}
          {progress?.ai.failed ? <button className="btn secondary" type="button" onClick={retry}>Կրկնել ձախողվածները</button> : null}
          {error ? <p className="err">{error}</p> : null}
          <button className="btn" type="button" disabled={!hasPhotos} onClick={confirmPhotos}>Հաստատել</button>
          {!hasPhotos ? <p className="muted">Նախ տեղադրեք լուսանկարները, հետո սեղմեք Հաստատել։</p> : null}
        </section>
      ) : null}
      {wedding.status !== 'ACTIVE' ? <p className="note">Վճարումից հետո կարելի է վերբեռնել լուսանկարներ։</p> : null}

      {wedding.status === 'ACTIVE' && step === 'links' ? (
        <section className="stack" id="share">
          <p className="eyebrow">Հղումներ</p>
          <button className="btn secondary" type="button" onClick={() => setStep('photos')}>Վերադառնալ լուսանկարներին</button>
          <div className="desk-grid">
          <article className="card stack">
            <p className="badge">Հյուրերի համար</p>
            <h2>Հյուրեր</h2>
            <p className="muted">Ուղարկեք այս հղումը կամ QR-ը հյուրերին։ Սելֆիից հետո կտեսնեն միայն իրենց նկարները։</p>
            <div className="linkbox">
              <code>{link}</code>
              <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(link)}>Պատճենել</button>
            </div>
            <div className="qr-card">
              <img src={`/api/weddings/${id}/qr`} alt="Հյուրերի QR" width="196" height="196" />
              <a className="btn secondary" href={`/api/weddings/${id}/qr?format=png&download=1`}>Ներբեռնել QR</a>
            </div>
          </article>
          <article className="card stack">
            <p className="badge couple">{occasionOwners(wedding.occasion)}</p>
            <h2>{occasionOwner(wedding.occasion)}</h2>
            <p className="muted">Ուրիշ հղում և QR։ Բացում է բոլոր նկարները, առանց դեմքի ճանաչման։</p>
            <div className="linkbox">
              <code>{coupleLink}</code>
              <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(coupleLink)}>Պատճենել</button>
            </div>
            <div className="qr-card">
              <img src={`/api/weddings/${id}/qr?audience=couple`} alt={`${occasionOwner(wedding.occasion)} QR`} width="196" height="196" />
              <a className="btn secondary" href={`/api/weddings/${id}/qr?audience=couple&format=png&download=1`}>Ներբեռնել QR</a>
            </div>
          </article>
          </div>
          <article className="card stack">
            <button className="btn" type="button" onClick={downloadAll}>Ներբեռնել բոլոր նկարները</button>
            {zipNote ? <p className="note">{zipNote}</p> : null}
            <Link className="btn secondary" href="/admin">Գլխավոր էջ</Link>
            <Link className="btn" href="/admin/new">Նոր առիթ</Link>
          </article>
        </section>
      ) : null}

      <details className="archive">
        <summary>Արխիվացնել հարսանիքը</summary>
        <div className="stack">
          <p className="muted">Ֆայլերը անմիջապես չեն ջնջվում։ 30 օր հնարավոր է վերականգնել։</p>
          <label>Հաստատելու համար գրեք՝ {wedding.couple}
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <button className="btn secondary" type="button" onClick={remove}>Արխիվացնել</button>
          {error ? <p className="err">{error}</p> : null}
        </div>
      </details>
    </main>
  );
}

function label(value) {
  const names = {
    CREATED: 'Ստեղծված է',
    UPLOADING: 'Վերբեռնվում է',
    PROCESSING: 'Մշակվում է',
    PARTIALLY_READY: 'Մասամբ պատրաստ',
    READY: 'Պատրաստ է',
    FAILED: 'Կան սխալներ',
    ARCHIVED: 'Արխիվում է',
    ACTIVE: 'Բաց է հյուրերի համար',
    RESERVED: 'Սպասում է վճարման',
  };
  return names[value] || value;
}
