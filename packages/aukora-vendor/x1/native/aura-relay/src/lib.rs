//! Aura relay on the Microverse ABI v1 surface (plan §0D.4, "Nostr is core").
//!
//! The organism's own local relay: one append-only log of signed NIP-01
//! events that mirrors her records (Aura receipts, owner card decisions,
//! Kira notes, mailbox notes, lane results) and witnesses itself with a
//! signed Aura head. The Host
//! (`src/aura-relay.ts`) only moves bytes: it reads and appends the log,
//! fsyncs, looks up ids it already holds, and checks BIP-340 signatures with
//! the pinned `kira-nostr` primitive. This cell decides everything else:
//!
//! - `relay.admit` / `relay.replay`: whether one event (or a replayed log)
//!   is valid: exact NIP-01 shape and bounds, the id recomputed here with
//!   SHA-256 over the NIP-01 serialization, the signature fact, the closed
//!   kind catalog, which principal may sign which kind, and each kind's tag
//!   and content schema. It advances the RFC 6962 Merkle frontier over event
//!   ids and returns the index entry the Host keeps for queries.
//! - `relay.head` / `relay.check`: when a signed head is due, its exact
//!   canonical content, and whether the log on disk still contains the last
//!   retained head (rollback, truncation and fork detection).
//! - `relay.mirror`: how each organism record becomes an event draft, which
//!   key signs it, and what stays out of plaintext.
//! - `relay.query`: NIP-01 filters (ids, authors, kinds, single-letter tags,
//!   since, until, limit) over the Host's index entries.
//!
//! Events are evidence and memory, never authority. No kind here can open,
//! approve, extend or widen a grant; kinds that carry grants, approvals or
//! admissions elsewhere are refused `KIND_AUTHORITY`, and every admission
//! answers `authority: "none"`. The grant ledger never reads this log.
//!
//! Exports exactly `memory`, `mv_abi_version`, `mv_alloc`, `mv_run` before the
//! builder-side `mv-meter` transform adds the fuel exports; no imports and no
//! float instructions. Requests and responses are canonical JSON via the
//! vendored `mv-abi` crate, bounded at 1 MiB each.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use mv_abi::{encode, parse, Value};

type Map = BTreeMap<String, Value>;
type Answer = Result<Value, &'static str>;

const MAX_REQUEST_BYTES: usize = 1_048_576;
const MAX_RESPONSE_BYTES: usize = 1_048_576;
const MAX_ALLOC_BYTES: usize = 1_048_576;
const INT_MAX: i64 = 9_007_199_254_740_991;

/// NIP-01 wire bounds, carried from aukora-wasm `crates/nostr/src/event.rs`.
const MAX_EVENT_BYTES: usize = 65_536;
const MAX_TAGS: usize = 256;
const MAX_TAG_FIELDS: usize = 32;
/// Serialized event length minus NIP-01 preimage length: the seven keys, the
/// 64-hex id and the 128-hex signature, less the preimage's own punctuation.
const WIRE_OVERHEAD: usize = 253;
/// One Kira note's content, as `kira-membrane` bounds it.
const MAX_NOTE_CONTENT: usize = 16_384;

/// Seconds an appended event may be ahead of the Host clock.
const FUTURE_SKEW: i64 = 60;
/// Seconds a head may differ from the Host clock when it is appended.
const HEAD_SKEW: i64 = 600;
/// A head is due after this many entries since the last head ...
const HEAD_EVERY: i64 = 64;
/// ... or this many seconds after it, once anything new is logged.
const HEAD_PERIOD: i64 = 600;

const MAX_PRINCIPALS: usize = 256;
const MAX_BATCH: usize = 4_096;
const MAX_ENTRIES: usize = 65_536;
const MAX_ROOT_ENTRIES: usize = 4_096;
const MAX_FILTERS: usize = 16;
const MAX_FILTER_VALUES: usize = 256;
const MAX_LIMIT: i64 = 5_000;
const MAX_COMMITS: usize = 32;
const MAX_PATHS: usize = 200;
/// Bytes of changed paths one lane result carries; the rest is counted.
const PATH_BUDGET: usize = 49_152;

// --- Kind catalog ------------------------------------------------------------------

/// Kira 2 note and supersede (Sovereign `crates/kira/src/shared/note.rs`).
const KIND_NOTE: i64 = 4500;
const KIND_SUPERSEDE: i64 = 4501;
/// Aura receipt: one owner grant-ledger row.
const KIND_RECEIPT: i64 = 4530;
/// Aura receipt: one goal/task binding decision (`goal-receipts`).
const KIND_GOAL: i64 = 4531;
/// Kira note reference: a note kept by id and hash, never in plaintext here.
const KIND_NOTE_REF: i64 = 4532;
/// Mailbox note reference (`aukora/mail`), content-addressed.
const KIND_MAIL: i64 = 4533;
/// Lane result: commits and changed paths of one lane run.
const KIND_LANE: i64 = 4534;
/// Aura receipt: one owner card decision (shown, approved, declined,
/// withdrawn, refused) or an owner STOP, as the owner service saw it. No
/// other kind fits: 4530 is a row the grant-ledger cell wrote, and a card
/// that is shown, declined or withdrawn never reaches the ledger.
const KIND_OWNER: i64 = 4535;
/// Aura head witness (aukora-wasm `crates/relay/src/witness.rs`, NS-05).
const KIND_HEAD: i64 = 30_078;
/// Kinds that carry grants, approvals, admissions or remote signing elsewhere
/// (Sovereign cellcheck 4521, agent revocation 4523, agent grant 4526, phone
/// approval 30333, invite grant 39703 and admission 39704, NIP-46 24133).
const AUTHORITY_KINDS: [i64; 7] = [4521, 4523, 4526, 24_133, 30_333, 39_703, 39_704];

const HEAD_IDENTIFIER: &str = "aukora-aura-head";
const HEAD_SCHEMA: &str = "aukora-aura-retained-head-v1";
const LEAF_CONVENTION: &str = "rfc6962-leaf-sha256-0x00-prefixed-v1";

const RECEIPT_KINDS: [&str; 7] = ["grant", "permit", "complete", "expire", "revoke", "refuse", "chain"];
const OWNER_DECISIONS: [&str; 6] = ["shown", "approved", "declined", "withdrawn", "refused", "stop"];
const DECISIONS: [&str; 3] = ["CLEAR", "ASK", "UNSUPPORTED"];
const PRIVACY: [&str; 3] = ["local", "builders", "public"];
const SHAREABLE: [&str; 2] = ["builders", "public"];
const KIRA_LANES: [&str; 7] = ["evidence", "experience", "charter", "ruling", "decision", "finding", "slot"];
const MAIL_BOXES: [&str; 2] = ["to-x1", "to-claude"];
const LANES: [&str; 4] = ["claude", "codex", "grok", "kimi"];
const KIRA_TAGS: [&str; 6] = ["lane", "form", "privacy", "scope", "e", "to"];
/// First segments no principal may carry (as `kira-membrane` reserves them).
const RESERVED: [&str; 7] = ["owner", "peter", "all", "everyone", "kira", "host", "system"];

const PREFIX_LEDGER: &str = "aukora-ledger:";
const PREFIX_GOAL: &str = "aukora-goal:";
const PREFIX_KIRA: &str = "aukora-kira:";
const PREFIX_MAIL: &str = "aukora-mail:";
const PREFIX_LANE: &str = "aukora-lane:";
const PREFIX_OWNER: &str = "aukora-owner:";

// --- Input helpers -------------------------------------------------------------------

fn only_keys(map: &Map, allowed: &[&str]) -> bool {
    map.keys().all(|key| allowed.contains(&key.as_str()))
}

fn object(value: &Value) -> Result<&Map, &'static str> {
    match value {
        Value::Object(map) => Ok(map),
        _ => Err("INVALID_INPUT"),
    }
}

fn closed<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map, &'static str> {
    let map = object(value)?;
    if only_keys(map, keys) { Ok(map) } else { Err("MALFORMED") }
}

fn field<'a>(map: &'a Map, key: &str) -> Result<&'a Value, &'static str> {
    map.get(key).ok_or("INVALID_INPUT")
}

/// A present, non-null value, or None.
fn optional<'a>(map: &'a Map, key: &str) -> Option<&'a Value> {
    match map.get(key) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value),
    }
}

fn text<'a>(map: &'a Map, key: &str) -> Result<&'a str, &'static str> {
    field(map, key)?.as_str().ok_or("INVALID_INPUT")
}

fn int(map: &Map, key: &str) -> Result<i64, &'static str> {
    field(map, key)?.as_int().ok_or("INVALID_INPUT")
}

fn count(map: &Map, key: &str) -> Result<i64, &'static str> {
    let value = int(map, key)?;
    if value < 0 { Err("INVALID_INPUT") } else { Ok(value) }
}

fn flag(map: &Map, key: &str) -> Result<bool, &'static str> {
    match field(map, key)? {
        Value::Bool(value) => Ok(*value),
        _ => Err("INVALID_INPUT"),
    }
}

fn array<'a>(map: &'a Map, key: &str) -> Result<&'a [Value], &'static str> {
    field(map, key)?.as_array().ok_or("INVALID_INPUT")
}

fn strings_of(value: &Value) -> Result<Vec<&str>, &'static str> {
    value.as_array().ok_or("INVALID_INPUT")?.iter().map(|item| item.as_str().ok_or("INVALID_INPUT")).collect()
}

fn tag(name: &str, value: &str) -> Value {
    Value::Array(vec![Value::str(name), Value::str(value)])
}

