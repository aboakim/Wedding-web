'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { occasionOwner, occasionOwners, occasionTitle } from '@/lib/format';
import { apiFault, useI18n } from '@/components/Language';
import { statusLabel } from '@/lib/i18n';

async function fileHash(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function WeddingDesk() {
  const { t, lang, fault } = useI18n();
  const { id } = useParams();
  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [link, setLink] = useState('');
  const [zipNote, setZipNote] = useState(null);
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
    if (!ticket.success) throw apiFault(ticket) || { key: 'desk.fail' };
    if (ticket.data.duplicate) return;
    for (const part of ticket.data.parts) {
      if (part.done) continue;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
        const put = await fetch(part.url, { method: 'PUT', body: file.slice(part.start, part.end) });
        ok = put.ok;
      }
      if (!ok) throw { key: 'desk.interrupted' };
    }
    const done = await fetch('/api/photos/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId: ticket.data.photoId }),
    });
    const finished = await done.json();
    if (!finished.success) throw apiFault(finished) || { key: 'desk.fail' };
  }

  async function onFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    setError(null);
    let done = 0;
    setUpload({ done: 0, total: files.length });
    for (const file of files) {
      try {
        await sendFile(file);
      } catch (err) {
        setError(err?.key || err?.message ? err : { key: 'desk.fail' });
      }
      done += 1;
      setUpload({ done, total: files.length });
    }
    load();
    if (files.length) document.getElementById('share')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function downloadAll() {
    setError(null);
    setZipNote({ key: 'desk.zipping' });
    const opened = await fetch(`/api/weddings/${id}/album`, { method: 'POST' });
    const job = await opened.json().catch(() => ({}));
    if (!job.success) {
      setZipNote(null);
      setError(apiFault(job) || { key: 'desk.zipFail' });
      return;
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const res = await fetch(`/api/weddings/${id}/album?job=${job.data.jobId}`);
      const body = await res.json().catch(() => ({}));
      if (body.data?.url) {
        setZipNote(null);
        window.location.href = body.data.url;
        return;
      }
      if (!body.success) {
        setZipNote(null);
        setError(apiFault(body) || { key: 'desk.zipFail' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setZipNote(null);
    setError({ key: 'gallery.later' });
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
      setError(apiFault(body) || { key: 'desk.fail' });
      return;
    }
    window.location.href = '/admin';
  }

  if (!info) return <main className="wrap"><p>{t('admin.loading')}</p></main>;
  const wedding = info.wedding;
  const aiTotal = progress?.ai.total || 0;
  const aiDone = progress?.ai.done || 0;
  const aiPercent = aiTotal ? Math.round((aiDone / aiTotal) * 100) : 0;
  const uploadPercent = upload?.total ? Math.round((upload.done / upload.total) * 100) : 0;
  const coupleLink = wedding.coupleToken ? `${window.location.origin}/c/${wedding.coupleToken}` : '';
  const hasPhotos = Boolean(info.preview.length || progress?.upload.done);
  const owner = occasionOwner(wedding.occasion, lang);

  function confirmPhotos() {
    sessionStorage.setItem(`share:${id}`, '1');
    setStep('links');
    setTimeout(() => document.getElementById('share')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  return (
    <main className="wrap desk">
      <Link className="back" href="/admin">{t('desk.back')}</Link>
      <section className="invite">
        <p className="eyebrow">{occasionTitle(wedding.occasion, lang)}</p>
        <h1>{wedding.couple}</h1>
        <p className="ornament" aria-hidden="true">✦</p>
        <div className="pills">
          <span>{statusLabel(lang, wedding.processingStatus)}</span>
          <span>{statusLabel(lang, wedding.status)}</span>
        </div>
      </section>

      <section className="stats">
        <div className="stat">
          <b>{progress ? `${progress.upload.done}/${progress.upload.total}` : '—'}</b>
          <span>{t('desk.uploaded')}</span>
        </div>
        <div className="stat">
          <b>{progress ? `${aiDone}/${aiTotal}` : '—'}</b>
          <span>{t('desk.processed')}</span>
        </div>
        <div className="stat">
          <b>{info.guests}</b>
          <span>{t('desk.guests')}</span>
        </div>
      </section>

      {aiTotal ? (
        <section className="card progress">
          <div className="row spread">
            <span>{t('desk.faces')}</span>
            <b>{aiPercent}%</b>
          </div>
          <div className="bar"><span style={{ width: `${aiPercent}%` }} /></div>
        </section>
      ) : null}

      {wedding.status === 'ACTIVE' && step === 'photos' ? (
        <section className="card stack">
          <h2>{t('desk.photos')}</h2>
          <p className="muted">{t('desk.hint')}</p>
          <label className="drop">
            <span>{t('desk.choose')}</span>
            <span className="muted">{t('desk.multi')}</span>
            <input className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFiles} />
          </label>
          {upload ? (
            <div className="stack">
              <div className="row spread">
                <span>{t('desk.uploading')}</span>
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
          {progress?.ai.failed ? <p className="err">{t('desk.failed', { count: progress.ai.failed })}</p> : null}
          {progress?.ai.failed ? <button className="btn secondary" type="button" onClick={retry}>{t('desk.retry')}</button> : null}
          {error ? <p className="err">{fault(error, 'desk.fail')}</p> : null}
          <button className="btn" type="button" disabled={!hasPhotos} onClick={confirmPhotos}>{t('desk.confirm')}</button>
          {!hasPhotos ? <p className="muted">{t('desk.confirmHint')}</p> : null}
        </section>
      ) : null}
      {wedding.status !== 'ACTIVE' ? <p className="note">{t('desk.payFirst')}</p> : null}

      {wedding.status === 'ACTIVE' && step === 'links' ? (
        <section className="stack" id="share">
          <p className="eyebrow">{t('desk.links')}</p>
          <button className="btn secondary" type="button" onClick={() => setStep('photos')}>{t('desk.backPhotos')}</button>
          <div className="desk-grid">
          <article className="card stack">
            <p className="badge">{t('desk.forGuests')}</p>
            <h2>{t('desk.guestsTitle')}</h2>
            <p className="muted">{t('desk.guestHelp')}</p>
            <div className="linkbox">
              <code>{link}</code>
              <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(link)}>{t('desk.copy')}</button>
            </div>
            <div className="qr-card">
              <img src={`/api/weddings/${id}/qr`} alt={t('desk.qrAlt')} width="196" height="196" />
              <a className="btn secondary" href={`/api/weddings/${id}/qr?format=png&download=1`}>{t('desk.qrDownload')}</a>
            </div>
          </article>
          <article className="card stack">
            <p className="badge couple">{occasionOwners(wedding.occasion, lang)}</p>
            <h2>{owner}</h2>
            <p className="muted">{t('desk.ownerHelp')}</p>
            <div className="linkbox">
              <code>{coupleLink}</code>
              <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(coupleLink)}>{t('desk.copy')}</button>
            </div>
            <div className="qr-card">
              <img src={`/api/weddings/${id}/qr?audience=couple`} alt={`${owner} QR`} width="196" height="196" />
              <a className="btn secondary" href={`/api/weddings/${id}/qr?audience=couple&format=png&download=1`}>{t('desk.qrDownload')}</a>
            </div>
          </article>
          </div>
          <article className="card stack">
            <button className="btn" type="button" onClick={downloadAll}>{t('desk.downloadAll')}</button>
            {zipNote ? <p className="note">{fault(zipNote)}</p> : null}
            <Link className="btn secondary" href="/admin">{t('desk.home')}</Link>
            <Link className="btn" href="/admin/new">{t('admin.new')}</Link>
          </article>
        </section>
      ) : null}

      <details className="archive">
        <summary>{t('desk.archive')}</summary>
        <div className="stack">
          <p className="muted">{t('desk.archiveNote')}</p>
          <label>{t('desk.archiveConfirm', { name: wedding.couple })}
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <button className="btn secondary" type="button" onClick={remove}>{t('desk.archiveButton')}</button>
          {error ? <p className="err">{fault(error, 'desk.fail')}</p> : null}
        </div>
      </details>
    </main>
  );
}
