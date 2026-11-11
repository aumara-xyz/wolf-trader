//! NIP-01 events: canonical serialization, ids, signing and verification.
//!
//! Carried from aukora-wasm af58c0d `crates/nostr/src/event.rs`: the bounds
//! (64 KiB event, 256 tags, 32 fields per tag, created_at at most 2^53-1),
//! the control-character rule (only `\b \f \n \r \t` may appear), the
//! preimage `[0,pubkey,created_at,kind,tags,content]` with NIP-01 escaping,
//! the id as its SHA-256, and the refusal order of `decode_c1` (shape, parts,
//! id hex, public key, signature hex). serde becomes explicit reads of the
//! mv-abi request tree and an explicit writer with serde_json's escapes for
//! every character NIP-01 admits; created_at is seconds, as in the source.
//! Events that arrive inside encrypted layers are read by the source's
//! float-free `decode_c1` path (`crate::c1`), including the rumor's six keys.
//!
//! A verified event proves which key wrote these exact bytes. It is evidence
//! and memory, never authority.

use sha2::{Digest, Sha256};

use crate::c1::{self, ValueView};
use crate::keys::{self, Secret};
use crate::mv_abi::Value;
use crate::{hex, Map};

pub const MAX_EVENT_BYTES: usize = 65_536;
pub const MAX_TAGS: usize = 256;
pub const MAX_TAG_FIELDS: usize = 32;
const MAX_TIMESTAMP: i64 = 9_007_199_254_740_991;

/// The fields an author chooses; the signer adds `pubkey`, `id` and `sig`.
pub struct Draft {
    pub created_at: u64,
    pub kind: u16,
    pub tags: Vec<Vec<String>>,
    pub content: String,
}

/// An unsigned event (a NIP-59 rumor once it carries its id).
pub struct Unsigned {
    pub pubkey: [u8; 32],
    pub draft: Draft,
}

/// The seven NIP-01 fields. Construction alone verifies nothing.
pub struct Event {
    pub id: [u8; 32],
    pub unsigned: Unsigned,
    pub sig: [u8; 64],
}

// --- Rules -----------------------------------------------------------------------------

/// Bounds, control characters and total size of the author's parts.
pub fn validate_parts(created_at: u64, tags: &[Vec<String>], content: &str) -> Result<(), &'static str> {
    if created_at > MAX_TIMESTAMP as u64
        || tags.len() > MAX_TAGS
        || tags.iter().any(|tag| tag.is_empty() || tag.len() > MAX_TAG_FIELDS)
    {
        return Err("nostr:event-malformed");
    }
    for text in core::iter::once(content).chain(tags.iter().flatten().map(String::as_str)) {
        if text.chars().any(|c| c < '\u{20}' && !matches!(c, '\u{8}' | '\u{c}' | '\n' | '\r' | '\t')) {
            return Err("nostr:event-control-character");
        }
    }
    let mut total = content.len();
    for field in tags.iter().flatten() {
        total = total.checked_add(field.len()).ok_or("nostr:event-too-large")?;
    }
    check_size(total)
}

fn check_size(size: usize) -> Result<(), &'static str> {
    if size > MAX_EVENT_BYTES { Err("nostr:event-too-large") } else { Ok(()) }
}

// --- NIP-01 writer ---------------------------------------------------------------------

/// A JSON string with NIP-01's escapes (serde_json's for every admitted character).
pub fn write_text(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if c < '\u{20}' => {
                const DIGITS: &[u8; 16] = b"0123456789abcdef";
                out.push_str("\\u00");
                out.push(DIGITS[(c as usize) >> 4] as char);
                out.push(DIGITS[(c as usize) & 15] as char);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_tags(out: &mut String, tags: &[Vec<String>]) {
    out.push('[');
    for (index, tag) in tags.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push('[');
        for (position, field) in tag.iter().enumerate() {
            if position > 0 {
                out.push(',');
            }
            write_text(out, field);
        }
        out.push(']');
    }
    out.push(']');
}

/// `[0,"<pubkey>",created_at,kind,tags,"content"]`, bounded at 64 KiB.
pub fn preimage(unsigned: &Unsigned) -> Result<String, &'static str> {
    let draft = &unsigned.draft;
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    let mut out = String::with_capacity(96 + draft.content.len());
    out.push_str("[0,\"");
    out.push_str(&hex(&unsigned.pubkey));
    out.push_str("\",");
    out.push_str(&draft.created_at.to_string());
    out.push(',');
    out.push_str(&draft.kind.to_string());
    out.push(',');
    write_tags(&mut out, &draft.tags);
    out.push(',');
    write_text(&mut out, &draft.content);
    out.push(']');
    check_size(out.len())?;
    Ok(out)
}

