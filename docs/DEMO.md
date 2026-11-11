# What a stranger can run

From a checkout, with Node 20+:

```bash
npm install
npm test
npm run paper:demo
```

`npm test` runs the ported wolf pins plus the harness and Phase 1 pins. It does not open a network socket. Live-tape tests inject `fetch`.

`npm run paper:demo` reads public Polymarket prices (Gamma, then the CLOB book) and, when the two agree, writes one local paper fill. It does not submit an order. If the read fails, it stops and does not invent a price. It also prints:

- the mode and the ceilings (PAPER default, loss cap, friction, AUKORA-37 absent, Polymarket spend off)
- the gate decision (`liveOrder` false, no order bytes)
- the paper fill and the ledger audit
- the storyteller refusing a live-claim receipt
- the refusal of a `LIVE_MONEY` request

The JSON it writes is under a temp directory named `aukora-wolf-demo-*`. Nothing in that file is a wallet or an API secret.

Paper desk:

```bash
npm run paper:ui
```

Then open `http://127.0.0.1:4173/`. That page is the paper desk: public Polymarket markets, simulated fills, no wallet. `/about` is the short fence. `/research` stays quiet unless `OPENROUTER_API_KEY` or `GEMINI_API_KEY` is set.

Optional mind driver (backtest replay only; it will not place an order). Without a key it cannot call a model:

```bash
node --experimental-strip-types scripts/wolf-mind-auto.ts
```

## Provenance ceiling

The private pin `796934b6e80799713caf02b190d4cc94de24af6c` was not readable here. Pins are green against the public kernel snapshot named in `packages/engines/NOTICE.md`. See `docs/EXTRACT_PROVENANCE.md`.
