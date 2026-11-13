import { createHash } from 'node:crypto';
import { loadNostrCore } from '../aukora-vendor/x1/src/aukora-nostr.mjs';
import { loadAuraRelayCell } from '../aukora-vendor/x1/src/aukora-aura-relay.mjs';

export const MAX_FULL_EXPORT = 64 * 1024 * 1024;
export const MAX_SEGMENT_EVENTS = 1024;
export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const json = value => JSON.stringify(value);
function fail(code, message) { throw Object.assign(new Error(message), { code, status: 400 }); }
export function segmentDescriptor(index, start, events, previousRoot, merkle) {
  return { schema: 'wolf-evidence-segment/v2', index, start, size: events.length, bytes: events.reduce((n, e) => n + Buffer.byteLength(json(e)), 0), root: merkle(events.map(e => e.id)), last: events.at(-1)?.id ?? null, previousRoot };
}
export function segmentCommitment(segment) {
  const { schema, index, start, size, bytes, root, last, previousRoot } = segment;
  return createHash('sha256').update('wolf-evidence-segment-commitment/v2\n' + json({ schema, index, start, size, bytes, root, last, previousRoot })).digest('hex');
}
function validSignature(nostr, event, pubkey, code) {
  if (!event || !nostr.verifyEvent(event).valid || event.pubkey !== pubkey || event.kind !== 9451) fail(code, 'An evidence signature is invalid.');
}
function prefixRoot(events, segments, size, merkle) {
  if (size === 0) return segmentCommitment(segmentDescriptor(0, 1, [], null, merkle));
  let previousRoot = null;
  for (const entry of segments) {
    const d = entry.descriptor;
    if (d.start > size) break;
    const take = Math.min(d.size, size - d.start + 1);
    const partial = segmentDescriptor(d.index, d.start, events.slice(d.start - 1, d.start - 1 + take), previousRoot, merkle);
    previousRoot = segmentCommitment(partial);
    if (d.start + take - 1 === size) return previousRoot;
  }
  return null;
}
function result(pubkey, checkpoint, count, options) {
  const head = JSON.parse(checkpoint.content);
  return { ok: true, events: count, root: head.root, head: { schema: head.schema, size: head.size, root: head.root, last: head.last, checkpointId: checkpoint.id }, pubkey, identityBound: Boolean(options.expectedPubkey), retainedHeadChecked: Boolean(options.expectedHead), authority: 'none', statement: 'Signatures establish authorship and integrity, not source truth, human reasoning, or trading performance.' };
}
function caught(error) { return { ok: false, errors: [{ code: error.code ?? 'MALFORMED_BUNDLE', message: error.message }], authority: 'none' }; }

/** Cold verification accepts old flat exports and new segmented exports unchanged. */
export function verifyEvidence(bundle, options = {}) {
  try {
    if (!bundle || !['wolf-evidence-bundle/v1', 'wolf-evidence-bundle/v2'].includes(bundle.schema) || !Array.isArray(bundle.events) || !hex(bundle.pubkey)) fail('BUNDLE_SCHEMA', 'Invalid evidence bundle.');
    if (Buffer.byteLength(json(bundle)) > MAX_FULL_EXPORT) fail('BUNDLE_BOUND', 'Use the segmented archive verifier for histories beyond the flat-export bound.');
    if (bundle.schema === 'wolf-evidence-bundle/v2') {
      if (!Array.isArray(bundle.segments)) fail('SEGMENTS_MISSING', 'Segment checkpoints are required.');
      const archive = { schema: 'wolf-evidence-manifest/v2', pubkey: bundle.pubkey, checkpoint: bundle.checkpoint, segments: bundle.segments };
      const parts = bundle.segments.map(entry => ({ schema: 'wolf-evidence-segment-bundle/v2', pubkey: bundle.pubkey, ...entry, events: bundle.events.slice(entry.descriptor.start - 1, entry.descriptor.start - 1 + entry.descriptor.size) }));
      if (bundle.events.length !== JSON.parse(bundle.checkpoint.content).size) fail('CHECKPOINT_MISMATCH', 'The event count does not match the retained checkpoint.');
      return verifyArchive(archive, parts, options);
    }
    if (bundle.events.length > 4096) fail('BUNDLE_BOUND', 'Legacy Aura exports support at most 4096 events.');
    if (options.expectedPubkey && options.expectedPubkey !== bundle.pubkey) fail('ISSUER_MISMATCH', 'The bundle is signed by a different identity.');
    const nostr = loadNostrCore(), aura = loadAuraRelayCell(), seen = new Set(); let previous = null;
    for (let i = 0; i < bundle.events.length; i++) {
      const event = bundle.events[i]; validSignature(nostr, event, bundle.pubkey, 'EVENT_SIGNATURE');
      const b = JSON.parse(event.content);
      if (seen.has(event.id) || b.schema !== 'wolf-evidence/v1' || b.sequence !== i + 1 || b.previous !== previous || !Array.isArray(b.parents) || b.parents.some(id => !seen.has(id))) fail('EVENT_CHAIN', 'The global event chain is broken.');
      if (!Number.isSafeInteger(b.observedAt) || Math.floor(b.observedAt / 1000) !== event.created_at || typeof b.kind !== 'string') fail('EVENT_FIELDS', 'Invalid evidence fields.');
      seen.add(event.id); previous = event.id; options.onVerifiedEvent?.(event);
    }
    validSignature(nostr, bundle.checkpoint, bundle.pubkey, 'CHECKPOINT_SIGNATURE');
    const head = JSON.parse(bundle.checkpoint.content), root = aura.root(bundle.events.map(e => e.id)).root;
    if (head.schema !== 'wolf-checkpoint/v1' || head.size !== bundle.events.length || head.root !== root || head.last !== previous) fail('CHECKPOINT_MISMATCH', 'The retained checkpoint does not match its event prefix.');
    if (options.expectedHead) { const h = options.expectedHead; if (!Number.isSafeInteger(h.size) || h.size < 0 || h.size > bundle.events.length || aura.root(bundle.events.slice(0, h.size).map(e => e.id)).root !== h.root) fail('RETAINED_HEAD_MISMATCH', 'The independently retained prefix is missing.'); }
    return result(bundle.pubkey, bundle.checkpoint, bundle.events.length, options);
  } catch (error) { return caught(error); }
}

