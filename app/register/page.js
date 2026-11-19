'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFault, useI18n } from '@/components/Language';

export default function RegisterPage() {
  const { t, fault } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      setError(apiFault(body) || { key: 'auth.registerFail' });
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next') || '';
    window.location.href = next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
  }

  return (
    <main className="wrap narrow">
      <h1>{t('auth.registerTitle')}</h1>
      <form className="card stack" onSubmit={submit}>
        <label>{t('auth.email')}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>{t('auth.password')}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        {error ? <p className="err">{fault(error, 'auth.registerFail')}</p> : null}
        <button className="btn" type="submit">{t('auth.create')}</button>
        <Link href="/login">{t('auth.have')}</Link>
      </form>
    </main>
  );
}
