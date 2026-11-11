#!/usr/bin/env node
/**
 * Build or `--check` the nostr-core Microverse ABI v1 cell (NIP-01, NIP-19,
 * NIP-44 v2, NIP-59, NIP-17 over audited RustCrypto crates); see
 * `../mv-cargo/build-cargo-metered-cell.mjs`.
 */
import { buildCargoMeteredCell } from '../mv-cargo/build-cargo-metered-cell.mjs'

await buildCargoMeteredCell({
  crate: 'nostr-core',
  maxMemory: 16 * 1024 * 1024,
  fuel: 400_000_000n,
  vectors: 'tests/vectors/nostr-core-v1.json',
  adapter: 'src/aukora-nostr.ts',
})
