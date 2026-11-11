//! nostr-core on the Microverse ABI v1 surface: the organism's Nostr spine.
//!
//! Carried from aukora-wasm af58c0d `crates/nostr` (see `../README.md` for
//! provenance). Every op is a pure function of its input: no clock and no
//! randomness live in here. The Host supplies `created_at`, the BIP-340 `aux`
//! bytes, NIP-44 nonces and ephemeral keys, and passes a private key only for
//! the one call that needs it.
//!
//! A signed event proves who wrote it, never that it is permitted. Events are
//! evidence and memory; Peter's owner card and the grant ledger stay the only
//! door to authority.
//!
//! Ops (canonical JSON; byte strings are lowercase hex):
//!
//! - `nostr.ping` `{}`.
//! - `nostr.public_key` `{secret}`: `{pubkey}`.
//! - `nostr.key_valid` `{pubkey}`: `{valid}` (BIP-340 `lift_x`).
//! - `nostr.event_id` `{event: {pubkey, created_at, kind, tags, content}}`:
//!   `{id, preimage}`, the NIP-01 serialization and its SHA-256.
//! - `nostr.event_sign` `{event: {created_at, kind, tags, content}, secret,
//!   aux}`: `{event}` with `pubkey`, `id` and `sig`.
//! - `nostr.event_verify` `{event}`: `{valid: true}` or `{valid: false,
//!   reason}`; any JSON value is judged, never refused.
//! - `nostr.npub_encode` `{pubkey}` / `nostr.npub_decode` `{npub}`,
//!   `nostr.nsec_encode` `{secret}` / `nostr.nsec_decode` `{nsec}` (NIP-19).
//! - NIP-44 v2: `nostr.nip44_conversation_key` `{secret, pubkey}`,
//!   `nostr.nip44_message_keys` `{conversation_key, nonce}`,
//!   `nostr.nip44_padded_len` `{length}`, `nostr.nip44_encrypt` `{plaintext,
//!   nonce}` and `nostr.nip44_decrypt` `{payload}`, each keyed by either
//!   `{conversation_key}` or `{secret, pubkey}`. The Host draws the nonce.
//! - NIP-59: `nostr.gift_wrap` `{rumor, secret, recipient, seal, wrap}` seals
//!   a rumor (any kind) and wraps it under the Host's one-time key;
//!   `nostr.unwrap` `{wrap, secret, contacts, now}` returns `{sender, rumor}`.
//! - NIP-17: `nostr.dm_seal` `{message: {to, content, created_at, tags},
//!   secret, recipient, seal, wrap}` (kind 14, `p` tags first) and
//!   `nostr.dm_open` `{wrap, secret, contacts, now}`: `{sender, rumor,
//!   self_copy}`. A sender who is not a contact is refused `nostr:stranger`
//!   before the message is opened (only the wrap layer is decrypted, to learn
//!   who sealed it).
//!
//! Op refusals are `nostr:*` codes; envelope refusals are `MALFORMED`, `ABI`,
//! `UNKNOWN_OP`, `INVALID_INPUT`, `REQUEST_BOUND` and `RESPONSE_BOUND`.
//!
//! Secret hygiene: the request allocation, the request copy and every parsed
//! string are overwritten before they are freed; secrets live in zeroizing
//! storage. The Host runs each secret-bearing call on a fresh instance and
//! zero-fills its linear memory afterwards.
//!
//! Exports exactly `memory`, `mv_abi_version`, `mv_alloc`, `mv_run` before the
//! builder-side `mv-meter` transform adds the fuel exports; no imports and no
//! float instructions. Requests and responses are canonical JSON via the
//! vendored `mv-abi` source (included as a module, so the crate keeps only
//! registry dependencies), bounded at 1 MiB each.

use std::cell::RefCell;
use std::collections::BTreeMap;

use zeroize::Zeroizing;

#[allow(dead_code)]
#[path = "../../mv-abi/src/lib.rs"]
mod mv_abi;

mod c1;
mod event;
mod keys;
mod nip44;
mod nip59;

use mv_abi::{encode, parse, Value};

pub(crate) type Map = BTreeMap<String, Value>;
type Answer = Result<Value, &'static str>;

