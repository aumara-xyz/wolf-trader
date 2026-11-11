# nostr-core (Microverse ABI v1 cell: the organism's Nostr spine)

Nostr is core (plan §0D.4): identity, Kira sync between bodies and user-to-user messaging all speak it.
This cell holds the Nostr rules and cryptography as one sealed, fuel-metered Wasm cell; the Host adapter
`src/aukora-nostr.ts` only moves bytes and supplies randomness. Not wired into the app yet: workers N2
(identity) and N3 (events) call it.

**Laws it keeps.** A signed event proves who wrote it, never that it is permitted: events are evidence and
memory, and Peter's owner card and the grant ledger stay the only door to authority. Every op is a pure
function of its input: no clock and no randomness inside. The Host supplies `created_at`, BIP-340 `aux`,
NIP-44 nonces, and passes a private key only for the one call that needs it. No new cryptography:
BIP-340 Schnorr, SHA-256 and NIP-44 v2 (secp256k1 ECDH, HKDF-SHA256, ChaCha20, HMAC-SHA256) from the
RustCrypto crates the source pinned. Nothing here touches a relay or the network.

## Ops

Canonical JSON (mv-abi); byte strings are lowercase hex.

| Op | Input | Result |
|---|---|---|
| `nostr.ping` | `{}` | `{pong: true, version: 1}` |
| `nostr.public_key` | `{secret}` | `{pubkey}` or `nostr:secret-invalid` |
| `nostr.key_valid` | `{pubkey}` | `{valid}` (BIP-340 `lift_x`) |
| `nostr.event_id` | `{event: {pubkey, created_at, kind, tags, content}}` | `{id, preimage}`: the NIP-01 serialization and its SHA-256 |
| `nostr.event_sign` | `{event: {created_at, kind, tags, content}, secret, aux}` | `{event}` with `pubkey`, `id`, `sig` |
| `nostr.event_verify` | `{event}` (any JSON) | `{valid: true}` or `{valid: false, reason}`; never refused |
| `nostr.npub_encode` / `nostr.npub_decode` | `{pubkey}` / `{npub}` | `{npub}` / `{pubkey}`; `nostr:public-key-invalid`, `nostr:npub-invalid` |
| `nostr.nsec_encode` / `nostr.nsec_decode` | `{secret}` / `{nsec}` | `{nsec}` / `{secret}`; `nostr:secret-invalid`, `nostr:nsec-invalid` |
| `nostr.nip44_conversation_key` | `{secret, pubkey}` | `{conversation_key}`: HKDF-SHA256 extract (salt `nip44-v2`) of the ECDH x |
| `nostr.nip44_message_keys` | `{conversation_key, nonce}` | `{chacha_key, chacha_nonce, hmac_key}` |
| `nostr.nip44_padded_len` | `{length}` | `{padded}` or `nip44:plaintext-length` |
| `nostr.nip44_encrypt` | `{plaintext, nonce}` + `{conversation_key}` or `{secret, pubkey}` | `{payload}` |
| `nostr.nip44_decrypt` | `{payload}` + `{conversation_key}` or `{secret, pubkey}` | `{plaintext}`; the MAC is checked before anything is released |
| `nostr.gift_wrap` | `{rumor: {created_at, kind, tags, content}, secret, recipient, seal: {created_at, nonce, aux}, wrap: {created_at, nonce, aux, secret}}` | `{rumor, wrap}` (NIP-59; any rumor kind) |
| `nostr.unwrap` | `{wrap, secret, contacts, now}` | `{sender, rumor}` |
| `nostr.dm_seal` | `{message: {to, content, created_at, tags}, secret, recipient, seal, wrap}` | `{rumor, wrap}` (NIP-17 kind 14; `to` become the `p` tags) |
| `nostr.dm_open` | `{wrap, secret, contacts, now}` | `{sender, rumor, self_copy}` |

