/**
 * Native caller for the pinned aura-relay Microverse ABI v1 cell.
 *
 * The organism's own relay (plan §0D.4, "Nostr is core") decides in Wasm:
 * whether one NIP-01 event is valid for the Aura log (shape, bounds, the id it
 * recomputes, the signature fact, the closed kind catalog, which principal
 * signs which kind, each kind's tag and content schema), the RFC 6962 Merkle
 * frontier over event ids, when a signed Aura head is due and its exact
 * content, whether the log still holds the last retained head (rollback,
 * truncation, fork), how each organism record becomes an event draft, and
 * which events a NIP-01 filter selects. Owner card decisions and STOP are
 * kind 4535 (w42), shaped by the cell from ids and reason codes only. `src/aura-relay.ts` keeps the log
 * file, fsync, key custody and BIP-340 checks.
 *
 * The cell is metered by `mv-meter` v1: fuel is set before every exported
 * call, and a trap discards the instance.
 */

import { admitCellModule } from '../scripts/aukora-cell-admission.mjs'
import { readFileSync } from 'node:fs'
import {
  AukoraKernelRefusal,
  encodeAukoraRequest,
  parseAukoraResponse,
  type AukoraJson,
} from './aukora-canonical.ts'

/** Pinned Microverse ABI v1 aura-relay cell. */
export const AURA_RELAY_MODULE = {
  name: 'aura-relay',
  version: 1,
  abi: 1,
  file: 'aura-relay.wasm',
  /** Metered bytes the Host loads; updated only with a reviewed rebuild. */
  sha256: '65eb44c909d0ef97d9f5160a6b90fde54974c42db95af70366428bebd5080dd5',
  /** Export-stripped rustc output before the meter transform. */
  sourceSha256: '6c67ad840a8c1f6eeccba703200979bf25fc03caea826e4e17f4cd66227a69a9',
  /** `tools/meter/meter.mjs` (mv-meter v1) at aukora-microverse e898ca86. */
  meterSha256: '0c8fcc36550a6c379317780f3f063cdbb04ce514fd64a43dc3a9a8781dfd2714',
  /** Fuel granted before every exported call; see the README for measured costs. */
  fuel: 1_000_000_000,
  /** Hard ceiling for the module before it is read at all. */
  maxBytes: 1024 * 1024,
} as const

/** Largest request and response the cell accepts. */
export const AURA_RELAY_MAX_REQUEST_BYTES = 1_048_576
const MAX_RESPONSE_BYTES = 1_048_576
const MIN_BUFFER_OFFSET = 64

/** Aura log kinds (the cell's closed catalog). */
export const AURA_KIND = Object.freeze({
  note: 4500,
  supersede: 4501,
  receipt: 4530,
  goal: 4531,
  noteRef: 4532,
  mail: 4533,
  lane: 4534,
  owner: 4535,
  head: 30_078,
})

/** A local adapter, transport or trap failure; cell refusals use `AukoraKernelRefusal`. */
export class AuraRelayCellError extends Error {
  readonly code: string

  constructor(code: string, detail?: string) {
    super(`aura-relay refused: ${code}${detail === undefined ? '' : ` (${detail})`}`)
    this.name = 'AuraRelayCellError'
    this.code = code
  }
}

interface AuraRelayExports {
  readonly memory: WebAssembly.Memory
  readonly mv_abi_version: () => number
  readonly mv_alloc: (length: number) => number
  readonly mv_run: (pointer: number, length: number) => bigint
  readonly __mv_fuel_set: (fuel: bigint) => void
  readonly __mv_fuel_remaining: () => bigint
}

/** One signed NIP-01 event, exactly the seven wire fields. */
export interface NostrEvent {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: string
}

/** An unsigned draft the cell wrote; the Host signs it with `sign_as`'s key. */
export interface AuraDraft {
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
}

/** Who signs a draft: the Aura witness key, or one Kira principal's key. */
export type AuraSignAs = { readonly role: 'witness' } | { readonly role: 'principal'; readonly name: string }

/** The witness key and the Kira principals (Auma is `x1`, lanes are `lane/<id>`). */
export interface AuraKeys {
  readonly witness: string
  readonly principals: readonly { readonly name: string; readonly pubkey: string }[]
}

/** Relay state the Host carries between calls; the cell validates and advances it. */
export interface AuraState {
  readonly size: number
  readonly last: string
  readonly frontier: readonly string[]
  readonly head: { readonly size: number; readonly id: string; readonly at: number } | null
}

/** Host facts about one event: the BIP-340 check, and ids it already holds. */
export interface AuraFacts {
  readonly sig_valid: boolean
  readonly seen_id: boolean
  readonly seen_key: boolean
}

/** What the Host keeps per event for queries (single-letter tags only). */
export interface AuraIndexEntry {
  readonly seq: number
  readonly id: string
  readonly pubkey: string
  readonly kind: number
  readonly created_at: number
  readonly tags: readonly (readonly [string, string])[]
}

export interface AuraAdmitted {
  readonly authority: 'none'
  readonly head_due: boolean
  readonly index: AuraIndexEntry
  readonly root: string
  readonly seq: number
  readonly state: AuraState
}

