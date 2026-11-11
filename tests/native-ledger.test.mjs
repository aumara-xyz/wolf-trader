import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../apps/service/ledger.mjs';

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'wolf-ledger-'));
  let clock = Date.now(), ask = '0.50', bid = '0.48', depth = '10000', age = 0, known = true, bookGate = null;
  const market = () => ({ id: 'm1', question: 'A real-looking fixture?', protocolVersion: 'ctf-v1', active: true, closed: false, acceptingOrders: true,
    outcomes: [{ name: 'Yes', assetId: 'a1' }], fee: { known, model: 'none', source: 'fixture' }, quantityStep: '0.01', minOrderNotional: '1' });
  const markets = { market: async () => market(), book: async () => { if (bookGate) await bookGate; return { assetId: 'a1', receivedAt: new Date(clock - age).toISOString(),
    bids: [{ price: bid, size: depth }], asks: [{ price: ask, size: depth }], minOrderSize: '5', minOrderSizeUnit: 'unverified' }; } };
  let ledger = createLedger({ dataDir, markets, now: () => clock });
  t.after(() => { ledger.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { get ledger() { return ledger; },
    set(next) { if (next.ask) ask = next.ask; if (next.bid) bid = next.bid; if (next.depth) depth = next.depth; if (next.age !== undefined) age = next.age; if (next.known !== undefined) known = next.known; },
    advance(ms) { clock += ms; },
    deferBook() { let release; bookGate = new Promise(resolve => { release = resolve; }); return () => { release(); bookGate = null; }; },
    restart() { ledger.close(); ledger = createLedger({ dataDir, markets, now: () => clock }); },
    preview: input => ledger.preview({ marketId: 'm1', assetId: 'a1', side: 'BUY', amount: '25', ...input }),
    commit: (quote, operationId = 'operation-one') => ledger.commitDemo({ quoteId: quote.id, operationId, expectedRevision: quote.accountRevision }),
  };
}

test('durable one-result buy, repeated operation and bid-side liquidation', async t => {
  const f = fixture(t), { quote } = await f.preview();
  assert.equal(quote.quantity, '50.000000');
  assert.equal(quote.debit, '25.000000');
  const bought = await f.commit(quote);
  assert.equal(bought.portfolio.account.cash, '975.000000');
  assert.equal((await f.commit(quote)).replayed, true);
  f.restart();
  assert.equal(f.ledger.portfolio().account.cash, '975.000000');
  assert.equal((await f.commit(quote)).replayed, true);
  const marked = await f.ledger.markedPortfolio();
  assert.equal(marked.positions[0].estimatedSellValue, '24.000000');
  assert.equal(marked.positions[0].unrealizedPnl, '-1.000000');
  assert.equal(marked.estimatedTotal, '999.000000');
  assert.equal(f.ledger.activity().items.filter(x => x.type === 'demo.buy').length, 1);
});

test('operation lookup remains pending during asynchronous checks and retries bind to one result', async t => {
  const f = fixture(t), { quote } = await f.preview(), release = f.deferBook();
  const first = f.commit(quote, 'pending-operation');
  assert.deepEqual(f.ledger.operation('pending-operation'), { pending: true, status: 'pending', operationId: 'pending-operation' });
  const duplicate = f.commit(quote, 'pending-operation');
  await assert.rejects(f.ledger.commitDemo({ quoteId: 'changed-quote', operationId: 'pending-operation', expectedRevision: quote.accountRevision }), { code: 'OPERATION_CONFLICT' });
  assert.throws(() => f.ledger.resetDemo({ operationId: 'pending-operation', expectedEpoch: quote.accountEpoch, expectedRevision: quote.accountRevision }), { code: 'OPERATION_CONFLICT' });
  assert.equal(f.ledger.operation('pending-operation').pending, true);
  assert.equal(f.ledger.portfolio().account.cash, '1000.000000');
  release();
  const [result, retry] = await Promise.all([first, duplicate]);
  assert.deepEqual(retry.operation, result.operation);
  assert.equal(retry.replayed, true);
  assert.equal(f.ledger.operation('pending-operation').operation.id, 'pending-operation');
  assert.equal(f.ledger.portfolio().account.cash, '975.000000');
  assert.equal(f.ledger.activity().items.filter(x => x.type === 'demo.buy').length, 1);
});

test('two concurrent commits cannot spend the same account revision twice', async t => {
  const f = fixture(t), { quote } = await f.preview();
  const results = await Promise.allSettled([f.commit(quote, 'concurrent-one'), f.commit(quote, 'concurrent-two')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.find(x => x.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal(f.ledger.portfolio().account.cash, '975.000000');
});

test('weighted basis, partial quantity sale and final-close rounding leave no phantom position', async t => {
  const f = fixture(t);
  await f.commit((await f.preview()).quote, 'basis-buy-one');
  f.set({ ask: '0.60' });
  await f.commit((await f.preview({ amount: '30' })).quote, 'basis-buy-two');
  f.set({ ask: '0.72', bid: '0.70' });
  const reduced = await f.commit((await f.preview({ side: 'SELL', quantity: '25' })).quote, 'basis-sell-one');
  assert.equal(reduced.operation.allocatedBasis, '13.750000');
  assert.equal(reduced.portfolio.positions[0].costBasis, '41.250000');
  const closed = await f.commit((await f.preview({ side: 'SELL', quantity: '75' })).quote, 'basis-sell-two');
  assert.deepEqual(closed.portfolio.positions, []);
  assert.equal(closed.portfolio.account.cash, '1015.000000');
  assert.equal(closed.portfolio.realizedPnl, '15.000000');
});

test('stale, expired, worse-price, unknown-fee and insufficient-depth requests never debit', async t => {
  const f = fixture(t);
  f.set({ age: 6000 }); await assert.rejects(f.preview(), { code: 'STALE_BOOK' });
  f.set({ age: 0 }); const { quote } = await f.preview();
  f.set({ ask: '0.51' }); await assert.rejects(f.commit(quote), { code: 'QUOTE_CHANGED' });
  f.advance(10001); await assert.rejects(f.commit(quote), { code: 'QUOTE_EXPIRED' });
  f.set({ known: false }); await assert.rejects(f.preview(), { code: 'FEE_UNSUPPORTED' });
  f.set({ known: true, depth: '10' }); await assert.rejects(f.preview(), { code: 'INSUFFICIENT_DEPTH' });
  assert.equal(f.ledger.portfolio().account.cash, '1000.000000');
});

test('reset preserves old epoch history, refuses stale requests and is itself idempotent', async t => {
  const f = fixture(t), old = f.ledger.portfolio().account, { quote } = await f.preview();
  const reset = { operationId: 'reset-account-one', expectedRevision: old.revision, expectedEpoch: old.epoch };
  const fresh = f.ledger.resetDemo(reset);
  assert.notEqual(fresh.portfolio.account.epoch, old.epoch);
  assert.equal(f.ledger.resetDemo(reset).replayed, true);
  await assert.rejects(f.commit(quote), { code: 'REVISION_CONFLICT' });
  assert.throws(() => f.ledger.resetDemo({ ...reset, operationId: 'reset-account-two' }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.ledger.activity({ epoch: old.epoch }).items.length, 1);
});

test('operation identity cannot be reused with changed terms', async t => {
  const f = fixture(t), q1 = (await f.preview()).quote;
  await f.commit(q1);
  const q2 = (await f.preview()).quote;
  await assert.rejects(f.commit(q2), { code: 'OPERATION_CONFLICT' });
  assert.equal(f.ledger.portfolio().account.cash, '975.000000');
});
