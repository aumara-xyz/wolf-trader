import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PINS, normalizeEventForecastInput, validateEventForecast } from '../providers/index.mjs';
import { createSources } from '../intelligence/sources.mjs';
import { readVenueResolution } from './resolution.mjs';

const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const clone = x => JSON.parse(JSON.stringify(x));
const errorView = e => ({ code: typeof e.code === 'string' ? e.code : 'WEEKLY_STAGE_FAILED', message: String(e.message ?? 'The research stage failed.').slice(0, 300) });
const excerpt = (text, length) => String(text ?? '').slice(0, length);
const number = v => typeof v === 'number' ? v : typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) ? Number(v) : NaN;
const viewMarket = m => ({ id: m.id, conditionId: m.conditionId ?? null, protocolVersion: m.protocolVersion, question: m.question, rules: m.rules, rulesVersion: m.rulesVersion, sourceUrl: m.sourceUrl, url: m.url, endDate: m.endDate, receivedAt: m.receivedAt, supported: m.supported === true, closed: m.closed === true, outcomes: m.outcomes?.map(o => ({ assetId: o.assetId, name: o.name, price: o.price, bid: o.bid ?? null, priceType: o.priceType ?? 'source-reference' })), fee: m.fee ?? null });
const sameContract = (a, b) => a?.id === b.id && a?.rulesVersion === b.rulesVersion && a?.conditionId === b.conditionId && a?.endDate === b.endDate && hash(a?.outcomes?.map(o => ({ assetId: o.assetId, name: o.name }))) === hash(b.outcomes.map(o => ({ assetId: o.assetId, name: o.name })));
function baseline(m) {
  const prices = m.outcomes.map(o => number(o.price));
  return prices.every(p => Number.isFinite(p) && p >= 0 && p <= 1) && prices[0] + prices[1] > 0 ? prices[0] / (prices[0] + prices[1]) : null;
}
function inputSpec(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('WEEKLY_INPUT', 'Weekly research needs an object.');
  const query = input.query ?? '', limit = input.limit ?? 3;
  if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 6) fail('WEEKLY_INPUT', 'Use a topic up to 200 characters and one to six markets.');
  if (input.marketIds !== undefined && (!Array.isArray(input.marketIds) || !input.marketIds.length || input.marketIds.length > 6 || input.marketIds.some(id => typeof id !== 'string' || !/^\d{1,100}$/.test(id)) || new Set(input.marketIds).size !== input.marketIds.length)) fail('WEEKLY_INPUT', 'Use one to six distinct canonical market IDs.');
  if (input.useJev !== undefined && typeof input.useJev !== 'boolean') fail('WEEKLY_INPUT', 'Jev selection must be explicit.');
  return { query: query.trim(), limit, ...(input.marketIds ? { marketIds: input.marketIds } : {}), useJev: input.useJev === true };
}

