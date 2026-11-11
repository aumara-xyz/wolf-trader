/**
 * Build, strip, meter, verify and pin one Microverse ABI v1 cell.
 *
 * Builder-only. The module is compiled with two direct rustc calls from
 * `native/` instead of `cargo build`: Cargo hashes a path dependency outside
 * the crate's own workspace (`../mv-abi`) by its absolute path into
 * `-C metadata`, which renames symbols and reorders functions per checkout.
 * Fixed metadata, sources named relative to `native/`, the release flags
 * below and a remapped checkout prefix give the same bytes from any clone.
 *
 * The stripped module is then metered by the vendored `mv-meter` v1
 * (`./meter.mjs`, byte-for-byte from aukora-microverse at e898ca86) and
 * verified: zero imports, the exact metered export set, no checkout path,
 * fuel set before every export call, and every parity vector answered
 * exactly and deterministically. The build runs twice and must agree.
 * `--check` verifies the committed asset and its adapter pin without compiling.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripExports } from '../../scripts/strip-wasm-exports.mjs'
import { meter } from './meter.mjs'

export const METER_SHA256 = '0c8fcc36550a6c379317780f3f063cdbb04ce514fd64a43dc3a9a8781dfd2714'

const nativeDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(nativeDir, '..')
const repoRoot = resolve(packageRoot, '..')
const EXPORTS = ['__mv_fuel_remaining', '__mv_fuel_set', 'memory', 'mv_abi_version', 'mv_alloc', 'mv_run']

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Canonical JSON matching mv-abi §3 for the ASCII keys these vectors use. */
function canonical(value) {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('integers only')
    return String(value)
  }
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

function invoke(instance, fuel, op, input) {
  const x = instance.exports
  const request = new TextEncoder().encode(canonical({ abi: 1, input, op, seq: 1 }))
  x.__mv_fuel_set(fuel)
  const pointer = x.mv_alloc(request.byteLength)
  if (pointer < 64) throw new Error('allocation refused')
  new Uint8Array(x.memory.buffer, pointer, request.byteLength).set(request)
  x.__mv_fuel_set(fuel)
  const packed = x.mv_run(pointer, request.byteLength)
  const length = Number(packed >> 32n)
  const offset = Number(packed & 0xffff_ffffn)
  return new TextDecoder().decode(new Uint8Array(x.memory.buffer, offset, length))
}

async function verify(bytes, cell) {
  if (new TextDecoder('latin1').decode(bytes).includes(repoRoot)) {
    throw new Error(`checkout path ${repoRoot} leaked into the module`)
  }
  const module = await WebAssembly.compile(bytes)
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error('imports forbidden')
  const exports = WebAssembly.Module.exports(module).map(entry => entry.name).sort()
  if (JSON.stringify(exports) !== JSON.stringify(EXPORTS)) throw new Error(`exports ${exports.join(',')}`)
  const instance = await WebAssembly.instantiate(module, {})
  instance.exports.__mv_fuel_set(cell.fuel)
  if (instance.exports.mv_abi_version() !== 1) throw new Error('ABI mismatch')
  const vectors = JSON.parse(readFileSync(join(packageRoot, cell.vectors), 'utf8'))
  if (vectors.schema !== 1) throw new Error('vector schema')
  for (const item of vectors.cases) {
    const actual = invoke(instance, cell.fuel, item.op, item.input)
    const expected = item.refused === undefined
      ? canonical({ abi: 1, result: item.expect, seq: 1, status: 'ok' })
      : canonical({ abi: 1, code: item.refused, seq: 1, status: 'refused' })
    if (actual !== expected) throw new Error(`vector ${item.name} drifted: ${actual}`)
    if (invoke(instance, cell.fuel, item.op, item.input) !== actual) throw new Error(`vector ${item.name} nondeterministic`)
  }
  return vectors.cases.length
}

