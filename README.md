# Wolf Trader

Wolf Trader 0.2 is a standalone AUKORA trading foundation: public market research, local specialist models, attributed memory, verifiable evidence, and automatic trading with simulated money. Its single center pane uses AUKORA's Spatial portals and header primitives. When embedded, the host's existing Auma conversation stays in place; Wolf adds no second chat or split-pane shell.

The implemented loop is **observe → recall → investigate → record → propose → enforce a standing paper mandate → simulate → evaluate**. Research and model output cannot change the mandate's capital limits. This repository runs independently of the full Genesis/X1/X2/X6 checkout; selected AUKORA source closures, pins and notices are included.

## Run it

Requires Node **24.9+**, npm and an authorized GitHub account for this private repository.

```sh
git clone https://github.com/aumara-xyz/wolf-trader.git
cd wolf-trader
npm ci
npm run wolf:build
npm run wolf:start
```

Open **http://127.0.0.1:4328/**. Public market access, paper accounts, memory/evidence and the quote strategy work without model keys. Missing specialist installations appear as unavailable.

To install the free local specialists, first install `uv`, Bun and Ollama, with Git available. Setup downloads pinned models and dependencies outside the repository; allow several GB of disk space and additional space for Python packages.

```sh
npm run wolf:setup
npm run wolf:setup -- --verify
```

Verification executes actual local models and replay. It uses public Coinbase candles plus an explicitly labeled classification fixture; it does not measure trading skill. Setup never calls the paid Jev API. Run `npm run wolf:setup -- --help` for individual providers and an alternate runtime directory.

For the macOS application, install Apple's command-line developer tools, then:

```sh
npm run wolf:install
open "$HOME/Applications/Wolf Trader.app"
```

Quit an existing Wolf instance before replacing it. The installed application bundles the service and frontend and uses the machine's Node runtime. Account data lives in `~/Library/Application Support/Wolf Trader` on macOS or `~/.local/share/wolf-trader` elsewhere. `WOLF_DATA_DIR`, `WOLF_PORT` and `WOLF_PROVIDER_RUNTIME_DIR` select separate data, service port and model locations. Model weights, private identities, keys and account databases do not belong in Git.

## AUKORA mechanisms in the running pipeline

| Component | Implemented use |
| --- | --- |
| **Kira** | Pinned metered Wasm classifies memory, clamps model/source authority, ranks bounded recall, and checks candidate scope permissions. Corrections supersede earlier notes while retaining their evidence. |
| **Nostr core** | Actual BIP-340 signatures and NIP-01 event verification bind observations, research and paper execution records to a fresh local identity. Individual events can be explicitly imported/exported; external claims remain untrusted. |
| **Aura** | The pinned cell computes the evidence history's RFC6962 Merkle commitment. Signed checkpoints support cold verification and comparison with an independently retained prefix. |
| **X6.1 Cordis** | The actual dependency lifecycle composes market, ledger, memory, provider, research and autonomy services. Unloading a required service pauses autonomous work. |
| **Spatial UI** | Shared portal, typography, palette and header primitives inside one controlled app surface. The host owns Auma and navigation. |

These are invoked implementations, with source manifests and retained licenses in [aukora-vendor](./packages/aukora-vendor/README.md), [runtime-vendor](./packages/runtime-vendor/SOURCE.json) and [spatial-ui](./packages/spatial-ui/PROVENANCE.md). Only the selected Wasm cells have their metered, zero-import execution boundary; the whole Node application is not contained by that boundary.

## Specialist providers

| Provider | Actual role | Availability and limit |
| --- | --- | --- |
| **Laya** | Local structured classification of source evidence against contract rules. | Pinned English checkpoint; classification confidence is not event probability. |
| **Kronos mini** | Local BTC/ETH candle-path forecasts from complete public Coinbase candles. | Underlying-price forecasts; no calibrated conversion to Polymarket odds. |
| **Dexter + Qwen3** | Investigation over the supplied, attributed source records with local model inference. | Pinned Dexter source via Bun and local Ollama model; explicitly selected research, not unrestricted browsing. |
| **Jev** | Hosted structured semantic judgments. | Optional, explicitly selected, paid provider; requires `WOLF_JEV_API_KEY` and `WOLF_ALLOW_PAID_PROVIDERS=1`. |
| **NautilusTrader** | Historical underlying-asset replay with frozen delayed orders and fees. | BTC/ETH replay, separate from Polymarket order-book simulation. |

