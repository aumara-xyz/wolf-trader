/**
 * Build, strip, meter, verify and pin one Microverse ABI v1 cell whose crate
 * links audited registry crates (RustCrypto `k256`, `sha2`, `chacha20`...).
 *
 * The shared builder (`../mv-meter/build-metered-cell.mjs`) compiles a cell
 * with two direct rustc calls and links only `mv-abi`, so it cannot link a
 * registry dependency. This wrapper changes only the compile step and keeps
 * everything else the shared builder's:
 *
 * - compile: `cargo rustc --locked --offline` from the cell's own directory.
 *   The cell includes the `mv-abi` source as a module (no path dependency),
 *   so Cargo names every package by its registry source, never a checkout
 *   path. The registry checkout is remapped to `/cargo/registry/src` (it
 *   reaches the module only through panic locations); only those remapped
 *   bytes would change with a different remap, never the code. The link
 *   flags are the shared builder's: no entry, exported memory, the three ABI
 *   exports, a 128 KiB stack, 1 MiB initial memory, a bounded maximum.
 * - strip: the shared `scripts/strip-wasm-exports.mjs`.
 * - meter: the vendored `../mv-meter/meter.mjs`, unmodified, its digest
 *   checked against the shared builder's `METER_SHA256`.
 * - verify: two builds in separate target directories must agree; no
 *   checkout, home or registry path may appear in the module; then the
 *   shared builder's own `--check` runs on the written asset (pin, zero
 *   imports, exact metered exports, ABI 1, every vector exactly and twice).
 *
 * Builder-only; nothing here runs in the app.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripExports } from '../../scripts/strip-wasm-exports.mjs'
import { buildMeteredCell, METER_SHA256 } from '../mv-meter/build-metered-cell.mjs'
import { meter } from '../mv-meter/meter.mjs'

const nativeDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(nativeDir, '..')
const repoRoot = resolve(packageRoot, '..')
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** No checkout, home directory or registry path may reach the module. */
export function assertPathFree(bytes) {
  const latin = new TextDecoder('latin1').decode(bytes)
  for (const leak of [repoRoot, homedir(), '.cargo/registry']) {
    if (latin.includes(leak)) throw new Error(`path ${leak} leaked into the module`)
  }
}

function compile(cell, target) {
  rmSync(target, { recursive: true, force: true })
  const { RUSTFLAGS: _flags, CARGO_ENCODED_RUSTFLAGS: _encoded, CARGO_BUILD_RUSTFLAGS: _build, ...env } = process.env
  execFileSync('cargo', [
    'rustc', '--release', '--locked', '--offline', '--target', 'wasm32-unknown-unknown', '--target-dir', target, '--',
    '-C', 'link-args=--no-entry', '-C', 'link-args=--export-memory',
    '-C', 'link-args=--export=mv_abi_version', '-C', 'link-args=--export=mv_alloc',
    '-C', 'link-args=--export=mv_run', '-C', 'link-args=-z',
    '-C', 'link-args=stack-size=131072', '-C', 'link-args=--initial-memory=1048576',
    '-C', `link-args=--max-memory=${String(cell.maxMemory)}`,
  ], {
    cwd: join(nativeDir, cell.crate),
    env: { ...env, CARGO_ENCODED_RUSTFLAGS: `--remap-path-prefix=${join(cargoHome, 'registry', 'src')}=/cargo/registry/src` },
    stdio: 'inherit',
  })
  const wasm = join(target, 'wasm32-unknown-unknown', 'release', `${cell.crate.replaceAll('-', '_')}.wasm`)
  const source = Uint8Array.from(stripExports(readFileSync(wasm)))
  return { source, metered: meter(source) }
}

/**
 * @param {{ crate: string, maxMemory: number, fuel: bigint, vectors: string, adapter: string }} cell
 */
export async function buildCargoMeteredCell(cell) {
  const meterSha = sha256(readFileSync(new URL('../mv-meter/meter.mjs', import.meta.url)))
  if (meterSha !== METER_SHA256) throw new Error(`mv-meter digest mismatch: ${meterSha}`)
  const asset = join(packageRoot, 'assets', `${cell.crate}.wasm`)
  if (process.argv.includes('--check')) {
    if (!existsSync(asset)) throw new Error(`missing ${asset}`)
    assertPathFree(readFileSync(asset))
    await buildMeteredCell(cell)
    return
  }
  const outDir = join(nativeDir, cell.crate, 'target', 'x1-build')
  const first = compile(cell, `${outDir}-1`)
  const second = compile(cell, `${outDir}-2`)
  if (!Buffer.from(first.source).equals(Buffer.from(second.source))
    || !Buffer.from(first.metered).equals(Buffer.from(second.metered))) {
    throw new Error('non-deterministic rebuild')
  }
  assertPathFree(second.metered)
  writeFileSync(asset, second.metered)
  const adapter = join(packageRoot, cell.adapter)
  const text = readFileSync(adapter, 'utf8')
    .replace(/\n {2}sha256: '[a-f0-9]{64}'/u, `\n  sha256: '${sha256(second.metered)}'`)
    .replace(/\n {2}sourceSha256: '[a-f0-9]{64}'/u, `\n  sourceSha256: '${sha256(second.source)}'`)
  writeFileSync(adapter, text)
  // The shared builder's verification, on the bytes just written.
  execFileSync(process.execPath, [process.argv[1], '--check'], { stdio: 'inherit' })
  console.log(JSON.stringify({
    cell: cell.crate,
    sourceBytes: second.source.length,
    sourceSha256: sha256(second.source),
    bytes: second.metered.length,
    sha256: sha256(second.metered),
    meterSha256: meterSha,
    identicalRebuild: true,
  }))
}
