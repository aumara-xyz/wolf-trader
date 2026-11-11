# Wolf port inventory (source: aumara-xyz/aukora-symbiote @ codex/wolf-update-main)

Commit pin requested: `796934b6e80799713caf02b190d4cc94de24af6c`

Extract status: that private pin was not readable here. Files were taken from public `aumara-xyz/aukora-kernel` @ `b441edc4d17de778d30ae955f46408edae39bffe`. Details: `docs/EXTRACT_PROVENANCE.md`.

## Engines / UI (spatial/app/wolf/)

| File | Role |
|------|------|
| `wolf.js` / `wolf.css` | Wolf UI shell |
| `wolf-ledger.js` (+ `.d.ts`) | Paper ledger, friction, audit, receipts |
| `wolf-market.js` (+ `.d.ts`) | Market / regime surface |
| `wolf-lab.js` (+ `.d.ts`) | Paper lab |
| `wolf-live.js` (+ `.d.ts`) | Keyless dual-witness tape (Kraken + Coinbase); only networked module |
| `wolf-mind-env.js` (+ `.d.ts`) | Mind environment / caps |
| `wolf-mind-story.js` (+ `.d.ts`) | Storyteller (refuses dishonest live claims) |
| `wolf-totem.js` | Totem / pack notes UI |

## Scripts

| File | Role |
|------|------|
| `scripts/wolf-mind-auto.ts` | Mind auto runner (JSONL mind-runs) |

## Pins / tests (core/tests/)

- `wolfPaperSim.test.ts`
- `wolfLive.test.ts`
- `wolfMindEnv.test.ts`
- `wolfMindStory.test.ts`
- `wolfDen.test.ts`

## Docs

- `docs/mesh/handoff/TRADING.md` — fence + round history (paper-first, Polymarket deferred)

## Explicit fence (carry forward)

- No wallets, no auto orders, Polymarket deferred until Phase 2+
- Live tape optional, fail-closed, keyless
- Dexter-class research = governed seat, not inside pinned engines
- AUKORA-37 = only LIVE_MONEY rim (separate repo; Wolf calls it, does not reimplement grants)

## Target layout in aukora-wolf

```
packages/engines/   # ledger, mind-env, storyteller, live tape (ported)
packages/harness/   # caps, kill switch, loss ceiling, mode labels
packages/adapters/  # paper executor; later Polymarket CLOB V2 (shadow then live)
apps/paper/        # served paper desk (the old spatial shell is not linked)
docs/               # honesty, TRADING fence, phase notes
tests/              # ported pins + new phase pins
```