function compile(cell, outDir) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const common = [
    '--edition', '2021', '--target', 'wasm32-unknown-unknown',
    '-C', 'opt-level=z', '-C', 'codegen-units=1', '-C', 'panic=abort',
    '-C', 'debuginfo=0', '-C', 'strip=debuginfo',
    `--remap-path-prefix=${repoRoot}=/x1`,
    '--out-dir', outDir,
  ]
  const link = [
    '-C', 'link-args=--no-entry', '-C', 'link-args=--export-memory',
    '-C', 'link-args=--export=mv_abi_version', '-C', 'link-args=--export=mv_alloc',
    '-C', 'link-args=--export=mv_run', '-C', 'link-args=-z',
    '-C', 'link-args=stack-size=131072', '-C', 'link-args=--initial-memory=1048576',
    '-C', `link-args=--max-memory=${String(cell.maxMemory)}`,
  ]
  const { RUSTFLAGS: _ignored, ...env } = process.env
  const rustc = args => execFileSync('rustc', args, { cwd: nativeDir, env, stdio: 'inherit' })
  const crateName = cell.crate.replaceAll('-', '_')
  rustc([...common, '--crate-type', 'rlib', '--crate-name', 'mv_abi', '-C', 'metadata=mv-abi',
    '-C', 'embed-bitcode=yes', 'mv-abi/src/lib.rs'])
  rustc([...common, ...link, '--crate-type', 'cdylib', '--crate-name', crateName,
    '-C', `metadata=${cell.crate}`, '-C', 'lto=fat',
    '--extern', `mv_abi=${join(outDir, 'libmv_abi.rlib')}`, `${cell.crate}/src/lib.rs`])
  const source = Uint8Array.from(stripExports(readFileSync(join(outDir, `${crateName}.wasm`))))
  return { source, metered: meter(source) }
}

/**
 * @param {{ crate: string, maxMemory: number, fuel: bigint, vectors: string, adapter: string }} cell
 */
export async function buildMeteredCell(cell) {
  const meterSha = sha256(readFileSync(new URL('./meter.mjs', import.meta.url)))
  if (meterSha !== METER_SHA256) throw new Error(`mv-meter digest mismatch: ${meterSha}`)
  const asset = join(packageRoot, 'assets', `${cell.crate}.wasm`)
  const adapter = join(packageRoot, cell.adapter)
  const pinned = text => /\n {2}sha256: '([a-f0-9]{64})'/u.exec(text)?.[1]
  if (process.argv.includes('--check')) {
    if (!existsSync(asset)) throw new Error(`missing ${asset}`)
    const bytes = readFileSync(asset)
    const actual = sha256(bytes)
    if (pinned(readFileSync(adapter, 'utf8')) !== actual) throw new Error(`pin mismatch for ${actual}`)
    const count = await verify(bytes, cell)
    console.log(`${cell.crate}: pin verified ${actual} (${String(bytes.length)} bytes, ${String(count)} vectors)`)
    return
  }
  const outDir = join(nativeDir, cell.crate, 'target', 'x1-build')
  const first = compile(cell, `${outDir}-1`)
  const second = compile(cell, `${outDir}-2`)
  if (!Buffer.from(first.metered).equals(Buffer.from(second.metered))) throw new Error('non-deterministic rebuild')
  const count = await verify(second.metered, cell)
  writeFileSync(asset, second.metered)
  const text = readFileSync(adapter, 'utf8')
    .replace(/\n {2}sha256: '[a-f0-9]{64}'/u, `\n  sha256: '${sha256(second.metered)}'`)
    .replace(/\n {2}sourceSha256: '[a-f0-9]{64}'/u, `\n  sourceSha256: '${sha256(second.source)}'`)
  writeFileSync(adapter, text)
  console.log(JSON.stringify({
    cell: cell.crate,
    sourceBytes: second.source.length,
    sourceSha256: sha256(second.source),
    bytes: second.metered.length,
    sha256: sha256(second.metered),
    meterSha256: meterSha,
    vectors: count,
    identicalRebuild: true,
  }))
}
