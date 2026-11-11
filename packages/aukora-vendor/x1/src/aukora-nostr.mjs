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
import { randomBytes } from 'node:crypto';
import { admitCellModule } from '../scripts/aukora-cell-admission.mjs';
import { readFileSync } from 'node:fs';
import { AukoraKernelRefusal, encodeAukoraRequest, parseAukoraResponse, } from './aukora-canonical.mjs';
export { AukoraKernelRefusal as NostrRefusal } from './aukora-canonical.mjs';
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
};
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 1_048_576;
const MIN_BUFFER_OFFSET = 64;
const HEX64 = /^[0-9a-f]{64}$/u;
const HEX128 = /^[0-9a-f]{128}$/u;
const DIGITS = new TextEncoder().encode('0123456789abcdef');
/** A local adapter, transport or trap failure; cell refusals throw `NostrRefusal`. */
export class NostrCellError extends Error {
    code;
    constructor(code, detail) {
        super(`nostr-core failed: ${code}${detail === undefined ? '' : ` (${detail})`}`);
        this.name = 'NostrCellError';
        this.code = code;
    }
}
/** Secret bytes in a request tree; written as hex into the request bytes only. */
class SecretField {
    bytes;
    constructor(bytes) {
        this.bytes = bytes;
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hexOf(bytes) {
    return Buffer.from(bytes).toString('hex');
}
function bytesOf(text) {
    return Uint8Array.from(Buffer.from(text, 'hex'));
}
function needBytes(value, length, label) {
    if (!(value instanceof Uint8Array) || value.byteLength !== length)
        throw new NostrCellError('INPUT', `${label} must be ${String(length)} bytes`);
}
/**
 * Canonical request bytes. Each secret becomes a fresh random 64-hex marker
 * while encoding, then its hex digits overwrite the marker in the bytes, so
 * the secret never exists as a string. The caller zeroes the result.
 */
function requestBytes(seq, op, input) {
    const secrets = [];
    const swap = (value) => {
        if (value instanceof SecretField) {
            const marker = randomBytes(value.bytes.byteLength).toString('hex');
            secrets.push({ marker, bytes: value.bytes });
            return marker;
        }
        if (Array.isArray(value))
            return value.map(item => swap(item));
        if (isRecord(value))
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
        return value;
    };
    let text;
    try {
        text = encodeAukoraRequest(seq, op, swap(input));
    }
    catch (cause) {
        throw new NostrCellError('UNREPRESENTABLE', cause instanceof Error ? cause.message : String(cause));
    }
    const bytes = Buffer.from(text, 'utf8');
    for (const { marker, bytes: secret } of secrets) {
        const quoted = Buffer.from(`"${marker}"`, 'latin1');
        const at = bytes.indexOf(quoted);
        if (at < 0 || bytes.indexOf(quoted, at + 1) >= 0)
            throw new NostrCellError('SECRET_MARKER');
        let offset = at + 1;
        for (const byte of secret) {
            bytes[offset++] = DIGITS[byte >> 4];
            bytes[offset++] = DIGITS[byte & 15];
        }
    }
    return bytes;
}
function stringField(result, key, op) {
    const value = isRecord(result) ? result[key] : undefined;
    if (typeof value !== 'string')
        throw new NostrCellError('MALFORMED_RESULT', op);
    return value;
}
function eventOf(value, op) {
    if (!isRecord(value))
        throw new NostrCellError('MALFORMED_RESULT', op);
    const { id, pubkey, created_at: createdAt, kind, tags, content, sig } = value;
    if (typeof id !== 'string' || !HEX64.test(id) || typeof pubkey !== 'string' || !HEX64.test(pubkey)
        || typeof sig !== 'string' || !HEX128.test(sig) || typeof content !== 'string'
        || !Number.isSafeInteger(createdAt) || !Number.isSafeInteger(kind)
        || !Array.isArray(tags) || !tags.every(tag => Array.isArray(tag) && tag.every(cell => typeof cell === 'string'))) {
        throw new NostrCellError('MALFORMED_RESULT', op);
    }
    return { id, pubkey, created_at: createdAt, kind: kind, tags: tags, content, sig };
}
function nip44KeyFields(key) {
    if ('conversationKey' in key) {
        needBytes(key.conversationKey, 32, 'conversation key');
        return { conversation_key: new SecretField(key.conversationKey) };
    }
    needBytes(key.secretKey, 32, 'secret key');
    return { pubkey: key.pubkey, secret: new SecretField(key.secretKey) };
}
const JITTER_SECONDS = 172_800;
/** `base` minus a uniform 0..min(base, 172,800) seconds, by rejection sampling (the source's `past_time`). */
function pastTime(base) {
    const width = Math.min(base, JITTER_SECONDS) + 1;
    const limit = 2 ** 32 - (2 ** 32 % width);
    for (;;) {
        const sample = randomBytes(4).readUInt32BE(0);
        if (sample < limit)
            return base - (sample % width);
    }
}
function rumorOf(value, op) {
    if (!isRecord(value) || typeof value.id !== 'string' || !HEX64.test(value.id))
        throw new NostrCellError('MALFORMED_RESULT', op);
    const { sig: _sig, ...event } = eventOf({ ...value, sig: '0'.repeat(128) }, op);
    return event;
}
function openedOf(result, op) {
    if (!isRecord(result) || typeof result.sender !== 'string' || !HEX64.test(result.sender))
        throw new NostrCellError('MALFORMED_RESULT', op);
    return { sender: result.sender, rumor: rumorOf(result.rumor, op) };
}
function sealedOf(result, op) {
    if (!isRecord(result))
        throw new NostrCellError('MALFORMED_RESULT', op);
    return { rumor: rumorOf(result.rumor, op), wrap: eventOf(result.wrap, op) };
}
function draftJson(draft) {
    return { created_at: draft.created_at, kind: draft.kind, tags: draft.tags.map(tag => [...tag]), content: draft.content };
}
/**
 * Verify and instantiate the pinned nostr-core cell.
 * @param bytes - optional test bytes; defaults to the packaged asset.
 * @param fuel - optional test grant; defaults to the pinned grant.
 */
export function loadNostrCore(bytes, fuel) {
    return new NostrCore(bytes ?? readFileSync(new URL('../assets/nostr-core.wasm', import.meta.url)), fuel);
}
let shared;
/** One lazily loaded cell for the whole process (calls are serialized by the JS thread). */
export function nostrCore() {
    shared ??= loadNostrCore();
    return shared;
}
/** One pinned nostr-core module; calls are serialized by the JS thread. */
export class NostrCore {
    module;
    fuel;
    exports;
    seq = 0;
    /** Fuel the last completed call consumed. */
    lastFuelUsed = 0n;
    constructor(bytes, fuel = NOSTR_CORE_MODULE.fuel) {
        if (!Number.isSafeInteger(fuel) || fuel <= 0)
            throw new NostrCellError('FUEL_GRANT');
        this.fuel = BigInt(fuel);
        this.module = admitCellModule(NOSTR_CORE_MODULE, bytes, (code, detail) => new NostrCellError(code, detail)).module;
        this.exports = this.instance();
    }
    // --- Identity ------------------------------------------------------------------------
    /** Liveness check. */
    ping() {
        const result = this.invoke('nostr.ping', {}, false);
        return isRecord(result) && result.pong === true;
    }
    /** x-only public key of a secret; refuses `nostr:secret-invalid`. */
    publicKey(secretKey) {
        needBytes(secretKey, 32, 'secret key');
        return stringField(this.invoke('nostr.public_key', { secret: new SecretField(secretKey) }, true), 'pubkey', 'public_key');
    }
    /** Whether a 64-hex string is a valid BIP-340 x-only key. */
    validKey(pubkey) {
        if (!HEX64.test(pubkey))
            return false;
        const result = this.invoke('nostr.key_valid', { pubkey }, false);
        return isRecord(result) && result.valid === true;
    }
    /** NIP-19 `npub` of a valid x-only key. */
    npubEncode(pubkey) {
        return stringField(this.invoke('nostr.npub_encode', { pubkey }, false), 'npub', 'npub_encode');
    }
    /** x-only key of an `npub`; refuses `nostr:npub-invalid`. */
    npubDecode(npub) {
        return stringField(this.invoke('nostr.npub_decode', { npub }, false), 'pubkey', 'npub_decode');
    }
    /** NIP-19 `nsec` of a secret key (the string is secret material; the caller owns it). */
    nsecEncode(secretKey) {
        needBytes(secretKey, 32, 'secret key');
        return stringField(this.invoke('nostr.nsec_encode', { secret: new SecretField(secretKey) }, true), 'nsec', 'nsec_encode');
    }
    /** Secret key bytes of an `nsec`; refuses `nostr:nsec-invalid`. The caller zeroes them. */
    nsecDecode(nsec) {
        return bytesOf(stringField(this.invoke('nostr.nsec_decode', { nsec }, true), 'secret', 'nsec_decode'));
    }
    // --- NIP-01 events -------------------------------------------------------------------
    /** NIP-01 id (SHA-256 of the canonical serialization) of an unsigned event. */
    eventId(unsigned) {
        return stringField(this.invoke('nostr.event_id', { event: { ...draftJson(unsigned), pubkey: unsigned.pubkey } }, false), 'id', 'event_id');
    }
    /** The canonical NIP-01 serialization `[0,pubkey,created_at,kind,tags,content]`. */
    eventPreimage(unsigned) {
        return stringField(this.invoke('nostr.event_id', { event: { ...draftJson(unsigned), pubkey: unsigned.pubkey } }, false), 'preimage', 'event_id');
    }
    /**
     * Sign a draft with a secret key passed for this call only.
     * @param aux - 32 bytes of BIP-340 auxiliary randomness; fresh by default.
     */
    signEvent(unsigned, secretKey, aux = randomBytes(32)) {
        needBytes(secretKey, 32, 'secret key');
        needBytes(aux, 32, 'aux');
        const result = this.invoke('nostr.event_sign', { aux: hexOf(aux), event: draftJson(unsigned), secret: new SecretField(secretKey) }, true);
        return eventOf(isRecord(result) ? result.event : undefined, 'event_sign');
    }
    /** Shape, bounds, id and BIP-340 signature of any value; never throws for a bad event. */
    verifyEvent(event) {
        let result;
        try {
            result = this.invoke('nostr.event_verify', { event: event }, false);
        }
        catch (cause) {
            // Floats, lone surrogates and other non-JSON values cannot be NIP-01 events.
            if (cause instanceof NostrCellError && cause.code === 'UNREPRESENTABLE')
                return { valid: false, reason: 'nostr:event-malformed' };
            throw cause;
        }
        if (isRecord(result) && result.valid === true)
            return { valid: true };
        if (isRecord(result) && result.valid === false && typeof result.reason === 'string')
            return { valid: false, reason: result.reason };
        throw new NostrCellError('MALFORMED_RESULT', 'event_verify');
    }
    // --- NIP-44 v2 ----------------------------------------------------------------------
    /** HKDF-SHA256 extract (salt `nip44-v2`) of the ECDH x-coordinate. Secret: the caller zeroes it. */
    nip44ConversationKey(secretKey, pubkey) {
        needBytes(secretKey, 32, 'secret key');
        return bytesOf(stringField(this.invoke('nostr.nip44_conversation_key', { pubkey, secret: new SecretField(secretKey) }, true), 'conversation_key', 'nip44_conversation_key'));
    }
    /** The per-message keys of one nonce (the official `get_message_keys` vectors). */
    nip44MessageKeys(conversationKey, nonce) {
        needBytes(conversationKey, 32, 'conversation key');
        needBytes(nonce, 32, 'nonce');
        const result = this.invoke('nostr.nip44_message_keys', { conversation_key: new SecretField(conversationKey), nonce: hexOf(nonce) }, true);
        return {
            chachaKey: bytesOf(stringField(result, 'chacha_key', 'nip44_message_keys')),
            chachaNonce: bytesOf(stringField(result, 'chacha_nonce', 'nip44_message_keys')),
            hmacKey: bytesOf(stringField(result, 'hmac_key', 'nip44_message_keys')),
        };
    }
    /** Padded plaintext length; refuses `nip44:plaintext-length` outside 1..=65,536. */
    nip44PaddedLength(length) {
        const result = this.invoke('nostr.nip44_padded_len', { length }, false);
        if (!isRecord(result) || !Number.isSafeInteger(result.padded))
            throw new NostrCellError('MALFORMED_RESULT', 'nip44_padded_len');
        return result.padded;
    }
    /**
     * NIP-44 v2 payload of 1..=65,535 UTF-8 bytes.
     * @param nonce - 32 random bytes; fresh from `node:crypto` by default.
     */
    nip44Encrypt(plaintext, key, nonce = randomBytes(32)) {
        needBytes(nonce, 32, 'nonce');
        return stringField(this.invoke('nostr.nip44_encrypt', { ...nip44KeyFields(key), nonce: hexOf(nonce), plaintext }, true), 'payload', 'nip44_encrypt');
    }
    /** Plaintext of a NIP-44 v2 payload; the MAC is checked before anything is released. */
    nip44Decrypt(payload, key) {
        return stringField(this.invoke('nostr.nip44_decrypt', { ...nip44KeyFields(key), payload }, true), 'plaintext', 'nip44_decrypt');
    }
    // --- NIP-59 gift wrap and NIP-17 direct messages ----------------------------------------
    /**
     * NIP-59: seal `rumor` (any kind) for `recipient` with the sender's key, and
     * wrap the seal under a fresh one-time key. Publish only `wrap`.
     */
    giftWrap(rumor, senderSecretKey, recipient, randomness = {}) {
        needBytes(senderSecretKey, 32, 'secret key');
        return this.wrapCall('nostr.gift_wrap', { recipient, rumor: draftJson(rumor) }, senderSecretKey, rumor.created_at, randomness);
    }
    /**
     * NIP-59: authenticate who sealed `wrap`, refuse a stranger (`nostr:stranger`)
     * before the rumor is opened, then check the times, the rumor id and its author.
     */
    unwrap(wrap, recipientSecretKey, gate) {
        needBytes(recipientSecretKey, 32, 'secret key');
        return openedOf(this.openCall('nostr.unwrap', wrap, recipientSecretKey, gate), 'unwrap');
    }
    /**
     * NIP-17: a kind 14 message to `message.to`, sealed and wrapped for
     * `recipient` (one of `to`, or the sender's own key for the self copy; call
     * once per copy).
     */
    dmSeal(message, senderSecretKey, recipient, randomness = {}) {
        needBytes(senderSecretKey, 32, 'secret key');
        const to = typeof message.to === 'string' ? [message.to] : [...message.to];
        const body = { content: message.content, created_at: message.created_at, tags: (message.tags ?? []).map(tag => [...tag]), to };
        return this.wrapCall('nostr.dm_seal', { message: body, recipient }, senderSecretKey, message.created_at, randomness);
    }
    /** NIP-17: `unwrap` plus kind 14 and, unless it is our own copy, a `p` tag naming us. */
    dmOpen(wrap, recipientSecretKey, gate) {
        needBytes(recipientSecretKey, 32, 'secret key');
        const result = this.openCall('nostr.dm_open', wrap, recipientSecretKey, gate);
        if (!isRecord(result) || typeof result.self_copy !== 'boolean')
            throw new NostrCellError('MALFORMED_RESULT', 'dm_open');
        return { ...openedOf(result, 'dm_open'), selfCopy: result.self_copy };
    }
    wrapCall(op, input, senderSecretKey, base, randomness) {
        for (let attempt = 0;; attempt += 1) {
            const given = randomness.wrapSecretKey;
            const oneTime = given ?? randomBytes(32);
            try {
                const layer = (createdAt, nonce, aux) => {
                    const fields = { created_at: createdAt ?? pastTime(base), nonce: nonce ?? randomBytes(32), aux: aux ?? randomBytes(32) };
                    needBytes(fields.nonce, 32, 'nonce');
                    needBytes(fields.aux, 32, 'aux');
                    return { aux: hexOf(fields.aux), created_at: fields.created_at, nonce: hexOf(fields.nonce) };
                };
                needBytes(oneTime, 32, 'one-time key');
                return sealedOf(this.invoke(op, {
                    ...input,
                    seal: layer(randomness.sealCreatedAt, randomness.sealNonce, randomness.sealAux),
                    secret: new SecretField(senderSecretKey),
                    wrap: { ...layer(randomness.wrapCreatedAt, randomness.wrapNonce, randomness.wrapAux), secret: new SecretField(oneTime) },
                }, true), op);
            }
            catch (cause) {
                // A drawn key that is not a scalar, or equals the sender's, is drawn again.
                const redraw = given === undefined && attempt < 4 && cause instanceof AukoraKernelRefusal
                    && (cause.code === 'nostr:ephemeral-invalid' || cause.code === 'nostr:ephemeral-key-collision');
                if (!redraw)
                    throw cause;
            }
            finally {
                if (given === undefined)
                    oneTime.fill(0);
            }
        }
    }
    openCall(op, wrap, recipientSecretKey, gate) {
        if (!Number.isSafeInteger(gate.now) || gate.now < 0)
            throw new NostrCellError('INPUT', 'now must be unix seconds');
        if (!gate.contacts.every(key => typeof key === 'string' && HEX64.test(key)))
            throw new NostrCellError('INPUT', 'contacts must be x-only hex keys');
        try {
            return this.invoke(op, { contacts: [...gate.contacts], now: gate.now, secret: new SecretField(recipientSecretKey), wrap: wrap }, true);
        }
        catch (cause) {
            // Floats, lone surrogates and other non-JSON values cannot be a NIP-01 wrap.
            if (cause instanceof NostrCellError && cause.code === 'UNREPRESENTABLE')
                throw new AukoraKernelRefusal('nostr:event-malformed');
            throw cause;
        }
    }
    // --- Transport -----------------------------------------------------------------------
    instance() {
        const exports = new WebAssembly.Instance(this.module, {}).exports;
        // Instrumented exports debit fuel too; an empty tank traps immediately.
        exports.__mv_fuel_set(this.fuel);
        if (exports.mv_abi_version() !== NOSTR_CORE_MODULE.abi)
            throw new NostrCellError('MODULE_ABI');
        return exports;
    }
    /**
     * Run one op. A call carrying a secret runs on a fresh instance whose linear
     * memory is zero-filled and dropped afterwards; request bytes are zeroed.
     */
    invoke(op, input, secret) {
        const seq = this.seq + 1;
        const request = requestBytes(seq, op, input);
        let text;
        let exports;
        try {
            if (request.byteLength > MAX_REQUEST_BYTES)
                throw new NostrCellError('REQUEST_BOUND', `${String(request.byteLength)} bytes`);
            exports = secret ? this.instance() : (this.exports ??= this.instance());
            exports.__mv_fuel_set(this.fuel);
            const pointer = exports.mv_alloc(request.byteLength);
            if (pointer < MIN_BUFFER_OFFSET)
                throw new NostrCellError('ALLOC');
            new Uint8Array(exports.memory.buffer, pointer, request.byteLength).set(request);
            exports.__mv_fuel_set(this.fuel);
            const packed = exports.mv_run(pointer, request.byteLength);
            this.lastFuelUsed = this.fuel - exports.__mv_fuel_remaining();
            this.seq = seq;
            const length = Number(packed >> 32n);
            const offset = Number(packed & 0xffffffffn);
            if (length <= 0 || length > MAX_RESPONSE_BYTES || offset < MIN_BUFFER_OFFSET || offset + length > exports.memory.buffer.byteLength) {
                throw new NostrCellError('RESPONSE_DESCRIPTOR');
            }
            text = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, offset, length));
        }
        catch (cause) {
            if (cause instanceof NostrCellError)
                throw cause;
            // A trap leaves the instance in an unknown state; the next call re-instantiates.
            if (!secret)
                this.exports = undefined;
            const remaining = exports === undefined ? undefined : safeRemaining(exports);
            const exhausted = cause instanceof WebAssembly.RuntimeError && remaining !== undefined && remaining < 16n;
            throw new NostrCellError(exhausted ? 'FUEL' : 'TRAP', `${cause instanceof Error ? cause.message : String(cause)}; fuel remaining ${String(remaining)}`);
        }
        finally {
            request.fill(0);
            if (secret && exports !== undefined)
                new Uint8Array(exports.memory.buffer).fill(0);
        }
        try {
            return parseAukoraResponse(text, seq);
        }
        catch (cause) {
            if (cause instanceof AukoraKernelRefusal)
                throw cause;
            throw new NostrCellError('MALFORMED_RESPONSE', cause instanceof Error ? cause.message : String(cause));
        }
    }
}
function safeRemaining(exports) {
    try {
        return exports.__mv_fuel_remaining();
    }
    catch {
        return undefined;
    }
}