pub fn content_id(unsigned: &Unsigned) -> Result<[u8; 32], &'static str> {
    Ok(Sha256::digest(preimage(unsigned)?.as_bytes()).into())
}

/// The wire JSON in NIP-01 field order (`id, pubkey, created_at, kind, tags,
/// content` and, when signed, `sig`), as the source's serde structs wrote it.
pub fn wire(id: &[u8; 32], unsigned: &Unsigned, sig: Option<&[u8; 64]>) -> Result<String, &'static str> {
    let draft = &unsigned.draft;
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    let mut out = String::with_capacity(256 + draft.content.len());
    out.push_str("{\"id\":\"");
    out.push_str(&hex(id));
    out.push_str("\",\"pubkey\":\"");
    out.push_str(&hex(&unsigned.pubkey));
    out.push_str("\",\"created_at\":");
    out.push_str(&draft.created_at.to_string());
    out.push_str(",\"kind\":");
    out.push_str(&draft.kind.to_string());
    out.push_str(",\"tags\":");
    write_tags(&mut out, &draft.tags);
    out.push_str(",\"content\":");
    write_text(&mut out, &draft.content);
    if let Some(sig) = sig {
        out.push_str(",\"sig\":\"");
        out.push_str(&hex(sig));
        out.push('"');
    }
    out.push('}');
    check_size(out.len())?;
    Ok(out)
}

// --- Sign and verify -------------------------------------------------------------------

/// Derive the author's key and sign the exact new id.
pub fn sign(secret: &Secret, draft: Draft, aux: &[u8; 32]) -> Result<Event, &'static str> {
    let unsigned = Unsigned { pubkey: secret.public(), draft };
    let id = content_id(&unsigned)?;
    let sig = secret.sign(&id, aux)?;
    let event = Event { id, unsigned, sig };
    wire(&event.id, &event.unsigned, Some(&event.sig))?;
    Ok(event)
}

/// Bounds, then the id against its preimage, then BIP-340 over the id.
pub fn verify(event: &Event) -> Result<(), &'static str> {
    wire(&event.id, &event.unsigned, Some(&event.sig))?;
    if content_id(&event.unsigned)? != event.id {
        return Err("nostr:event-id-mismatch");
    }
    if !keys::verify(&event.unsigned.pubkey, &event.id, &event.sig) {
        return Err("nostr:event-signature-invalid");
    }
    Ok(())
}

// --- Reading events from the request tree ----------------------------------------------

fn text(map: &Map, key: &str) -> Result<String, &'static str> {
    map.get(key).and_then(Value::as_str).map(str::to_owned).ok_or("nostr:event-malformed")
}

fn unsigned_int(map: &Map, key: &str, max: i64) -> Result<i64, &'static str> {
    match map.get(key).and_then(Value::as_int) {
        Some(number) if (0..=max).contains(&number) => Ok(number),
        _ => Err("nostr:event-malformed"),
    }
}

fn tags(map: &Map) -> Result<Vec<Vec<String>>, &'static str> {
    let rows = map.get("tags").and_then(Value::as_array).ok_or("nostr:event-malformed")?;
    rows.iter()
        .map(|row| {
            row.as_array()
                .ok_or("nostr:event-malformed")?
                .iter()
                .map(|field| field.as_str().map(str::to_owned).ok_or("nostr:event-malformed"))
                .collect()
        })
        .collect()
}

/// Lowercase hex of exactly `N` bytes.
pub fn fixed_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    let raw = text.as_bytes();
    if raw.len() != N * 2 {
        return None;
    }
    let mut out = [0u8; N];
    for (index, pair) in raw.chunks(2).enumerate() {
        out[index] = crate::nibble(pair[0])? << 4 | crate::nibble(pair[1])?;
    }
    Some(out)
}

fn object<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map, &'static str> {
    match value {
        Value::Object(map) if map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)) => Ok(map),
        _ => Err("nostr:event-malformed"),
    }
}