const MAX_REQUEST_BYTES: usize = 1_048_576;
const MAX_RESPONSE_BYTES: usize = 1_048_576;

// --- Bytes and secret hygiene ---------------------------------------------------------

/// Overwrite bytes the caller owns; volatile so the writes are kept.
pub(crate) fn wipe(bytes: &mut [u8]) {
    for byte in bytes.iter_mut() {
        // SAFETY: a valid, aligned byte the caller owns.
        unsafe { core::ptr::write_volatile(byte, 0) };
    }
}

/// Overwrite every string (keys included) of a request or response tree before it is freed.
fn wipe_value(value: Value) {
    match value {
        Value::Str(mut text) => wipe(unsafe { text.as_bytes_mut() }),
        Value::Array(items) => items.into_iter().for_each(wipe_value),
        Value::Object(map) => {
            for (mut key, item) in map {
                wipe(unsafe { key.as_bytes_mut() });
                wipe_value(item);
            }
        }
        _ => {}
    }
}

pub(crate) fn nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 15) as usize] as char);
    }
    out
}

// --- Input shape ----------------------------------------------------------------------

fn exact_keys(map: &Map, keys: &[&str]) -> bool {
    map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key))
}

fn shape(input: &Map, keys: &[&str]) -> Result<(), &'static str> {
    if exact_keys(input, keys) { Ok(()) } else { Err("INVALID_INPUT") }
}

fn text<'a>(map: &'a Map, key: &str) -> Result<&'a str, &'static str> {
    map.get(key).and_then(Value::as_str).ok_or("INVALID_INPUT")
}

fn field<'a>(map: &'a Map, key: &str) -> Result<&'a Value, &'static str> {
    map.get(key).ok_or("INVALID_INPUT")
}

fn bytes32(map: &Map, key: &str) -> Result<[u8; 32], &'static str> {
    event::fixed_hex::<32>(text(map, key)?).ok_or("INVALID_INPUT")
}

/// A secret read into zeroizing storage; refused when it is not a valid scalar.
fn secret(map: &Map, key: &str) -> Result<keys::Secret, &'static str> {
    let bytes = Zeroizing::new(event::fixed_hex::<32>(text(map, key)?).ok_or("INVALID_INPUT")?);
    keys::Secret::import(bytes)
}

// --- Ops ------------------------------------------------------------------------------

fn public_key_op(input: &Map) -> Answer {
    shape(input, &["secret"])?;
    Ok(Value::obj(vec![("pubkey", Value::str(hex(&secret(input, "secret")?.public())))]))
}

fn key_valid_op(input: &Map) -> Answer {
    shape(input, &["pubkey"])?;
    Ok(Value::obj(vec![("valid", Value::Bool(keys::valid_point(&bytes32(input, "pubkey")?)))]))
}

fn event_id_op(input: &Map) -> Answer {
    shape(input, &["event"])?;
    let unsigned = event::unsigned_from(field(input, "event")?)?;
    let preimage = event::preimage(&unsigned)?;
    let id = event::content_id(&unsigned)?;
    Ok(Value::obj(vec![("id", Value::str(hex(&id))), ("preimage", Value::str(preimage))]))
}

fn event_sign_op(input: &Map) -> Answer {
    shape(input, &["aux", "event", "secret"])?;
    let aux = Zeroizing::new(bytes32(input, "aux")?);
    let draft = event::draft_from(field(input, "event")?)?;
    let author = secret(input, "secret")?;
    let signed = event::sign(&author, draft, &aux)?;
    Ok(Value::obj(vec![("event", event::event_value(&signed))]))
}

fn event_verify_op(input: &Map) -> Answer {
    shape(input, &["event"])?;
    let verdict = event::event_from(field(input, "event")?).and_then(|parsed| event::verify(&parsed));
    Ok(match verdict {
        Ok(()) => Value::obj(vec![("valid", Value::Bool(true))]),
        Err(reason) => Value::obj(vec![("reason", Value::str(reason)), ("valid", Value::Bool(false))]),
    })
}

fn npub_encode_op(input: &Map) -> Answer {
    shape(input, &["pubkey"])?;
    Ok(Value::obj(vec![("npub", Value::str(keys::npub_encode(&bytes32(input, "pubkey")?)?))]))
}

