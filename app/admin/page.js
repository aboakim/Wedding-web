'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { occasionTitle } from '@/lib/format';

function gb(value) {
  const n = Number(value || 0);
  if (!n) return '0 ՄԲ';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ԳԲ`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} ՄԲ`;
}

export default function AdminHome() {
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
          <p className="eyebrow">Իմ առիթները</p>
          <h1>Վահանակ</h1>
          <p className="muted">{email}</p>
        </div>
        <div className="row">
          <Link className="btn" href="/admin/new">Նոր առիթ</Link>
          <button className="btn secondary" type="button" onClick={logout}>Ելք</button>
        </div>
      </div>
      {!rows ? <p>Բացում ենք…</p> : null}
      <div className="list">
        {rows?.map((row) => (
          <Link key={row.id} className="wedding" href={row.order_status === 'PAID' ? `/admin/weddings/${row.id}` : `/admin/orders/${row.order_id}`}>
            <span>
              <b>{row.couple}</b>
              <span className="muted"> · {occasionTitle(row.occasion)}</span>
              <span className="muted"> {row.processing_status} · {row.order_status}</span>
            </span>
            <span className="muted">{row.processed}/{row.photos} մշակված · {row.guests} հյուր · {gb(row.storage_bytes)}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
