# aura-relay (Microverse ABI v1 cell)

Plan §0D.4, "Nostr is core": the organism's own relay. One append-only log of
signed NIP-01 events is her event backbone: it mirrors her records (Aura
receipts, Kira notes, mailbox notes, lane results) and witnesses itself with
a signed Aura head. This cell makes every decision about it from facts the
Host reports. The Host (`src/aura-relay.ts`) reads and appends
`events.jsonl`, fsyncs, keeps `head.json`, holds keys, checks BIP-340
signatures with the pinned `kira-nostr` primitive, and looks up ids it
already holds. No network: nothing is published and nothing arrives.

The adapter is `src/aukora-aura-relay.ts`.

## Ops

| op | decides |
| --- | --- |
| `relay.ping`, `relay.genesis` | liveness; the empty log's state and root |
| `relay.admit` | one appended event: valid or the refusal code, the next Merkle state, its index entry, whether a head is now due; always `authority: "none"` |
| `relay.replay` | a batch read from disk, in order, without clock rules; stops at the first refusal and names its position |
| `relay.head` | whether a head is due, and its exact draft (kind 30078) |
| `relay.check` | the replayed log against the retained head: `fresh`, `ok`, `refresh`, or `ROLLBACK` / `FORK` / `HEAD_INVALID`; whether a torn tail is dropped |
| `relay.mirror` | how one organism record becomes an event: the draft and who signs it, or a principal's own event verbatim |
| `relay.query` | which index entries NIP-01 filters select, newest first |
| `relay.root`, `relay.id` | the RFC 6962 root over event ids, and the NIP-01 id (for vectors and differential tests) |

## Validity (`relay.admit`), in order

1. Exact seven-field NIP-01 shape: lowercase hex id, pubkey (64) and sig
   (128), integer `created_at`, kind 0..65535, at most 256 tags of 1..32
   strings (`EVENT_MALFORMED`, `EVENT_HEX`, `EVENT_TAGS`).
2. Only the five JSON short escapes among control characters
   (`EVENT_CONTROL`); serialized event at most 65,536 bytes (`EVENT_TOO_LARGE`).
3. The id is recomputed here: SHA-256 over `[0,pubkey,created_at,kind,tags,content]`
   written exactly as `JSON.stringify` writes it (`EVENT_ID_MISMATCH`).
4. The Host's BIP-340 fact over the claimed id (`EVENT_SIGNATURE_INVALID`).
5. Not already in the log (`EVENT_DUPLICATE`, a Host lookup by id).
6. The closed kind catalog below. Kinds that carry grants, approvals,
   admissions or remote signing elsewhere (4521, 4523, 4526, 24133, 30333,
   39703, 39704) are refused `KIND_AUTHORITY`; others `KIND_UNKNOWN`.
7. The author is the Aura witness or a Kira principal (`AUTHOR_UNKNOWN`), in
   the role its kind allows (`AUTHOR_ROLE`).
8. Appends: `created_at` at most 60 s ahead of the Host clock
   (`EVENT_FUTURE`); a head within 600 s of it (`HEAD_STALE`). Replay skips
   clock rules.
9. The kind's tag and content schema; a mirror event's `i` key is not
   already in the log (`MIRROR_DUPLICATE`).

## Kinds

| kind | what | signed by | content |
| --- | --- | --- | --- |
| 4500 / 4501 | Kira note / supersede (Kira 2 kinds), stored as the principal signed it | that principal (never the witness) | the note, only with an explicit `privacy` of `builders` or `public` (`PRIVATE_PLAINTEXT`) |
| 4530 | Aura receipt: one owner grant-ledger row (`grant`, `permit`, `complete`, `expire`, `revoke`, `refuse`) | Aura witness | empty |
| 4531 | Aura receipt: one goal/task binding decision (`goal-receipts`) | Aura witness | empty |
| 4532 | Kira note reference (local, quarantined, store-signed, or unknown author) | Aura witness | empty |
| 4533 | mailbox note reference (`aukora/mail/to-x1`, `to-claude`) | Aura witness | empty |
| 4534 | lane result: commits and changed paths | the lane's own key (`lane/<id>`) | empty |
| 4535 | Aura receipt: one owner card decision (`shown`, `approved`, `declined`, `withdrawn`, `refused`) or an owner `stop` (w42) | Aura witness | empty |
| 30078 | Aura head (`d` = `aukora-aura-head`), the kind and C3 format carried from aukora-wasm | Aura witness | exact canonical retained head |

