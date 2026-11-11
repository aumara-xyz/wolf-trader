import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketService, normalizeMarket, normalizeBook } from './markets.mjs';
import { createResearchService } from './research.mjs';
const NOW = Date.parse('2026-11-11T05:00:00Z'), at = new Date(NOW).toISOString();
function rawMarket(id = '101', patch = {}) {
  return { id, question: `Will documented event ${id} occur?`, slug: `event-${id}`, version: 'v1', conditionId: `condition-${id}`, outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', clobTokenIds: JSON.stringify([`${id}1`, `${id}2`]), active: true, closed: false, acceptingOrders: true, enableOrderBook: true, negRisk: false, feesEnabled: false, description: `Event ${id} resolves according to the designated public source and deadline.`, orderMinSize: 5, orderPriceMinTickSize: 0.01, liquidityNum: 10000, volume24hr: 5000, endDate: '2026-11-15T18:00:00Z', ...patch };
}
function rawBook(asset = '1011', patch = {}) {
  return { asset_id: asset, market: 'condition-101', bids: [{ price: '0.35', size: '50' }, { price: '0.39', size: '1000' }], asks: [{ price: '0.5', size: '50' }, { price: '0.4', size: '1000' }], min_order_size: '5', tick_size: '0.01', timestamp: String(NOW), hash: `book-${asset}`, ...patch };
}
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function fakeSource(rows = [rawMarket()]) {
  const calls = [];
  return { calls, fetchImpl: async (input, init) => {
    const url = new URL(input); calls.push({ url, init });
    if (url.hostname === 'clob.polymarket.com' && url.pathname === '/book') return response(rawBook(url.searchParams.get('token_id')));
    if (url.pathname === '/public-search') return response({ events: [{ id: '1', markets: rows }], pagination: { hasMore: false } });
    if (url.pathname === '/markets') return response(rows);
    if (url.pathname.startsWith('/markets/')) return response(rows.find(m => m.id === url.pathname.split('/').at(-1)) ?? rows[0]);
    throw new Error('Unexpected source route');
  } };
}
test('version selects token versus position ID without numeric coercion', () => {
  const both = { positionIds: ['90071992547409930001', '90071992547409930002'] };
  assert.equal(normalizeMarket(rawMarket('101', both)).outcomes[0].assetId, '1011');
  assert.equal(normalizeMarket(rawMarket('101', { ...both, version: 'v2' })).outcomes[0].assetId, both.positionIds[0]);
  assert.equal(normalizeMarket(rawMarket('101', { version: 'v3' })).supported, false);
  assert.equal(normalizeMarket(rawMarket('101', { version: undefined, ...both })).supported, false);
});
test('unknown/nonzero fees remain browse-only; legacy base fees prove nothing', () => {
  const unknown = normalizeMarket(rawMarket('101', { feesEnabled: undefined, makerBaseFee: 0, takerBaseFee: 0 }));
  assert.equal(unknown.fee.known, false); assert.equal(unknown.supported, false);
  const nonzero = normalizeMarket(rawMarket('101', { feesEnabled: true, feeSchedule: { rate: 0.04, exponent: 1, takerOnly: true } }));
  assert.equal(nonzero.fee.model, 'polymarket-curve'); assert.equal(nonzero.fee.roundingDecimals, 5); assert.equal(nonzero.supported, false);
  const zero = normalizeMarket(rawMarket());
  assert.equal(zero.supported, true); assert.equal(zero.fee.model, 'none');
  assert.equal(zero.minOrderNotionalUnit, 'USDC'); assert.equal(zero.quantityStepSource, 'demo-simulation-policy');
});
test('incomplete, closed, grouped and malformed outcomes cannot become executable', () => {
  for (const patch of [{ active: false }, { closed: true }, { acceptingOrders: undefined }, { enableOrderBook: false }, { negRisk: true }, { description: '' }, { orderMinSize: null }, { clobTokenIds: '["1011","1011"]' }, { outcomes: '["Only"]' }]) assert.equal(normalizeMarket(rawMarket('101', patch)).supported, false);
  const resolution = normalizeMarket(rawMarket('101', { closed: true, outcomePrices: '["1","0"]', umaResolutionStatus: 'resolved' })).resolution;
  assert.equal(resolution.final, false); assert.equal(resolution.payoutVector, null);
});
test('books sort both sides and preserve constraint units', () => {
  const b = normalizeBook(rawBook(), '1011', { receivedAt: at });
  assert.deepEqual(b.bids.map(x => x.price), ['0.39', '0.35']); assert.deepEqual(b.asks.map(x => x.price), ['0.4', '0.5']);
  assert.equal(b.minOrderSizeUnit, 'unverified'); assert.equal(b.sourceAt, at);
});
test('malformed, mismatched, crossed or future books are refused', () => {
  for (const patch of [{ asset_id: '1012' }, { bids: [{ price: 'NaN', size: '1' }] }, { asks: [{ price: '0.4', size: '-1' }] }, { asks: [{ price: '0.39', size: '1' }] }, { tick_size: null }, { timestamp: String(NOW + 60001) }]) assert.throws(() => normalizeBook(rawBook('1011', patch), '1011', { receivedAt: at }));
});
test('broker uses only fixed-host GETs and rejects unknown asset reads', async () => {
  const f = fakeSource(), service = createMarketService({ ...f, now: () => NOW });
  await assert.rejects(service.book('999'), { code: 'unknown-asset' }); assert.equal(f.calls.length, 0);
  await assert.rejects(service.market('https://private.example'), { code: 'invalid-identifier' });
  await service.market('101'); await service.book('1011');
  for (const c of f.calls) { assert.ok(['gamma-api.polymarket.com', 'clob.polymarket.com'].includes(c.url.hostname)); assert.equal(c.init.method, 'GET'); assert.equal(c.init.redirect, 'error'); assert.equal(c.init.headers.Authorization, undefined); }
});
test('fresh bypasses caches and callers cannot mutate cached inputs', async () => {
  const f = fakeSource(), service = createMarketService({ ...f, now: () => NOW });
  (await service.market('101')).fee.model = 'evil'; assert.equal((await service.market('101')).fee.model, 'none');
  await service.market('101', { fresh: true }); await service.book('1011'); await service.book('1011'); await service.book('1011', { fresh: true });
  assert.equal(f.calls.filter(x => x.url.pathname === '/markets/101').length, 2); assert.equal(f.calls.filter(x => x.url.pathname === '/book').length, 2);
});
test('discovery deduplicates IDs and reads real two-sided books', async () => {
  const f = fakeSource([rawMarket('101'), rawMarket('102'), rawMarket('101'), rawMarket('103')]);
  const result = await createMarketService({ ...f, now: () => NOW }).searchMarkets({ limit: 3 });
  assert.equal(result.markets.length, 3); assert.equal(new Set(result.markets.map(x => x.id)).size, 3);
  assert.ok(result.markets.every(m => m.supported && m.outcomes.every(o => o.priceType === 'best-ask')));
  assert.equal(f.calls.filter(x => x.url.pathname === '/book').length, 6);
});
test('this-week means a bounded UTC calendar week, not silent next-seven-days', async () => {
  const f = fakeSource([rawMarket('101'), rawMarket('102', { endDate: '2026-11-10T00:00:00Z' }), rawMarket('103', { endDate: '2026-11-17T00:00:00Z' })]);
  const r = await createMarketService({ ...f, now: () => NOW }).searchMarkets({ query: 'Find markets closing this week' });
  assert.deepEqual(r.markets.map(x => x.id), ['101']); assert.equal(r.timeWindow.until, '2026-11-15T23:59:59.999Z'); assert.equal(r.timeWindow.timeZone, 'UTC');
});
test('wrong source ID does not seed another market asset registry', async () => {
  const f = fakeSource([rawMarket('102')]), service = createMarketService({ ...f, now: () => NOW });
  await assert.rejects(service.market('101'), { code: 'market-schema' }); await assert.rejects(service.book('1021'), { code: 'unknown-asset' });
});
test('guided research gives sourced facts; explaining market two never falls back to market one', async () => {
  const f = fakeSource([rawMarket('101'), rawMarket('102'), rawMarket('103')]);
  const markets = createMarketService({ ...f, now: () => NOW });
  const r = createResearchService({ markets, env: {}, fetchImpl: () => { throw new Error('No paid provider call'); } });
  const found = await r.research({ message: 'Show markets about energy' });
  assert.equal(found.mode, 'guided'); assert.equal(found.markets.length, 3); assert.match(found.answer, /not a model forecast/);
  const second = await r.research({ sessionId: found.sessionId, marketId: '102', message: 'Explain what decides this market' });
  assert.equal(second.markets[0].id, '102'); assert.match(second.answer, /Event 102 resolves/);
  const ambiguous = await r.research({ sessionId: found.sessionId, message: 'Explain what decides this market' });
  assert.equal(ambiguous.needsMarketSelection, true); assert.equal(ambiguous.markets.length, 0);
});
test('portfolio explanation uses real cash, basis and realized results; no missing-value zeroes', async () => {
  const markets = { searchMarkets: async () => ({ markets: [] }), market: async () => null };
  const unknown = await createResearchService({ markets, env: {} }).research({ message: 'What changed in my positions?' });
  assert.equal(unknown.accountFactsAvailable, false); assert.match(unknown.answer, /will not guess/);
  const r = createResearchService({ markets, env: {}, readPortfolio: async () => ({ account: { cash: '975.000000', realizedPnl: '-1.500000', revision: 2 }, positions: [{ marketId: '101', question: 'An actual market', outcome: 'Yes', quantity: '50.000000', costBasis: '25.000000', estimatedSellValue: null, unrealizedPnl: null }] }) });
  const known = await r.research({ message: 'What changed in my positions?' });
  assert.match(known.answer, /\$975\.00/); assert.match(known.answer, /-\$1\.50/); assert.match(known.answer, /estimated sell value unavailable/); assert.equal(known.authorizesOrder, false);
});
test('invented model IDs/citations are rejected, never converted into portals', async () => {
  const m = normalizeMarket(rawMarket()), markets = { searchMarkets: async () => ({ markets: [m] }), market: async () => m };
  const r = createResearchService({ markets, env: { WOLF_DEEPSEEK_API_KEY: 'synthetic-test-key' }, fetchImpl: async () => response({ choices: [{ message: { content: JSON.stringify({ opportunities: [{ marketId: '999', relevance: 'test', countercase: 'uncertain', sourceIds: ['market:999'] }] }) } }] }) });
  assert.equal(r.status().mode, 'model'); assert.ok(!JSON.stringify(r.status()).includes('synthetic-test-key'));
  await assert.rejects(r.research({ message: 'Find energy markets' }), { code: 'research-validation' });
});
test('model selection cannot override source prices or supply a model-authored answer as fact', async () => {
  const m = normalizeMarket(rawMarket()), markets = { searchMarkets: async () => ({ markets: [m] }), market: async () => m }; let requests = 0;
  const r = createResearchService({ markets, env: { WOLF_DEEPSEEK_API_KEY: 'synthetic-test-key' }, fetchImpl: async (url, init) => {
    requests++; assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(init.redirect, 'error');
    return response({ choices: [{ message: { content: JSON.stringify({ answer: 'Invented answer ignored', opportunities: [{ marketId: '101', relevance: 'Related to the question.', countercase: 'The event may not occur.', sourceIds: ['market:101'], price: '0.001' }] }) } }] });
  } });
  assert.equal(requests, 0); const result = await r.research({ message: 'Find an event' });
  assert.equal(requests, 1); assert.equal(result.mode, 'model'); assert.equal(result.markets[0].outcomes[0].price, '0.4'); assert.ok(!result.answer.includes('Invented answer'));
});
test('cancellation blocks late portal publication', async () => {
  let release; const markets = { searchMarkets: async () => new Promise(resolve => { release = resolve; }), market: async () => null };
  const r = createResearchService({ markets, env: {} }); const pending = r.research({ sessionId: 'session', message: 'energy' });
  assert.equal(r.cancel({ sessionId: 'session' }).cancelled, true); release({ markets: [normalizeMarket(rawMarket())] });
  await assert.rejects(pending, { code: 'cancelled' });
});
test('a discovery deadline bounds a stalled public read and distinguishes timeout', async () => {
  const service = createMarketService({ timeoutMs: 200, searchTimeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await assert.rejects(service.searchMarkets(), { code: 'market-timeout', status: 504 });
});
test('book outage is not misreported as no matching markets', async () => {
  const f = fakeSource(); const service = createMarketService({ now: () => NOW, fetchImpl: async (url, init) => new URL(url).hostname === 'clob.polymarket.com' ? new Response('', { status: 503 }) : f.fetchImpl(url, init) });
  await assert.rejects(service.searchMarkets(), { code: 'book-data-unavailable' });
});
test('research deadline releases the busy session after a slow cancellable search', async () => {
  const markets = { market: async () => null, searchMarkets: async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) };
  const r = createResearchService({ markets, env: {}, deadlineMs: 5 });
  await assert.rejects(r.research({ sessionId: 'slow', message: 'energy' }), { code: 'research-timeout' });
  assert.equal(r.cancel('slow').cancelled, false);
});

test('host proposals discard caller market facts and resolve every ID through the service', async () => {
  const { resolveHostResearch } = await import('../../packages/wolf-core/host-research.mjs');
  const authoritative = normalizeMarket(rawMarket('101'));
  const calls = [];
  const result = await resolveHostResearch({ markets: [{ id: '101', question: 'Fake title', supported: true, fee: { model: 'none' }, outcomes: [{ assetId: '999' }] }], opportunities: [{ marketId: '101', relevance: 'Host interpretation', sources: [{ url: 'https://unverified.example' }], price: '0.001' }] }, async (id, options) => { calls.push({ id, options }); return authoritative; });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.fresh, true);
  assert.equal(result.markets[0].question, authoritative.question); assert.equal(result.markets[0].outcomes[0].assetId, '1011');
  assert.equal(result.findings['101'].authorizesOrder, false); assert.equal(result.findings['101'].sources, undefined); assert.equal(result.findings['101'].price, undefined);
});
test('host input IDs, cardinality and transaction authority are runtime-checked', async () => {
  const { extractHostResearchReferences } = await import('../../packages/wolf-core/host-research.mjs');
  for (const input of [null, [], { markets: {} }, { markets: [{ id: '101&active=true' }] }, { markets: [{ id: 101 }] }, { opportunities: [{ marketId: '__proto__' }] }, { markets: Array.from({ length: 21 }, (_, i) => ({ id: String(i) })) }, { authorizesOrder: true }, { opportunities: [{ marketId: '101', authorizesOrder: true }] }]) assert.throws(() => extractHostResearchReferences(input));
  const refs = extractHostResearchReferences({ markets: [{ id: '101' }], opportunities: [{ marketId: '101' }] });
  assert.deepEqual(refs.marketIds, ['101']);
});
test('host batch rejects a mismatched source record rather than returning partial portals', async () => {
  const { resolveHostResearch } = await import('../../packages/wolf-core/host-research.mjs');
  await assert.rejects(resolveHostResearch({ opportunities: [{ marketId: '101' }, { marketId: '102' }] }, async id => normalizeMarket(rawMarket(id === '102' ? '103' : id))), { code: 'HOST_MARKET_MISMATCH' });
});
test('host openMarket validates source outcome membership and stale work cannot publish', async () => {
  const { validateResolvedHostMarket, resolveHostResearch } = await import('../../packages/wolf-core/host-research.mjs');
  const m = normalizeMarket(rawMarket('102'));
  assert.equal(validateResolvedHostMarket(m, '102', { assetId: '1022' }), m);
  assert.throws(() => validateResolvedHostMarket(m, '102', { assetId: '1011' }), { code: 'HOST_OUTCOME_MISMATCH' });
  const controller = new AbortController();
  await assert.rejects(resolveHostResearch({ markets: [{ id: '102' }] }, async () => { controller.abort(); return m; }, { signal: controller.signal }), { code: 'HOST_RESEARCH_CANCELLED' });
});