// --- Value formats -------------------------------------------------------------------

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex64(value: &str) -> bool {
    lower_hex(value, 64)
}

fn commit_hex(value: &str) -> bool {
    (7..=64).contains(&value.len()) && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn base_sha(value: &str) -> bool {
    lower_hex(value, 40) || lower_hex(value, 64)
}

/// Identifiers the ledger and lanes mint (`grant-<uuid>`, `task-<uuid>`, run ids).
fn id_text(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

/// A permit attempt: a call id, or `{child grant}|{call id}` when the permit
/// was spent through a schedule or delegated child (the grant-ledger cell's
/// child attempt prefix).
fn attempt_text(value: &str) -> bool {
    match value.split_once('|') {
        Some((child, call)) => id_text(child) && id_text(call),
        None => id_text(value),
    }
}

fn token(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.bytes().all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-'))
}

fn decimal(value: &str) -> bool {
    (1..=16).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn exit_text(value: &str) -> bool {
    value == "none" || decimal(value) || value.strip_prefix('-').is_some_and(|rest| rest != "0" && decimal(rest))
}

fn bool_text(value: &str) -> bool {
    value == "true" || value == "false"
}

/// A copied timestamp fact; the Host parses dates, the cell only bounds the text.
fn iso_text(value: &str) -> bool {
    (1..=40).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'T' | b'Z' | b':' | b'.' | b'+' | b'-'))
}

fn author_text(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b':' | b'-'))
}

fn file_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=64).contains(&bytes.len())
        && matches!(bytes[0], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9')
        && bytes.iter().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && !value.contains("..")
}

/// A changed path as git names it: relative, no NUL or control, no `..` segment.
fn path_text(value: &str) -> bool {
    (1..=1024).contains(&value.len())
        && !value.starts_with('/')
        && !value.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
        && !value.split('/').any(|segment| segment.is_empty() || segment == "..")
}

fn short_text(value: &str) -> bool {
    (1..=256).contains(&value.len())
}

fn one_of(value: &str, set: &[&str]) -> bool {
    set.contains(&value)
}

// --- SHA-256 (carried from X1 main `native/laya/src/lib.rs`, FIPS 180-4) -------------

fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut message = Vec::with_capacity(input.len() + 72);
    message.extend_from_slice(input);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut out = [0u8; 32];
    for (index, value) in h.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn unhex32(value: &str) -> Option<[u8; 32]> {
    if !hex64(value) {
        return None;
    }
    let digit = |byte: u8| if byte <= b'9' { byte - b'0' } else { byte - b'a' + 10 };
    let bytes = value.as_bytes();
    let mut out = [0u8; 32];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = (digit(bytes[index * 2]) << 4) | digit(bytes[index * 2 + 1]);
    }
    Some(out)
}

fn digest_hex(bytes: &[u8]) -> String {
    hex(&sha256(bytes))
}

// --- RFC 6962 Merkle frontier (carried from aukora-wasm `crates/aura-core/src/merkle.rs`)

fn merkle_leaf(entry: &[u8; 32]) -> [u8; 32] {
    let mut preimage = [0u8; 33];
    preimage[1..].copy_from_slice(entry);
    sha256(&preimage)
}

fn merkle_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut preimage = [0u8; 65];
    preimage[0] = 1;
    preimage[1..33].copy_from_slice(left);
    preimage[33..].copy_from_slice(right);
    sha256(&preimage)
}

fn frontier_push(frontier: &mut Vec<Option<[u8; 32]>>, entry: &[u8; 32]) {
    let mut carry = merkle_leaf(entry);
    for slot in frontier.iter_mut() {
        match slot.take() {
            Some(left) => carry = merkle_node(&left, &carry),
            None => {
                *slot = Some(carry);
                return;
            }
        }
    }
    frontier.push(Some(carry));
}

fn frontier_root(frontier: &[Option<[u8; 32]>]) -> [u8; 32] {
    frontier
        .iter()
        .flatten()
        .copied()
        .reduce(|right, left| merkle_node(&left, &right))
        .unwrap_or_else(|| sha256(&[]))
}

fn bit_length(size: i64) -> usize {
    (64 - (size as u64).leading_zeros()) as usize
}

// --- Relay state ---------------------------------------------------------------------

/// The last head appended to the log: it commits to the first `size` entries.
#[derive(Clone)]
struct Head {
    size: i64,
    id: String,
    at: i64,
}

/// The Host carries this between calls; the cell validates and advances it.
#[derive(Clone)]
struct State {
    size: i64,
    last: String,
    frontier: Vec<Option<[u8; 32]>>,
    head: Option<Head>,
}

impl State {
    fn genesis() -> Self {
        State { size: 0, last: String::new(), frontier: Vec::new(), head: None }
    }

    fn root(&self) -> String {
        hex(&frontier_root(&self.frontier))
    }

    fn push(&mut self, id: &str) -> Result<(), &'static str> {
        let entry = unhex32(id).ok_or("EVENT_HEX")?;
        if self.size >= INT_MAX {
            return Err("LOG_FULL");
        }
        frontier_push(&mut self.frontier, &entry);
        self.size += 1;
        self.last = id.to_string();
        Ok(())
    }

    fn value(&self) -> Value {
        let frontier = self
            .frontier
            .iter()
            .map(|slot| Value::str(slot.map(|digest| hex(&digest)).unwrap_or_default()))
            .collect();
        let head = match &self.head {
            None => Value::Null,
            Some(head) => Value::obj(vec![
                ("at", Value::Int(head.at)),
                ("id", Value::str(head.id.as_str())),
                ("size", Value::Int(head.size)),
            ]),
        };
        Value::obj(vec![
            ("frontier", Value::Array(frontier)),
            ("head", head),
            ("last", Value::str(self.last.as_str())),
            ("size", Value::Int(self.size)),
        ])
    }
}

fn state_of(value: &Value) -> Result<State, &'static str> {
    let map = closed(value, &["frontier", "head", "last", "size"]).map_err(|_| "STATE_INVALID")?;
    let size = count(map, "size").map_err(|_| "STATE_INVALID")?;
    let last = text(map, "last").map_err(|_| "STATE_INVALID")?;
    if (size == 0) != last.is_empty() || (size > 0 && !hex64(last)) {
        return Err("STATE_INVALID");
    }
    let slots = array(map, "frontier").map_err(|_| "STATE_INVALID")?;
    if slots.len() != bit_length(size) {
        return Err("STATE_INVALID");
    }
    let mut frontier = Vec::with_capacity(slots.len());
    for (level, slot) in slots.iter().enumerate() {
        let digest = slot.as_str().ok_or("STATE_INVALID")?;
        let occupied = (size >> level) & 1 == 1;
        match (occupied, digest.is_empty()) {
            (true, false) => frontier.push(Some(unhex32(digest).ok_or("STATE_INVALID")?)),
            (false, true) => frontier.push(None),
            _ => return Err("STATE_INVALID"),
        }
    }
    let head = match field(map, "head").map_err(|_| "STATE_INVALID")? {
        Value::Null => None,
        value => {
            let head = closed(value, &["at", "id", "size"]).map_err(|_| "STATE_INVALID")?;
            let head = Head {
                size: count(head, "size").map_err(|_| "STATE_INVALID")?,
                id: text(head, "id").map_err(|_| "STATE_INVALID")?.to_string(),
                at: count(head, "at").map_err(|_| "STATE_INVALID")?,
            };
            if head.size < 1 || head.size >= size || !hex64(&head.id) {
                return Err("STATE_INVALID");
            }
            Some(head)
        }
    };
    Ok(State { size, last: last.to_string(), frontier, head })
}

/// Whether a signed head is due: anything since the last head, and either no
/// head yet, `HEAD_EVERY` entries since it, or `HEAD_PERIOD` seconds after it.
fn head_due(state: &State, now: i64) -> bool {
    let since = state.size - state.head.as_ref().map_or(0, |head| head.size + 1);
    since >= 1
        && match &state.head {
            None => true,
            Some(head) => since >= HEAD_EVERY || now.saturating_sub(head.at) >= HEAD_PERIOD,
        }
}

/// The exact C3 retained-head bytes (aukora-wasm `RetainedHeadV1::canonical_bytes`).
fn head_content(state: &State) -> String {
    format!(
        "{{\"hash\":\"{}\",\"leafConvention\":\"{}\",\"root\":\"{}\",\"schema\":\"{}\",\"sequence\":{},\"treeSize\":{}}}",
        state.last,
        LEAF_CONVENTION,
        state.root(),
        HEAD_SCHEMA,
        state.size,
        state.size,
    )
}

struct RetainedHead {
    size: i64,
}

/// Parse only the exact canonical six-key C3 object (aukora-wasm `RetainedHeadV1::parse`).
fn parse_head(content: &str) -> Option<RetainedHead> {
    if content.len() > 512 {
        return None;
    }
    let rest = content.strip_prefix("{\"hash\":\"")?;
    let (hash, rest) = rest.split_once("\",\"leafConvention\":\"")?;
    let (convention, rest) = rest.split_once("\",\"root\":\"")?;
    let (root, rest) = rest.split_once("\",\"schema\":\"")?;
    let (schema, rest) = rest.split_once("\",\"sequence\":")?;
    let (sequence, tree_size) = rest.split_once(",\"treeSize\":")?;
    let tree_size = tree_size.strip_suffix('}')?;
    let positive = |text: &str| -> Option<i64> {
        if !decimal(text) || text == "0" {
            return None;
        }
        let value: i64 = text.parse().ok()?;
        if value > INT_MAX { None } else { Some(value) }
    };
    let sequence = positive(sequence)?;
    if convention != LEAF_CONVENTION || schema != HEAD_SCHEMA || !hex64(hash) || !hex64(root) || positive(tree_size)? != sequence {
        return None;
    }
    Some(RetainedHead { size: sequence })
}

