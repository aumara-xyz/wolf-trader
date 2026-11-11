/**
 * Typed Host adapter for the pinned nostr-core Microverse ABI v1 cell: the
 * organism's Nostr spine (NIP-01 events, NIP-19 identities, NIP-44 v2
 * encryption, NIP-59 gift wrap, NIP-17 private direct messages).
 *
 * The cell decides and computes everything (serialization, ids, BIP-340,
 * bech32). This adapter only moves bytes: it checks the module pin, sets fuel
 * before every exported call, encodes canonical requests and reads results.
 * It also supplies what the cell may not create itself: fresh randomness
 * from `node:crypto` (BIP-340 `aux`, NIP-44 nonces, the one-time wrap key,
 * the seal and wrap times sampled up to two days back). Strangers are
 * refused by the cell before a message is opened. A signed event proves who wrote it,
 * never that it is permitted; nothing here grants authority.
 *
 * Secret keys are 32-byte `Uint8Array`s passed only for the one call that
 * needs them. They are written as hex straight into the request bytes (never
 * a JavaScript string), the request bytes are zeroed after the call, and the
 * call runs on a fresh instance whose whole linear memory is zero-filled and
 * dropped. Nothing here stores or logs a secret.
 */

import { randomBytes } from 'node:crypto'
import { admitCellModule } from '../scripts/aukora-cell-admission.mjs'
import { readFileSync } from 'node:fs'
import {
  AukoraKernelRefusal,
  encodeAukoraRequest,
  parseAukoraResponse,
  type AukoraJson,
} from './aukora-canonical.ts'

export { AukoraKernelRefusal as NostrRefusal } from './aukora-canonical.ts'

/** Pinned Microverse ABI v1 nostr-core cell. */
export const NOSTR_CORE_MODULE = {
  name: 'nostr-core',
  version: 1,
  abi: 1,
  file: 'nostr-core.wasm',
  /** Metered bytes the Host loads; updated only through native/nostr-core/build.mjs. */
  sha256: '1b00e08461e6c2e9a99e5d32a93389d633aeb776a5d3e4a3e2b173cd6ce82530',
  /** Export-stripped cargo output before the meter transform. */
  sourceSha256: 'ff2f7111e7a17eb54852aabd386287d32da5981dfc76c02b6304db661264f5e2',
  /** `tools/meter/meter.mjs` (mv-meter v1) at aukora-microverse e898ca86. */
  meterSha256: '0c8fcc36550a6c379317780f3f063cdbb04ce514fd64a43dc3a9a8781dfd2714',
  /** Fuel granted before every exported call; see the README for measured costs. */
  fuel: 400_000_000,
  /** Hard ceiling for the module before it is read at all. */
  maxBytes: 2 * 1024 * 1024,
} as const

const MAX_REQUEST_BYTES = 1_048_576
const MAX_RESPONSE_BYTES = 1_048_576
const MIN_BUFFER_OFFSET = 64
const HEX64 = /^[0-9a-f]{64}$/u
const HEX128 = /^[0-9a-f]{128}$/u
const DIGITS = new TextEncoder().encode('0123456789abcdef')

/** The fields an author chooses; the signer adds `pubkey`, `id` and `sig`. */
export interface NostrDraft {
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
}

/** An unsigned NIP-01 event. */
export interface NostrUnsigned extends NostrDraft {
  readonly pubkey: string
}

/** A signed NIP-01 event: evidence of who wrote it, never permission. */
export interface NostrEvent extends NostrUnsigned {
  readonly id: string
  readonly sig: string
}

/** The cell's judgement of one event; `reason` is a `nostr:*` code. */
export type NostrVerdict = { readonly valid: true } | { readonly valid: false; readonly reason: string }

/** A NIP-44 key: a conversation key, or one side's secret key and the other side's x-only key. */
export type Nip44Key =
  | { readonly conversationKey: Uint8Array }
  | { readonly secretKey: Uint8Array; readonly pubkey: string }

