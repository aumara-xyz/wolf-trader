import { createHash } from 'node:crypto';

// Only public reads. No caller-supplied host, credential, order or signing path.
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const DOCS = 'https://docs.polymarket.com';
const MAX_BODY = 4 * 1024 * 1024;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const clone = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class MarketDataError extends Error {
  constructor(code, message, status = 502) {
    super(message); this.name = 'MarketDataError'; this.code = code;
    this.status = status; this.statusCode = status;
  }
}
function fail(code, message, status) { throw new MarketDataError(code, message, status); }
function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch {} }
  return [];
}
function decimal(value, { positive = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || text.length > 64 || !DECIMAL.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number > max || (positive ? number <= 0 : number < 0)) return null;
  return text;
}
function identifier(value, name = 'identifier') {
  if (typeof value !== 'string' || !/^\d{1,100}$/.test(value)) fail('invalid-identifier', `Invalid ${name}.`, 400);
  return value;
}
function text(value, max = 12000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function iso(value) {
  if (!value) return null;
  const time = /^\d{10,16}$/.test(String(value)) ? Number(value) * (String(value).length === 10 ? 1000 : 1) : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function normalizeFee(raw) {
  const enabled = raw.feesEnabled ?? raw.trading?.feesEnabled;
  const schedule = raw.feeSchedule ?? raw.trading?.feeSchedule;
  const source = `${DOCS}/market-data/market-details`;
  if (enabled === false) return { known: true, model: 'none', rate: '0', rateBps: 0, exponent: 1, roundingDecimals: 5, source, evidence: 'feesEnabled=false' };
  const rate = decimal(schedule?.rate, { max: 1 });
  const exponent = schedule?.exponent;
  if (enabled === true && rate !== null && Number.isInteger(exponent) && exponent >= 0 && exponent <= 4 && typeof schedule.takerOnly === 'boolean') {
    return { known: true, model: Number(rate) === 0 ? 'none' : 'polymarket-curve', rate, exponent, roundingDecimals: 5, takerOnly: schedule.takerOnly, source, evidence: 'feesEnabled=true; explicit feeSchedule', executable: Number(rate) === 0 };
  }
  return { known: false, model: 'unknown', source, reason: 'Market-specific fee metadata is unavailable.' };
}

/** Normalize official Gamma/raw and unified response shapes, never an LLM's market. */
export function normalizeMarket(raw, { receivedAt = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== 'object' || typeof raw.question !== 'string') fail('market-schema', 'The market source returned incomplete market data.');
  const id = identifier(String(raw.id ?? ''), 'market ID');
  const legacyIds = list(raw.clobTokenIds);
  const positionIds = list(raw.positionIds);
  let protocolVersion = raw.version ?? raw.protocolVersion;
  if (!protocolVersion && legacyIds.length === 2 && positionIds.length === 0) protocolVersion = 'v1';
  if (!['v1', 'v2'].includes(protocolVersion)) protocolVersion = 'unknown';
  let outcomes;
  if (raw.outcomes && !Array.isArray(raw.outcomes) && typeof raw.outcomes === 'object') {
    outcomes = Object.entries(raw.outcomes).map(([label, value]) => ({ name: text(value.label || label, 100), assetId: protocolVersion === 'v2' ? value.positionId : value.tokenId, price: decimal(value.price, { max: 1 }) }));
  } else {
    const labels = list(raw.outcomes), prices = list(raw.outcomePrices);
    const ids = protocolVersion === 'v2' ? positionIds : legacyIds;
    outcomes = labels.map((label, index) => ({ name: text(label, 100), assetId: ids[index], price: decimal(prices[index], { max: 1 }) }));
  }
  const binary = outcomes.length === 2 && outcomes.every(o => o.name && typeof o.assetId === 'string' && /^\d{1,100}$/.test(o.assetId)) && outcomes[0].assetId !== outcomes[1].assetId;
  outcomes = outcomes.map(o => ({ ...o, assetId: typeof o.assetId === 'string' ? o.assetId : null, protocolVersion, priceType: 'source-reference' }));
  const state = raw.state ?? raw;
  const fee = normalizeFee(raw);
  const minOrderNotional = decimal(raw.orderMinSize ?? raw.trading?.orderMinSize, { positive: true });
  const tickSize = decimal(raw.orderPriceMinTickSize ?? raw.trading?.orderPriceMinTickSize, { positive: true, max: 1 });
  const rules = text(raw.description ?? raw.rules);
  const slug = text(raw.slug, 250);
  const event = list(raw.events)[0];
  const unsupportedReasons = [];
  if (!binary) unsupportedReasons.push('This market does not expose two verified outcome asset IDs.');
  if (protocolVersion === 'unknown') unsupportedReasons.push('The market protocol version is not supported.');
  if (state.active !== true || state.closed !== false || state.acceptingOrders !== true || state.enableOrderBook !== true || state.archived === true) unsupportedReasons.push('This market is not currently accepting orders.');
  if (!fee.known) unsupportedReasons.push(fee.reason);
  else if (fee.model !== 'none') unsupportedReasons.push('Fee-bearing markets are browse-only while their side-specific fee accounting is verified.');
  if (!minOrderNotional || !tickSize) unsupportedReasons.push('Verified minimum order value or price increments are unavailable.');
  if (!rules) unsupportedReasons.push('The market resolution rules are unavailable.');
  if (state.negRisk === true) unsupportedReasons.push('Grouped negative-risk markets are browse-only in this initial demo.');
  const sourceUrl = `${GAMMA}/markets/${id}`;
  return {
    id, venue: 'Polymarket', eventId: event?.id ? String(event.id) : null, conditionId: text(raw.conditionId, 100) || null,
    question: text(raw.question, 1000), slug,
    url: slug ? `https://polymarket.com/market/${encodeURIComponent(slug)}` : 'https://polymarket.com',
    sourceUrl, protocolVersion, active: state.active === true, closed: state.closed === true,
    acceptingOrders: state.acceptingOrders === true, enableOrderBook: state.enableOrderBook === true,
    negRisk: state.negRisk === true, outcomes, fee, rules, rulesVersion: digest(rules),
    minOrderNotional, minOrderNotionalUnit: 'USDC', tickSize,
    quantityStep: '0.01', quantityStepSource: 'demo-simulation-policy',
    endDate: iso(state.endDate), updatedAt: iso(raw.updatedAt), receivedAt,
    liquidity: decimal(raw.liquidityNum ?? raw.liquidity) ?? '0', volume24h: decimal(raw.volume24hr) ?? '0',
    supported: unsupportedReasons.length === 0, unsupportedReasons,
    resolution: { status: text(raw.resolutionStatus ?? raw.umaResolutionStatus, 100) || (state.closed ? 'awaiting-supported-resolution' : 'open'), final: false, supported: false, payoutVector: null },
    simulation: { mode: 'DEMO', policy: 'zero-fee-binary-public-depth-v1', settlement: 'awaiting-verified-final-payout-adapter', assumesNoMarketImpact: true },
  };
}

export function normalizeBook(raw, expectedAssetId, { receivedAt = new Date().toISOString() } = {}) {
  const assetId = identifier(String(expectedAssetId), 'asset ID');
  if (!raw || String(raw.asset_id ?? raw.assetId) !== assetId || !Array.isArray(raw.bids) || !Array.isArray(raw.asks)) fail('book-schema', 'The public order book does not match this outcome.');
  const side = (levels, descending) => {
    if (levels.length > 2000) fail('book-schema', 'The public order book exceeds the supported size.');
    const result = levels.map(level => {
      const price = decimal(level?.price, { positive: true, max: 1 });
      const size = decimal(level?.size, { positive: true });
      if (!price || Number(price) >= 1 || !size) fail('book-schema', 'The public order book contains an invalid level.');
      return { price, size };
    });
    result.sort((a, b) => descending ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price));
    return result;
  };
  const bids = side(raw.bids, true), asks = side(raw.asks, false);
  if (bids.length && asks.length && Number(bids[0].price) >= Number(asks[0].price)) fail('crossed-book', 'The market book is crossing or updating. Refresh the quote.');
  const tickSize = decimal(raw.tick_size ?? raw.tickSize, { positive: true, max: 1 });
  const minOrderSize = decimal(raw.min_order_size ?? raw.minOrderSize, { positive: true });
  if (!tickSize || !minOrderSize) fail('book-constraints', 'The public book is missing its trading constraints.');
  const sourceAt = iso(raw.timestamp);
  if (sourceAt && Date.parse(sourceAt) > Date.parse(receivedAt) + 60_000) fail('book-clock', 'The public book timestamp is ahead of the local clock.');
  return { assetId, bids, asks, receivedAt, sourceAt, tickSize, minOrderSize, minOrderSizeUnit: 'unverified', hash: text(raw.hash, 200) || digest({ bids, asks }), sourceUrl: `${CLOB}/book?token_id=${assetId}`, freshness: 'fresh-snapshot', conditionId: text(raw.market, 100) || null };
}

function queryIntent(input, now) {
  const query = text(input, 200);
  const soon = /(?:this|next) week|closing|ending soon/i.test(query);
  let from = now, until = soon ? now + 7 * 86400000 : null;
  if (/\b(?:this|next) week\b/i.test(query)) {
    const today = new Date(now);
    const monday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    from = /\bnext week\b/i.test(query) ? monday + 7 * 86400000 : now;
    until = monday + (/\bnext week\b/i.test(query) ? 14 : 7) * 86400000 - 1;
  }
  let topic = query.replace(/https?:\/\/\S+/gi, '').replace(/\b(find|show|me|markets?|about|on|please|closing|ending|this|next|week|soon|some|the|with|liquid|liquidity|explore|discover)\b/gi, ' ').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/^(hi|hello|hey)$/i.test(topic)) topic = '';
  return { query, topic, from: new Date(from).toISOString(), until: until === null ? null : new Date(until).toISOString(), timeZone: 'UTC' };
}

