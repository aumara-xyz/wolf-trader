//! NIP-59 gift wrap and seal, and NIP-17 private direct messages, with the
//! sender authenticated before the message is opened.
//!
//! Carried from aukora-wasm af58c0d `crates/nostr/src/nip59.rs` and the order
//! its messaging ingress (`crates/messaging/src/ingress.rs`) uses:
//!
//! 1. verify the outer wrap (id, signature), kind 1059 and exactly one `p` tag
//!    naming this recipient (`authenticate_sender_identity`);
//! 2. decrypt the wrap (NIP-44 with the wrap's one-time key) to reach the seal,
//!    verify the seal (signature, kind 13, no tags): now the sender is known;
//! 3. refuse a sender who is not a contact (`nostr:stranger`) before the
//!    message is opened: the rumor inside the seal is never decrypted;
//! 4. only then the time checks (deferred, so a stranger's future-dated seal
//!    cannot earn a retry), the rumor's decryption, its id, and that its
//!    author is the seal's signer.
//!
//! Every timestamp, nonce, `aux` and the one-time wrap key come from the Host;
//! nothing here is random or reads a clock. The seal and wrap times must lie
//! within two days before the rumor (NIP-59's "up to two days in the past"),
//! the window the source sampled. An authenticated sender is evidence of who
//! wrote, never an owner instruction or a permission.

use zeroize::Zeroizing;

use crate::event::{self, Draft, Event, Unsigned};
use crate::keys::{self, Secret};
use crate::nip44::{self, ConversationKey};

pub const MESSAGE_KIND: u16 = 14;
pub const SEAL_KIND: u16 = 13;
pub const GIFT_WRAP_KIND: u16 = 1059;
pub const TIMESTAMP_JITTER_SECONDS: u64 = 172_800;

/// Host-supplied randomness and time for one encrypted layer.
pub struct Layer {
    pub created_at: u64,
    pub nonce: [u8; 32],
    pub aux: Zeroizing<[u8; 32]>,
}

/// A wrap whose seal signature is checked; the rumor is still sealed.
pub struct AuthenticatedSeal {
    pub seal: Event,
    pub recipient: [u8; 32],
    pub wrap_created_at: u64,
}

fn in_window(layer: u64, rumor: u64) -> bool {
    layer <= rumor && rumor - layer <= TIMESTAMP_JITTER_SECONDS
}

/// Seal a rumor for `recipient` and wrap the seal under a one-time key.
pub fn gift_wrap(
    draft: Draft,
    sender: &Secret,
    recipient: &[u8; 32],
    seal: &Layer,
    wrap: &Layer,
    ephemeral: &Secret,
) -> Result<(([u8; 32], Unsigned), Event), &'static str> {
    if !keys::valid_point(recipient) {
        return Err("nostr:public-key-invalid");
    }
    let rumor = Unsigned { pubkey: sender.public(), draft };
    let rumor_id = event::content_id(&rumor)?;
    if !in_window(seal.created_at, rumor.draft.created_at) {
        return Err("nostr:seal-time-invalid");
    }
    if !in_window(wrap.created_at, rumor.draft.created_at) {
        return Err("nostr:wrap-time-invalid");
    }
    if ephemeral.public() == rumor.pubkey {
        return Err("nostr:ephemeral-key-collision");
    }
    let rumor_json = Zeroizing::new(event::wire(&rumor_id, &rumor, None)?);
    let shared = ConversationKey::derive(sender, recipient)?;
    let sealed = Draft { created_at: seal.created_at, kind: SEAL_KIND, tags: Vec::new(), content: nip44::encrypt(&shared, &rumor_json, &seal.nonce)? };
    let seal_event = event::sign(sender, sealed, &seal.aux)?;
    let seal_json = Zeroizing::new(event::wire(&seal_event.id, &seal_event.unsigned, Some(&seal_event.sig))?);
    let one_time = ConversationKey::derive(ephemeral, recipient)?;
    let wrapped = Draft {
        created_at: wrap.created_at,
        kind: GIFT_WRAP_KIND,
        tags: vec![vec!["p".to_owned(), crate::hex(recipient)]],
        content: nip44::encrypt(&one_time, &seal_json, &wrap.nonce)?,
    };
    let wrap_event = event::sign(ephemeral, wrapped, &wrap.aux)?;
    Ok(((rumor_id, rumor), wrap_event))
}