/** NIP-44 v2 per-message keys (HKDF-SHA256 expand of the nonce). */
export interface Nip44MessageKeys {
  readonly chachaKey: Uint8Array
  readonly chachaNonce: Uint8Array
  readonly hmacKey: Uint8Array
}

/** An unsigned event with its id: a NIP-59 rumor. Its id is not authentication. */
export interface NostrRumor extends NostrUnsigned {
  readonly id: string
}

/**
 * Randomness and times for one gift wrap; every field defaults to fresh
 * `node:crypto` bytes, and the times to the rumor's time minus a uniform
 * 0..172,800 s. Tests pass fixed values; production passes nothing.
 */
export interface WrapRandomness {
  readonly sealCreatedAt?: number
  readonly wrapCreatedAt?: number
  readonly sealNonce?: Uint8Array
  readonly wrapNonce?: Uint8Array
  readonly sealAux?: Uint8Array
  readonly wrapAux?: Uint8Array
  /** The one-time key that signs the outer wrap. */
  readonly wrapSecretKey?: Uint8Array
}

/** A sealed and wrapped rumor; publish only `wrap`. */
export interface NostrSealed {
  readonly rumor: NostrRumor
  readonly wrap: NostrEvent
}

/** Who sealed a wrap (authenticated by the seal's signature) and what it said. */
export interface NostrOpened {
  readonly sender: string
  readonly rumor: NostrRumor
}

/** A NIP-17 message; `selfCopy` when it is the sender's own copy. */
export interface NostrOpenedMessage extends NostrOpened {
  readonly selfCopy: boolean
}

/** A NIP-17 private direct message before sealing (kind 14; `to` become its `p` tags). */
export interface NostrDirectMessage {
  readonly to: string | readonly string[]
  readonly content: string
  readonly created_at: number
  /** Extra tags such as `subject` or an `e` reply; never `p`. */
  readonly tags?: readonly (readonly string[])[]
}

/** Who may reach this recipient, and the Host's clock for the time checks. */
export interface NostrInboxGate {
  /** x-only keys of approved contacts; the recipient's own key is always admitted. */
  readonly contacts: readonly string[]
  /** Unix seconds now. */
  readonly now: number
}

/** A local adapter, transport or trap failure; cell refusals throw `NostrRefusal`. */
export class NostrCellError extends Error {
  readonly code: string

  constructor(code: string, detail?: string) {
    super(`nostr-core failed: ${code}${detail === undefined ? '' : ` (${detail})`}`)
    this.name = 'NostrCellError'
    this.code = code
  }
}

interface NostrExports {
  readonly memory: WebAssembly.Memory
  readonly mv_abi_version: () => number
  readonly mv_alloc: (length: number) => number
  readonly mv_run: (pointer: number, length: number) => bigint
  readonly __mv_fuel_set: (fuel: bigint) => void
  readonly __mv_fuel_remaining: () => bigint
}

/** Secret bytes in a request tree; written as hex into the request bytes only. */
class SecretField {
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
}

type RequestValue = AukoraJson | SecretField | { readonly [key: string]: RequestValue } | readonly RequestValue[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'hex'))
}

function needBytes(value: Uint8Array, length: number, label: string): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new NostrCellError('INPUT', `${label} must be ${String(length)} bytes`)
}

/**
 * Canonical request bytes. Each secret becomes a fresh random 64-hex marker
 * while encoding, then its hex digits overwrite the marker in the bytes, so
 * the secret never exists as a string. The caller zeroes the result.
 */
