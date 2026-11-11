//! mv-abi: canonical JSON per ABI.md §3/§8. Integer-only, strict UTF-8, keys sorted
//! by UTF-8 bytes. No floats, no exponent syntax, no negative zero, no leading zeros,
//! no duplicate keys, no unpaired surrogates, no trailing data, no insignificant
//! whitespace. Escapes on encode: \" \\ and U+0000–U+001F as lowercase six-byte
//! \u00xx; slash is never escaped; other scalars are literal UTF-8.
//! Limits (ABI §4): nesting ≤ 32, keys per object ≤ 256, integers within ±(2^53−1).

use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>), // BTreeMap<String, _> iterates in UTF-8 byte order
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reject {
    InvalidUtf8,
    Syntax,
    DuplicateKey,
    NonCanonicalNumber,
    IntegerRange,
    Surrogate,
    Depth,
    TooManyKeys,
    TrailingData,
}

const MAX_DEPTH: u32 = 32;
const MAX_KEYS: usize = 256;
const INT_MAX: i64 = 9_007_199_254_740_991;

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(m) => m.get(key),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array(a) => Some(a),
            _ => None,
        }
    }
    pub fn obj(pairs: Vec<(&str, Value)>) -> Value {
        let mut m = BTreeMap::new();
        for (k, v) in pairs {
            m.insert(k.to_string(), v);
        }
        Value::Object(m)
    }
    pub fn str(s: impl Into<String>) -> Value {
        Value::Str(s.into())
    }
}

pub fn parse(bytes: &[u8]) -> Result<Value, Reject> {
    let text = std::str::from_utf8(bytes).map_err(|_| Reject::InvalidUtf8)?;
    let mut p = Parser { b: text.as_bytes(), i: 0 };
    let v = p.value(0)?;
    if p.i != p.b.len() {
        return Err(Reject::TrailingData);
    }
    Ok(v)
}

pub fn encode(v: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    enc(v, &mut out);
    out
}

fn enc(v: &Value, out: &mut Vec<u8>) {
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Int(n) => out.extend_from_slice(n.to_string().as_bytes()),
        Value::Str(s) => enc_str(s.as_bytes(), out),
        Value::Array(a) => {
            out.push(b'[');
            for (i, item) in a.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                enc(item, out);
            }
            out.push(b']');
        }
        Value::Object(m) => {
            out.push(b'{');
            for (i, (k, val)) in m.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                enc_str(k.as_bytes(), out);
                out.push(b':');
                enc(val, out);
            }
            out.push(b'}');
        }
    }
}