// --- Keys: the Aura witness and the Kira principals ----------------------------------

struct Keys {
    witness: String,
    principals: Vec<(String, String)>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Signer<'a> {
    Witness,
    Principal(&'a str),
}

fn segment(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 32
        && matches!(bytes[0], b'a'..=b'z' | b'0'..=b'9')
        && bytes[1..].iter().all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

/// A Kira principal name (`kira-membrane` rules): one to three segments, not reserved.
fn principal_name(name: &str) -> bool {
    let parts: Vec<&str> = name.split('/').collect();
    parts.len() <= 3
        && parts.iter().all(|part| segment(part))
        && !RESERVED.contains(&parts[0])
        && !(parts.len() == 1 && parts[0] == "lane")
}

fn keys_of(value: &Value) -> Result<Keys, &'static str> {
    let map = closed(value, &["principals", "witness"]).map_err(|_| "KEYS_INVALID")?;
    let witness = text(map, "witness").map_err(|_| "KEYS_INVALID")?;
    if !hex64(witness) {
        return Err("KEYS_INVALID");
    }
    let rows = array(map, "principals").map_err(|_| "KEYS_INVALID")?;
    if rows.len() > MAX_PRINCIPALS {
        return Err("KEYS_INVALID");
    }
    // Names may repeat: Kira rotates a key by revoking a row and adding a new
    // one under the same name, and old rows still name who wrote old events.
    let mut pubkeys = BTreeSet::from([witness.to_string()]);
    let mut principals = Vec::with_capacity(rows.len());
    for row in rows {
        let row = closed(row, &["name", "pubkey"]).map_err(|_| "KEYS_INVALID")?;
        let name = text(row, "name").map_err(|_| "KEYS_INVALID")?;
        let pubkey = text(row, "pubkey").map_err(|_| "KEYS_INVALID")?;
        if !principal_name(name) || !hex64(pubkey) || !pubkeys.insert(pubkey.to_string()) {
            return Err("KEYS_INVALID");
        }
        principals.push((name.to_string(), pubkey.to_string()));
    }
    Ok(Keys { witness: witness.to_string(), principals })
}

fn signer_of<'a>(keys: &'a Keys, pubkey: &str) -> Option<Signer<'a>> {
    if keys.witness == pubkey {
        return Some(Signer::Witness);
    }
    keys.principals.iter().find(|(_, key)| key == pubkey).map(|(name, _)| Signer::Principal(name.as_str()))
}

fn has_principal(keys: &Keys, name: &str) -> bool {
    keys.principals.iter().any(|(known, _)| known == name)
}

fn sign_as(signer: Signer<'_>) -> Value {
    match signer {
        Signer::Witness => Value::obj(vec![("role", Value::str("witness"))]),
        Signer::Principal(name) => Value::obj(vec![("name", Value::str(name)), ("role", Value::str("principal"))]),
    }
}

// --- NIP-01 events ---------------------------------------------------------------------

struct Event {
    id: String,
    pubkey: String,
    created_at: i64,
    kind: i64,
    tags: Vec<Vec<String>>,
    content: String,
    sig: String,
}

const EVENT_KEYS: [&str; 7] = ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"];

fn tags_of(value: &Value) -> Result<Vec<Vec<String>>, &'static str> {
    let rows = value.as_array().ok_or("EVENT_MALFORMED")?;
    if rows.len() > MAX_TAGS {
        return Err("EVENT_TAGS");
    }
    let mut tags = Vec::with_capacity(rows.len());
    for row in rows {
        let fields = row.as_array().ok_or("EVENT_MALFORMED")?;
        if fields.is_empty() || fields.len() > MAX_TAG_FIELDS {
            return Err("EVENT_TAGS");
        }
        tags.push(fields.iter().map(|cell| cell.as_str().map(str::to_string).ok_or("EVENT_MALFORMED")).collect::<Result<Vec<_>, _>>()?);
    }
    Ok(tags)
}

/// Exactly the seven NIP-01 fields with their wire types. Parsing grants no trust.
fn event_of(value: &Value) -> Result<Event, &'static str> {
    let map = match value {
        Value::Object(map) if map.len() == EVENT_KEYS.len() && only_keys(map, &EVENT_KEYS) => map,
        _ => return Err("EVENT_MALFORMED"),
    };
    let string = |key: &str| text(map, key).map_err(|_| "EVENT_MALFORMED");
    let (id, pubkey, sig) = (string("id")?, string("pubkey")?, string("sig")?);
    if !hex64(id) || !hex64(pubkey) || !lower_hex(sig, 128) {
        return Err("EVENT_HEX");
    }
    let created_at = int(map, "created_at").map_err(|_| "EVENT_MALFORMED")?;
    let kind = int(map, "kind").map_err(|_| "EVENT_MALFORMED")?;
    if created_at < 0 || !(0..=65_535).contains(&kind) {
        return Err("EVENT_MALFORMED");
    }
    Ok(Event {
        id: id.to_string(),
        pubkey: pubkey.to_string(),
        created_at,
        kind,
        tags: tags_of(field(map, "tags")?)?,
        content: string("content")?.to_string(),
        sig: sig.to_string(),
    })
}

fn event_value(event: &Event) -> Value {
    Value::obj(vec![
        ("content", Value::str(event.content.as_str())),
        ("created_at", Value::Int(event.created_at)),
        ("id", Value::str(event.id.as_str())),
        ("kind", Value::Int(event.kind)),
        ("pubkey", Value::str(event.pubkey.as_str())),
        ("sig", Value::str(event.sig.as_str())),
        ("tags", tags_value(&event.tags)),
    ])
}

fn tags_value(tags: &[Vec<String>]) -> Value {
    Value::Array(tags.iter().map(|row| Value::Array(row.iter().map(|cell| Value::str(cell.as_str())).collect())).collect())
}

/// NIP-01 permits only the five JSON short escapes among control characters
/// (Hokkaido `nostr_verify::event`; `kira-nostr` `nip01Text`).
fn nip01_text(value: &str) -> bool {
    !value.bytes().any(|byte| byte < 0x20 && !matches!(byte, 0x08 | 0x09 | 0x0a | 0x0c | 0x0d))
}

/// One string exactly as `JSON.stringify` writes it.
fn nip01_string(value: &str, out: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push(b'"');
    for &byte in value.as_bytes() {
        match byte {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x09 => out.extend_from_slice(b"\\t"),
            0x0a => out.extend_from_slice(b"\\n"),
            0x0c => out.extend_from_slice(b"\\f"),
            0x0d => out.extend_from_slice(b"\\r"),
            0x00..=0x1f => {
                out.extend_from_slice(b"\\u00");
                out.push(HEX[(byte >> 4) as usize]);
                out.push(HEX[(byte & 0x0f) as usize]);
            }
            _ => out.push(byte),
        }
    }
    out.push(b'"');
}

/// `[0,pubkey,created_at,kind,tags,content]`, the NIP-01 id preimage.
fn preimage(pubkey: &str, created_at: i64, kind: i64, tags: &[Vec<String>], content: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(content.len() + 256);
    out.extend_from_slice(b"[0,");
    nip01_string(pubkey, &mut out);
    out.push(b',');
    out.extend_from_slice(created_at.to_string().as_bytes());
    out.push(b',');
    out.extend_from_slice(kind.to_string().as_bytes());
    out.extend_from_slice(b",[");
    for (row, fields) in tags.iter().enumerate() {
        if row > 0 {
            out.push(b',');
        }
        out.push(b'[');
        for (index, cell) in fields.iter().enumerate() {
            if index > 0 {
                out.push(b',');
            }
            nip01_string(cell, &mut out);
        }
        out.push(b']');
    }
    out.extend_from_slice(b"],");
    nip01_string(content, &mut out);
    out.push(b']');
    out
}

/// Bounds, text rules and the id this cell computes; returns the computed id.
fn event_id(pubkey: &str, created_at: i64, kind: i64, tags: &[Vec<String>], content: &str) -> Result<String, &'static str> {
    if !nip01_text(content) || !tags.iter().flatten().all(|cell| nip01_text(cell)) {
        return Err("EVENT_CONTROL");
    }
    let bytes = preimage(pubkey, created_at, kind, tags, content);
    if bytes.len() + WIRE_OVERHEAD > MAX_EVENT_BYTES {
        return Err("EVENT_TOO_LARGE");
    }
    Ok(digest_hex(&bytes))
}

// --- Per-kind schemas -------------------------------------------------------------------

struct Spec {
    name: &'static str,
    min: usize,
    max: usize,
    check: fn(&str) -> bool,
}

const fn spec(name: &'static str, min: usize, max: usize, check: fn(&str) -> bool) -> Spec {
    Spec { name, min, max, check }
}

type Tags<'a> = BTreeMap<&'a str, Vec<&'a str>>;

/// Two-field tags only, every name in the spec list, counts and values checked.
fn check_tags<'a>(tags: &'a [Vec<String>], specs: &[Spec]) -> Result<Tags<'a>, &'static str> {
    let mut seen: Tags<'a> = BTreeMap::new();
    for row in tags {
        if row.len() != 2 {
            return Err("TAG_SHAPE");
        }
        let spec = specs.iter().find(|spec| spec.name == row[0]).ok_or("TAG_UNKNOWN")?;
        if !(spec.check)(&row[1]) {
            return Err("TAG_VALUE");
        }
        seen.entry(spec.name).or_default().push(row[1].as_str());
    }
    for spec in specs {
        let found = seen.get(spec.name).map_or(0, Vec::len);
        if found < spec.min || found > spec.max {
            return Err("TAG_COUNT");
        }
    }
    Ok(seen)
}