function requestBytes(seq: number, op: string, input: Record<string, RequestValue>): Uint8Array {
  const secrets: { marker: string; bytes: Uint8Array }[] = []
  const swap = (value: RequestValue): AukoraJson => {
    if (value instanceof SecretField) {
      const marker = randomBytes(value.bytes.byteLength).toString('hex')
      secrets.push({ marker, bytes: value.bytes })
      return marker
    }
    if (Array.isArray(value)) return value.map(item => swap(item as RequestValue))
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item as RequestValue)]))
    return value as AukoraJson
  }
  let text: string
  try {
    text = encodeAukoraRequest(seq, op, swap(input))
  } catch (cause) {
    throw new NostrCellError('UNREPRESENTABLE', cause instanceof Error ? cause.message : String(cause))
  }
  const bytes = Buffer.from(text, 'utf8')
  for (const { marker, bytes: secret } of secrets) {
    const quoted = Buffer.from(`"${marker}"`, 'latin1')
    const at = bytes.indexOf(quoted)
    if (at < 0 || bytes.indexOf(quoted, at + 1) >= 0) throw new NostrCellError('SECRET_MARKER')
    let offset = at + 1
    for (const byte of secret) {
      bytes[offset++] = DIGITS[byte >> 4]!
      bytes[offset++] = DIGITS[byte & 15]!
    }
  }
  return bytes
}

function stringField(result: AukoraJson, key: string, op: string): string {
  const value = isRecord(result) ? result[key] : undefined
  if (typeof value !== 'string') throw new NostrCellError('MALFORMED_RESULT', op)
  return value
}

function eventOf(value: unknown, op: string): NostrEvent {
  if (!isRecord(value)) throw new NostrCellError('MALFORMED_RESULT', op)
  const { id, pubkey, created_at: createdAt, kind, tags, content, sig } = value
  if (typeof id !== 'string' || !HEX64.test(id) || typeof pubkey !== 'string' || !HEX64.test(pubkey)
    || typeof sig !== 'string' || !HEX128.test(sig) || typeof content !== 'string'
    || !Number.isSafeInteger(createdAt) || !Number.isSafeInteger(kind)
    || !Array.isArray(tags) || !tags.every(tag => Array.isArray(tag) && tag.every(cell => typeof cell === 'string'))) {
    throw new NostrCellError('MALFORMED_RESULT', op)
  }
  return { id, pubkey, created_at: createdAt as number, kind: kind as number, tags: tags as string[][], content, sig }
}

function nip44KeyFields(key: Nip44Key): Record<string, RequestValue> {
  if ('conversationKey' in key) {
    needBytes(key.conversationKey, 32, 'conversation key')
    return { conversation_key: new SecretField(key.conversationKey) }
  }
  needBytes(key.secretKey, 32, 'secret key')
  return { pubkey: key.pubkey, secret: new SecretField(key.secretKey) }
}

const JITTER_SECONDS = 172_800

/** `base` minus a uniform 0..min(base, 172,800) seconds, by rejection sampling (the source's `past_time`). */
function pastTime(base: number): number {
  const width = Math.min(base, JITTER_SECONDS) + 1
  const limit = 2 ** 32 - (2 ** 32 % width)
  for (;;) {
    const sample = randomBytes(4).readUInt32BE(0)
    if (sample < limit) return base - (sample % width)
  }
}

function rumorOf(value: unknown, op: string): NostrRumor {
  if (!isRecord(value) || typeof value.id !== 'string' || !HEX64.test(value.id)) throw new NostrCellError('MALFORMED_RESULT', op)
  const { sig: _sig, ...event } = eventOf({ ...value, sig: '0'.repeat(128) }, op)
  return event
}

function openedOf(result: AukoraJson, op: string): NostrOpened {
  if (!isRecord(result) || typeof result.sender !== 'string' || !HEX64.test(result.sender)) throw new NostrCellError('MALFORMED_RESULT', op)
  return { sender: result.sender, rumor: rumorOf(result.rumor, op) }
}

function sealedOf(result: AukoraJson, op: string): NostrSealed {
  if (!isRecord(result)) throw new NostrCellError('MALFORMED_RESULT', op)
  return { rumor: rumorOf(result.rumor, op), wrap: eventOf(result.wrap, op) }
}

function draftJson(draft: NostrDraft): Record<string, AukoraJson> {
  return { created_at: draft.created_at, kind: draft.kind, tags: draft.tags.map(tag => [...tag]), content: draft.content }
}

/**
 * Verify and instantiate the pinned nostr-core cell.
 * @param bytes - optional test bytes; defaults to the packaged asset.
 * @param fuel - optional test grant; defaults to the pinned grant.
 */
