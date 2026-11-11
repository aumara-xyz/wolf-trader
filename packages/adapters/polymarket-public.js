// Keyless public reads of Polymarket Gamma and the CLOB book.
// Paper marks only. This module has no order route, no wallet, and no key.

export const POLY_SOURCE = 'POLYMARKET · PAPER';
export const PRICE_AGREE_ABS = 0.01;

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeMarket(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const outcomes = parseList(raw.outcomes).map((v) => String(v).toLowerCase());
  const prices = parseList(raw.outcomePrices).map(Number);
  const tokens = parseList(raw.clobTokenIds).map(String);
  const yesAt = outcomes.indexOf('yes');
  const noAt = outcomes.indexOf('no');
  if (yesAt < 0 || noAt < 0 || prices.length <= Math.max(yesAt, noAt) || tokens.length <= Math.max(yesAt, noAt)) return null;
  const yes = prices[yesAt];
  const no = prices[noAt];
  const id = String(raw.id || '').trim();
  const question = String(raw.question || '').trim();
  if (!id || !question) return null;
  if (![yes, no].every((p) => Number.isFinite(p) && p > 0 && p < 1)) return null;
  return {
    id,
    question,
    slug: String(raw.slug || ''),
    yes,
    no,
    yesToken: tokens[yesAt],
    noToken: tokens[noAt],
    bestBid: Number(raw.bestBid),
    bestAsk: Number(raw.bestAsk),
    acceptingOrders: raw.acceptingOrders !== false,
    enableOrderBook: raw.enableOrderBook !== false,
  };
}

export function isListed(market) {
  if (!market?.acceptingOrders || !market.enableOrderBook) return false;
  const { bestBid: bid, bestAsk: ask } = market;
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0.02 && ask < 0.98 && ask > bid && (ask - bid) <= 0.05;
}

async function getJson(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res || res.ok === false) return { ok: false, reason: 'http' };
    const body = await res.json();
    return { ok: true, body };
  } catch {
    return { ok: false, reason: 'http' };
  }
}

function listedFrom(rows) {
  if (!Array.isArray(rows)) return { ok: false, reason: 'no markets' };
  const markets = rows.map(normalizeMarket).filter(isListed).slice(0, 20);
  if (!markets.length) return { ok: false, reason: 'no markets' };
  return { ok: true, markets };
}

export async function listMarkets(fetchImpl = globalThis.fetch) {
  const url = `${GAMMA}/markets?active=true&closed=false&limit=40&order=volume24hr&ascending=false`;
  const res = await getJson(url, fetchImpl);
  if (!res.ok) return { ok: false, reason: 'no markets' };
  return listedFrom(res.body);
}

export async function searchMarkets(query, fetchImpl = globalThis.fetch) {
  const q = String(query || '').trim();
  if (q.length < 2) return listMarkets(fetchImpl);
  const res = await getJson(`${GAMMA}/public-search?q=${encodeURIComponent(q)}`, fetchImpl);
  if (!res.ok) return { ok: false, reason: 'no markets' };
  const events = res.body?.events;
  if (!Array.isArray(events)) return { ok: false, reason: 'no markets' };
  const rows = [];
  for (const event of events) {
    if (Array.isArray(event?.markets)) rows.push(...event.markets);
  }
  return listedFrom(rows);
}

export function bookTop(book) {
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const asks = Array.isArray(book?.asks) ? book.asks : [];
  let bestBid = -Infinity;
  let bestAsk = Infinity;
  for (const level of bids) {
    const price = Number(level?.price);
    if (Number.isFinite(price) && price > bestBid) bestBid = price;
  }
  for (const level of asks) {
    const price = Number(level?.price);
    if (Number.isFinite(price) && price < bestAsk) bestAsk = price;
  }
  if (!(bestBid > 0 && bestBid < 1 && bestAsk > 0 && bestAsk < 1 && bestAsk >= bestBid && (bestAsk - bestBid) <= 0.05)) {
    return { ok: false, reason: 'price uncertain' };
  }
  return { ok: true, bestBid, bestAsk, mid: (bestBid + bestAsk) / 2 };
}

export async function fetchBook(tokenId, fetchImpl = globalThis.fetch) {
  const id = String(tokenId || '').trim();
  if (!id) return { ok: false, reason: 'price uncertain' };
  const res = await getJson(`${CLOB}/book?token_id=${encodeURIComponent(id)}`, fetchImpl);
  if (!res.ok) return { ok: false, reason: 'price uncertain' };
  return bookTop(res.body);
}

export function pricesAgree(gammaPx, clobMid) {
  if (![gammaPx, clobMid].every((p) => Number.isFinite(p) && p > 0 && p < 1)) {
    return { ok: false, agree: false };
  }
  const gap = Math.abs(gammaPx - clobMid);
  return { ok: true, agree: gap <= PRICE_AGREE_ABS, gap };
}

export function paperQuote({ market, outcome, book }) {
  if (!market || (outcome !== 'YES' && outcome !== 'NO') || !book?.ok) {
    return { ok: false, reason: 'price uncertain' };
  }
  const gammaPx = outcome === 'YES' ? market.yes : market.no;
  const check = pricesAgree(gammaPx, book.mid);
  if (!check.ok || !check.agree) return { ok: false, reason: 'price uncertain' };
  const price = book.bestAsk;
  if (!(price > 0 && price < 1)) return { ok: false, reason: 'price uncertain' };
  return {
    ok: true,
    quote: {
      symbol: `pm:${market.id}:${outcome}`,
      price,
      provenance: {
        source: POLY_SOURCE,
        venue: 'gamma+clob',
        marketId: market.id,
        question: market.question,
        outcome,
        gamma: gammaPx,
        clobMid: book.mid,
        clobAsk: book.bestAsk,
        clobBid: book.bestBid,
        fetchedAt: new Date().toISOString(),
      },
    },
  };
}