fn read_draft(map: &Map) -> Result<Draft, &'static str> {
    let draft = Draft {
        created_at: unsigned_int(map, "created_at", MAX_TIMESTAMP)? as u64,
        kind: unsigned_int(map, "kind", i64::from(u16::MAX))? as u16,
        tags: tags(map)?,
        content: text(map, "content")?,
    };
    Ok(draft)
}

fn read_pubkey(map: &Map) -> Result<[u8; 32], &'static str> {
    let key = fixed_hex::<32>(&text(map, "pubkey")?).ok_or("nostr:public-key-invalid")?;
    if !keys::valid_point(&key) {
        return Err("nostr:public-key-invalid");
    }
    Ok(key)
}

/// `{created_at, kind, tags, content}`.
pub fn draft_from(value: &Value) -> Result<Draft, &'static str> {
    let draft = read_draft(object(value, &["content", "created_at", "kind", "tags"])?)?;
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    Ok(draft)
}

/// `{pubkey, created_at, kind, tags, content}`.
pub fn unsigned_from(value: &Value) -> Result<Unsigned, &'static str> {
    let map = object(value, &["content", "created_at", "kind", "pubkey", "tags"])?;
    text(map, "pubkey")?;
    let draft = read_draft(map)?;
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    Ok(Unsigned { pubkey: read_pubkey(map)?, draft })
}

/// The seven NIP-01 fields, in the source's refusal order.
pub fn event_from(value: &Value) -> Result<Event, &'static str> {
    let map = object(value, &["content", "created_at", "id", "kind", "pubkey", "sig", "tags"])?;
    let (id, pubkey, sig) = (text(map, "id")?, text(map, "pubkey")?, text(map, "sig")?);
    let draft = read_draft(map)?;
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    let id = fixed_hex::<32>(&id).ok_or("nostr:event-hex-invalid")?;
    let pubkey = {
        let key = fixed_hex::<32>(&pubkey).ok_or("nostr:public-key-invalid")?;
        if !keys::valid_point(&key) {
            return Err("nostr:public-key-invalid");
        }
        key
    };
    let sig = fixed_hex::<64>(&sig).ok_or("nostr:event-hex-invalid")?;
    Ok(Event { id, unsigned: Unsigned { pubkey, draft }, sig })
}

// --- Writing events into the response tree ---------------------------------------------

fn tags_value(tags: &[Vec<String>]) -> Value {
    Value::Array(tags.iter().map(|tag| Value::Array(tag.iter().map(|field| Value::str(field.clone())).collect())).collect())
}

pub fn unsigned_value(id: &[u8; 32], unsigned: &Unsigned) -> Value {
    let draft = &unsigned.draft;
    Value::obj(vec![
        ("content", Value::str(draft.content.clone())),
        ("created_at", Value::Int(draft.created_at as i64)),
        ("id", Value::str(hex(id))),
        ("kind", Value::Int(i64::from(draft.kind))),
        ("pubkey", Value::str(hex(&unsigned.pubkey))),
        ("tags", tags_value(&draft.tags)),
    ])
}

pub fn event_value(event: &Event) -> Value {
    let mut value = unsigned_value(&event.id, &event.unsigned);
    if let Value::Object(map) = &mut value {
        map.insert("sig".to_owned(), Value::str(hex(&event.sig)));
    }
    value
}

// --- Reading events off the wire (decode_c1) ------------------------------------------

/// Bounded at 64 KiB and starting (after whitespace) with an object.
fn check_object(bytes: &[u8]) -> Result<(), &'static str> {
    check_size(bytes.len())?;
    let first = bytes.iter().copied().find(|b| !matches!(b, b' ' | b'\n' | b'\r' | b'\t'));
    if first == Some(b'{') { Ok(()) } else { Err("nostr:event-malformed") }
}

/// C1 excludes CR whitespace; NIP-01 permits it. Turn unquoted CR into space
/// without permitting raw controls inside strings.
fn event_whitespace(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if !bytes.contains(&b'\r') {
        return std::borrow::Cow::Borrowed(bytes);
    }
    let mut normalized = bytes.to_vec();
    let mut quoted = false;
    let mut escaped = false;
    for byte in &mut normalized {
        if quoted {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                quoted = false;
            }
        } else if *byte == b'"' {
            quoted = true;
        } else if *byte == b'\r' {
            *byte = b' ';
        }
    }
    std::borrow::Cow::Owned(normalized)
}

