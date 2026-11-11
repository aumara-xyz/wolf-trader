// Strip non-ABI exports (e.g. __data_end, __heap_base) rustc adds to cdylib wasm.
// Builder-only post-processing; the law checker independently verifies the result.
const STRIP = new Set(['__data_end', '__heap_base', '__wasm_call_ctors', '__wasm_apply_data_relocs', '__indirect_function_table']);

export function stripExports(u8) {
  const out = [u8.subarray(0, 8)];
  let i = 8;
  const readU32 = () => {
    let r = 0, s = 0;
    for (;;) {
      const b = u8[i++];
      r |= (b & 0x7f) << s;
      if (!(b & 0x80)) return r >>> 0;
      s += 7;
    }
  };
  const leb = (n) => {
    const b = [];
    do {
      let x = n & 0x7f;
      n >>>= 7;
      if (n) x |= 0x80;
      b.push(x);
    } while (n);
    return b;
  };
  while (i < u8.length) {
    const id = u8[i++];
    const size = readU32();
    let payload = u8.subarray(i, i + size);
    i += size;
    if (id === 7) {
      let j = 0;
      const cnt = (() => { let r = 0, s = 0; for (;;) { const b = payload[j++]; r |= (b & 0x7f) << s; if (!(b & 0x80)) return r >>> 0; s += 7; } })();
      const kept = [];
      for (let k = 0; k < cnt; k++) {
        const start = j;
        let nlen = 0, s = 0;
        for (;;) { const b = payload[j++]; nlen |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; }
        const nm = new TextDecoder().decode(payload.subarray(j, j + nlen));
        j += nlen;
        j++;
        for (;;) { const b = payload[j++]; if (!(b & 0x80)) break; }
        if (!STRIP.has(nm)) kept.push(payload.subarray(start, j));
      }
      const body = [...leb(kept.length)];
      for (const e of kept) body.push(...e);
      payload = Uint8Array.from(body);
    }
    out.push(Uint8Array.from([id, ...leb(payload.length)]), payload);
  }
  const total = out.reduce((a, b) => a + b.length, 0);
  const res = new Uint8Array(total);
  let off = 0;
  for (const part of out) { res.set(part, off); off += part.length; }
  return res;
}
