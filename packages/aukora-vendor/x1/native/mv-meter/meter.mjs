// mv-meter v1 — deterministic instruction-metering transformer per ABI.md §5.
// Builder-only, zero dependencies. Transforms a source module into a metered module:
//   - appends a private mutable i64 fuel global (never in guest linear memory);
//   - before every original instruction: i64.const <cost>; call $debit (cost 1, calls 16);
//   - variable-cost ops (memory.grow/copy/fill): operands spilled to fresh private locals in
//     original evaluation order, dynamic cost debited BEFORE mutation, operands restored;
//   - appends $__mv_debit (never exported, never in guest tables) plus the protected exports
//     __mv_fuel_set(i64) / __mv_fuel_remaining() -> i64, after the original index ranges;
//   - fails closed on: imports, start function, float/SIMD/thread/reference instructions,
//     memory.init/data.drop, table.* variable ops, unknown opcodes, non-ABI export sets.
// Pure function of the source bytes; the law checker re-runs it and demands bit-equality.

const I32 = 0x7f, I64 = 0x7e;
const VALTYPES = new Set([I32, I64, 0x70, 0x6f]); // no f32/f64/v128 anywhere

function uleb(n) {
  const b = [];
  do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n);
  return b;
}
function sleb(n) {
  const b = [];
  for (;;) {
    const x = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(x & 0x40)) || (n === -1 && x & 0x40)) { b.push(x); break; }
    b.push(x | 0x80);
  }
  return b;
}
function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
function fail(msg) { throw new Error('mv-meter: ' + msg); }

class Reader {
  constructor(u8) { this.u8 = u8; this.i = 0; }
  byte() { if (this.i >= this.u8.length) fail('truncated'); return this.u8[this.i++]; }
  u32() { let r = 0, s = 0; for (;;) { const b = this.byte(); r |= (b & 0x7f) << s; if (!(b & 0x80)) { if (s === 28 && (b & 0xf0)) fail('u32 LEB overflow'); return r >>> 0; } s += 7; if (s > 28) fail('leb too long'); } }
  bytes(n) { const r = this.u8.subarray(this.i, this.i + n); this.i += n; return r; }
  str() { return new TextDecoder().decode(this.bytes(this.u32())); }
}

const NO_IMM = new Set([
  0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b,
  ...range(0x45, 0x5a),                     // i32/i64 comparisons
  ...range(0x67, 0x8a),                     // i32/i64 arithmetic
  0xa7, 0xac, 0xad,                         // i32.wrap_i64, i64.extend_i32_s/u
  ...range(0xc0, 0xc4),                     // sign-extension
]);
const REJECT = new Set([
  0x2a, 0x2b,                               // f32/f64.load
  0x38, 0x39,                               // f32/f64.store
  0x43, 0x44,                               // float consts
  ...range(0x5b, 0x66),                     // float comparisons
  ...range(0x8b, 0xa6),                     // float arithmetic
  ...range(0xa8, 0xab), ...range(0xae, 0xbf), // float conversions/reinterpret
  0xd0, 0xd1, 0xd2,                         // reference types
]);

export function meter(source) {
  const sections = parseSections(source);
  const mod = analyze(sections);
  const bounds = { funcCount: mod.funcTypes.length, globalCount: mod.globalCount, typeCount: mod.types.length, tableCount: mod.tableCount, localTotal: 0 };
  const tDebit = ensureType(mod, [I64], []);
  const tRemaining = ensureType(mod, [], [I64]);
  const funcBase = mod.funcTypes.length;
  const debitIdx = funcBase, setIdx = funcBase + 1, remIdx = funcBase + 2;
  const fuelGlobal = mod.globalCount;
  mod.funcTypes.push(tDebit, tDebit, tRemaining);
  const bodies = mod.rawBodies.map((raw, k) => rewriteBody(raw, mod.paramCount(k), debitIdx, { ...bounds }));
  bodies.push(debitBody(fuelGlobal), fuelSetBody(fuelGlobal), fuelRemainingBody(fuelGlobal));
  const codeParts = [Uint8Array.from(uleb(bodies.length))];
  for (const b of bodies) codeParts.push(Uint8Array.from(uleb(b.length)), b);
  const parts = [Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])];
  for (const s of sections) {
    let payload = s.payload;
    if (s.id === 1) payload = buildTypeSection(mod.types);
    else if (s.id === 3) payload = buildFuncSection(mod.funcTypes);
    else if (s.id === 6) payload = appendGlobal(s.payload);
    else if (s.id === 7) payload = appendExports(s.payload, setIdx, remIdx);
    else if (s.id === 10) payload = concat(codeParts);
    parts.push(Uint8Array.from([s.id, ...uleb(payload.length)]), payload);
  }
  if (!mod.hasGlobals) fail('module has no global section (expected __stack_pointer)');
  return concat(parts);
}

