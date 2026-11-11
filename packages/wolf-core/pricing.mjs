import { createHash } from 'node:crypto';
import { SCALE, units, decimal, multiply, fail } from './fixed.mjs';
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function marketBinding(market, assetId) {
  const outcome = market.outcomes?.find(x => String(x.assetId) === String(assetId));
  if (!outcome) fail('OUTCOME_INVALID', 'This outcome is not part of the market.');
  if (market.supported === false || market.closed || market.active === false || market.acceptingOrders === false) fail('MARKET_UNAVAILABLE', market.unsupportedReasons?.join(' ') || 'This market is not available for demo trading.');
  if (!market.fee?.known || market.fee.model !== 'none') fail('FEE_UNSUPPORTED', 'This market’s fee rules are not supported for simulation yet.');
  return { marketId: String(market.id), assetId: String(assetId), outcome: outcome.name,
    question: market.question, url: market.url, protocolVersion: market.protocolVersion ?? 'ctf-v1',
    fee: market.fee, quantityStep: market.quantityStep ?? '0.01', quantityStepSource: market.quantityStepSource ?? 'demo-simulation-policy',
    minOrderNotional: market.minOrderNotional ?? '0', tickSize: market.tickSize ?? null, rulesVersion: market.rulesVersion ?? digest(market.rules ?? market.description ?? '') };
}
export function normalizedBook(book, assetId, now = Date.now()) {
  const received = typeof book.receivedAt === 'number' ? book.receivedAt : Date.parse(book.receivedAt);
  if (!Number.isFinite(received) || now - received > 5000 || received - now > 1000 || book.stale === true || book.continuity === false) fail('STALE_BOOK', 'A fresh market quote is needed.', 409);
  if (String(book.assetId ?? book.tokenId ?? assetId) !== String(assetId)) fail('BOOK_IDENTITY_MISMATCH', 'The quote belongs to another outcome.');
  const levels = (rows, side) => {
    if (!Array.isArray(rows) || rows.length > 10000) fail('BOOK_INVALID', 'Invalid market depth.');
    const aggregate = new Map();
    for (const row of rows) {
      const p = units(row.price, 'price'), q = units(row.size ?? row.quantity, 'depth');
      if (p <= 0n || p >= SCALE || q <= 0n) fail('BOOK_INVALID', 'Invalid market depth.');
      aggregate.set(p.toString(), (aggregate.get(p.toString()) ?? 0n) + q);
    }
    return [...aggregate].map(([price, size]) => ({ p: BigInt(price), q: size })).sort((a, b) => a.p === b.p ? 0 : (a.p < b.p ? -1 : 1) * (side === 'BUY' ? 1 : -1));
  };
  const asks = levels(book.asks, 'BUY'), bids = levels(book.bids, 'SELL');
  if (asks.length && bids.length && bids[0].p > asks[0].p) fail('BOOK_CROSSED', 'The book is inconsistent. Request another quote.', 409);
  return { asks, bids, raw: book, received,
    id: book.id ?? digest({ assetId, bids: book.bids, asks: book.asks, receivedAt: book.receivedAt }) };
}
export function priceQuantity(binding, book, side, quantity) {
  const levels = side === 'BUY' ? book.asks : book.bids;
  let left = quantity, gross = 0n;
  const fills = [];
  for (const row of levels) {
    if (left === 0n) break;
    const q = left < row.q ? left : row.q;
    const value = multiply(q, row.p, side === 'BUY' ? 'ceil' : 'floor');
    gross += value; left -= q;
    fills.push({ quantity: decimal(q), price: decimal(row.p), value: decimal(value), fee: '0.000000' });
  }
  if (left !== 0n) fail('INSUFFICIENT_DEPTH', 'The book cannot fill that whole quantity. Try a smaller amount.', 409);
  return { quantity, gross, fee: 0n, debit: side === 'BUY' ? gross : 0n, proceeds: side === 'SELL' ? gross : 0n,
    averagePrice: quantity ? gross * SCALE / quantity : 0n, fills };
}
export function validateMinimum(priced, binding, rawBook) {
  if (priced.gross < units(binding.minOrderNotional, 'minimum notional')) fail('BELOW_MINIMUM', `The market minimum is $${binding.minOrderNotional}.`);
  if (rawBook.minOrderSizeUnit === 'shares' && priced.quantity < units(rawBook.minOrderSize, 'minimum shares')) fail('BELOW_MINIMUM', `The market minimum is ${rawBook.minOrderSize} shares.`);
}
export function createPricing({ market, book: rawBook, assetId, side, amount, quantity, now = Date.now() }) {
  side = String(side).toUpperCase();
  if (!['BUY', 'SELL'].includes(side)) fail('SIDE_INVALID', 'Choose buy or sell.');
  const binding = marketBinding(market, assetId), book = normalizedBook(rawBook, assetId, now);
  const step = units(binding.quantityStep, 'share increment');
  if (step <= 0n) fail('QUANTITY_STEP_INVALID', 'Share increments are unavailable.');
  let q;
  if (side === 'BUY') {
    const budget = units(amount, 'spend');
    if (!budget) fail('AMOUNT_REQUIRED', 'Enter a positive amount.');
    const total = book.asks.reduce((sum, row) => sum + row.q, 0n);
    let lo = 0n, hi = total / step;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (priceQuantity(binding, book, side, mid * step).debit <= budget) lo = mid; else hi = mid - 1n;
    }
    q = lo * step;
    if (q && q === total / step * step) {
      const max = priceQuantity(binding, book, side, q);
      if (budget - max.debit > 10000n) fail('INSUFFICIENT_DEPTH', 'Choose a smaller spend: this book cannot support the amount.', 409, { maxSpend: decimal(max.debit) });
    }
  } else q = units(quantity, 'shares');
  if (!q || q % step !== 0n) fail('QUANTITY_INVALID', `Use a positive quantity in increments of ${decimal(step)} shares.`);
  const priced = priceQuantity(binding, book, side, q);
  validateMinimum(priced, binding, rawBook);
  return { binding, book, priced, side };
}
export function serializePricing(priced) {
  return Object.fromEntries(Object.entries(priced).map(([key, value]) => [key, typeof value === 'bigint' ? decimal(value) : value]));
}
