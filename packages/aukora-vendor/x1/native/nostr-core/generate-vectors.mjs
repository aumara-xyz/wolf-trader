#!/usr/bin/env node
/**
 * Write `tests/vectors/nostr-core-v1.json`, the ABI v1 parity vectors the
 * shared builder replays against the nostr-core cell.
 *
 * Expected values come from published files, never from the cell:
 * - BIP-340: `tests/vectors/bip340-test-vectors.csv` (bitcoin/bips
 *   bip-0340/test-vectors.csv, sha256 34c9d1d9…1c2d);
 * - NIP-01 and NIP-19: `tests/vectors/nostr-prime-vectors.json` (aukora-prime
 *   plugins/aukora-nostr/lib, sha256 992bb5c3…4005) and the two NIP-19
 *   examples of nostr-protocol/nips `19.md`;
 * - NIP-59 and NIP-17: the Prime rumor, seal and gift wrap (a cross-implementation
 *   wrap made by aukora-prime's JS library) in `nostr-prime-vectors.json`, opened
 *   with its published fixture keys. Wraps this cell makes are not published
 *   anywhere, so their round trips run in tests/aukora-nostr.spec.ts.
 * - NIP-44 v2: `tests/vectors/nip44.vectors.json`, the official file (sha256
 *   269ed0f6…5040, the checksum NIP-44 publishes). Its 65,535-byte and
 *   oversize cases run in tests/aukora-nostr.spec.ts instead, to keep this
 *   file small. The public key of an `encrypt_decrypt` secret is derived with
 *   OpenSSL (`node:crypto` ECDH), an implementation independent of the cell.
 * The refusal cases are the cell's carried rules (source refusal codes from
 * aukora-wasm af58c0d crates/nostr). `--check` regenerates in memory and fails
 * when the committed file differs.
 */
import { createECDH } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const vectors = join(packageRoot, 'tests', 'vectors')
const out = join(vectors, 'nostr-core-v1.json')
const rows = readFileSync(join(vectors, 'bip340-test-vectors.csv'), 'utf8').trim().split('\n').slice(1).map(row => row.split(','))
const prime = JSON.parse(readFileSync(join(vectors, 'nostr-prime-vectors.json'), 'utf8'))
const nip44 = JSON.parse(readFileSync(join(vectors, 'nip44.vectors.json'), 'utf8')).v2

