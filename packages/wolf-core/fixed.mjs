export const SCALE = 1_000_000n;
export function fail(code, message, status = 400, details = {}) {
  throw Object.assign(new Error(message), { code, status, details });
}
export function units(value, field = 'amount') {
  const text = String(value ?? '');
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,12})?$/.test(text)) fail('INVALID_AMOUNT', `${field} must be a nonnegative decimal.`);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.slice(6).replace(/0/g, '')) fail('PRECISION_UNSUPPORTED', `${field} supports at most six decimal places.`);
  return BigInt(whole) * SCALE + BigInt(fraction.slice(0, 6).padEnd(6, '0'));
}
export function decimal(value) {
  const n = BigInt(value), sign = n < 0n ? '-' : '', a = n < 0n ? -n : n;
  return `${sign}${a / SCALE}.${String(a % SCALE).padStart(6, '0')}`;
}
export function ceilDiv(n, d) { return (n + d - 1n) / d; }
export function multiply(a, b, round = 'floor') { return round === 'ceil' ? ceilDiv(a * b, SCALE) : a * b / SCALE; }