/** Full archive verification consumes one bounded segment at a time. All segments
 * are required: a valid isolated signature cannot establish absent causal parents. */
export function verifyArchive(manifest, parts, options = {}) {
  try {
    if (!manifest || manifest.schema !== 'wolf-evidence-manifest/v2' || !hex(manifest.pubkey) || !Array.isArray(manifest.segments) || manifest.segments.length < 1) fail('MANIFEST_SCHEMA', 'Invalid segmented evidence manifest.');
    if (Buffer.byteLength(json(manifest)) > MAX_FULL_EXPORT) fail('MANIFEST_BOUND', 'Manifest exceeds the verifier metadata bound.');
    if (options.expectedPubkey && options.expectedPubkey !== manifest.pubkey) fail('ISSUER_MISMATCH', 'The archive is signed by a different identity.');
    const nostr = loadNostrCore(), aura = loadAuraRelayCell(), merkle = ids => aura.root(ids).root;
    const seen = new Set(), prefixEvents = [], expected = options.expectedHead;
    let sequence = 0, previous = null, previousRoot = null, index = 0, retainedRoot = null;
    if (expected && (!Number.isSafeInteger(expected.size) || expected.size < 0)) fail('RETAINED_HEAD_MISMATCH', 'Invalid retained checkpoint.');
    if (expected?.size === 0) retainedRoot = segmentCommitment(segmentDescriptor(0, 1, [], null, merkle));
    for (const part of parts) {
      const entry = manifest.segments[index];
      if (!entry || !part || part.schema !== 'wolf-evidence-segment-bundle/v2' || part.pubkey !== manifest.pubkey || json(part.descriptor) !== json(entry.descriptor) || json(part.checkpoint) !== json(entry.checkpoint) || !Array.isArray(part.events)) fail('SEGMENT_MANIFEST', 'A segment differs from the retained manifest.');
      const d = entry.descriptor;
      if (d.schema !== 'wolf-evidence-segment/v2' || d.index !== index || d.start !== sequence + 1 || d.size !== part.events.length || d.size > MAX_SEGMENT_EVENTS || d.size < (manifest.segments.length === 1 ? 0 : 1) || d.previousRoot !== previousRoot || Buffer.byteLength(json(part)) > MAX_SEGMENT_BYTES + 131072) fail('SEGMENT_BOUND', 'A segment is out of order or exceeds its bound.');
      for (const event of part.events) {
        validSignature(nostr, event, manifest.pubkey, 'EVENT_SIGNATURE'); const b = JSON.parse(event.content);
        if (seen.has(event.id) || b.schema !== 'wolf-evidence/v1' || b.sequence !== sequence + 1 || b.previous !== previous || !Array.isArray(b.parents) || b.parents.some(id => !seen.has(id))) fail('EVENT_CHAIN', 'The global causal evidence chain is broken.');
        if (!Number.isSafeInteger(b.observedAt) || Math.floor(b.observedAt / 1000) !== event.created_at || typeof b.kind !== 'string') fail('EVENT_FIELDS', 'Invalid evidence fields.');
        seen.add(event.id); previous = event.id; options.onVerifiedEvent?.(event); sequence++;
        if (expected && sequence <= expected.size && expected.size <= 4096) prefixEvents.push(event);
      }
      const actual = segmentDescriptor(index, d.start, part.events, previousRoot, merkle);
      if (json(actual) !== json(d)) fail('SEGMENT_ROOT', 'A segment commitment does not match its exact event bytes.');
      if (expected && expected.size >= d.start && expected.size <= sequence) retainedRoot = segmentCommitment(segmentDescriptor(index, d.start, part.events.slice(0, expected.size - d.start + 1), previousRoot, merkle));
      previousRoot = segmentCommitment(d);
      validSignature(nostr, entry.checkpoint, manifest.pubkey, 'CHECKPOINT_SIGNATURE');
      const h = JSON.parse(entry.checkpoint.content);
      if (h.schema !== 'wolf-checkpoint/v2' || h.size !== sequence || h.last !== previous || h.root !== previousRoot || json(h.segment) !== json(d)) fail('CHECKPOINT_MISMATCH', 'A segment checkpoint does not match its global event prefix.');
      index++;
    }
    if (index !== manifest.segments.length || json(manifest.checkpoint) !== json(manifest.segments.at(-1).checkpoint)) fail('ARCHIVE_INCOMPLETE', 'The complete retained archive and final checkpoint are required.');
    if (expected && (expected.size > sequence || retainedRoot !== expected.root && !(expected.size <= 4096 && (!expected.schema || expected.schema === 'wolf-checkpoint/v1') && merkle(prefixEvents.map(e => e.id)) === expected.root))) fail('RETAINED_HEAD_MISMATCH', 'The independently retained prefix is missing.');
    return result(manifest.pubkey, manifest.checkpoint, sequence, options);
  } catch (error) { return caught(error); }
}
