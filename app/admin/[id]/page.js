'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/components/Language';

export default function WeddingAdmin() {
  const { t, lang } = useI18n();
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [origin, setOrigin] = useState('');
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => { setOrigin(window.location.origin); }, []);

  useEffect(() => {
    let stop = false;
    let timer;
    async function tick() {
      const res = await fetch(`/api/weddings/${id}`);
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) { setError('missing'); return; }
      const json = await res.json();
      if (stop) return;
      setData(json);
      if (json.stats?.pending > 0) timer = setTimeout(tick, 2000);
    }
    fetch(`/api/weddings/${id}/process`, { method: 'POST' });
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, rev, router]);

  async function onFiles(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    setError('');
    let done = 0;
    let failed = 0;
    setUpload({ done, total: files.length });
    const queue = [...files];
    async function worker() {
      while (queue.length) {
        const file = queue.shift();
        const body = new FormData();
        body.append('file', file);
        const res = await fetch(`/api/weddings/${id}/photos`, { method: 'POST', body });
        if (res.ok) done += 1;
        else failed += 1;
        setUpload({ done: done + failed, total: files.length, failed });
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setRev((value) => value + 1);
  }

  async function copy() {
    await navigator.clipboard.writeText(`${origin}/w/${data.slug}`);
    setCopied(true);
  }

  async function remove() {
    if (!confirm(t('legacy.ask'))) return;
    await fetch(`/api/weddings/${id}`, { method: 'DELETE' });
    router.push('/admin');
  }

  async function retry() {
    await fetch(`/api/weddings/${id}/process?retry=1`, { method: 'POST' });
    setRev((value) => value + 1);
  }

  if (error) return <main className="wrap"><p className="err">{t('legacy.missing')}</p></main>;
  if (!data) return <main className="wrap"><p>{t('admin.loading')}</p></main>;

  const link = `${origin}/w/${data.slug}`;
  const pct = upload ? Math.round((upload.done / upload.total) * 100) : 0;
  const preview = (data.photos || []).filter((photo) => photo.status !== 'error').slice(0, 24);

  return (
    <main className="wrap">
      <div className="top">
        <a className="brand" href="/admin">{t('legacy.all')}</a>
        <button className="btn secondary" type="button" onClick={remove}>{t('legacy.delete')}</button>
      </div>
      <p className="eyebrow">{data.name}</p>
      <h1>{data.couple}</h1>
      <p className="muted">{formatDate(data.date, lang)}</p>
      <div className="linkbox">
        <code>{link}</code>
        <button className="btn" type="button" onClick={copy}>{copied ? t('legacy.copied') : t('legacy.copy')}</button>
      </div>
      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><b>{data.stats.photos}</b><span className="muted">{t('legacy.photos')}</span></div>
        <div className="stat"><b>{data.stats.indexed}</b><span className="muted">{t('legacy.processed')}</span></div>
        <div className="stat"><b>{data.stats.faces}</b><span className="muted">{t('legacy.faces')}</span></div>
      </div>
      <p className="note">{t('legacy.note')}</p>
      <label className="drop">
        <input type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <strong>{t('legacy.upload')}</strong>
        <span className="muted">{t('legacy.many')}</span>
      </label>
      {upload ? (
        <div>
          <div className="bar"><span style={{ width: `${pct}%` }} /></div>
          <p className="muted">{t('legacy.progress', { done: upload.done, total: upload.total, failed: upload.failed || 0 })}</p>
        </div>
      ) : null}
      {data.stats.pending > 0 ? <p className="muted">{t('legacy.pending', { count: data.stats.pending })}</p> : null}
      {data.stats.errors > 0 ? <button className="btn secondary" type="button" onClick={retry}>{t('legacy.retry', { count: data.stats.errors })}</button> : null}
      {data.errors?.length ? data.errors.map((item) => <p className="err" key={item.id}>{item.error}</p>) : null}
      <div className="mini">
        {preview.map((photo) => <img key={photo.id} src={`/api/media/${photo.id}?thumb=1`} alt="" />)}
      </div>
    </main>
  );
}
