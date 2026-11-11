/**
 * Canonical JSON helpers for the Microverse ABI v1 kernel boundary.
 *
 * The module accepts strict canonical JSON: keys sorted by UTF-8 bytes,
 * integers only, quote/backslash and U+0000–U+001F escaped as lower-case
 * `\u00xx`, no short control escapes, no floats, no unpaired surrogates.
 * The Host only sends trusted values, but it still encodes them exactly.
 */
/** The only Microverse ABI version this kernel speaks. */
export const AUKORA_MV_ABI = 1;
const encoder = new TextEncoder();
function compareUtf8(left, right) {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        if (a[index] !== b[index])
            return a[index] - b[index];
    }
    return a.length - b.length;
}
function encodeString(value) {
    let out = '"';
    for (const char of value) {
        const code = char.codePointAt(0);
        if (code >= 0xd800 && code <= 0xdfff)
            throw new Error('canonical JSON rejects unpaired surrogates');
        if (char === '"')
            out += '\\"';
        else if (char === '\\')
            out += '\\\\';
        else if (code <= 0x1f)
            out += `\\u00${code.toString(16).padStart(2, '0')}`;
        else
            out += char;
    }
    return `${out}"`;
}
/**
 * Encode one value exactly as Microverse ABI §3 requires.
 * @param value - trusted JSON value.
 * @returns canonical UTF-8 JSON text.
 */
export function canonicalJson(value) {
    if (value === null)
        return 'null';
    if (value === true)
        return 'true';
    if (value === false)
        return 'false';
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new Error('canonical JSON accepts integers only');
        return String(value);
    }
    if (typeof value === 'string')
        return encodeString(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    const record = value;
    const keys = Object.keys(record).sort(compareUtf8);
    return `{${keys.map(key => `${encodeString(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
/**
 * Build one ABI v1 request envelope.
 * @param seq - per-call sequence number.
 * @param op - closed op name.
 * @param input - op-specific object.
 * @returns canonical request bytes as a string.
 */
export function encodeAukoraRequest(seq, op, input) {
    if (!Number.isSafeInteger(seq) || seq < 1)
        throw new Error('Aukora request seq must be a positive integer');
    return canonicalJson({ abi: AUKORA_MV_ABI, input, op, seq });
}
/** A closed kernel refusal for one call; it is not an instance failure. */
export class AukoraKernelRefusal extends Error {
    code;
    constructor(code) {
        super(`Aukora kernel refused: ${code}`);
        this.name = 'AukoraKernelRefusal';
        this.code = code;
    }
}
/**
 * Parse and validate one kernel response. A refused envelope is a per-call
 * refusal, even when the kernel rejected it before assigning a sequence.
 * @param text - response bytes decoded as UTF-8.
 * @param expectedSeq - sequence the request used.
 * @returns the op result.
 */
export function parseAukoraResponse(text, expectedSeq) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error('Aukora kernel returned non-JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Aukora kernel returned a non-object');
    }
    const response = parsed;
    if (response.status === 'refused') {
        throw new AukoraKernelRefusal(typeof response.code === 'string' ? response.code : 'UNKNOWN');
    }
    if (response.abi !== AUKORA_MV_ABI || response.seq !== expectedSeq) {
        throw new Error('Aukora kernel returned a mismatched envelope');
    }
    if (response.status !== 'ok' || response.result === undefined) {
        throw new Error('Aukora kernel returned an invalid status');
    }
    return response.result;
}