**Strangers are refused before anything is opened.** `unwrap` and `dm_open` verify the wrap (id, signature,
kind 1059, exactly one `p` tag naming this recipient), decrypt the wrap layer (the only way to learn who
sealed it), verify the seal (signature, kind 13, no tags), and then refuse a sender who is neither in
`contacts` nor the recipient's own key with `nostr:stranger`. The rumor, which holds the message, is never
decrypted for a stranger. Only after admission come the time checks (wrap, seal and rumor not after `now`;
deferred so a stranger's future-dated seal cannot earn a retry), the rumor's decryption, its id, and that
its author is the seal's signer (`nostr:sender-mismatch`). `dm_open` also requires kind 14 and, unless it is
the sender's own copy (`self_copy`), a `p` tag naming the recipient. NIP-59 refusals: `wrap-kind-invalid`,
`wrap-not-for-us`, `seal-kind-invalid`, `seal-tags-invalid`, `stranger`, `wrap-time-invalid`,
`seal-time-invalid`, `rumor-id-mismatch`, `rumor-time-invalid`, `sender-mismatch`, `rumor-kind-invalid`,
`recipient-mismatch`, `ephemeral-invalid`, `ephemeral-key-collision` (all `nostr:`), plus the NIP-44 and
event codes of each layer.

Sealing takes every random value from the Host: the one-time wrap key, both nonces, both `aux`, and the seal
and wrap times. The cell requires those times to lie within two days before the rumor's time (NIP-59's "up
to two days in the past", the window the source sampled with `past_time`). Seal and rumor JSON is written in
NIP-01 field order, as the source's serde structs wrote it; any field order and whitespace is read back.

Event reasons and refusals (the source's codes, prefixed `nostr:`): `event-malformed` (shape, types,
created_at above 2^53-1, kind above 65,535, more than 256 tags, an empty tag or more than 32 fields),
`event-control-character` (any control other than `\b \f \n \r \t`), `event-too-large` (64 KiB),
`event-hex-invalid`, `public-key-invalid`, `event-id-mismatch`, `event-signature-invalid`, in the source's
order (shape, parts, id hex, public key, signature hex, id, signature). Envelope refusals: `MALFORMED`,
`ABI`, `UNKNOWN_OP`, `INVALID_INPUT`, `REQUEST_BOUND`, `RESPONSE_BOUND` (1 MiB each way).

NIP-44 refusals (the source's, prefixed `nip44:`): `key-invalid` (any unusable secret or peer key, as in
the source), `plaintext-length` (1..=65,535 bytes), `payload-length`, `unsupported-version` (including a
`#` prefix), `base64-invalid` (standard padded alphabet, canonical trailing bits), `mac-invalid`,
`padding-invalid`, `plaintext-not-utf8`, in that order.

## Provenance

Source **W** = `~/aukora-wasm` at `af58c0d72f853e5fff620c07b3109960cca7e6b2` (read-only, clean for these
paths).

Carried as logic:

| Logic | Source (SHA-256) | What changed |
|---|---|---|
| NIP-01 bounds, control rule, preimage, id, sign, verify, refusal order | W `crates/nostr/src/event.rs` (`cf4edb3f…7655`) | serde becomes explicit reads of the mv-abi request tree and an explicit writer with serde_json's escapes for every character NIP-01 admits; codes gain the `nostr:` prefix |
| BIP-340 keys, scalar import, NIP-19 npub (Bech32, HRP, 32 bytes, 128-char bound, canonical round trip) | W `crates/nostr/src/keys.rs` (`412a192d…f220`) | nsec added with the same rules plus scalar validity; no OS RNG (the Host supplies `aux`) |
| NIP-44 v2: conversation key, message keys, padding, encrypt, decrypt and its check order | W `crates/nostr/src/nip44.rs` (`e3a825f5…56d4`) | the nonce is an input (the Host draws it) instead of `getrandom`; codes gain the `nip44:` prefix |
| NIP-59 seal and wrap, sender authentication before opening, time checks, rumor id and author | W `crates/nostr/src/nip59.rs` (`476836c9…c805`) | gift wrap is generic (the source required kind 14; `dm_seal`/`dm_open` keep that rule); times, nonces, `aux` and the one-time key are inputs; the contact list and the self copy are inputs to the cell instead of a SQLite store |
| Order identity, stranger, time, open; NIP-17 recipient `p` tag | W `crates/messaging/src/ingress.rs` (`authenticate_sender_identity`, then the contact check, then `validate_time`, then `open_message`) | the store, replay fence and counters stay with the caller |
| Float-free wire decoding of seals and rumors (`Event::decode_c1`, CR as whitespace) | W `crates/nostr/src/event.rs`; parser W `crates/canon/src/json.rs` (`6ba659be…8679`) `parse_strict` | the canonical writer is not carried; the rumor gets the same six-key reader (the source used serde) |
| Dependency pins | W `crates/nostr/Cargo.toml` (`e692bbe2…faf6`) | the same exact versions: `k256 =0.14.0` (schnorr, ecdh), `sha2 =0.11.1`, `hkdf =0.13.0`, `hmac =0.13.0`, `chacha20 =0.10.2`, `base64 =0.22.1`, `bech32 =0.12.0`, `zeroize =1.9.1` |

Vectors carried byte-for-byte (under `dsh-plugin-desktop/tests/vectors/`):

| File | From | SHA-256 |
|---|---|---|
| `bip340-test-vectors.csv` (already on main) | bitcoin/bips `bip-0340/test-vectors.csv`, via W `crates/nostr/vectors/` | `34c9d1d9c3a88d524bc80778540dc43f8306ec249a7485293063c376db851c2d` |
| `nostr-prime-vectors.json` (already on main) | aukora-prime `plugins/aukora-nostr/lib`, via W `crates/nostr/vectors/prime-vectors.json` | `992bb5c3d714c3dfd33667ab27359235ae8632d6189b3c0f77eda466d5854005` |
| `nostr-parity-small.json` | W `tools/parity/golden/small.json` (200 synthetic signed NIP-01 events, fixed test keys) | `359a028c60f1f627b782d714d581b446fff000d64342c2838df742baf5d58c6b` |
| `nip44.vectors.json` | the official NIP-44 v2 vectors file, via W `crates/nostr/vectors/nip44.vectors.json`; its SHA-256 equals the checksum nostr-protocol/nips `44.md` publishes (recorded in W `docs/hokkaido-plan/reviews/grok-crypto-redteam-2026-10-21.md`; not re-fetched here) | `269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040` |

The two NIP-19 examples (`npub10elfcs4f…`, `nsec1vl029mgp…` from nostr-protocol/nips `19.md`) are written
into `generate-vectors.mjs`; the npub example is also on main in `aumlok/generate-vectors.mjs`. They were
not re-fetched (no network in this work); both Bech32 checksums verify, which a mistyped copy would not.

`tests/vectors/nostr-core-v1.json` is generated from these files by `generate-vectors.mjs` (expected values
from the published files, never from the cell); the refusal cases are the carried rules.

## Build

```sh
cd dsh-plugin-desktop
node native/nostr-core/generate-vectors.mjs      # tests/vectors/nostr-core-v1.json
node native/nostr-core/build.mjs                 # cargo twice, strip, meter, verify, pin src/aukora-nostr.ts
node native/nostr-core/build.mjs --check         # verify the committed asset and pin (shared builder)
```

Built like `kira-nostr` (see its README): the shared builder links only `mv-abi`, so
`../mv-cargo/build-cargo-metered-cell.mjs` compiles with `cargo rustc --locked --offline` and then uses the
shared stripper, the vendored mv-meter (digest checked) and the shared builder's own `--check`. 16 MiB
memory maximum, 400M fuel per call. A copy at another absolute path built the identical bytes.

## Honest bounds

- **Metered crypto is slow.** mv-meter debits before every instruction with a call (about 30x). RAN on
  this Mac (Node 22.23), fuel per call: event verify 10.1M (~30-50 ms), event sign 14.3M (~45 ms),
  public key 7.1M, NIP-44 conversation key 14.8M (ECDH), NIP-44 encrypt by conversation key 0.28M for
  32 bytes and 59.8M for 65,535 bytes (~220 ms), decrypt of 65,535 bytes 68.0M (~350 ms), `dm_seal`
  48.0M (~145 ms), `dm_open` 46.6M (~170 ms), a stranger refused at 37.7M (~115 ms). The grant is 400M per
  call.
- **A stranger costs the wrap layer.** Learning who sealed a wrap needs the wrap's ECDH, decryption and two
  signature checks; that work is spent on every stranger. Counting refusals per sender is the caller's.
- **No `cargo test`**: the included mv-abi source carries a test module that reads a file this checkout
  lacks. The builder vectors and `tests/aukora-nostr.spec.ts` are the tests.
- **JS strings.** A secret passed as bytes never becomes a JS string. `nsecEncode`'s result and
  `nsecDecode`'s input are secret text by nature; the caller owns them.