fn npub_decode_op(input: &Map) -> Answer {
    shape(input, &["npub"])?;
    Ok(Value::obj(vec![("pubkey", Value::str(hex(&keys::npub_decode(text(input, "npub")?)?)))]))
}

fn nsec_encode_op(input: &Map) -> Answer {
    shape(input, &["secret"])?;
    Ok(Value::obj(vec![("nsec", Value::str(keys::nsec_encode(&secret(input, "secret")?)?))]))
}

fn nsec_decode_op(input: &Map) -> Answer {
    shape(input, &["nsec"])?;
    let decoded = keys::nsec_decode(text(input, "nsec")?)?;
    Ok(Value::obj(vec![("secret", Value::str(hex(decoded.bytes())))]))
}

// --- NIP-44 v2 ------------------------------------------------------------------------

/// The conversation key: given, or derived from `{secret, pubkey}`. Any key
/// that cannot be used refuses `nip44:key-invalid`, as in the source.
fn conversation(input: &Map) -> Result<nip44::ConversationKey, &'static str> {
    if input.contains_key("conversation_key") {
        return Ok(nip44::ConversationKey::import(Zeroizing::new(bytes32(input, "conversation_key")?)));
    }
    let peer = bytes32(input, "pubkey")?;
    let own = event::fixed_hex::<32>(text(input, "secret")?).ok_or("INVALID_INPUT")?;
    let own = keys::Secret::import(Zeroizing::new(own)).map_err(|_| "nip44:key-invalid")?;
    nip44::ConversationKey::derive(&own, &peer)
}

/// Exactly `keys` plus either `conversation_key` or `secret` and `pubkey`.
fn keyed_shape(input: &Map, keys: &[&str]) -> Result<(), &'static str> {
    let by_key: Vec<&str> = keys.iter().copied().chain(["conversation_key"]).collect();
    let by_pair: Vec<&str> = keys.iter().copied().chain(["pubkey", "secret"]).collect();
    if exact_keys(input, &by_key) || exact_keys(input, &by_pair) { Ok(()) } else { Err("INVALID_INPUT") }
}

fn nip44_conversation_key_op(input: &Map) -> Answer {
    shape(input, &["pubkey", "secret"])?;
    let key = conversation(input)?;
    Ok(Value::obj(vec![("conversation_key", Value::str(hex(key.bytes())))]))
}

fn nip44_message_keys_op(input: &Map) -> Answer {
    shape(input, &["conversation_key", "nonce"])?;
    let nonce = bytes32(input, "nonce")?;
    let material = conversation(input)?.message_keys(&nonce)?;
    Ok(Value::obj(vec![
        ("chacha_key", Value::str(hex(&material[..32]))),
        ("chacha_nonce", Value::str(hex(&material[32..44]))),
        ("hmac_key", Value::str(hex(&material[44..]))),
    ]))
}

fn nip44_padded_len_op(input: &Map) -> Answer {
    shape(input, &["length"])?;
    let length = input.get("length").and_then(Value::as_int).ok_or("INVALID_INPUT")?;
    let length = usize::try_from(length).map_err(|_| "nip44:plaintext-length")?;
    Ok(Value::obj(vec![("padded", Value::Int(nip44::padded_length(length)? as i64))]))
}

fn nip44_encrypt_op(input: &Map) -> Answer {
    keyed_shape(input, &["nonce", "plaintext"])?;
    let nonce = bytes32(input, "nonce")?;
    let plaintext = text(input, "plaintext")?;
    let payload = nip44::encrypt(&conversation(input)?, plaintext, &nonce)?;
    Ok(Value::obj(vec![("payload", Value::str(payload))]))
}

fn nip44_decrypt_op(input: &Map) -> Answer {
    keyed_shape(input, &["payload"])?;
    let payload = text(input, "payload")?;
    let plaintext = nip44::decrypt(&conversation(input)?, payload)?;
    Ok(Value::obj(vec![("plaintext", Value::str(plaintext.as_str()))]))
}

// --- NIP-59 and NIP-17 -----------------------------------------------------------------

fn time(map: &Map, key: &str) -> Result<u64, &'static str> {
    match map.get(key).and_then(Value::as_int) {
        Some(seconds) if seconds >= 0 => Ok(seconds as u64),
        _ => Err("INVALID_INPUT"),
    }
}