export function createMarketService({ fetchImpl = globalThis.fetch, timeoutMs = 8000, searchTimeoutMs = 25000, now = Date.now } = {}) {
  const marketCache = new Map(), assetRegistry = new Map(), bookCache = new Map(), searchCache = new Map();
  const observations = [];
  let lastSuccessAt = null;
  function remember(map, key, value, max = 300) {
    map.delete(key); map.set(key, value);
    while (map.size > max) map.delete(map.keys().next().value);
  }
  async function read(origin, path, parameters = {}, signal) {
    if (![GAMMA, CLOB].includes(origin) || !path.startsWith('/')) fail('source-not-allowed', 'Unsupported market data source.', 400);
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(parameters)) if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) { await response.body?.cancel(); fail(response.status === 429 ? 'market-rate-limit' : 'market-source-unavailable', response.status === 429 ? 'Public market data is busy. Please try again shortly.' : 'The public market source could not complete this request.', response.status === 404 ? 404 : 502); }
      if (Number(response.headers.get('content-length') || 0) > MAX_BODY) fail('market-response-size', 'The public market response was too large.');
      const chunks = []; let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) { await reader.cancel(); fail('market-response-size', 'The public market response was too large.'); } chunks.push(part.value); }
      } else {
        const bytes = new TextEncoder().encode(await response.text());
        if (bytes.byteLength > MAX_BODY) fail('market-response-size', 'The public market response was too large.');
        chunks.push(bytes);
      }
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('market-response-invalid', 'The public source returned unreadable market data.'); }
      lastSuccessAt = new Date(now()).toISOString();
      observations.push({ url: url.toString(), receivedAt: lastSuccessAt });
      if (observations.length > 60) observations.shift();
      return { data: parsed, receivedAt: lastSuccessAt };
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      if (controller.signal.aborted) {
        const cancelled = signal?.aborted && signal.reason?.name !== 'TimeoutError';
        fail(cancelled ? 'cancelled' : 'market-timeout', cancelled ? 'Research cancelled.' : 'Public market data took too long to respond.', cancelled ? 409 : 504);
      }
      fail('market-connection', 'Public market data is unavailable. Saved positions are unchanged.', 503);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function register(raw, receivedAt) {
    const value = normalizeMarket(raw, { receivedAt });
    remember(marketCache, value.id, { value, at: now() });
    for (const outcome of value.outcomes) if (outcome.assetId) remember(assetRegistry, outcome.assetId, { marketId: value.id, protocolVersion: value.protocolVersion }, 600);
    return value;
  }
  async function market(id, { fresh = false, signal } = {}) {
    id = identifier(String(id), 'market ID');
    const cached = marketCache.get(id);
    if (!fresh && cached && now() - cached.at < 60_000) return clone(cached.value);
    const { data, receivedAt } = await read(GAMMA, `/markets/${id}`, {}, signal);
    if (String(data?.id) !== id) fail('market-schema', 'The source returned the wrong market.');
    const normalized = register(data, receivedAt);
    return clone(normalized);
  }
  async function book(assetId, { fresh = false, signal } = {}) {
    assetId = identifier(String(assetId), 'asset ID');
    if (!assetRegistry.has(assetId)) fail('unknown-asset', 'Load the source market before requesting an outcome book.', 400);
    const cached = bookCache.get(assetId);
    if (!fresh && cached && now() - cached.at < 2000) return clone(cached.value);
    const { data, receivedAt } = await read(CLOB, '/book', { token_id: assetId }, signal);
    const value = normalizeBook(data, assetId, { receivedAt });
    remember(bookCache, assetId, { value, at: now() });
    return clone(value);
  }
  async function searchMarkets({ query = '', limit = 3, cursor = null, signal } = {}) {
    const intent = queryIntent(query, now());
    limit = Math.max(1, Math.min(20, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 3));
    const offset = cursor === null || cursor === '' ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0 || offset > 500) fail('invalid-cursor', 'This market page is unavailable.', 400);
    const cacheKey = JSON.stringify({ query: intent.query, limit, offset });
    const cached = searchCache.get(cacheKey);
    if (cached && now() - cached.at < 30_000) return clone(cached.value);
    const deadline = AbortSignal.timeout(searchTimeoutMs);
    signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let rows = [], hasMore = false, receivedAt, sourceUrl;
    if (intent.topic) {
      const response = await read(GAMMA, '/public-search', { q: intent.topic, events_status: 'active', limit_per_type: 8, page: Math.floor(offset / 20) + 1, search_profiles: false, search_tags: false }, signal);
      receivedAt = response.receivedAt; sourceUrl = `${GAMMA}/public-search?q=${encodeURIComponent(intent.topic)}`;
      const events = list(response.data.events).slice(0, 8);
      for (const event of events) {
        if (Array.isArray(event.markets)) rows.push(...event.markets.map(m => ({ ...m, events: m.events ?? [{ id: event.id }] })));
        else if (event.id && /^\d+$/.test(String(event.id))) {
          const detail = await read(GAMMA, `/events/${event.id}`, {}, signal);
          rows.push(...list(detail.data.markets));
        }
      }
      hasMore = response.data.pagination?.hasMore === true;
    } else {
      const params = { active: true, closed: false, limit: 60, offset, order: 'volume24hr', ascending: false, end_date_min: intent.until ? intent.from : null, end_date_max: intent.until };
      const response = await read(GAMMA, '/markets', params, signal);
      receivedAt = response.receivedAt; sourceUrl = `${GAMMA}/markets`;
      rows = Array.isArray(response.data) ? response.data : list(response.data.markets);
      hasMore = rows.length === 60;
    }
    const unique = new Map();
    for (const raw of rows) {
      try {
        const value = register(raw, receivedAt);
        if (!value.active || value.closed || !value.acceptingOrders || !value.enableOrderBook) continue;
        if (intent.until && (!value.endDate || Date.parse(value.endDate) < Date.parse(intent.from) || Date.parse(value.endDate) > Date.parse(intent.until))) continue;
        unique.set(value.id, value);
      } catch (error) { if (!(error instanceof MarketDataError)) throw error; }
    }
    const candidates = [...unique.values()].sort((a, b) => Number(b.supported) - Number(a.supported) || Number(b.volume24h) - Number(a.volume24h)).slice(0, 20);
    const selected = [], warnings = [];
    for (const value of candidates) {
      if (signal?.aborted) fail(deadline.aborted ? 'market-timeout' : 'cancelled', deadline.aborted ? 'Public market discovery took too long to respond.' : 'Research cancelled.', deadline.aborted ? 504 : 409);
      if (value.supported) {
        try {
          const books = await Promise.all(value.outcomes.map(o => book(o.assetId, { signal })));
          const enough = Number(value.minOrderNotional) <= 25 && books.every(b => b.bids.length && b.asks.length && b.asks.reduce((sum, level) => sum + Number(level.price) * Number(level.size), 0) >= 25 && b.bids.reduce((sum, level) => sum + Number(level.price) * Number(level.size), 0) >= 25);
          if (!enough) { value.supported = false; value.unsupportedReasons.push('The public book cannot support the initial demo size on both sides.'); }
          value.outcomes = value.outcomes.map((o, index) => ({ ...o, price: books[index].asks[0]?.price ?? o.price, priceType: 'best-ask', bid: books[index].bids[0]?.price ?? null, priceObservedAt: books[index].receivedAt }));
          value.bookCheckedAt = books[0].receivedAt;
        } catch (error) {
          if (signal.aborted) throw error;
          value.supported = false; value.unsupportedReasons.push(error.message); warnings.push(error.message);
        }
      }
      // Default discovery prioritizes executable examples; explicit searches may return browse-only results.
      if (value.supported || intent.topic || intent.until) selected.push(value);
      if (selected.length >= limit) break;
    }
    if (!selected.length && warnings.length) fail('book-data-unavailable', 'Matching markets were found, but usable public order books are unavailable. Please retry.', 503);
    const nextOffset = offset + (intent.topic ? 20 : 60), nextCursor = hasMore && nextOffset <= 500 ? String(nextOffset) : null;
    const result = { markets: selected, nextCursor, cursor: nextCursor, query: intent.query, timeWindow: intent.until ? { from: intent.from, until: intent.until, timeZone: 'UTC' } : null, receivedAt, sourceUrl, warnings: [...new Set(warnings)], count: selected.length, mode: 'public-data', noMatches: selected.length === 0 };
    remember(searchCache, cacheKey, { value: result, at: now() }, 30);
    return clone(result);
  }
  return {
    capabilities: () => ({ mode: 'DEMO', source: 'Polymarket public Gamma/CLOB', marketData: lastSuccessAt && now() - Date.parse(lastSuccessAt) < 60_000 ? 'live' : 'unavailable', supportedProtocols: ['v1', 'v2'], executableMarkets: 'verified zero-fee binary markets', quantityStep: '0.01', quantityStepSource: 'demo-simulation-policy', settlement: 'awaiting-verified-final-payout-adapter', lastSuccessAt, credentialsRequired: false, venueOrders: false }),
    searchMarkets, market, book, history: () => clone(observations),
  };
}