fn first<'a>(tags: &Tags<'a>, name: &str) -> Option<&'a str> {
    tags.get(name).and_then(|values| values.first().copied())
}

fn has(tags: &Tags<'_>, name: &str) -> bool {
    tags.contains_key(name)
}

fn mirror_key(prefix: &'static str) -> fn(&str) -> bool {
    match prefix {
        PREFIX_LEDGER => |value| value.strip_prefix(PREFIX_LEDGER).is_some_and(hex64),
        PREFIX_GOAL => |value| value.strip_prefix(PREFIX_GOAL).is_some_and(hex64),
        PREFIX_KIRA => |value| value.strip_prefix(PREFIX_KIRA).is_some_and(hex64),
        PREFIX_MAIL => |value| value.strip_prefix(PREFIX_MAIL).is_some_and(hex64),
        PREFIX_OWNER => |value| value.strip_prefix(PREFIX_OWNER).is_some_and(hex64),
        _ => |value| value.strip_prefix(PREFIX_LANE).is_some_and(hex64),
    }
}

fn receipt_specs() -> [Spec; 13] {
    [
        spec("t", 1, 1, |value| one_of(value, &RECEIPT_KINDS)),
        spec("x", 1, 1, hex64),
        spec("grant", 1, 1, id_text),
        spec("task", 1, 1, id_text),
        spec("i", 1, 1, mirror_key(PREFIX_LEDGER)),
        spec("attempt", 0, 1, attempt_text),
        spec("child", 0, 1, id_text),
        spec("call", 0, 1, hex64),
        spec("detail", 0, 1, hex64),
        spec("expires", 0, 1, iso_text),
        spec("budget", 0, 1, decimal),
        spec("effect", 0, 64, token),
        spec("paths", 0, 1, hex64),
    ]
}

fn check_receipt(tags: &Tags<'_>) -> Result<(), &'static str> {
    let grant_fields = has(tags, "expires") || has(tags, "budget") || has(tags, "effect") || has(tags, "paths");
    let permit_fields = has(tags, "attempt") || has(tags, "call");
    let ok = match first(tags, "t").unwrap_or_default() {
        "grant" => has(tags, "expires") && has(tags, "budget") && has(tags, "effect") && has(tags, "paths") && !permit_fields && !has(tags, "detail"),
        "permit" => has(tags, "attempt") && has(tags, "call") && !grant_fields && !has(tags, "detail"),
        "refuse" => !grant_fields && !has(tags, "child"),
        _ => !grant_fields && !permit_fields && !has(tags, "child"),
    };
    if ok { Ok(()) } else { Err("TAG_COMBINATION") }
}

fn goal_specs() -> [Spec; 10] {
    [
        spec("t", 1, 1, |value| value == "goal"),
        spec("decision", 1, 1, |value| one_of(value, &DECISIONS)),
        spec("x", 0, 1, hex64),
        spec("matches", 1, 1, bool_text),
        spec("grant", 0, 1, id_text),
        spec("task", 0, 1, id_text),
        spec("revision", 0, 1, decimal),
        spec("base", 0, 1, base_sha),
        spec("reason", 0, 32, token),
        spec("i", 1, 1, mirror_key(PREFIX_GOAL)),
    ]
}

fn note_ref_specs() -> [Spec; 9] {
    [
        spec("t", 1, 1, |value| value == "note"),
        spec("note", 1, 1, hex64),
        spec("privacy", 1, 1, |value| one_of(value, &PRIVACY)),
        spec("lane", 1, 1, |value| one_of(value, &KIRA_LANES)),
        spec("author", 1, 1, author_text),
        spec("x", 0, 1, hex64),
        spec("e", 0, 1, hex64),
        spec("quarantined", 0, 1, |value| value == "true"),
        spec("i", 1, 1, mirror_key(PREFIX_KIRA)),
    ]
}

fn check_note_ref(tags: &Tags<'_>) -> Result<(), &'static str> {
    // A local note is referenced by its id only: no statement hash, which a
    // short private statement would make guessable.
    if first(tags, "privacy") == Some("local") && has(tags, "x") {
        return Err("PRIVATE_HASH");
    }
    let note = first(tags, "note").unwrap_or_default();
    if first(tags, "i").and_then(|key| key.strip_prefix(PREFIX_KIRA)) != Some(note) {
        return Err("TAG_COMBINATION");
    }
    Ok(())
}

fn mail_specs() -> [Spec; 6] {
    [
        spec("t", 1, 1, |value| value == "mail"),
        spec("box", 1, 1, |value| one_of(value, &MAIL_BOXES)),
        spec("name", 1, 1, file_name),
        spec("x", 1, 1, hex64),
        spec("size", 1, 1, decimal),
        spec("i", 1, 1, mirror_key(PREFIX_MAIL)),
    ]
}

fn lane_specs() -> [Spec; 16] {
    [
        spec("t", 1, 1, |value| value == "lane"),
        spec("lane", 1, 1, |value| one_of(value, &LANES)),
        spec("run", 1, 1, id_text),
        spec("outcome", 1, 1, token),
        spec("exit", 1, 1, exit_text),
        spec("merged", 1, 1, bool_text),
        spec("c", 0, MAX_COMMITS, commit_hex),
        spec("path", 0, MAX_PATHS, path_text),
        spec("paths-total", 0, 1, decimal),
        spec("task", 0, 1, id_text),
        spec("contract", 0, 1, hex64),
        spec("attempt", 0, 1, id_text),
        spec("lease", 0, 1, decimal),
        spec("task-hash", 1, 1, hex64),
        spec("summary-hash", 1, 1, hex64),
        spec("i", 1, 1, mirror_key(PREFIX_LANE)),
    ]
}

fn owner_specs() -> [Spec; 7] {
    [
        spec("t", 1, 1, |value| one_of(value, &OWNER_DECISIONS)),
        spec("card", 0, 1, id_text),
        spec("tool", 0, 1, id_text),
        spec("reason", 0, 1, token),
        spec("x", 0, 1, hex64),
        spec("grant", 0, 1, id_text),
        spec("i", 1, 1, mirror_key(PREFIX_OWNER)),
    ]
}

/// Which facts each owner decision carries. A card names itself on every
/// decision about it; only an approval names the decision digest and the
/// grant it minted; a STOP names no card (a card it withdrew is its own
/// `withdrawn` event) and at most the grant it ended.
fn check_owner(tags: &Tags<'_>) -> Result<(), &'static str> {
    let (card, tool, reason, digest, grant) = (has(tags, "card"), has(tags, "tool"), has(tags, "reason"), has(tags, "x"), has(tags, "grant"));
    let ok = match first(tags, "t").unwrap_or_default() {
        "shown" => card && tool && !reason && !digest && !grant,
        "approved" => card && !tool && !reason && digest && grant,
        "declined" | "withdrawn" | "refused" => card && !tool && reason && !digest && !grant,
        _ => !card && !tool && !reason && !digest,
    };
    if ok { Ok(()) } else { Err("TAG_COMBINATION") }
}

/// A principal's Kira note, stored as the principal signed it. Only an
/// explicit `builders` or `public` privacy label may travel in plaintext.
fn check_kira_note(event: &Event) -> Result<(), &'static str> {
    let mut privacy = Vec::new();
    let mut singles: BTreeMap<&str, usize> = BTreeMap::new();
    for row in &event.tags {
        let name = row[0].as_str();
        if !KIRA_TAGS.contains(&name) {
            return Err("TAG_UNKNOWN");
        }
        if row.len() < 2 || row.len() > 4 || !row[1..].iter().all(|cell| cell.len() <= 256) || !short_text(&row[1]) {
            return Err("TAG_SHAPE");
        }
        if name == "privacy" {
            privacy.push(row[1].as_str());
        }
        *singles.entry(name).or_default() += 1;
    }
    if ["lane", "form", "scope"].iter().any(|name| singles.get(name).copied().unwrap_or(0) > 1)
        || singles.get("to").copied().unwrap_or(0) > 8
        || singles.get("e").copied().unwrap_or(0) > 65
    {
        return Err("TAG_COUNT");
    }
    if privacy.len() != 1 || !SHAREABLE.contains(&privacy[0]) {
        return Err("PRIVATE_PLAINTEXT");
    }
    if event.content.is_empty() || event.content.len() > MAX_NOTE_CONTENT {
        return Err("CONTENT_BOUND");
    }
    Ok(())
}

// --- Admission ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Append,
    Replay,
}

struct Facts {
    sig_valid: bool,
    seen_id: bool,
    seen_key: bool,
}

fn facts_of(value: &Value) -> Result<Facts, &'static str> {
    let map = closed(value, &["seen_id", "seen_key", "sig_valid"])?;
    Ok(Facts { sig_valid: flag(map, "sig_valid")?, seen_id: flag(map, "seen_id")?, seen_key: flag(map, "seen_key")? })
}

/// Index entry the Host keeps for queries: single-letter tags only (NIP-01).
fn index_entry(seq: i64, event: &Event) -> Value {
    let tags = event
        .tags
        .iter()
        .filter(|row| row.len() >= 2 && row[0].len() == 1 && row[0].as_bytes()[0].is_ascii_alphabetic())
        .map(|row| tag(&row[0], &row[1]))
        .collect();
    Value::obj(vec![
        ("created_at", Value::Int(event.created_at)),
        ("id", Value::str(event.id.as_str())),
        ("kind", Value::Int(event.kind)),
        ("pubkey", Value::str(event.pubkey.as_str())),
        ("seq", Value::Int(seq)),
        ("tags", Value::Array(tags)),
    ])
}