/// `{aux, created_at, nonce}` (+ `secret`, the one-time wrap key, when `one_time`).
fn layer(input: &Map, key: &str, one_time: bool) -> Result<(nip59::Layer, Option<keys::Secret>), &'static str> {
    let Some(Value::Object(map)) = input.get(key) else { return Err("INVALID_INPUT") };
    shape(map, if one_time { &["aux", "created_at", "nonce", "secret"] } else { &["aux", "created_at", "nonce"] })?;
    let layer = nip59::Layer {
        created_at: time(map, "created_at")?,
        nonce: bytes32(map, "nonce")?,
        aux: Zeroizing::new(bytes32(map, "aux")?),
    };
    let ephemeral = if one_time {
        let bytes = Zeroizing::new(event::fixed_hex::<32>(text(map, "secret")?).ok_or("INVALID_INPUT")?);
        Some(keys::Secret::import(bytes).map_err(|_| "nostr:ephemeral-invalid")?)
    } else {
        None
    };
    Ok((layer, ephemeral))
}

fn pubkeys(map: &Map, key: &str) -> Result<Vec<[u8; 32]>, &'static str> {
    let items = map.get(key).and_then(Value::as_array).ok_or("INVALID_INPUT")?;
    items.iter().map(|item| item.as_str().and_then(event::fixed_hex::<32>).ok_or("INVALID_INPUT")).collect()
}

fn wrap_answer(sender: &keys::Secret, draft: event::Draft, input: &Map) -> Answer {
    let recipient = bytes32(input, "recipient")?;
    let (seal, _) = layer(input, "seal", false)?;
    let (wrap, ephemeral) = layer(input, "wrap", true)?;
    let ephemeral = ephemeral.ok_or("INVALID_INPUT")?;
    let ((rumor_id, rumor), wrapped) = nip59::gift_wrap(draft, sender, &recipient, &seal, &wrap, &ephemeral)?;
    Ok(Value::obj(vec![("rumor", event::unsigned_value(&rumor_id, &rumor)), ("wrap", event::event_value(&wrapped))]))
}

fn gift_wrap_op(input: &Map) -> Answer {
    shape(input, &["recipient", "rumor", "seal", "secret", "wrap"])?;
    let draft = event::draft_from(field(input, "rumor")?)?;
    wrap_answer(&secret(input, "secret")?, draft, input)
}

fn dm_seal_op(input: &Map) -> Answer {
    shape(input, &["message", "recipient", "seal", "secret", "wrap"])?;
    let Some(Value::Object(message)) = input.get("message") else { return Err("INVALID_INPUT") };
    shape(message, &["content", "created_at", "tags", "to"])?;
    let to = pubkeys(message, "to")?;
    if to.is_empty() {
        return Err("INVALID_INPUT");
    }
    if to.iter().any(|key| !keys::valid_point(key)) {
        return Err("nostr:public-key-invalid");
    }
    let extra = message.get("tags").and_then(Value::as_array).ok_or("INVALID_INPUT")?;
    // Every receiver is named through `to`; extra tags (subject, reply) carry no `p`.
    if extra.iter().any(|tag| tag.as_array().and_then(|fields| fields.first()).and_then(Value::as_str) == Some("p")) {
        return Err("INVALID_INPUT");
    }
    let mut tags: Vec<Value> = to.iter().map(|key| Value::Array(vec![Value::str("p"), Value::str(hex(key))])).collect();
    tags.extend(extra.iter().cloned());
    let draft = event::draft_from(&Value::obj(vec![
        ("content", field(message, "content")?.clone()),
        ("created_at", field(message, "created_at")?.clone()),
        ("kind", Value::Int(i64::from(nip59::MESSAGE_KIND))),
        ("tags", Value::Array(tags)),
    ]))?;
    let sender = secret(input, "secret")?;
    let recipient = bytes32(input, "recipient")?;
    if recipient != sender.public() && !to.contains(&recipient) {
        return Err("nostr:recipient-mismatch");
    }
    wrap_answer(&sender, draft, input)
}

