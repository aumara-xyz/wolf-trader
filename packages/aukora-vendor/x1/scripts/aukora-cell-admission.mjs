/**
 * The one admission path for every Microverse ABI v1 cell the Host loads.
 *
 * Every cell factory (`src/`, the Workers, `aumlok/`, `laya/`, `pairing/`,
 * `spatial/`, `organism-tools/` and the Kira bridge's `kira-nostr.mjs`) hands
 * its bytes and its own pin here; nothing else reaches the Wasm engine. The
 * order is fixed and the same for every cell:
 *
 *   1. the size bound, `0 < bytes <= pin.maxBytes`;
 *   2. the exact SHA-256 pin, compared on a private copy of the bytes BEFORE
 *      compiling, so no other bytes reach the engine and the compiled bytes
 *      are exactly the hashed bytes;
 *   3. compile;
 *   4. zero imports;
 *   5. exactly the metered ABI v1 export set (mv-meter adds `__mv_fuel_set`
 *      and `__mv_fuel_remaining` to `memory`, `mv_abi_version`, `mv_alloc`,
 *      `mv_run`).
 *
 * Each caller then sets fuel (`__mv_fuel_set`) before every export call,
 * `mv_abi_version` included: mv-meter starts the tank at zero, so a metered
 * export called without fuel traps.
 *
 * A refusal throws the caller's own error, built by `refuse(code, detail)`,
 * so each cell keeps its own error vocabulary; codes are `MODULE_PIN`,
 * `MODULE_BOUND`, `MODULE_HASH`, `MODULE_IMPORTS` and `MODULE_EXPORTS`.
 */
import { createHash } from 'node:crypto'

/** The exact export set of a metered Microverse ABI v1 cell, sorted. */
export const METERED_CELL_EXPORTS = Object.freeze([
  '__mv_fuel_remaining',
  '__mv_fuel_set',
  'memory',
  'mv_abi_version',
  'mv_alloc',
  'mv_run',
])

const HEX64 = /^[0-9a-f]{64}$/u

/** The default refusal when a caller brings no error vocabulary of its own. */
export class CellAdmissionError extends Error {
  /**
   * @param {string} cell
   * @param {string} code
   * @param {string | undefined} detail
   */
  constructor(cell, code, detail) {
    super(`${cell} not admitted: ${code}${detail === undefined ? '' : ` (${detail})`}`)
    this.name = 'CellAdmissionError'
    this.cell = cell
    this.code = code
    this.detail = detail
  }
}

function thrower(pin, refuse) {
  return (code, detail) => {
    throw refuse === undefined ? new CellAdmissionError(String(pin?.name ?? 'cell'), code, detail) : refuse(code, detail)
  }
}

/** Steps 1-2: bound and pin on a private copy; no byte has reached the engine yet. */
function pinnedCopy(pin, bytes, fail) {
  if (pin === null || typeof pin !== 'object' || typeof pin.sha256 !== 'string' || !HEX64.test(pin.sha256)
    || !Number.isSafeInteger(pin.maxBytes) || pin.maxBytes <= 0) {
    fail('MODULE_PIN', 'the pin is malformed')
  }
  if (!(bytes instanceof Uint8Array)) fail('MODULE_BOUND', 'not bytes')
  if (bytes.byteLength === 0 || bytes.byteLength > pin.maxBytes) fail('MODULE_BOUND', `${String(bytes.byteLength)} bytes`)
  const copy = Uint8Array.from(bytes)
  const sha256 = createHash('sha256').update(copy).digest('hex')
  if (sha256 !== pin.sha256) fail('MODULE_HASH', sha256)
  return { copy, sha256 }
}

/** Steps 4-5 on the compiled module. */
function checkShape(module, fail) {
  if (WebAssembly.Module.imports(module).length !== 0) fail('MODULE_IMPORTS', undefined)
  const names = WebAssembly.Module.exports(module).map(entry => entry.name).sort()
  if (names.length !== METERED_CELL_EXPORTS.length || names.some((name, index) => name !== METERED_CELL_EXPORTS[index])) {
    fail('MODULE_EXPORTS', names.join(','))
  }
}

/**
 * Admit one cell synchronously: bound, pin, compile, zero imports, exact exports.
 * @param {{ readonly name?: string, readonly sha256: string, readonly maxBytes: number }} pin
 * @param {Uint8Array} bytes
 * @param {(code: string, detail: string | undefined) => Error} [refuse]
 * @returns {{ module: WebAssembly.Module, sha256: string }}
 */
export function admitCellModule(pin, bytes, refuse) {
  const fail = thrower(pin, refuse)
  const { copy, sha256 } = pinnedCopy(pin, bytes, fail)
  const module = new WebAssembly.Module(copy)
  checkShape(module, fail)
  return { module, sha256 }
}

/**
 * The same admission with an asynchronous compile (Workers and async factories).
 * @param {{ readonly name?: string, readonly sha256: string, readonly maxBytes: number }} pin
 * @param {Uint8Array} bytes
 * @param {(code: string, detail: string | undefined) => Error} [refuse]
 * @returns {Promise<{ module: WebAssembly.Module, sha256: string }>}
 */
export async function admitCellModuleAsync(pin, bytes, refuse) {
  const fail = thrower(pin, refuse)
  const { copy, sha256 } = pinnedCopy(pin, bytes, fail)
  const module = await WebAssembly.compile(copy)
  checkShape(module, fail)
  return { module, sha256 }
}
