'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatMoney, occasionLabel, occasionTitle, photoLimit, planFeatures } from '@/lib/format';

export default function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [holder, setHolder] = useState('');

  async function load() {
    const res = await fetch(`/api/orders/${id}`);
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!body.success) {
      setError(body.error?.message || 'Պատվերը չի գտնվել');
      return;
    }
    setError('');
    setOrder(body.data);
  }

  useEffect(() => {
    if (!order?.occasion) return;
    (async () => {
      const res = await fetch(`/api/plans?occasion=${order.occasion}`);
      const body = await res.json().catch(() => ({}));
      setPlans(body.data?.plans || []);
    })();
  }, [order?.occasion]);

  async function choose(planId) {
    if (!order || order.plan_id === planId || busy) return;
    setBusy(true);
    setError('');
    const res = await fetch(`/api/orders/${id}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!body.success) {
      setError(body.error?.message || 'Փաթեթը չփոխվեց');
      return;
    }
    await load();
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [id]);

  function groupCard(value) {
    return value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  function groupExpiry(value) {
    const raw = value.replace(/\D/g, '').slice(0, 4);
    return raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw;
  }

  async function pay(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/payments/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: id,
        card: { number, expiry, cvv, name: holder },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setCvv('');
    if (!body.success) {
      setError(body.error?.message || 'Վճարումը չհաջողվեց');
      return;
    }
    setNumber('');
    setExpiry('');
    setHolder('');
    setOrder((current) => ({
      ...current,
      status: body.data.status,
      amount: body.data.amount,
      currency: body.data.currency,
      card_brand: body.data.cardBrand,
      card_last4: body.data.cardLast4,
    }));
  }

  if (!order && !error) return <main className="wrap narrow"><p>Բացում ենք…</p></main>;

  return (
    <main className="wrap mid">
      <p className="eyebrow">Վճարում</p>
      <h1>{order ? `${formatMoney(order.amount, order.currency)}` : 'Պատվեր'}</h1>
      <p className="muted">Ընտրեք փաթեթը։ Գինը և նկարների քանակը այս առիթի համար են՝ {occasionTitle(order?.occasion)}։</p>
      <div className="stack">
        {plans.map((plan) => {
          const features = planFeatures(plan);
          const points = Array.isArray(features.points) ? features.points : [];
          const selected = order?.plan_id === plan.id;
          return (
            <label key={plan.id} className={selected ? 'plan on' : 'plan'}>
              <span className="row spread">
                <span>
                  <input type="radio" name="plan" checked={selected} onChange={() => choose(plan.id)} />
                  {' '}<b>{plan.name}</b>
                </span>
                <b>{formatMoney(plan.price, plan.currency)}</b>
              </span>
              <span className="muted">/ {occasionLabel(order?.occasion).toLowerCase()}</span>
              <b>{photoLimit({ ...plan, features })}</b>
              <ul>
                {points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </label>
          );
        })}
        <div className="card stack">
          <p>Կարգավիճակ՝ <b>{statusName(order?.status)}</b></p>
          {order?.status === 'PAID' ? <p className="note">Վճարումը հաստատված է{order.card_last4 ? ` · ${order.card_brand || 'Քարտ'} •••• ${order.card_last4}` : ''}։</p> : <p className="muted">Գումարը վերցվում է պատվերից։ Քարտի համարը չի պահվում։ Հաստատումը գալիս է միայն ստուգումից հետո։</p>}
          {error ? <p className="err">{error}</p> : null}
          {order && order.status !== 'PAID' && order.status !== 'REFUNDED' ? (
            <form className="stack" onSubmit={pay}>
              <label>Քարտի համար<input inputMode="numeric" autoComplete="cc-number" placeholder="4111 1111 1111 1111" value={number} onChange={(event) => setNumber(groupCard(event.target.value))} required /></label>
              <label>Անունը քարտի վրա<input autoComplete="cc-name" value={holder} onChange={(event) => setHolder(event.target.value)} required /></label>
              <div className="row">
                <label>Ժամկետ<input inputMode="numeric" autoComplete="cc-exp" placeholder="ԱԱ/ՏՏ" value={expiry} onChange={(event) => setExpiry(groupExpiry(event.target.value))} required /></label>
                <label>CVV<input inputMode="numeric" autoComplete="cc-csc" placeholder="123" value={cvv} onChange={(event) => setCvv(event.target.value.replace(/\D/g, '').slice(0, 3))} required /></label>
              </div>
              <p className="muted">Փորձնական քարտ՝ 4111 1111 1111 1111, ցանկացած ապագա ժամկետ և 3 նիշ CVV։</p>
              <button className="btn" type="submit" disabled={busy}>Վճարել {formatMoney(order.amount, order.currency)}</button>
            </form>
          ) : null}
          {order?.status === 'PAID' && order.wedding_id ? <Link className="btn" href={`/admin/weddings/${order.wedding_id}`}>Բացել ալբոմը</Link> : null}
        </div>
      </div>
    </main>
  );
}

function statusName(status) {
  const names = {
    PENDING: 'Սպասում է',
    PAYMENT_STARTED: 'Վճարումը սկսված է',
    PAID: 'Վճարված է',
    FAILED: 'Չհաջողվեց',
    CANCELLED: 'Չեղարկված է',
    REFUND_PENDING: 'Վերադարձը սպասում է',
    REFUNDED: 'Վերադարձված է',
  };
  return names[status] || status;
}
