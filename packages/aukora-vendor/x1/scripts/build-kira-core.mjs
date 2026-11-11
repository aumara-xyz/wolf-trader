#!/usr/bin/env node
/** Meter kira-core with the shared offline builder; retain the original verification gates. */
import { buildMeteredCell } from '../native/mv-meter/build-metered-cell.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const assets = join(root, 'assets')
const wasmPath = join(assets, 'kira-core.wasm')
const REQUIRED = ['__mv_fuel_remaining', '__mv_fuel_set', 'memory', 'mv_abi_version', 'mv_alloc', 'mv_run']

function canonical(value) {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    let out = '"'
    for (const ch of value) {
      const code = ch.codePointAt(0)
      if (ch === '"') out += '\\"'
      else if (ch === '\\') out += '\\\\'
      else if (code <= 0x1f) out += `\\u00${code.toString(16).padStart(2, '0')}`
      else out += ch
    }
    return `${out}"`
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${canonical(key)}:${canonical(value[key])}`).join(',')}}`
}

function call(instance, op, input) {
  const request = new TextEncoder().encode(canonical({ abi: 1, input, op, seq: 1 }))
  instance.exports.__mv_fuel_set(100_000_000n)
  const ptr = instance.exports.mv_alloc(request.byteLength)
  if (ptr < 64) throw new Error('allocation refused')
  new Uint8Array(instance.exports.memory.buffer, ptr, request.byteLength).set(request)
  instance.exports.__mv_fuel_set(100_000_000n)
  const packed = instance.exports.mv_run(ptr, request.byteLength)
  const len = Number(packed >> 32n)
  const off = Number(packed & 0xffff_ffffn)
  return JSON.parse(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, off, len)))
}

async function verify(bytes) {
  const module = await WebAssembly.compile(bytes)
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error('imports forbidden')
  const exports = WebAssembly.Module.exports(module).map(e => e.name).sort()
  if (JSON.stringify(exports) !== JSON.stringify([...REQUIRED].sort())) throw new Error(`exports ${exports.join(',')}`)
  const instance = await WebAssembly.instantiate(module, {})
  instance.exports.__mv_fuel_set(100_000_000n)
  if (instance.exports.mv_abi_version() !== 1) throw new Error('ABI mismatch')
  if (instance.exports.memory.buffer.byteLength > 16 * 65_536) throw new Error('initial memory too large')
  if (call(instance, 'kira.ping', {}).result?.pong !== true) throw new Error('ping failed')
  const allowed = call(instance, 'kira.classify_note', {
    caller: 'owner',
    note: { capture_source: 'owner-typed', form: 'fact', lane: 'evidence', privacy: 'local', scope: 'local-memory', source_ids: [], statement: 'X1 booted' },
    source_captures: [],
    source_roots: [],
  }).result
  if (allowed?.allowed !== true || allowed?.effective_capture_source !== 'owner-typed') throw new Error(`classify failed ${JSON.stringify(allowed)}`)
  const clamped = call(instance, 'kira.classify_note', {
    caller: 'model',
    note: { capture_source: 'owner-typed', form: 'fact', lane: 'evidence', privacy: 'local', scope: 'local-memory', source_ids: [], statement: 'claim' },
    source_captures: ['web-derived'],
    source_roots: [],
  }).result
  if (clamped?.allowed !== false || clamped?.effective_capture_source !== 'web-derived') throw new Error(`clamp failed ${JSON.stringify(clamped)}`)
  const perm = call(instance, 'kira.permissions', { grants: [{ allow: true, permission: 'store', scope: 'local-memory' }], needs: [{ permission: 'store', scope: 'local-memory' }] }).result
  if (perm?.allowed !== true) throw new Error('permission failed')
  const denied = call(instance, 'kira.permissions', { grants: [], needs: [{ permission: 'export', scope: 'dataset' }] }).result
  if (denied?.allowed !== false) throw new Error('default-deny failed')
  const ranked = call(instance, 'kira.recall_rank', {
    budget: 1000,
    caller: 'owner',
    items: [
      { author: 'x1', chars: 10, id: 'b', lane: 'experience', privacy: 'local', quarantined: false, score: 1, statement_hash: 'h2', superseded: false },
      { author: 'x1', chars: 10, id: 'a', lane: 'charter', privacy: 'local', quarantined: false, score: 1, statement_hash: 'h1', superseded: false },
    ],
  }).result
  if (JSON.stringify(ranked?.ids) !== JSON.stringify(['a', 'b'])) throw new Error(`rank failed ${JSON.stringify(ranked)}`)
  return exports
}

await buildMeteredCell({ crate: 'kira-core', maxMemory: 16 * 1024 * 1024, fuel: 100_000_000n, vectors: 'native/kira-core/meter-vectors.json', adapter: 'src/kira-contract.ts' })

await verify(readFileSync(wasmPath))
