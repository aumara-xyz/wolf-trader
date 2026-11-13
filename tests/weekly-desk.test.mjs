import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAukoraIntelligence } from '../packages/aukora/index.mjs';
import { createWeeklyDesk } from '../packages/weekly/index.mjs';
import { PINS, normalizeEventForecastInput, validateEventForecast } from '../packages/providers/index.mjs';
import { validateVenueResolution } from '../packages/weekly/resolution.mjs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { validateOllamaPort, requireFreeOllamaPort, stopOwnedOllama } from '../packages/providers/ollama-lifecycle.mjs';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const market = id => ({ id, question: `Will test event ${id} happen?`, rules: 'This is a deterministic test fixture. Resolves Yes only if the named event occurs before the deadline.', rulesVersion: `rules-${id}`, sourceUrl: `https://gamma-api.polymarket.com/markets/${id}`, conditionId: '0x' + id.padStart(64, '0'), protocolVersion: 'v1', receivedAt: new Date(NOW).toISOString(), endDate: new Date(NOW + 2 * 86400000).toISOString(), closed: false, supported: true, fee: { known: true, model: 'none' }, outcomes: [{ assetId: id + '1', name: 'Yes', price: '.4' }, { assetId: id + '2', name: 'No', price: '.6' }] });
// Canonical production decimal strings include a leading zero.
function makeMarket(id) { const m = market(id); m.outcomes[0].price='0.4'; m.outcomes[1].price='0.6'; return m; }
function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wolf-weekly-test-')); let clock = NOW;
  const aukora = createAukoraIntelligence({ dataDir: join(dir, 'aukora'), now: () => clock });
  const marketMap = new Map(['1','2','3'].map(id => [id, makeMarket(id)]));
  let observations = [{ id: 'source:1', versionId: 'source:1:v1', contentHash: 'hash-v1', sourceUrl: 'https://www.whitehouse.gov/test-fixture', sourceFamily: 'whitehouse.gov', title: 'Test fixture source', text: 'Synthetic evidence for deterministic tests only.', receivedAt: new Date(NOW).toISOString() }];
  const inspected = [], forecasts = [], network = [];
  const intelligence = { status: async () => ({ job: null }), observations: () => observations, scan: async input => {
    inspected.push(input.marketId); assert.equal(input.useDexter, true);
    const m = structuredClone(marketMap.get(input.marketId));
    const evidenceId = aukora.record('research.findings', { fixture: true, marketId: m.id }).id;
    return { markets: [m], findings: [{ marketId: m.id, leads: [{ versionId: observations[0].versionId }] }], specialists: { dexter: { answer: 'Synthetic cited investigation.' } }, evidenceId };
  }};
  const providers = { forecastEvent: async input => {
    forecasts.push(input.market.id);
    return { provider: 'event-forecast', probability: input.market.id === '2' ? 0.2 : input.market.id === '3' ? 0.5 : 0.8, rationale: 'Fixture thesis tied to recorded evidence.', countercase: 'Fixture contrary evidence could defeat this estimate.', invalidation: 'An official contradiction invalidates this hypothesis.', sourceIds: input.sources.map(s => s.id), abstain: input.market.id === '3', model: PINS.dexter.model, modelDigest: PINS.dexter.modelDigest, promptVersion: 'wolf-event-forecast/v1', confidence: 0.6, ruleClarity: 0.8 };
  }, ...options.providers };
  const markets = { searchMarkets: async () => ({ markets: [...marketMap.values()].map(m => structuredClone(m)) }), market: async id => structuredClone(marketMap.get(id)), ...options.markets };
  const ledger = { markedPortfolio: async () => ({ account: { cash: '1000.000000', epoch: 'fixture-account' }, estimatedTotal: '1000.000000', positions: [] }) };
  const fetchImpl = async (url, request) => { network.push({ url, request }); const m = [...marketMap.values()].find(m => url.endsWith(m.conditionId)); assert(m); return new Response(JSON.stringify({ condition_id: m.conditionId, closed: true, accepting_orders: false, tokens: m.outcomes.map((o, i) => ({ token_id: o.assetId, outcome: o.name, winner: i === 0 })) })); };
  const weekly = createWeeklyDesk({ dataDir: join(dir, 'weekly'), markets, intelligence, providers, ledger, aukora, now: () => clock, fetchImpl, researchPolicy: options.researchPolicy });
  t.after(async () => { await weekly.close(); aukora.close(); rmSync(dir, { recursive: true, force: true }); });
  return { weekly, aukora, dir, marketMap, markets, providers, inspected, forecasts, network, advance: ms => clock += ms, correct: () => { observations = [{ ...observations[0], versionId: 'source:1:v2', contentHash: 'hash-v2' }]; } };
}
async function finish(weekly) {
  for (let i = 0; i < 150; i++) { const s = weekly.status(); if (!['running','cancelling'].includes(s.job?.phase)) return s; await new Promise(r => setTimeout(r, 10)); }
  throw Error('Fixture weekly job did not finish.');
}

