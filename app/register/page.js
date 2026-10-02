'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      setError(body.error?.message || 'Չհաջողվեց գրանցվել');
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next') || '';
    window.location.href = next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
  }

  return (
    <main className="wrap narrow">
      <h1>Գրանցում</h1>
      <form className="card stack" onSubmit={submit}>
        <label>Էլ. փոստ<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Գաղտնաբառ<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        {error ? <p className="err">{error}</p> : null}
        <button className="btn" type="submit">Ստեղծել հաշիվ</button>
        <Link href="/login">Արդեն ունեմ հաշիվ</Link>
      </form>
    </main>
  );
}