function concat(parts) {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function parseSections(u8) {
  if (u8.length < 8 || u8[0] !== 0 || u8[1] !== 0x61 || u8[2] !== 0x73 || u8[3] !== 0x6d) fail('bad magic');
  const r = new Reader(u8);
  r.i = 8;
  const sections = [];
  while (r.i < u8.length) {
    const id = r.byte();
    const size = r.u32();
    sections.push({ id, payload: r.bytes(size) });
  }
  return sections;
}

function analyze(sections) {
  const mod = { types: [], funcTypes: [], globalCount: 0, rawBodies: [], tableCount: 0, memoryCount: 0, hasGlobals: false };
  for (const s of sections) {
    const r = new Reader(s.payload);
    if (s.id === 1) {
      const n = r.u32();
      for (let k = 0; k < n; k++) {
        if (r.byte() !== 0x60) fail('bad type entry');
        const params = [...r.bytes(r.u32())];
        const results = [...r.bytes(r.u32())];
        if (params.concat(results).some((t) => !VALTYPES.has(t))) fail('float/v128 in type');
        mod.types.push({ params, results });
      }
    } else if (s.id === 2) {
      if (r.u32() !== 0) fail('source module must have zero imports (ABI §1)');
    } else if (s.id === 3) {
      const n = r.u32();
      for (let k = 0; k < n; k++) mod.funcTypes.push(r.u32());
    } else if (s.id === 4) {
      mod.tableCount = r.u32();
      if (mod.tableCount > 1) fail('more than one table (ABI §4)');
      for (let k = 0; k < mod.tableCount; k++) {
        const rt = r.byte();
        if (rt !== 0x70) fail('non-funcref table (ABI §4)');
        const flag = r.u32();
        const min = r.u32();
        const max = flag & 1 ? r.u32() : null;
        if (max === null) fail('table without explicit maximum (ABI §4)');
        if (min > 64 || max > 1024) fail('table ceilings violated (ABI §4)');
      }
    } else if (s.id === 5) {
      mod.memoryCount = r.u32();
      if (mod.memoryCount !== 1) fail('exactly one memory required (ABI §2)');
      const flag = r.u32();
      r.u32();
      if (flag !== 1) fail('memory flags must be exactly 0x01 (min+max, non-shared, wasm32): got 0x' + flag.toString(16));
      r.u32();
    } else if (s.id === 6) {
      // METER-2: globals parsed fully — integer types only, integer const initializers only
      mod.globalCount = r.u32();
      mod.hasGlobals = true;
      for (let k = 0; k < mod.globalCount; k++) {
        const vt = r.byte();
        if (vt !== 0x7f && vt !== 0x7e) fail('non-integer global type (ABI §2)');
        r.byte(); // mutability
        const op = r.byte();
        if (op !== 0x41 && op !== 0x42) fail('global init not an integer const');
        readLeb(r);
        if (r.byte() !== 0x0b) fail('global init expr malformed');
      }
      if (r.i !== s.payload.length) fail('global section not fully consumed');
    } else if (s.id === 7) {
      // M-02: export indices must reference ORIGINAL ranges — an invalid one is rejected now
      const n = r.u32();
      const names = [];
      const entries = [];
      for (let k = 0; k < n; k++) {
        const nm = r.str();
        names.push(nm);
        const kind = r.byte();
        const idx = r.u32();
        entries.push({ nm, kind, idx });
        const bound = kind === 0 ? mod.funcTypes.length : kind === 1 ? mod.tableCount : kind === 2 ? mod.memoryCount : mod.globalCount;
        if (idx >= bound) fail(`export index ${idx} out of range (kind ${kind}) — invalid original`);
      }
      const want = ['memory', 'mv_abi_version', 'mv_alloc', 'mv_run'];
      if (JSON.stringify(names.sort()) !== JSON.stringify([...want].sort())) {
        fail('original exports != exact ABI v1 set, got [' + names.join(',') + ']');
      }
      // METER-6: kinds + exact §2 signatures, not just names
      for (const e of entries) {
        if (e.nm === 'memory' && e.kind !== 2) fail('memory export is not a memory — invalid original');
        if (e.nm.startsWith('mv_')) {
          if (e.kind !== 0) fail(e.nm + ' export is not a function — invalid original');
          const ty = mod.types[mod.funcTypes[e.idx]];
          const sig = [...ty.params, 0x3d, ...ty.results]; // 0x3d marker separates params/results
          const expect = {
            mv_abi_version: [0x3d, 0x7f],
            mv_alloc: [0x7f, 0x3d, 0x7f],
            mv_run: [0x7f, 0x7f, 0x3d, 0x7e],
          }[e.nm];
          if (JSON.stringify(sig) !== JSON.stringify(expect)) fail(e.nm + ' signature mismatch vs ABI §2');
        }
      }
    } else if (s.id === 8) {
      fail('start function rejected');
    } else if (s.id === 9) {
      // M-02: element segments reference original function indices only; flags-0 form only
      const n = r.u32();
      for (let k = 0; k < n; k++) {
        const flags = r.u32();
        if (flags !== 0) fail('element segment flags != 0 rejected (fail closed)');
        if (r.byte() !== 0x41) fail('element offset not i32.const');
        readLeb(r);
        if (r.byte() !== 0x0b) fail('element offset expr malformed');
        const cnt = r.u32();
        for (let j = 0; j < cnt; j++) {
          if (r.u32() >= mod.funcTypes.length) fail('element references out-of-range function — invalid original');
        }
      }
    } else if (s.id === 10) {
      const n = r.u32();
      for (let k = 0; k < n; k++) mod.rawBodies.push(r.bytes(r.u32()));
    } else if (s.id === 11) {
      const n = r.u32();
      for (let k = 0; k < n; k++) {
        const flag = r.u32();
        if (flag === 0) { if (r.byte() !== 0x41) fail('data offset not i32.const'); readLeb(r); if (r.byte() !== 0x0b) fail('data offset malformed'); }
        else if (flag !== 1) fail('data segment flags >1 rejected (fail closed)');
        r.bytes(r.u32());
      }
    }
    // METER-5: the original is validated structurally, never normalized: every section we
    // parse must be consumed exactly, with nothing left over and nothing skipped.
    if ([1, 2, 3, 4, 5, 6, 7, 9, 10, 11].includes(s.id) && r.i !== s.payload.length) {
      fail('section ' + s.id + ' not fully consumed — invalid original');
    }
  }
  if (mod.rawBodies.length !== mod.funcTypes.length) fail('function/code count mismatch');
  mod.paramCount = (k) => mod.types[mod.funcTypes[k]].params.length;
  return mod;
}

function rewriteBody(body, paramCount, debitIdx, bounds) {
  const r = new Reader(body);
  const groupCount = r.u32();
  const groups = [];
  let declared = 0;
  for (let k = 0; k < groupCount; k++) {
    const n = r.u32();
    const t = r.byte();
    if (!VALTYPES.has(t)) fail('non-integer local type');
    groups.push([n, t]);
    declared += n;
  }
  bounds.localTotal = paramCount + declared;
  const tmp0 = paramCount + declared, tmp1 = tmp0 + 1, tmp2 = tmp0 + 2;
  const out = [];
  const emit = (...b) => out.push(...b);
  const finished = rewriteInstructions(r, emit, tmp0, tmp1, tmp2, debitIdx, bounds);
  if (!finished) fail('function body missing end');
  if (r.i !== r.u8.length) fail('trailing bytes after function body');
  const loc = [...uleb(groupCount + 1)];
  for (const [n, t] of groups) loc.push(...uleb(n), t);
  loc.push(...uleb(3), I32);
  return Uint8Array.from([...loc, ...out]);
}

function rewriteInstructions(r, emit, tmp0, tmp1, tmp2, debitIdx, bounds) {
  const debit = (cost) => emit(0x42, ...sleb(cost), 0x10, ...uleb(debitIdx));
  for (;;) {
    if (r.i >= r.u8.length) return false;
    const op = r.byte();
    if (REJECT.has(op)) fail('rejected opcode 0x' + op.toString(16));
    if (op === 0xfd || op === 0xfe) fail('SIMD/threads prefix rejected');

    if (op === 0x40) { // memory.grow: charge pages*65536 + 1 BEFORE mutation
      if (r.byte() !== 0) fail('memory.grow reserved != 0');
      emit(0x21, ...uleb(tmp0));                                    // local.set tmp0 (pages)
      emit(0x20, ...uleb(tmp0), 0xad, 0x42, ...sleb(65536), 0x7e);  // cost = pages * 65536
      emit(0x42, ...sleb(1), 0x7c);                                 // cost += 1 (base)
      emit(0x10, ...uleb(debitIdx));                                // call debit (cost on stack)
      emit(0x20, ...uleb(tmp0), 0x40, 0x00);                        // local.get tmp0; memory.grow 0
      continue;
    }
    if (op === 0xfc) {
      const sub = r.u32();
      if (sub === 0x0a || sub === 0x0b) {                           // memory.copy / memory.fill
        if (sub === 0x0a) { if (r.byte() !== 0 || r.byte() !== 0) fail('memory.copy reserved != 0'); }
        else if (r.byte() !== 0) fail('memory.fill reserved != 0');
        emit(0x21, ...uleb(tmp2), 0x21, ...uleb(tmp1), 0x21, ...uleb(tmp0)); // spill n, x, d
        emit(0x20, ...uleb(tmp2), 0xad, 0x42, ...sleb(1), 0x7c);             // cost = n + 1
        emit(0x10, ...uleb(debitIdx));                                       // call debit (stack)
        emit(0x20, ...uleb(tmp0), 0x20, ...uleb(tmp1), 0x20, ...uleb(tmp2)); // restore
        emit(0xfc, ...uleb(sub), ...(sub === 0x0a ? [0x00, 0x00] : [0x00]));
        continue;
      }
      fail('unsupported variable-cost op 0xfc/' + sub + ' (memory.init, data.drop, table.* rejected)');
    }

    // fixed-cost path: debit BEFORE the instruction
    debit(op === 0x10 || op === 0x11 ? 16 : 1);
    emit(op);
    if (NO_IMM.has(op)) {
      if (op === 0x0b && r.i >= r.u8.length) return true;
      continue;
    }
    if (op === 0x02 || op === 0x03 || op === 0x04) {      // block/loop/if: blocktype
      let b = r.byte();
      emit(b);
      if (b === 0x40 || VALTYPES.has(b)) continue;
      if (b === 0x7d || b === 0x7c || b === 0x7b) fail('float/v128 block type');
      const tb = [b]; // s33 type index (signed LEB) — bounds-checked like every index (METER-8)
      while (b & 0x80) { b = r.byte(); emit(b); tb.push(b); }
      let v = 0n, sh = 0n;
      for (const x of tb) { v |= BigInt(x & 0x7f) << sh; sh += 7n; }
      if (tb[tb.length - 1] & 0x40) v -= (1n << sh);
      if (v < 0n || v >= BigInt(bounds.typeCount)) fail('blocktype index out of range — invalid original');
      continue;
    }
    if (op === 0x0c || op === 0x0d) { emit(...readLeb(r)); continue; } // br/br_if: label depth
    if (op >= 0x20 && op <= 0x26) {
      // M-02: local/global/table index references bounded by ORIGINAL ranges — an index that
      // only becomes valid after injection is an invalid original and rejects here (§5.1/§5.6)
      const idxBytes = readLeb(r);
      const idx = decodeUleb(idxBytes);
      if (op <= 0x22 && idx >= bounds.localTotal) fail(`local index ${idx} out of range — invalid original`);
      if ((op === 0x23 || op === 0x24) && idx >= bounds.globalCount) fail(`global index ${idx} out of range — invalid original`);
      if ((op === 0x25 || op === 0x26) && idx >= bounds.tableCount) fail(`table index ${idx} out of range — invalid original`);
      emit(...idxBytes);
      continue;
    }
    if (op === 0x0e) {                                     // br_table
      const head = readLeb(r);
      emit(...head);
      const n = decodeUleb(head);
      for (let k = 0; k < n + 1; k++) emit(...readLeb(r));
      continue;
    }
    if (op === 0x10 || op === 0x11) {                      // call / call_indirect
      const first = readLeb(r);
      if (op === 0x10) {
        if (decodeUleb(first) >= bounds.funcCount) fail(`call to func ${decodeUleb(first)} out of range — invalid original (§5.6: guessed injected indices are invalid at step 1)`);
        emit(...first);
      } else {
        if (decodeUleb(first) >= bounds.typeCount) fail('call_indirect type out of range — invalid original');
        emit(...first);
        const tb = readLeb(r);
        if (decodeUleb(tb) >= bounds.tableCount) fail('call_indirect table out of range — invalid original');
        emit(...tb);
      }
      continue;
    }
    if (op === 0x1c) {
      const head = readLeb(r);
      emit(...head);
      const n = decodeUleb(head);
      for (let k = 0; k < n; k++) { const t = r.byte(); if (!VALTYPES.has(t)) fail('bad select type'); emit(t); }
      continue;
    }
    if (op >= 0x28 && op <= 0x3e) { emit(...readLeb(r), ...readLeb(r)); continue; } // memarg
    if (op === 0x3f) { if (r.byte() !== 0) fail('memory.size reserved != 0'); emit(0x00); continue; }
    if (op === 0x41 || op === 0x42) { emit(...readLeb(r)); continue; }              // i32/i64.const
    fail('unknown opcode 0x' + op.toString(16));
  }
}

function readLeb(r) {
  const b = [];
  for (;;) { const x = r.byte(); b.push(x); if (!(x & 0x80)) return b; }
}
function decodeUleb(bytes) {
  let r = 0, s = 0;
  for (const x of bytes) { r |= (x & 0x7f) << s; s += 7; }
  return r >>> 0;
}

function ensureType(mod, params, results) {
  const idx = mod.types.findIndex((t) => arrEq(t.params, params) && arrEq(t.results, results));
  if (idx >= 0) return idx;
  mod.types.push({ params, results });
  return mod.types.length - 1;
}
function arrEq(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

function buildTypeSection(types) {
  const out = [...uleb(types.length)];
  for (const t of types) out.push(0x60, ...uleb(t.params.length), ...t.params, ...uleb(t.results.length), ...t.results);
  return Uint8Array.from(out);
}
function buildFuncSection(funcTypes) {
  const out = [...uleb(funcTypes.length)];
  for (const t of funcTypes) out.push(...uleb(t));
  return Uint8Array.from(out);
}
function appendGlobal(payload) {
  const r = new Reader(payload);
  const n = r.u32();
  const rest = payload.slice(r.i);
  return Uint8Array.from([...uleb(n + 1), ...rest, I64, 1, 0x42, 0x00, 0x0b]);
}
function appendExports(payload, setIdx, remIdx) {
  const r = new Reader(payload);
  const n = r.u32();
  const rest = payload.slice(r.i);
  const enc = (nm, idx) => [...uleb(nm.length), ...new TextEncoder().encode(nm), 0x00, ...uleb(idx)];
  return Uint8Array.from([...uleb(n + 2), ...rest, ...enc('__mv_fuel_set', setIdx), ...enc('__mv_fuel_remaining', remIdx)]);
}

function debitBody(g) {
  return Uint8Array.from([
    0x00,                               // 0 local groups
    0x23, ...uleb(g), 0x20, 0x00,       // global.get fuel; local.get 0
    0x54,                               // i64.lt_u
    0x04, 0x40, 0x00, 0x0b,             // if: unreachable
    0x23, ...uleb(g), 0x20, 0x00, 0x7d, // fuel -= cost (checked above: no underflow)
    0x24, ...uleb(g),                   // global.set fuel
    0x0b,
  ]);
}
function fuelSetBody(g) {
  return Uint8Array.from([0x00, 0x20, 0x00, 0x24, ...uleb(g), 0x0b]);
}
function fuelRemainingBody(g) {
  return Uint8Array.from([0x00, 0x23, ...uleb(g), 0x0b]);
}
