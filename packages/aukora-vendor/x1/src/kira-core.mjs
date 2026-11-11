/** Native caller for the pinned Kira Microverse ABI v1 core. */
import { admitCellModule } from '../scripts/aukora-cell-admission.mjs';
import { readFileSync } from 'node:fs';
import { KIRA_CORE_MODULE } from './kira-contract.mjs';
import { canonicalJson } from './aukora-canonical.mjs';
/** Refusal raised by the Kira core; callers surface the code, never a silent pass. */
export class KiraCoreError extends Error {
    code;
    constructor(code) {
        super(`kira core refused: ${code}`);
        this.name = 'KiraCoreError';
        this.code = code;
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Verify and instantiate the pinned Kira core.
 * @param bytes - optional test bytes; defaults to the packaged asset.
 * @returns a synchronous caller.
 */
export function loadKiraCore(bytes) {
    return new KiraCore(bytes ?? readFileSync(new URL('../assets/kira-core.wasm', import.meta.url)));
}
/** One pinned Kira Wasm instance; calls are serialized by the JS thread. */
export class KiraCore {
    fuel;
    instance;
    exports;
    seq = 0;
    trapped = false;
    peakFuel = 0n;
    get maxFuelUsed() { return this.peakFuel; }
    exportCall(run) {
        if (this.trapped)
            throw new Error('kira-core INSTANCE_TRAPPED');
        const grant = BigInt(this.fuel);
        this.exports.__mv_fuel_set(grant);
        try {
            const result = run();
            const used = grant - this.exports.__mv_fuel_remaining();
            if (used > this.peakFuel)
                this.peakFuel = used;
            return result;
        }
        catch (cause) {
            this.trapped = true;
            throw new Error('kira-core FUEL_OR_TRAP', { cause });
        }
    }
    constructor(bytes, fuel = KIRA_CORE_MODULE.fuel) {
        this.fuel = fuel;
        if (!Number.isSafeInteger(fuel) || fuel <= 0)
            throw new Error('kira-core invalid fuel grant');
        const { module } = admitCellModule(KIRA_CORE_MODULE, bytes, (code, detail) => new Error(code === 'MODULE_HASH' ? `kira core hash mismatch: ${String(detail)}`
            : code === 'MODULE_IMPORTS' ? 'kira core must not import'
                : code === 'MODULE_EXPORTS' ? `kira core exports mismatch: ${String(detail)}`
                    : `kira core is outside the pinned bound (${String(detail)})`));
        this.instance = new WebAssembly.Instance(module, {});
        this.exports = this.instance.exports;
        if (this.exportCall(() => this.exports.mv_abi_version()) !== 1)
            throw new Error('kira core ABI mismatch');
    }
    /**
     * Call one Kira op with canonical JSON.
     * @param op - operation name.
     * @param input - closed input object.
     * @returns the result object.
     */
    invoke(op, input) {
        const seq = ++this.seq;
        const request = new TextEncoder().encode(canonicalJson({ abi: 1, input, op, seq }));
        const pointer = this.exportCall(() => this.exports.mv_alloc(request.byteLength));
        if (pointer < 64)
            throw new KiraCoreError('ALLOC');
        new Uint8Array(this.exports.memory.buffer, pointer, request.byteLength).set(request);
        const packed = this.exportCall(() => this.exports.mv_run(pointer, request.byteLength));
        const length = Number(packed >> 32n);
        const offset = Number(packed & 0xffffffffn);
        if (length > 65_536 || offset + length > this.exports.memory.buffer.byteLength) {
            throw new KiraCoreError('RESPONSE_BOUND');
        }
        const raw = new TextDecoder().decode(new Uint8Array(this.exports.memory.buffer, offset, length));
        let decoded;
        try {
            decoded = JSON.parse(raw);
        }
        catch {
            throw new KiraCoreError('MALFORMED_RESPONSE');
        }
        if (!isRecord(decoded) || decoded.abi !== 1 || decoded.seq !== seq)
            throw new KiraCoreError('ABI');
        if (decoded.status === 'refused') {
            throw new KiraCoreError(typeof decoded.code === 'string' ? decoded.code : 'REFUSED');
        }
        if (decoded.status !== 'ok' || !isRecord(decoded.result))
            throw new KiraCoreError('MALFORMED_RESPONSE');
        return decoded.result;
    }
    /** Liveness check. */
    ping() {
        const result = this.invoke('kira.ping', {});
        return result.pong === true;
    }
    /** Classify one note draft against caller and sources. */
    classifyNote(input) {
        return this.invoke('kira.classify_note', input);
    }
    /** Check scope-exact permissions. */
    permissions(input) {
        return this.invoke('kira.permissions', input);
    }
    /** Rank recall candidates deterministically. */
    recallRank(input) {
        return this.invoke('kira.recall_rank', input);
    }
}
