import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export { createResearchPolicyService } from './research-policy.mjs';

function fail(code, message) { throw Object.assign(new Error(message), { code, status: 403 }); }
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  fail('AUTHORITY_JSON', 'Permission payloads must be finite JSON values.');
}
export const actionDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const copy = value => structuredClone(value);
const scopes = { paper: ['arm', 'trade'], research: ['research', 'scan', 'forecast', 'replay'], 'research-policy': ['promote'] };
function publicJwk(value) {
  if (!value || value.kty !== 'EC' || value.crv !== 'P-256' || 'd' in value || ![value.x, value.y].every(x => typeof x === 'string' && /^[A-Za-z0-9_-]{43}$/.test(x) && Buffer.from(x, 'base64url').length === 32)) fail('OWNER_KEY', 'An owner public P-256 browser key is required.');
  const jwk = { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
  try { createPublicKey({ key: jwk, format: 'jwk' }); } catch { fail('OWNER_KEY', 'The owner public key is invalid.'); }
  return jwk;
}
function signatureValid(jwk, challenge, signature) {
  try {
    if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
    return verify('sha256', Buffer.from(canonicalJson(challenge)), { key: createPublicKey({ key: publicJwk(jwk), format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}
function termsFor(value, audience, time, replay = false) {
  if (!value || Object.keys(value).some(k => !['scope', 'resource', 'actions', 'expiresAt', 'maxUses', 'audience'].includes(k))) fail('GRANT_TERMS', 'Permission terms contain an unsupported field.');
  if (!scopes[value.scope] || typeof value.resource !== 'string' || !/^[a-f0-9]{64}$/.test(value.resource)) fail('GRANT_RESOURCE', 'Permission must name one exact action digest and supported scope.');
  if (!Array.isArray(value.actions) || !value.actions.length || value.actions.length > 8 || new Set(value.actions).size !== value.actions.length || value.actions.some(a => !scopes[value.scope].includes(a))) fail('GRANT_ACTIONS', 'Permission contains an action outside this scope.');
  if (value.audience !== undefined && value.audience !== audience) fail('GRANT_AUDIENCE', 'Permission is for a different application.');
  const expires = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (!Number.isSafeInteger(expires) || !replay && (expires <= time || expires > time + (value.scope === 'research' ? 31 : 1) * 24 * 60 * 60 * 1000)) fail('GRANT_EXPIRY', 'Paper and policy permissions expire within 24 hours; research within 31 days.');
  if (!Number.isSafeInteger(value.maxUses) || value.maxUses < 1 || value.maxUses > 10000) fail('GRANT_BUDGET', 'Permission requires a bounded budget of 1 to 10,000 uses.');
  return { audience, scope: value.scope, resource: value.resource, actions: [...value.actions], expiresAt: new Date(expires).toISOString(), maxUses: value.maxUses };
}

/** Owner signatures authorize narrowly bound actions. A browser key proves key possession,
 * not hardware protection, human presence, or protection from a compromised local host. */
export function createAuthorityService({ dataDir, aukora, now = Date.now, audience = 'wolf-trader:local' } = {}) {
  if (!dataDir || !aukora?.record) throw new TypeError('Authority needs a private data directory and verified AUKORA history.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (lstatSync(dataDir).isSymbolicLink()) fail('AUTHORITY_DIRECTORY', 'Authority directory cannot be a symbolic link.');
  const pinPath = join(dataDir, 'owner-public-key.json');
  let owner = existsSync(pinPath) ? publicJwk(JSON.parse(readFileSync(pinPath, 'utf8'))) : null;
  let enrolled = false;
  const grants = new Map(), operations = new Map(), completed = new Set();
  const db = new DatabaseSync(join(dataDir, 'authority.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, body TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);');
  const getGrant = id => { const g = grants.get(id); if (!g) fail('GRANT_UNKNOWN', 'This owner permission does not exist.'); return g; };
  function apply(receipt) {
    const { kind, payload: p } = receipt;
    if (!kind?.startsWith('authority.')) return;
    if (kind === 'authority.operation-consumed') {
      const g = getGrant(p.grantId), key = p.grantId + ':' + p.operationId;
      if (operations.has(key)) { if (operations.get(key).digest !== p.digest) fail('AUTHORITY_INTEGRITY', 'An operation ID was reused with different bytes.'); return; }
      if (g.revoked || g.used >= g.terms.maxUses || !g.terms.actions.includes(p.action) || p.scope !== g.terms.scope || p.resource !== g.terms.resource || receipt.observedAt >= Date.parse(g.terms.expiresAt)) fail('AUTHORITY_INTEGRITY', 'A recorded use exceeds its owner permission.');
      g.used++; operations.set(key, { digest: p.digest, receiptId: receipt.id }); return;
    }
    if (!['authority.owner-enrolled', 'authority.granted', 'authority.revoked'].includes(kind)) return;
    const { challenge: c, signature } = p.proof ?? {};
    if (!c || c.schema !== 'wolf-owner-challenge/v1' || c.audience !== audience || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) || receipt.observedAt < c.issuedAt || receipt.observedAt >= c.expiresAt || completed.has(c.id)) fail('AUTHORITY_INTEGRITY', 'The recorded owner challenge is invalid or replayed.');
    if (kind === 'authority.owner-enrolled') {
      if (enrolled || c.action !== 'enroll') fail('AUTHORITY_INTEGRITY', 'Owner enrollment was replaced.');
      const jwk = publicJwk(c.payload.publicKeyJwk);
      if (owner && actionDigest(owner) !== actionDigest(jwk) || !signatureValid(jwk, c, signature)) fail('OWNER_SIGNATURE', 'Owner enrollment does not match the pinned browser key.');
      owner = jwk; enrolled = true;
    } else {
      if (!enrolled || !signatureValid(owner, c, signature)) fail('OWNER_SIGNATURE', 'An owner permission has an invalid signature.');
      if (kind === 'authority.granted') {
        if (c.action !== 'grant' || p.id !== actionDigest(c)) fail('AUTHORITY_INTEGRITY', 'Grant identity does not bind its signed challenge.');
        const terms = termsFor(c.payload.terms, audience, c.issuedAt, true);
        if (Date.parse(terms.expiresAt) <= c.issuedAt || Date.parse(terms.expiresAt) > c.issuedAt + (terms.scope === 'research' ? 31 : 1) * 86400000) fail('AUTHORITY_INTEGRITY', 'Recorded grant expiry is invalid.');
        grants.set(p.id, { id: p.id, terms, used: 0, revoked: false, receiptId: receipt.id, ownerFingerprint: actionDigest(owner), proof: copy(p.proof) });
      } else {
        if (c.action !== 'revoke') fail('AUTHORITY_INTEGRITY', 'Revocation is not owner authorized.');
        const g = getGrant(c.payload.grantId); g.revoked = true; g.revocationReceiptId = receipt.id;
      }
    }
    completed.add(c.id);
  }
  // Authority indexes are rebuilt from verified signed history, not editable grant rows.
  try {
    if (aukora.readRecords) { let after = 0, batch; do { batch = aukora.readRecords({ after, limit: 512 }); for (const row of batch) apply(row); after = batch.at(-1)?.sequence ?? after; } while (batch.length); }
    else for (const event of aukora.exportEvidence().events) apply({ id: event.id, ...JSON.parse(event.content) });
    if (owner && !enrolled) fail('OWNER_HISTORY_MISSING', 'The pinned owner enrollment is missing from verified history.');
    if (enrolled && !existsSync(pinPath)) writeFileSync(pinPath, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    for (const id of completed) db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(id);
  } catch (error) { db.close(); throw error; }
  function challenge(input = {}) {
    const action = input.action;
    let payload;
    if (action === 'enroll') {
      if (enrolled) fail('OWNER_ALREADY_ENROLLED', 'An owner browser key is already enrolled.');
      payload = { publicKeyJwk: publicJwk(input.publicKeyJwk) };
    } else {
      if (!enrolled) fail('OWNER_REQUIRED', 'Enroll an owner browser key first.');
      if (action === 'grant') payload = { terms: termsFor(input.terms, audience, now()) };
      else if (action === 'revoke') { getGrant(input.grantId); payload = { grantId: input.grantId }; }
      else fail('OWNER_ACTION', 'Unsupported owner action.');
    }
    const issuedAt = now(), id = randomBytes(24).toString('hex');
    const body = { schema: 'wolf-owner-challenge/v1', audience, id, nonce: randomBytes(32).toString('base64url'), action, payload, issuedAt, expiresAt: issuedAt + 300000 };
    db.prepare('DELETE FROM challenges WHERE used=1 OR json_extract(body,\'$.expiresAt\') <= ?').run(issuedAt);
    if (db.prepare('SELECT count(*) AS n FROM challenges').get().n >= 128) fail('CHALLENGE_BOUND', 'Too many pending owner requests.');
    db.prepare('INSERT INTO challenges(id,body) VALUES(?,?)').run(id, canonicalJson(body));
    return { id, challenge: copy(body), signingText: canonicalJson(body) };
  }
  function complete({ challengeId, signature, publicKeyJwk: provided } = {}) {
    const row = db.prepare('SELECT * FROM challenges WHERE id=?').get(challengeId ?? '');
    if (!row || row.used || completed.has(challengeId)) fail('OWNER_CHALLENGE_USED', 'The owner request is missing or already used.');
    const c = JSON.parse(row.body);
    if (now() < c.issuedAt || now() >= c.expiresAt) fail('OWNER_CHALLENGE_EXPIRED', 'The owner request has expired.');
    const jwk = c.action === 'enroll' ? publicJwk(c.payload.publicKeyJwk) : owner;
    if (provided && actionDigest(publicJwk(provided)) !== actionDigest(jwk)) fail('OWNER_KEY', 'The response uses a different owner key.');
    if (!jwk || !signatureValid(jwk, c, signature)) fail('OWNER_SIGNATURE', 'The owner signature does not match these exact permission terms.');
    if (c.action === 'enroll' && enrolled) fail('OWNER_ALREADY_ENROLLED', 'An owner browser key is already enrolled.');
    if (c.action === 'grant') termsFor(c.payload.terms, audience, now());
    const proof = { challenge: c, signature }, id = actionDigest(c);
    const receipt = aukora.record(c.action === 'enroll' ? 'authority.owner-enrolled' : c.action === 'grant' ? 'authority.granted' : 'authority.revoked', { ...(c.action === 'grant' ? { id } : {}), proof });
    apply(receipt);
    if (c.action === 'enroll') writeFileSync(pinPath, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(challengeId);
    return c.action === 'grant' ? { grant: copy(grants.get(id)), receiptId: receipt.id } : { enrolled, revoked: c.action === 'revoke', receiptId: receipt.id };
  }
  function inspect(input) {
    const g = getGrant(input?.grantId);
    if (g.revoked) fail('GRANT_REVOKED', 'The owner revoked this permission.');
    if (now() >= Date.parse(g.terms.expiresAt)) fail('GRANT_EXPIRED', 'The owner permission has expired.');
    if (input.scope !== g.terms.scope || input.resource !== g.terms.resource || !g.terms.actions.includes(input.action)) fail('GRANT_SCOPE', 'This exact action is outside the owner permission.');
    if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 256) fail('OPERATION_ID', 'Each effect requires a stable bounded operation identity.');
    const digest = actionDigest({ scope: input.scope, resource: input.resource, action: input.action, payload: input.payload ?? null });
    const key = g.id + ':' + input.operationId, prior = operations.get(key);
    if (prior && prior.digest !== digest) fail('OPERATION_REPLAY', 'This operation identity is already bound to different bytes.');
    if (!prior && g.used >= g.terms.maxUses) fail('GRANT_EXHAUSTED', 'The owner permission has no uses remaining.');
    return { g, digest, prior, key };
  }
  function check(input) {
    const { g, prior } = inspect(input);
    return { allowed: true, grantId: g.id, consumed: Boolean(prior), remainingUses: g.terms.maxUses - g.used, receiptId: prior?.receiptId ?? null, assurance: 'owner-browser-key; human presence not attested' };
  }
  function authorize(input) {
    const { g, digest, prior } = inspect(input);
    if (!prior) {
      const receipt = aukora.record('authority.operation-consumed', { grantId: g.id, operationId: input.operationId, scope: input.scope, resource: input.resource, action: input.action, digest }, [g.receiptId]);
      apply(receipt);
    }
    return check(input); // Synchronous final expiry/revocation check immediately before caller's effect.
  }
  function status() { return { schema: 'wolf-authority/v1', enrolled, audience, owner: enrolled ? { fingerprint: actionDigest(owner), publicKeyJwk: copy(owner), type: 'owner-browser-key', hardwareAttested: false, humanPresenceProven: false } : null, serviceIdentity: aukora.status().identity.pubkey, grants: [...grants.values()].map(g => ({ id: g.id, terms: copy(g.terms), used: g.used, remainingUses: g.terms.maxUses - g.used, revoked: g.revoked, expired: now() >= Date.parse(g.terms.expiresAt), receiptId: g.receiptId })), assurance: 'Distinct browser signing key; explicit local user-session approval, not a passkey or human-presence attestation.' }; }
  return { status, challenge, complete, check, authorize, close: () => db.close() };
}