test('freezes the complete universe before investigating every market and retains passes', async t => {
  const metrics = [], x = setup(t, { researchPolicy: { shadowEvaluate: input => { metrics.push(input); return { mode: 'SHADOW', score: 5, eligible: true, authorizesTrade: false }; } } });
  const job = x.weekly.launch({ marketIds: ['1','2','3'] }); assert.equal(job.phase, 'running');
  const s = await finish(x.weekly); assert.equal(s.job.phase, 'complete');
  assert.deepEqual(x.inspected, ['1','2','3']); assert.deepEqual(x.forecasts, ['1','2','3']);
  const b = s.latestBook; assert.equal(b.candidates.length, 3); assert.equal(b.candidates.find(c => c.marketId === '3').bucket, 'pass');
  assert.equal(b.candidates.find(c => c.marketId === '2').chosenOutcome.name, 'No');
  assert.equal(b.candidates.find(c => c.marketId === '2').chosenProbability, .8);
  const events = x.aukora.exportEvidence().events.map(e => JSON.parse(e.content));
  assert.equal(events[0].kind, 'weekly.universe-frozen');
  assert(events.findIndex(e => e.kind === 'weekly.forecast-input') > events.findIndex(e => e.kind === 'research.findings'));
  assert.equal(x.weekly.readSignals().length, 2); assert(x.weekly.readSignals().every(s => !s.calibrated && !s.authorizesOrder));
  assert.equal(metrics.length, 3); assert.equal(metrics[0].independentSources, 1); assert.equal(b.authorizesOrder, false);
  assert.equal(x.weekly.commitment().candidates.length, 3); assert.equal(x.weekly.commitment().signedBookReceipt.id, b.evidenceId); assert.equal(x.weekly.commitment().signedBookReceipt.sig.length, 128); assert.equal(x.weekly.commitment().signedCheckpoint.pubkey, x.aukora.status().identity.pubkey); assert.equal(x.aukora.verifyEvidence(x.weekly.exportBundle().evidence).ok, true);
});

test('manual outcome labels never enter the authoritative prospective score, which includes abstentions', async t => {
  const x = setup(t); x.weekly.launch({ marketIds: ['1','2','3'] }); const { latestBook: b } = await finish(x.weekly);
  const supplied = await x.weekly.resolve({ bookId: b.id, candidateId: b.candidates[0].candidateId, outcome: 0, authority: 'venue-reported' });
  assert.equal(supplied.authority, 'user-supplied'); assert.equal(supplied.countsTowardScore, false);
  const pending = await x.weekly.score(); assert.equal(pending.resolvedCount, 0); assert.equal(pending.brier, null); assert.equal(x.network.length, 0);
  x.advance(3 * 86400000); for (const m of x.marketMap.values()) m.closed = true;
  const score = await x.weekly.score(); assert.equal(score.scoredForecasts, 3); assert.equal(score.comparableForecasts, 3); assert.equal(score.allBucketsIncluded, true); assert(score.cases.some(c => c.abstained));
  assert(Math.abs(score.brier - ((.8-1)**2 + (.2-1)**2 + (.5-1)**2)/3) < 1e-10);
  assert(Math.abs(score.marketBaselineBrier - .36) < 1e-10); assert.equal(score.paperPerformance.change, '0.000000');
  assert.equal(x.network.length, 3); assert(x.network.every(x => x.request.redirect === 'error'));
});

