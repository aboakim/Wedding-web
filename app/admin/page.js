'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBytes, occasionTitle } from '@/lib/format';
import { useI18n } from '@/components/Language';
import { orderStatus, statusLabel } from '@/lib/i18n';

export default function AdminHome() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    (async () => {
      const me = await fetch('/api/auth/me');
      const who = await me.json().catch(() => ({}));
      if (!me.ok) {
        window.location.href = '/login';
        return;
      }
      setEmail(who.data.email);
      const res = await fetch('/api/weddings');
      const body = await res.json();
      setRows(body.data?.weddings || []);
    })();
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  return (
    <main className="wrap">
      <div className="top">
        <div>
          <p className="eyebrow">{t('admin.eyebrow')}</p>
          <h1>{t('admin.title')}</h1>
          <p className="muted">{email}</p>
        </div>
        <div className="row">
          <Link className="btn" href="/admin/new">{t('admin.new')}</Link>
          <button className="btn secondary" type="button" onClick={logout}>{t('admin.logout')}</button>
        </div>
      </div>
      {!rows ? <p>{t('admin.loading')}</p> : null}
      <div className="list">
        {rows?.map((row) => (
          <Link key={row.id} className="wedding" href={row.order_status === 'PAID' ? `/admin/weddings/${row.id}` : `/admin/orders/${row.order_id}`}>
            <span>
              <b>{row.couple}</b>
              <span className="muted"> · {occasionTitle(row.occasion, lang)}</span>
              <span className="muted"> {statusLabel(lang, row.processing_status)} · {orderStatus(lang, row.order_status)}</span>
            </span>
            <span className="muted">{row.processed}/{row.photos} {t('admin.processed')} · {t('admin.guestsLine', { count: row.guests })} · {formatBytes(row.storage_bytes, lang)}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