/// Decide one event against the current state; on success the state advances.
fn admit(state: &mut State, keys: &Keys, event: &Event, facts: &Facts, mode: Mode, now: i64) -> Result<Value, &'static str> {
    let computed = event_id(&event.pubkey, event.created_at, event.kind, &event.tags, &event.content)?;
    if computed != event.id {
        return Err("EVENT_ID_MISMATCH");
    }
    if !facts.sig_valid {
        return Err("EVENT_SIGNATURE_INVALID");
    }
    if facts.seen_id {
        return Err("EVENT_DUPLICATE");
    }
    if AUTHORITY_KINDS.contains(&event.kind) {
        return Err("KIND_AUTHORITY");
    }
    let signer = signer_of(keys, &event.pubkey).ok_or("AUTHOR_UNKNOWN")?;
    if mode == Mode::Append && event.created_at > now.saturating_add(FUTURE_SKEW) {
        return Err("EVENT_FUTURE");
    }
    let witness_only = |signer: Signer<'_>| if signer == Signer::Witness { Ok(()) } else { Err("AUTHOR_ROLE") };
    let mut mirror = false;
    match event.kind {
        KIND_HEAD => {
            witness_only(signer)?;
            if event.tags.len() != 1 || event.tags[0].len() != 2 || event.tags[0][0] != "d" || event.tags[0][1] != HEAD_IDENTIFIER {
                return Err("HEAD_MALFORMED");
            }
            if state.size == 0 {
                return Err("HEAD_EMPTY");
            }
            if event.content != head_content(state) {
                return Err("HEAD_MISMATCH");
            }
            if mode == Mode::Append && (event.created_at - now).abs() > HEAD_SKEW {
                return Err("HEAD_STALE");
            }
        }
        KIND_NOTE | KIND_SUPERSEDE => {
            if signer == Signer::Witness {
                return Err("AUTHOR_ROLE");
            }
            check_kira_note(event)?;
        }
        KIND_RECEIPT | KIND_GOAL | KIND_NOTE_REF | KIND_MAIL | KIND_LANE | KIND_OWNER => {
            mirror = true;
            if !event.content.is_empty() {
                return Err("CONTENT_NOT_EMPTY");
            }
            match event.kind {
                KIND_RECEIPT => {
                    witness_only(signer)?;
                    check_receipt(&check_tags(&event.tags, &receipt_specs())?)?;
                }
                KIND_GOAL => {
                    witness_only(signer)?;
                    check_tags(&event.tags, &goal_specs())?;
                }
                KIND_NOTE_REF => {
                    witness_only(signer)?;
                    check_note_ref(&check_tags(&event.tags, &note_ref_specs())?)?;
                }
                KIND_MAIL => {
                    witness_only(signer)?;
                    check_tags(&event.tags, &mail_specs())?;
                }
                KIND_OWNER => {
                    witness_only(signer)?;
                    check_owner(&check_tags(&event.tags, &owner_specs())?)?;
                }
                _ => {
                    let tags = check_tags(&event.tags, &lane_specs())?;
                    let lane = first(&tags, "lane").unwrap_or_default();
                    match signer {
                        Signer::Principal(name) if name.strip_prefix("lane/") == Some(lane) => {}
                        _ => return Err("AUTHOR_ROLE"),
                    }
                }
            }
        }
        _ => return Err("KIND_UNKNOWN"),
    }
    if mirror && facts.seen_key {
        return Err("MIRROR_DUPLICATE");
    }
    let before = state.size;
    state.push(&event.id)?;
    if event.kind == KIND_HEAD {
        state.head = Some(Head { size: before, id: event.id.clone(), at: event.created_at });
    }
    Ok(index_entry(state.size, event))
}

fn admit_op(input: &Map) -> Answer {
    if !only_keys(input, &["event", "facts", "keys", "now", "state"]) {
        return Err("MALFORMED");
    }
    let mut state = state_of(field(input, "state")?)?;
    let keys = keys_of(field(input, "keys")?)?;
    let now = count(input, "now")?;
    let facts = facts_of(field(input, "facts")?)?;
    let event = event_of(field(input, "event")?)?;
    let index = admit(&mut state, &keys, &event, &facts, Mode::Append, now)?;
    Ok(Value::obj(vec![
        ("authority", Value::str("none")),
        ("head_due", Value::Bool(event.kind != KIND_HEAD && head_due(&state, now))),
        ("index", index),
        ("root", Value::str(state.root())),
        ("seq", Value::Int(state.size)),
        ("state", state.value()),
    ]))
}

/// Re-decide a log read from disk, in order. The first refusal stops the
/// replay and names its position; the Host then keeps the relay closed.
fn replay_op(input: &Map) -> Answer {
    if !only_keys(input, &["events", "keys", "state"]) {
        return Err("MALFORMED");
    }
    let mut state = state_of(field(input, "state")?)?;
    let keys = keys_of(field(input, "keys")?)?;
    let rows = array(input, "events")?;
    if rows.len() > MAX_BATCH {
        return Err("BATCH_BOUND");
    }
    let mut index = Vec::with_capacity(rows.len());
    let mut refused = None;
    for (at, row) in rows.iter().enumerate() {
        let row = closed(row, &["event", "facts"])?;
        let facts = facts_of(field(row, "facts")?)?;
        let verdict = event_of(field(row, "event")?).and_then(|event| admit(&mut state, &keys, &event, &facts, Mode::Replay, 0));
        match verdict {
            Ok(entry) => index.push(entry),
            Err(code) => {
                refused = Some((at, code));
                break;
            }
        }
    }
    let mut pairs = vec![
        ("authority", Value::str("none")),
        ("index", Value::Array(index)),
        ("root", Value::str(state.root())),
        ("state", state.value()),
    ];
    if let Some((at, code)) = refused {
        pairs.push(("at", Value::Int(at as i64)));
        pairs.push(("refused", Value::str(code)));
    }
    Ok(Value::obj(pairs))
}

// --- Head witness and rollback ------------------------------------------------------------

fn head_op(input: &Map) -> Answer {
    if !only_keys(input, &["now", "state"]) {
        return Err("MALFORMED");
    }
    let state = state_of(field(input, "state")?)?;
    let now = count(input, "now")?;
    let mut pairs = vec![("due", Value::Bool(head_due(&state, now))), ("root", Value::str(state.root())), ("size", Value::Int(state.size))];
    if state.size > 0 {
        pairs.push(("draft", draft(now, KIND_HEAD, vec![tag("d", HEAD_IDENTIFIER)], head_content(&state))));
        pairs.push(("sign_as", sign_as(Signer::Witness)));
    }
    Ok(Value::obj(pairs))
}

/// Compare the replayed log with the last head retained outside it.
///
/// Every head inside the log was already checked against the Merkle root of
/// the prefix before it. The retained head is a signed copy of the latest
/// one, written after it was appended. If the log no longer holds it, the log
/// was truncated (`ROLLBACK`) or rewritten (`FORK`).
fn check_op(input: &Map) -> Answer {
    if !only_keys(input, &["keys", "retained", "retained_seq", "state", "torn"]) {
        return Err("MALFORMED");
    }
    let state = state_of(field(input, "state")?)?;
    let keys = keys_of(field(input, "keys")?)?;
    let torn = flag(input, "torn")?;
    let retained_seq = match optional(input, "retained_seq") {
        None => None,
        Some(value) => Some(value.as_int().filter(|seq| *seq >= 1).ok_or("INVALID_INPUT")?),
    };
    let mut warnings = Vec::new();
    let verdict = match optional(input, "retained") {
        None => {
            if retained_seq.is_some() {
                return Err("INVALID_INPUT");
            }
            match state.head {
                None => "fresh",
                Some(_) => {
                    warnings.push(Value::str("retained-missing"));
                    "refresh"
                }
            }
        }
        Some(value) => {
            let row = closed(value, &["event", "facts"])?;
            let facts = facts_of(field(row, "facts")?)?;
            let event = event_of(field(row, "event")?).map_err(|_| "HEAD_INVALID")?;
            let computed = event_id(&event.pubkey, event.created_at, event.kind, &event.tags, &event.content).map_err(|_| "HEAD_INVALID")?;
            let shaped = event.kind == KIND_HEAD
                && event.tags.len() == 1
                && event.tags[0].len() == 2
                && event.tags[0][0] == "d"
                && event.tags[0][1] == HEAD_IDENTIFIER;
            let retained = parse_head(&event.content);
            if computed != event.id || !facts.sig_valid || !shaped || signer_of(&keys, &event.pubkey) != Some(Signer::Witness) {
                return Err("HEAD_INVALID");
            }
            let witnessed = retained.ok_or("HEAD_INVALID")?.size;
            match retained_seq {
                Some(seq) if seq == witnessed + 1 && seq <= state.size => {
                    if state.head.as_ref().is_some_and(|head| head.id == event.id) {
                        "ok"
                    } else {
                        warnings.push(Value::str("retained-stale"));
                        "refresh"
                    }
                }
                Some(_) => return Err("FORK"),
                None if state.size <= witnessed => return Err("ROLLBACK"),
                None => return Err("FORK"),
            }
        }
    };
    if torn {
        warnings.push(Value::str("torn-tail"));
    }
    Ok(Value::obj(vec![
        ("drop_torn", Value::Bool(torn)),
        ("root", Value::str(state.root())),
        ("size", Value::Int(state.size)),
        ("verdict", Value::str(verdict)),
        ("warnings", Value::Array(warnings)),
    ]))
}