test('source correction and explicit signed withdrawal invalidate signals without rewriting the frozen book', async t => {
  const x = setup(t); x.weekly.launch({ marketIds: ['1','2'] }); const { latestBook: b } = await finish(x.weekly);
  const original = JSON.stringify(b); x.weekly.invalidate({ bookId: b.id, candidateId: b.candidates[0].candidateId, reason: 'Fixture owner withdrawal.' });
  assert.equal(x.weekly.readSignals().filter(s => s.invalidated).length, 1); assert.equal(JSON.stringify(x.weekly.latest()), original);
  x.correct(); assert(x.weekly.readSignals().every(s => s.invalidated)); assert.equal(JSON.stringify(x.weekly.latest()), original);
});

test('edited SQLite book projections cannot manufacture a different forecast', async t => {
  const x = setup(t); x.weekly.launch({ marketIds: ['1'] }); const { latestBook: b } = await finish(x.weekly);
  const database = new DatabaseSync(join(x.dir, 'weekly/weekly.sqlite')); b.candidates[0].forecast.probability = .99; database.prepare('UPDATE books SET json=? WHERE id=?').run(JSON.stringify(b), b.id); database.close();
  assert.throws(() => x.weekly.latest(), { code: 'WEEKLY_INTEGRITY' }); assert.throws(() => x.weekly.readSignals(), { code: 'WEEKLY_INTEGRITY' });
});

test('cancellation cannot publish a partial book or late forecast', async t => {
  let release, started; const ready = new Promise(r => started = r);
  const x = setup(t, { providers: { forecastEvent: async () => { started(); return new Promise(r => release = r); } } });
  x.weekly.launch({ marketIds: ['1','2'] }); await ready; x.weekly.cancel(); release({ probability: .9 });
  const s = await finish(x.weekly); assert.equal(s.job.phase, 'cancelled'); assert.equal(s.latestBook, null); assert.equal(x.weekly.readSignals().length, 0); assert.equal(x.inspected.length, 1);
});

test('real cryptographic challenges reject changed bytes, truncation and wrong authors on disposable copies', async t => {
  const x = setup(t); x.weekly.launch({ marketIds: ['1'] }); await finish(x.weekly);
  for (const kind of ['tamper','truncate','wrong-author']) { const value = x.weekly.challenge({ kind }); assert.equal(value.originalVerified, true); assert.equal(value.rejected, true); assert.equal(value.originalUnchanged, true); }
  assert.equal(x.aukora.verifyEvidence(x.aukora.exportEvidence()).ok, true);
});

test('weekly schedule requires explicit current host permission and signed schedule bytes', async t => {
  const x = setup(t);
  assert.throws(() => x.weekly.configureSchedule({ enabled: true, marketIds: ['1'] }), { code: 'WEEKLY_SCHEDULE_GRANT' });
  const schedule = x.weekly.configureSchedule({ enabled: true, intervalDays: 7, marketIds: ['1'] }, { grantId: 'fixture-grant', resource: 'wolf:weekly' });
  assert.throws(() => x.weekly.runScheduled(() => undefined), { code: 'WEEKLY_SCHEDULE_GRANT' });
  assert.throws(() => x.weekly.runScheduled(() => ({ allowed: false })), { code: 'WEEKLY_SCHEDULE_GRANT' });
  assert.equal(x.weekly.scheduleStatus().nextRunAt, schedule.nextRunAt);
  const run = x.weekly.runScheduled(input => { assert.equal(input.grantId, 'fixture-grant'); return { allowed: true }; }); assert.equal(run.launched, true); await finish(x.weekly); assert.equal(x.weekly.runScheduled(() => true).launched, false);
  const database = new DatabaseSync(join(x.dir, 'weekly/weekly.sqlite')); const row = JSON.parse(database.prepare('SELECT json FROM settings WHERE id=?').get('schedule').json); row.config.limit = 6; database.prepare('UPDATE settings SET json=? WHERE id=?').run(JSON.stringify(row), 'schedule'); database.close(); assert.throws(() => x.weekly.scheduleStatus(), { code: 'WEEKLY_INTEGRITY' });
});

