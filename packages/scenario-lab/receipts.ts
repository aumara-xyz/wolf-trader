/**
 * Actual browser cryptography for illustrative scenario receipts only.
 *
 * The canonical form is Wolf's bounded JSON format: recursively sorted object
 * keys, ordinary JSON scalar/number encoding and preserved array order. It is
 * not a claim of implementing RFC 8785. Payload SHA-256 is over that UTF-8 form.
 * ECDSA signs the canonical {schema, issuer, algorithm, payloadSha256, payload}
 * envelope. Only the ephemeral public key is exported; the private key is
 * nonextractable and is neither persisted nor used for owner permissions.
 *
 * A valid receipt proves consistency under its enclosed key, not a known
 * identity, source truth, complete observation or authority to trade.
 */

export type DemoJsonValue = null | boolean | number | string | DemoJsonValue[] | DemoJsonObject
export interface DemoJsonObject { [key: string]: DemoJsonValue }

const SCHEMA = 'wolf-scenario-receipt/v1' as const
const ISSUER = 'ephemeral demo key; not owner permission or known identity' as const
const ALGORITHM = 'ECDSA-P256-SHA256' as const
const MAX_PAYLOAD_BYTES = 65_536
const MAX_BUNDLE_BYTES = 98_304
const MAX_DEPTH = 14
const MAX_NODES = 8_192
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const encoder = new TextEncoder()

export interface DemoReceipt {
  schema: typeof SCHEMA
  issuer: typeof ISSUER
  algorithm: typeof ALGORITHM
  publicJwk: JsonWebKey
  payload: DemoJsonObject
  payloadSha256: string
  signature: string
}
export interface DemoReceiptVerification { valid: boolean; reason: string }

