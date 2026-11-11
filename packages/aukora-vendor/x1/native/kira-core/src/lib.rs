//! Kira X1 memory core on the Microverse ABI v1 surface.
//!
//! Pure policy only: note classification and taint clamp, ancestry roots,
//! permissions, and deterministic recall ranking. Signatures, storage, search
//! index and slots live in the native Host hands. Memory is context, never
//! authority.

use std::collections::{BTreeMap, BTreeSet};

use mv_abi::{encode, parse, Value};

const MAX_REQUEST: usize = 65_536;
const MAX_RESPONSE: usize = 65_536;
const MAX_STATEMENT: usize = 4_096;
const MAX_SOURCE_IDS: usize = 16;
const MAX_ROOTS: usize = 64;
const MAX_RECALL_ITEMS: usize = 512;

fn refused(seq: i64, code: &str) -> Vec<u8> {
    encode(&Value::obj(vec![
        ("abi", Value::Int(1)),
        ("code", Value::str(code)),
        ("seq", Value::Int(seq)),
        ("status", Value::str("refused")),
    ]))
}

fn ok(seq: i64, result: Value) -> Vec<u8> {
    let bytes = encode(&Value::obj(vec![
        ("abi", Value::Int(1)),
        ("result", result),
        ("seq", Value::Int(seq)),
        ("status", Value::str("ok")),
    ]));
    if bytes.len() > MAX_RESPONSE { refused(seq, "RESPONSE_BOUND") } else { bytes }
}

fn object(value: &Value) -> Option<&BTreeMap<String, Value>> {
    match value { Value::Object(map) => Some(map), _ => None }
}
fn text<'a>(map: &'a BTreeMap<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(Value::as_str)
}
fn int(map: &BTreeMap<String, Value>, key: &str) -> Option<i64> {
    map.get(key).and_then(Value::as_int)
}
fn boolean(map: &BTreeMap<String, Value>, key: &str) -> Option<bool> {
    match map.get(key) { Some(Value::Bool(v)) => Some(*v), _ => None }
}
fn array<'a>(map: &'a BTreeMap<String, Value>, key: &str) -> Option<&'a [Value]> {
    map.get(key).and_then(Value::as_array)
}
fn strings<'a>(map: &'a BTreeMap<String, Value>, key: &str) -> Option<Vec<&'a str>> {
    let values = array(map, key)?;
    let mut out = Vec::with_capacity(values.len());
    for value in values { out.push(value.as_str()?); }
    Some(out)
}
fn only_keys(map: &BTreeMap<String, Value>, allowed: &[&str]) -> bool {
    for key in map.keys() {
        if !allowed.contains(&key.as_str()) { return false; }
    }
    true
}

fn capture_rank(value: &str) -> Option<i32> {
    match value {
        "owner-signed" => Some(5),
        "owner-typed" => Some(4),
        "tool-observed" => Some(3),
        "model-generated" => Some(2),
        "web-derived" => Some(1),
        _ => None,
    }
}
fn capture_name(rank: i32) -> &'static str {
    match rank {
        5 => "owner-signed",
        4 => "owner-typed",
        3 => "tool-observed",
        2 => "model-generated",
        _ => "web-derived",
    }
}
fn caller_ceiling(caller: &str) -> Option<i32> {
    match caller {
        "owner" | "owner-channel" => Some(4),
        "tool" | "door" => Some(3),
        "model" | "agent" | "lane" => Some(2),
        _ => None,
    }
}
fn valid_lane(value: &str) -> bool {
    matches!(value, "evidence"|"experience"|"charter"|"ruling"|"decision"|"finding"|"slot")
}
fn valid_form(value: &str) -> bool {
    matches!(value, "fact"|"snapshot"|"counterevidence")
}
fn valid_privacy(value: &str) -> bool {
    matches!(value, "local"|"builders"|"public")
}
fn commitment(lane: &str) -> bool {
    matches!(lane, "charter"|"ruling"|"decision")
}