/// Unwrap for this recipient: authenticate, refuse strangers, then open.
fn opened(input: &Map, direct: bool) -> Result<(nip59::AuthenticatedSeal, [u8; 32], event::Unsigned), &'static str> {
    shape(input, &["contacts", "now", "secret", "wrap"])?;
    let contacts = pubkeys(input, "contacts")?;
    let now = time(input, "now")?;
    let recipient = secret(input, "secret")?;
    let wrap = event::event_from(field(input, "wrap")?)?;
    let sealed = nip59::authenticate_sender(&wrap, &recipient)?;
    nip59::admit(&sealed, &contacts)?;
    let (id, rumor) = nip59::open(&sealed, &recipient, now)?;
    if direct {
        nip59::check_direct_message(&rumor, &sealed.recipient)?;
    }
    Ok((sealed, id, rumor))
}

fn unwrap_op(input: &Map) -> Answer {
    let (sealed, id, rumor) = opened(input, false)?;
    Ok(Value::obj(vec![("rumor", event::unsigned_value(&id, &rumor)), ("sender", Value::str(hex(&sealed.seal.unsigned.pubkey)))]))
}

fn dm_open_op(input: &Map) -> Answer {
    let (sealed, id, rumor) = opened(input, true)?;
    Ok(Value::obj(vec![
        ("rumor", event::unsigned_value(&id, &rumor)),
        ("self_copy", Value::Bool(sealed.seal.unsigned.pubkey == sealed.recipient)),
        ("sender", Value::str(hex(&sealed.seal.unsigned.pubkey))),
    ]))
}

// --- Canonical envelope ---------------------------------------------------------------

fn envelope_refused(seq: i64, code: &str) -> Vec<u8> {
    encode(&Value::obj(vec![
        ("abi", Value::Int(1)),
        ("code", Value::str(code)),
        ("seq", Value::Int(seq)),
        ("status", Value::str("refused")),
    ]))
}

fn envelope_ok(seq: i64, result: Value) -> Vec<u8> {
    let envelope = Value::obj(vec![
        ("abi", Value::Int(1)),
        ("result", result),
        ("seq", Value::Int(seq)),
        ("status", Value::str("ok")),
    ]);
    let bytes = encode(&envelope);
    wipe_value(envelope);
    if bytes.len() > MAX_RESPONSE_BYTES {
        let mut bytes = bytes;
        wipe(&mut bytes);
        return envelope_refused(seq, "RESPONSE_BOUND");
    }
    bytes
}

fn answer(envelope: &Map) -> (i64, Answer) {
    let seq = envelope.get("seq").and_then(Value::as_int).unwrap_or(0);
    if !exact_keys(envelope, &["abi", "input", "op", "seq"]) {
        return (seq, Err("MALFORMED"));
    }
    if envelope.get("abi").and_then(Value::as_int) != Some(1) {
        return (seq, Err("ABI"));
    }
    let (Some(op), Some(Value::Object(input))) = (envelope.get("op").and_then(Value::as_str), envelope.get("input")) else {
        return (seq, Err("MALFORMED"));
    };
    let result = match op {
        "nostr.ping" if input.is_empty() => Ok(Value::obj(vec![("pong", Value::Bool(true)), ("version", Value::Int(1))])),
        "nostr.ping" => Err("MALFORMED"),
        "nostr.public_key" => public_key_op(input),
        "nostr.key_valid" => key_valid_op(input),
        "nostr.event_id" => event_id_op(input),
        "nostr.event_sign" => event_sign_op(input),
        "nostr.event_verify" => event_verify_op(input),
        "nostr.npub_encode" => npub_encode_op(input),
        "nostr.npub_decode" => npub_decode_op(input),
        "nostr.nsec_encode" => nsec_encode_op(input),
        "nostr.nsec_decode" => nsec_decode_op(input),
        "nostr.nip44_conversation_key" => nip44_conversation_key_op(input),
        "nostr.nip44_message_keys" => nip44_message_keys_op(input),
        "nostr.nip44_padded_len" => nip44_padded_len_op(input),
        "nostr.nip44_encrypt" => nip44_encrypt_op(input),
        "nostr.nip44_decrypt" => nip44_decrypt_op(input),
        "nostr.gift_wrap" => gift_wrap_op(input),
        "nostr.unwrap" => unwrap_op(input),
        "nostr.dm_seal" => dm_seal_op(input),
        "nostr.dm_open" => dm_open_op(input),
        _ => Err("UNKNOWN_OP"),
    };
    (seq, result)
}

