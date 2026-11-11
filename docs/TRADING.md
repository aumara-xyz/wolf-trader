# Trading fence

This is the fence for aukora-wolf. It is **not** a verbatim copy of `docs/mesh/handoff/TRADING.md` from `aukora-symbiote`. That file was not in the public kernel tree this extract could read. The rules below are the ones the ported engines and this repo's harness actually enforce.

## What may run

| Mode | Money | Network | Orders |
|------|--------|---------|--------|
| `PAPER` (default) | Simulated. Friction on. | None required. | None. |
| `LIVE_TAPE` | Still paper. | Keyless public reads in `wolf-live.js` only. Fail closed. | None. |
| `LIVE_MONEY` | Not available. | — | Refused. AUKORA-37 is not in this repo. |

`POLYMARKET_SHADOW=1` does not create shadow orders and does not turn spend on. The paper desk reads public Gamma prices and the public CLOB book, then settles a local ledger fill. It does not post an order.

## What the code refuses

- Evidence, model speech, and a thesis field `authorizesLiveOrder: true` do not authorize a live order. The gate denies them.
- The mind driver (`scripts/wolf-mind-auto.ts`) has no order path. Session caps for that replay live in `wolf-mind-env.js`. Process kill switch and loss cap live in `packages/harness`.
- The storyteller refuses receipts whose mode label is not paper + backtest. A live-trading claim is not rendered as a story.
- The signal bus refuses receipt fields named like wallet seeds, private keys, or API secrets.
- The paper executor refuses `orderBytes` and `liveOrder`. It does not submit anywhere.
- The lab and the SIM market do not import the live tape and do not call `fetch`.

## Phase 1 paper path

1. Research seat reads a seeded SIM tape and writes a `MacroThesis` (`authorizesLiveOrder: false`, stub confidence 0.55).
2. The file signal bus appends it. Redis is an optional mirror of the same records; files are the source of truth. This demo does not open a Redis server.
3. The gate may answer `PAPER_ALLOW` or `DENY`. Down tapes are observation only (the book never shorts).
4. The paper executor sizes with a Kelly cap, a vol cap, calibration κ, and the process loss cap.
5. κ comes from ECE and Brier. With no outcomes, κ stays 0.25. That is an untrusted prior, not a claim of skill.

## Not investment advice

No buy or sell recommendation. No guaranteed return. A paper fill is a receipted simulation.