fn classify_note(seq: i64, input: &BTreeMap<String, Value>) -> Vec<u8> {
    if !only_keys(input, &["caller", "note", "source_captures", "source_roots"]) {
        return refused(seq, "MALFORMED");
    }
    let caller = match text(input, "caller") { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
    let ceiling = match caller_ceiling(caller) { Some(v) => v, None => return refused(seq, "INVALID_CALLER") };
    let note = match input.get("note").and_then(object) { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
    if !only_keys(note, &["capture_source", "form", "lane", "privacy", "scope", "source_ids", "statement"]) {
        return refused(seq, "MALFORMED");
    }
    let lane = match text(note, "lane") { Some(v) if valid_lane(v) => v, _ => return refused(seq, "INVALID_LANE") };
    let form = match text(note, "form") { Some(v) if valid_form(v) => v, _ => return refused(seq, "INVALID_FORM") };
    let privacy = match text(note, "privacy") { Some(v) if valid_privacy(v) => v, _ => return refused(seq, "INVALID_PRIVACY") };
    let scope = match text(note, "scope") { Some(v) if !v.is_empty() && v.len() <= 128 => v, _ => return refused(seq, "INVALID_SCOPE") };
    let statement = match text(note, "statement") { Some(v) if v.len() <= MAX_STATEMENT => v, _ => return refused(seq, "INVALID_STATEMENT") };
    if statement.trim().is_empty() { return refused(seq, "INVALID_STATEMENT"); }
    let claim = match text(note, "capture_source").and_then(capture_rank) { Some(v) => v, None => return refused(seq, "INVALID_CAPTURE") };
    let source_ids = match strings(note, "source_ids") { Some(v) if v.len() <= MAX_SOURCE_IDS => v, _ => return refused(seq, "INVALID_SOURCES") };
    let source_captures = match strings(input, "source_captures") { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
    let source_roots = match array(input, "source_roots") { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
    if source_captures.len() > MAX_SOURCE_IDS || source_roots.len() > MAX_SOURCE_IDS {
        return refused(seq, "TOO_MANY_SOURCES");
    }

    let mut effective = claim.min(ceiling);
    for capture in &source_captures {
        let rank = match capture_rank(capture) { Some(v) => v, None => return refused(seq, "INVALID_CAPTURE") };
        if rank < effective { effective = rank; }
    }

    let allowed = if commitment(lane) {
        effective >= 4
    } else if lane == "evidence" {
        effective >= 3
    } else if lane == "slot" {
        form == "fact" && effective >= 4 && caller == "owner"
    } else {
        true
    };

    let mut roots: BTreeSet<String> = BTreeSet::new();
    for value in source_roots {
        let values = match value.as_array() { Some(v) => v, None => return refused(seq, "INVALID_ROOTS") };
        for root in values {
            let root = match root.as_str() { Some(v) if !v.is_empty() && v.len() <= 256 => v, _ => return refused(seq, "INVALID_ROOTS") };
            roots.insert(root.to_string());
        }
    }
    if roots.is_empty() && source_ids.is_empty() {
        roots.insert(format!("self:{:x}", simple_hash(statement.as_bytes())));
    }
    if roots.len() > MAX_ROOTS { return refused(seq, "TOO_MANY_ROOTS"); }
    let mut root_list: Vec<Value> = roots.into_iter().map(Value::str).collect();
    if root_list.is_empty() { root_list.push(Value::str("external:unknown")); }

    ok(seq, Value::obj(vec![
        ("allowed", Value::Bool(allowed)),
        ("ancestry_roots", Value::Array(root_list)),
        ("effective_capture_source", Value::str(capture_name(effective))),
        ("form", Value::str(form)),
        ("lane", Value::str(lane)),
        ("privacy", Value::str(privacy)),
        ("scope", Value::str(scope)),
        ("tainted", Value::Bool(effective <= 2)),
    ]))
}

fn simple_hash(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn permissions(seq: i64, input: &BTreeMap<String, Value>) -> Vec<u8> {
    if !only_keys(input, &["grants", "needs"]) { return refused(seq, "MALFORMED"); }
    let grants = match array(input, "grants") { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
    let needs = match array(input, "needs") { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
    if needs.len() > 16 || grants.len() > 256 { return refused(seq, "TOO_MANY_GRANTS"); }
    let allowed_names = ["store", "disclose-to-context", "dataset", "export", "train", "activate"];
    let mut denied: Vec<Value> = Vec::new();
    for need in needs {
        let need = match object(need) { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
        if !only_keys(need, &["permission", "scope"]) { return refused(seq, "MALFORMED"); }
        let permission = match text(need, "permission") { Some(v) if allowed_names.contains(&v) => v, _ => return refused(seq, "INVALID_PERMISSION") };
        let scope = match text(need, "scope") { Some(v) if !v.is_empty() && v.len() <= 128 => v, _ => return refused(seq, "INVALID_SCOPE") };
        let mut granted = false;
        for grant in grants {
            let grant = match object(grant) { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
            if !only_keys(grant, &["allow", "permission", "scope"]) { return refused(seq, "MALFORMED"); }
            let gp = match text(grant, "permission") { Some(v) => v, None => return refused(seq, "INVALID_PERMISSION") };
            let gs = match text(grant, "scope") { Some(v) => v, None => return refused(seq, "INVALID_SCOPE") };
            let allow = match boolean(grant, "allow") { Some(v) => v, None => return refused(seq, "INVALID_INPUT") };
            if allow && gp == permission && gs == scope { granted = true; break; }
        }
        if !granted { denied.push(Value::str(permission)); }
    }
    ok(seq, Value::obj(vec![
        ("allowed", Value::Bool(denied.is_empty())),
        ("denied", Value::Array(denied)),
    ]))
}

fn recall_rank(seq: i64, input: &BTreeMap<String, Value>) -> Vec<u8> {
    if !only_keys(input, &["budget", "caller", "items"]) { return refused(seq, "MALFORMED"); }
    let caller = match text(input, "caller") { Some(v) if v == "owner" || v == "agent" || v == "lane" => v, _ => return refused(seq, "INVALID_CALLER") };
    let budget = match int(input, "budget") { Some(v) if v >= 0 && v <= 100_000 => v as usize, _ => return refused(seq, "INVALID_BUDGET") };
    let items = match array(input, "items") { Some(v) if v.len() <= MAX_RECALL_ITEMS => v, _ => return refused(seq, "INVALID_ITEMS") };
    struct Candidate { id: String, group: i32, score: i64, chars: usize, root: String, statement_hash: String, superseded: bool }
    let mut candidates: Vec<Candidate> = Vec::new();
    for item in items {
        let item = match object(item) { Some(v) => v, None => return refused(seq, "INVALID_ITEM") };
        if !only_keys(item, &["author", "chars", "id", "lane", "privacy", "quarantined", "score", "statement_hash", "superseded"]) {
            return refused(seq, "MALFORMED");
        }
        let id = match text(item, "id") { Some(v) if !v.is_empty() && v.len() <= 128 => v, _ => return refused(seq, "INVALID_ITEM") };
        let lane = match text(item, "lane") { Some(v) if valid_lane(v) => v, _ => return refused(seq, "INVALID_ITEM") };
        let privacy = match text(item, "privacy") { Some(v) if valid_privacy(v) => v, _ => return refused(seq, "INVALID_ITEM") };
        let author = match text(item, "author") { Some(v) => v, None => return refused(seq, "INVALID_ITEM") };
        let score = int(item, "score").unwrap_or(0);
        let chars = int(item, "chars").unwrap_or(0).max(0) as usize;
        let superseded = boolean(item, "superseded").unwrap_or(false);
        let quarantined = boolean(item, "quarantined").unwrap_or(false);
        let statement_hash = text(item, "statement_hash").unwrap_or(id);
        if quarantined { continue; }
        if caller != "owner" && privacy == "local" { continue; }
        let group = if commitment(lane) { 0 } else if superseded { 3 } else if author == caller { 1 } else { 2 };
        candidates.push(Candidate { id: id.to_string(), group, score, chars, root: statement_hash.to_string(), statement_hash: statement_hash.to_string(), superseded });
    }
    candidates.sort_by(|a, b| {
        a.group.cmp(&b.group)
            .then_with(|| b.score.cmp(&a.score))
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut seen = BTreeSet::new();
    let mut used = 0usize;
    let mut ids: Vec<Value> = Vec::new();
    let mut roots: BTreeSet<String> = BTreeSet::new();
    for candidate in candidates {
        if !seen.insert(candidate.statement_hash.clone()) { continue; }
        if used + candidate.chars > budget { continue; }
        used += candidate.chars;
        roots.insert(candidate.root.clone());
        ids.push(Value::str(candidate.id.clone()));
        if ids.len() >= 64 { break; }
    }
    ok(seq, Value::obj(vec![
        ("budget_used", Value::Int(used as i64)),
        ("ids", Value::Array(ids)),
        ("roots", Value::Int(roots.len() as i64)),
    ]))
}

fn dispatch(request: &[u8]) -> Vec<u8> {
    if request.len() > MAX_REQUEST { return refused(0, "REQUEST_BOUND"); }
    let parsed = match parse(request) { Ok(v) => v, Err(_) => return refused(0, "MALFORMED") };
    let envelope = match object(&parsed) { Some(v) => v, None => return refused(0, "MALFORMED") };
    let seq = int(envelope, "seq").unwrap_or(0);
    if !only_keys(envelope, &["abi", "input", "op", "seq"]) { return refused(seq, "MALFORMED"); }
    if int(envelope, "abi") != Some(1) { return refused(seq, "ABI"); }
    let op = match text(envelope, "op") { Some(v) => v, None => return refused(seq, "MALFORMED") };
    let input = match envelope.get("input").and_then(object) { Some(v) => v, None => return refused(seq, "MALFORMED") };
    match op {
        "kira.ping" => {
            if !only_keys(input, &[]) { return refused(seq, "MALFORMED"); }
            ok(seq, Value::obj(vec![("pong", Value::Bool(true))]))
        }
        "kira.classify_note" => classify_note(seq, input),
        "kira.permissions" => permissions(seq, input),
        "kira.recall_rank" => recall_rank(seq, input),
        _ => refused(seq, "UNKNOWN_OP"),
    }
}

mv_abi::mv_cell!(dispatch);