export function loadNostrCore(bytes?: Uint8Array, fuel?: number): NostrCore {
  return new NostrCore(bytes ?? readFileSync(new URL('../assets/nostr-core.wasm', import.meta.url)), fuel)
}

let shared: NostrCore | undefined

/** One lazily loaded cell for the whole process (calls are serialized by the JS thread). */
export function nostrCore(): NostrCore {
  shared ??= loadNostrCore()
  return shared
}

/** One pinned nostr-core module; calls are serialized by the JS thread. */
export class NostrCore {
  private readonly module: WebAssembly.Module
  private readonly fuel: bigint
  private exports: NostrExports | undefined
  private seq = 0
  /** Fuel the last completed call consumed. */
  lastFuelUsed = 0n

  constructor(bytes: Uint8Array, fuel: number = NOSTR_CORE_MODULE.fuel) {
    if (!Number.isSafeInteger(fuel) || fuel <= 0) throw new NostrCellError('FUEL_GRANT')
    this.fuel = BigInt(fuel)
    this.module = admitCellModule(NOSTR_CORE_MODULE, bytes, (code, detail) => new NostrCellError(code, detail)).module
    this.exports = this.instance()
  }

  // --- Identity ------------------------------------------------------------------------

  /** Liveness check. */
  ping(): boolean {
    const result = this.invoke('nostr.ping', {}, false)
    return isRecord(result) && result.pong === true
  }

  /** x-only public key of a secret; refuses `nostr:secret-invalid`. */
  publicKey(secretKey: Uint8Array): string {
    needBytes(secretKey, 32, 'secret key')
    return stringField(this.invoke('nostr.public_key', { secret: new SecretField(secretKey) }, true), 'pubkey', 'public_key')
  }

  /** Whether a 64-hex string is a valid BIP-340 x-only key. */
  validKey(pubkey: string): boolean {
    if (!HEX64.test(pubkey)) return false
    const result = this.invoke('nostr.key_valid', { pubkey }, false)
    return isRecord(result) && result.valid === true
  }

  /** NIP-19 `npub` of a valid x-only key. */
  npubEncode(pubkey: string): string {
    return stringField(this.invoke('nostr.npub_encode', { pubkey }, false), 'npub', 'npub_encode')
  }

  /** x-only key of an `npub`; refuses `nostr:npub-invalid`. */
  npubDecode(npub: string): string {
    return stringField(this.invoke('nostr.npub_decode', { npub }, false), 'pubkey', 'npub_decode')
  }

  /** NIP-19 `nsec` of a secret key (the string is secret material; the caller owns it). */
  nsecEncode(secretKey: Uint8Array): string {
    needBytes(secretKey, 32, 'secret key')
    return stringField(this.invoke('nostr.nsec_encode', { secret: new SecretField(secretKey) }, true), 'nsec', 'nsec_encode')
  }

  /** Secret key bytes of an `nsec`; refuses `nostr:nsec-invalid`. The caller zeroes them. */
  nsecDecode(nsec: string): Uint8Array {
    return bytesOf(stringField(this.invoke('nostr.nsec_decode', { nsec }, true), 'secret', 'nsec_decode'))
  }

  // --- NIP-01 events -------------------------------------------------------------------

  /** NIP-01 id (SHA-256 of the canonical serialization) of an unsigned event. */
  eventId(unsigned: NostrUnsigned): string {
    return stringField(this.invoke('nostr.event_id', { event: { ...draftJson(unsigned), pubkey: unsigned.pubkey } }, false), 'id', 'event_id')
  }

  /** The canonical NIP-01 serialization `[0,pubkey,created_at,kind,tags,content]`. */
  eventPreimage(unsigned: NostrUnsigned): string {
    return stringField(this.invoke('nostr.event_id', { event: { ...draftJson(unsigned), pubkey: unsigned.pubkey } }, false), 'preimage', 'event_id')
  }