fn wire_object(bytes: &[u8], fields: &[&str]) -> Result<c1::Value, &'static str> {
    check_object(bytes)?;
    let normalized = event_whitespace(bytes);
    let value = c1::parse_strict(&normalized).map_err(|code| if code == c1::CANON_DUPLICATE_KEY { code } else { "nostr:event-malformed" })?;
    let ValueView::Object(members) = value.view() else { return Err("nostr:event-malformed") };
    if members.len() != fields.len() || members.iter().any(|(key, _)| !fields.contains(&key.as_str())) {
        return Err("nostr:event-malformed");
    }
    Ok(value)
}

fn wire_text<'a>(value: &'a c1::Value, key: &str) -> Result<&'a str, &'static str> {
    match value.get(key).map(c1::Value::view) {
        Some(ValueView::Text(text)) => Ok(text),
        _ => Err("nostr:event-malformed"),
    }
}

fn wire_unsigned(value: &c1::Value, key: &str) -> Result<u64, &'static str> {
    match value.get(key).map(c1::Value::view) {
        Some(ValueView::Integer(number)) => u64::try_from(number).map_err(|_| "nostr:event-malformed"),
        _ => Err("nostr:event-malformed"),
    }
}

fn wire_tags(value: &c1::Value) -> Result<Vec<Vec<String>>, &'static str> {
    let Some(ValueView::Array(rows)) = value.get("tags").map(c1::Value::view) else { return Err("nostr:event-malformed") };
    rows.iter()
        .map(|row| match row.view() {
            ValueView::Array(fields) => fields
                .iter()
                .map(|field| match field.view() {
                    ValueView::Text(text) => Ok(text.to_owned()),
                    _ => Err("nostr:event-malformed"),
                })
                .collect(),
            _ => Err("nostr:event-malformed"),
        })
        .collect()
}

/// Typed fields in the source's order: shape first, then parts, then hex.
fn wire_parts(value: &c1::Value) -> Result<(String, String, Draft), &'static str> {
    let id = wire_text(value, "id")?.to_owned();
    let pubkey = wire_text(value, "pubkey")?.to_owned();
    let created_at = wire_unsigned(value, "created_at")?;
    let kind = u16::try_from(wire_unsigned(value, "kind")?).map_err(|_| "nostr:event-malformed")?;
    let tags = wire_tags(value)?;
    let content = wire_text(value, "content")?.to_owned();
    Ok((id, pubkey, Draft { created_at, kind, tags, content }))
}

fn wire_pubkey(text: &str) -> Result<[u8; 32], &'static str> {
    let key = fixed_hex::<32>(text).ok_or("nostr:public-key-invalid")?;
    if !keys::valid_point(&key) {
        return Err("nostr:public-key-invalid");
    }
    Ok(key)
}

/// A seven-key event from wire bytes (`Event::decode_c1`). Decoding is not verification.
pub fn decode_event(bytes: &[u8]) -> Result<Event, &'static str> {
    let value = wire_object(bytes, &["id", "pubkey", "created_at", "kind", "tags", "content", "sig"])?;
    let (id, pubkey, draft) = wire_parts(&value)?;
    let sig = wire_text(&value, "sig")?.to_owned();
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    let id = fixed_hex::<32>(&id).ok_or("nostr:event-hex-invalid")?;
    let pubkey = wire_pubkey(&pubkey)?;
    let sig = fixed_hex::<64>(&sig).ok_or("nostr:event-hex-invalid")?;
    Ok(Event { id, unsigned: Unsigned { pubkey, draft }, sig })
}

/// A six-key NIP-59 rumor from wire bytes. Its id is not authentication.
pub fn decode_rumor(bytes: &[u8]) -> Result<([u8; 32], Unsigned), &'static str> {
    let value = wire_object(bytes, &["id", "pubkey", "created_at", "kind", "tags", "content"])?;
    let (id, pubkey, draft) = wire_parts(&value)?;
    validate_parts(draft.created_at, &draft.tags, &draft.content)?;
    let id = fixed_hex::<32>(&id).ok_or("nostr:event-hex-invalid")?;
    Ok((id, Unsigned { pubkey: wire_pubkey(&pubkey)?, draft }))
}