[Provider pins](./packages/providers/pins.json) and [locked Python dependencies](./workers/requirements.lock) identify the artifacts. Providers receive bounded research inputs, not ledger or order-submission tools.

## Research, tracking and automatic paper trading

Wolf retrieves canonical Polymarket contracts, source rules and executable public books. It tracks Federal Register presidential-document metadata/abstracts and accepts explicit imports of Trump statements or other public observations from original Truth Social, White House, Federal Register and GovInfo URLs. Imported text is labeled user-supplied and not independently fetched. Source revisions remain linked, repeated sources do not become independent confirmations, and topical overlap never establishes an outcome.

An explicitly armed paper mandate sets exact markets, strategy version, expiry, exposure, turnover, order-count, freshness and loss-stop conditions. Eligible actions then run **without approving each trade**. The deterministic governor checks again immediately before the ledger effect. Pause/Stop invalidate queued actions; a restart pauses and reconciles prior operations before explicit rearming. Existing positions remain; a stop threshold cannot guarantee an exit or a maximum loss.

The executable strategies are a quote-momentum baseline and a Kronos directional strategy using an owner-reviewed exact market/outcome/asset/strike/horizon/rule-version mapping. Mapping revocation and stale or changed evidence refuse execution. The event-probability strategy requires a separately approved, calibrated forecast artifact; none is supplied by default. An asset forecast, social statement or classifier score cannot silently become such an artifact. Details: [standing paper mandates](./packages/autonomy/README.md).

Candidate APIs freeze an exact probability-combination version, record dated caller-supplied evaluation cases, compare Brier scores with the market baseline, and gate paper promotion against the expected active version. This provides reproducible evaluation and controlled promotion, not independently verified holdouts, proven returns or the full Scion self-modifying runtime. See [native intelligence](./packages/aukora/README.md).

## Evidence and current boundaries

Export the evidence bundle from Wolf and verify it independently:

```sh
npm run wolf:verify -- evidence.json
```

Optional arguments are an independently known public key and a retained-head JSON file. Signatures prove attribution and byte integrity, not truth or profitability. A bundle's own key alone does not identify a known author; a separate retained checkpoint is needed to detect rollback relative to that checkpoint. Exports may contain private research and account facts. There is **no automatic relay publishing**.

The evidence store currently accepts **4,096 receipts** and a bounded export size. It refuses further records at capacity; unattended operation cannot continue indefinitely, and automatic archive rotation is not implemented. Evidence failure before a paper effect refuses it; failure after an effect pauses without pretending the effect rolled back.

Trading uses simulated funds on supported, verified zero-fee binary markets. Unsupported markets remain browse-only. There are no wallet keys, live-fund submission routes, automatic final settlement, or proven profitable strategies. Replay has explicit liquidity/fee/model assumptions and cannot establish live execution quality. Full X6 host integration, public multi-user hosting and relay distribution remain separate work.

## Develop and integrate

```sh
npm run wolf:check
npm run wolf:test
npm test
npm run wolf:build
```

`wolf:test` covers the foundation and service contracts; `npm test` retains the earlier engine/lab suite. Legacy `paper:*` scripts are separate experiments, not the current application entry point.

Embed [WolfApp](./packages/wolf-ui/WolfApp.tsx) in the host's center slot and connect its callbacks to the resident Auma. The [website integration handoff](./docs/WOLF_WEBSITE_INTEGRATION.md) describes that host boundary. A public site needs its own authenticated, isolated service deployment and cannot use a visitor's localhost as a backend.

Retain third-party notices when sharing or modifying this private repository. Included Spatial/legacy engine closures retain their AGPL notices; the AUKORA intelligence closure, Cordis, model workers and providers retain their respective licenses. Private access does not replace those terms.
