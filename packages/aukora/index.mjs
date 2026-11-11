import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, lstatSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadKiraCore } from '../aukora-vendor/x1/src/kira-core.mjs';
import { loadNostrCore } from '../aukora-vendor/x1/src/aukora-nostr.mjs';
import { loadAuraRelayCell } from '../aukora-vendor/x1/src/aukora-aura-relay.mjs';

const SCHEMA = 'wolf-evidence/v1';
const KIND = 9451;
const MAX_RECORDS = 4096;
const MAX_PAYLOAD = 32768;
const MAX_EXPORT = 32 * 1024 * 1024;
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const recordLike = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message) { const error = new Error(message); error.code = code; error.status = 400; throw error; }
function bounded(value, max = MAX_PAYLOAD) {
  let text;
  try { text = JSON.stringify(value); } catch { fail('INVALID_EVIDENCE', 'Evidence must be serializable JSON.'); }
  if (!text || Buffer.byteLength(text) > max) fail('EVIDENCE_BOUND', 'Evidence exceeds its byte limit.');
  const copy = JSON.parse(text);
  const visit = (v, depth) => {
    if (depth > 24) fail('EVIDENCE_DEPTH', 'Evidence is nested too deeply.');
    if (!recordLike(v) && !Array.isArray(v)) return;
    for (const [key, item] of Object.entries(v)) {
      if (/^(?:authorization|api[_-]?key|secret(?:key)?|private[_-]?key|seed[_-]?phrase|password|mnemonic|access[_-]?token|refresh[_-]?token)$/i.test(key)) fail('PRIVATE_FIELD', 'Credentials do not belong in evidence.');
      visit(item, depth + 1);
    }
  };
  visit(copy, 0); return copy;
}
function shortText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || !value.isWellFormed()) fail('INVALID_INPUT', `${label} is missing or too long.`);
  return value.trim();
}
function hex(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function sourceList(value) {
  if (!Array.isArray(value) || value.length > 16) fail('INVALID_SOURCES', 'Supply up to 16 source references.');
  return value.map(item => { if (typeof item === 'string') return { id: shortText(item, 256, 'Source') }; if (!recordLike(item)) fail('INVALID_SOURCE', 'A source must be a reference object or string.'); return bounded(item, 2048); });
}
function sourceId(source) {
  const value = source.id ?? source.url ?? source.marketId;
  return typeof value === 'string' && value.length <= 256 ? value : hash(source);
}
function loadCells() {
  const kira = loadKiraCore(), nostr = loadNostrCore(), aura = loadAuraRelayCell();
  if (!kira.ping() || !nostr.ping() || !aura.ping()) fail('CELL_HEALTH', 'An admitted intelligence cell failed its startup check.');
  return { kira, nostr, aura };
}

/** Cold verification authenticates bytes and ordering, not the truth or profitability of a claim. */
export function verifyEvidence(bundle, { expectedPubkey, expectedHead } = {}) {
  const errors = [];
  try {
    if (!recordLike(bundle) || bundle.schema !== 'wolf-evidence-bundle/v1' || !Array.isArray(bundle.events) || bundle.events.length > MAX_RECORDS || !hex(bundle.pubkey) || !recordLike(bundle.checkpoint)) fail('BUNDLE_SCHEMA', 'Invalid evidence bundle.');
    if (Buffer.byteLength(JSON.stringify(bundle)) > MAX_EXPORT) fail('BUNDLE_BOUND', 'Evidence bundle exceeds its size limit.');
    if (expectedPubkey && bundle.pubkey !== expectedPubkey) fail('ISSUER_MISMATCH', 'The bundle is signed by a different identity.');
    const { nostr, aura } = loadCells();
    const seen = new Set(); let previous = null;
    for (let index = 0; index < bundle.events.length; index++) {
      const event = bundle.events[index];
      if (!nostr.verifyEvent(event).valid || event.pubkey !== bundle.pubkey || event.kind !== KIND || seen.has(event.id)) fail('EVENT_SIGNATURE', `Invalid event at ${index + 1}.`);
      const body = JSON.parse(event.content);
      if (body.schema !== SCHEMA || body.sequence !== index + 1 || body.previous !== previous || !Array.isArray(body.parents) || body.parents.some(id => !seen.has(id))) fail('EVENT_CHAIN', `Broken causal chain at ${index + 1}.`);
      if (!Number.isSafeInteger(body.observedAt) || Math.floor(body.observedAt / 1000) !== event.created_at || typeof body.kind !== 'string') fail('EVENT_FIELDS', `Invalid event fields at ${index + 1}.`);
      seen.add(event.id); previous = event.id;
    }
    const checkpoint = bundle.checkpoint;
    if (!nostr.verifyEvent(checkpoint).valid || checkpoint.pubkey !== bundle.pubkey || checkpoint.kind !== KIND) fail('CHECKPOINT_SIGNATURE', 'Invalid checkpoint signature.');
    const head = JSON.parse(checkpoint.content), root = aura.root(bundle.events.map(event => event.id)).root;
    if (head.schema !== 'wolf-checkpoint/v1' || head.size !== bundle.events.length || head.root !== root || head.last !== previous) fail('CHECKPOINT_MISMATCH', 'The retained checkpoint does not match the event prefix.');
    if (expectedHead) {
      if (!Number.isSafeInteger(expectedHead.size) || expectedHead.size < 0 || expectedHead.size > bundle.events.length || aura.root(bundle.events.slice(0, expectedHead.size).map(event => event.id)).root !== expectedHead.root) fail('RETAINED_HEAD_MISMATCH', 'The bundle no longer contains the independently retained prefix.');
    }
    return { ok: true, events: bundle.events.length, root, head: { size: head.size, root, last: previous, checkpointId: checkpoint.id }, pubkey: bundle.pubkey, identityBound: Boolean(expectedPubkey), retainedHeadChecked: Boolean(expectedHead), authority: 'none', statement: 'Signatures establish authorship and integrity, not source truth or trading performance.' };
  } catch (error) {
    errors.push({ code: error.code ?? 'MALFORMED_BUNDLE', message: error.message });
    return { ok: false, errors, authority: 'none' };
  }
}

/** Durable local trading intelligence using the actual pinned Kira, Aura and Nostr cells. */
export function createAukoraIntelligence({ dataDir, now = Date.now } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('An isolated intelligence data directory is required.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (lstatSync(dataDir).isSymbolicLink()) fail('DATA_DIRECTORY', 'The intelligence directory must not be a symbolic link.');
  const { kira, nostr, aura } = loadCells();
  const counts = { kira: 1, nostr: 1, aura: 1 };
  const keyPath = join(dataDir, 'identity.key');
  if (!existsSync(keyPath)) {
    const secret = randomBytes(32);
    try { nostr.publicKey(secret); writeFileSync(keyPath, secret, { mode: 0o600, flag: 'wx' }); } finally { secret.fill(0); }
  }
  const keyStat = lstatSync(keyPath);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.size !== 32) fail('IDENTITY_FILE', 'The intelligence identity is invalid.');
  chmodSync(keyPath, 0o600);
  const withKey = fn => { const secret = readFileSync(keyPath); try { return fn(secret); } finally { secret.fill(0); } };
  const pubkey = withKey(key => nostr.publicKey(key)); counts.nostr++;
  const db = new DatabaseSync(join(dataDir, 'intelligence.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS evidence (sequence INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, event TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS intelligence_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, text TEXT NOT NULL, sources TEXT NOT NULL, classification TEXT NOT NULL, superseded_by TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS candidate (id TEXT PRIMARY KEY, spec TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS evaluation (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, report TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS external_evidence (id TEXT PRIMARY KEY, event TEXT NOT NULL, receipt_id TEXT NOT NULL);`);
  const meta = key => { const row = db.prepare('SELECT value FROM intelligence_meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; };
  const setMeta = (key, value) => db.prepare('INSERT INTO intelligence_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  const events = () => db.prepare('SELECT event FROM evidence ORDER BY sequence').all().map(row => JSON.parse(row.event));
  const sign = draft => { counts.nostr++; return withKey(secret => nostr.signEvent(draft, secret)); };
  const merkle = ids => { counts.aura++; return aura.root(ids).root; };
  const checkpoint = current => sign({ created_at: Math.floor(now() / 1000), kind: KIND, tags: [['t', 'wolf-checkpoint']], content: JSON.stringify({ schema: 'wolf-checkpoint/v1', size: current.length, root: merkle(current.map(event => event.id)), last: current.at(-1)?.id ?? null }) });
  let lastCheckpoint = meta('checkpoint');
  if (lastCheckpoint) {
    const check = verifyEvidence({ schema: 'wolf-evidence-bundle/v1', pubkey, events: events(), checkpoint: lastCheckpoint }, { expectedPubkey: pubkey });
    if (!check.ok) { db.close(); fail('EVIDENCE_INTEGRITY', 'Stored intelligence failed verification; preserve its files for recovery.'); }
  } else {
    if (events().length) { db.close(); fail('CHECKPOINT_MISSING', 'The retained evidence checkpoint is missing.'); }
    lastCheckpoint = checkpoint([]); setMeta('checkpoint', lastCheckpoint);
  }
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  // Projections are disposable indexes. Reconstruct them from the verified signed log,
  // so editing a SQLite memory row cannot silently manufacture a trusted recollection.
  transaction(() => {
    db.exec('DELETE FROM memory; DELETE FROM candidate; DELETE FROM evaluation; DELETE FROM external_evidence;');
    setMeta('activeCandidate', null);
    for (const event of events()) {
      const body = JSON.parse(event.content), p = body.payload;
      if (body.kind === 'memory.remembered' || body.kind === 'memory.corrected') {
        db.prepare('INSERT INTO memory(id,text,sources,classification,created_at) VALUES(?,?,?,?,?)').run(event.id, p.text, JSON.stringify(p.sources), JSON.stringify(p.classification), body.observedAt);
        if (p.correctionOf) db.prepare('UPDATE memory SET superseded_by=? WHERE id=?').run(event.id, p.correctionOf);
      } else if (body.kind === 'candidate.created') {
        db.prepare('INSERT OR IGNORE INTO candidate(id,spec,created_at) VALUES(?,?,?)').run(p.id, JSON.stringify(p.spec), body.observedAt);
      } else if (body.kind === 'candidate.evaluated') {
        const { id, ...report } = p;
        db.prepare('INSERT OR IGNORE INTO evaluation(id,candidate_id,report,created_at) VALUES(?,?,?,?)').run(id, p.candidateId, JSON.stringify(report), body.observedAt);
      } else if (body.kind === 'candidate.promoted') {
        setMeta('activeCandidate', { id: p.id, evaluationId: p.evaluationId, previous: p.previous, promotedAt: body.observedAt, receiptId: event.id, capitalMode: 'PAPER' });
      } else if (body.kind === 'network.evidence-imported') {
        db.prepare('INSERT OR IGNORE INTO external_evidence(id,event,receipt_id) VALUES(?,?,?)').run(p.event.id, JSON.stringify(p.event), event.id);
      }
    }
  });
  function append(kind, payload, parents = []) {
    kind = shortText(kind, 100, 'Record kind'); payload = bounded(payload);
    if (!Array.isArray(parents) || parents.length > 16 || parents.some(id => !hex(id))) fail('INVALID_PARENTS', 'Supply up to 16 prior evidence IDs.');
    const current = events();
    if (current.length >= MAX_RECORDS) fail('EVIDENCE_FULL', 'Export and archive this research history before continuing.');
    if (Buffer.byteLength(JSON.stringify(current)) + Buffer.byteLength(JSON.stringify(payload)) + 2048 > MAX_EXPORT - 1048576) fail('EVIDENCE_FULL', 'Export and archive this research history before continuing.');
    const known = new Set(current.map(event => event.id));
    if (parents.some(id => !known.has(id))) fail('UNKNOWN_PARENT', 'A causal parent is absent from this evidence log.');
    const observedAt = now();
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) fail('CLOCK_INVALID', 'The observation clock is invalid.');
    const body = { schema: SCHEMA, sequence: current.length + 1, kind, observedAt, previous: current.at(-1)?.id ?? null, parents: [...new Set(parents)], payload };
    const event = sign({ created_at: Math.floor(observedAt / 1000), kind: KIND, tags: [['t', 'wolf-evidence'], ['d', kind], ...body.parents.map(id => ['e', id])], content: JSON.stringify(body) });
    db.prepare('INSERT INTO evidence(sequence,id,event) VALUES(?,?,?)').run(body.sequence, event.id, JSON.stringify(event));
    current.push(event); lastCheckpoint = checkpoint(current); setMeta('checkpoint', lastCheckpoint);
    return { id: event.id, ...body, signer: pubkey, signature: event.sig, authority: 'none' };
  }
  function record(kind, payload, parents = []) { if (typeof kind === 'string' && /^(?:memory|candidate|network)\./.test(kind)) fail('RESERVED_KIND', 'This record kind belongs to a typed intelligence operation.'); return transaction(() => append(kind, payload, parents)); }
  function draftNote(input) {
    const text = shortText(input?.text, 4096, 'Memory text'), sources = sourceList(input.sources ?? []);
    const lane = ['finding', 'experience'].includes(input.kind) ? input.kind : 'finding';
    counts.kira++;
    const classification = kira.classifyNote({ caller: 'model', note: { capture_source: input.capture ?? 'model-generated', form: 'fact', lane, privacy: 'local', scope: 'wolf:research', source_ids: sources.map(sourceId), statement: text }, source_captures: sources.map(() => 'web-derived'), source_roots: sources.map(source => [sourceId(source)]) });
    if (!classification.allowed) fail('MEMORY_REFUSED', 'Kira refused this memory classification.');
    return { text, sources, classification };
  }
  function saveNote(note, parents = [], correctionOf = null) {
    const receipt = append(correctionOf ? 'memory.corrected' : 'memory.remembered', { ...note, correctionOf }, parents);
    db.prepare('INSERT INTO memory(id,text,sources,classification,created_at) VALUES(?,?,?,?,?)').run(receipt.id, note.text, JSON.stringify(note.sources), JSON.stringify(note.classification), receipt.observedAt);
    if (correctionOf) db.prepare('UPDATE memory SET superseded_by=? WHERE id=?').run(receipt.id, correctionOf);
    return { id: receipt.id, ...note, observedAt: receipt.observedAt, authority: 'none' };
  }
  function remember(input) { const note = draftNote(input); return transaction(() => saveNote(note, input.parents ?? [])); }
  function correct(id, replacement) {
    if (!hex(id) || !db.prepare('SELECT id FROM memory WHERE id=? AND superseded_by IS NULL').get(id)) fail('MEMORY_NOT_CURRENT', 'Only a current local memory can be corrected.');
    const note = draftNote(typeof replacement === 'string' ? { text: replacement } : replacement);
    return transaction(() => { if (!db.prepare('SELECT id FROM memory WHERE id=? AND superseded_by IS NULL').get(id)) fail('MEMORY_NOT_CURRENT', 'The memory was already corrected.'); return saveNote(note, [...new Set([id, ...(typeof replacement === 'object' ? replacement.parents ?? [] : [])])], id); });
  }
  function recall(query, { limit = 8 } = {}) {
    if (typeof query !== 'string' || query.length > 2000 || !Number.isInteger(limit) || limit < 1 || limit > 32) fail('RECALL_INPUT', 'Recall query or limit is invalid.');
    const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
    const rows = db.prepare('SELECT * FROM memory WHERE superseded_by IS NULL ORDER BY created_at DESC LIMIT 512').all();
    const scored = rows.map(row => ({ row, score: terms.reduce((total, term) => total + (row.text.toLocaleLowerCase().includes(term) ? 1 : 0), 0) })).filter(item => !terms.length || item.score);
    counts.kira++;
    const ranking = kira.recallRank({ caller: 'owner', budget: 12000, items: scored.map(({ row, score }) => ({ id: row.id, lane: JSON.parse(row.classification).lane, author: 'model', privacy: 'local', quarantined: false, superseded: false, score, chars: row.text.length, statement_hash: hash(row.text) })) });
    const byId = new Map(rows.map(row => [row.id, row]));
    return { query, method: 'kira-core/term-overlap-ranked', items: ranking.ids.slice(0, limit).map(id => { const row = byId.get(id); return { id, text: row.text, sources: JSON.parse(row.sources), classification: JSON.parse(row.classification), observedAt: row.created_at }; }), authority: 'none', budgetUsed: ranking.budget_used };
  }
  function exportEvidence() { return { schema: 'wolf-evidence-bundle/v1', pubkey, events: events(), checkpoint: meta('checkpoint'), exportedAt: now(), sharing: 'local-export-only' }; }
  function importNostrEvent(event) {
    event = bounded(event);
    counts.nostr++;
    if (!nostr.verifyEvent(event).valid || event.created_at > Math.floor(now() / 1000) + 300 || event.kind !== KIND) fail('NOSTR_EVENT_REFUSED', 'The signed evidence event is invalid, unsupported, or future-dated.');
    let body; try { body = JSON.parse(event.content); } catch { fail('NOSTR_CONTENT', 'The evidence event has unreadable content.'); }
    if (body.schema !== SCHEMA || typeof body.kind !== 'string') fail('NOSTR_SCHEMA', 'This event is not Wolf evidence.');
    const prior = db.prepare('SELECT receipt_id FROM external_evidence WHERE id=?').get(event.id);
    if (prior) return { duplicate: true, id: event.id, receiptId: prior.receipt_id, authority: 'none' };
    return transaction(() => {
      const receipt = append('network.evidence-imported', { event, signer: event.pubkey, trust: 'untrusted-external', claimVerified: false });
      db.prepare('INSERT INTO external_evidence(id,event,receipt_id) VALUES(?,?,?)').run(event.id, JSON.stringify(event), receipt.id);
      return { imported: true, id: event.id, receiptId: receipt.id, author: event.pubkey, trust: 'untrusted-external', authority: 'none' };
    });
  }
  function exportNostrEvent(id) {
    const row = db.prepare('SELECT event FROM evidence WHERE id=?').get(id);
    if (!row) fail('EVIDENCE_NOT_FOUND', 'That evidence record is absent.');
    return JSON.parse(row.event);
  }
  function createCandidate(spec) {
    spec = bounded(spec, 8192);
    shortText(spec.name, 100, 'Candidate name');
    if (spec.method !== 'weighted-probabilities/v1' || typeof spec.modelWeight !== 'number' || spec.modelWeight < 0 || spec.modelWeight > 1 || !Number.isFinite(spec.modelWeight)) fail('CANDIDATE_METHOD', 'Use an explicit weighted-probabilities/v1 candidate with modelWeight between zero and one.');
    const frozen = { ...spec, schema: 'wolf-candidate/v1' }, id = hash(frozen);
    if (db.prepare('SELECT id FROM candidate WHERE id=?').get(id)) return { id, spec: frozen, duplicate: true };
    return transaction(() => { const receipt = append('candidate.created', { id, spec: frozen }); db.prepare('INSERT INTO candidate(id,spec,created_at) VALUES(?,?,?)').run(id, JSON.stringify(frozen), now()); return { id, spec: frozen, receiptId: receipt.id }; });
  }
  function evaluateCandidate(id, input) {
    const row = db.prepare('SELECT spec FROM candidate WHERE id=?').get(id);
    if (!row) fail('CANDIDATE_UNKNOWN', 'Register the exact candidate first.');
    const spec = JSON.parse(row.spec), cases = Array.isArray(input) ? input : input?.cases;
    const splitId = shortText(Array.isArray(input) ? 'unspecified' : input.splitId, 120, 'Holdout split');
    if (!Array.isArray(cases) || cases.length < 1 || cases.length > 500) fail('EVALUATION_CASES', 'Supply 1 to 500 dated, resolved evaluation cases.');
    const seen = new Set(); let candidateBrier = 0, baselineBrier = 0;
    const caseDigests = [], normalizedCases = [];
    for (const item of cases) {
      if (!recordLike(item) || typeof item.id !== 'string' || !item.id || item.id.length > 128 || seen.has(item.id) || ![0, 1].includes(item.outcome) || ![item.marketProbability, item.modelProbability].every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1) || !Number.isSafeInteger(item.predictedAt) || !Number.isSafeInteger(item.resolvedAt) || item.predictedAt >= item.resolvedAt || item.resolvedAt > now()) fail('EVALUATION_CASE', 'Cases need unique IDs, probabilities, binary outcomes, and prediction times preceding known resolution.');
      seen.add(item.id); const normalized = { id: item.id, predictedAt: item.predictedAt, resolvedAt: item.resolvedAt, marketProbability: item.marketProbability, modelProbability: item.modelProbability, outcome: item.outcome }; normalizedCases.push(normalized); caseDigests.push(hash(normalized));
      const prediction = spec.modelWeight * item.modelProbability + (1 - spec.modelWeight) * item.marketProbability;
      candidateBrier += (prediction - item.outcome) ** 2; baselineBrier += (item.marketProbability - item.outcome) ** 2;
    }
    const report = { schema: 'wolf-evaluation/v1', candidateId: id, splitId, samples: cases.length, candidateBrier: candidateBrier / cases.length, baselineBrier: baselineBrier / cases.length, datasetHash: hash(caseDigests), evaluatedAt: now(), eligible: cases.length >= 20 && candidateBrier < baselineBrier, evidence: 'caller-supplied dated resolved cases; independent source validation and trading P&L are not established', authority: 'none' };
    const evaluationId = hash(report);
    return transaction(() => { const datasetReceipts = []; for (let i = 0; i < normalizedCases.length; i += 50) datasetReceipts.push(append('evaluation.dataset', { splitId, cases: normalizedCases.slice(i, i + 50) }).id); const receipt = append('candidate.evaluated', { id: evaluationId, ...report, datasetReceipts }, datasetReceipts); db.prepare('INSERT OR IGNORE INTO evaluation(id,candidate_id,report,created_at) VALUES(?,?,?,?)').run(evaluationId, id, JSON.stringify(report), now()); return { id: evaluationId, ...report, receiptId: receipt.id }; });
  }
  function promoteCandidate(id, { expectedActiveId = null, evaluationId, allowPaper = false } = {}) {
    if (!allowPaper) fail('PROMOTION_POLICY_REQUIRED', 'Explicit paper-only promotion permission is required.');
    const evaluation = db.prepare('SELECT report FROM evaluation WHERE id=? AND candidate_id=?').get(evaluationId, id);
    if (!evaluation) fail('EVALUATION_UNKNOWN', 'An evaluation of these exact candidate bytes is required.');
    const report = JSON.parse(evaluation.report);
    if (!report.eligible) fail('PROMOTION_REFUSED', 'The candidate did not improve on the market baseline in at least 20 dated cases.');
    counts.kira++;
    const permission = kira.permissions({ grants: [{ permission: 'activate', scope: `wolf:candidate:${id}`, allow: true }], needs: [{ permission: 'activate', scope: `wolf:candidate:${id}` }] });
    if (!permission.allowed) fail('PROMOTION_REFUSED', 'Candidate activation is outside the granted scope.');
    return transaction(() => {
      const active = meta('activeCandidate');
      if ((active?.id ?? null) !== expectedActiveId) fail('CANDIDATE_HEAD_MOVED', 'The active candidate changed; inspect it before promoting.');
      const receipt = append('candidate.promoted', { id, evaluationId, previous: expectedActiveId, capitalMode: 'PAPER', controlsUnchanged: true });
      const next = { id, evaluationId, previous: expectedActiveId, promotedAt: now(), receiptId: receipt.id, capitalMode: 'PAPER' }; setMeta('activeCandidate', next); return next;
    });
  }
  function status() {
    const head = JSON.parse(meta('checkpoint').content);
    return { schema: 'wolf-intelligence/v1', state: 'ready', identity: { pubkey, privateKeyExported: false }, cells: [
      { name: 'kira-core', state: 'running', calls: counts.kira, sha256: '4d1be5b5eb8cb2ba943cac58aff3e5ad46f3c3e779af3cc3c1778282f32caa3e', roles: ['capture classification', 'taint clamping', 'recall ranking', 'scope permissions'], maxFuelUsed: String(kira.maxFuelUsed) },
      { name: 'nostr-core', state: 'running', calls: counts.nostr, sha256: '1b00e08461e6c2e9a99e5d32a93389d633aeb776a5d3e4a3e2b173cd6ce82530', roles: ['BIP-340 signatures', 'NIP-01 event verification'], lastFuelUsed: String(nostr.lastFuelUsed) },
      { name: 'aura-relay', state: 'running', calls: counts.aura, sha256: '65eb44c909d0ef97d9f5160a6b90fde54974c42db95af70366428bebd5080dd5', roles: ['RFC6962 Merkle commitment'], lastFuelUsed: String(aura.lastFuelUsed) },
    ], records: head.size, memoryNotes: db.prepare('SELECT count(*) AS n FROM memory WHERE superseded_by IS NULL').get().n, head: { size: head.size, root: head.root, last: head.last }, network: { protocol: 'NIP-01', importExport: true, relayConnected: false, automaticPublishing: false }, activeCandidate: meta('activeCandidate'), limits: { maxRecords: MAX_RECORDS, privateByDefault: true, authority: 'none', executionContainment: 'Pinned zero-import metered cells only; not the whole Node host.' } };
  }
  return { record, remember, recall, correct, status, exportEvidence, verifyEvidence: (bundle, options = {}) => verifyEvidence(bundle, options), importNostrEvent, exportNostrEvent, createCandidate, evaluateCandidate, promoteCandidate, close: () => db.close() };
}