fn enc_str(s: &[u8], out: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push(b'"');
    for &c in s {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x00..=0x1f => {
                out.extend_from_slice(b"\\u00");
                out.push(HEX[(c >> 4) as usize]);
                out.push(HEX[(c & 0xf) as usize]);
            }
            _ => out.push(c),
        }
    }
    out.push(b'"');
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn expect(&mut self, c: u8) -> Result<(), Reject> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(Reject::Syntax)
        }
    }
    fn value(&mut self, depth: u32) -> Result<Value, Reject> {
        if depth >= MAX_DEPTH {
            return Err(Reject::Depth);
        }
        match self.peek() {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => Ok(Value::Str(self.string()?)),
            Some(b't') => self.lit("true", Value::Bool(true)),
            Some(b'f') => self.lit("false", Value::Bool(false)),
            Some(b'n') => self.lit("null", Value::Null),
            Some(b'-') | Some(b'0'..=b'9') => self.number(),
            _ => Err(Reject::Syntax),
        }
    }
    fn lit(&mut self, s: &str, v: Value) -> Result<Value, Reject> {
        if self.b.len() - self.i >= s.len() && &self.b[self.i..self.i + s.len()] == s.as_bytes() {
            self.i += s.len();
            Ok(v)
        } else {
            Err(Reject::Syntax)
        }
    }
    fn object(&mut self, depth: u32) -> Result<Value, Reject> {
        self.expect(b'{')?;
        let mut m = BTreeMap::new();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(Value::Object(m));
        }
        loop {
            if m.len() >= MAX_KEYS {
                return Err(Reject::TooManyKeys);
            }
            let k = self.string()?;
            self.expect(b':')?;
            let v = self.value(depth + 1)?;
            if m.insert(k, v).is_some() {
                return Err(Reject::DuplicateKey);
            }
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Value::Object(m));
                }
                _ => return Err(Reject::Syntax),
            }
        }
    }
    fn array(&mut self, depth: u32) -> Result<Value, Reject> {
        self.expect(b'[')?;
        let mut a = Vec::new();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(Value::Array(a));
        }
        loop {
            a.push(self.value(depth + 1)?);
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b']') => {
                    self.i += 1;
                    return Ok(Value::Array(a));
                }
                _ => return Err(Reject::Syntax),
            }
        }
    }
    fn number(&mut self) -> Result<Value, Reject> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        let digits_start = self.i;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.i += 1;
        }
        let digits = &self.b[digits_start..self.i];
        if digits.is_empty() {
            return Err(Reject::Syntax);
        }
        if digits.len() > 1 && digits[0] == b'0' {
            return Err(Reject::NonCanonicalNumber); // leading zero
        }
        if self.b[start] == b'-' && digits == b"0" {
            return Err(Reject::NonCanonicalNumber); // -0
        }
        if matches!(self.peek(), Some(b'.') | Some(b'e') | Some(b'E')) {
            return Err(Reject::NonCanonicalNumber); // floats / exponents
        }
        let text = std::str::from_utf8(&self.b[start..self.i]).map_err(|_| Reject::InvalidUtf8)?;
        let n: i64 = text.parse().map_err(|_| Reject::IntegerRange)?;
        if n < -INT_MAX || n > INT_MAX {
            return Err(Reject::IntegerRange);
        }
        Ok(Value::Int(n))
    }
    fn string(&mut self) -> Result<String, Reject> {
        self.expect(b'"')?;
        let mut s = String::new();
        loop {
            let c = self.peek().ok_or(Reject::Syntax)?;
            self.i += 1;
            match c {
                b'"' => return Ok(s),
                b'\\' => {
                    let e = self.peek().ok_or(Reject::Syntax)?;
                    self.i += 1;
                    match e {
                        b'"' => s.push('"'),
                        b'\\' => s.push('\\'),
                        b'u' => {
                            let cp = self.hex4()?;
                            if (0xd800..0xdc00).contains(&cp) {
                                // high surrogate: must pair with \udc00–\udfff
                                if self.peek() == Some(b'\\') {
                                    self.i += 1;
                                    if self.peek() == Some(b'u') {
                                        self.i += 1;
                                        let lo = self.hex4()?;
                                        if (0xdc00..0xe000).contains(&lo) {
                                            let c = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                                            s.push(char::from_u32(c).ok_or(Reject::Surrogate)?);
                                            continue;
                                        }
                                    }
                                }
                                return Err(Reject::Surrogate);
                            }
                            if (0xdc00..0xe000).contains(&cp) {
                                return Err(Reject::Surrogate); // lone low surrogate
                            }
                            s.push(char::from_u32(cp).ok_or(Reject::Surrogate)?);
                        }
                        _ => return Err(Reject::Syntax), // \/ \b \f \n \r \t are not canonical input
                    }
                }
                0x00..=0x1f => return Err(Reject::Syntax), // raw control chars
                _ => {
                    // multi-byte UTF-8 already validated by from_utf8 at parse()
                    let len = utf8_len(c);
                    let start = self.i - 1;
                    let end = start + len as usize;
                    if end > self.b.len() {
                        return Err(Reject::InvalidUtf8);
                    }
                    let chunk = std::str::from_utf8(&self.b[start..end]).map_err(|_| Reject::InvalidUtf8)?;
                    s.push_str(chunk);
                    self.i = end;
                }
            }
        }
    }
    fn hex4(&mut self) -> Result<u32, Reject> {
        let mut v: u32 = 0;
        for _ in 0..4 {
            let c = self.peek().ok_or(Reject::Syntax)?;
            self.i += 1;
            let d = match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                _ => return Err(Reject::Syntax), // uppercase hex is not canonical
            };
            v = v * 16 + d as u32;
        }
        Ok(v)
    }
}

