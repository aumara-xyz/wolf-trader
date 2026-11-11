# Wolf Trader

## Native demo

Wolf is a **single center-pane app** using AUKORA's actual Spatial portals and header language, live public Polymarket data, and a durable $1,000 simulated account. The existing Auma chat stays in the host; it opens and updates Wolf through a narrow integration. The standalone preview renders only the Wolf surface. Buy, add, reduce and cash out inside the same portal.

Requires Node **24.9+**. Clone this private repository with an authorized GitHub account:

```sh
git clone https://github.com/aumara-xyz/wolf-trader.git
cd wolf-trader
```

Then install and run:

```sh
npm ci
npm run wolf:build
npm run wolf:start
```

Open `http://127.0.0.1:4318/`. To install the dedicated macOS app:

```sh
npm run wolf:install
open "$HOME/Applications/AUKORA Wolf.app"
```

Quit an existing Wolf instance before reinstalling. The app bundles the built frontend and service; it uses the machine's Node runtime. Its SQLite account lives outside Git in `~/Library/Application Support/AUKORA Wolf`. `WOLF_DATA_DIR` and `WOLF_PORT` select an isolated test instance.

The demo executes only verified zero-fee, supported binary markets. Other markets can be inspected but are browse-only. Automatic final settlement is not implemented. All transactions are simulations; the service has no live order or wallet route.

The service includes guided market-research tools that use actual public records without a model key. The website's resident Auma can use these tools and deliver market references to Wolf; Wolf does not create a separate chat. An optional server-side `WOLF_DEEPSEEK_API_KEY` (or the existing `AUKORA_DEMO_DEEPSEEK_API_KEY` environment variable) enables the service's configured DeepSeek research path. Never put keys in browser code, Git or a shared bundle.

Checks:

```sh
npm run wolf:check
npm run wolf:test
npm test
```

See the [website integration handoff](./docs/WOLF_WEBSITE_INTEGRATION.md) and [full specification](./docs/WOLF_NATIVE_DEMO_SPEC_2026-11-11.md). The copied Spatial component closure retains its own copyright and AGPL notices in `packages/spatial-ui`; the older repository description below does not change those notices.

## Earlier trading lab

The following notes describe the previous lab implementation and its separate `paper:*` scripts. They are not the new native demo's service, UI or live-money capability.

**One line:** An agent can think about markets; it cannot spend until a human-signed aperture says yes to the exact order bytes — and every fill leaves a stranger-verifiable receipt.

## Honesty floor (non-negotiable)

| Mode | Meaning |
|------|---------|
| `PAPER` | Default. Simulated fills, friction on, no wallets, no orders. |
| `LIVE_TAPE` | Optional keyless public market data (dual witness). Still paper money. |
| `LIVE_MONEY` | Requires AUKORA-37 grant path. Exact order bytes on the approval surface. Not implemented until 37 is green. |

- **Not investment advice.** No buy/sell recommendations. No guaranteed returns.
- Evidence / model speech / noul **never** authorizes a live order.
- Mind has **zero** trading logic in drivers — caps live in the harness.
- Kill switch + loss cap are **in process**, not in the prompt.
- Storyteller refuses live-claim receipts unless mode is honest.
- Wallet seeds / API secrets are **never** collected into receipts.

## Status

Phase 0 extract is in, and Phase 1 paper is behind it. Default mode is `PAPER`. `LIVE_MONEY` is refused: AUKORA-37 is not in this repo.

```bash
npm install
npm test
npm run paper:demo
npm run paper:ui
```

`npm run paper:ui` serves the paper desk at `http://127.0.0.1:4173/`. It marks fills off public Polymarket prices. It does not submit orders.

A stranger's reading of the demo is `docs/DEMO.md`. The fence is `docs/TRADING.md`.

The private symbiote pin `796934b` was not readable from this environment. Engines are the public kernel snapshot named in `docs/EXTRACT_PROVENANCE.md`, still under AGPL-3.0-or-later. That is a measured ceiling, not a claim that the private pin was verified.

## Out of scope (day one)

Nautilus full stack, Kronos GPU farm, TensorRT, LLM calls inside the order hot path, LIVE_MONEY without AUKORA-37, faking grants.

## License

Proprietary (private). Do not casually merge AGPL-licensed symbiote wholesale — port engines carefully under an agreed license plan.
