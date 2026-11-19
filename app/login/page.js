'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFault, useI18n } from '@/components/Language';

export default function LoginPage() {
  const { t, fault } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      setError(apiFault(body) || { key: 'auth.loginFail' });
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next') || '';
    window.location.href = next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
  }

  return (
    <main className="wrap narrow">
      <h1>{t('auth.loginTitle')}</h1>
      <form className="card stack" onSubmit={submit}>
        <label>{t('auth.email')}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>{t('auth.password')}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error ? <p className="err">{fault(error, 'auth.loginFail')}</p> : null}
        <button className="btn" type="submit">{t('auth.submit')}</button>
        <Link href="/register">{t('auth.registerLink')}</Link>
      </form>
    </main>
  );
}
