//! Float-free JSON reader for events that arrive on the wire (the seal inside
//! a gift wrap, the rumor inside a seal), where other clients' JSON appears:
//! any key order, insignificant whitespace and every RFC 8259 escape.
//!
//! Carried from aukora-wasm af58c0d `crates/canon/src/json.rs`
//! (`parse_strict` and its tree), the parser the source's `Event::decode_c1`
//! uses: UTF-8 without BOM, no duplicate decoded keys, no lone surrogates
//! (escaped or not), integers only within ±(2^53-1) with no fraction,
//! exponent, leading zero or `-0`, nesting at most 64 containers, space / LF /
//! tab around the value and nothing trailing. Its canonical writer is not
//! carried (nothing here re-serializes C1). Refusal codes are the source's.

use std::collections::BTreeSet;

pub const CANON_BOM: &str = "canon:bom";
pub const CANON_INVALID_UTF8: &str = "canon:invalid-utf8";
pub const CANON_INVALID_JSON: &str = "canon:invalid-json";
pub const CANON_INVALID_NUMBER: &str = "canon:invalid-number";
pub const CANON_INTEGER_RANGE: &str = "canon:integer-range";
pub const CANON_LONE_SURROGATE: &str = "canon:lone-surrogate";
pub const CANON_DUPLICATE_KEY: &str = "canon:duplicate-key";
pub const CANON_NESTING_TOO_DEEP: &str = "canon:nesting-too-deep";
pub const CANON_TRAILING_BYTES: &str = "canon:trailing-bytes";

type Result<T> = core::result::Result<T, &'static str>;

/// Maximum number of nested arrays or objects, counting the root container.
pub const MAX_DEPTH: usize = 64;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// A checked C1 tree: unique keys, safe integers, valid Unicode, bounded depth.
pub struct Value {
    node: Node,
}

