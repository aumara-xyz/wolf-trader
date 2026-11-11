//! BIP-340 keys and NIP-19 `npub`/`nsec` addresses.
//!
//! Carried from aukora-wasm af58c0d `crates/nostr/src/keys.rs`: x-only keys
//! are validated with `k256` (`lift_x`), secrets are nonzero scalars below
//! the group order held in zeroizing storage, signatures are BIP-340 over the
//! exact message bytes, and NIP-19 strings use the original Bech32 checksum,
//! a 32-byte payload, the exact HRP and a canonical (lowercase) round trip.
//! A valid key or signature proves who signed, never that anything is
//! permitted.

use bech32::{primitives::decode::CheckedHrpstring, Bech32, Hrp};
use k256::schnorr::{Signature, SigningKey, VerifyingKey};
use zeroize::Zeroizing;

/// The longest NIP-19 string either decoder reads (the source's bound).
const MAX_BECH32: usize = 128;

/// A valid nonzero scalar, erased on drop (`k256`'s `SigningKey` zeroizes
/// itself); never formatted or cloned.
pub struct Secret {
    key: SigningKey,
    material: Zeroizing<[u8; 32]>,
}

impl Secret {
    /// Import 32 bytes; refuses zero and values at or above the group order.
    pub fn import(bytes: Zeroizing<[u8; 32]>) -> Result<Self, &'static str> {
        let key = SigningKey::from_slice(bytes.as_ref()).map_err(|_| "nostr:secret-invalid")?;
        Ok(Self { key, material: bytes })
    }

    pub fn bytes(&self) -> &[u8; 32] {
        &self.material
    }

    /// The x-only public key.
    pub fn public(&self) -> [u8; 32] {
        self.key.verifying_key().to_bytes().into()
    }

    /// BIP-340 signature over the exact message bytes with Host-supplied `aux`.
    pub fn sign(&self, message: &[u8], aux: &[u8; 32]) -> Result<[u8; 64], &'static str> {
        self.key.sign_raw(message, aux).map(|signature| signature.to_bytes()).map_err(|_| "nostr:sign-failed")
    }

    /// ECDH x-coordinate with an x-only peer (its even-y lift), as NIP-44 uses.
    pub fn shared_x(&self, peer: &[u8; 32]) -> Result<Zeroizing<[u8; 32]>, &'static str> {
        let own = k256::SecretKey::from_slice(self.material.as_ref()).map_err(|_| "nostr:secret-invalid")?;
        let mut point = [0u8; 33];
        point[0] = 2;
        point[1..].copy_from_slice(peer);
        let other = k256::PublicKey::from_sec1_bytes(&point).map_err(|_| "nostr:public-key-invalid")?;
        let shared = k256::ecdh::diffie_hellman(own.to_nonzero_scalar(), other.as_affine());
        let mut material = Zeroizing::new([0u8; 32]);
        material.copy_from_slice(shared.raw_secret_bytes());
        Ok(material)
    }
}

/// Whether 32 bytes are a valid BIP-340 x-only key.
pub fn valid_point(key: &[u8; 32]) -> bool {
    VerifyingKey::from_slice(key).is_ok()
}

/// BIP-340 verification of exact message bytes; false for a bad key or signature.
pub fn verify(key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool {
    let Ok(verifier) = VerifyingKey::from_slice(key) else { return false };
    let Ok(parsed) = Signature::try_from(signature.as_slice()) else { return false };
    verifier.verify_raw(message, &parsed).is_ok()
}

fn encode(hrp: &str, data: &[u8; 32]) -> Result<String, &'static str> {
    let prefix = Hrp::parse(hrp).map_err(|_| "nostr:bech32-invalid")?;
    bech32::encode::<Bech32>(prefix, data).map_err(|_| "nostr:bech32-invalid")
}

/// Checksum, HRP, exactly 32 bytes and a canonical round trip.
fn decode(hrp: &str, text: &str, refusal: &'static str) -> Result<Zeroizing<[u8; 32]>, &'static str> {
    if text.len() > MAX_BECH32 {
        return Err(refusal);
    }
    let parsed = CheckedHrpstring::new::<Bech32>(text).map_err(|_| refusal)?;
    if parsed.hrp().as_str() != hrp {
        return Err(refusal);
    }
    let mut bytes = Zeroizing::new([0u8; 32]);
    let mut count = 0usize;
    for byte in parsed.byte_iter() {
        if count == 32 {
            return Err(refusal);
        }
        bytes[count] = byte;
        count += 1;
    }
    if count != 32 {
        return Err(refusal);
    }
    let mut again = encode(hrp, &bytes).map_err(|_| refusal)?;
    let canonical = again == text;
    // The re-encoding of an nsec is secret material too.
    unsafe { super::wipe(again.as_bytes_mut()) };
    if !canonical {
        return Err(refusal);
    }
    Ok(bytes)
}

/// NIP-19 `npub` of a valid x-only key.
pub fn npub_encode(key: &[u8; 32]) -> Result<String, &'static str> {
    if !valid_point(key) {
        return Err("nostr:public-key-invalid");
    }
    encode("npub", key)
}

pub fn npub_decode(text: &str) -> Result<[u8; 32], &'static str> {
    let bytes = decode("npub", text, "nostr:npub-invalid")?;
    if !valid_point(&bytes) {
        return Err("nostr:npub-invalid");
    }
    Ok(*bytes)
}

/// NIP-19 `nsec` of a valid secret.
pub fn nsec_encode(secret: &Secret) -> Result<String, &'static str> {
    encode("nsec", secret.bytes())
}

pub fn nsec_decode(text: &str) -> Result<Secret, &'static str> {
    let bytes = decode("nsec", text, "nostr:nsec-invalid")?;
    Secret::import(bytes).map_err(|_| "nostr:nsec-invalid")
}
