import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWolfServer } from '../apps/service/server.mjs';

test('local HTTP session, durable quote commit and read-only research share one account', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'wolf-http-'));
  writeFileSync(join(dataDir, 'index.html'), '<!doctype html><title>Wolf test</title>');
  writeFileSync(join(dataDir, 'release.json'), JSON.stringify({ buildId: 'test-release' }));
  let registered = false;
  const value = { id: 'm1', question: 'HTTP fixture', supported: true, active: true, acceptingOrders: true,
    outcomes: [{ name: 'Yes', assetId: 'a1' }], fee: { known: true, model: 'none' }, minOrderNotional: '5', quantityStep: '0.01' };
  const markets = {
    capabilities: () => ({ marketData: 'fixture' }),
    searchMarkets: async () => ({ markets: [value] }),
    market: async () => { await new Promise(resolve => setTimeout(resolve, 5)); registered = true; return value; },
    book: async () => { assert.ok(registered, 'market identity must be registered before reading its book'); return { assetId: 'a1', receivedAt: new Date().toISOString(), bids: [{ price: '0.48', size: '1000' }], asks: [{ price: '0.50', size: '1000' }] }; },
  };
  const research = { status: () => ({ mode: 'guided' }), research: async ({ message }) => ({ jobId: 'research-one', answer: message, authorizesOrder: false }) };
  const app = await createWolfServer({ dataDir, distDir: dataDir, markets, research });
  const address = await app.listen(0), base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const get = async path => { const result = await fetch(base + '/api/wolf/v1/' + path); assert.equal(result.status, 200); return result.json(); };
  assert.match(await (await fetch(base)).text(), /Wolf test/);
  assert.equal((await get('capabilities')).buildId, 'test-release');
  const denied = await fetch(base + '/api/wolf/v1/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
  assert.equal(denied.status, 403);
  const session = await fetch(base + '/api/wolf/v1/session');
  const { capability } = await session.json(), cookie = session.headers.get('set-cookie').split(';')[0];
  const post = async (path, value) => { const response = await fetch(base + '/api/wolf/v1/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie, 'X-Wolf-Capability': capability }, body: JSON.stringify(value) }); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const { quote } = await post('preview', { marketId: 'm1', assetId: 'a1', side: 'BUY', amount: '25' });
  const command = { quoteId: quote.id, expectedRevision: quote.accountRevision, operationId: 'http-buy-one' };
  assert.equal((await post('commitDemo', command)).portfolio.account.cash, '975.000000');
  assert.equal((await post('commitDemo', command)).replayed, true);
  registered = false;
  const portfolio = await get('portfolio');
  assert.equal(portfolio.positions[0].estimatedSellValue, '24.000000');
  assert.equal((await get('operation?id=http-buy-one')).operation.quantity, '50.000000');
  assert.equal((await post('research', { message: 'Explain my positions.' })).authorizesOrder, false);
  assert.equal((await get('research')).history.length, 1);
  assert.equal((await get('portfolio')).account.cash, '975.000000');
});