// --- Mirror: organism records become event drafts ----------------------------------------

fn draft(created_at: i64, kind: i64, tags: Vec<Value>, content: String) -> Value {
    Value::obj(vec![
        ("content", Value::str(content)),
        ("created_at", Value::Int(created_at)),
        ("kind", Value::Int(kind)),
        ("tags", Value::Array(tags)),
    ])
}

/// Bound the event a draft will become, with a placeholder author.
fn draft_fits(created_at: i64, kind: i64, tags: &[Value], content: &str) -> Result<(), &'static str> {
    let rows = tags
        .iter()
        .map(|row| strings_of(row).map(|cells| cells.into_iter().map(str::to_string).collect()))
        .collect::<Result<Vec<Vec<String>>, _>>()?;
    event_id(&"0".repeat(64), created_at, kind, &rows, content).map(|_| ()).map_err(|_| "DRAFT_BOUND")
}

fn mirrored(key: String, signer: Signer<'_>, created_at: i64, kind: i64, tags: Vec<Value>) -> Answer {
    draft_fits(created_at, kind, &tags, "")?;
    Ok(Value::obj(vec![
        ("draft", draft(created_at, kind, tags, String::new())),
        ("key", Value::str(key)),
        ("mode", Value::str("draft")),
        ("sign_as", sign_as(signer)),
    ]))
}

fn require(condition: bool) -> Result<(), &'static str> {
    if condition { Ok(()) } else { Err("MIRROR_INVALID") }
}

/// One owner grant-ledger row (the cell-authored JSONL record), as evidence.
fn mirror_ledger(input: &Map) -> Answer {
    let record_value = field(input, "record")?;
    let record = closed(
        record_value,
        &["at", "attemptId", "callDigest", "childGrantId", "detail", "grant", "grantId", "kind", "receipt", "taskId", "prev", "legacyRows", "legacySha256"],
    )
    .map_err(|_| "MIRROR_INVALID")?;
    let at = count(input, "at_s")?;
    let kind = text(record, "kind")?;
    let receipt = text(record, "receipt")?;
    let grant_id = text(record, "grantId")?;
    let task_id = text(record, "taskId")?;
    require(one_of(kind, &RECEIPT_KINDS) && hex64(receipt) && id_text(grant_id) && id_text(task_id) && iso_text(text(record, "at")?))?;
    // Chaining metadata is evidence bound by the mirrored record digest;
    // accepting it never turns a relay receipt into grant authority.
    if let Some(prev) = optional(record, "prev") {
        let prev = prev.as_str().ok_or("MIRROR_INVALID")?;
        require(prev.is_empty() || hex64(prev))?;
    }
    if kind == "chain" {
        require(hex64(text(record, "legacySha256")?) && int(record, "legacyRows")? > 0)?;
    } else {
        require(optional(record, "legacySha256").is_none() && optional(record, "legacyRows").is_none())?;
    }
    let key = format!("{PREFIX_LEDGER}{}", digest_hex(&encode(record_value)));
    let mut tags = vec![tag("t", kind), tag("x", receipt), tag("grant", grant_id), tag("task", task_id), tag("i", &key)];
    let attempt = optional(record, "attemptId").map(|value| value.as_str().ok_or("MIRROR_INVALID")).transpose()?;
    let call = optional(record, "callDigest").map(|value| value.as_str().ok_or("MIRROR_INVALID")).transpose()?;
    let detail = optional(record, "detail").map(|value| value.as_str().ok_or("MIRROR_INVALID")).transpose()?;
    if let Some(attempt) = attempt {
        require(attempt_text(attempt))?;
        tags.push(tag("attempt", attempt));
    }
    // A permit spent through a child names its parent as `grantId`; the child
    // is evidence, bound to the attempt prefix the ledger cell wrote.
    if let Some(child) = optional(record, "childGrantId") {
        let child = child.as_str().ok_or("MIRROR_INVALID")?;
        require(
            kind == "permit"
                && id_text(child)
                && child.starts_with(&format!("{grant_id}:"))
                && attempt.is_some_and(|attempt| attempt.starts_with(&format!("{child}|"))),
        )?;
        tags.push(tag("child", child));
    }
    if let Some(call) = call {
        require(hex64(call))?;
        tags.push(tag("call", call));
    }
    if let Some(detail) = detail {
        // Free text (a reason, an owner's words) is kept as a hash only.
        tags.push(tag("detail", &digest_hex(detail.as_bytes())));
    }
    match (kind, optional(record, "grant")) {
        ("grant", Some(grant)) => {
            let grant = object(grant).map_err(|_| "MIRROR_INVALID")?;
            let expires = text(grant, "expiresAt")?;
            let budget = int(grant, "permitBudget")?;
            let effects = strings_of(field(grant, "effects")?)?;
            let paths = field(grant, "paths")?;
            strings_of(paths)?;
            require(iso_text(expires) && budget >= 1 && !effects.is_empty() && effects.len() <= 64 && effects.iter().all(|effect| token(effect)))?;
            tags.push(tag("expires", expires));
            tags.push(tag("budget", &budget.to_string()));
            for effect in effects {
                tags.push(tag("effect", effect));
            }
            tags.push(tag("paths", &digest_hex(&encode(paths))));
        }
        ("grant", None) | (_, Some(_)) => return Err("MIRROR_INVALID"),
        _ => {}
    }
    let rows: Vec<Vec<String>> = tags.iter().map(|row| strings_of(row).unwrap_or_default().into_iter().map(str::to_string).collect()).collect();
    check_receipt(&check_tags(&rows, &receipt_specs()).map_err(|_| "MIRROR_INVALID")?).map_err(|_| "MIRROR_INVALID")?;
    mirrored(key, Signer::Witness, at, KIND_RECEIPT, tags)
}

/// One goal/task binding decision from the goal-receipts cell.
fn mirror_goal(input: &Map) -> Answer {
    let receipt_value = field(input, "receipt")?;
    let receipt = closed(
        receipt_value,
        &["base_sha", "decision", "grant_id", "now_ms", "reasons", "receipt_digest", "receipt_matches", "revision", "task_id"],
    )
    .map_err(|_| "MIRROR_INVALID")?;
    let decision = text(receipt, "decision")?;
    let digest = text(receipt, "receipt_digest")?;
    let reasons = strings_of(field(receipt, "reasons")?)?;
    let now_ms = count(receipt, "now_ms")?;
    require(one_of(decision, &DECISIONS) && (digest.is_empty() || hex64(digest)) && reasons.len() <= 32 && reasons.iter().all(|reason| token(reason)))?;
    let key = format!("{PREFIX_GOAL}{}", digest_hex(&encode(receipt_value)));
    let matches = if flag(receipt, "receipt_matches")? { "true" } else { "false" };
    let mut tags = vec![tag("t", "goal"), tag("decision", decision), tag("matches", matches), tag("i", &key)];
    if !digest.is_empty() {
        tags.push(tag("x", digest));
    }
    for (name, key_name, check) in [("grant", "grant_id", id_text as fn(&str) -> bool), ("task", "task_id", id_text), ("base", "base_sha", base_sha)] {
        if let Some(value) = optional(receipt, key_name) {
            let value = value.as_str().ok_or("MIRROR_INVALID")?;
            if !value.is_empty() {
                require(check(value))?;
                tags.push(tag(name, value));
            }
        }
    }
    if let Some(revision) = optional(receipt, "revision") {
        let revision = revision.as_int().filter(|value| *value >= 0).ok_or("MIRROR_INVALID")?;
        tags.push(tag("revision", &revision.to_string()));
    }
    for reason in reasons {
        tags.push(tag("reason", reason));
    }
    mirrored(key, Signer::Witness, now_ms / 1000, KIND_GOAL, tags)
}

/// A Kira note. A principal's own event travels as itself when its label is
/// explicitly shareable; anything else (local, quarantined, store-signed, or
/// an author the relay does not know) is kept as a reference without text.
fn mirror_kira(input: &Map, keys: &Keys) -> Answer {
    let note = closed(
        field(input, "note")?,
        &["author", "created_at_s", "event", "id", "lane", "privacy", "quarantined", "statement", "statement_hash"],
    )
    .map_err(|_| "MIRROR_INVALID")?;
    let id = text(note, "id")?;
    let author = text(note, "author")?;
    let lane = text(note, "lane")?;
    let privacy = text(note, "privacy")?;
    let statement = text(note, "statement")?;
    let statement_hash = text(note, "statement_hash")?;
    let created_at = count(note, "created_at_s")?;
    let quarantined = flag(note, "quarantined")?;
    require(hex64(id) && author_text(author) && one_of(lane, &KIRA_LANES) && one_of(privacy, &PRIVACY) && hex64(statement_hash))?;
    let stored = match optional(note, "event") {
        None => None,
        Some(value) => {
            let event = closed(value, &["created_at", "id", "kind", "pubkey", "sig", "tags"]).map_err(|_| "MIRROR_INVALID")?;
            let mut full = event.clone();
            full.insert("content".to_string(), Value::str(statement));
            Some(event_of(&Value::Object(full)).map_err(|_| "MIRROR_INVALID")?)
        }
    };
    if let Some(event) = &stored {
        let shareable = SHAREABLE.contains(&privacy)
            && !quarantined
            && matches!(event.kind, KIND_NOTE | KIND_SUPERSEDE)
            && event.tags.iter().any(|row| row.len() == 2 && row[0] == "privacy" && row[1] == privacy)
            && matches!(signer_of(keys, &event.pubkey), Some(Signer::Principal(_)))
            && check_kira_note(event).is_ok();
        if shareable {
            let computed = event_id(&event.pubkey, event.created_at, event.kind, &event.tags, &event.content)?;
            if computed != event.id {
                return Err("MIRROR_EVENT_MISMATCH");
            }
            return Ok(Value::obj(vec![
                ("event", event_value(event)),
                ("key", Value::str(event.id.as_str())),
                ("mode", Value::str("verbatim")),
            ]));
        }
    }
    let key = format!("{PREFIX_KIRA}{id}");
    let mut tags = vec![tag("t", "note"), tag("note", id), tag("privacy", privacy), tag("lane", lane), tag("author", author), tag("i", &key)];
    if privacy != "local" {
        tags.push(tag("x", statement_hash));
    }
    if let Some(event) = &stored {
        tags.push(tag("e", &event.id));
    }
    if quarantined {
        tags.push(tag("quarantined", "true"));
    }
    mirrored(key, Signer::Witness, created_at, KIND_NOTE_REF, tags)
}