test('venue result requires exact identity and winner flags, never merely a price of one', () => {
  const m = makeMarket('1'), raw = { condition_id: m.conditionId, closed: true, accepting_orders: false, tokens: m.outcomes.map((o,i) => ({ token_id: o.assetId, outcome: o.name, winner: i===0, price: i===0?1:0 })) };
  assert.equal(validateVenueResolution(raw,m,new Date(NOW).toISOString()).outcomes[0].payout, 1);
  assert.equal(validateVenueResolution({ ...raw, tokens: raw.tokens.map(t => ({...t,winner:false})) },m,new Date(NOW).toISOString()).final, false);
  assert.throws(() => validateVenueResolution({ ...raw, condition_id: '0x'+'f'.repeat(64) }, m), { code:'WEEKLY_RESOLUTION_INVALID' });
  assert.throws(() => validateVenueResolution({ ...raw, tokens: raw.tokens.map(t => ({...t,winner:undefined})) },m), { code:'WEEKLY_RESOLUTION_INVALID' });
  assert.equal(validateVenueResolution({ ...raw, closed:false },m).final, false);
});

test('explicit event forecast validator rejects invented citations, probability coercion and incomplete rationale', () => {
  const m=makeMarket('1'), input=normalizeEventForecastInput({ market:m,sources:[{id:'market:1',url:m.sourceUrl,text:m.rules}] });
  const value={probability:.7,rationale:'A sourced model opinion.',countercase:'The opposite outcome remains plausible.',invalidation:'A source correction would invalidate it.',sourceIds:['market:1'],abstain:false};
  assert.equal(validateEventForecast(value,input).calibration,'uncalibrated');
  assert.throws(()=>validateEventForecast({...value,sourceIds:['invented']},input));
  assert.throws(()=>validateEventForecast({...value,probability:'0.7'},input));
  assert.throws(()=>validateEventForecast({...value,countercase:''},input));
  assert.throws(()=>normalizeEventForecastInput({market:m,assetId:'999',sources:[{id:'market:1',url:m.sourceUrl,text:m.rules}]}));
});

test('a contract closing during inference cannot become a prospective forecast', async t => {
  const x = setup(t), forecast = x.providers.forecastEvent;
  x.providers.forecastEvent = async input => { const result = await forecast(input); x.marketMap.get('1').closed = true; return result; };
  x.weekly.launch({ marketIds: ['1'] }); const { latestBook: b } = await finish(x.weekly);
  assert.equal(b.candidates[0].forecast, null); assert.equal(b.candidates[0].error.code, 'WEEKLY_FORECAST_LATE'); assert.equal(x.weekly.readSignals().length, 0);
});

test('an outcome-token replacement during inference cannot cross the frozen contract boundary', async t => {
  const x = setup(t), forecast = x.providers.forecastEvent;
  x.providers.forecastEvent = async input => { const result = await forecast(input); x.marketMap.get('1').outcomes[0].assetId = '999'; return result; };
  x.weekly.launch({ marketIds: ['1'] }); const { latestBook: b } = await finish(x.weekly);
  assert.equal(b.candidates[0].forecast, null); assert.equal(b.candidates[0].error.code, 'WEEKLY_FORECAST_LATE');
});

test('local model ownership refuses foreign ports and waits for its owned process to exit', async () => {
  assert.equal(validateOllamaPort(undefined), 11437); assert.equal(validateOllamaPort('11438'), 11438);
  for (const value of [1, 65536, 11437.5, 'not-a-port']) assert.throws(() => validateOllamaPort(value));
  const foreign = createServer(); await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const port = foreign.address().port;
  try { await assert.rejects(requireFreeOllamaPort(port), /occupied/); } finally { await new Promise(resolve => foreign.close(resolve)); }
  await requireFreeOllamaPort(port);
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await stopOwnedOllama(child); assert(child.exitCode !== null || child.signalCode !== null);
});
