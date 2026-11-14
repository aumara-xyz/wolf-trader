# Wolf Trader 0.3 — AUKORA host integration

Current interface guide, updated 14 November 2026. The standalone foundation is in `wolf-trader`. **Wolf occupies only the existing center pane. Auma's resident conversation stays untouched.** A host's deployed frontend and native model-service connection must be verified separately; this checkout does not establish either host's running release. Preserve the website's current URL, access settings and owner configuration.

## Reuse the app

- [WolfSurface](../packages/wolf-ui/WolfSurface.tsx) is the actual controlled visual surface. It owns no chat, trading transport or ledger.
- [WolfApp](../packages/wolf-ui/WolfApp.tsx) is the single-pane state/controller. Mount it in the existing center app slot. It must not create another shell, split the pane or replace Auma's conversation.
- [The client](../packages/wolf-ui/api.ts) speaks same-origin `/api/wolf/v1`. It accepts an injected fetch transport; WolfApp also accepts an injected client. [Types](../packages/wolf-ui/types.ts) define market/account records, and WolfApp exports its host props and handle.
- [Scoped Wolf styles](../packages/wolf-ui/wolf.css) preserve the website's header/portal dimensions. The required original primitives, icons, palette and license are in [Spatial UI](../packages/spatial-ui/PROVENANCE.md).

Use the host's React instance. The standalone build uses React 19.3.1; verify compatibility with the target host. X6 integration needs its own host-compatible renderer binding. Importing `apps/desk/main.tsx` creates a root and standalone body styles, so do not use that entry inside the existing website root.

The host owns lane navigation and mobile chat/app switching. Wolf must simply fit the space its center pane receives, preserving drafts, selected market and mobile keyboard reachability. Never include the website preview's isolation shim or status-hiding cleanup in Wolf's service path.

The header's gold wolf is decorative; it is not a provider/activity indicator. This Week includes a clearly labelled scripted gallery that can render without a model service. Its sample confidence scores/charts have no executable market IDs and must remain separate from real books, ledger data, exports and performance. A disconnected hosted engine must remain explicit, with real research/approval controls disabled rather than silently replaced by samples.

## Connect the website's Auma

Mount WolfApp with a React ref and the host callbacks. Keep the same existing Auma thread:

- `onAskAuma({ message, marketId })` hands a question back to that resident conversation. It never opens or renders a second chat.
- `onContextChange(context)` supplies the selected market/outcome, authoritative demo portfolio and pending-operation state as they change. The host can attach this context to its existing Auma workflow.
- `ref.getContext()` reads a cloned snapshot on demand. The context identifies its money as DEMO.
- `ref.applyResearch(result)` accepts bounded market references/proposal notes, then re-fetches canonical records from Wolf's service before updating portals. Caller-supplied prices, balances, rules and outcome mappings are discarded.
- `ref.openMarket(marketId, assetId?)` fetches and opens the identified market, checking that an optional outcome belongs to it. Opening never places a trade.
- `ref.refresh()` refreshes market/account state.

`WolfApp` accepts an optional `ownerKeyStore` with asynchronous `get()` and `set(pair)` methods. An isolated host can retain only Wolf's nonextractable P-256 key pair through a narrowly scoped adapter without re-enabling global storage or giving research workers a signing capability. Preserve that browser profile. This is a browser key, not WebAuthn, hardware attestation or proof of human presence; there is no automatic recovery path.

Pass the selected market ID for a market explanation; guessing the first search result can explain the wrong contract. An opportunity is evidence and relevance, never order authorization. The exported types and [browser-safe host boundary](../packages/wolf-core/host-research.mjs) define the implemented contract.

The service's guided tools search public markets, explain the selected market's source rules and read actual paper portfolio facts. The foundation additionally runs source tracking, Kira recall, installed Laya/Kronos/Dexter specialists, signed evidence and bounded autonomous paper mandates. Jev is an optional explicitly enabled paid provider. These are server capabilities; the standalone surface does not render a chat. The host's existing conversation does not automatically have market tools. Connect read/research tools to that conversation and route its references into Wolf's handle.

The model receives no `commitDemo`, mandate-arm, forecast-mapping approval or candidate-promotion tool. Quotes and simulated fills come from the domain service. A human arms a bounded standing paper mandate; permitted actions then run without individual trade approval. Keep research cancellation and stale-reply suppression; do not mutate portals by scraping generated chat HTML. Inject an approved host fetch/client or add narrowly scoped Wolf routes to the website's transport. Do not remove its global preview isolation to make one app work.

## Deploy the service deliberately

The standalone [service](../apps/service/server.mjs) requires Node 24.9+ with built-in SQLite and defaults to `http://127.0.0.1:4328/`. It provides public-data brokerage, research, quote previews, transaction commits, operation recovery, portfolio/activity, reset epochs, evidence and autonomy. Its local session uses a same-origin cookie and capability; it intentionally refuses cross-origin mutations and arbitrary hosts.

**A public website cannot call the owner's localhost.** For a hosted demo, deploy a compatible service/account store, or port its domain contract to the website Worker with appropriate transactional storage. Do not weaken the localhost checks and expose the owner's personal demo database. Give each visitor a separate account/session. One account has one canonical writer; multi-process deployment requires shared operation ownership, not separate in-memory pending registries.

Reuse the pure fixed-point rules in [wolf-core](../packages/wolf-core/pricing.mjs). The ledger relies on atomic account/position/journal updates, expected revisions and idempotency IDs. A browser localStorage balance is not a substitute. Copy the market and research adapters with their tests; preserve the selected dependency licenses.

API routes are under `/api/wolf/v1/`. The current service and [client](../packages/wolf-ui/api.ts) are the route contract:

