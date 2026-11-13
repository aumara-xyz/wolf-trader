# Wolf Trader

Wolf Trader 0.3 is a standalone AUKORA trading foundation: public market research, local specialist models, attributed memory, verifiable evidence, and automatic trading with simulated money. Its single center pane uses AUKORA's Spatial portals and header primitives. When embedded, the host's existing Auma conversation stays in place; Wolf adds no second chat or split-pane shell.

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

Evidence is now stored in linked signed segments, with a default 128 receipts per segment and no 4,096-receipt operational ceiling. Existing histories migrate without rewriting signed events. Full exports are bounded at 64 MB; larger histories use the manifest and bounded segment routes under `intelligence/evidence`. Independently retain a checkpoint to detect rollback relative to what you previously observed. Evidence failure before a paper effect refuses it; failure after an effect pauses without pretending the effect rolled back.

Trading uses simulated funds on supported, verified zero-fee binary markets. Unsupported markets remain browse-only. There are no wallet keys, live-fund submission routes, automatic final settlement, or proven profitable strategies. Replay has explicit liquidity/fee/model assumptions and cannot establish live execution quality. Full X6 host integration, public multi-user hosting and relay distribution remain separate work.


## Weekly research desk

The **This Week** portal freezes a bounded universe, investigates every candidate through the actual specialist pipeline, and asks the pinned local Qwen model for an explicit event forecast with cited evidence, rationale, opposing case and invalidation conditions. Every candidate remains visible as a pick, watchlist item or pass. These are uncalibrated model estimates. Discovery cutoff, later source-information cutoffs and forecast issue times are distinct; resolved or changed contracts cannot be silently researched in hindsight.

**Permissions** enrolls a separate, nonextractable P-256 browser key. The browser signs exact grant terms; the service independently verifies and records that proof under its own Nostr identity. This proves possession of the enrolled browser key, not hardware protection or human presence. It is not a WebAuthn/passkey implementation. Enrollment and permission signing require explicit owner controls; no model worker receives the owner key. Preserve the browser profile: there is no automatic key recovery.

A signed paper mandate can consume a selected completed book through `weekly-hypothesis/v1`. It labels the estimates as experimental and rechecks the current signed signal, exact source rules, executable price, grant expiry/revocation, account revision, exposure and loss controls immediately before the effect. Automatic entries and exits need no per-order click. A stopped/restarted session needs a new signed grant to rearm. The earlier quote and Kronos experiments remain available under advanced controls.

A separate signed research grant can schedule four local weekly runs over 28 days while the service is running. Each attempted book consumes a use; expiry or revocation stops future attempts. Scheduling never enables paid Jev. One-off research can run from the research control without financial authority.

**Track Record** scores all candidate buckets against exact official venue-reported resolution flags, not terminal prices or supplied outcome labels. Unresolved or unsupported results stay pending. Brier scores compare the same resolved subset with the frozen market reference; displayed paper-account changes are explicitly whole-account observations, not falsely attributed alpha. The challenge control runs actual cryptographic tamper checks and six disposable governor scenarios, including a positive fill and refused revoked, altered-source/model, stopped-dependency and broader-mandate cases. Its signing identities and market observations are synthetic; it never changes the owner's portfolio.

The research policy lab freezes declarative filters/weights and evaluates them against independent grader-owned software controls, then requires an exact owner-signed grant for shadow activation. It cannot execute arbitrary code or change the financial governor. Its cases are software-quality fixtures, not confidential financial holdouts or demonstrated market edge. Full Scion code evolution and Capsule portability are not claimed by this release.

The standalone app includes the complete Node/model runtime. A public embedded website requires an independent Node 24 host with durable per-visitor storage and installed Python/Bun/model providers. A Cloudflare frontend deployment alone does not activate these engines; the website must report their actual connection state. Local models, browser keys, identity files, account data and research history remain outside Git.

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