fn utf8_len(first: u8) -> u8 {
    match first {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn b64_decode(s: &str) -> Result<Vec<u8>, ()> {
    let b = s.as_bytes();
    if b.is_empty() {
        return Ok(Vec::new());
    }
    if b.len() % 4 != 0 {
        return Err(());
    }
    let val = |c: u8| -> Result<u32, ()> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(()),
        }
    };
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    for (ci, chunk) in b.chunks(4).enumerate() {
        let last = ci == b.len() / 4 - 1;
        let pad = if !last {
            0
        } else if chunk[2] == b'=' {
            if chunk[3] != b'=' {
                return Err(());
            }
            2
        } else if chunk[3] == b'=' {
            1
        } else {
            0
        };
        let mut n: u32 = 0;
        for (k, &c) in chunk.iter().enumerate() {
            if c == b'=' {
                if !last || k < 4 - pad {
                    return Err(());
                }
                n <<= 6;
            } else {
                n = (n << 6) | val(c)?;
            }
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

// --- Buffer lifecycle (ABI §10.3): request buffers reclaimed at end of mv_run; the
// previous response buffer reclaimed at the start of the next alloc/run (the runtime
// copies the result before any next call, ABI §2). No per-call leak.

thread_local! {
    static ALLOCS: std::cell::RefCell<Vec<(usize, usize)>> = std::cell::RefCell::new(Vec::new());
    static LAST_RESPONSE: std::cell::RefCell<Option<(usize, usize)>> = std::cell::RefCell::new(None);
}

unsafe fn dealloc(ptr: usize, cap: usize) {
    drop(Vec::from_raw_parts(ptr as *mut u8, 0, cap));
}

fn reclaim_response() {
    LAST_RESPONSE.with(|c| {
        if let Some((p, cap)) = c.borrow_mut().take() {
            unsafe { dealloc(p, cap) };
        }
    });
}

pub fn alloc_buf(len: i32) -> i32 {
    reclaim_response();
    if len <= 0 || len > 65536 {
        return 0;
    }
    let mut buf: Vec<u8> = Vec::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr() as usize;
    let cap = buf.capacity();
    core::mem::forget(buf);
    if ptr < 64 {
        return 0; // offsets below 64 are reserved (ABI.md §2)
    }
    ALLOCS.with(|t| t.borrow_mut().push((ptr, cap)));
    ptr as i32
}

pub fn take_request(ptr: i32, len: i32) -> Vec<u8> {
    let req = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) }.to_vec();
    ALLOCS.with(|t| {
        let mut t = t.borrow_mut();
        if let Some(pos) = t.iter().position(|(p, _)| *p == ptr as usize) {
            let (p, cap) = t.remove(pos);
            unsafe { dealloc(p, cap) };
        }
    });
    req
}

pub fn finish_response(resp: Vec<u8>) -> i64 {
    let rlen = resp.len();
    let ptr = resp.as_ptr() as usize;
    let cap = resp.capacity();
    core::mem::forget(resp);
    LAST_RESPONSE.with(|c| *c.borrow_mut() = Some((ptr, cap)));
    ((rlen as u64) << 32 | (ptr as u64 & 0xffff_ffff)) as i64
}

/// Cell-side ABI plumbing. Each cell crate calls `mv_cell!(dispatch)` once; the macro
/// emits exactly the three required exports (memory comes from the runtime).
/// dispatch takes request bytes, returns response bytes.
#[macro_export]
macro_rules! mv_cell {
    ($dispatch:expr) => {
        #[no_mangle]
        pub extern "C" fn mv_abi_version() -> i32 {
            1
        }

        #[no_mangle]
        pub extern "C" fn mv_alloc(len: i32) -> i32 {
            $crate::alloc_buf(len)
        }

        #[no_mangle]
        pub extern "C" fn mv_run(ptr: i32, len: i32) -> i64 {
            let req = $crate::take_request(ptr, len);
            let f: fn(&[u8]) -> Vec<u8> = $dispatch;
            $crate::finish_response(f(&req))
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vectors_valid() {
        let cases: &str = include_str!("../../../contracts/vectors/cases.json");
        let doc = parse_cases(cases);
        for (input, canonical) in doc.valid {
            let v = parse(input.as_bytes()).unwrap_or_else(|e| panic!("parse {}: {:?}", input, e));
            assert_eq!(encode(&v), canonical.as_bytes(), "encode {}", input);
            let v2 = parse(canonical.as_bytes()).expect("canonical reparse");
            assert_eq!(v, v2, "round-trip {}", canonical);
        }
    }

    #[test]
    fn vectors_invalid() {
        let cases: &str = include_str!("../../../contracts/vectors/cases.json");
        let doc = parse_cases(cases);
        for input in doc.invalid {
            assert!(parse(input.as_bytes()).is_err(), "must reject: {}", input);
        }
    }

    #[test]
    fn b64_roundtrip() {
        for v in [
            &b""[..],
            &b"f"[..],
            &b"fo"[..],
            &b"foo"[..],
            &b"hello world, this is a longer buffer"[..],
            &[0u8, 1, 2, 250, 251, 255][..],
        ] {
            assert_eq!(b64_decode(&b64_encode(v)).unwrap(), v);
        }
        assert!(b64_decode("a").is_err());
        assert!(b64_decode("ab=").is_err());
        assert!(b64_decode("a===").is_err());
        assert!(b64_decode("abcd*").is_err());
        assert!(b64_decode("ab==abcd").is_err());
    }

    struct Cases {
        valid: Vec<(String, String)>,
        invalid: Vec<String>,
    }    fn parse_cases(json: &str) -> Cases {
        let v = parse(json.trim_end().as_bytes()).expect("cases.json is canonical");
        let mut valid = Vec::new();
        for c in v.get("valid").and_then(Value::as_array).unwrap() {
            valid.push((
                c.get("input").and_then(Value::as_str).unwrap().to_string(),
                c.get("canonical").and_then(Value::as_str).unwrap().to_string(),
            ));
        }
        let mut invalid = Vec::new();
        for c in v.get("invalid").and_then(Value::as_array).unwrap() {
            invalid.push(c.get("input").and_then(Value::as_str).unwrap().to_string());
        }
        Cases { valid, invalid }
    }
}
