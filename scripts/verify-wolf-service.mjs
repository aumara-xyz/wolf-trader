import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Deliberately defaults to the isolated QA instance, never the installed app account.
const origin = process.env.WOLF_VERIFY_ORIGIN || 'http://127.0.0.1:4319';
if (new URL(origin).port === '4318') throw new Error('Use an isolated verification instance, not the installed account.');
const base = origin + '/api/wolf/v1/';
const sessionResponse = await fetch(base + 'session');
const session = await sessionResponse.json();
const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
async function api(route, input) {
  const response = await fetch(base + route, input ? { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, 'x-wolf-capability': session.capability }, body: JSON.stringify(input) } : undefined);
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message || response.statusText), { code: value.error?.code });
  return value;
}
const capabilities = await api('capabilities');
assert.equal(capabilities.capitalMode, 'DEMO');
assert.equal(capabilities.liveOrderSubmission, false);
const initial = await api('portfolio');
assert.equal(initial.positions.length, 0, 'Verification starts only from an empty QA account.');
const { markets } = await api('markets?limit=3');
assert.ok(markets.length > 0, 'Live public markets must be available.');
const market = markets.find(m => m.supported);
assert.ok(market, 'At least one supported real market is needed.');
const assetId = market.outcomes[0].assetId;
async function transact(intent) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { quote } = await api('preview', { ...intent, marketId: market.id, assetId });
    const input = { quoteId: quote.id, expectedRevision: quote.accountRevision, operationId: randomUUID() };
    try {
      const result = await api('commitDemo', input);
      const duplicate = await api('commitDemo', input);
      assert.equal(duplicate.operation.accountRevision, result.operation.accountRevision);
      assert.equal(duplicate.operation.operationId, result.operation.operationId);
      assert.equal(duplicate.replayed, true);
      return result;
    } catch (error) {
      if (!['QUOTE_CHANGED', 'QUOTE_EXPIRED'].includes(error.code) || attempt === 2) throw error;
    }
  }
}
const buy = await transact({ side: 'BUY', amount: '25' });
assert.equal(buy.portfolio.positions.length, 1);
assert.ok(Number(buy.portfolio.account.cash) < Number(initial.account.cash));
const add = await transact({ side: 'BUY', amount: '10' });
assert.ok(Number(add.portfolio.positions[0].quantity) > Number(buy.portfolio.positions[0].quantity));
const shareUnits = BigInt(add.portfolio.positions[0].quantity.replace('.', ''));
const quarterUnits = shareUnits / 4n / 10000n * 10000n;
const quarter = `${quarterUnits / 1000000n}.${(quarterUnits % 1000000n).toString().padStart(6, '0')}`;
const reduced = await transact({ side: 'SELL', quantity: quarter });
assert.ok(Number(reduced.portfolio.positions[0].quantity) < Number(add.portfolio.positions[0].quantity));
const exited = await transact({ side: 'SELL', quantity: reduced.portfolio.positions[0].quantity });
assert.equal(exited.portfolio.positions.length, 0);
const after = await api('portfolio');
const activity = await api('activity');
assert.equal(after.account.cash, exited.portfolio.account.cash);
assert.equal(activity.items.filter(e => e.type === 'demo.buy' || e.type === 'demo.sell').length, 4);
console.log(JSON.stringify({ verified: ['live market discovery', 'live quote', 'buy', 'add', 'partial sell', 'full cash out', 'retry idempotency', 'cash and activity agree'], market: market.question, initialCash: initial.account.cash, finalCash: after.account.cash, realizedPnl: after.realizedPnl, epoch: after.account.epoch, revision: after.account.revision }, null, 2));
