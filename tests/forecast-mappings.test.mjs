import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createAukoraIntelligence } from '../packages/aukora/index.mjs';
import { createForecastMappings } from '../packages/intelligence/forecast-mappings.mjs';
import { PINS } from '../packages/providers/index.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wolf-mapping-test-'));
  let clock = Date.parse('2026-11-11T10:05:00Z');
  const aukora = createAukoraIntelligence({ dataDir: join(dir, 'aukora'), now: () => clock });
  const market = { id: '100', supported: true, outcomes: [{ name: 'Yes', assetId: '1001' }], rulesVersion: 'current-rule-hash', endDate: '2026-11-11T12:00:00Z', question: 'Bitcoin above $100,000 at noon?', sourceUrl: 'https://polymarket.com/event/test' };
  let mappings = createForecastMappings({ dataDir: dir, markets: { market: async () => market }, aukora, now: () => clock });
  const db = new DatabaseSync(join(dir, 'forecast-mappings.sqlite'));
  const input = { capitalMode: 'DEMO', confirmTerminalPriceContract: true, marketId: market.id, assetId: '1001', rulesVersion: market.rulesVersion, symbol: 'BTC-USD', strike: 100000, direction: 'above' };
  function scan({ chunks = false } = {}) {
    const forecast = { provider: 'kronos', model: { revision: PINS.kronos.model.revision }, symbol: 'BTC-USD', inputHash: 'a'.repeat(64), observedAt: new Date(clock).toISOString(), predictions: [{ timestamp: '2026-11-11T11:00:00Z', close: 103000 }], sourceUrl: 'https://api.exchange.coinbase.com/products/BTC-USD/candles' };
    const facts = { findings: [{ marketId: market.id, rulesVersion: market.rulesVersion }], specialists: { kronos: forecast } };
    let payload = facts;
    if (chunks) {
      const bytes = Buffer.from(JSON.stringify(facts)), sha256 = createHash('sha256').update(bytes).digest('hex'), parts = [];
      for (let offset = 0; offset < bytes.length; offset += 100) parts.push(aukora.record('research.evidence-part', { sha256, offset, encoding: 'base64', data: bytes.subarray(offset, offset + 100).toString('base64') }, parts.slice(-1)).id);
      payload = { schema: 'wolf-evidence-parts/v1', sha256, byteLength: bytes.length, encoding: 'utf8-json', parts };
    }
    const receipt = aukora.record('research.findings', payload);
    return { specialists: { kronos: forecast }, evidenceId: receipt.id };
  }
  t.after(() => { mappings.close(); db.close(); aukora.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get mappings() { return mappings; }, aukora, input, db, scan, market, advance: n => { clock += n; }, reopen() { mappings.close(); mappings = createForecastMappings({ dataDir: dir, markets: { market: async () => market }, aukora, now: () => clock }); } };
}

test('owner-reviewed exact mapping plus actual signed forecast yields an attributed non-probability signal', async t => {
  const f = fixture(t), mapping = await f.mappings.create(f.input), scan = f.scan();
  const [signal] = f.mappings.signals(scan);
  assert.equal(signal.mappingId, mapping.id); assert.equal(signal.terminalPrice, 103000); assert.equal(signal.eventProbability, null); assert.equal(signal.authorizesOrder, false);
  assert.equal(f.mappings.signals(scan)[0].id, signal.id);
  const event = JSON.parse(f.aukora.exportNostrEvent(signal.evidenceId).content);
  assert.deepEqual(event.parents, [mapping.evidenceId, scan.evidenceId]);
  assert.equal(f.aukora.verifyEvidence(f.aukora.exportEvidence()).ok, true);
  assert.equal(f.mappings.horizon({ symbol: 'BTC-USD', intervalSeconds: 3600, candles: [{ timestamp: '2026-11-11T09:00:00Z' }], horizon: 6 }), 2);
});

test('mapping requires current exact market rules and explicit paper-only semantic review', async t => {
  const f = fixture(t);
  for (const change of [{ capitalMode: 'LIVE' }, { confirmTerminalPriceContract: false }, { rulesVersion: 'old' }, { assetId: 'other' }, { symbol: 'made-up' }]) await assert.rejects(f.mappings.create({ ...f.input, ...change }), { code: 'FORECAST_MAPPING' });
  f.market.endDate = '2026-11-11T12:30:00Z'; await assert.rejects(f.mappings.create(f.input), { code: 'FORECAST_MAPPING' });
  assert.equal(f.aukora.status().records, 0);
});

test('editing the SQLite mapping index cannot alter signed trading semantics', async t => {
  const f = fixture(t), mapping = await f.mappings.create(f.input);
  f.db.prepare('UPDATE mappings SET json=? WHERE id=?').run(JSON.stringify({ ...mapping, strike: 1 }), mapping.id);
  assert.throws(() => f.mappings.get(mapping.id), { code: 'FORECAST_MAPPING' });
  assert.throws(() => f.mappings.list(), { code: 'FORECAST_MAPPING' });
});

test('a signed revocation prevents stale cache restoration even across reopening', async t => {
  const f = fixture(t), mapping = await f.mappings.create(f.input);
  assert.equal(f.mappings.revoke(mapping.id).status, 'revoked'); assert.deepEqual(f.mappings.signals(f.scan()), []);
  f.db.prepare('UPDATE mappings SET json=? WHERE id=?').run(JSON.stringify(mapping), mapping.id); f.reopen();
  assert.throws(() => f.mappings.get(mapping.id), { code: 'FORECAST_MAPPING' });
});

test('cached research and cached signal edits fail against the original signed findings', async t => {
  const f = fixture(t); await f.mappings.create(f.input); const scan = f.scan(), [signal] = f.mappings.signals(scan);
  const changed = structuredClone(scan); changed.specialists.kronos.predictions[0].close = 999999;
  assert.throws(() => f.mappings.signals(changed), { code: 'FORECAST_MAPPING' });
  f.db.prepare('UPDATE signals SET json=? WHERE id=?').run(JSON.stringify({ ...signal, terminalPrice: 999999 }), signal.id);
  assert.throws(() => f.mappings.signals(scan), { code: 'FORECAST_MAPPING' });
});

test('chunked signed findings reconstruct, and stale or wrong-revision outputs cannot become signals', async t => {
  const f = fixture(t); await f.mappings.create(f.input); const scan = f.scan({ chunks: true });
  assert.equal(f.mappings.signals(scan).length, 1);
  const wrong = structuredClone(scan); wrong.specialists.kronos.model.revision = 'unreviewed'; assert.deepEqual(f.mappings.signals(wrong), []);
  f.advance(300001); assert.deepEqual(f.mappings.signals(scan), []);
});

test('changed evidence signatures fail closed even when cache data is unchanged', async t => {
  const f = fixture(t), mapping = await f.mappings.create(f.input);
  const original = f.aukora.exportEvidence, bundle = original(); bundle.events[0].sig = '0'.repeat(128);
  f.aukora.exportEvidence = () => bundle;
  assert.throws(() => f.mappings.get(mapping.id), { code: 'FORECAST_MAPPING' });
});
