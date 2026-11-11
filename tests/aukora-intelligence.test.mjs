import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createAukoraIntelligence, verifyEvidence } from '../packages/aukora/index.mjs';
import { loadKiraCore } from '../packages/aukora-vendor/x1/src/kira-core.mjs';
import { KiraCore } from '../packages/aukora-vendor/x1/src/kira-core.mjs';

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'wolf-aukora-test-'));
  const now = () => 1794389000000;
  let app = createAukoraIntelligence({ dataDir, now });
  t.after(() => { app?.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, now, get app() { return app; }, close() { app.close(); app = null; }, reopen() { app = createAukoraIntelligence({ dataDir, now }); return app; } };
}

test('actual pinned Kira cell clamps model claims and ranks corrected durable memories', t => {
  const f = fixture(t), a = f.app;
  const observation = a.record('source.observed', { source: 'official statement', receivedAt: f.now() });
  const first = a.remember({ text: 'Tariff announced, enactment is unconfirmed.', capture: 'owner-signed', sources: [{ id: 'source:1', url: 'https://example.com/official' }], parents: [observation.id] });
  assert.equal(first.classification.effective_capture_source, 'web-derived');
  assert.equal(first.classification.tainted, true);
  const next = a.correct(first.id, { text: 'Tariff proposal withdrawn; no enactment.', sources: [{ id: 'correction:1' }] });
  assert.throws(() => a.correct(first.id, 'A second competing correction'), { code: 'MEMORY_NOT_CURRENT' });
  assert.deepEqual(a.recall('tariff').items.map(n => n.id), [next.id]);
  f.close(); const reopened = f.reopen();
  assert.equal(reopened.recall('tariff').items[0].text, next.text);
  assert(reopened.status().cells.find(c => c.name === 'kira-core').calls >= 2);
});

test('signed Nostr events and Aura root cold-verify; edits, reorder, truncation and wrong issuer fail', t => {
  const { app: a } = fixture(t);
  const first = a.record('market.observed', { marketId: '42', ask: '0.52' });
  a.record('signal.proposed', { marketId: '42', authorizesOrder: false }, [first.id]);
  const bundle = a.exportEvidence(), head = a.status().head;
  assert.equal(verifyEvidence(bundle, { expectedPubkey: bundle.pubkey, expectedHead: head }).ok, true);
  assert.equal(verifyEvidence(bundle).identityBound, false);
  assert.equal(verifyEvidence(bundle, { expectedPubkey: 'f'.repeat(64) }).ok, false);
  for (const mutate of [b => { b.events[0].content += ' '; }, b => b.events.reverse(), b => b.events.pop(), b => { b.checkpoint.content = '{}'; }]) {
    const changed = structuredClone(bundle); mutate(changed); assert.equal(verifyEvidence(changed).ok, false);
  }
});

test('Nostr imported evidence stays untrusted and cannot authorize a trade; duplicate import is stable', t => {
  const one = fixture(t).app, two = fixture(t).app;
  const row = one.record('research.finding', { text: 'A public event claim', authorizesOrder: false });
  const event = one.exportNostrEvent(row.id), result = two.importNostrEvent(event);
  assert.equal(result.authority, 'none'); assert.equal(result.trust, 'untrusted-external');
  assert.equal(two.importNostrEvent(event).duplicate, true);
  assert.equal(two.status().network.relayConnected, false);
  const invalid = { ...event, sig: '0'.repeat(128) };
  assert.throws(() => two.importNostrEvent(invalid), { code: 'NOSTR_EVENT_REFUSED' });
  assert.equal(two.verifyEvidence(two.exportEvidence()).ok, true);
});