export interface AuraReplayed {
  readonly authority: 'none'
  readonly index: readonly AuraIndexEntry[]
  readonly root: string
  readonly state: AuraState
  readonly refused?: string
  readonly at?: number
}

export interface AuraHeadPlan {
  readonly due: boolean
  readonly root: string
  readonly size: number
  readonly draft?: AuraDraft
  readonly sign_as?: AuraSignAs
}

export interface AuraCheck {
  readonly verdict: 'fresh' | 'ok' | 'refresh'
  readonly drop_torn: boolean
  readonly root: string
  readonly size: number
  readonly warnings: readonly string[]
}

export type AuraMirror =
  | { readonly mode: 'draft'; readonly key: string; readonly sign_as: AuraSignAs; readonly draft: AuraDraft }
  | { readonly mode: 'verbatim'; readonly key: string; readonly event: NostrEvent }

/** One NIP-01 filter: `ids`, `authors`, `kinds`, `#<letter>`, `since`, `until`, `limit`. */
export interface AuraFilter {
  readonly ids?: readonly string[]
  readonly authors?: readonly string[]
  readonly kinds?: readonly number[]
  readonly since?: number
  readonly until?: number
  readonly limit?: number
  readonly [tag: `#${string}`]: readonly string[] | undefined
}

/** Mirror inputs, one per organism record source. */
export type AuraMirrorInput =
  | { readonly source: 'ledger'; readonly record: AukoraJson; readonly at_s: number }
  | { readonly source: 'goal'; readonly receipt: AukoraJson }
  | { readonly source: 'kira'; readonly note: AukoraJson }
  | { readonly source: 'mail'; readonly mail: AukoraJson }
  | { readonly source: 'lane'; readonly run: AukoraJson }
  | { readonly source: 'owner'; readonly decision: AukoraJson }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AuraRelayCellError('MALFORMED_RESULT', label)
  return value
}

function json(value: unknown): AukoraJson {
  return value as AukoraJson
}

/**
 * Verify and instantiate the pinned aura-relay cell.
 * @param bytes - optional test bytes; defaults to the packaged asset.
 * @param fuel - optional test grant; defaults to the pinned grant.
 * @returns a synchronous caller.
 */
export function loadAuraRelayCell(bytes?: Uint8Array, fuel?: number): AuraRelayCell {
  return new AuraRelayCell(bytes ?? readFileSync(new URL('../assets/aura-relay.wasm', import.meta.url)), fuel)
}

/** One pinned aura-relay module; calls are serialized by the JS thread. */
export class AuraRelayCell {
  private readonly module: WebAssembly.Module
  private readonly fuel: bigint
  private exports: AuraRelayExports | undefined
  private seq = 0
  /** Fuel the last completed call consumed. */
  lastFuelUsed = 0n

  constructor(bytes: Uint8Array, fuel: number = AURA_RELAY_MODULE.fuel) {
    if (!Number.isSafeInteger(fuel) || fuel <= 0) throw new AuraRelayCellError('FUEL_GRANT')
    this.fuel = BigInt(fuel)
    this.module = admitCellModule(AURA_RELAY_MODULE, bytes, (code, detail) => new AuraRelayCellError(code, detail)).module
    this.instance()
  }

  /** Liveness check. */
  ping(): boolean {
    return record(this.invoke('relay.ping', {}), 'ping').pong === true
  }

  /** The empty log's state and root. */
  genesis(): { readonly state: AuraState; readonly root: string } {
    return record(this.invoke('relay.genesis', {}), 'genesis') as unknown as { state: AuraState; root: string }
  }

  /** RFC 6962 root over raw entry hashes (event ids), as the log computes it. */
  root(entries: readonly string[]): { readonly root: string; readonly size: number; readonly state: AuraState } {
    return record(this.invoke('relay.root', { entries: [...entries] }), 'root') as unknown as { root: string; size: number; state: AuraState }
  }

  /** The NIP-01 id the cell computes for an event, and whether it matches the claimed one. */
  eventId(event: NostrEvent): { readonly id: string; readonly matches: boolean; readonly preimage_bytes: number } {
    return record(this.invoke('relay.id', { event: json(event) }), 'id') as unknown as { id: string; matches: boolean; preimage_bytes: number }
  }

  /** Decide one appended event; refusals throw `AukoraKernelRefusal`. */
  admit(input: { readonly state: AuraState; readonly keys: AuraKeys; readonly event: NostrEvent; readonly facts: AuraFacts; readonly now: number }): AuraAdmitted {
    const result = record(this.invoke('relay.admit', json(input) as Record<string, AukoraJson>), 'admit')
    if (result.authority !== 'none') throw new AuraRelayCellError('MALFORMED_RESULT', 'authority')
    return result as unknown as AuraAdmitted
  }

