const months = ['հունվար', 'փետրվար', 'մարտ', 'ապրիլ', 'մայիս', 'հունիս', 'հուլիս', 'օգոստոս', 'սեպտեմբեր', 'հոկտեմբեր', 'նոյեմբեր', 'դեկտեմբեր'];

export const OCCASIONS = [
  { id: 'WEDDING', emoji: '💍', label: 'Հարսանիք', who: 'Զույգ', owner: 'Հարս և փեսա', owners: 'Հարսի և փեսայի համար' },
  { id: 'CHRISTENING', emoji: '⛪', label: 'Կնունք', who: 'Երեխայի անուն', owner: 'Ծնողներ', owners: 'Ծնողների համար' },
  { id: 'BIRTHDAY', emoji: '🎂', label: 'Ծնունդ', who: 'Ում ծնունդն է', owner: 'Ծննդյան տեր', owners: 'Ծննդյան տիրոջ համար' },
  { id: 'GATHERING', emoji: '🎉', label: 'Հավաքույթ', who: 'Հավաքույթի անուն', owner: 'Կազմակերպիչ', owners: 'Կազմակերպչի համար' },
  { id: 'LAST_BELL', emoji: '🎓', label: 'Վերջի զանգ', who: 'Դպրոց կամ դասարան', owner: 'Շրջանավարտներ', owners: 'Շրջանավարտների համար' },
  { id: 'PARTY', emoji: '🥳', label: 'Քեֆ', who: 'Քեֆի անուն', owner: 'Քեֆի տեր', owners: 'Քեֆի տիրոջ համար' },
  { id: 'OTHER', emoji: '📸', label: 'Այլ', who: 'Առիթի անուն', owner: 'Առիթի տեր', owners: 'Առիթի տիրոջ համար' },
];

export function occasionLabel(id) {
  return OCCASIONS.find((item) => item.id === id)?.label || 'Առիթ';
}

export function occasionTitle(id) {
  const item = OCCASIONS.find((entry) => entry.id === id);
  return item ? `${item.emoji} ${item.label}` : 'Առիթ';
}

export function occasionWho(id) {
  return OCCASIONS.find((item) => item.id === id)?.who || 'Անուն';
}

export function occasionOwner(id) {
  return OCCASIONS.find((item) => item.id === id)?.owner || 'Առիթի տեր';
}

export function occasionOwners(id) {
  return OCCASIONS.find((item) => item.id === id)?.owners || 'Առիթի տիրոջ համար';
}

export function formatMoney(amount, currency = 'AMD') {
  const value = Number(amount || 0).toLocaleString('hy-AM');
  return currency === 'AMD' ? `${value} ֏` : `${value} ${currency}`;
}

export function photoLimit(plan) {
  const count = Number(plan?.max_photos || 0).toLocaleString('hy-AM');
  const plus = plan?.features?.photos_plus ? '+' : '';
  return `մինչև ${count}${plus} լուսանկար`;
}

export function planFeatures(plan) {
  const features = plan?.features;
  if (!features) return {};
  if (typeof features === 'string') {
    try { return JSON.parse(features); } catch { return {}; }
  }
  return features;
}

export function formatDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y}`;
}