  /**
   * Sign a draft with a secret key passed for this call only.
   * @param aux - 32 bytes of BIP-340 auxiliary randomness; fresh by default.
   */
  signEvent(unsigned: NostrDraft, secretKey: Uint8Array, aux: Uint8Array = randomBytes(32)): NostrEvent {
    needBytes(secretKey, 32, 'secret key')
    needBytes(aux, 32, 'aux')
    const result = this.invoke('nostr.event_sign', { aux: hexOf(aux), event: draftJson(unsigned), secret: new SecretField(secretKey) }, true)
    return eventOf(isRecord(result) ? result.event : undefined, 'event_sign')
  }

  /** Shape, bounds, id and BIP-340 signature of any value; never throws for a bad event. */
  verifyEvent(event: unknown): NostrVerdict {
    let result: AukoraJson
    try {
      result = this.invoke('nostr.event_verify', { event: event as AukoraJson }, false)
    } catch (cause) {
      // Floats, lone surrogates and other non-JSON values cannot be NIP-01 events.
      if (cause instanceof NostrCellError && cause.code === 'UNREPRESENTABLE') return { valid: false, reason: 'nostr:event-malformed' }
      throw cause
    }
    if (isRecord(result) && result.valid === true) return { valid: true }
    if (isRecord(result) && result.valid === false && typeof result.reason === 'string') return { valid: false, reason: result.reason }
    throw new NostrCellError('MALFORMED_RESULT', 'event_verify')
  }

  // --- NIP-44 v2 ----------------------------------------------------------------------

  /** HKDF-SHA256 extract (salt `nip44-v2`) of the ECDH x-coordinate. Secret: the caller zeroes it. */
  nip44ConversationKey(secretKey: Uint8Array, pubkey: string): Uint8Array {
    needBytes(secretKey, 32, 'secret key')
    return bytesOf(stringField(this.invoke('nostr.nip44_conversation_key', { pubkey, secret: new SecretField(secretKey) }, true), 'conversation_key', 'nip44_conversation_key'))
  }

