import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../apps/service/ledger.mjs';
import { createAutonomyService } from '../packages/autonomy/index.mjs';
import { chooseProposal, resolveMandate } from '../packages/autonomy/strategy.mjs';
import { digest } from '../packages/wolf-core/pricing.mjs';

function fixture(t, extra = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'wolf-autonomy-test-'));
  let clock = 1_800_000_000_000, ask = '0.50', bid = '0.48', noAsk = '0.52', noBid = '0.50', age = 0, rules = 'Official event rules.', delay = null, loseReply = false;
  const market = () => ({ id: '100', eventId: '200', question: 'Fixture event?', protocolVersion: 'v1', active: true, closed: false, acceptingOrders: true, supported: true,
    outcomes: [{ name: 'Yes', assetId: '1001' }, { name: 'No', assetId: '1002' }], fee: { known: true, model: 'none', source: 'fixture' }, quantityStep: '0.01', minOrderNotional: '1', rules, rulesVersion: digest(rules), receivedAt: new Date(clock).toISOString() });
  const markets = { market: async () => market(), book: async assetId => ({ assetId, receivedAt: new Date(clock - age).toISOString(), bids: [{ price: assetId === '1001' ? bid : noBid, size: '10000' }], asks: [{ price: assetId === '1001' ? ask : noAsk, size: '10000' }], minOrderSize: '1', minOrderSizeUnit: 'shares' }) };
  const ledger = createLedger({ dataDir, markets, now: () => clock });
  const wrapped = { ...ledger, commitDemo: async (...args) => { if (delay) await delay; const result = await ledger.commitDemo(...args); if (loseReply) { loseReply = false; throw new Error('Simulated lost local response'); } return result; } };
  let runner = createAutonomyService({ dataDir, ledger: wrapped, markets, now: () => clock, ...extra });
  const config = { capitalMode: 'DEMO', strategy: 'quote-momentum/v1', marketIds: ['100'], perOrder: '10', maxExposure: '50', maxMarketExposure: '25', maxEventExposure: '50', maxSessionLoss: '10', maxOrders: 10, durationMinutes: 60, intervalSeconds: 5 };
  t.after(async () => { await runner.close(); ledger.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { get runner() { return runner; }, ledger, markets, config, get clock() { return clock; }, market,
    set(value) { if (value.ask) ask = value.ask; if (value.bid) bid = value.bid; if (value.noAsk) noAsk = value.noAsk; if (value.noBid) noBid = value.noBid; if (value.age !== undefined) age = value.age; if (value.rules) rules = value.rules; },
    advance(ms = 5000) { clock += ms; },
    async restart() { await runner.close(); runner = createAutonomyService({ dataDir, ledger: wrapped, markets, now: () => clock, ...extra }); },
    deferCommit() { let release; delay = new Promise(resolve => { release = resolve; }); return () => { delay = null; release(); }; },
    loseNextReply() { loseReply = true; },
    async entry() { await runner.arm(config); await runner.tick(); clock += 5000; ask = '0.54'; bid = '0.52'; await runner.tick(); },
  };
}

test('arming once permits autonomous depth-priced buy and rule-based exit with no per-order approval', async t => {
  const f = fixture(t); await f.entry();
  assert.equal(f.runner.status().totals.orders, 1);
  assert.equal(f.runner.status().lastDecision.action, 'bought');
  assert.equal(f.ledger.portfolio().positions.length, 1);
  f.advance(); f.set({ ask: '0.60', bid: '0.58' }); await f.runner.tick();
  assert.equal(f.runner.status().totals.orders, 2);
  assert.equal(f.runner.status().lastDecision.action, 'sold');
  assert.equal(f.ledger.portfolio().positions.length, 0);
  assert.ok(Number(f.ledger.portfolio().account.cash) > 1000);
  assert.equal(f.runner.events().filter(item => item.kind === 'autonomy.intent').length, 2);
});

test('a repeated or concurrent tick cannot duplicate an operation', async t => {
  const f = fixture(t); await f.runner.arm(f.config); await f.runner.tick(); f.advance(); f.set({ ask: '0.54', bid: '0.52' });
  await Promise.all([f.runner.tick(), f.runner.tick(), f.runner.tick()]);
  await f.runner.tick(); assert.equal(f.runner.status().totals.orders, 1);
  assert.equal(f.ledger.activity().items.filter(item => item.type === 'demo.buy').length, 1);
});

test('pause interrupts an already prepared intent before its financial effect', async t => {
  const f = fixture(t); await f.runner.arm(f.config); await f.runner.tick(); f.advance(); f.set({ ask: '0.54', bid: '0.52' });
  const release = f.deferCommit(), tick = f.runner.tick();
  for (let i = 0; i < 100 && !f.runner.status().pending; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.runner.status().pending);
  f.runner.pause(); release(); await tick;
  assert.equal(f.runner.status().phase, 'paused');
  assert.equal(f.ledger.portfolio().account.cash, '1000.000000');
  assert.equal(f.runner.status().totals.orders, 0);
});

test('a restart preserves positions and mandate history but requires explicit rearming', async t => {
  const f = fixture(t); await f.entry(); const cash = f.ledger.portfolio().account.cash;
  await f.restart(); f.advance(); f.set({ ask: '0.60', bid: '0.58' }); await f.runner.tick();
  assert.equal(f.runner.status().phase, 'paused'); assert.equal(f.ledger.portfolio().account.cash, cash);
  assert.equal(f.runner.status().totals.orders, 1); assert.equal(f.ledger.portfolio().positions.length, 1);
});

test('expiry and account reset invalidate standing permission', async t => {
  const f = fixture(t); await f.runner.arm({ ...f.config, durationMinutes: 1 }); await f.runner.tick();
  f.advance(60000); await f.runner.tick(); assert.equal(f.runner.status().phase, 'expired');
  await f.runner.arm(f.config); const account = f.ledger.portfolio().account;
  f.ledger.resetDemo({ operationId: 'reset-during-autonomy', expectedEpoch: account.epoch, expectedRevision: account.revision });
  await f.runner.tick(); assert.equal(f.runner.status().reason, 'ACCOUNT_CHANGED');
  assert.equal(f.runner.status().phase, 'paused');
});

test('changed resolution rules and stale books cannot become autonomous trades', async t => {
  const f = fixture(t); await f.runner.arm(f.config); await f.runner.tick(); f.advance(); f.set({ ask: '0.54', bid: '0.52', age: 6000 }); await f.runner.tick();
  assert.equal(f.runner.status().lastDecision.reason, 'STALE_BOOK'); assert.equal(f.runner.status().totals.orders, 0);
  f.advance(); f.set({ age: 0, rules: 'A material resolution change.' }); await f.runner.tick();
  assert.equal(f.runner.status().reason, 'RULES_CHANGED'); assert.equal(f.runner.status().phase, 'paused');
});

test('account exposure and loss thresholds are enforced independently of strategy', async t => {
  const f = fixture(t); await f.runner.arm({ ...f.config, maxExposure: '10', maxMarketExposure: '10', maxEventExposure: '10', maxSessionLoss: '0.20' });
  await f.runner.tick(); f.advance(); f.set({ ask: '0.54', bid: '0.52' }); await f.runner.tick();
  assert.equal(f.runner.status().totals.orders, 1); f.advance(); await f.runner.tick();
  assert.equal(f.runner.status().phase, 'paused'); assert.equal(f.runner.status().reason, 'SESSION_LOSS_LIMIT');
  assert.equal(f.ledger.portfolio().positions.length, 1, 'a stop does not pretend the position was liquidated');
});

test('the order budget includes exits and never silently expands', async t => {
  const f = fixture(t); await f.runner.arm({ ...f.config, maxOrders: 1 }); await f.runner.tick(); f.advance(); f.set({ ask: '0.54', bid: '0.52' }); await f.runner.tick();
  f.advance(); f.set({ ask: '0.60', bid: '0.58' }); await f.runner.tick();
  assert.equal(f.runner.status().reason, 'ORDER_BUDGET'); assert.equal(f.runner.status().totals.orders, 1);
});

test('live mode, undeclared markets and self-asserted model calibration cannot arm', async t => {
  const f = fixture(t);
  await assert.rejects(f.runner.arm({ ...f.config, capitalMode: 'LIVE' }), { code: 'PAPER_ONLY' });
  await assert.rejects(f.runner.arm({ ...f.config, marketIds: [] }), { code: 'MARKET_SCOPE_REQUIRED' });
  await assert.rejects(f.runner.arm({ ...f.config, strategy: 'forecast-edge/v1', forecastArtifact: 'a'.repeat(64), calibrated: true }), { code: 'APPROVED_FORECAST_REQUIRED' });
});

test('classifier confidence cannot satisfy the probability strategy and expired probability is ignored', () => {
  const now = 1_800_000_000_000, artifactHash = 'a'.repeat(64), calibrationReportHash = 'b'.repeat(64);
  const config = resolveMandate({ capitalMode: 'DEMO', strategy: 'forecast-edge/v1', marketIds: ['100'], forecastArtifact: artifactHash }, now);
  const observation = { marketId: '100', assetId: '1001', rulesVersion: 'rules', bid: '0.48', ask: '0.50', at: new Date(now).toISOString() };
  const approval = { artifactHash, calibrationReportHash, status: 'approved', task: 'event-probability', expiresAt: new Date(now + 100000).toISOString() };
  const base = { id: 'forecast', marketId: '100', assetId: '1001', probability: '0.90', artifactHash, calibrationReportHash, rulesVersion: 'rules', observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10000).toISOString(), sources: [{ id: 'public-source' }] };
  const choose = signal => chooseProposal({ config, observations: [observation], previous: {}, positions: [], managed: {}, now, signals: [signal], forecastApproval: approval });
  assert.equal(choose({ ...base, kind: 'classification' }), null);
  assert.equal(choose({ ...base, kind: 'event-probability', expiresAt: new Date(now - 1).toISOString() }), null);
  assert.equal(choose({ ...base, kind: 'event-probability' }).reason, 'approved-probability-edge');
});