Evidence kinds carry closed, two-field tags only; single-letter tags are the
NIP-01 query facets: `t` (record type), `x` (receipt, statement or file
hash), `i` (the mirror key `aukora-<source>:<sha256>`), `e`, `c` (commits),
`d`. Owner-signed events come later: owner binding stays off until G6, and
the names `owner`, `peter`, `all`, `everyone`, `kira`, `host`, `system` are
refused as principals.

## Mirror (`relay.mirror`)

- **ledger:** the cell-authored ledger row. Tags: `t`, `x` = its receipt,
  `grant`, `task`, `attempt` + `call` (permit), `expires`, `budget`,
  `effect`s and `paths` = SHA-256 of the canonical path list (grant). The
  objective (the owner's words) is never copied; `detail` free text is
  hashed. Key: SHA-256 of the canonical row. A permit spent through a
  schedule or delegated child names its parent as `grant` and adds `child`
  (the child grant id, under that parent); its `attempt` is then
  `{child}|{call id}`, the grant-ledger cell's child attempt prefix. `child`
  appears on permit receipts only.
- **goal:** decision, reasons, receipt digest and match, grant, task,
  revision, base.
- **kira:** a principal's own event travels verbatim (one event, one id in
  Kira and in the log) only when the stored note is `builders` or `public`,
  not quarantined, its event carries that same explicit label, and its author
  is a known principal. Otherwise a 4532 reference: note id, privacy, lane,
  author, principal event id; the statement hash only when not `local` (a
  short private statement's hash is guessable, the salted note id is not).
- **owner (w42):** one owner card decision or STOP as the owner service saw it:
  `t` = the decision, `card` (the card's id; every decision about a card names it,
  a STOP names none), `tool` (shown only), `reason` (a code such as
  `closed-or-expired` or `owner-stop`; declined, withdrawn and refused only), `x` =
  the approved decision digest and `grant` = the grant it minted (approved only;
  a STOP may name the grant it ended). Key: SHA-256 of the canonical decision.
  Never the owner's words. No other kind fits: 4530 is a row the grant-ledger
  cell wrote, and a card that is shown, declined or withdrawn never reaches it.
- **mail:** box, name, size and SHA-256 of the bytes; never the text.
- **lane:** lane, run, outcome, exit, merged, up to 32 commits, up to 200
  changed paths within 48 KiB (`paths-total` counts the rest), task id,
  contract digest, attempt, lease; the task text and output tail as hashes.
  Signed by `lane/<id>`; without that principal, `SIGNER_UNKNOWN`.

## Memory and evidence, never authority

- No kind here can open, approve, extend or widen a grant; grant-carrying
  kinds are refused outright, and every admission answers `authority: "none"`.
- The owner grant ledger is the only authority. It never reads this log, and
  `tests/aura-relay.spec.ts` proves that a witness-signed receipt for an
  invented grant, a principal-signed receipt, grant kinds, and byte-for-byte
  or re-signed replays create or extend nothing in a reopened ledger.

## Head witness and rollback (NS-05, local part)

- The Merkle tree is RFC 6962 over event ids (`0x00` leaf, `0x01` node,
  empty root `sha256("")`), carried from aukora-wasm `crates/aura-core/src/merkle.rs`.
  The Host carries the frontier (one subtree root per set bit of the size).
- A head is due after the first entry, then after 64 entries or 600 s once
  anything new is logged. Its content is the C3 retained head
  (`{"hash","leafConvention","root","schema","sequence","treeSize"}`, carried
  from aukora-wasm `crates/relay/src/witness.rs`), committing to the log
  prefix before it; admission compares bytes, so every head in the log is
  checked against its prefix root on every replay.
- After appending a head the Host writes `head.json` (staged, fsynced,
  renamed). On open, `relay.check` finds it in the log at `treeSize + 1`
  (`ok`), sees a newer in-log head (`refresh`, the crash window), or refuses:
  log no longer holds it and is not longer than its tree (`ROLLBACK`), or is
  longer but different (`FORK`). A torn tail after the last newline was never
  witnessed and is dropped.
- Honest bound: restoring the log and `head.json` together from an older
  copy is invisible locally; relay publication of heads and drand time
  anchors (NS-05's remote part) close it later.

## ABI and bounds

- Exports exactly `memory`, `mv_abi_version`, `mv_alloc`, `mv_run` before the
  `mv-meter` transform adds `__mv_fuel_set` / `__mv_fuel_remaining`; zero
  imports, no floats; canonical JSON through the vendored `mv-abi`; requests
  and responses bounded at 1 MiB; memory at most 64 MiB; replay batches at
  most 4,096 events, query calls at most 65,536 entries.
- Metered, fuel 1,000,000,000 per call. Measured: the costliest vector
  (`id-too-large`, a 65 KiB event) 25,712,511; a 256-event replay batch
  (162 KB) 112,866,287; a 16 KiB note admit 9,391,410; the largest lane
  result admit 10,683,553; a two-filter query over 1,024 entries 153,457,655.
  The Host replays 256 events or 256 KiB per call and queries 512 entries per
  call, then once more over the union of per-chunk winners (exact for
  `limit`).
- SHA-256 is carried from X1 main `native/laya/src/lib.rs` (FIPS 180-4
  vectors in the unit tests). BIP-340 stays in the `kira-nostr` primitive
  behind `signAuraDraft` / `verifyAuraSignature` in `src/aura-relay.ts`, the
  one place to switch to N1's `nostr-core`.

## Build

```sh
cd dsh-plugin-desktop
node tests/fixtures/gen-aura-relay-vectors.ts   # independent oracle: kira-nostr ids, a JS RFC 6962 tree, hand rules
node native/aura-relay/build.mjs                # build twice, strip, meter, verify 115 vectors, pin
node native/aura-relay/build.mjs --check        # verify the committed asset and pin
cargo test --offline --manifest-path native/aura-relay/Cargo.toml
```

## Carried (provenance)

| what | from | sha256 |
| --- | --- | --- |
| head kind 30078, `d` tag, C3 retained-head format and parse | aukora-wasm `af58c0d72f` `crates/relay/src/witness.rs` | `3511d154…81f4` |
| RFC 6962 frontier and root | aukora-wasm `af58c0d72f` `crates/aura-core/src/merkle.rs` | `b4a7743a…b188` |
| leaf/node domains | aukora-wasm `af58c0d72f` `crates/canon/src/digest.rs` | `e77efa2c…1323` |
| event bounds (64 KiB, 256 tags, 32 fields, control rule) | aukora-wasm `af58c0d72f` `crates/nostr/src/event.rs` | `cf4edb3f…7655` |
| `tests/vectors/aura-inclusion-v1.json`, byte for byte | aukora-wasm `af58c0d72f` `crates/aura/vectors/inclusion-v1.json` | `d3637ef4…0e2e` |
| SHA-256 | X1 main `bc69949c9f` `native/laya/src/lib.rs` | `6ee62ca7…78d1` |
| Kira kinds 4500/4501, principal names, reserved words | X1 main `bc69949c9f` `native/kira-membrane/src/lib.rs` | |
| Prime NIP-01 vector (`nostr-prime-vectors.json`, already on main) | X1 main `bc69949c9f` `tests/vectors/` | `992bb5c3…5005` |