  /** The per-message keys of one nonce (the official `get_message_keys` vectors). */
  nip44MessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): Nip44MessageKeys {
    needBytes(conversationKey, 32, 'conversation key')
    needBytes(nonce, 32, 'nonce')
    const result = this.invoke('nostr.nip44_message_keys', { conversation_key: new SecretField(conversationKey), nonce: hexOf(nonce) }, true)
    return {
      chachaKey: bytesOf(stringField(result, 'chacha_key', 'nip44_message_keys')),
      chachaNonce: bytesOf(stringField(result, 'chacha_nonce', 'nip44_message_keys')),
      hmacKey: bytesOf(stringField(result, 'hmac_key', 'nip44_message_keys')),
    }
  }

  /** Padded plaintext length; refuses `nip44:plaintext-length` outside 1..=65,536. */
  nip44PaddedLength(length: number): number {
    const result = this.invoke('nostr.nip44_padded_len', { length }, false)
    if (!isRecord(result) || !Number.isSafeInteger(result.padded)) throw new NostrCellError('MALFORMED_RESULT', 'nip44_padded_len')
    return result.padded as number
  }

  /**
   * NIP-44 v2 payload of 1..=65,535 UTF-8 bytes.
   * @param nonce - 32 random bytes; fresh from `node:crypto` by default.
   */
  nip44Encrypt(plaintext: string, key: Nip44Key, nonce: Uint8Array = randomBytes(32)): string {
    needBytes(nonce, 32, 'nonce')
    return stringField(this.invoke('nostr.nip44_encrypt', { ...nip44KeyFields(key), nonce: hexOf(nonce), plaintext }, true), 'payload', 'nip44_encrypt')
  }

  /** Plaintext of a NIP-44 v2 payload; the MAC is checked before anything is released. */
  nip44Decrypt(payload: string, key: Nip44Key): string {
    return stringField(this.invoke('nostr.nip44_decrypt', { ...nip44KeyFields(key), payload }, true), 'plaintext', 'nip44_decrypt')
  }

  // --- NIP-59 gift wrap and NIP-17 direct messages ----------------------------------------

  /**
   * NIP-59: seal `rumor` (any kind) for `recipient` with the sender's key, and
   * wrap the seal under a fresh one-time key. Publish only `wrap`.
   */
  giftWrap(rumor: NostrDraft, senderSecretKey: Uint8Array, recipient: string, randomness: WrapRandomness = {}): NostrSealed {
    needBytes(senderSecretKey, 32, 'secret key')
    return this.wrapCall('nostr.gift_wrap', { recipient, rumor: draftJson(rumor) }, senderSecretKey, rumor.created_at, randomness)
  }

  /**
   * NIP-59: authenticate who sealed `wrap`, refuse a stranger (`nostr:stranger`)
   * before the rumor is opened, then check the times, the rumor id and its author.
   */
  unwrap(wrap: unknown, recipientSecretKey: Uint8Array, gate: NostrInboxGate): NostrOpened {
    needBytes(recipientSecretKey, 32, 'secret key')
    return openedOf(this.openCall('nostr.unwrap', wrap, recipientSecretKey, gate), 'unwrap')
  }

  /**
   * NIP-17: a kind 14 message to `message.to`, sealed and wrapped for
   * `recipient` (one of `to`, or the sender's own key for the self copy; call
   * once per copy).
   */
  dmSeal(message: NostrDirectMessage, senderSecretKey: Uint8Array, recipient: string, randomness: WrapRandomness = {}): NostrSealed {
    needBytes(senderSecretKey, 32, 'secret key')
    const to = typeof message.to === 'string' ? [message.to] : [...message.to]
    const body = { content: message.content, created_at: message.created_at, tags: (message.tags ?? []).map(tag => [...tag]), to }
    return this.wrapCall('nostr.dm_seal', { message: body, recipient }, senderSecretKey, message.created_at, randomness)
  }

  /** NIP-17: `unwrap` plus kind 14 and, unless it is our own copy, a `p` tag naming us. */
  dmOpen(wrap: unknown, recipientSecretKey: Uint8Array, gate: NostrInboxGate): NostrOpenedMessage {
    needBytes(recipientSecretKey, 32, 'secret key')
    const result = this.openCall('nostr.dm_open', wrap, recipientSecretKey, gate)
    if (!isRecord(result) || typeof result.self_copy !== 'boolean') throw new NostrCellError('MALFORMED_RESULT', 'dm_open')
    return { ...openedOf(result, 'dm_open'), selfCopy: result.self_copy }
  }

  private wrapCall(op: string, input: Record<string, RequestValue>, senderSecretKey: Uint8Array, base: number, randomness: WrapRandomness): NostrSealed {
    for (let attempt = 0; ; attempt += 1) {
      const given = randomness.wrapSecretKey
      const oneTime = given ?? randomBytes(32)
      try {
        const layer = (createdAt: number | undefined, nonce: Uint8Array | undefined, aux: Uint8Array | undefined): Record<string, RequestValue> => {
          const fields = { created_at: createdAt ?? pastTime(base), nonce: nonce ?? randomBytes(32), aux: aux ?? randomBytes(32) }
          needBytes(fields.nonce, 32, 'nonce')
          needBytes(fields.aux, 32, 'aux')
          return { aux: hexOf(fields.aux), created_at: fields.created_at, nonce: hexOf(fields.nonce) }
        }
        needBytes(oneTime, 32, 'one-time key')
        return sealedOf(this.invoke(op, {
          ...input,
          seal: layer(randomness.sealCreatedAt, randomness.sealNonce, randomness.sealAux),
          secret: new SecretField(senderSecretKey),
          wrap: { ...layer(randomness.wrapCreatedAt, randomness.wrapNonce, randomness.wrapAux), secret: new SecretField(oneTime) },
        }, true), op)
      } catch (cause) {
        // A drawn key that is not a scalar, or equals the sender's, is drawn again.
        const redraw = given === undefined && attempt < 4 && cause instanceof AukoraKernelRefusal
          && (cause.code === 'nostr:ephemeral-invalid' || cause.code === 'nostr:ephemeral-key-collision')
        if (!redraw) throw cause
      } finally {
        if (given === undefined) oneTime.fill(0)
      }
    }
  }

  private openCall(op: string, wrap: unknown, recipientSecretKey: Uint8Array, gate: NostrInboxGate): AukoraJson {
    if (!Number.isSafeInteger(gate.now) || gate.now < 0) throw new NostrCellError('INPUT', 'now must be unix seconds')
    if (!gate.contacts.every(key => typeof key === 'string' && HEX64.test(key))) throw new NostrCellError('INPUT', 'contacts must be x-only hex keys')
    try {
      return this.invoke(op, { contacts: [...gate.contacts], now: gate.now, secret: new SecretField(recipientSecretKey), wrap: wrap as AukoraJson }, true)
    } catch (cause) {
      // Floats, lone surrogates and other non-JSON values cannot be a NIP-01 wrap.
      if (cause instanceof NostrCellError && cause.code === 'UNREPRESENTABLE') throw new AukoraKernelRefusal('nostr:event-malformed')
      throw cause
    }
  }

  // --- Transport -----------------------------------------------------------------------

  private instance(): NostrExports {
    const exports = new WebAssembly.Instance(this.module, {}).exports as unknown as NostrExports
    // Instrumented exports debit fuel too; an empty tank traps immediately.
    exports.__mv_fuel_set(this.fuel)
    if (exports.mv_abi_version() !== NOSTR_CORE_MODULE.abi) throw new NostrCellError('MODULE_ABI')
    return exports
  }

  /**
   * Run one op. A call carrying a secret runs on a fresh instance whose linear
   * memory is zero-filled and dropped afterwards; request bytes are zeroed.
   */
  private invoke(op: string, input: Record<string, RequestValue>, secret: boolean): AukoraJson {
    const seq = this.seq + 1
    const request = requestBytes(seq, op, input)
    let text: string
    let exports: NostrExports | undefined
    try {
      if (request.byteLength > MAX_REQUEST_BYTES) throw new NostrCellError('REQUEST_BOUND', `${String(request.byteLength)} bytes`)
      exports = secret ? this.instance() : (this.exports ??= this.instance())
      exports.__mv_fuel_set(this.fuel)
      const pointer = exports.mv_alloc(request.byteLength)
      if (pointer < MIN_BUFFER_OFFSET) throw new NostrCellError('ALLOC')
      new Uint8Array(exports.memory.buffer, pointer, request.byteLength).set(request)
      exports.__mv_fuel_set(this.fuel)
      const packed = exports.mv_run(pointer, request.byteLength)
      this.lastFuelUsed = this.fuel - exports.__mv_fuel_remaining()
      this.seq = seq
      const length = Number(packed >> 32n)
      const offset = Number(packed & 0xffff_ffffn)
      if (length <= 0 || length > MAX_RESPONSE_BYTES || offset < MIN_BUFFER_OFFSET || offset + length > exports.memory.buffer.byteLength) {
        throw new NostrCellError('RESPONSE_DESCRIPTOR')
      }
      text = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, offset, length))
    } catch (cause) {
      if (cause instanceof NostrCellError) throw cause
      // A trap leaves the instance in an unknown state; the next call re-instantiates.
      if (!secret) this.exports = undefined
      const remaining = exports === undefined ? undefined : safeRemaining(exports)
      const exhausted = cause instanceof WebAssembly.RuntimeError && remaining !== undefined && remaining < 16n
      throw new NostrCellError(exhausted ? 'FUEL' : 'TRAP', `${cause instanceof Error ? cause.message : String(cause)}; fuel remaining ${String(remaining)}`)
    } finally {
      request.fill(0)
      if (secret && exports !== undefined) new Uint8Array(exports.memory.buffer).fill(0)
    }
    try {
      return parseAukoraResponse(text, seq)
    } catch (cause) {
      if (cause instanceof AukoraKernelRefusal) throw cause
      throw new NostrCellError('MALFORMED_RESPONSE', cause instanceof Error ? cause.message : String(cause))
    }
  }
}

function safeRemaining(exports: NostrExports): bigint | undefined {
  try {
    return exports.__mv_fuel_remaining()
  } catch {
    return undefined
  }
}