test('recorded books replay chronologically against no-trade and buy-hold baselines', async t => {
  const f = fixture(t); await f.runner.arm(f.config);
  for (const [ask, bid] of [['0.50','0.48'],['0.52','0.50'],['0.55','0.53'],['0.59','0.57'],['0.63','0.61'],['0.61','0.59']]) { f.set({ ask, bid }); await f.runner.tick(); f.advance(); }
  const result = f.runner.evaluate();
  assert.equal(result.status, 'evaluated'); assert.equal(result.partition.heldOutFrames, 3); assert.equal(result.baselines.noTrade.pnl, '0.000000');
  assert.equal(result.predictiveEdgeEstablished, false); assert.equal(result.simulation.marketImpact, 'not modeled'); assert.ok(result.dataHash.length === 64);
});

test('provider scan budgets persist and a failed dependency cannot trade', async t => {
  let calls = 0;
  const f = fixture(t, { scan: async () => { calls++; if (calls === 1) throw Object.assign(new Error('source unavailable'), { code: 'SOURCE_OFFLINE' }); } });
  await f.runner.arm({ ...f.config, maxScans: 1 }); await f.runner.tick(); assert.equal(f.runner.status().lastDecision.reason, 'SOURCE_OFFLINE');
  f.advance(); await f.runner.tick(); assert.equal(f.runner.status().reason, 'SCAN_BUDGET'); assert.equal(f.runner.status().totals.scans, 1); assert.equal(f.runner.status().totals.orders, 0);
});