fn dispatch(request: &[u8]) -> Vec<u8> {
    if request.len() > MAX_REQUEST_BYTES {
        return envelope_refused(0, "REQUEST_BOUND");
    }
    let envelope = match parse(request) {
        Ok(Value::Object(map)) => map,
        Ok(other) => {
            wipe_value(other);
            return envelope_refused(0, "MALFORMED");
        }
        Err(_) => return envelope_refused(0, "MALFORMED"),
    };
    let (seq, result) = answer(&envelope);
    wipe_value(Value::Object(envelope));
    match result {
        Ok(value) => envelope_ok(seq, value),
        Err(code) => envelope_refused(seq, code),
    }
}

// --- Buffer lifecycle (ABI §10.3) -----------------------------------------------------
// Request buffers are wiped and reclaimed in mv_run; the previous response is
// reclaimed at the start of the next allocation or run. The Host copies the
// result before the next call.

thread_local! {
    static ALLOCS: RefCell<Vec<(usize, usize)>> = const { RefCell::new(Vec::new()) };
    static LAST_RESPONSE: RefCell<Option<(usize, usize)>> = const { RefCell::new(None) };
}

unsafe fn dealloc(pointer: usize, capacity: usize) {
    drop(Vec::from_raw_parts(pointer as *mut u8, 0, capacity));
}

fn reclaim_response() {
    LAST_RESPONSE.with(|response| {
        if let Some((pointer, capacity)) = response.borrow_mut().take() {
            unsafe { dealloc(pointer, capacity) };
        }
    });
}

fn alloc_request(length: i32) -> i32 {
    reclaim_response();
    if length <= 0 || length as usize > MAX_REQUEST_BYTES {
        return 0;
    }
    let mut buffer: Vec<u8> = Vec::with_capacity(length as usize);
    let pointer = buffer.as_mut_ptr() as usize;
    let capacity = buffer.capacity();
    core::mem::forget(buffer);
    if pointer < 64 {
        unsafe { dealloc(pointer, capacity) };
        return 0;
    }
    ALLOCS.with(|allocs| allocs.borrow_mut().push((pointer, capacity)));
    pointer as i32
}

/// Copy the request out of its allocation, then wipe and free the allocation.
fn take_request(pointer: i32, length: i32) -> Vec<u8> {
    let Some((start, capacity)) = ALLOCS.with(|allocs| {
        let mut allocs = allocs.borrow_mut();
        let position = allocs.iter().position(|(start, _)| *start == pointer as usize)?;
        Some(allocs.remove(position))
    }) else {
        return Vec::new();
    };
    if length < 0 || length as usize > capacity {
        unsafe { dealloc(start, capacity) };
        return Vec::new();
    }
    // SAFETY: the Host wrote `length` bytes into this live mv_alloc allocation.
    let request = unsafe { core::slice::from_raw_parts(start as *const u8, length as usize) }.to_vec();
    for offset in 0..length as usize {
        // SAFETY: inside the same allocation.
        unsafe { core::ptr::write_volatile((start as *mut u8).add(offset), 0) };
    }
    unsafe { dealloc(start, capacity) };
    request
}

fn finish_response(response: Vec<u8>) -> i64 {
    let length = response.len();
    let pointer = response.as_ptr() as usize;
    let capacity = response.capacity();
    core::mem::forget(response);
    LAST_RESPONSE.with(|last| *last.borrow_mut() = Some((pointer, capacity)));
    ((length as u64) << 32 | (pointer as u64 & 0xffff_ffff)) as i64
}

#[no_mangle]
pub extern "C" fn mv_abi_version() -> i32 {
    1
}

#[no_mangle]
pub extern "C" fn mv_alloc(length: i32) -> i32 {
    alloc_request(length)
}

#[no_mangle]
pub extern "C" fn mv_run(pointer: i32, length: i32) -> i64 {
    reclaim_response();
    let mut request = take_request(pointer, length);
    let response = dispatch(&request);
    wipe(&mut request);
    finish_response(response)
}