/// One mailbox file, by name, size and SHA-256 only.
fn mirror_mail(input: &Map) -> Answer {
    let mail_value = field(input, "mail")?;
    let mail = closed(mail_value, &["box", "bytes", "name", "observed_at_s", "sha256"]).map_err(|_| "MIRROR_INVALID")?;
    let mailbox = text(mail, "box")?;
    let name = text(mail, "name")?;
    let digest = text(mail, "sha256")?;
    let bytes = count(mail, "bytes")?;
    let observed = count(mail, "observed_at_s")?;
    require(one_of(mailbox, &MAIL_BOXES) && file_name(name) && hex64(digest))?;
    let identity = Value::obj(vec![
        ("box", Value::str(mailbox)),
        ("bytes", Value::Int(bytes)),
        ("name", Value::str(name)),
        ("sha256", Value::str(digest)),
    ]);
    let key = format!("{PREFIX_MAIL}{}", digest_hex(&encode(&identity)));
    let tags = vec![
        tag("t", "mail"),
        tag("box", mailbox),
        tag("name", name),
        tag("x", digest),
        tag("size", &bytes.to_string()),
        tag("i", &key),
    ];
    mirrored(key, Signer::Witness, observed, KIND_MAIL, tags)
}

/// One lane run: its commits and changed paths, signed by the lane's own key.
/// The task and the output tail are kept as hashes.
fn mirror_lane(input: &Map, keys: &Keys) -> Answer {
    let run = closed(
        field(input, "run")?,
        &[
            "attempt_id", "changed", "commits", "contract_digest", "duration_ms", "exit_code", "lane", "lease_epoch", "merged",
            "outcome", "run_id", "started_at_s", "summary", "task", "task_id",
        ],
    )
    .map_err(|_| "MIRROR_INVALID")?;
    let lane = text(run, "lane")?;
    let run_id = text(run, "run_id")?;
    let outcome = text(run, "outcome")?;
    let commits = strings_of(field(run, "commits")?)?;
    let changed = strings_of(field(run, "changed")?)?;
    let started = count(run, "started_at_s")?;
    let duration = count(run, "duration_ms")?;
    require(one_of(lane, &LANES) && id_text(run_id) && token(outcome) && commits.len() <= MAX_COMMITS && commits.iter().all(|sha| commit_hex(sha)))?;
    require(changed.len() <= MAX_ENTRIES && changed.iter().all(|path| path_text(path)))?;
    let signer_name = format!("lane/{lane}");
    if !has_principal(keys, &signer_name) {
        return Err("SIGNER_UNKNOWN");
    }
    let exit = match optional(run, "exit_code") {
        None => "none".to_string(),
        Some(value) => value.as_int().ok_or("MIRROR_INVALID")?.to_string(),
    };
    require(exit_text(&exit))?;
    let identity = Value::obj(vec![("lane", Value::str(lane)), ("run_id", Value::str(run_id))]);
    let key = format!("{PREFIX_LANE}{}", digest_hex(&encode(&identity)));
    let mut tags = vec![
        tag("t", "lane"),
        tag("lane", lane),
        tag("run", run_id),
        tag("outcome", outcome),
        tag("exit", &exit),
        tag("merged", if flag(run, "merged")? { "true" } else { "false" }),
        tag("task-hash", &digest_hex(text(run, "task")?.as_bytes())),
        tag("summary-hash", &digest_hex(text(run, "summary")?.as_bytes())),
        tag("i", &key),
    ];
    for sha in &commits {
        tags.push(tag("c", sha));
    }
    let mut budget = PATH_BUDGET;
    let mut carried = 0usize;
    for path in &changed {
        if carried == MAX_PATHS || path.len() + 16 > budget {
            break;
        }
        budget -= path.len() + 16;
        carried += 1;
        tags.push(tag("path", path));
    }
    if carried < changed.len() {
        tags.push(tag("paths-total", &changed.len().to_string()));
    }
    for (name, key_name, check) in [("task", "task_id", id_text as fn(&str) -> bool), ("contract", "contract_digest", hex64), ("attempt", "attempt_id", id_text)] {
        if let Some(value) = optional(run, key_name) {
            let value = value.as_str().ok_or("MIRROR_INVALID")?;
            require(check(value))?;
            tags.push(tag(name, value));
        }
    }
    if let Some(epoch) = optional(run, "lease_epoch") {
        let epoch = epoch.as_int().filter(|value| *value >= 0).ok_or("MIRROR_INVALID")?;
        tags.push(tag("lease", &epoch.to_string()));
    }
    let signer = keys.principals.iter().find(|(name, _)| *name == signer_name).map(|(name, _)| Signer::Principal(name.as_str())).ok_or("SIGNER_UNKNOWN")?;
    mirrored(key, signer, started.saturating_add(duration / 1000), KIND_LANE, tags)
}

/// One owner card decision or STOP, as the owner service saw it. Ids,
/// reason codes and the decision digest only: never the owner's words.
fn mirror_owner(input: &Map) -> Answer {
    let decision_value = field(input, "decision")?;
    let decision = closed(decision_value, &["at_ms", "card", "decision", "grant", "reason", "tool", "x"]).map_err(|_| "MIRROR_INVALID")?;
    let kind = text(decision, "decision")?;
    let at_ms = count(decision, "at_ms")?;
    require(one_of(kind, &OWNER_DECISIONS))?;
    let key = format!("{PREFIX_OWNER}{}", digest_hex(&encode(decision_value)));
    let mut tags = vec![tag("t", kind)];
    for (name, check) in [("card", id_text as fn(&str) -> bool), ("tool", id_text), ("reason", token), ("x", hex64), ("grant", id_text)] {
        if let Some(value) = optional(decision, name) {
            let value = value.as_str().ok_or("MIRROR_INVALID")?;
            require(check(value))?;
            tags.push(tag(name, value));
        }
    }
    tags.push(tag("i", &key));
    let rows: Vec<Vec<String>> = tags.iter().map(|row| strings_of(row).unwrap_or_default().into_iter().map(str::to_string).collect()).collect();
    check_owner(&check_tags(&rows, &owner_specs()).map_err(|_| "MIRROR_INVALID")?).map_err(|_| "MIRROR_INVALID")?;
    mirrored(key, Signer::Witness, at_ms / 1000, KIND_OWNER, tags)
}

fn mirror_op(input: &Map) -> Answer {
    let source = text(input, "source")?;
    let allowed: &[&str] = match source {
        "ledger" => &["at_s", "keys", "record", "source"],
        "goal" => &["keys", "receipt", "source"],
        "kira" => &["keys", "note", "source"],
        "mail" => &["keys", "mail", "source"],
        "lane" => &["keys", "run", "source"],
        "owner" => &["decision", "keys", "source"],
        _ => return Err("SOURCE_UNKNOWN"),
    };
    if !only_keys(input, allowed) {
        return Err("MALFORMED");
    }
    let keys = keys_of(field(input, "keys")?)?;
    match source {
        "ledger" => mirror_ledger(input),
        "goal" => mirror_goal(input),
        "kira" => mirror_kira(input, &keys),
        "mail" => mirror_mail(input),
        "owner" => mirror_owner(input),
        _ => mirror_lane(input, &keys),
    }
}

// --- NIP-01 filters ------------------------------------------------------------------------

struct Filter {
    ids: Option<BTreeSet<String>>,
    authors: Option<BTreeSet<String>>,
    kinds: Option<BTreeSet<i64>>,
    tags: Vec<(String, BTreeSet<String>)>,
    since: Option<i64>,
    until: Option<i64>,
    limit: Option<i64>,
}

struct Entry {
    seq: i64,
    id: String,
    pubkey: String,
    kind: i64,
    created_at: i64,
    tags: Vec<(String, String)>,
}

fn hex_set(value: &Value) -> Result<BTreeSet<String>, &'static str> {
    let items = strings_of(value).map_err(|_| "FILTER_INVALID")?;
    if items.is_empty() || items.len() > MAX_FILTER_VALUES || !items.iter().all(|item| hex64(item)) {
        return Err("FILTER_INVALID");
    }
    Ok(items.into_iter().map(str::to_string).collect())
}

