import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { units, decimal, fail } from '../../packages/wolf-core/fixed.mjs';
import { createPricing, marketBinding, normalizedBook, priceQuantity, validateMinimum, serializePricing, digest } from '../../packages/wolf-core/pricing.mjs';
const STARTING_CASH = 1_000_000_000n;
const validateOperation = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) fail('OPERATION_ID_REQUIRED', 'A unique operation ID is required.'); return value; };
const readJSON = row => row ? JSON.parse(row.json) : null;

/** Durable DEMO-only account. This module has no venue submission capability. */
export function createLedger({ dataDir, markets, now = Date.now }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'wolf-demo.sqlite'));
  // The local service is the canonical writer. Pending checks are process-owned;
  // completed money changes and their operation result commit together in SQLite.
  const inFlight = new Map();
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts(epoch TEXT PRIMARY KEY,revision INTEGER NOT NULL,cash TEXT NOT NULL,realized TEXT NOT NULL,opened_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS positions(epoch TEXT NOT NULL,asset_id TEXT NOT NULL,quantity TEXT NOT NULL,basis TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(epoch,asset_id));
    CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,request_digest TEXT NOT NULL,epoch TEXT NOT NULL,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY AUTOINCREMENT,epoch TEXT NOT NULL,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,json TEXT NOT NULL);
  `);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function initialize() {
    const epoch = randomUUID(), at = new Date(now()).toISOString();
    run('INSERT INTO accounts VALUES(?,0,?,?,?)', epoch, String(STARTING_CASH), '0', at);
    run("INSERT OR REPLACE INTO meta VALUES('active_epoch',?)", epoch);
    run('INSERT INTO journal(epoch,json) VALUES(?,?)', epoch, JSON.stringify({ type: 'demo.funding', epoch, amount: decimal(STARTING_CASH), at, label: 'Demo account opened' }));
    return epoch;
  }
  tx(() => { if (!get("SELECT value FROM meta WHERE key='active_epoch'")) initialize(); });
  function account() { return get("SELECT * FROM accounts WHERE epoch=(SELECT value FROM meta WHERE key='active_epoch')"); }
  function portfolio() {
    const a = account();
    const positions = all('SELECT * FROM positions WHERE epoch=? ORDER BY asset_id', a.epoch).map(p => ({ ...JSON.parse(p.json), quantity: decimal(p.quantity), costBasis: decimal(p.basis),
      averageCost: BigInt(p.quantity) ? decimal(BigInt(p.basis) * 1_000_000n / BigInt(p.quantity)) : '0.000000', estimatedSellValue: null, unrealizedPnl: null }));
    const basis = positions.reduce((sum, p) => sum + units(p.costBasis), 0n);
    return { capitalMode: 'DEMO', account: { epoch: a.epoch, revision: a.revision, cash: decimal(a.cash), startingCash: decimal(STARTING_CASH), realizedPnl: decimal(a.realized), openedAt: a.opened_at }, positions,
      cash: decimal(a.cash), totalCostBasis: decimal(basis), realizedPnl: decimal(a.realized), estimatedSellValue: positions.length ? null : '0.000000', estimatedTotal: positions.length ? null : decimal(a.cash), valuationComplete: !positions.length };
  }
  function activity({ limit = 100, epoch } = {}) {
    return { items: all('SELECT seq,json FROM journal WHERE epoch=? ORDER BY seq DESC LIMIT ?', epoch ?? account().epoch, Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({ sequence: row.seq, ...JSON.parse(row.json) })) };
  }
  async function markedPortfolio() {
    const snapshot = portfolio();
    snapshot.positions = await Promise.all(snapshot.positions.map(async position => {
      try {
        const market = await markets.market(position.marketId);
        const rawBook = await markets.book(position.assetId);
        const binding = marketBinding(market, position.assetId), book = normalizedBook(rawBook, position.assetId, now());
        const pricing = priceQuantity(binding, book, 'SELL', units(position.quantity));
        validateMinimum(pricing, binding, rawBook);
        return { ...position, estimatedSellValue: decimal(pricing.proceeds), unrealizedPnl: decimal(pricing.proceeds - units(position.costBasis)),
          markObservedAt: rawBook.receivedAt, markStatus: 'fresh', valuationLabel: 'Estimated full-exit proceeds' };
      } catch (error) {
        return { ...position, estimatedSellValue: null, unrealizedPnl: null, markStatus: 'unavailable', markReason: error.code ?? 'MARKET_DATA_UNAVAILABLE' };
      }
    }));
    snapshot.valuationComplete = snapshot.positions.every(p => p.estimatedSellValue !== null);
    const value = snapshot.positions.reduce((sum, p) => sum + (p.estimatedSellValue === null ? 0n : units(p.estimatedSellValue)), 0n);
    snapshot.estimatedSellValue = snapshot.valuationComplete ? decimal(value) : null;
    snapshot.estimatedTotal = snapshot.valuationComplete ? decimal(units(snapshot.account.cash) + value) : null;
    return snapshot;
  }
  function operation(id) {
    const recorded = readJSON(get('SELECT json FROM operations WHERE id=?', id));
    return recorded ?? (inFlight.has(id) ? { pending: true, status: 'pending', operationId: id } : null);
  }
  function replay(id, requestDigest) {
    const row = get('SELECT * FROM operations WHERE id=?', id);
    if (!row) return null;
    if (row.request_digest !== requestDigest) fail('OPERATION_CONFLICT', 'That operation ID was already used for another request.', 409);
    return { ...JSON.parse(row.json), replayed: true };
  }
  async function preview(input) {
    if (input.mode && input.mode !== 'DEMO') fail('DEMO_ONLY', 'Only simulated transactions are available.', 403);
    const a = account(), side = String(input.side).toUpperCase();
    if (side === 'BUY' && units(input.amount, 'spend') > BigInt(a.cash)) fail('INSUFFICIENT_CASH', `Available demo cash is $${decimal(a.cash)}.`, 409);
    const market = await markets.market(String(input.marketId), { fresh: true });
    const rawBook = await markets.book(String(input.assetId), { fresh: true });
    const result = createPricing({ ...input, market, book: rawBook, now: now() });
    const holding = get('SELECT * FROM positions WHERE epoch=? AND asset_id=?', a.epoch, String(input.assetId));
    if (side === 'SELL' && (!holding || result.priced.quantity > BigInt(holding.quantity))) fail('INSUFFICIENT_SHARES', 'You do not own that many shares.', 409);
    const quote = { id: randomUUID(), accountEpoch: a.epoch, accountRevision: a.revision, side,
      ...result.binding, ...serializePricing(result.priced), requestedAmount: input.amount ?? null,
      createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 10000).toISOString(), validityMs: 10000, observationId: result.book.id,
      bindingDigest: digest(result.binding), simulationModel: 'wolf-depth-taker-fee-free/v1', capitalMode: 'DEMO',
      maximumLoss: side === 'BUY' ? decimal(result.priced.debit) : '0.000000', conditionalPayout: decimal(result.priced.quantity) };
    run('INSERT OR IGNORE INTO observations VALUES(?,?)', result.book.id, JSON.stringify(rawBook));
    run('INSERT INTO quotes VALUES(?,?)', quote.id, JSON.stringify(quote));
    return { quote };
  }
  async function commitDemo(input) {
    const id = validateOperation(input.operationId);
    const requestDigest = digest({ type: 'commitDemo', quoteId: input.quoteId, expectedRevision: input.expectedRevision });
    const prior = replay(id, requestDigest);
    if (prior) return prior;
    const existing = inFlight.get(id);
    if (existing) {
      if (existing.requestDigest !== requestDigest) fail('OPERATION_CONFLICT', 'That operation ID is already checking another request.', 409);
      return { ...await existing.promise, replayed: true };
    }
    const pending = { requestDigest, promise: null };
    inFlight.set(id, pending);
    pending.promise = Promise.resolve().then(() => performCommit(input, id, requestDigest)).finally(() => {
      if (inFlight.get(id) === pending) inFlight.delete(id);
    });
    return pending.promise;
  }
  async function performCommit(input, id, requestDigest) {
    const quote = readJSON(get('SELECT json FROM quotes WHERE id=?', String(input.quoteId)));
    if (!quote) fail('QUOTE_NOT_FOUND', 'This quote is no longer available.', 404);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== quote.accountRevision) fail('REVISION_CONFLICT', 'The account changed. Request a new quote.', 409);
    if (now() >= Date.parse(quote.expiresAt)) fail('QUOTE_EXPIRED', 'Price changed. Review an updated quote.', 409);
    const market = await markets.market(quote.marketId, { fresh: true });
    const rawBook = await markets.book(quote.assetId, { fresh: true });
    const binding = marketBinding(market, quote.assetId), book = normalizedBook(rawBook, quote.assetId, now());
    if (digest(binding) !== quote.bindingDigest) fail('MARKET_TERMS_CHANGED', 'Market terms changed. Review a new quote.', 409);
    const pricing = priceQuantity(binding, book, quote.side, units(quote.quantity));
    validateMinimum(pricing, binding, rawBook);
    if ((quote.side === 'BUY' && pricing.debit > units(quote.debit)) || (quote.side === 'SELL' && pricing.proceeds < units(quote.proceeds))) fail('QUOTE_CHANGED', 'Price changed. Review an updated quote.', 409);
    return tx(() => {
      const repeated = replay(id, requestDigest);
      if (repeated) return repeated;
      const a = account();
      if (a.epoch !== quote.accountEpoch || a.revision !== quote.accountRevision) fail('REVISION_CONFLICT', 'The account changed. Request a new quote.', 409);
      if (now() >= Date.parse(quote.expiresAt)) fail('QUOTE_EXPIRED', 'The quote expired. Review a new quote.', 409);
      const position = get('SELECT * FROM positions WHERE epoch=? AND asset_id=?', a.epoch, quote.assetId);
      const oldQty = BigInt(position?.quantity ?? 0), oldBasis = BigInt(position?.basis ?? 0);
      let cash = BigInt(a.cash), realized = BigInt(a.realized), nextQty, nextBasis, allocatedBasis = 0n;
      if (quote.side === 'BUY') {
        if (pricing.debit > cash) fail('INSUFFICIENT_CASH', 'Insufficient demo cash.', 409);
        cash -= pricing.debit; nextQty = oldQty + pricing.quantity; nextBasis = oldBasis + pricing.debit;
      } else {
        if (pricing.quantity > oldQty) fail('INSUFFICIENT_SHARES', 'The position changed. Request a new quote.', 409);
        allocatedBasis = pricing.quantity === oldQty ? oldBasis : oldBasis * pricing.quantity / oldQty;
        nextQty = oldQty - pricing.quantity; nextBasis = oldBasis - allocatedBasis;
        cash += pricing.proceeds; realized += pricing.proceeds - allocatedBasis;
      }
      const metadata = { marketId: quote.marketId, assetId: quote.assetId, outcome: quote.outcome, question: quote.question, url: quote.url, protocolVersion: quote.protocolVersion };
      if (nextQty) run('INSERT OR REPLACE INTO positions VALUES(?,?,?,?,?)', a.epoch, quote.assetId, String(nextQty), String(nextBasis), JSON.stringify(metadata));
      else run('DELETE FROM positions WHERE epoch=? AND asset_id=?', a.epoch, quote.assetId);
      run('UPDATE accounts SET revision=revision+1,cash=?,realized=? WHERE epoch=?', String(cash), String(realized), a.epoch);
      run('INSERT OR IGNORE INTO observations VALUES(?,?)', book.id, JSON.stringify(rawBook));
      const receipt = { id, operationId: id, quoteId: quote.id, type: quote.side === 'BUY' ? 'demo.buy' : 'demo.sell', label: 'Simulated fill', ...metadata,
        side: quote.side, ...serializePricing(pricing), allocatedBasis: decimal(allocatedBasis), accountEpoch: a.epoch, accountRevision: a.revision + 1,
        cashAfter: decimal(cash), at: new Date(now()).toISOString(), observationId: book.id, previewObservationId: quote.observationId, simulationModel: quote.simulationModel };
      run('INSERT INTO journal(epoch,json) VALUES(?,?)', a.epoch, JSON.stringify(receipt));
      const result = { ok: true, operation: receipt, portfolio: portfolio() };
      run('INSERT INTO operations VALUES(?,?,?,?)', id, requestDigest, a.epoch, JSON.stringify(result));
      return result;
    });
  }
  function resetDemo(input) {
    const id = validateOperation(input.operationId), requestDigest = digest({ type: 'resetDemo', expectedEpoch: input.expectedEpoch, expectedRevision: input.expectedRevision });
    if (inFlight.has(id)) fail('OPERATION_CONFLICT', 'That operation ID is already checking another request.', 409);
    return tx(() => {
      const prior = replay(id, requestDigest);
      if (prior) return prior;
      const a = account();
      if (input.expectedEpoch !== a.epoch || input.expectedRevision !== a.revision) fail('REVISION_CONFLICT', 'The account changed. Review the reset again.', 409);
      const epoch = initialize();
      const receipt = { id, operationId: id, type: 'demo.reset', label: 'Started a new demo account', previousEpoch: a.epoch, accountEpoch: epoch, at: new Date(now()).toISOString() };
      run('INSERT INTO journal(epoch,json) VALUES(?,?)', epoch, JSON.stringify(receipt));
      const result = { ok: true, operation: receipt, portfolio: portfolio() };
      run('INSERT INTO operations VALUES(?,?,?,?)', id, requestDigest, epoch, JSON.stringify(result));
      return result;
    });
  }
  function recordResearch(input, result) {
    const id = result.jobId ?? randomUUID(), sessionId = String(input.sessionId ?? 'default');
    run('INSERT OR REPLACE INTO research VALUES(?,?,?)', id, sessionId, JSON.stringify({ id, sessionId, input: { message: input.message ?? input.query }, result, at: new Date(now()).toISOString() }));
    return result;
  }
  function researchHistory(sessionId = 'default') { return { items: all('SELECT json FROM research WHERE session_id=? ORDER BY rowid DESC LIMIT 100', sessionId).map(readJSON).reverse() }; }
  function events(after = 0) { return all('SELECT seq,json FROM journal WHERE seq>? ORDER BY seq LIMIT 500', after).map(row => ({ sequence: row.seq, ...JSON.parse(row.json) })); }
  return { preview, commitDemo, resetDemo, portfolio, markedPortfolio, activity, operation, recordResearch, researchHistory, events, close: () => db.close() };
}