test('AUKORA records mandate, intent and fill causally and evidence failure stops new effects', async t => {
  const records = []; let failKind = '';
  const intelligence = { record(kind, payload, parents) { if (kind === failKind) throw new Error('Evidence storage unavailable'); const id = digest({ kind, payload, parents }); records.push({ id, kind, payload, parents }); return { id }; } };
  const f = fixture(t, { intelligence }); await f.runner.arm(f.config); await f.runner.tick();
  f.advance(); f.set({ ask: '0.54', bid: '0.52' }); failKind = 'autonomy.intent'; await f.runner.tick();
  assert.equal(f.runner.status().totals.orders, 0); assert.equal(f.ledger.portfolio().account.cash, '1000.000000'); assert.equal(f.runner.status().phase, 'paused');
  failKind = ''; await f.runner.arm(f.config); await f.runner.tick(); f.advance(); f.set({ ask: '0.58', bid: '0.56' }); await f.runner.tick();
  assert.equal(f.runner.status().totals.orders, 1);
  const intent = records.find(record => record.kind === 'autonomy.intent'), fill = records.find(record => record.kind === 'autonomy.fill');
  assert.ok(intent); assert.ok(fill.parents.includes(intent.id)); assert.equal(f.runner.status().evidence.mode, 'aukora-signed-history');
});

test('evidence failure after a modeled fill pauses while preserving the canonical financial effect', async t => {
  const intelligence = { record(kind, payload) { if (kind === 'autonomy.fill') throw new Error('Evidence disk full'); return { id: digest({ kind, payload }) }; } };
  const f = fixture(t, { intelligence }); await f.entry();
  assert.equal(f.runner.status().phase, 'paused'); assert.equal(f.runner.status().reason, 'EVIDENCE_UNAVAILABLE');
  assert.equal(f.runner.status().evidence.failure.financialEffectNotRolledBack, true); assert.equal(f.runner.status().totals.orders, 1); assert.equal(f.ledger.portfolio().positions.length, 1);
});