fn filter_of(value: &Value) -> Result<Filter, &'static str> {
    let map = object(value).map_err(|_| "FILTER_INVALID")?;
    let mut filter = Filter { ids: None, authors: None, kinds: None, tags: Vec::new(), since: None, until: None, limit: None };
    for (key, value) in map {
        match key.as_str() {
            "ids" => filter.ids = Some(hex_set(value)?),
            "authors" => filter.authors = Some(hex_set(value)?),
            "kinds" => {
                let items = value.as_array().ok_or("FILTER_INVALID")?;
                if items.is_empty() || items.len() > MAX_FILTER_VALUES {
                    return Err("FILTER_INVALID");
                }
                let kinds = items
                    .iter()
                    .map(|item| item.as_int().filter(|kind| (0..=65_535).contains(kind)).ok_or("FILTER_INVALID"))
                    .collect::<Result<BTreeSet<_>, _>>()?;
                filter.kinds = Some(kinds);
            }
            "since" | "until" | "limit" => {
                let number = value.as_int().filter(|number| *number >= 0).ok_or("FILTER_INVALID")?;
                match key.as_str() {
                    "since" => filter.since = Some(number),
                    "until" => filter.until = Some(number),
                    _ if (1..=MAX_LIMIT).contains(&number) => filter.limit = Some(number),
                    _ => return Err("FILTER_INVALID"),
                }
            }
            name if name.len() == 2 && name.starts_with('#') && name.as_bytes()[1].is_ascii_alphabetic() => {
                let items = strings_of(value).map_err(|_| "FILTER_INVALID")?;
                if items.is_empty() || items.len() > MAX_FILTER_VALUES {
                    return Err("FILTER_INVALID");
                }
                filter.tags.push((name[1..].to_string(), items.into_iter().map(str::to_string).collect()));
            }
            _ => return Err("FILTER_UNKNOWN"),
        }
    }
    Ok(filter)
}

fn entry_of(value: &Value) -> Result<Entry, &'static str> {
    let map = closed(value, &["created_at", "id", "kind", "pubkey", "seq", "tags"]).map_err(|_| "ENTRY_INVALID")?;
    let id = text(map, "id").map_err(|_| "ENTRY_INVALID")?;
    let pubkey = text(map, "pubkey").map_err(|_| "ENTRY_INVALID")?;
    if !hex64(id) || !hex64(pubkey) {
        return Err("ENTRY_INVALID");
    }
    let mut tags = Vec::new();
    for row in array(map, "tags").map_err(|_| "ENTRY_INVALID")? {
        let cells = strings_of(row).map_err(|_| "ENTRY_INVALID")?;
        if cells.len() != 2 {
            return Err("ENTRY_INVALID");
        }
        tags.push((cells[0].to_string(), cells[1].to_string()));
    }
    Ok(Entry {
        seq: count(map, "seq").map_err(|_| "ENTRY_INVALID")?,
        id: id.to_string(),
        pubkey: pubkey.to_string(),
        kind: count(map, "kind").map_err(|_| "ENTRY_INVALID")?,
        created_at: count(map, "created_at").map_err(|_| "ENTRY_INVALID")?,
        tags,
    })
}

fn matches(filter: &Filter, entry: &Entry) -> bool {
    filter.ids.as_ref().is_none_or(|ids| ids.contains(&entry.id))
        && filter.authors.as_ref().is_none_or(|authors| authors.contains(&entry.pubkey))
        && filter.kinds.as_ref().is_none_or(|kinds| kinds.contains(&entry.kind))
        && filter.since.is_none_or(|since| entry.created_at >= since)
        && filter.until.is_none_or(|until| entry.created_at <= until)
        && filter.tags.iter().all(|(name, values)| entry.tags.iter().any(|(tag, value)| tag == name && values.contains(value)))
}

/// Newest first; equal times by lowest id (NIP-01 `limit` order).
fn newest_first(left: &Entry, right: &Entry) -> core::cmp::Ordering {
    right.created_at.cmp(&left.created_at).then_with(|| left.id.cmp(&right.id))
}

fn query_op(input: &Map) -> Answer {
    if !only_keys(input, &["entries", "filters"]) {
        return Err("MALFORMED");
    }
    let filters = array(input, "filters")?;
    if filters.is_empty() || filters.len() > MAX_FILTERS {
        return Err("FILTER_INVALID");
    }
    let filters = filters.iter().map(filter_of).collect::<Result<Vec<_>, _>>()?;
    let rows = array(input, "entries")?;
    if rows.len() > MAX_ENTRIES {
        return Err("BATCH_BOUND");
    }
    let mut entries = rows.iter().map(entry_of).collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(newest_first);
    let mut chosen = BTreeSet::new();
    for filter in &filters {
        let limit = filter.limit.map_or(usize::MAX, |limit| limit as usize);
        for (position, _) in entries.iter().enumerate().filter(|(_, entry)| matches(filter, entry)).take(limit) {
            chosen.insert(position);
        }
    }
    let mut seen = BTreeSet::new();
    let seqs = chosen
        .into_iter()
        .filter(|position| seen.insert(entries[*position].seq))
        .map(|position| Value::Int(entries[position].seq))
        .collect();
    Ok(Value::obj(vec![("seqs", Value::Array(seqs))]))
}

// --- Small pure ops ---------------------------------------------------------------------------

fn root_op(input: &Map) -> Answer {
    if !only_keys(input, &["entries"]) {
        return Err("MALFORMED");
    }
    let rows = array(input, "entries")?;
    if rows.len() > MAX_ROOT_ENTRIES {
        return Err("BATCH_BOUND");
    }
    let mut state = State::genesis();
    for row in rows {
        state.push(row.as_str().filter(|id| hex64(id)).ok_or("INVALID_INPUT")?)?;
    }
    Ok(Value::obj(vec![("root", Value::str(state.root())), ("size", Value::Int(state.size)), ("state", state.value())]))
}

fn genesis_op(input: &Map) -> Answer {
    if !input.is_empty() {
        return Err("MALFORMED");
    }
    let state = State::genesis();
    Ok(Value::obj(vec![("root", Value::str(state.root())), ("state", state.value())]))
}

/// The NIP-01 id this cell computes for an event (for differential tests).
fn id_op(input: &Map) -> Answer {
    if !only_keys(input, &["event"]) {
        return Err("MALFORMED");
    }
    let event = event_of(field(input, "event")?)?;
    let id = event_id(&event.pubkey, event.created_at, event.kind, &event.tags, &event.content)?;
    let preimage = preimage(&event.pubkey, event.created_at, event.kind, &event.tags, &event.content);
    Ok(Value::obj(vec![
        ("id", Value::str(id.as_str())),
        ("matches", Value::Bool(id == event.id)),
        ("preimage_bytes", Value::Int(preimage.len() as i64)),
    ]))
}

// --- Canonical envelope -----------------------------------------------------------------------

fn envelope_refused(seq: i64, code: &str) -> Vec<u8> {
    encode(&Value::obj(vec![
        ("abi", Value::Int(1)),
        ("code", Value::str(code)),
        ("seq", Value::Int(seq)),
        ("status", Value::str("refused")),
    ]))
}

fn envelope_ok(seq: i64, result: Value) -> Vec<u8> {
    let bytes = encode(&Value::obj(vec![
        ("abi", Value::Int(1)),
        ("result", result),
        ("seq", Value::Int(seq)),
        ("status", Value::str("ok")),
    ]));
    if bytes.len() > MAX_RESPONSE_BYTES { envelope_refused(seq, "RESPONSE_BOUND") } else { bytes }
}

fn dispatch(request: &[u8]) -> Vec<u8> {
    if request.len() > MAX_REQUEST_BYTES {
        return envelope_refused(0, "REQUEST_BOUND");
    }
    let envelope = match parse(request) {
        Ok(Value::Object(map)) => map,
        _ => return envelope_refused(0, "MALFORMED"),
    };
    let seq = envelope.get("seq").and_then(Value::as_int).unwrap_or(0);
    if !only_keys(&envelope, &["abi", "input", "op", "seq"]) {
        return envelope_refused(seq, "MALFORMED");
    }
    if envelope.get("abi").and_then(Value::as_int) != Some(1) {
        return envelope_refused(seq, "ABI");
    }
    let Some(op) = envelope.get("op").and_then(Value::as_str) else { return envelope_refused(seq, "MALFORMED") };
    let Some(Value::Object(input)) = envelope.get("input") else { return envelope_refused(seq, "MALFORMED") };
    let answer = match op {
        "relay.ping" if input.is_empty() => Ok(Value::obj(vec![("pong", Value::Bool(true)), ("version", Value::Int(1))])),
        "relay.ping" => Err("MALFORMED"),
        "relay.genesis" => genesis_op(input),
        "relay.root" => root_op(input),
        "relay.id" => id_op(input),
        "relay.admit" => admit_op(input),
        "relay.replay" => replay_op(input),
        "relay.head" => head_op(input),
        "relay.check" => check_op(input),
        "relay.mirror" => mirror_op(input),
        "relay.query" => query_op(input),
        _ => Err("UNKNOWN_OP"),
    };
    match answer {
        Ok(result) => envelope_ok(seq, result),
        Err(code) => envelope_refused(seq, code),
    }
}

// --- Buffer lifecycle (ABI §10.3) -------------------------------------------------------------
// Request buffers are reclaimed at the end of mv_run; the previous response is
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
    if length <= 0 || length as usize > MAX_ALLOC_BYTES {
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

fn take_request(pointer: i32, length: i32) -> Vec<u8> {
    if length < 0 || pointer < 64 || length as usize > MAX_REQUEST_BYTES {
        return Vec::new();
    }
    let request = unsafe { core::slice::from_raw_parts(pointer as *const u8, length as usize) }.to_vec();
    ALLOCS.with(|allocs| {
        let mut allocs = allocs.borrow_mut();
        if let Some(position) = allocs.iter().position(|(start, _)| *start == pointer as usize) {
            let (start, capacity) = allocs.remove(position);
            unsafe { dealloc(start, capacity) };
        }
    });
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
    let request = take_request(pointer, length);
    finish_response(dispatch(&request))
}

#[cfg(test)]
mod tests;
