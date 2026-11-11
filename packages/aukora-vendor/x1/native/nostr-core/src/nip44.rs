//! NIP-44 v2 authenticated encryption, governed by the official vectors.
//!
//! Carried from aukora-wasm af58c0d `crates/nostr/src/nip44.rs`: the
//! conversation key is HKDF-SHA256 extract (salt `nip44-v2`) of the `k256`
//! ECDH x-coordinate; per message, HKDF-SHA256 expand of the nonce gives 76
//! bytes (ChaCha20 key, ChaCha20 nonce, HMAC key); the two-byte big-endian
//! length plus zero padding is encrypted with ChaCha20 and `nonce ||
//! ciphertext` is authenticated with HMAC-SHA256; the wire is standard padded
//! base64 of `2 || nonce || ciphertext || mac`. Decryption checks bounds,
//! version and the MAC before releasing anything, then the padding and UTF-8.
//! The only change: the 32-byte nonce is an input (the Host draws it), not
//! `getrandom` inside.

use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20::{
    cipher::{KeyIvInit, StreamCipher},
    ChaCha20,
};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

use crate::keys::Secret;

pub const VERSION: u8 = 2;
pub const MAX_PLAINTEXT_BYTES: usize = 65_535;
pub const MIN_PAYLOAD_BYTES: usize = 99;
pub const MAX_PAYLOAD_BYTES: usize = 65_603;
pub const MIN_BASE64_BYTES: usize = 132;
pub const MAX_BASE64_BYTES: usize = 87_472;

/// HKDF output, erased on drop; never formatted or cloned.
pub struct ConversationKey {
    material: Zeroizing<[u8; 32]>,
}

impl ConversationKey {
    /// ECDH with the peer's even-y lift, then HKDF-SHA256 extract with salt `nip44-v2`.
    pub fn derive(secret: &Secret, peer: &[u8; 32]) -> Result<Self, &'static str> {
        let shared = secret.shared_x(peer).map_err(|_| "nip44:key-invalid")?;
        let (mut extracted, _) = Hkdf::<Sha256>::extract(Some(b"nip44-v2"), shared.as_ref());
        let mut material = Zeroizing::new([0u8; 32]);
        material.copy_from_slice(&extracted);
        extracted.as_mut_slice().zeroize();
        Ok(Self { material })
    }

    /// Imported key material is secret data, not proof of identity or authority.
    pub fn import(material: Zeroizing<[u8; 32]>) -> Self {
        Self { material }
    }

    pub fn bytes(&self) -> &[u8; 32] {
        &self.material
    }

    /// HKDF-SHA256 expand of the nonce: ChaCha20 key, ChaCha20 nonce, HMAC key.
    pub fn message_keys(&self, nonce: &[u8]) -> Result<Zeroizing<[u8; 76]>, &'static str> {
        let mut material = Zeroizing::new([0u8; 76]);
        let expander = Hkdf::<Sha256>::from_prk(self.material.as_ref()).map_err(|_| "nip44:key-invalid")?;
        expander.expand(nonce, material.as_mut()).map_err(|_| "nip44:key-invalid")?;
        Ok(material)
    }
}

/// The pinned padding rule, including the 65,536-byte calculator vector.
pub fn padded_length(plaintext_bytes: usize) -> Result<usize, &'static str> {
    match plaintext_bytes {
        1..=32 => Ok(32),
        33..=65_536 => {
            let power = plaintext_bytes.next_power_of_two();
            let chunk = if power < 512 { 32 } else { power / 8 };
            Ok(plaintext_bytes.div_ceil(chunk) * chunk)
        }
        _ => Err("nip44:plaintext-length"),
    }
}

/// Encrypt 1..=65,535 UTF-8 bytes under a Host-drawn 32-byte nonce.
pub fn encrypt(key: &ConversationKey, plaintext: &str, nonce: &[u8; 32]) -> Result<String, &'static str> {
    let length = plaintext.len();
    if !(1..=MAX_PLAINTEXT_BYTES).contains(&length) {
        return Err("nip44:plaintext-length");
    }
    let material = key.message_keys(nonce)?;
    let mut ciphertext = Zeroizing::new(vec![0u8; 2 + padded_length(length)?]);
    let count = u16::try_from(length).map_err(|_| "nip44:plaintext-length")?;
    ciphertext[..2].copy_from_slice(&count.to_be_bytes());
    ciphertext[2..2 + length].copy_from_slice(plaintext.as_bytes());
    apply_cipher(&material, &mut ciphertext)?;
    let mut mac = message_mac(&material)?;
    mac.update(nonce);
    mac.update(&ciphertext);
    let mut wire = Vec::with_capacity(1 + nonce.len() + ciphertext.len() + 32);
    wire.push(VERSION);
    wire.extend_from_slice(nonce);
    wire.extend_from_slice(&ciphertext);
    wire.extend_from_slice(&mac.finalize().into_bytes());
    Ok(STANDARD.encode(wire))
}

/// Bounded base64, version and MAC before any plaintext; then padding and UTF-8.
pub fn decrypt(key: &ConversationKey, payload: &str) -> Result<Zeroizing<String>, &'static str> {
    if payload.starts_with('#') {
        return Err("nip44:unsupported-version");
    }
    if !(MIN_BASE64_BYTES..=MAX_BASE64_BYTES).contains(&payload.len()) {
        return Err("nip44:payload-length");
    }
    let wire = STANDARD.decode(payload).map_err(|_| "nip44:base64-invalid")?;
    if !(MIN_PAYLOAD_BYTES..=MAX_PAYLOAD_BYTES).contains(&wire.len()) {
        return Err("nip44:payload-length");
    }
    if wire[0] != VERSION {
        return Err("nip44:unsupported-version");
    }
    let nonce = &wire[1..33];
    let tag_start = wire.len() - 32;
    let encrypted = &wire[33..tag_start];
    let material = key.message_keys(nonce)?;
    let mut mac = message_mac(&material)?;
    mac.update(nonce);
    mac.update(encrypted);
    mac.verify_slice(&wire[tag_start..]).map_err(|_| "nip44:mac-invalid")?;
    let mut plaintext = Zeroizing::new(encrypted.to_vec());
    apply_cipher(&material, &mut plaintext)?;
    let count = usize::from(u16::from_be_bytes([plaintext[0], plaintext[1]]));
    if count == 0 || count > plaintext.len() - 2 {
        return Err("nip44:padding-invalid");
    }
    if padded_length(count)? + 2 != plaintext.len() || plaintext[2 + count..].iter().any(|byte| *byte != 0) {
        return Err("nip44:padding-invalid");
    }
    let text = core::str::from_utf8(&plaintext[2..2 + count]).map_err(|_| "nip44:plaintext-not-utf8")?;
    Ok(Zeroizing::new(text.to_owned()))
}

fn apply_cipher(material: &[u8; 76], bytes: &mut [u8]) -> Result<(), &'static str> {
    let mut cipher = ChaCha20::new_from_slices(&material[..32], &material[32..44]).map_err(|_| "nip44:key-invalid")?;
    cipher.try_apply_keystream(bytes).map_err(|_| "nip44:payload-length")
}

fn message_mac(material: &[u8; 76]) -> Result<Hmac<Sha256>, &'static str> {
    Hmac::<Sha256>::new_from_slice(&material[44..]).map_err(|_| "nip44:key-invalid")
}