/// Steps 1 and 2: who sealed this wrap for us. No time policy, no rumor yet.
pub fn authenticate_sender(wrap: &Event, recipient: &Secret) -> Result<AuthenticatedSeal, &'static str> {
    event::verify(wrap)?;
    if wrap.unsigned.draft.kind != GIFT_WRAP_KIND {
        return Err("nostr:wrap-kind-invalid");
    }
    let me = recipient.public();
    let me_hex = crate::hex(&me);
    // Exactly one p tag names this recipient; additional recipients refuse.
    let mut addressed = false;
    for tag in wrap.unsigned.draft.tags.iter().filter(|tag| tag.first().is_some_and(|name| name == "p")) {
        if addressed || tag.len() != 2 || tag[1] != me_hex {
            return Err("nostr:wrap-not-for-us");
        }
        addressed = true;
    }
    if !addressed {
        return Err("nostr:wrap-not-for-us");
    }
    let shared = ConversationKey::derive(recipient, &wrap.unsigned.pubkey)?;
    let seal_json = nip44::decrypt(&shared, &wrap.unsigned.draft.content)?;
    let seal = event::decode_event(seal_json.as_bytes())?;
    event::verify(&seal)?;
    if seal.unsigned.draft.kind != SEAL_KIND {
        return Err("nostr:seal-kind-invalid");
    }
    if !seal.unsigned.draft.tags.is_empty() {
        return Err("nostr:seal-tags-invalid");
    }
    Ok(AuthenticatedSeal { seal, recipient: me, wrap_created_at: wrap.unsigned.draft.created_at })
}

/// Step 4: both layers' times, then the rumor, its id and its author.
pub fn open(sealed: &AuthenticatedSeal, recipient: &Secret, now: u64) -> Result<([u8; 32], Unsigned), &'static str> {
    if recipient.public() != sealed.recipient {
        return Err("nostr:recipient-mismatch");
    }
    if sealed.wrap_created_at > now {
        return Err("nostr:wrap-time-invalid");
    }
    let signer = &sealed.seal.unsigned;
    if signer.draft.created_at > now {
        return Err("nostr:seal-time-invalid");
    }
    let shared = ConversationKey::derive(recipient, &signer.pubkey)?;
    let rumor_json = nip44::decrypt(&shared, &signer.draft.content)?;
    let (id, rumor) = event::decode_rumor(rumor_json.as_bytes())?;
    if event::content_id(&rumor)? != id {
        return Err("nostr:rumor-id-mismatch");
    }
    if rumor.draft.created_at > now {
        return Err("nostr:rumor-time-invalid");
    }
    if rumor.pubkey != signer.pubkey {
        return Err("nostr:sender-mismatch");
    }
    Ok((id, rumor))
}

/// Step 3: a sender who is neither a contact nor this recipient is a stranger.
pub fn admit(sealed: &AuthenticatedSeal, contacts: &[[u8; 32]]) -> Result<(), &'static str> {
    let sender = &sealed.seal.unsigned.pubkey;
    if *sender == sealed.recipient || contacts.contains(sender) { Ok(()) } else { Err("nostr:stranger") }
}

/// NIP-17: a kind 14 rumor; unless it is our own copy, one of its `p` tags names us.
pub fn check_direct_message(rumor: &Unsigned, recipient: &[u8; 32]) -> Result<(), &'static str> {
    if rumor.draft.kind != MESSAGE_KIND {
        return Err("nostr:rumor-kind-invalid");
    }
    if rumor.pubkey == *recipient {
        return Ok(());
    }
    let me = crate::hex(recipient);
    let named = rumor.draft.tags.iter().any(|tag| tag.len() >= 2 && tag[0] == "p" && tag[1] == me);
    if named { Ok(()) } else { Err("nostr:recipient-mismatch") }
}
