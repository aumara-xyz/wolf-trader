import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAukoraIntelligence, verifyEvidence, verifyArchive } from '../packages/aukora/index.mjs';
import { loadNostrCore } from '../packages/aukora-vendor/x1/src/aukora-nostr.mjs';
import { loadAuraRelayCell } from '../packages/aukora-vendor/x1/src/aukora-aura-relay.mjs';

function fixture(t, segmentSize = 4) {
  const dataDir = mkdtempSync(join(tmpdir(), 'wolf-segment-test-')), now = () => 1794389000000;
  let app = createAukoraIntelligence({ dataDir, now, segmentSize });
  t.after(() => { app?.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, now, get app() { return app; }, close() { app.close(); app = null; }, reopen() { app = createAukoraIntelligence({ dataDir, now }); return app; } };
}

test('segmented history preserves global causal parents and independently retained prefixes across rollover', t => {
  const f = fixture(t), first = f.app.record('source.observed', { value: 0 });
  f.app.record('finding', { value: 1 }, [first.id]); const retained = f.app.status().head;
  for (let n = 2; n < 13; n++) f.app.record('finding', { value: n }, [first.id]);
  const bundle = f.app.exportEvidence(); assert.equal(bundle.schema, 'wolf-evidence-bundle/v2');
  assert.equal(bundle.segments.length, 4); assert.equal(bundle.events.length, 13);
  assert.equal(verifyEvidence(bundle, { expectedPubkey: bundle.pubkey, expectedHead: retained }).ok, true);
  const manifest = f.app.exportManifest(), parts = manifest.segments.map((_, i) => f.app.exportSegment(i));
  assert.equal(verifyArchive(manifest, parts).ok, true);
  assert.equal(verifyArchive(manifest, parts.slice(1)).ok, false);
  assert.equal(verifyArchive(manifest, [...parts].reverse()).ok, false);
  const changed = structuredClone(parts); changed[2].events[0].content += ' ';
  assert.equal(verifyArchive(manifest, changed).ok, false);
  assert.equal(f.app.getRecord(first.id).payload.value, 0);
  assert.deepEqual(f.app.readRecords({ after: 10, limit: 2 }).map(r => r.sequence), [11, 12]);
  f.close(); assert.equal(f.reopen().status().records, 13);
});

test('legacy histories migrate without rewriting any signed event or losing a retained old head', t => {
  const f = fixture(t); for (let i = 0; i < 9; i++) f.app.record('legacy.record', { i });
  const exported = f.app.exportEvidence(); f.close();
  const nostr = loadNostrCore(), aura = loadAuraRelayCell(), root = aura.root(exported.events.map(e => e.id)).root;
  const key = readFileSync(join(f.dataDir, 'identity.key'));
  const checkpoint = nostr.signEvent({ created_at: Math.floor(f.now() / 1000), kind: 9451, tags: [['t', 'wolf-checkpoint']], content: JSON.stringify({ schema: 'wolf-checkpoint/v1', size: 9, root, last: exported.events.at(-1).id }) }, key); key.fill(0);
  const old = { schema: 'wolf-evidence-bundle/v1', pubkey: exported.pubkey, events: exported.events, checkpoint };
  assert.equal(verifyEvidence(old).ok, true);
  const db = new DatabaseSync(join(f.dataDir, 'intelligence.sqlite'));
  db.prepare("UPDATE intelligence_meta SET value=? WHERE key='checkpoint'").run(JSON.stringify(checkpoint)); db.exec("DELETE FROM evidence_segments; DELETE FROM intelligence_meta WHERE key='segmentSize';"); db.close();
  const a = f.reopen(); assert.deepEqual(a.exportEvidence().events, old.events);
  a.record('new.record', { i: 9 }, [old.events[0].id]);
  assert.equal(verifyEvidence(a.exportEvidence(), { expectedHead: { size: 9, root }, expectedPubkey: old.pubkey }).ok, true);
  f.close(); assert.equal(f.reopen().status().records, 10);
});

test('running getters reject changed, replaced, and deleted signed rows before they can become authority', t => {
  const f = fixture(t), row = f.app.record('authority.fixture', { allowed: false });
  const db = new DatabaseSync(join(f.dataDir, 'intelligence.sqlite'));
  const original = db.prepare('SELECT event FROM evidence WHERE id=?').get(row.id).event;
  const forged = JSON.parse(original); forged.content = forged.content.replace('false', 'true');
  db.prepare('UPDATE evidence SET event=? WHERE id=?').run(JSON.stringify(forged), row.id);
  assert.throws(() => f.app.getRecord(row.id), { code: 'EVIDENCE_INTEGRITY' });
  assert.throws(() => f.app.readRecords({ after: 0, limit: 10 }), { code: 'EVIDENCE_INTEGRITY' });
  assert.throws(() => f.app.record('next', {}, [row.id]), { code: 'EVIDENCE_INTEGRITY' });
  db.prepare('UPDATE evidence SET event=? WHERE id=?').run(original, row.id);
  assert.equal(f.app.getRecord(row.id).payload.allowed, false);
  db.prepare('DELETE FROM evidence WHERE id=?').run(row.id);
  assert.throws(() => f.app.getRecord(row.id), { code: 'EVIDENCE_INTEGRITY' });
  assert.throws(() => f.app.readRecords({ after: 0, limit: 10 }), { code: 'EVIDENCE_INTEGRITY' });
  db.close();
});

test('recording continues beyond 4096 with native signatures, durable segments, and cold full-archive verification', { skip: process.env.WOLF_STRESS !== '1', timeout: 900000 }, t => {
  const f = fixture(t, 1024); let first;
  for (let i = 0; i < 4100; i++) { const record = f.app.record('continuity.sample', { i }, first ? [first] : []); first ??= record.id; }
  assert.equal(f.app.status().records, 4100); assert.equal(f.app.status().limits.maxRecords, null);
  const manifest = f.app.exportManifest(); assert.equal(manifest.segments.length, 5);
  assert.equal(verifyArchive(manifest, (function* () { for (let i = 0; i < manifest.segments.length; i++) yield f.app.exportSegment(i); })(), { expectedPubkey: manifest.pubkey }).ok, true);
  f.close(); const reopened = f.reopen(); assert.equal(reopened.status().records, 4100);
  assert.equal(reopened.getRecord(first).sequence, 1); assert.equal(reopened.record('continuity.sample', { i: 4100 }, [first]).sequence, 4101);
});
