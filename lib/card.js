const DECLINED = '4000000000000002';
const ACCEPTED = '4111111111111111';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function luhn(number) {
  let sum = 0;
  let alt = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let n = Number(number[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function readCard(input) {
  const number = digits(input?.number);
  const expiry = digits(input?.expiry);
  const cvv = digits(input?.cvv);
  const name = String(input?.name || '').trim().replace(/\s+/g, ' ');
  if (number === DECLINED) {
    const error = new Error('declined');
    error.code = 'DECLINED';
    throw error;
  }
  if (number !== ACCEPTED || !luhn(number)) {
    const error = new Error('number');
    error.code = 'CARD';
    throw error;
  }
  if (expiry.length !== 4) {
    const error = new Error('expiry');
    error.code = 'EXPIRY';
    throw error;
  }
  const month = Number(expiry.slice(0, 2));
  const year = 2000 + Number(expiry.slice(2));
  const now = new Date();
  const expired = month < 1 || month > 12 || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  if (expired) {
    const error = new Error('expiry');
    error.code = 'EXPIRY';
    throw error;
  }
  if (cvv.length !== 3) {
    const error = new Error('cvv');
    error.code = 'CVV';
    throw error;
  }
  if (name.length < 2 || name.length > 40) {
    const error = new Error('name');
    error.code = 'HOLDER';
    throw error;
  }
  return { brand: 'Visa', last4: number.slice(-4) };
}