test('integrity failure refuses restart; changed disposable memory projection is reconstructed', t => {
  const f = fixture(t); f.app.remember({ text: 'Market rules still require enactment.' }); f.close();
  let db = new DatabaseSync(join(f.dataDir, 'intelligence.sqlite'));
  db.prepare("UPDATE memory SET text='A forged certain profit'").run(); db.close();
  assert.equal(f.reopen().recall('enactment').items.length, 1); f.close();
  db = new DatabaseSync(join(f.dataDir, 'intelligence.sqlite'));
  const row = db.prepare('SELECT sequence,event FROM evidence LIMIT 1').get();
  const event = JSON.parse(row.event); event.content += ' '; db.prepare('UPDATE evidence SET event=? WHERE sequence=?').run(JSON.stringify(event), row.sequence); db.close();
  assert.throws(() => f.reopen(), { code: 'EVIDENCE_INTEGRITY' });
});

test('typed memory operations protect projection kinds and evidence refuses credentials or invented lineage', t => {
  const { app: a } = fixture(t);
  assert.throws(() => a.record('candidate.promoted', {}), { code: 'RESERVED_KIND' });
  assert.throws(() => a.record('provider.request', { api_key: 'not-a-real-key' }), { code: 'PRIVATE_FIELD' });
  assert.throws(() => a.record('signal.proposed', {}, ['0'.repeat(64)]), { code: 'UNKNOWN_PARENT' });
  assert.throws(() => a.remember({ text: 'claim', sources: [null] }), { code: 'INVALID_SOURCE' });
  assert.equal(a.status().records, 0);
});

test('candidate evaluation records reproducible cases and promotion checks baseline, identity and active version', t => {
  const { app: a, now } = fixture(t);
  const candidate = a.createCandidate({ name: 'Research blend', method: 'weighted-probabilities/v1', modelWeight: 0.5 });
  const cases = Array.from({ length: 24 }, (_, index) => ({ id: `heldout:${index}`, marketProbability: 0.5, modelProbability: index % 2 ? 0.8 : 0.2, outcome: index % 2, predictedAt: now() - 2000, resolvedAt: now() - 1000 }));
  const report = a.evaluateCandidate(candidate.id, { splitId: 'fixture-heldout-v1', cases });
  assert(report.candidateBrier < report.baselineBrier); assert.equal(report.eligible, true);
  assert.throws(() => a.promoteCandidate(candidate.id, { evaluationId: report.id }), { code: 'PROMOTION_POLICY_REQUIRED' });
  const promoted = a.promoteCandidate(candidate.id, { evaluationId: report.id, expectedActiveId: null, allowPaper: true });
  assert.equal(promoted.capitalMode, 'PAPER');
  assert.throws(() => a.promoteCandidate(candidate.id, { evaluationId: report.id, expectedActiveId: null, allowPaper: true }), { code: 'CANDIDATE_HEAD_MOVED' });
  const weak = a.createCandidate({ name: 'No edge blend', method: 'weighted-probabilities/v1', modelWeight: 0 });
  const rejected = a.evaluateCandidate(weak.id, { splitId: 'fixture-heldout-v1', cases });
  assert.equal(rejected.eligible, false);
  assert.throws(() => a.promoteCandidate(weak.id, { evaluationId: rejected.id, allowPaper: true }), { code: 'PROMOTION_REFUSED' });
  assert.throws(() => a.evaluateCandidate(candidate.id, { splitId: 'future-leak', cases: [{ ...cases[0], predictedAt: now() }] }), { code: 'EVALUATION_CASE' });
  assert(a.exportEvidence().events.some(e => JSON.parse(e.content).kind === 'evaluation.dataset'));
});

test('vendor manifest binds unchanged source files and pinned cells refuse modified bytes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/aukora-vendor/MANIFEST.json', import.meta.url), 'utf8'));
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL('../packages/aukora-vendor/x1/' + file.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  assert.equal(loadKiraCore().ping(), true);
  const modified = readFileSync(new URL('../packages/aukora-vendor/x1/assets/kira-core.wasm', import.meta.url)); modified[modified.length - 1] ^= 1;
  assert.throws(() => new KiraCore(modified), /hash mismatch/);
  const intact = readFileSync(new URL('../packages/aukora-vendor/x1/assets/kira-core.wasm', import.meta.url));
  assert.throws(() => new KiraCore(intact, 1), /FUEL_OR_TRAP/);
});