- Core: `session`, `capabilities`, `markets`, `market`, `book`, `portfolio`, `activity`, `research`, `cancelResearch`, `preview`, `commitDemo`, `operation`, `resetDemo`, `events`.
- Research/evidence: `intelligence`, `intelligence/scan`, `intelligence/cancel`, `intelligence/observation`, `intelligence/evidence`, `intelligence/evidence/manifest`, `intelligence/evidence/segments/:index`, `intelligence/verify`, `intelligence/recall`, `intelligence/correct`, `intelligence/nostr/import`, `intelligence/nostr/export`.
- Explicit experiment/approval actions: `intelligence/candidate`, `intelligence/evaluate`, `intelligence/promote`, `intelligence/mapping`, `intelligence/mapping/revoke`, `intelligence/replay`.
- Paper runner: `autonomy`, `autonomy/events`, `autonomy/arm`, `autonomy/pause`, `autonomy/stop`, `autonomy/tick`, `autonomy/evaluate`.
- Weekly books: GET `weekly`, `weekly/books`, `weekly/score`, `weekly/commitment`, `weekly/export`; POST `weekly/run`, `weekly/cancel`, `weekly/score`, `weekly/invalidate`, `weekly/resolve`, `weekly/challenge`.
- Scheduled research: POST `weekly/schedule/prepare`, `weekly/schedule`. A separate signed grant bounds four weekly attempts over 28 days while the service runs; this never enables paid Jev.
- Research policy: GET `weekly/policy`; POST `weekly/policy/propose`, `weekly/policy/evaluate`, `weekly/policy/prepare`, `weekly/policy/promote`. Shadow activation needs an exact signed permission and cannot change financial limits or execute arbitrary code.
- Owner authority: GET `authority`; POST `authority/challenge`, `authority/complete`, `authority/prepare`. The browser signs exact canonical challenge bytes; the server verifies the enrolled key, scope, expiry, use count and revocation state independently.

Mutations require POST and an authenticated local session. The hosted version must authenticate reads as well, enforce per-user ownership, and retain explicit human control of arm/mapping/promotion actions. A host conversation must not inherit the app's mutation capability. The installed build identity is available in `/release.json` and capabilities.

The paper-arm flow prepares an exact request, obtains an owner-signed grant and submits its ID with that unchanged request. Do not pass raw model-generated `authority` fields or reuse a consumed arm grant. The service checks authority again immediately before each effect. Preserve original operation IDs and the one-writer account boundary through hosted retries.

## Preserve the foundation's boundaries

This release supports manual and bounded autonomous simulated transactions on verified zero-fee, non-negative-risk binary markets. Fee-bearing or unsupported markets remain browse-only. Settlement is pending until a verified payout adapter is implemented. There is no real wallet or live exchange order submission. Pause/Stop invalidate queued decisions, preserve existing positions and cannot guarantee liquidation or a maximum loss. Restart pauses the mandate and reconciles prior operations before rearming.

Actual Kira/Nostr/Aura Wasm and X6.1 Cordis source closures are included. Nostr signs and verifies local evidence; explicit event import/export does not publish to relays. Signatures prove attribution and integrity, not source truth. Evidence is stored in linked signed segments (128 receipts by default) without the old 4,096-record operational ceiling. Full exports are bounded at 64 MiB; larger histories use manifest/segment routes and complete archive verification. Retain a known identity and checkpoint independently to detect rollback relative to that checkpoint. Keep keys and research/account databases outside source control and out of public assets.

Federal Register observations and explicitly imported Trump/public statements retain source attribution, revision lineage and uncertainty. Imported text is not independently fetched. Classifier confidence, topic overlap and Kronos asset paths are not event probabilities. A Kronos directional action requires an exact owner-reviewed contract mapping, fresh signed research and the separate paper governor. Candidate evaluation uses supplied dated cases and baseline arithmetic; it does not establish an independently validated trading edge or run the full Scion runtime.

Keep simulated-money status visible (the current API uses `capitalMode: 'DEMO'`), retain source times and reject stale quotes. Buys consume asks; sells consume bids. Missing liquidity cannot be turned into a successful cash-out. Late or lost responses must resolve the existing operation ID; `pending` means wait, not submit a second action. The independent paper governor must remain immediately before ledger mutation, after asynchronous market reads; moving it into a prompt or browser check loses that boundary.

## Acceptance in the website

Observe the hosted integration at the existing URL: Wolf contained in the center pane, the same ongoing Auma conversation, correct portal geometry, actual public markets, a simulated buy/add/partial sale/cash-out, consistent activity, reload recovery, selected-market research, source corrections and honest offline/provider errors. In a disposable paper account, verify a bounded mandate, automatic actions, pause during pending work and restart reconciliation. Verify evidence export/cold verification and visitor isolation before sharing it. Record the hosted build identity separately from the standalone app.

The earlier dated demo specifications are historical context. The [current README](../README.md), implemented service, provider pins and focused tests describe the 0.3 foundation. Standalone functionality is not proof that these hosted integration steps have been completed. A static/cloud frontend release alone does not provision Node 24.9, Python, Bun, model workers or durable isolated storage.

## Standalone installation and delivery checks

The current installer produces `~/Applications/Wolf Trader.app`; its service defaults to port 4328 and stores account data in the platform's Wolf Trader application-data directory. `npm run wolf:setup` installs pinned local providers outside Git. See the README for prerequisites, commands and model limits.

Verify the process actually serving that port and its loaded `/release.json`, then observe the installed app's behavior. A source commit, installation file or prior demo screenshot does not establish the current running release. Run `npm run wolf:check`, `npm run wolf:test`, `npm test` and `npm run wolf:build` for the current source; record live observations separately from those checks.
