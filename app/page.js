import Link from 'next/link';
import { OCCASIONS } from '@/lib/format';

export default function HomePage() {
  return (
    <main className="wrap mid">
      <p className="eyebrow">Լուսանկարներ</p>
      <h1>Ի՞նչ առիթի նկարներ են</h1>
      <p className="lead">Ընտրեք առիթը։ Հյուրը բացում է հղումը, անում է սելֆի և տեսնում միայն իր նկարները։</p>
      <div className="occasions">
        {OCCASIONS.map((item) => (
          <Link key={item.id} className="occasion" href={`/admin/new?occasion=${item.id}`}>{item.emoji} {item.label}</Link>
        ))}
      </div>
      <div className="row">
        <Link className="btn secondary" href="/login">Լուսանկարչի մուտք</Link>
        <Link className="btn secondary" href="/register">Գրանցում</Link>
      </div>
    </main>
  );
}
