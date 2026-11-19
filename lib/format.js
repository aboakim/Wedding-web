import { t } from '@/lib/i18n';

export const OCCASIONS = [
  { id: 'WEDDING', emoji: '💍' },
  { id: 'CHRISTENING', emoji: '⛪' },
  { id: 'BIRTHDAY', emoji: '🎂' },
  { id: 'GATHERING', emoji: '🎉' },
  { id: 'LAST_BELL', emoji: '🎓' },
  { id: 'PARTY', emoji: '🥳' },
  { id: 'OTHER', emoji: '📸' },
];

function field(id, name, lang) {
  const key = `occ.${id}.${name}`;
  const text = t(lang, key);
  return text === key ? t(lang, 'occ.fallback') : text;
}

export function occasionLabel(id, lang = 'hy') {
  return field(id, 'label', lang);
}

export function occasionTitle(id, lang = 'hy') {
  const item = OCCASIONS.find((entry) => entry.id === id);
  return item ? `${item.emoji} ${field(id, 'label', lang)}` : t(lang, 'occ.fallback');
}

export function occasionWho(id, lang = 'hy') {
  if (!id) return t(lang, 'new.name');
  return field(id, 'who', lang);
}

export function occasionOwner(id, lang = 'hy') {
  return field(id, 'owner', lang);
}

export function occasionOwners(id, lang = 'hy') {
  return field(id, 'owners', lang);
}

function locale(lang) {
  if (lang === 'ru') return 'ru-RU';
  if (lang === 'en') return 'en-US';
  return 'hy-AM';
}

export function formatMoney(amount, currency = 'AMD', lang = 'hy') {
  const value = Number(amount || 0).toLocaleString(locale(lang));
  return currency === 'AMD' ? `${value} ֏` : `${value} ${currency}`;
}

export function photoLimit(plan, lang = 'hy') {
  const count = Number(plan?.max_photos || 0).toLocaleString(locale(lang));
  const plus = plan?.features?.photos_plus ? '+' : '';
  return t(lang, 'plan.photos', { count: `${count}${plus}` });
}

export function planFeatures(plan) {
  const features = plan?.features;
  if (!features) return {};
  if (typeof features === 'string') {
    try { return JSON.parse(features); } catch { return {}; }
  }
  return features;
}

export function formatDate(iso, lang = 'hy') {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${t(lang, `month.${m}`)} ${y}`;
}

export function formatBytes(value, lang = 'hy') {
  const n = Number(value || 0);
  const mb = t(lang, 'unit.mb');
  const gb = t(lang, 'unit.gb');
  if (!n) return `0 ${mb}`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ${gb}`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} ${mb}`;
}