function invalid(reason: string): never { throw new Error(`Demo receipt: ${reason}`) }
function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function canonicalJSON(input: unknown, maxBytes: number, maxDepth = MAX_DEPTH, maxNodes = MAX_NODES): string {
  const ancestors = new Set<object>()
  let nodes = 0
  const encode = (value: unknown, depth: number): string => {
    if (++nodes > maxNodes || depth > maxDepth) invalid('The JSON structure exceeds its bounds.')
    if (value === null || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid('Numbers must be finite.')
      return JSON.stringify(value)
    }
    if (typeof value === 'string') {
      if (value.length > 16_384 || !wellFormed(value)) invalid('Text must be bounded, valid Unicode.')
      return JSON.stringify(value)
    }
    if (typeof value !== 'object' || value === null) invalid('Only JSON values are supported.')
    if (ancestors.has(value)) invalid('Cyclic structures are not supported.')
    if (Object.getOwnPropertySymbols(value).length) invalid('Symbol properties are not supported.')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 256) invalid('Arrays exceed their bounds or have a custom prototype.')
        if (Object.getOwnPropertyNames(value).length !== value.length + 1) invalid('Arrays must contain only indexed values.')
        const entries: string[] = []
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid('Sparse arrays and accessors are not supported.')
          entries.push(encode(descriptor.value, depth + 1))
        }
        return `[${entries.join(',')}]`
      }
      if (!plainObject(value)) invalid('Use plain JSON objects; dates must be ISO strings.')
      const keys = Object.getOwnPropertyNames(value).sort()
      if (keys.length > 128) invalid('An object has too many fields.')
      return `{${keys.map(key => {
        if (FORBIDDEN_KEYS.has(key) || key.length > 128 || !wellFormed(key)) invalid('An object field is unsupported.')
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid('Hidden fields and accessors are not supported.')
        return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`
      }).join(',')}}`
    } finally { ancestors.delete(value) }
  }
  const result = encode(input, 0)
  if (encoder.encode(result).length > maxBytes) invalid('The JSON byte limit was exceeded.')
  return result
}

function webCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) invalid('WebCrypto is unavailable in this browser context.')
  return globalThis.crypto.subtle
}
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return btoa(String.fromCharCode(...view)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
function decodeBase64url(value: unknown, expectedBytes: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100) invalid('A cryptographic field has invalid encoding.')
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
  if (bytes.length !== expectedBytes || base64url(bytes) !== value) invalid('A cryptographic field has the wrong length or encoding.')
  return bytes
}
function exactFields(value: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('The receipt contains unknown or missing fields.')
}
function validatedPublicJwk(value: unknown): JsonWebKey {
  if (!plainObject(value)) invalid('The public key is invalid.')
  exactFields(value, ['kty', 'crv', 'x', 'y', 'ext', 'key_ops', 'alg'], ['kty', 'crv', 'x', 'y'])
  if (value.kty !== 'EC' || value.crv !== 'P-256' || (value.alg !== undefined && value.alg !== 'ES256') || (value.ext !== undefined && value.ext !== true)) invalid('Only an EC P-256 public key is supported.')
  if (value.key_ops !== undefined && (!Array.isArray(value.key_ops) || value.key_ops.length !== 1 || value.key_ops[0] !== 'verify')) invalid('The public key must be restricted to verification.')
  decodeBase64url(value.x, 32); decodeBase64url(value.y, 32)
  return value as JsonWebKey
}
function signedEnvelope(payload: DemoJsonObject, payloadSha256: string) {
  return { schema: SCHEMA, issuer: ISSUER, algorithm: ALGORITHM, payloadSha256, payload }
}

export async function createDemoReceipt(payload: DemoJsonObject): Promise<DemoReceipt> {
  if (!plainObject(payload)) invalid('The payload must be a plain JSON object.')
  // Capture a detached, bounded snapshot before any asynchronous operation.
  const canonicalPayload = canonicalJSON(payload, MAX_PAYLOAD_BYTES)
  const snapshot = JSON.parse(canonicalPayload) as DemoJsonObject
  const subtle = webCrypto()
  const payloadSha256 = hex(await subtle.digest('SHA-256', encoder.encode(canonicalPayload)))
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const publicJwk = await subtle.exportKey('jwk', pair.publicKey)
  const message = canonicalJSON(signedEnvelope(snapshot, payloadSha256), MAX_BUNDLE_BYTES, MAX_DEPTH + 1, MAX_NODES + 32)
  const signature = base64url(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, encoder.encode(message)))
  return { ...signedEnvelope(snapshot, payloadSha256), publicJwk, signature }
}

export async function verifyDemoReceipt(bundle: unknown): Promise<DemoReceiptVerification> {
  try {
    if (!plainObject(bundle)) invalid('The receipt must be a plain JSON object.')
    // Normalize once before awaits, so callers cannot mutate the object mid-check.
    const snapshot = JSON.parse(canonicalJSON(bundle, MAX_BUNDLE_BYTES, MAX_DEPTH + 1, MAX_NODES + 32)) as Record<string, unknown>
    exactFields(snapshot, ['schema', 'issuer', 'algorithm', 'publicJwk', 'payload', 'payloadSha256', 'signature'])
    if (snapshot.schema !== SCHEMA || snapshot.issuer !== ISSUER || snapshot.algorithm !== ALGORITHM) invalid('The receipt format or issuer is unsupported.')
    if (!plainObject(snapshot.payload)) invalid('The payload must be a plain JSON object.')
    if (typeof snapshot.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.payloadSha256)) invalid('The payload digest is invalid.')
    const payloadText = canonicalJSON(snapshot.payload, MAX_PAYLOAD_BYTES)
    const subtle = webCrypto()
    if (hex(await subtle.digest('SHA-256', encoder.encode(payloadText))) !== snapshot.payloadSha256) return { valid: false, reason: 'The recorded payload has changed.' }
    const publicJwk = validatedPublicJwk(snapshot.publicJwk)
    const signature = decodeBase64url(snapshot.signature, 64)
    const key = await subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const message = canonicalJSON(signedEnvelope(snapshot.payload as DemoJsonObject, snapshot.payloadSha256), MAX_BUNDLE_BYTES, MAX_DEPTH + 1, MAX_NODES + 32)
    const valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, encoder.encode(message))
    return { valid, reason: valid ? 'Signature and payload digest verified under the enclosed ephemeral demo key.' : 'The signature does not match this payload and key.' }
  } catch (error) {
    return { valid: false, reason: error instanceof Error && error.message.startsWith('Demo receipt: ') ? error.message.slice(14) : 'The receipt is malformed or its public key is invalid.' }
  }
}