  /** Re-decide events read from disk, in order; stops at the first refusal. */
  replay(input: { readonly state: AuraState; readonly keys: AuraKeys; readonly events: readonly { readonly event: unknown; readonly facts: AuraFacts }[] }): AuraReplayed {
    const result = record(this.invoke('relay.replay', json(input) as Record<string, AukoraJson>), 'replay')
    if (result.authority !== 'none' || !Array.isArray(result.index)) throw new AuraRelayCellError('MALFORMED_RESULT', 'replay')
    return result as unknown as AuraReplayed
  }

  /** Whether a head is due, and its draft when the log is not empty. */
  head(state: AuraState, now: number): AuraHeadPlan {
    return record(this.invoke('relay.head', { state: json(state), now }), 'head') as unknown as AuraHeadPlan
  }

  /** Compare the replayed log with the retained head; ROLLBACK, FORK or HEAD_INVALID refuse. */
  check(input: {
    readonly state: AuraState
    readonly keys: AuraKeys
    readonly retained: { readonly event: unknown; readonly facts: AuraFacts } | null
    readonly retained_seq: number | null
    readonly torn: boolean
  }): AuraCheck {
    return record(this.invoke('relay.check', json(input) as Record<string, AukoraJson>), 'check') as unknown as AuraCheck
  }

  /** How one organism record becomes an event (a draft to sign, or a principal's own event). */
  mirror(input: AuraMirrorInput, keys: AuraKeys): AuraMirror {
    const result = record(this.invoke('relay.mirror', { ...(input as unknown as Record<string, AukoraJson>), keys: json(keys) }), 'mirror')
    if (result.mode !== 'draft' && result.mode !== 'verbatim') throw new AuraRelayCellError('MALFORMED_RESULT', 'mirror')
    return result as unknown as AuraMirror
  }

  /** Sequence numbers the filters select, newest first. */
  query(filters: readonly AuraFilter[], entries: readonly AuraIndexEntry[]): number[] {
    const result = record(this.invoke('relay.query', { filters: json(filters), entries: json(entries) }), 'query')
    if (!Array.isArray(result.seqs) || !result.seqs.every(seq => Number.isSafeInteger(seq))) throw new AuraRelayCellError('MALFORMED_RESULT', 'query')
    return result.seqs as number[]
  }

  private instance(): AuraRelayExports {
    if (this.exports !== undefined) return this.exports
    const exports = new WebAssembly.Instance(this.module, {}).exports as unknown as AuraRelayExports
    // Instrumented exports debit fuel too; an empty tank traps immediately.
    exports.__mv_fuel_set(this.fuel)
    if (exports.mv_abi_version() !== AURA_RELAY_MODULE.abi) throw new AuraRelayCellError('MODULE_ABI')
    this.exports = exports
    return exports
  }

  private invoke(op: string, input: Record<string, AukoraJson>): AukoraJson {
    const seq = this.seq + 1
    let request: Uint8Array
    try {
      request = new TextEncoder().encode(encodeAukoraRequest(seq, op, input))
    } catch (cause) {
      throw new AuraRelayCellError('UNREPRESENTABLE', cause instanceof Error ? cause.message : String(cause))
    }
    if (request.byteLength > AURA_RELAY_MAX_REQUEST_BYTES) {
      throw new AuraRelayCellError('REQUEST_BOUND', `${String(request.byteLength)} bytes`)
    }
    const exports = this.instance()
    let text: string
    try {
      exports.__mv_fuel_set(this.fuel)
      const pointer = exports.mv_alloc(request.byteLength)
      if (pointer < MIN_BUFFER_OFFSET) throw new AuraRelayCellError('ALLOC')
      new Uint8Array(exports.memory.buffer, pointer, request.byteLength).set(request)
      exports.__mv_fuel_set(this.fuel)
      const packed = exports.mv_run(pointer, request.byteLength)
      this.lastFuelUsed = this.fuel - exports.__mv_fuel_remaining()
      this.seq = seq
      const length = Number(packed >> 32n)
      const offset = Number(packed & 0xffff_ffffn)
      if (length <= 0 || length > MAX_RESPONSE_BYTES
        || offset < MIN_BUFFER_OFFSET
        || offset + length > exports.memory.buffer.byteLength) {
        throw new AuraRelayCellError('RESPONSE_DESCRIPTOR')
      }
      text = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, offset, length))
    } catch (cause) {
      if (cause instanceof AuraRelayCellError) throw cause
      // A trap leaves the instance in an unknown state; the next call re-instantiates.
      this.exports = undefined
      const remaining = safeRemaining(exports)
      const exhausted = cause instanceof WebAssembly.RuntimeError && remaining !== undefined && remaining < 16n
      throw new AuraRelayCellError(
        exhausted ? 'FUEL' : 'TRAP',
        `${cause instanceof Error ? cause.message : String(cause)}; fuel remaining ${String(remaining)}`,
      )
    }
    try {
      return parseAukoraResponse(text, seq)
    } catch (cause) {
      if (cause instanceof AukoraKernelRefusal) throw cause
      throw new AuraRelayCellError('MALFORMED_RESPONSE', cause instanceof Error ? cause.message : String(cause))
    }
  }
}

function safeRemaining(exports: AuraRelayExports): bigint | undefined {
  try {
    return exports.__mv_fuel_remaining()
  } catch {
    return undefined
  }
}