enum Node {
    Null,
    Boolean(bool),
    Integer(i64),
    Text(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

/// Borrowed, read-only access to a checked value (carried whole; events read
/// only some variants).
#[allow(dead_code)]
pub enum ValueView<'a> {
    Null,
    Boolean(bool),
    Integer(i64),
    Text(&'a str),
    Array(&'a [Value]),
    Object(&'a [(String, Value)]),
}

impl Value {
    pub fn view(&self) -> ValueView<'_> {
        match &self.node {
            Node::Null => ValueView::Null,
            Node::Boolean(value) => ValueView::Boolean(*value),
            Node::Integer(value) => ValueView::Integer(*value),
            Node::Text(value) => ValueView::Text(value),
            Node::Array(value) => ValueView::Array(value),
            Node::Object(value) => ValueView::Object(value),
        }
    }

    /// Looks up an exact object key; non-objects or absent keys return `None`.
    pub fn get(&self, key: &str) -> Option<&Self> {
        match &self.node {
            Node::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

/// Parses one C1 value; refusal order as documented in the source.
pub fn parse_strict(raw_utf8: &[u8]) -> Result<Value> {
    if raw_utf8.starts_with(b"\xef\xbb\xbf") {
        return Err(CANON_BOM);
    }
    let remaining = core::str::from_utf8(raw_utf8).map_err(|_| CANON_INVALID_UTF8)?;
    let mut cursor = Cursor { remaining };
    let parsed = cursor.read_value(0)?;
    cursor.skip_space();
    if !cursor.remaining.is_empty() {
        return Err(CANON_TRAILING_BYTES);
    }
    Ok(parsed)
}

struct Cursor<'a> {
    remaining: &'a str,
}

impl Cursor<'_> {
    fn skip_space(&mut self) {
        self.remaining = self.remaining.trim_start_matches([' ', '\t', '\n']);
    }

    fn consume(&mut self, token: &str) -> bool {
        if let Some(rest) = self.remaining.strip_prefix(token) {
            self.remaining = rest;
            true
        } else {
            false
        }
    }

    fn next_character(&mut self) -> Result<char> {
        let character = self.remaining.chars().next().ok_or(CANON_INVALID_JSON)?;
        self.remaining = &self.remaining[character.len_utf8()..];
        Ok(character)
    }

    fn read_value(&mut self, containers: usize) -> Result<Value> {
        self.skip_space();
        let node = match self.remaining.as_bytes().first() {
            Some(b'"') => Node::Text(self.read_text()?),
            Some(b'-' | b'0'..=b'9') => Node::Integer(self.read_number()?),
            Some(b'[' | b'{') => {
                if containers >= MAX_DEPTH {
                    return Err(CANON_NESTING_TOO_DEEP);
                }
                if self.consume("[") {
                    self.read_array(containers + 1)?
                } else {
                    self.consume("{");
                    self.read_object(containers + 1)?
                }
            }
            _ if self.consume("true") => Node::Boolean(true),
            _ if self.consume("false") => Node::Boolean(false),
            _ if self.consume("null") => Node::Null,
            _ => return Err(CANON_INVALID_JSON),
        };
        Ok(Value { node })
    }

    fn read_number(&mut self) -> Result<i64> {
        let negative = self.consume("-");
        let count = self.remaining.bytes().take_while(u8::is_ascii_digit).count();
        if count == 0 {
            return Err(CANON_INVALID_NUMBER);
        }
        let (digits, rest) = self.remaining.split_at(count);
        self.remaining = rest;
        if (digits.starts_with('0') && (count > 1 || negative)) || matches!(rest.as_bytes().first(), Some(b'.' | b'e' | b'E')) {
            return Err(CANON_INVALID_NUMBER);
        }
        let magnitude = digits.parse::<i64>().map_err(|_| CANON_INTEGER_RANGE)?;
        let number = if negative { -magnitude } else { magnitude };
        if !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&number) {
            return Err(CANON_INTEGER_RANGE);
        }
        Ok(number)
    }

    fn read_text(&mut self) -> Result<String> {
        if !self.consume("\"") {
            return Err(CANON_INVALID_JSON);
        }
        let mut text = String::new();
        loop {
            let character = self.next_character()?;
            if character == '"' {
                return Ok(text);
            }
            if character < ' ' {
                return Err(CANON_INVALID_JSON);
            }
            text.push(if character == '\\' {
                match self.next_character()? {
                    '"' => '"',
                    '\\' => '\\',
                    '/' => '/',
                    'b' => '\u{0008}',
                    'f' => '\u{000c}',
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'u' => self.read_unicode()?,
                    _ => return Err(CANON_INVALID_JSON),
                }
            } else {
                character
            });
        }
    }

    fn read_hex_unit(&mut self) -> Result<u16> {
        let digits = self.remaining.get(..4).ok_or(CANON_INVALID_JSON)?;
        if !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(CANON_INVALID_JSON);
        }
        self.remaining = &self.remaining[4..];
        u16::from_str_radix(digits, 16).map_err(|_| CANON_INVALID_JSON)
    }

    fn read_unicode(&mut self) -> Result<char> {
        let first = self.read_hex_unit()?;
        let scalar = match first {
            0xd800..=0xdbff => {
                if !self.consume("\\u") {
                    return Err(CANON_LONE_SURROGATE);
                }
                let last = self.read_hex_unit()?;
                if !(0xdc00..=0xdfff).contains(&last) {
                    return Err(CANON_LONE_SURROGATE);
                }
                0x10000 + u32::from(first - 0xd800) * 1024 + u32::from(last - 0xdc00)
            }
            0xdc00..=0xdfff => return Err(CANON_LONE_SURROGATE),
            _ => u32::from(first),
        };
        char::from_u32(scalar).ok_or(CANON_LONE_SURROGATE)
    }

    fn read_array(&mut self, containers: usize) -> Result<Node> {
        let mut elements = Vec::new();
        self.skip_space();
        if self.consume("]") {
            return Ok(Node::Array(elements));
        }
        loop {
            elements.push(self.read_value(containers)?);
            self.skip_space();
            if self.consume("]") {
                return Ok(Node::Array(elements));
            }
            if !self.consume(",") {
                return Err(CANON_INVALID_JSON);
            }
        }
    }

    fn read_object(&mut self, containers: usize) -> Result<Node> {
        let mut members = Vec::new();
        let mut keys = BTreeSet::new();
        self.skip_space();
        if self.consume("}") {
            return Ok(Node::Object(members));
        }
        loop {
            self.skip_space();
            let key = self.read_text()?;
            if !keys.insert(key.clone()) {
                return Err(CANON_DUPLICATE_KEY);
            }
            self.skip_space();
            if !self.consume(":") {
                return Err(CANON_INVALID_JSON);
            }
            members.push((key, self.read_value(containers)?));
            self.skip_space();
            if self.consume("}") {
                members.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
                return Ok(Node::Object(members));
            }
            if !self.consume(",") {
                return Err(CANON_INVALID_JSON);
            }
        }
    }
}
