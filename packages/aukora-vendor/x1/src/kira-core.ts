/** Native caller for the pinned Kira Microverse ABI v1 core. */

import { admitCellModule } from '../scripts/aukora-cell-admission.mjs'
import { readFileSync } from 'node:fs'
import { KIRA_CORE_MODULE } from './kira-contract.ts'
import { canonicalJson, type AukoraJson } from './aukora-canonical.ts'

/** Refusal raised by the Kira core; callers surface the code, never a silent pass. */
export class KiraCoreError extends Error {
  readonly code: string
  constructor(code: string) {
    super(`kira core refused: ${code}`)
    this.name = 'KiraCoreError'
    this.code = code
  }
}

interface KiraExports {
  readonly __mv_fuel_set: (fuel: bigint) => void
  readonly __mv_fuel_remaining: () => bigint
  readonly memory: WebAssembly.Memory
  readonly mv_abi_version: () => number
  readonly mv_alloc: (length: number) => number
  readonly mv_run: (pointer: number, length: number) => bigint
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Verify and instantiate the pinned Kira core.
 * @param bytes - optional test bytes; defaults to the packaged asset.
 * @returns a synchronous caller.
 */
export function loadKiraCore(bytes?: Uint8Array): KiraCore {
  return new KiraCore(bytes ?? readFileSync(new URL('../assets/kira-core.wasm', import.meta.url)))
}

/** One pinned Kira Wasm instance; calls are serialized by the JS thread. */
export class KiraCore {
  private readonly instance: WebAssembly.Instance
  private readonly exports: KiraExports
  private seq = 0

  private trapped = false
  private peakFuel = 0n
  get maxFuelUsed(): bigint { return this.peakFuel }

  private exportCall<T>(run: () => T): T {
    if (this.trapped) throw new Error('kira-core INSTANCE_TRAPPED')
    const grant = BigInt(this.fuel)
    this.exports.__mv_fuel_set(grant)
    try {
      const result = run()
      const used = grant - this.exports.__mv_fuel_remaining()
      if (used > this.peakFuel) this.peakFuel = used
      return result
    } catch (cause) {
      this.trapped = true
      throw new Error('kira-core FUEL_OR_TRAP', { cause })
    }
  }

  constructor(bytes: Uint8Array, private readonly fuel: number = KIRA_CORE_MODULE.fuel) {
    if (!Number.isSafeInteger(fuel) || fuel <= 0) throw new Error('kira-core invalid fuel grant')
    const { module } = admitCellModule(KIRA_CORE_MODULE, bytes, (code, detail) => new Error(
      code === 'MODULE_HASH' ? `kira core hash mismatch: ${String(detail)}`
        : code === 'MODULE_IMPORTS' ? 'kira core must not import'
          : code === 'MODULE_EXPORTS' ? `kira core exports mismatch: ${String(detail)}`
            : `kira core is outside the pinned bound (${String(detail)})`))
    this.instance = new WebAssembly.Instance(module, {})
    this.exports = this.instance.exports as unknown as KiraExports
    if (this.exportCall(() => this.exports.mv_abi_version()) !== 1) throw new Error('kira core ABI mismatch')
  }

  /**
   * Call one Kira op with canonical JSON.
   * @param op - operation name.
   * @param input - closed input object.
   * @returns the result object.
   */
  invoke(op: string, input: Record<string, unknown>): AukoraJson {
    const seq = ++this.seq
    const request = new TextEncoder().encode(canonicalJson({ abi: 1, input, op, seq } as unknown as AukoraJson))
    const pointer = this.exportCall(() => this.exports.mv_alloc(request.byteLength))
    if (pointer < 64) throw new KiraCoreError('ALLOC')
    new Uint8Array(this.exports.memory.buffer, pointer, request.byteLength).set(request)
    const packed = this.exportCall(() => this.exports.mv_run(pointer, request.byteLength))
    const length = Number(packed >> 32n)
    const offset = Number(packed & 0xffff_ffffn)
    if (length > 65_536 || offset + length > this.exports.memory.buffer.byteLength) {
      throw new KiraCoreError('RESPONSE_BOUND')
    }
    const raw = new TextDecoder().decode(new Uint8Array(this.exports.memory.buffer, offset, length))
    let decoded: unknown
    try { decoded = JSON.parse(raw) } catch { throw new KiraCoreError('MALFORMED_RESPONSE') }
    if (!isRecord(decoded) || decoded.abi !== 1 || decoded.seq !== seq) throw new KiraCoreError('ABI')
    if (decoded.status === 'refused') {
      throw new KiraCoreError(typeof decoded.code === 'string' ? decoded.code : 'REFUSED')
    }
    if (decoded.status !== 'ok' || !isRecord(decoded.result)) throw new KiraCoreError('MALFORMED_RESPONSE')
    return decoded.result as AukoraJson
  }

  /** Liveness check. */
  ping(): boolean {
    const result = this.invoke('kira.ping', {})
    return (result as Record<string, unknown>).pong === true
  }

  /** Classify one note draft against caller and sources. */
  classifyNote(input: Record<string, unknown>): Record<string, unknown> {
    return this.invoke('kira.classify_note', input) as Record<string, unknown>
  }

  /** Check scope-exact permissions. */
  permissions(input: Record<string, unknown>): { allowed: boolean; denied: string[] } {
    return this.invoke('kira.permissions', input) as { allowed: boolean; denied: string[] }
  }

  /** Rank recall candidates deterministically. */
  recallRank(input: Record<string, unknown>): { ids: string[]; budget_used: number; roots: number } {
    return this.invoke('kira.recall_rank', input) as { ids: string[]; budget_used: number; roots: number }
  }
}
