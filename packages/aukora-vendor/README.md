# Executing AUKORA component closure

These are actual pinned AUKORA components invoked by Wolf's intelligence service. They are not a copy of the full X1, X2 or X6.1 runtime. `MANIFEST.json` records exact inspected source commits and hashes. The three `.wasm` files are byte-identical in the inspected X1 asset directory and X6.1 web cell directory.

- **Kira core:** memory capture classification, taint clamping, scope permissions and deterministic recall ranking.
- **Nostr core:** NIP-01 event IDs, BIP-340 signatures and verification. The underlying cell also supports NIP-19/44/59; Wolf only claims the operations its service actually calls.
- **Aura relay:** RFC 6962 Merkle roots over signed event IDs. Wolf uses its own versioned financial evidence schema, not the donor's entire local relay kind catalog or authority ledger.

The TypeScript files under `x1/src` are unchanged donor source. Adjacent `.mjs` files are TypeScript 6.0.3 output with `.ts` import suffixes rewritten for plain Node. The unchanged admission module verifies byte bounds and SHA-256 before compilation, refuses imports, and checks the exact metered export set. Each donor adapter supplies instruction fuel before executing. These selected cells have pinned memory maxima; this does not contain the Node host or turn a memory note into financial authority.

The included Rust source, Cargo pins, meter, builders and parity vectors are the matching source closure. Normal installation uses the committed pinned assets and needs no Rust toolchain. The donor builders can check the committed cells without building:

```sh
node packages/aukora-vendor/regenerate.mjs --check
node packages/aukora-vendor/x1/scripts/build-kira-core.mjs --check
node packages/aukora-vendor/x1/native/aura-relay/build.mjs --check
node packages/aukora-vendor/x1/native/nostr-core/build.mjs --check
```

A rebuild needs the appropriate Rust `wasm32-unknown-unknown` target and locked Cargo dependency cache; the donor builders deliberately use offline Cargo. The included generated parity vectors suffice for `--check`. Regenerating upstream vector fixtures requires the broader upstream vector inputs listed in the original README; Wolf does not pretend the narrow closure contains that whole repository.

License: original X1 root MIT license retained in `x1/LICENSE`, with source notices unchanged. RustCrypto registry dependencies retain their individual upstream licenses and exact Cargo lock versions. This license does not relicense Wolf's separately copied AGPL Spatial/engine files. Original donor READMEs describe their own source-time status and tooling; Wolf's actual executing surface is documented in `../aukora/README.md`.
