'use client';

import { useEffect, useState } from 'react';
import { OCCASIONS, formatMoney, occasionLabel, occasionWho, photoLimit, planFeatures } from '@/lib/format';

export default function NewWedding() {
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('START');
  const [couple, setCouple] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [occasion, setOccasion] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const chosen = new URLSearchParams(window.location.search).get('occasion') || '';
      if (OCCASIONS.some((item) => item.id === chosen)) setOccasion(chosen);
      const me = await fetch('/api/auth/me');
      if (!me.ok) {
        const next = `/admin/new${chosen ? `?occasion=${chosen}` : ''}`;
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }
    })();
  }, []);

  useEffect(() => {
    if (!occasion) {
      setPlans([]);
      return;
    }
    (async () => {
      const res = await fetch(`/api/plans?occasion=${occasion}`);
      const body = await res.json();
      const next = body.data?.plans || [];
      setPlans(next);
      if (next.length && !next.some((plan) => plan.id === planId)) setPlanId(next[0].id);
    })();
  }, [occasion]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    if (!OCCASIONS.some((item) => item.id === occasion)) {
      setError('Ընտրեք առիթը։');
      setBusy(false);
      return;
    }
    const keyName = `idem:${occasion}:${planId}:${couple}`;
    let idempotencyKey = sessionStorage.getItem(keyName);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      sessionStorage.setItem(keyName, idempotencyKey);
    }
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, couple, name, date, occasion, idempotencyKey }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      setError(body.error?.message || 'Չհաջողվեց');
      setBusy(false);
      return;
    }
    window.location.href = `/admin/orders/${body.data.id}`;
  }

  const selected = plans.find((plan) => plan.id === planId);

  return (
    <main className="wrap mid">
      <p className="eyebrow">Առիթ</p>
      <h1>Նոր {occasion ? occasionLabel(occasion).toLowerCase() : 'առիթ'}</h1>
      <form className="stack" onSubmit={submit}>
        <div className="occasions">
          {OCCASIONS.map((item) => (
            <button key={item.id} className={occasion === item.id ? 'occasion on' : 'occasion'} type="button" onClick={() => setOccasion(item.id)}>{item.emoji} {item.label}</button>
          ))}
        </div>
        <div className="stack">
          {plans.map((plan) => {
            const features = planFeatures(plan);
            const points = Array.isArray(features.points) ? features.points : [];
            return (
              <label key={plan.id} className={planId === plan.id ? 'plan on' : 'plan'}>
                <span className="row spread">
                  <span><input type="radio" name="plan" checked={planId === plan.id} onChange={() => setPlanId(plan.id)} /> <b>{plan.name}</b></span>
                  <b>{formatMoney(plan.price, plan.currency)}</b>
                </span>
                <span className="muted">/ {occasion ? occasionLabel(occasion).toLowerCase() : 'առիթ'}</span>
                <b>{photoLimit({ ...plan, features })}</b>
                <ul>
                  {points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </label>
            );
          })}
        </div>
        <div className="card stack">
          <label>{occasionWho(occasion)}<input value={couple} onChange={(event) => setCouple(event.target.value)} required /></label>
          <label>Անուն<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Ամսաթիվ<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          {selected ? <p className="note">Վճարման գումարը՝ {formatMoney(selected.price, selected.currency)} / {occasion ? occasionLabel(occasion).toLowerCase() : 'առիթ'}։ {photoLimit(selected)}։</p> : null}
          {error ? <p className="err">{error}</p> : null}
          <button className="btn" type="submit" disabled={busy}>Շարունակել վճարումը</button>
        </div>
      </form>
    </main>
  );
}