test('a lost commit response resolves its original ledger operation instead of buying twice', async t => {
  const f = fixture(t); f.loseNextReply(); await f.entry();
  assert.equal(f.runner.status().totals.orders, 1); assert.equal(f.runner.status().pending, null);
  assert.equal(f.ledger.activity().items.filter(item => item.type === 'demo.buy').length, 1);
  f.advance(); f.set({ ask: '0.55', bid: '0.53' }); await f.runner.tick(); assert.equal(f.runner.status().totals.orders, 1);
});

function forecastFixture(t) {
  let mapping, signals = [];
  const f = fixture(t, { approvedMappings: () => mapping, readSignals: () => signals });
  mapping = { id: 'btc-threshold-one', status: 'approved', marketId: '100', assetId: '1001', rulesVersion: f.market().rulesVersion, symbol: 'BTCUSDT', strike: '100000', direction: 'above', horizonEnd: new Date(f.clock + 3600000).toISOString(), modelArtifact: 'Kronos-small@reviewed-pin', expiresAt: new Date(f.clock + 1800000).toISOString(), minRelativeMove: '0.01' };
  signals = [{ ...mapping, id: 'forecast-one', mappingId: mapping.id, kind: 'underlying-price-forecast', forecastAt: new Date(f.clock).toISOString(), terminalPrice: '105000', expiresAt: new Date(f.clock + 300000).toISOString(), inputHash: 'c'.repeat(64) }];
  return { ...f, get runner() { return f.runner; }, get mapping() { return mapping; }, get signals() { return signals; }, config: { ...f.config, strategy: 'kronos-direction/v1', forecastMappingId: mapping.id } };
}

test('an approved Kronos threshold mapping drives a bounded paper action without inventing probability', async t => {
  const f = forecastFixture(t); await f.runner.arm(f.config); await f.runner.tick();
  assert.equal(f.runner.status().totals.orders, 1);
  const intent = f.runner.events().find(event => event.kind === 'autonomy.intent').intent;
  assert.equal(intent.proposal.reason, 'kronos-threshold-experiment'); assert.equal(intent.proposal.probabilityClaim, false); assert.equal(intent.proposal.probability, undefined);
});

test('revoking the forecast mapping after quote creation prevents the final effect', async t => {
  const f = forecastFixture(t); await f.runner.arm(f.config); const release = f.deferCommit(), task = f.runner.tick();
  for (let i = 0; i < 100 && !f.runner.status().pending; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.runner.status().pending); f.mapping.status = 'revoked'; release(); await task;
  assert.equal(f.runner.status().phase, 'paused'); assert.equal(f.runner.status().reason, 'FORECAST_APPROVAL_CHANGED'); assert.equal(f.ledger.portfolio().account.cash, '1000.000000');
});

test('a corrected or withdrawn forecast cannot execute an already prepared intent', async t => {
  const f = forecastFixture(t); await f.runner.arm(f.config); const release = f.deferCommit(), task = f.runner.tick();
  for (let i = 0; i < 100 && !f.runner.status().pending; i++) await new Promise(resolve => setImmediate(resolve));
  f.signals[0].invalidated = true; release(); await task;
  assert.equal(f.runner.status().lastDecision.reason, 'SIGNAL_INVALIDATED'); assert.equal(f.ledger.portfolio().account.cash, '1000.000000');
});

test('the final refreshed bid/ask spread is checked even when the buy ask did not change', async t => {
  const f = fixture(t); await f.runner.arm(f.config); await f.runner.tick(); f.advance(); f.set({ ask: '0.54', bid: '0.52' });
  const release = f.deferCommit(), task = f.runner.tick();
  for (let i = 0; i < 100 && !f.runner.status().pending; i++) await new Promise(resolve => setImmediate(resolve));
  f.set({ bid: '0.30' }); release(); await task;
  assert.equal(f.runner.status().lastDecision.reason, 'EXECUTION_SPREAD_CHANGED'); assert.equal(f.ledger.portfolio().account.cash, '1000.000000');
});

test('independent research reserves attempts against the armed mandate and cannot exceed its budget', async t => {
  const f = fixture(t); await assert.throws(() => f.runner.reserveResearchScan(), { code: 'MANDATE_INACTIVE' });
  await f.runner.arm({ ...f.config, maxScans: 2 });
  assert.equal(f.runner.reserveResearchScan().remaining, 1); assert.equal(f.runner.reserveResearchScan().remaining, 0);
  assert.throws(() => f.runner.reserveResearchScan(), { code: 'SCAN_BUDGET' });
  assert.equal(f.runner.status().phase, 'paused'); assert.equal(f.runner.status().totals.scans, 2);
  await f.restart(); assert.equal(f.runner.status().totals.scans, 2);
});
