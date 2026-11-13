import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWolfServer } from '../apps/service/server.mjs';
import { digest } from '../packages/wolf-core/pricing.mjs';

async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'wolf-foundation-http-'));
  let bookGate, markBookEntered, discoveryGate = false;
  const market = { id: '100', eventId: '200', question: 'HTTP fixture event?', supported: true, active: true, closed: false, acceptingOrders: true, protocolVersion: 'v1',
    outcomes: [{ name: 'Yes', assetId: '1001' }, { name: 'No', assetId: '1002' }], fee: { known: true, model: 'none' }, minOrderNotional: '1', quantityStep: '0.01', rules: 'Fixture rules.', rulesVersion: digest('Fixture rules.'), sourceUrl: 'https://polymarket.com/event/test' };
  const markets = {
    capabilities: () => ({ marketData: 'fixture' }),
    searchMarkets: async ({ signal } = {}) => {
      if (discoveryGate) await new Promise((resolve, reject) => { if (signal?.aborted) return reject(signal.reason); signal?.addEventListener('abort', () => reject(signal.reason), { once: true }); });
      return { markets: [market] };
    },
    market: async () => ({ ...market, receivedAt: new Date().toISOString() }),
    book: async assetId => {
      if (bookGate) { markBookEntered?.(); await bookGate; }
      return { assetId, receivedAt: new Date().toISOString(), bids: [{ price: '0.48', size: '1000' }], asks: [{ price: '0.50', size: '1000' }], minOrderSize: '1', minOrderSizeUnit: 'shares' };
    },
  };
  const providers = { status: async () => ({ providers: [] }), close: async () => {} };
  const research = { status: async () => ({ mode: 'fixture' }), cancel: async () => ({ cancelled: false }) };
  const app = await createWolfServer({ dataDir, distDir: dataDir, markets, providers, research, fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } }) });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}/api/wolf/v1/`, origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const session = await fetch(base + 'session'), { capability } = await session.json(), cookie = session.headers.get('set-cookie').split(';')[0];
  const post = async (path, value = {}, authorized = true) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin, ...(authorized ? { Cookie: cookie, 'X-Wolf-Capability': capability } : {}) }, body: JSON.stringify(value) });
    return { status: response.status, data: await response.json() };
  };
  const get = async path => (await fetch(base + path)).json();
  return { app, post, get, blockDiscovery: () => { discoveryGate = true; }, blockBook() { let release; const entered = new Promise(resolve => { markBookEntered = resolve; }); bookGate = new Promise(resolve => { release = resolve; }); return { entered, release: () => { bookGate = null; release(); } }; } };
}

test('foundation research requires the local capability and cancels without producing a partial trading signal', async t => {
  const f = await fixture(t); f.blockDiscovery();
  assert.equal((await f.post('intelligence/scan', {}, false)).status, 403);
  assert.equal((await f.post('intelligence/scan', { useProviders: false, includeGovernment: false })).status, 202);
  assert.equal((await f.post('intelligence/scan', {})).status, 409);
  assert.equal((await f.post('intelligence/cancel')).data.cancelled, true);
  const status = await f.get('intelligence');
  assert.ok(status.job,JSON.stringify(status)); assert.equal(status.job.phase, 'cancelled'); assert.equal(status.lastScan, null);
  assert.equal((await f.get('portfolio')).account.cash, '1000.000000');
  assert.equal((await f.get('autonomy')).phase, 'disarmed');
});

test('arming while a manual paper order awaits its book blocks the final manual effect and reset', async t => {
  const f = await fixture(t);
  const preview = await f.post('preview', { marketId: '100', assetId: '1001', side: 'BUY', amount: '10' });
  assert.equal(preview.status, 200); const quote = preview.data.quote;
  const block = f.blockBook(), pending = f.post('commitDemo', { quoteId: quote.id, expectedRevision: quote.accountRevision, operationId: 'manual-before-arm' });
  await block.entered;
  try {
    const request={capitalMode:'DEMO',strategy:'quote-momentum/v1',marketIds:['100'],perOrder:'10',maxExposure:'50',intervalSeconds:60};
    assert.equal((await f.post('autonomy/arm',request)).status,403);
    const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'}), publicKeyJwk=publicKey.export({format:'jwk'});
    const approve=async input=>{const c=await f.post('authority/challenge',input);assert.equal(c.status,200,JSON.stringify(c.data));return f.post('authority/complete',{challengeId:c.data.id,signature:sign('sha256',Buffer.from(c.data.signingText),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')});};
    await approve({action:'enroll',publicKeyJwk});
    const prepared=await f.post('authority/prepare',{request});const granted=await approve({action:'grant',terms:prepared.data.terms});
    assert.equal(granted.status,200,JSON.stringify(granted.data));
    const armed=await f.post('autonomy/arm',{...request,grantId:granted.data.grant.id});
    assert.equal(armed.status, 200, JSON.stringify(armed.data));
    assert.equal((await f.post('resetDemo', {})).data.error.code, 'PAUSE_FOR_RESET');
  } finally { block.release(); }
  const result = await pending;
  assert.equal(result.status, 409); assert.equal(result.data.error.code, 'PAUSE_FOR_MANUAL_ORDER');
  assert.equal((await f.get('portfolio')).account.cash, '1000.000000');
  assert.equal((await f.post('autonomy/pause')).data.phase, 'paused');
  assert.equal((await f.post('autonomy/stop')).data.phase, 'stopped');
  const records = (await f.get('intelligence/evidence')).events.map(event => JSON.parse(event.content));
  assert.ok(records.some(record => record.kind === 'autonomy.armed')); assert.equal(records.some(record => record.kind === 'execution.manual-paper'), false);
  await Promise.all([f.app.close(), f.app.close()]);
});
