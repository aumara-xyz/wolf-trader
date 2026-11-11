#!/usr/bin/env node
/** Build or `--check` the aura-relay cell; see `../mv-meter/build-metered-cell.mjs`. */
import { buildMeteredCell } from '../mv-meter/build-metered-cell.mjs'

await buildMeteredCell({
  crate: 'aura-relay',
  maxMemory: 64 * 1024 * 1024,
  fuel: 1_000_000_000n,
  vectors: 'tests/vectors/aura-relay-v1.json',
  adapter: 'src/aukora-aura-relay.ts',
})
