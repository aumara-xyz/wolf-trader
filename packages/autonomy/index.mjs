import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { units, decimal, fail } from '../wolf-core/fixed.mjs';
import { digest, marketBinding, normalizedBook } from '../wolf-core/pricing.mjs';
import { resolveMandate, chooseProposal, mappingIsCurrent, STRATEGIES, signedUnits } from './strategy.mjs';
import { evaluateReplay } from './replay.mjs';

/** Durable, local PAPER governor. No model, wallet or live-order credentials are held here. */
export function createAutonomyService({ dataDir, ledger, markets, intelligence, scan, readSignals, approvedForecasts, approvedMappings, authorityGate, now = Date.now } = {}) {
  if (!dataDir || !ledger?.portfolio || !ledger?.commitDemo || !markets?.market || !markets?.book) throw new TypeError('Autonomy needs its own data directory, canonical paper ledger and public market adapter.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'wolf-autonomy.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,mandate_id TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,mandate_id TEXT NOT NULL,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence_links(event_id TEXT PRIMARY KEY,external_id TEXT NOT NULL,kind TEXT NOT NULL,correlation TEXT);
    CREATE TABLE IF NOT EXISTS mandates(id TEXT PRIMARY KEY,json TEXT NOT NULL);
  `);
  const instance = randomUUID(); let currentTick = null, timer = null, closed = false, closing = null;
  const get = (sql, ...args) => db.prepare(sql).get(...args), run = (sql, ...args) => db.prepare(sql).run(...args);
  const read = () => JSON.parse(get('SELECT json FROM state WHERE id=1').json);
  const save = state => run('INSERT OR REPLACE INTO state VALUES(1,?)', JSON.stringify(state));
  const tx = work => { db.exec('BEGIN IMMEDIATE'); try { const value = work(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  function log(kind, payload) {
    const event = { id: randomUUID(), kind, at: new Date(now()).toISOString(), capitalMode: 'DEMO', ...payload };
    run('INSERT INTO events(json) VALUES(?)', JSON.stringify(event));
    if (intelligence?.record) {
      const correlation = payload.operationId ?? payload.receipt?.operationId ?? payload.intent?.id ?? payload.mandateId ?? payload.mandate?.id ?? null;
      const prior = get('SELECT external_id FROM evidence_links ORDER BY rowid DESC LIMIT 1');
      const cause = correlation ? get('SELECT external_id FROM evidence_links WHERE correlation=? ORDER BY rowid DESC LIMIT 1', correlation) : null;
      const parents = [...new Set([prior?.external_id, cause?.external_id].filter(Boolean))];
      const bytes = Buffer.byteLength(JSON.stringify(event));
      const evidence = bytes < 30000 ? event : { id: event.id, kind, at: event.at, capitalMode: 'DEMO', payloadDigest: digest(event), localEventId: event.id, attachmentRetainedLocally: true, originalBytes: bytes, mandateId: payload.mandateId ?? payload.intent?.mandateId ?? null, operationId: correlation };
      try {
        const receipt = intelligence.record(kind, evidence, parents);
        if (receipt?.then || !/^[a-f0-9]{64}$/.test(receipt?.id ?? '')) fail('EVIDENCE_RESPONSE_INVALID', 'The evidence service did not return a durable record.', 503);
        run('INSERT INTO evidence_links VALUES(?,?,?,?)', event.id, receipt.id, kind, correlation);
      } catch (error) {
        if (['autonomy.armed', 'autonomy.intent', 'autonomy.research-reserved'].includes(kind)) fail('EVIDENCE_UNAVAILABLE', 'The paper mandate or intent could not be recorded by AUKORA. No new operation was submitted.', 503);
        const row = get('SELECT json FROM state WHERE id=1');
        if (row) {
          const state = JSON.parse(row.json); state.phase = 'paused'; state.reason = 'EVIDENCE_UNAVAILABLE'; state.generation++; state.evidenceFailure = { eventId: event.id, kind, code: error.code ?? 'EVIDENCE_UNAVAILABLE', at: event.at, financialEffectNotRolledBack: kind === 'autonomy.fill' }; save(state);
        }
      }
    }
    return event;
  }
  if (!get('SELECT id FROM state WHERE id=1')) save({ phase: 'disarmed', generation: 0, mandate: null, pending: null, lastDecision: null, lastTickAt: null, totals: { orders: 0, turnover: '0.000000', scans: 0 }, previous: {}, managed: {}, owner: instance });
  else tx(() => { const state = read(); if (state.phase === 'armed') { state.phase = 'paused'; state.reason = 'restart-requires-reconciliation-and-rearm'; state.generation++; log('autonomy.paused', { reason: state.reason, mandateId: state.mandate?.id }); } state.owner = instance; save(state); });

  function ensureOpen() { if (closed) fail('AUTONOMY_CLOSED', 'The paper runner has stopped.', 503); }
  function ownership(state) { if (state.owner !== instance) fail('RUNNER_REPLACED', 'A newer runner owns this account. Restart this service.', 409); }
  function setPhase(phase, reason) {
    ensureOpen();
    return tx(() => { const state = read(); ownership(state); state.phase = phase; state.reason = reason; state.generation++; save(state); log(`autonomy.${phase}`, { reason, mandateId: state.mandate?.id }); return state; });
  }
  function stats(state, portfolio = ledger.portfolio()) {
    const exposure = portfolio.positions.reduce((sum, p) => sum + units(p.costBasis), 0n);
    const remaining = state.mandate ? units(state.mandate.config.maxExposure) - exposure : 0n;
    return { ...state.totals, exposure: decimal(exposure), remainingExposure: decimal(remaining > 0n ? remaining : 0n), cash: portfolio.account.cash, accountEpoch: portfolio.account.epoch };
  }
  function status() {
    ensureOpen(); const state = read();
    return { schema: 'wolf-autonomy-status/v1', capitalMode: 'DEMO', phase: state.phase, reason: state.reason ?? null, mandate: state.mandate, pending: state.pending, lastDecision: state.lastDecision, lastTickAt: state.lastTickAt, totals: stats(state), performance: state.performance ?? null, evidence: { mode: intelligence?.record ? 'aukora-signed-history' : 'local-journal', failure: state.evidenceFailure ?? null }, strategies: STRATEGIES, schedulerRunning: Boolean(timer), inFlight: Boolean(currentTick), restartPolicy: 'paused-until-owner-rearms', liveOrderSubmission: false };
  }
  async function arm(input) {
    ensureOpen(); if (currentTick) fail('RUNNER_BUSY', 'Wait for the current paper operation to finish.', 409);
    await reconcile();
    const initial = read(); ownership(initial);
    if (initial.pending) fail('OPERATION_UNRESOLVED', 'Resolve the existing paper operation before arming.', 409);
    if (initial.phase === 'armed') fail('ALREADY_ARMED', 'Pause the current session before changing its limits.', 409);
    const generation = initial.generation, config = resolveMandate(input, now());
    const portfolio = await ledger.markedPortfolio();
    if (!portfolio.valuationComplete || portfolio.estimatedTotal === null) fail('VALUATION_UNAVAILABLE', 'All existing positions need a usable sell estimate before arming.', 409);
    if (units(portfolio.totalCostBasis) > units(config.maxExposure)) fail('EXPOSURE_LIMIT', 'Existing account exposure exceeds this mandate.', 409);
    const bindings = {};
    const bindingIds = [...new Set([...config.marketIds, ...portfolio.positions.map(position => position.marketId)])];
    if (bindingIds.length > 100) fail('ACCOUNT_SCOPE_TOO_LARGE', 'This runner can reconcile at most 100 distinct account markets.', 409);
    for (const id of bindingIds) {
      const market = await markets.market(id, { fresh: true });
      if (!market.outcomes?.length) fail('MARKET_UNAVAILABLE', 'A selected market has no supported outcomes.', 409);
      marketBinding(market, market.outcomes[0].assetId);
      bindings[id] = { rulesVersion: market.rulesVersion ?? digest(market.rules ?? ''), eventId: market.eventId ?? `market:${id}`, assetIds: market.outcomes.map(o => o.assetId) };
    }
    if (config.strategy === 'forecast-edge/v1') {
      const approval = await approvedForecasts?.(config.forecastArtifact);
      if (!approval || approval.status !== 'approved' || approval.task !== 'event-probability' || approval.artifactHash !== config.forecastArtifact || !/^[a-f0-9]{64}$/.test(approval.calibrationReportHash ?? '') || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now()) fail('APPROVED_FORECAST_REQUIRED', 'This probability artifact has no current trusted promotion record.', 409);
    }
    if (config.strategy === 'kronos-direction/v1') {
      const mapping = await approvedMappings?.(config.forecastMappingId);
      if (!mappingIsCurrent(mapping, config, now()) || !bindings[mapping.marketId]?.assetIds.includes(mapping.assetId) || mapping.rulesVersion !== bindings[mapping.marketId].rulesVersion) fail('APPROVED_MAPPING_REQUIRED', 'The exact market/outcome/rules mapping is not currently approved.', 409);
    }
    tx(() => {
      const latest = read(); ownership(latest);
      if (latest.generation !== generation || latest.pending) fail('CONTROL_CHANGED', 'The controls changed while the mandate was being checked.', 409);
      if (ledger.portfolio().account.epoch !== portfolio.account.epoch || ledger.portfolio().account.revision !== portfolio.account.revision) fail('ACCOUNT_CHANGED', 'The paper account changed. Review the mandate again.', 409);
      authorityGate?.({config,action:'arm',final:false});
      const id = randomUUID(), mandate = { id, config, accountEpoch: portfolio.account.epoch, accountRevisionAtArm: portfolio.account.revision, equityAtArm: portfolio.estimatedTotal, cashAtArm: portfolio.account.cash, bindings, configDigest: digest(config) };
      run('INSERT INTO mandates VALUES(?,?)', id, JSON.stringify(mandate));
      save({ phase: 'armed', generation: generation + 1, reason: null, mandate, pending: null, lastDecision: null, lastTickAt: null, totals: { orders: 0, turnover: '0.000000', scans: 0 }, previous: {}, managed: {}, owner: instance, performance: { baseline: 'hold cash / no new trades', baselineEquity: portfolio.estimatedTotal, equity: portfolio.estimatedTotal, change: '0.000000', observedAt: new Date(now()).toISOString() } });
      log('autonomy.armed', { mandate });
    });
    return status();
  }
  const pause = (reason = 'owner-paused') => { setPhase('paused', String(reason).slice(0, 200)); return status(); };
  const stop = () => { setPhase('stopped', 'owner-stopped'); return status(); };
  /** Reserve a bounded research launch attempt outside the order loop. No refunds on failed launches. */
  function reserveResearchScan() {
    ensureOpen();
    let reservation;
    try {
      reservation = tx(() => {
        const state = read(); ownership(state);
        if (state.phase !== 'armed') fail('MANDATE_INACTIVE', 'A research reservation requires an armed paper mandate.', 409);
        const expired = now() >= Date.parse(state.mandate.config.expiresAt), exhausted = state.totals.scans >= state.mandate.config.maxScans;
        if (expired || exhausted) {
          state.phase = expired ? 'expired' : 'paused'; state.reason = expired ? 'MANDATE_EXPIRED' : 'SCAN_BUDGET'; state.generation++; save(state);
          log('autonomy.research-refused', { mandateId: state.mandate.id, reason: state.reason });
          return { allowed: false, reason: state.reason };
        }
        state.totals.scans++; save(state);
        const result = { allowed: true, mandateId: state.mandate.id, attempt: state.totals.scans, remaining: state.mandate.config.maxScans - state.totals.scans, counts: 'launch-attempts-including-failures' };
        log('autonomy.research-reserved', result); return result;
      });
    } catch (error) { if (error.code === 'EVIDENCE_UNAVAILABLE') setPhase('paused', error.code); throw error; }
    if (!reservation.allowed) fail(reservation.reason, 'The standing research budget or session expired; no scan was launched.', 409);
    return reservation;
  }
  function guard(generation, quote, proposal, executionFacts) {
    const state = read(); ownership(state);
    if (state.phase !== 'armed' || state.generation !== generation) fail('MANDATE_INACTIVE', 'The standing paper mandate is no longer active.', 409);
    const { mandate } = state, c = mandate.config, portfolio = ledger.portfolio();
    if (now() >= Date.parse(c.expiresAt)) fail('MANDATE_EXPIRED', 'The standing paper mandate expired.', 409);
    if (portfolio.account.epoch !== mandate.accountEpoch) fail('ACCOUNT_CHANGED', 'The paper account was replaced.', 409);
    if (!c.marketIds.includes(quote.marketId) || !mandate.bindings[quote.marketId]?.assetIds.includes(quote.assetId)) fail('SCOPE_REFUSED', 'The order is outside the standing mandate.', 403);
    if (quote.rulesVersion !== mandate.bindings[quote.marketId].rulesVersion) fail('RULES_CHANGED', 'Market resolution rules changed. Review a new mandate.', 409);
    if (state.totals.orders >= c.maxOrders) fail('ORDER_BUDGET', 'The session order budget is exhausted.', 409);
    const value = quote.side === 'BUY' ? units(quote.debit) : units(quote.proceeds);
    if (units(state.totals.turnover) + value > units(c.maxTurnover)) fail('TURNOVER_LIMIT', 'The session turnover limit would be exceeded.', 409);
    if (proposal.signalExpiresAt && Date.parse(proposal.signalExpiresAt) <= now()) fail('SIGNAL_EXPIRED', 'The forecast expired before execution.', 409);
    if (proposal.signalId) {
      const snapshot = readSignals?.(), signals = Array.isArray(snapshot) ? snapshot : snapshot?.signals;
      const current = !snapshot?.then && Array.isArray(signals) ? signals.find(signal => signal?.id === proposal.signalId) : null;
      if (!current || current.invalidated === true || digest(current) !== proposal.signalDigest) fail('SIGNAL_INVALIDATED', 'The research signal changed or was withdrawn before execution.', 409);
    }
    if (proposal.forecast) {
      const approval = approvedForecasts?.(c.forecastArtifact);
      if (!approval || approval.then || approval.status !== 'approved' || approval.task !== 'event-probability' || approval.artifactHash !== proposal.artifactHash || approval.calibrationReportHash !== proposal.calibrationReportHash || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now()) fail('FORECAST_APPROVAL_CHANGED', 'The forecast approval changed before execution.', 409);
      if (units(proposal.probability) - units(quote.averagePrice) < units(c.minEdge)) fail('FORECAST_EDGE_LOST', 'The executable price no longer meets the approved forecast rule.', 409);
    }
    if (proposal.underlyingPriceForecast) {
      const mapping = approvedMappings?.(c.forecastMappingId);
      if (!mappingIsCurrent(mapping, c, now()) || digest(mapping) !== proposal.mappingDigest) fail('FORECAST_APPROVAL_CHANGED', 'The approved price/contract mapping changed before execution.', 409);
    }
    if (executionFacts?.book) {
      const book = normalizedBook(executionFacts.book, quote.assetId, now());
      if (now() - book.received > c.maxDataAgeMs || !book.bids.length || !book.asks.length || book.asks[0].p - book.bids[0].p > units(c.maxSpread)) fail('EXECUTION_SPREAD_CHANGED', 'The final book no longer meets the mandate’s spread or freshness limit.', 409);
    }
    if (quote.side === 'BUY') {
      if (units(quote.averagePrice) > units(c.maxEntryPrice)) fail('ENTRY_PRICE_LIMIT', 'The quote exceeds the mandate entry-price ceiling.', 409);
      if (!state.performance || state.performance.accountRevision !== portfolio.account.revision || now() - Date.parse(state.performance.observedAt) > c.maxDataAgeMs) fail('VALUATION_STALE', 'The risk valuation changed or expired before execution.', 409);
      const debit = units(quote.debit), all = portfolio.positions.reduce((sum, p) => sum + units(p.costBasis), 0n);
      if (debit > units(c.perOrder) || debit > units(portfolio.account.cash)) fail('ORDER_LIMIT', 'The order exceeds the remaining paper cash or order limit.', 409);
      if (all + debit > units(c.maxExposure)) fail('EXPOSURE_LIMIT', 'The account exposure limit would be exceeded.', 409);
      const marketExposure = portfolio.positions.filter(p => p.marketId === quote.marketId).reduce((sum, p) => sum + units(p.costBasis), 0n);
      if (marketExposure + debit > units(c.maxMarketExposure)) fail('MARKET_EXPOSURE_LIMIT', 'The market exposure limit would be exceeded.', 409);
      const event = mandate.bindings[quote.marketId].eventId;
      const eventExposure = portfolio.positions.filter(p => (mandate.bindings[p.marketId]?.eventId ?? `market:${p.marketId}`) === event).reduce((sum, p) => sum + units(p.costBasis), 0n);
      if (eventExposure + debit > units(c.maxEventExposure)) fail('EVENT_EXPOSURE_LIMIT', 'The related-event exposure limit would be exceeded.', 409);
    }
    if (proposal.weeklyHypothesis && units(proposal.probability)-units(quote.averagePrice)<units(c.minEdge)) fail('WEEKLY_PRICE_CHANGED','The executable price no longer meets the frozen hypothesis rule.',409);
    authorityGate?.({config:c,quote,proposal,operationId:executionFacts?.operationId??null,final:Boolean(executionFacts)});
    return state;
  }
  function settleIntent(intent, result) {
    tx(() => {
      const row = get('SELECT status FROM intents WHERE id=?', intent.id);
      if (!row || row.status === 'filled') return;
      const state = read(), receipt = result.operation;
      if (!receipt || receipt.operationId !== intent.id || receipt.accountEpoch !== intent.accountEpoch) fail('RECONCILIATION_MISMATCH', 'The canonical ledger returned an unexpected operation.', 503);
      run('UPDATE intents SET status=?,json=? WHERE id=?', 'filled', JSON.stringify({ ...intent, result: receipt }), intent.id);
      if (state.mandate?.id === intent.mandateId) {
        state.totals.orders++; state.totals.turnover = decimal(units(state.totals.turnover) + units(receipt.side === 'BUY' ? receipt.debit : receipt.proceeds));
        const managed = state.managed[receipt.assetId];
        if (receipt.side === 'BUY') state.managed[receipt.assetId] = { openedAt: managed?.openedAt ?? receipt.at, quantity: decimal(units(managed?.quantity ?? '0') + units(receipt.quantity)) };
        else if (managed) { const left = units(managed.quantity) - units(receipt.quantity); if (left > 0n) managed.quantity = decimal(left); else delete state.managed[receipt.assetId]; }
      }
      if (state.pending?.id === intent.id) state.pending = null;
      state.lastDecision = { action: receipt.side === 'BUY' ? 'bought' : 'sold', reason: intent.proposal.reason, operationId: intent.id, at: receipt.at, marketId: receipt.marketId };
      save(state); log('autonomy.fill', { mandateId: intent.mandateId, proposal: intent.proposal, receipt });
    });
  }
  async function reconcile() {
    const state = read(); ownership(state);
    if (!state.pending) return;
    const intent = JSON.parse(get('SELECT json FROM intents WHERE id=?', state.pending.id)?.json ?? 'null');
    if (!intent) fail('INTENT_MISSING', 'The saved pending operation has no intent record.', 503);
    const result = await ledger.operation(intent.id);
    if (result?.operation) settleIntent(intent, result);
    else if (!result?.pending) tx(() => { const latest = read(); if (latest.pending?.id !== intent.id) return; latest.pending = null; latest.phase = 'paused'; latest.reason = 'reconciled-unrecorded-operation'; latest.generation++; save(latest); run('UPDATE intents SET status=? WHERE id=?', 'not-recorded', intent.id); log('autonomy.reconciled', { operationId: intent.id, outcome: 'not-recorded', resubmitted: false }); });
  }
  async function observe(state) {
    const result = [], cycleId = randomUUID();
    for (const id of state.mandate.config.marketIds) {
      const market = await markets.market(id, { fresh: true });
      if ((market.rulesVersion ?? digest(market.rules ?? '')) !== state.mandate.bindings[id].rulesVersion) fail('RULES_CHANGED', 'Market resolution rules changed. Review a new mandate.', 409);
      for (const outcome of market.outcomes) {
        marketBinding(market, outcome.assetId);
        const raw = await markets.book(outcome.assetId, { fresh: true }), book = normalizedBook(raw, outcome.assetId, now());
        if (!book.bids.length || !book.asks.length || now() - book.received > state.mandate.config.maxDataAgeMs) fail('DATA_UNAVAILABLE', 'A selected market has no fresh two-sided depth.', 409);
        const item = { id: book.id, cycleId, marketId: id, assetId: outcome.assetId, rulesVersion: state.mandate.bindings[id].rulesVersion, at: new Date(book.received).toISOString(), bid: decimal(book.bids[0].p), ask: decimal(book.asks[0].p), market, book: raw };
        result.push(item);
      }
    }
    const availableAt = new Date(now()).toISOString();
    for (const item of result) {
      item.availableAt = availableAt;
      if (now() - Date.parse(item.at) > state.mandate.config.maxDataAgeMs) fail('DATA_UNAVAILABLE', 'The complete decision snapshot is no longer fresh.', 409);
      run('INSERT OR IGNORE INTO observations VALUES(?,?,?)', `${cycleId}:${item.id}`, state.mandate.id, JSON.stringify(item));
    }
    return result;
  }
  async function execute(state, proposal) {
    const { quote } = await ledger.preview({ ...proposal, mode: 'DEMO' });
    guard(state.generation, quote, proposal);
    const id = `auto-${randomUUID()}`, intent = { id, mandateId: state.mandate.id, accountEpoch: state.mandate.accountEpoch, configDigest: state.mandate.configDigest, proposal, quote, at: new Date(now()).toISOString() };
    tx(() => { const latest = guard(state.generation, quote, proposal); if (latest.pending) fail('OPERATION_UNRESOLVED', 'Another operation is unresolved.', 409); run('INSERT INTO intents VALUES(?,?,?,?)', id, state.mandate.id, 'pending', JSON.stringify(intent)); latest.pending = { id, marketId: quote.marketId, side: quote.side, reservedCash: quote.debit }; save(latest); log('autonomy.intent', { intent }); });
    try {
      const result = await ledger.commitDemo({ quoteId: quote.id, expectedRevision: quote.accountRevision, operationId: id }, { beforeEffect: facts => guard(state.generation, quote, proposal, { ...facts, operationId:id }) });
      settleIntent(intent, result);
    } catch (error) {
      const actual = await ledger.operation(id);
      if (actual?.operation) { settleIntent(intent, actual); return; }
      const known = Number.isInteger(error.status) && error.status < 500 && !actual?.pending;
      tx(() => { const latest = read(); if (known && latest.pending?.id === id) latest.pending = null; latest.lastDecision = { action: 'refused', reason: error.code ?? 'UNKNOWN_OPERATION_RESULT', operationId: id, at: new Date(now()).toISOString() }; if (!known) { latest.phase = 'paused'; latest.reason = 'operation-result-unknown'; latest.generation++; } save(latest); run('UPDATE intents SET status=? WHERE id=?', known ? 'refused' : 'pending', id); log('autonomy.refused', { operationId: id, reason: error.code ?? 'UNKNOWN_OPERATION_RESULT', knownNotRecorded: known }); });
      throw error;
    }
  }
  async function runTick() {
    await reconcile(); let state = read(); ownership(state);
    if (state.phase !== 'armed' || state.pending) return status();
    if (now() >= Date.parse(state.mandate.config.expiresAt)) { setPhase('expired', 'mandate-expired'); return status(); }
    if (state.lastTickAt !== null && now() - Date.parse(state.lastTickAt) < state.mandate.config.intervalSeconds * 1000) return status();
    state.lastTickAt = new Date(now()).toISOString(); save(state);
    try {
      if (ledger.portfolio().account.epoch !== state.mandate.accountEpoch) fail('ACCOUNT_CHANGED', 'The paper account was replaced.', 409);
      if (scan) {
        reserveResearchScan(); await scan({ marketIds: state.mandate.config.marketIds, capitalMode: 'DEMO', mandateId: state.mandate.id });
      }
      const portfolio = await ledger.markedPortfolio();
      if (!portfolio.valuationComplete || portfolio.estimatedTotal === null) fail('VALUATION_UNAVAILABLE', 'Unpriced exposure prevents a new autonomous action.', 409);
      const loss = signedUnits(state.mandate.equityAtArm) - signedUnits(portfolio.estimatedTotal);
      const latest = read();
      if (latest.generation !== state.generation || latest.phase !== 'armed') return status();
      latest.performance = { baseline: 'hold cash / no new trades', baselineEquity: state.mandate.equityAtArm, equity: portfolio.estimatedTotal, change: decimal(-loss), realizedPnl: portfolio.realizedPnl, accountRevision: portfolio.account.revision, observedAt: new Date(now()).toISOString(), costsIncluded: 'spread and displayed depth; supported zero-fee markets only', maxLossIsGuaranteed: false };
      save(latest);
      if (loss >= units(state.mandate.config.maxSessionLoss)) fail('SESSION_LOSS_LIMIT', 'The session loss threshold stopped new actions. Existing positions remain.', 409);
      const observations = await observe(state);
      const signalResult = readSignals ? await readSignals() : [], signals = Array.isArray(signalResult) ? signalResult : signalResult?.signals ?? [];
      const approval = state.mandate.config.strategy === 'forecast-edge/v1' ? await approvedForecasts?.(state.mandate.config.forecastArtifact) : null;
      const mapping = state.mandate.config.strategy === 'kronos-direction/v1' ? await approvedMappings?.(state.mandate.config.forecastMappingId) : null;
      const proposal = chooseProposal({ config: state.mandate.config, observations, previous: state.previous, positions: portfolio.positions, managed: state.managed, now: now(), signals, forecastApproval: approval, forecastMapping: mapping });
      tx(() => {
        const current = read(); if (current.generation !== state.generation || current.phase !== 'armed') return;
        current.previous = Object.fromEntries(observations.map(o => [o.assetId, { id: o.id, at: o.at, bid: o.bid, ask: o.ask, rulesVersion: o.rulesVersion }]));
        if (!proposal) current.lastDecision = { action: 'abstained', reason: state.mandate.config.strategy === 'quote-momentum/v1' ? 'baseline-entry-rule-not-met' : state.mandate.config.strategy === 'kronos-direction/v1' ? 'approved-kronos-threshold-signal-unavailable' : 'approved-fresh-probability-edge-unavailable', at: new Date(now()).toISOString() };
        save(current);
        if (!proposal) log('autonomy.abstained', { mandateId: current.mandate.id, decision: current.lastDecision, observations: observations.map(o => o.id) });
      });
      if (proposal) await execute(state, proposal);
    } catch (error) {
      const latest = read();
      if (latest.phase === 'armed' && latest.generation === state.generation) {
        const terminal = ['SESSION_LOSS_LIMIT', 'ACCOUNT_CHANGED', 'RULES_CHANGED', 'SCAN_BUDGET', 'ORDER_BUDGET', 'TURNOVER_LIMIT', 'VALUATION_UNAVAILABLE', 'MANDATE_EXPIRED', 'EVIDENCE_UNAVAILABLE', 'FORECAST_APPROVAL_CHANGED'].includes(error.code);
        latest.lastDecision = { action: 'abstained', reason: error.code ?? 'DEPENDENCY_UNAVAILABLE', message: error.message, at: new Date(now()).toISOString() };
        if (terminal) { latest.phase = error.code === 'MANDATE_EXPIRED' ? 'expired' : 'paused'; latest.reason = error.code; latest.generation++; }
        save(latest); log('autonomy.abstained', { mandateId: latest.mandate.id, decision: latest.lastDecision });
      }
    }
    return status();
  }
  function tick() { ensureOpen(); if (currentTick) return currentTick; currentTick = runTick().finally(() => { currentTick = null; }); return currentTick; }
  function start() { ensureOpen(); if (!timer) { timer = setInterval(() => { void tick().catch(() => { /* Durable state is retained; caller can inspect the last event. */ }); }, 1000); timer.unref?.(); } return status(); }
  function events({ after = 0, limit = 100 } = {}) { ensureOpen(); return db.prepare('SELECT sequence,json FROM events WHERE sequence>? ORDER BY sequence LIMIT ?').all(Math.max(0, Number(after) || 0), Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({ sequence: row.sequence, ...JSON.parse(row.json) })); }
  function evaluate({ mandateId, initialCash = '1000', holdoutFraction = 0.5 } = {}) {
    ensureOpen(); const id = mandateId ?? read().mandate?.id;
    const row = get('SELECT json FROM mandates WHERE id=?', id ?? ''), mandate = row ? JSON.parse(row.json) : null;
    if (!mandate) fail('MANDATE_NOT_FOUND', 'Choose a recorded paper session to evaluate.', 404);
    const rows = db.prepare('SELECT json FROM observations WHERE mandate_id=? ORDER BY rowid LIMIT 20000').all(id ?? '').map(row => JSON.parse(row.json));
    const report = evaluateReplay({ observations: rows, config: mandate.config, initialCash, holdoutFraction });
    const value = { id: randomUUID(), mandateId: id, at: new Date(now()).toISOString(), ...report };
    run('INSERT INTO evaluations VALUES(?,?)', value.id, JSON.stringify(value)); log('autonomy.evaluation', { evaluation: value }); return value;
  }
  function close() {
    if (closed) return Promise.resolve();
    if (closing) return closing;
    closing = (async () => { if (timer) clearInterval(timer); timer = null; if (read().phase === 'armed') setPhase('paused', 'service-stopped'); if (currentTick) await currentTick; closed = true; db.close(); })();
    return closing;
  }
  return { status, arm, pause, stop, tick, start, close, events, evaluate, reconcile, reserveResearchScan };
}