/** A frozen prospective research book; models can propose, never grant execution authority. */
export function createWeeklyDesk({ dataDir, markets, intelligence, aukora, providers, ledger, now = Date.now, fetchImpl = fetch, researchPolicy }) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'weekly.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS resolutions(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,json TEXT NOT NULL);');
  const put = (table, id, value) => db.prepare(`INSERT OR REPLACE INTO ${table}(id,json) VALUES(?,?)`).run(id, JSON.stringify(value));
  const get = (table, id) => { const row = db.prepare(`SELECT json FROM ${table} WHERE id=?`).get(id); return row ? JSON.parse(row.json) : null; };
  let active = null, closed = false, closing, lastFingerprint, trustedMap = new Map(), retainedHead, withdrawalCursor = 0;
  const withdrawalIndex = new Map();
  const identity = aukora.status().identity.pubkey;
  const publicSources = createSources({ fetchImpl, now });
  for (const row of db.prepare('SELECT id,json FROM jobs').all()) { const job = JSON.parse(row.json); if (['running', 'cancelling'].includes(job.phase)) { job.phase = 'interrupted'; job.stage = 'Application restarted before the book was completed'; put('jobs', row.id, job); } }
  function record(kind, payload, parents = []) {
    const bytes = Buffer.from(JSON.stringify(payload));
    if (bytes.length > 900000) fail('WEEKLY_EVIDENCE_BOUND', 'The weekly artifact exceeded its evidence bound.');
    const ancestors = [...new Set(parents.filter(Boolean))].slice(0, 16);
    if (bytes.length <= 27000) return aukora.record(kind, payload, ancestors).id;
    const parts = [], sha256 = hash(bytes.toString());
    for (let offset = 0; offset < bytes.length; offset += 14000) { const id = aukora.record('weekly.payload-part', { schema: 'wolf-weekly-part/v1', sha256, offset, data: bytes.subarray(offset, offset + 14000).toString('base64') }, parts.length ? [parts.at(-1)] : ancestors).id; parts.push(id); }
    return aukora.record(kind, { schema: 'wolf-weekly-parts/v1', sha256, byteLength: bytes.length, parts }, [parts.at(-1)]).id;
  }
  function records() {
    const bundle = aukora.exportEvidence(), fingerprint = hash({ pubkey: bundle.pubkey, events: bundle.events, checkpoint: bundle.checkpoint });
    if (fingerprint !== lastFingerprint) {
      const check = aukora.verifyEvidence(bundle, { expectedPubkey: identity, expectedHead: retainedHead });
      if (!check.ok) fail('WEEKLY_INTEGRITY', 'Signed weekly history did not verify.', 503);
      trustedMap = new Map(bundle.events.map(event => [event.id, JSON.parse(event.content)]));
      retainedHead = check.head; lastFingerprint = fingerprint;
    }
    return trustedMap;
  }
  function payload(id, expectedKind, all) {
    const lookup = key => all ? all.get(key) : typeof aukora.getRecord === 'function' ? aukora.getRecord(key) : records().get(key);
    const record = lookup(id); if (!record || record.kind !== expectedKind) fail('WEEKLY_INTEGRITY', 'A required signed weekly record is missing.', 503);
    const p = record.payload; if (p?.schema !== 'wolf-weekly-parts/v1') return p;
    if (!Array.isArray(p.parts) || p.parts.length > 70 || !Number.isInteger(p.byteLength) || p.byteLength > 900000) fail('WEEKLY_INTEGRITY', 'Invalid weekly attachment.', 503);
    let offset = 0; const parts = p.parts.map(partId => { const part = lookup(partId); if (part?.kind !== 'weekly.payload-part' || part.payload.sha256 !== p.sha256 || part.payload.offset !== offset) fail('WEEKLY_INTEGRITY', 'A signed weekly attachment changed.', 503); const b = Buffer.from(part.payload.data, 'base64'); offset += b.length; return b; });
    const bytes = Buffer.concat(parts); if (offset !== p.byteLength || hash(bytes.toString()) !== p.sha256) fail('WEEKLY_INTEGRITY', 'A signed weekly attachment is incomplete.', 503); return JSON.parse(bytes.toString());
  }
  function verifiedBook(id) {
    const row = get('books', id); if (!row) return null;
    const { evidenceId, ...value } = row;
    if (hash(payload(evidenceId, 'weekly.book-completed')) !== hash(value)) fail('WEEKLY_INTEGRITY', 'The weekly book index differs from signed history.', 503);
    return row;
  }
  function latest() { const row = db.prepare('SELECT id FROM books ORDER BY rowid DESC LIMIT 1').get(); return row ? verifiedBook(row.id) : null; }
  function books() { return { items: db.prepare('SELECT id FROM books ORDER BY rowid DESC LIMIT 30').all().map(row => { const b = verifiedBook(row.id); return { id: b.id, query: b.query, cutoffAt: b.cutoffAt, completedAt: b.completedAt, expiresAt: b.expiresAt, candidates: b.candidates.length, picks: b.candidates.filter(c => c.bucket === 'pick').length, evidenceId: b.evidenceId }; }) }; }
  function jobView() { return active?.job ?? JSON.parse(db.prepare('SELECT json FROM jobs ORDER BY rowid DESC LIMIT 1').get()?.json ?? 'null'); }
  function status() { return { schema: 'wolf-weekly-status/v1', job: jobView(), latestBook: latest(), booksCount: db.prepare('SELECT count(*) AS n FROM books').get().n, schedule: scheduleStatus(), forecasting: { model: PINS.dexter.model, calibration: 'uncalibrated', authority: 'none' }, liveOrderSubmission: false }; }
  function updateJob(stage, extra = {}) { if (!active) return; Object.assign(active.job, extra, { stage }); put('jobs', active.job.id, active.job); }
  function sourceRecords(scan, m) {
    const observations = intelligence.observations?.({ limit: 100 }) ?? [];
    const leads = scan.findings?.find(f => f.marketId === m.id)?.leads ?? [];
    return [{ id: `market:${m.id}`, url: m.sourceUrl, title: m.question, text: excerpt(m.rules, 1000), observedAt: m.receivedAt, contentHash: hash(m.rules), sourceFamily: 'polymarket.com', role: 'contract-rules', excerpted: m.rules.length > 1000 }, ...leads.slice(0, 3).map(lead => observations.find(o => o.versionId === lead.versionId)).filter(Boolean).map(o => ({ id: o.id, url: o.sourceUrl, title: o.title, text: excerpt(o.text || o.title, 1800), observedAt: o.receivedAt, publishedAt: o.publishedAt ?? null, contentHash: o.contentHash, versionId: o.versionId, sourceFamily: o.sourceFamily, role: 'external-observation', excerpted: (o.text?.length ?? 0) > 1800 }))];
  }
  async function waitForResearch(signal) {
    for (let i = 0; i < 480; i++) { signal.throwIfAborted(); const state = await intelligence.status(); if (!['running', 'cancelling'].includes(state.job?.phase)) return; await new Promise(resolve => setTimeout(resolve, 500)); }
    fail('WEEKLY_RESEARCH_BUSY', 'Another research job did not release the specialist pipeline.', 409);
  }
  async function run(input, job, controller) {
    const signal = controller.signal, startedAt = job.startedAt, id = job.id;
    const timer = setTimeout(() => controller.abort(), 30 * 60000); timer.unref();
    try {
      const discovered = input.marketIds ? await Promise.all(input.marketIds.map(marketId => markets.market(marketId, { fresh: true, signal }))) : (await markets.searchMarkets({ query: input.query || 'this week', limit: input.limit, signal })).markets;
      signal.throwIfAborted();
      if (!Array.isArray(discovered) || !discovered.length) fail('WEEKLY_NO_MARKETS', 'No public markets matched this research scope.');
      const universe = [...new Map(discovered.slice(0, input.marketIds ? 6 : input.limit).map(m => [m.id, viewMarket(m)])).values()];
      for (const m of universe) if (!/^\d{1,100}$/.test(m.id) || !m.rules || !m.rulesVersion || !Array.isArray(m.outcomes) || m.outcomes.length !== 2 || m.outcomes.some(o => !/^\d{1,100}$/.test(o.assetId)) || !Number.isFinite(Date.parse(m.endDate))) fail('WEEKLY_MARKET_SCHEMA', 'A selected market lacks exact binary contract identity or rules.');
      const cutoffAt = new Date(now()).toISOString(), expiresAt = new Date(now() + 7 * 86400000).toISOString();
      const initial = ledger?.markedPortfolio ? await ledger.markedPortfolio() : null;
      const accountBaseline = initial ? { cash: initial.account?.cash ?? null, equity: initial.estimatedTotal ?? null, accountEpoch: initial.account?.epoch ?? null, positions: initial.positions?.length ?? null, observedAt: cutoffAt } : null;
      const frozen = { schema: 'wolf-weekly-universe/v1', id, query: input.query, startedAt, cutoffAt, expiresAt, universe, versions: { eventForecast: PINS['event-forecast'], dexter: PINS.dexter.revision, kronos: PINS.kronos.model.revision }, rankingPolicy: 'Absolute subjective disagreement with normalized market reference prices, plus source coverage; not a measured trading edge.', selectionPolicy: input.marketIds ? 'Owner-selected exact market IDs' : 'First bounded canonical discovery matches; not an exhaustive market screen', accountBaseline };
      const universeEvidenceId = record('weekly.universe-frozen', frozen);
      updateJob('Universe frozen before model research', { universeEvidenceId, totalCandidates: universe.length, completedCandidates: 0 });
      const candidates = [];
      for (const [index, m] of universe.entries()) {
        signal.throwIfAborted();
        updateJob(`Investigating ${index + 1} of ${universe.length}: ${m.question}`, { currentMarketId: m.id });
        const candidateId = hash({ bookId: id, marketId: m.id, rulesVersion: m.rulesVersion, assets: m.outcomes.map(o => o.assetId) });
        let candidate = { candidateId, bookId: id, marketId: m.id, question: m.question, market: m, rulesVersion: m.rulesVersion, bucket: 'pass', forecast: null, marketProbability: baseline(m), sources: [], thesis: '', countercase: '', invalidation: '', sourceBindings: [], modelMarketDifference: null, rankingScore: null, issuedAt: null };
        const parents = [universeEvidenceId];
        try {
          if (m.closed || Date.parse(m.endDate) <= now()) fail('WEEKLY_MARKET_CLOSED', 'This contract closed before prospective research.');
          await waitForResearch(signal);
          const scan = await intelligence.scan({ marketId: m.id, useProviders: true, useDexter: true, useJev: input.useJev, includeGovernment: true, signal });
          signal.throwIfAborted();
          const observed = scan.markets?.find(item => item.id === m.id);
          if (!sameContract(observed, m) || observed.closed || Date.parse(observed.endDate) <= now()) fail('WEEKLY_RULES_CHANGED', 'The source rules or contract status changed during research.');
          if (scan.evidenceId) parents.push(scan.evidenceId);
          const sources = sourceRecords(scan, m);
          const symbol = /\b(bitcoin|btc)\b/i.test(m.question) ? 'BTC-USD' : /\b(ethereum|ether|eth)\b/i.test(m.question) ? 'ETH-USD' : null;
          if (symbol) {
            try { const bars = await publicSources.candles(symbol, { signal }); sources.push({ id: `coinbase:${symbol}`, url: bars.sourceUrl, title: `${symbol} completed Coinbase hourly candles`, text: JSON.stringify({ symbol, venue: 'Coinbase; not necessarily the contract resolution venue', intervalSeconds: 3600, candles: bars.candles.slice(-8) }), observedAt: bars.observedAt, contentHash: bars.contentHash, sourceFamily: 'coinbase.com', role: 'underlying-observation', excerpted: true }); }
            catch (e) { if (signal.aborted) throw e; candidate.sourceWarning = errorView(e); }
          }
          const research = scan.specialists?.dexter?.answer ?? 'Dexter did not complete; evidence may be insufficient.';
          const informationCutoff = new Date(now()).toISOString();
          const request = { market: m, assetId: m.outcomes[0].assetId, sources, research, informationCutoff };
          if (sources.some(source => !Number.isFinite(Date.parse(source.observedAt)) || Date.parse(source.observedAt) > Date.parse(informationCutoff) || (source.publishedAt && (!Number.isFinite(Date.parse(source.publishedAt)) || Date.parse(source.publishedAt) > Date.parse(informationCutoff))))) fail('WEEKLY_SOURCE_TIME', 'A source snapshot has an invalid or future timestamp.');
          const normalized = normalizeEventForecastInput(request);
          const inputsId = record('weekly.forecast-input', { candidateId, ...normalized }, parents); parents.push(inputsId);
          updateJob(`Estimating ${index + 1} of ${universe.length}: ${m.question}`);
          const raw = await providers.forecastEvent({ ...request, signal });
          signal.throwIfAborted();
          const forecast = { ...raw, ...validateEventForecast(raw, normalized) };
          const finalMarket = await markets.market(m.id, { fresh: true, signal });
          signal.throwIfAborted();
          if (finalMarket.closed || !sameContract(finalMarket, m) || Date.parse(finalMarket.endDate) <= now()) fail('WEEKLY_FORECAST_LATE', 'The contract closed or its rules changed before forecast commitment.');
          if (forecast.modelDigest !== PINS.dexter.modelDigest || forecast.promptVersion !== 'wolf-event-forecast/v1') fail('WEEKLY_MODEL_CHANGED', 'The forecast did not use the committed model and template.');
          if (Date.parse(m.endDate) <= now()) fail('WEEKLY_FORECAST_LATE', 'The contract expired before this forecast could be committed.');
          const p = forecast.probability, ref = candidate.marketProbability, delta = ref === null ? null : p - ref;
          const side = delta === null ? (p >= .5 ? 0 : 1) : delta >= 0 ? 0 : 1;
          const external = sources.filter(s => s.role !== 'contract-rules');
          const strongResearch = !forecast.abstain && typeof scan.specialists?.dexter?.answer === 'string';
          const bucket = forecast.abstain ? 'pass' : strongResearch && external.length && delta !== null && Math.abs(delta) >= .05 ? 'pick' : 'watchlist';
          let shadowPolicy = { available: false, mode: 'SHADOW', reason: 'No research policy is configured.', authorizesTrade: false };
          if (researchPolicy) {
            if (typeof forecast.confidence === 'number' && typeof forecast.ruleClarity === 'number' && sources.every(s => Number.isFinite(Date.parse(s.observedAt)))) {
              const metrics = { evidenceCount: sources.length, independentSources: new Set(external.map(s => s.sourceFamily)).size, ruleClarity: forecast.ruleClarity, confidence: forecast.confidence, sourceAgeHours: Math.max(0, ...sources.map(s => (now() - Date.parse(s.observedAt)) / 3600000)) };
              try { shadowPolicy = { available: true, ...researchPolicy.shadowEvaluate(metrics), metrics, measurement: 'Source counts and receipt age are observed. Clarity and confidence are explicit model self-assessments, not calibration.', authorizesTrade: false }; } catch (e) { shadowPolicy = { available: false, mode: 'SHADOW', reason: errorView(e).message, authorizesTrade: false }; }
            } else shadowPolicy = { available: false, mode: 'SHADOW', reason: 'Required clarity/confidence self-assessments or source timestamps are missing; no metrics were invented.', authorizesTrade: false };
          }
          candidate = { ...candidate, shadowPolicy, bucket, forecast, chosenOutcome: m.outcomes[side], chosenProbability: side ? 1 - p : p, chosenMarketProbability: ref === null ? null : side ? 1 - ref : ref, modelMarketDifference: delta, rankingScore: forecast.abstain ? null : Math.round((Math.abs(delta ?? 0) * 100 + Math.min(new Set(external.map(s => s.sourceFamily)).size, 3) * 5) * 100) / 100, thesis: forecast.rationale, countercase: forecast.countercase, invalidation: forecast.invalidation, sources: sources.map(({ text, ...source }) => source), sourceBindings: external.filter(s => s.versionId).map(s => ({ id: s.id, versionId: s.versionId, contentHash: s.contentHash })), informationCutoff, issuedAt: new Date(now()).toISOString(), researchEvidenceId: scan.evidenceId ?? null, forecastInputEvidenceId: inputsId, experimentalPaperEligible: !forecast.abstain && m.supported, forecastStatus: 'Uncalibrated model opinion; not proven edge', authorizesOrder: false };
        } catch (e) { if (signal.aborted) throw e; candidate = { ...candidate, bucket: 'pass', error: errorView(e), thesis: errorView(e).message, countercase: 'No usable prospective forecast was completed.', invalidation: 'A new source-backed research book is required.', experimentalPaperEligible: false, issuedAt: new Date(now()).toISOString() }; }
        signal.throwIfAborted();
        candidate.evidenceId = record('weekly.candidate', candidate, parents);
        candidates.push(candidate); updateJob(`Recorded ${index + 1} of ${universe.length}`, { completedCandidates: index + 1 });
      }
      signal.throwIfAborted();
      const book = { schema: 'wolf-weekly-book/v1', id, phase: 'complete', query: input.query, startedAt, cutoffAt, completedAt: new Date(now()).toISOString(), expiresAt, universeEvidenceId, universeHash: hash(universe), versions: frozen.versions, rankingPolicy: frozen.rankingPolicy, selectionPolicy: frozen.selectionPolicy, informationWindow: { opensAt: cutoffAt, closesAt: new Date(now()).toISOString(), note: 'Universe and rules were frozen first; each candidate records the later cutoff of the source snapshots it actually received.' }, candidates: candidates.sort((a, b) => (b.rankingScore ?? -1) - (a.rankingScore ?? -1)), accountBaseline, calibration: 'uncalibrated', authorizesOrder: false, declaration: 'All bounded-universe candidates, including passes and failures, remain in this book. Numerical estimates are subjective local-model opinions.' };
      book.evidenceId = record('weekly.book-completed', book, [universeEvidenceId, ...candidates.map(c => c.evidenceId)]);
      put('books', id, book); updateJob('Weekly research book committed', { phase: 'complete', completedAt: book.completedAt, evidenceId: book.evidenceId });
      return book;
    } catch (e) { const phase = signal.aborted ? 'cancelled' : 'failed'; updateJob(phase === 'cancelled' ? 'Weekly research stopped; no completed book published' : errorView(e).message, { phase, error: errorView(e) }); try { record('weekly.job-ended', { id, phase, error: errorView(e), at: new Date(now()).toISOString() }); } catch {} throw e; }
    finally { clearTimeout(timer); if (active?.job.id === id) active = null; }
  }
  function launch(input = {}) {
    if (closed) fail('WEEKLY_CLOSED', 'The weekly desk is closed.', 503); if (active) fail('WEEKLY_BUSY', 'A weekly research book is already running.', 409);
    const spec = inputSpec(input), controller = new AbortController(), job = { id: randomUUID(), phase: 'running', stage: 'Discovering canonical market contracts', startedAt: new Date(now()).toISOString(), completedCandidates: 0, totalCandidates: 0 };
    put('jobs', job.id, job); active = { job, controller, promise: null }; const promise = run(spec, job, controller); active && (active.promise = promise); promise.catch(() => {}); return clone(job);
  }
  function cancel() { if (active) { active.controller.abort(); updateJob('Stopping weekly research', { phase: 'cancelling' }); } return { cancelled: Boolean(active), completedBookUnchanged: true }; }
  function readSignals() {
    const book = latest(); if (!book || Date.parse(book.expiresAt) <= now()) return [];
    const withdrawn = withdrawals(book.id);
    const current = new Map((intelligence.observations?.({ limit: 100 }) ?? []).map(o => [o.id, o]));
    return book.candidates.filter(c => c.forecast && c.experimentalPaperEligible && Date.parse(c.market.endDate) > now()).map(c => {
      const revised = withdrawn.some(w => !w.candidateId || w.candidateId === c.candidateId) || c.sourceBindings.some(binding => { const source = current.get(binding.id); return !source || source.versionId !== binding.versionId || source.contentHash !== binding.contentHash; });
      return { id: hash({ bookId: book.id, candidateId: c.candidateId, evidenceId: c.evidenceId }), kind: 'weekly-event-hypothesis', bookId: book.id, candidateId: c.candidateId, marketId: c.marketId, assetId: c.chosenOutcome.assetId, rulesVersion: c.rulesVersion, probability: c.chosenProbability.toFixed(6), observedAt: c.issuedAt, expiresAt: new Date(Math.min(Date.parse(book.expiresAt), Date.parse(c.market.endDate))).toISOString(), evidenceId: c.evidenceId, bookEvidenceId: book.evidenceId, invalidated: revised, invalidationReason: revised ? 'This hypothesis was withdrawn, or a source snapshot changed or cannot be checked.' : null, calibrated: false, authorizesOrder: false, bucket: c.bucket, modelDigest: c.forecast.modelDigest };
    });
  }
  function withdrawals(bookId) {
    if (typeof aukora.readRecords === 'function') {
      for (;;) { const page = aukora.readRecords({ after: withdrawalCursor, limit: 1024 }); for (const row of page) { withdrawalCursor = row.sequence; if (row.kind === 'weekly.withdrawal') withdrawalIndex.set(row.id, row.payload); } if (page.length < 1024) break; }
      return [...withdrawalIndex.keys()].map(id => aukora.getRecord(id).payload).filter(value => value.bookId === bookId);
    }
    return [...records().values()].filter(record => record.kind === 'weekly.withdrawal' && record.payload?.bookId === bookId).map(record => record.payload);
  }
  function invalidate(input = {}) {
    const book = chooseBook(input);
    if (input.candidateId && !book.candidates.some(c => c.candidateId === input.candidateId)) fail('WEEKLY_CANDIDATE_MISSING', 'Select a candidate in this book.', 404);
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : 'Owner withdrew this research hypothesis.';
    if (!reason) fail('WEEKLY_INVALIDATION', 'Supply a withdrawal reason.');
    const value = { bookId: book.id, candidateId: input.candidateId ?? null, reason, withdrawnAt: new Date(now()).toISOString(), changesOriginalForecast: false };
    return { ...value, evidenceId: record('weekly.withdrawal', value, [book.evidenceId]) };
  }
  function chooseBook(input = {}) { const b = input.bookId ? verifiedBook(input.bookId) : latest(); if (!b) fail('WEEKLY_BOOK_MISSING', 'Complete a research book first.', 404); return b; }
  async function resolve(input = {}) {
    const book = chooseBook(input), candidate = book.candidates.find(c => c.candidateId === input.candidateId || c.marketId === input.marketId);
    if (!candidate) fail('WEEKLY_CANDIDATE_MISSING', 'Select a candidate in the frozen book.', 404);
    if (input.outcome !== undefined) {
      if (![0, 1].includes(input.outcome)) fail('WEEKLY_OUTCOME', 'A supplied outcome must be zero or one.');
      const value = { id: randomUUID(), bookId: book.id, candidateId: candidate.candidateId, outcome: input.outcome, sourceUrl: excerpt(input.sourceUrl, 1800), observedAt: new Date(now()).toISOString(), authority: 'user-supplied', countsTowardScore: false };
      value.evidenceId = record('weekly.supplied-outcome', value, [candidate.evidenceId]); return value;
    }
    const current = await markets.market(candidate.marketId, { fresh: true });
    if (current.rulesVersion !== candidate.rulesVersion || current.conditionId !== candidate.market.conditionId || hash(current.outcomes.map(o => ({ assetId: o.assetId, name: o.name }))) !== hash(candidate.market.outcomes.map(o => ({ assetId: o.assetId, name: o.name })))) return { status: 'contract-changed', final: false, authority: 'none', candidateId: candidate.candidateId };
    const resolution = await readVenueResolution({ market: current, fetchImpl, now });
    if (!resolution.final) return { ...resolution, candidateId: candidate.candidateId };
    if (Date.parse(resolution.observedAt) <= Date.parse(candidate.issuedAt)) return { status: 'awaiting-later-resolution-observation', final: false, authority: 'none', candidateId: candidate.candidateId };
    const id = hash({ bookId: book.id, candidateId: candidate.candidateId }), prior = get('resolutions', id);
    if (prior) { const { evidenceId, ...value } = prior; if (hash(payload(evidenceId, 'weekly.venue-outcome')) !== hash(value)) fail('WEEKLY_INTEGRITY', 'The outcome cache differs from signed history.', 503); if (hash(prior.resolution.outcomes) !== hash(resolution.outcomes)) fail('WEEKLY_RESOLUTION_CHANGED', 'The venue result changed after it was scored; preserve both records for review.', 409); return prior; }
    const value = { id, bookId: book.id, candidateId: candidate.candidateId, outcome: resolution.outcomes[0].payout, resolution, authority: 'venue-reported', countsTowardScore: true, observedAt: resolution.observedAt };
    value.evidenceId = record('weekly.venue-outcome', value, [candidate.evidenceId]); put('resolutions', id, value); return value;
  }
  async function score(input = {}) {
    const book = chooseBook(input), outcomes = [], pending = [];
    for (const candidate of book.candidates) { try { const value = await resolve({ bookId: book.id, candidateId: candidate.candidateId }); if (value.countsTowardScore) outcomes.push(value); else pending.push({ candidateId: candidate.candidateId, status: value.status }); } catch (e) { pending.push({ candidateId: candidate.candidateId, status: 'unavailable', ...errorView(e) }); } }
    const cases = outcomes.map(o => ({ outcome: o.outcome, resolutionEvidenceId: o.evidenceId, candidate: book.candidates.find(c => c.candidateId === o.candidateId) })).filter(x => x.candidate.forecast);
    const comparable = cases.filter(x => x.candidate.marketProbability !== null);
    const mean = (rows, fn) => rows.length ? rows.reduce((sum, row) => sum + fn(row), 0) / rows.length : null;
    const current = ledger?.markedPortfolio ? await ledger.markedPortfolio() : null;
    const sameAccount = Boolean(book.accountBaseline?.accountEpoch && current?.account?.epoch === book.accountBaseline.accountEpoch);
    const priorEquity = number(book.accountBaseline?.equity), currentEquity = number(current?.estimatedTotal);
    const paperPerformance = { scope: 'Whole paper account since book creation; unrelated actions may be included.', attributedToBook: false, accountUnchanged: sameAccount, startingEquity: book.accountBaseline?.equity ?? null, currentEquity: current?.estimatedTotal ?? null, change: sameAccount && Number.isFinite(priorEquity) && Number.isFinite(currentEquity) ? (currentEquity - priorEquity).toFixed(6) : null, noTradeCashBaseline: book.accountBaseline?.positions === 0 ? book.accountBaseline.cash : null, hypotheticalFills: false };
    const report = { schema: 'wolf-weekly-score/v1', id: randomUUID(), bookId: book.id, observedAt: new Date(now()).toISOString(), universeSize: book.candidates.length, forecastCount: book.candidates.filter(c => c.forecast).length, abstentions: book.candidates.filter(c => c.bucket === 'pass').length, resolvedCount: outcomes.length, scoredForecasts: cases.length, comparableForecasts: comparable.length, pending, brier: mean(cases, x => (x.candidate.forecast.probability - x.outcome) ** 2), comparableBrier: mean(comparable, x => (x.candidate.forecast.probability - x.outcome) ** 2), marketBaselineBrier: mean(comparable, x => (x.candidate.marketProbability - x.outcome) ** 2), source: 'Official venue-reported binary resolutions, not manual outcome labels or terminal quotes', allBucketsIncluded: true, calibration: 'Not established by a small book or a single score', cases: cases.map(x => ({ candidateId: x.candidate.candidateId, bucket: x.candidate.bucket, abstained: x.candidate.forecast.abstain, probability: x.candidate.forecast.probability, marketProbability: x.candidate.marketProbability, outcome: x.outcome, resolutionEvidenceId: x.resolutionEvidenceId })), paperPerformance };
    report.evidenceId = record('weekly.scorecard', report, [book.evidenceId, ...outcomes.map(o => o.evidenceId)]); put('reports', report.id, report); return report;
  }
  function commitment(input = {}) { const book = chooseBook(input); return { schema: 'wolf-weekly-commitment/v1', bookId: book.id, universeHash: book.universeHash, cutoffAt: book.cutoffAt, completedAt: book.completedAt, candidates: book.candidates.map(c => ({ candidateId: c.candidateId, evidenceId: c.evidenceId })), evidenceId: book.evidenceId, issuer: identity, head: aukora.status().head, signedBookReceipt: aukora.exportNostrEvent(book.evidenceId), signedCheckpoint: aukora.exportManifest().checkpoint, notice: 'Retain this independently to detect a later replacement or rollback. Local signatures do not establish an independent timestamp.' }; }
  function exportBundle(input = {}) { const book = chooseBook(input); return { schema: 'wolf-weekly-export/v1', book, commitment: commitment({ bookId: book.id }), evidence: aukora.exportEvidence(), sharing: 'Contains the local evidence history, including research and paper account facts. Share deliberately; no private identity key is included.' }; }
  function challenge(input = {}) {
    const original = aukora.exportEvidence(), copy = clone(original), before = aukora.verifyEvidence(original, { expectedPubkey: identity });
    if (!before.ok || !copy.events.length) fail('WEEKLY_CHALLENGE', 'A verified nonempty evidence history is required.');
    const kind = input.kind ?? 'tamper';
    if (kind === 'tamper') { const body = JSON.parse(copy.events.at(-1).content); body.payload = { replaced: true }; copy.events.at(-1).content = JSON.stringify(body); }
    else if (kind === 'truncate') copy.events.pop();
    else if (kind !== 'wrong-author') fail('WEEKLY_CHALLENGE', 'Choose tamper, truncate or wrong-author.');
    const check = aukora.verifyEvidence(copy, { expectedPubkey: kind === 'wrong-author' ? '0'.repeat(64) : identity, expectedHead: before.head });
    const result = { kind, mode: 'disposable-copy', originalVerified: before.ok, alteredAccepted: check.ok, rejected: !check.ok, verification: check, originalUnchanged: hash(aukora.exportEvidence().events) === hash(original.events) };
    result.evidenceId = record('weekly.challenge', result); return result;
  }
  function scheduleStatus() { const row = get('settings', 'schedule'); if (!row) return { enabled: false, nextRunAt: null }; const { evidenceId, ...value } = row; if (hash(payload(evidenceId, 'weekly.schedule-state')) !== hash(value)) fail('WEEKLY_INTEGRITY', 'The research schedule differs from its signed grant binding.', 503); return row; }
  function configureSchedule(input = {}, binding = {}) {
    if (typeof input.enabled !== 'boolean' || (input.intervalDays !== undefined && input.intervalDays !== 7)) fail('WEEKLY_SCHEDULE', 'Choose an enabled flag and a seven-day schedule.');
    if (!input.enabled) { const { evidenceId: previousEvidenceId, ...previous } = scheduleStatus(); const value = { ...previous, event: 'disabled', enabled: false, stoppedAt: new Date(now()).toISOString() }; value.evidenceId = record('weekly.schedule-state', value); put('settings', 'schedule', value); return value; }
    const spec = inputSpec(input); if (spec.useJev) fail('WEEKLY_SCHEDULE', 'Scheduled research uses local providers only.');
    if (typeof binding.grantId !== 'string' || !binding.grantId || typeof binding.resource !== 'string' || !binding.resource) fail('WEEKLY_SCHEDULE_GRANT', 'A signed research grant must be bound to the schedule.');
    const value = { schema: 'wolf-weekly-schedule/v1', event: 'enabled', enabled: true, config: spec, intervalDays: 7, grantId: binding.grantId, resource: binding.resource, createdAt: new Date(now()).toISOString(), nextRunAt: new Date(now()).toISOString(), lastAttemptAt: null };
    value.evidenceId = record('weekly.schedule-state', value); put('settings', 'schedule', value); return value;
  }
  function runScheduled(authorize) {
    const schedule = scheduleStatus(); if (!schedule.enabled || active || closed || Date.parse(schedule.nextRunAt) > now()) return { launched: false, reason: active ? 'busy' : 'not-due' };
    if (typeof authorize !== 'function') fail('WEEKLY_SCHEDULE_GRANT', 'The host must check the current research grant before a scheduled launch.');
    const permission = authorize({ grantId: schedule.grantId, resource: schedule.resource, action: 'research.scan', config: schedule.config });
    if (permission?.then || (permission !== true && permission?.allowed !== true)) fail('WEEKLY_SCHEDULE_GRANT', 'The scheduled research grant was refused.', 403);
    const { evidenceId: previousEvidenceId, ...previous } = schedule;
    const attempted = { ...previous, event: 'attempt', lastAttemptAt: new Date(now()).toISOString(), nextRunAt: new Date(now() + 7 * 86400000).toISOString() };
    attempted.evidenceId = record('weekly.schedule-state', attempted, [previousEvidenceId]); put('settings', 'schedule', attempted);
    return { launched: true, job: launch(schedule.config), nextRunAt: attempted.nextRunAt };
  }
  function close() { if (closing) return closing; closed = true; cancel(); return closing = (async () => { if (active?.promise) await active.promise.catch(() => {}); db.close(); })(); }
  return { status, launch, cancel, latest, books, score, resolve, commitment, exportBundle, challenge, readSignals, invalidate, configureSchedule, scheduleStatus, runScheduled, close };
}
