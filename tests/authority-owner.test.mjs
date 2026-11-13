import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAukoraIntelligence } from '../packages/aukora/index.mjs';
import { createAuthorityService, actionDigest, canonicalJson, createResearchPolicyService } from '../packages/authority/index.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wolf-owner-test-'));
  let time = 1794389000000, aukora = createAukoraIntelligence({ dataDir: join(root, 'evidence'), now: () => time, segmentSize: 4 });
  let authority = createAuthorityService({ dataDir: join(root, 'authority'), aukora, now: () => time });
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' }), publicKeyJwk = pair.publicKey.export({ format: 'jwk' });
  const complete = challenge => authority.complete({ challengeId: challenge.id, signature: sign('sha256', Buffer.from(challenge.signingText), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') });
  t.after(() => { authority?.close(); aukora?.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, get aukora() { return aukora; }, get authority() { return authority; }, pair, now: () => time, advance: ms => { time += ms; }, complete, enroll: () => complete(authority.challenge({ action: 'enroll', publicKeyJwk })), grant(terms) { return complete(authority.challenge({ action: 'grant', terms })).grant; }, reopen() { authority.close(); aukora.close(); aukora = createAukoraIntelligence({ dataDir: join(root, 'evidence'), now: () => time }); authority = createAuthorityService({ dataDir: join(root, 'authority'), aukora, now: () => time }); } };
}
function terms(f, overrides = {}) { return { scope: 'paper', resource: actionDigest({ maxOrders: 2 }), actions: ['arm', 'trade'], expiresAt: new Date(f.now() + 100000).toISOString(), maxUses: 3, ...overrides }; }
function operation(g, overrides = {}) { return { grantId: g.id, scope: g.terms.scope, resource: g.terms.resource, action: 'trade', operationId: 'order-1', payload: { marketId: 'test', price: '0.50', amount: 10 }, ...overrides }; }

test('owner grant uses a distinct browser signature and exact bound terms, never the service identity', t => {
  const f = fixture(t), a = f.authority;
  assert.throws(() => a.challenge({ action: 'grant', terms: terms(f) }), { code: 'OWNER_REQUIRED' });
  f.enroll();
  assert.equal(a.status().owner.hardwareAttested, false); assert.equal(a.status().owner.humanPresenceProven, false);
  assert.notEqual(a.status().owner.fingerprint, a.status().serviceIdentity);
  const request = a.challenge({ action: 'grant', terms: terms(f) });
  const changed = structuredClone(request.challenge); changed.payload.terms.maxUses = 100;
  const forged = sign('sha256', Buffer.from(canonicalJson(changed)), { key: f.pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  assert.throws(() => a.complete({ challengeId: request.id, signature: forged }), { code: 'OWNER_SIGNATURE' });
  const approved = f.complete(request).grant;
  assert.equal(approved.terms.maxUses, 3);
  assert.throws(() => f.complete(request), { code: 'OWNER_CHALLENGE_USED' });
  assert.throws(() => a.authorize(operation(approved, { resource: actionDigest({ maxOrders: 200 }) })), { code: 'GRANT_SCOPE' });
  assert.throws(() => a.authorize(operation(approved, { scope: 'research-policy', action: 'promote' })), { code: 'GRANT_SCOPE' });
});

test('durable use budgets are idempotent only for exact payloads and final checks reject revocation', t => {
  const f = fixture(t); f.enroll(); const g = f.grant(terms(f, { maxUses: 1 })), op = operation(g);
  assert.equal(f.authority.check(op).consumed, false);
  assert.equal(f.authority.authorize(op).remainingUses, 0);
  assert.equal(f.authority.authorize(op).remainingUses, 0);
  assert.throws(() => f.authority.authorize({ ...op, payload: { amount: 11 } }), { code: 'OPERATION_REPLAY' });
  assert.throws(() => f.authority.authorize({ ...op, operationId: 'order-2' }), { code: 'GRANT_EXHAUSTED' });
  f.reopen(); assert.equal(f.authority.check(op).consumed, true);
  f.complete(f.authority.challenge({ action: 'revoke', grantId: g.id }));
  assert.throws(() => f.authority.check(op), { code: 'GRANT_REVOKED' });
  f.reopen(); assert.throws(() => f.authority.authorize(op), { code: 'GRANT_REVOKED' });
});

test('expiry and wrong-key approvals fail closed and evidence failure cannot grant authority', t => {
  const f = fixture(t); f.enroll();
  const c = f.authority.challenge({ action: 'grant', terms: terms(f) });
  const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  assert.throws(() => f.authority.complete({ challengeId: c.id, signature: sign('sha256', Buffer.from(c.signingText), { key: stranger.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') }), { code: 'OWNER_SIGNATURE' });
  const grant = f.complete(c).grant, op = operation(grant);
  f.authority.authorize(op); f.advance(100001);
  assert.throws(() => f.authority.check(op), { code: 'GRANT_EXPIRED' });
  const pending = f.authority.challenge({ action: 'grant', terms: terms(f) }); f.advance(300001);
  assert.throws(() => f.complete(pending), { code: 'OWNER_CHALLENGE_EXPIRED' });
  const next = f.grant(terms(f)); const original = f.aukora.record; f.aukora.record = () => { throw new Error('disk unavailable'); };
  assert.throws(() => f.authority.authorize(operation(next)), /disk unavailable/);
  f.aukora.record = original; assert.equal(f.authority.check(operation(next)).remainingUses, 3);
});

test('challenge database tampering cannot manufacture an owner-approved permission', t => {
  const f = fixture(t); f.enroll(); const c = f.authority.challenge({ action: 'grant', terms: terms(f) });
  const db = new DatabaseSync(join(f.root, 'authority', 'authority.sqlite'));
  const altered = structuredClone(c.challenge); altered.payload.terms.maxUses = 500;
  db.prepare('UPDATE challenges SET body=? WHERE id=?').run(canonicalJson(altered), c.id); db.close();
  assert.throws(() => f.complete(c), { code: 'OWNER_SIGNATURE' });
  assert.equal(f.authority.status().grants.length, 0);
});

test('weekly research grants can cover four weeks while paper authority expires within one day', t => {
  const f = fixture(t); f.enroll();
  const until = days => new Date(f.now() + days * 86400000).toISOString();
  const research = f.grant(terms(f, { scope: 'research', actions: ['scan'], expiresAt: until(28), maxUses: 4 }));
  assert.equal(research.terms.maxUses, 4);
  assert.throws(() => f.authority.challenge({ action: 'grant', terms: terms(f, { scope: 'research', actions: ['scan'], expiresAt: until(32) }) }), { code: 'GRANT_EXPIRY' });
  assert.throws(() => f.authority.challenge({ action: 'grant', terms: terms(f, { expiresAt: until(2) }) }), { code: 'GRANT_EXPIRY' });
});

test('research-policy challenger uses fixed independent labels and cannot alter risk or execute code', t => {
  const f = fixture(t); f.enroll();
  const lab = createResearchPolicyService({ aukora: f.aukora, authority: f.authority, now: f.now });
  const spec = { name: 'Independent sources first', minEvidence: 2, minIndependentSources: 2, minRuleClarity: 0.85, maxSourceAgeHours: 24, weights: { confidence: 0.2, independence: 0.4, clarity: 0.4 } };
  assert.throws(() => lab.propose({ ...spec, maxTradeAmount: 10000 }), { code: 'POLICY_FIELDS' });
  assert.throws(() => lab.propose({ ...spec, code: 'process.exit()' }), { code: 'POLICY_FIELDS' });
  const candidate = lab.propose(spec), report = lab.evaluate(candidate.id);
  assert.equal(report.eligible, true); assert.equal(report.controlsPass, true); assert.equal(report.challengerAccuracy, 1);
  const prepared = lab.promotionRequest(candidate.id), grant = f.grant(prepared.terms);
  const active = lab.promote(prepared.request, { grantId: grant.id });
  assert.equal(active.mode, 'SHADOW'); assert.equal(active.riskControlsChanged, false);
  assert.equal(lab.shadowEvaluate({ evidenceCount: 3, independentSources: 1, ruleClarity: 1, sourceAgeHours: 1, confidence: 1 }).eligible, false);
  assert.throws(() => lab.promote(prepared.request, { grantId: grant.id }), { code: 'POLICY_HEAD_MOVED' });
  const failed = lab.propose({ ...spec, name: 'Overconfident duplicates', minIndependentSources: 1 });
  assert.equal(lab.evaluate(failed.id).controlsPass, false);
  assert.throws(() => lab.promotionRequest(failed.id), { code: 'POLICY_NOT_ELIGIBLE' });
  f.reopen(); const restored = createResearchPolicyService({ aukora: f.aukora, authority: f.authority, now: f.now });
  assert.equal(restored.status().active.candidateId, candidate.id);
});