/** NIP-19 `19.md` "Examples" (nostr-protocol/nips). */
export const NIP19_EXAMPLES = {
  npub: { npub: 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg', hex: '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e' },
  nsec: { nsec: 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5', hex: '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa' },
}
const ORDER = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
/** BIP-340 vector 5: a public key not on the curve. */
const OFF_CURVE = rows[5][2].toLowerCase()

const cases = [{ name: 'ping', op: 'nostr.ping', input: {}, expect: { pong: true, version: 1 } }]
const add = (name, op, input, outcome) => cases.push({ name, op, input, ...outcome })

// --- BIP-340 keys --------------------------------------------------------------------------
for (const [index, secret, pubkey, , , , , comment = ''] of rows) {
  if (secret !== '') add(`bip340-${index}-public-key`, 'nostr.public_key', { secret: secret.toLowerCase() }, { expect: { pubkey: pubkey.toLowerCase() } })
  add(`bip340-${index}-key-valid`, 'nostr.key_valid', { pubkey: pubkey.toLowerCase() }, { expect: { valid: !comment.startsWith('public key ') } })
}
add('secret-zero', 'nostr.public_key', { secret: '00'.repeat(32) }, { refused: 'nostr:secret-invalid' })
add('secret-order', 'nostr.public_key', { secret: ORDER }, { refused: 'nostr:secret-invalid' })
add('secret-uppercase', 'nostr.public_key', { secret: 'AB'.repeat(32) }, { refused: 'INVALID_INPUT' })

// --- NIP-01 events -------------------------------------------------------------------------
const { id, sig, ...unsigned } = prime.event
add('prime-event-id', 'nostr.event_id', { event: unsigned }, { expect: { id, preimage: prime.serialized_event } })
add('prime-event-verify', 'nostr.event_verify', { event: prime.event }, { expect: { valid: true } })
for (const layer of ['seal', 'wrap']) add(`prime-${layer}-verify`, 'nostr.event_verify', { event: prime[layer] }, { expect: { valid: true } })
const flip = text => text.replace(/^./u, c => (c === '0' ? '1' : '0'))
const bad = (name, event, reason) => add(`verify-${name}`, 'nostr.event_verify', { event }, { expect: { reason, valid: false } })
bad('content-changed', { ...prime.event, content: `${prime.event.content}!` }, 'nostr:event-id-mismatch')
bad('sig-flipped', { ...prime.event, sig: flip(prime.event.sig) }, 'nostr:event-signature-invalid')
bad('id-uppercase', { ...prime.event, id: prime.event.id.toUpperCase() }, 'nostr:event-hex-invalid')
bad('sig-short', { ...prime.event, sig: prime.event.sig.slice(2) }, 'nostr:event-hex-invalid')
bad('pubkey-off-curve', { ...prime.event, pubkey: OFF_CURVE }, 'nostr:public-key-invalid')
bad('extra-key', { ...prime.event, extra: 1 }, 'nostr:event-malformed')
bad('missing-sig', unsigned, 'nostr:event-malformed')
bad('kind-65536', { ...prime.event, kind: 65_536 }, 'nostr:event-malformed')
bad('created-at-negative', { ...prime.event, created_at: -1 }, 'nostr:event-malformed')
bad('kind-string', { ...prime.event, kind: '1' }, 'nostr:event-malformed')
bad('tag-empty', { ...prime.event, tags: [[]] }, 'nostr:event-malformed')
bad('tag-number', { ...prime.event, tags: [['p', 1]] }, 'nostr:event-malformed')
bad('257-tags', { ...prime.event, tags: Array.from({ length: 257 }, () => ['t']) }, 'nostr:event-malformed')
bad('33-tag-fields', { ...prime.event, tags: [Array.from({ length: 33 }, () => 'x')] }, 'nostr:event-malformed')
bad('bell-in-content', { ...prime.event, content: 'bell\u0007' }, 'nostr:event-control-character')
bad('nul-in-tag', { ...prime.event, tags: [['t', 'a\u0000']] }, 'nostr:event-control-character')
bad('not-an-object', [prime.event], 'nostr:event-malformed')
add('event-id-off-curve', 'nostr.event_id', { event: { ...unsigned, pubkey: OFF_CURVE } }, { refused: 'nostr:public-key-invalid' })
add('event-id-control', 'nostr.event_id', { event: { ...unsigned, content: '\u001b[31m' } }, { refused: 'nostr:event-control-character' })
add('event-id-signed-shape', 'nostr.event_id', { event: prime.event }, { refused: 'nostr:event-malformed' })
add('event-sign-secret-zero', 'nostr.event_sign', { aux: '00'.repeat(32), event: { content: '', created_at: 0, kind: 1, tags: [] }, secret: '00'.repeat(32) }, { refused: 'nostr:secret-invalid' })
add('event-sign-pubkey-in-draft', 'nostr.event_sign', { aux: '00'.repeat(32), event: unsigned, secret: prime.sender_secret_fixture }, { refused: 'nostr:event-malformed' })

// --- NIP-19 --------------------------------------------------------------------------------
for (const [index, entry] of prime.public_keys.entries()) {
  add(`prime-npub-${String(index)}-encode`, 'nostr.npub_encode', { pubkey: entry.pubkey }, { expect: { npub: entry.npub } })
  add(`prime-npub-${String(index)}-decode`, 'nostr.npub_decode', { npub: entry.npub }, { expect: { pubkey: entry.pubkey } })
}
add('nip19-npub-encode', 'nostr.npub_encode', { pubkey: NIP19_EXAMPLES.npub.hex }, { expect: { npub: NIP19_EXAMPLES.npub.npub } })
add('nip19-npub-decode', 'nostr.npub_decode', { npub: NIP19_EXAMPLES.npub.npub }, { expect: { pubkey: NIP19_EXAMPLES.npub.hex } })
add('nip19-nsec-encode', 'nostr.nsec_encode', { secret: NIP19_EXAMPLES.nsec.hex }, { expect: { nsec: NIP19_EXAMPLES.nsec.nsec } })
add('nip19-nsec-decode', 'nostr.nsec_decode', { nsec: NIP19_EXAMPLES.nsec.nsec }, { expect: { secret: NIP19_EXAMPLES.nsec.hex } })
const npub = NIP19_EXAMPLES.npub.npub
add('npub-uppercase', 'nostr.npub_decode', { npub: npub.toUpperCase() }, { refused: 'nostr:npub-invalid' })
add('npub-bad-checksum', 'nostr.npub_decode', { npub: `${npub.slice(0, -1)}${npub.endsWith('q') ? 'p' : 'q'}` }, { refused: 'nostr:npub-invalid' })
add('npub-given-nsec', 'nostr.npub_decode', { npub: NIP19_EXAMPLES.nsec.nsec }, { refused: 'nostr:npub-invalid' })
add('nsec-given-npub', 'nostr.nsec_decode', { nsec: npub }, { refused: 'nostr:nsec-invalid' })
add('npub-too-long', 'nostr.npub_decode', { npub: `npub1${'q'.repeat(124)}` }, { refused: 'nostr:npub-invalid' })
add('npub-encode-off-curve', 'nostr.npub_encode', { pubkey: OFF_CURVE }, { refused: 'nostr:public-key-invalid' })
add('nsec-encode-zero', 'nostr.nsec_encode', { secret: '00'.repeat(32) }, { refused: 'nostr:secret-invalid' })

// --- NIP-44 v2 ----------------------------------------------------------------------------
/** x-only public key of a secret, by OpenSSL. */
const xOnly = secret => {
  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(Buffer.from(secret, 'hex'))
  return ecdh.getPublicKey('hex', 'compressed').slice(2)
}
/** The carried refusal for each official "must fail" decrypt case, by its note. */
export const DECRYPT_REFUSALS = [
  [/^unknown encryption version/u, 'nip44:unsupported-version'],
  [/^invalid base64/u, 'nip44:base64-invalid'],
  [/^invalid MAC/u, 'nip44:mac-invalid'],
  [/^invalid padding/u, 'nip44:padding-invalid'],
  [/^invalid payload length/u, 'nip44:payload-length'],
]
export const decryptRefusal = note => DECRYPT_REFUSALS.find(([pattern]) => pattern.test(note))?.[1]
for (const [index, item] of nip44.valid.get_conversation_key.entries()) {
  add(`nip44-conversation-key-${String(index)}`, 'nostr.nip44_conversation_key', { pubkey: item.pub2, secret: item.sec1 }, { expect: { conversation_key: item.conversation_key } })
}
for (const [index, item] of nip44.invalid.get_conversation_key.entries()) {
  add(`nip44-conversation-key-invalid-${String(index)}`, 'nostr.nip44_conversation_key', { pubkey: item.pub2, secret: item.sec1 }, { refused: 'nip44:key-invalid' })
}
for (const [index, item] of nip44.valid.get_message_keys.keys.entries()) {
  add(`nip44-message-keys-${String(index)}`, 'nostr.nip44_message_keys', { conversation_key: nip44.valid.get_message_keys.conversation_key, nonce: item.nonce }, {
    expect: { chacha_key: item.chacha_key, chacha_nonce: item.chacha_nonce, hmac_key: item.hmac_key },
  })
}
for (const [unpadded, padded] of nip44.valid.calc_padded_len) {
  add(`nip44-padded-len-${String(unpadded)}`, 'nostr.nip44_padded_len', { length: unpadded }, { expect: { padded } })
}
add('nip44-padded-len-0', 'nostr.nip44_padded_len', { length: 0 }, { refused: 'nip44:plaintext-length' })
add('nip44-padded-len-65537', 'nostr.nip44_padded_len', { length: 65_537 }, { refused: 'nip44:plaintext-length' })
for (const [index, item] of nip44.valid.encrypt_decrypt.entries()) {
  const name = `nip44-encrypt-decrypt-${String(index)}`
  add(`${name}-encrypt`, 'nostr.nip44_encrypt', { conversation_key: item.conversation_key, nonce: item.nonce, plaintext: item.plaintext }, { expect: { payload: item.payload } })
  add(`${name}-decrypt`, 'nostr.nip44_decrypt', { conversation_key: item.conversation_key, payload: item.payload }, { expect: { plaintext: item.plaintext } })
  add(`${name}-encrypt-by-keys`, 'nostr.nip44_encrypt', { nonce: item.nonce, plaintext: item.plaintext, pubkey: xOnly(item.sec2), secret: item.sec1 }, { expect: { payload: item.payload } })
  add(`${name}-decrypt-by-keys`, 'nostr.nip44_decrypt', { payload: item.payload, pubkey: xOnly(item.sec1), secret: item.sec2 }, { expect: { plaintext: item.plaintext } })
}
for (const [index, item] of nip44.invalid.decrypt.entries()) {
  add(`nip44-decrypt-invalid-${String(index)}`, 'nostr.nip44_decrypt', { conversation_key: item.conversation_key, payload: item.payload }, { refused: decryptRefusal(item.note) })
}
add('nip44-encrypt-empty', 'nostr.nip44_encrypt', { conversation_key: nip44.valid.encrypt_decrypt[0].conversation_key, nonce: '00'.repeat(32), plaintext: '' }, { refused: 'nip44:plaintext-length' })
add('prime-nip44-conversation-key', 'nostr.nip44_conversation_key', { pubkey: prime.public_keys[1].pubkey, secret: prime.sender_secret_fixture }, { expect: { conversation_key: prime.nip44.conversation_key } })
add('prime-nip44-encrypt', 'nostr.nip44_encrypt', { conversation_key: prime.nip44.conversation_key, nonce: prime.nip44.nonce, plaintext: prime.nip44.plaintext }, { expect: { payload: prime.nip44.payload } })
add('prime-nip44-decrypt', 'nostr.nip44_decrypt', { conversation_key: prime.nip44.conversation_key, payload: prime.nip44.payload }, { expect: { plaintext: prime.nip44.plaintext } })
add('nip44-both-key-forms', 'nostr.nip44_decrypt', { conversation_key: prime.nip44.conversation_key, payload: prime.nip44.payload, pubkey: prime.event.pubkey, secret: prime.sender_secret_fixture }, { refused: 'INVALID_INPUT' })

// --- NIP-59 and NIP-17 ---------------------------------------------------------------------
const RECIPIENT = prime.recipient_secret_fixture
const SENDER = prime.sender_secret_fixture
const EPHEMERAL = prime.ephemeral_secret_fixture
const senderPub = prime.seal.pubkey
const recipientPub = prime.rumor.tags[0][1]
const opened = { rumor: prime.rumor, sender: senderPub }
const open = (name, op, extra, outcome) => add(name, op, { contacts: [senderPub], now: prime.rumor.created_at, secret: RECIPIENT, wrap: prime.wrap, ...extra }, outcome)
open('prime-unwrap', 'nostr.unwrap', {}, { expect: opened })
open('prime-dm-open', 'nostr.dm_open', {}, { expect: { ...opened, self_copy: false } })
open('prime-dm-open-later', 'nostr.dm_open', { now: prime.rumor.created_at + 86_400 }, { expect: { ...opened, self_copy: false } })
open('prime-stranger', 'nostr.dm_open', { contacts: [] }, { refused: 'nostr:stranger' })
open('prime-stranger-other-contact', 'nostr.unwrap', { contacts: [prime.public_keys[2].pubkey] }, { refused: 'nostr:stranger' })
open('prime-wrap-in-future', 'nostr.dm_open', { now: prime.wrap.created_at - 1 }, { refused: 'nostr:wrap-time-invalid' })
open('prime-seal-in-future', 'nostr.dm_open', { now: prime.seal.created_at - 1 }, { refused: 'nostr:seal-time-invalid' })
open('prime-rumor-in-future', 'nostr.dm_open', { now: prime.rumor.created_at - 1 }, { refused: 'nostr:rumor-time-invalid' })
open('prime-not-for-us', 'nostr.dm_open', { secret: EPHEMERAL }, { refused: 'nostr:wrap-not-for-us' })
open('prime-wrap-tampered', 'nostr.dm_open', { wrap: { ...prime.wrap, content: `${prime.wrap.content.slice(0, -4)}AAAA` } }, { refused: 'nostr:event-id-mismatch' })
open('prime-wrap-kind', 'nostr.unwrap', { wrap: prime.seal }, { refused: 'nostr:wrap-kind-invalid' })
open('prime-wrap-bad-shape', 'nostr.unwrap', { wrap: { ...prime.wrap, sig: undefined } }, { refused: 'nostr:event-malformed' })
open('unwrap-negative-now', 'nostr.unwrap', { now: -1 }, { refused: 'INVALID_INPUT' })
open('unwrap-bad-contact', 'nostr.unwrap', { contacts: ['npub'] }, { refused: 'INVALID_INPUT' })
const layer = (created_at, fill, secret) => ({ aux: '00'.repeat(32), created_at, nonce: fill.repeat(32), ...(secret === undefined ? {} : { secret }) })
const draft = { content: prime.rumor.content, created_at: prime.rumor.created_at, kind: 14, tags: prime.rumor.tags }
const wrapInput = (extra = {}) => ({ recipient: recipientPub, rumor: draft, seal: layer(prime.seal.created_at, '2c'), secret: SENDER, wrap: layer(prime.wrap.created_at, '33', EPHEMERAL), ...extra })
add('gift-wrap-seal-after-rumor', 'nostr.gift_wrap', wrapInput({ seal: layer(prime.rumor.created_at + 1, '2c') }), { refused: 'nostr:seal-time-invalid' })
add('gift-wrap-wrap-too-old', 'nostr.gift_wrap', wrapInput({ wrap: layer(prime.rumor.created_at - 172_801, '33', EPHEMERAL) }), { refused: 'nostr:wrap-time-invalid' })
add('gift-wrap-ephemeral-is-sender', 'nostr.gift_wrap', wrapInput({ wrap: layer(prime.wrap.created_at, '33', SENDER) }), { refused: 'nostr:ephemeral-key-collision' })
add('gift-wrap-ephemeral-zero', 'nostr.gift_wrap', wrapInput({ wrap: layer(prime.wrap.created_at, '33', '00'.repeat(32)) }), { refused: 'nostr:ephemeral-invalid' })
add('gift-wrap-recipient-off-curve', 'nostr.gift_wrap', wrapInput({ recipient: OFF_CURVE }), { refused: 'nostr:public-key-invalid' })
add('gift-wrap-no-one-time-key', 'nostr.gift_wrap', wrapInput({ wrap: layer(prime.wrap.created_at, '33') }), { refused: 'INVALID_INPUT' })
const dm = (extra = {}, message = {}) => ({ message: { content: draft.content, created_at: draft.created_at, tags: [], to: [recipientPub], ...message }, recipient: recipientPub, seal: layer(prime.seal.created_at, '2c'), secret: SENDER, wrap: layer(prime.wrap.created_at, '33', EPHEMERAL), ...extra })
add('dm-seal-third-party', 'nostr.dm_seal', dm({ recipient: prime.public_keys[2].pubkey }), { refused: 'nostr:recipient-mismatch' })
add('dm-seal-p-in-extra-tags', 'nostr.dm_seal', dm({}, { tags: [['p', recipientPub]] }), { refused: 'INVALID_INPUT' })
add('dm-seal-nobody', 'nostr.dm_seal', dm({}, { to: [] }), { refused: 'INVALID_INPUT' })
add('dm-seal-to-off-curve', 'nostr.dm_seal', dm({}, { to: [OFF_CURVE] }), { refused: 'nostr:public-key-invalid' })

// --- Envelope ------------------------------------------------------------------------------
add('ping-with-input', 'nostr.ping', { x: 1 }, { refused: 'MALFORMED' })
add('unknown-op', 'nostr.event_publish', {}, { refused: 'UNKNOWN_OP' })
add('key-valid-extra-key', 'nostr.key_valid', { pubkey: prime.event.pubkey, x: 1 }, { refused: 'INVALID_INPUT' })
add('key-valid-short', 'nostr.key_valid', { pubkey: 'ab' }, { refused: 'INVALID_INPUT' })

const text = `${[
  `{"schema":1,"cell":"nostr-core","sources":${JSON.stringify({
    bip340: 'tests/vectors/bip340-test-vectors.csv (bitcoin/bips bip-0340/test-vectors.csv; sha256 34c9d1d9c3a88d524bc80778540dc43f8306ec249a7485293063c376db851c2d)',
    prime: 'tests/vectors/nostr-prime-vectors.json (aukora-prime plugins/aukora-nostr/lib; sha256 992bb5c3d714c3dfd33667ab27359235ae8632d6189b3c0f77eda466d5854005)',
    nip19: 'nostr-protocol/nips 19.md Examples (npub10elfcs4f…, nsec1vl029mgp…)',
    nip44: 'tests/vectors/nip44.vectors.json (official NIP-44 v2 vectors; sha256 269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040)',
  })},"cases":[`,
  cases.map(item => JSON.stringify(item)).join(',\n'),
].join('\n')}\n]}\n`

const main = process.argv[1] === fileURLToPath(import.meta.url)
if (main && process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) throw new Error('nostr-core-v1.json differs from its sources; run generate-vectors.mjs')
  console.log(`nostr-core vectors: ${String(cases.length)} cases match their sources`)
} else if (main) {
  writeFileSync(out, text)
  console.log(`nostr-core vectors: wrote ${String(cases.length)} cases`)
}
