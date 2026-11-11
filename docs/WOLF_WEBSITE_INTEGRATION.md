# Wolf handoff for the AUKORA website demo

11 November 2026. The standalone implementation is in `wolf-trader`. **Wolf occupies only the existing center pane. Auma's resident conversation stays untouched.** Website integration has not been applied by this build. Preserve the website's current URL, access settings and owner configuration.

## Reuse the app

- [WolfSurface](../packages/wolf-ui/WolfSurface.tsx) is the actual controlled visual surface. It owns no chat, trading transport or ledger.
- [WolfApp](../packages/wolf-ui/WolfApp.tsx) is the single-pane state/controller. Mount it in the existing center app slot. It must not create another shell, split the pane or replace Auma's conversation.
- [The client](../packages/wolf-ui/api.ts) speaks same-origin `/api/wolf/v1`. It accepts an injected fetch transport; WolfApp also accepts an injected client. [Types](../packages/wolf-ui/types.ts) define market/account records, and WolfApp exports its host props and handle.
- [Scoped Wolf styles](../packages/wolf-ui/wolf.css) preserve the website's header/portal dimensions. The required original primitives, icons, palette and license are in [Spatial UI](../packages/spatial-ui/PROVENANCE.md).

Use the host's React instance. The standalone build uses React 19.3.1, matching the reviewed website; X6 integration needs its own host-compatible renderer binding. Importing `apps/desk/main.tsx` creates a root and standalone body styles, so do not use that entry inside the existing website root.

The host owns lane navigation and mobile chat/app switching. Wolf must simply fit the space its center pane receives, preserving drafts, selected market and mobile keyboard reachability. Never include the website preview's isolation shim or status-hiding cleanup in Wolf's service path.

## Connect the website's Auma

Mount WolfApp with a React ref and the host callbacks. Keep the same existing Auma thread:

- `onAskAuma({ message, marketId })` hands a question back to that resident conversation. It never opens or renders a second chat.
- `onContextChange(context)` supplies the selected market/outcome, authoritative demo portfolio and pending-operation state as they change. The host can attach this context to its existing Auma workflow.
- `ref.getContext()` reads a cloned snapshot on demand. The context identifies its money as DEMO.
- `ref.applyResearch(result)` accepts bounded market references/proposal notes, then re-fetches canonical records from Wolf's service before updating portals. Caller-supplied prices, balances, rules and outcome mappings are discarded.
- `ref.openMarket(marketId, assetId?)` fetches and opens the identified market, checking that an optional outcome belongs to it. Opening never places a trade.
- `ref.refresh()` refreshes market/account state.

Pass the selected market ID for a market explanation; guessing the first search result can explain the wrong contract. An opportunity is evidence and relevance, never order authorization. The exported types and [browser-safe host boundary](../packages/wolf-core/host-research.mjs) define the implemented contract.

The service's guided tools already search public markets, explain the selected market's source rules and read actual demo portfolio facts. They remain available to the host; the standalone surface does not render a chat. Optional configured DeepSeek selection is implemented and fixture-tested; no live provider was configured or called during the build. The website's existing plain-text chat does not automatically have market tools. Connect those tools to the resident conversation and route its references into Wolf's handle.

The model receives no `commitDemo` tool. Quotes and simulated fills come from the domain service. Keep research cancellation and stale-reply suppression; do not mutate portals by scraping generated chat HTML. Inject an approved host fetch/client or add narrowly scoped Wolf routes to the website's transport. Do not remove its global preview isolation to make one app work.

## Deploy the service deliberately

The standalone [service](../apps/service/server.mjs) is Node 24 with built-in SQLite. It provides public-data brokerage, research, quote previews, transaction commits, operation recovery, portfolio/activity and reset epochs. Its local session uses a same-origin cookie and capability; it intentionally refuses cross-origin mutations and arbitrary hosts.

**A public website cannot call the owner's localhost.** For a hosted demo, deploy a compatible service/account store, or port its domain contract to the website Worker with appropriate transactional storage. Do not weaken the localhost checks and expose the owner's personal demo database. Give each visitor a separate account/session. One account has one canonical writer; multi-process deployment requires shared operation ownership, not separate in-memory pending registries.

Reuse the pure fixed-point rules in [wolf-core](../packages/wolf-core/pricing.mjs). The ledger relies on atomic account/position/journal updates, expected revisions and idempotency IDs. A browser localStorage balance is not a substitute. Copy the market and research adapters with their tests; preserve the selected dependency licenses.

API routes are under `/api/wolf/v1/`: `session`, `capabilities`, `markets`, `market`, `book`, `portfolio`, `activity`, `research`, `preview`, `commitDemo`, `operation`, `resetDemo`, `events`. Monetary mutations require POST. The installed build identity is available in `/release.json` and capabilities.

## Preserve the demonstrated boundaries

This release supports simulated transactions on verified zero-fee, non-negative-risk binary markets. Fee-bearing or unsupported markets remain browse-only. Settlement is pending until a verified payout adapter is implemented. Research is guided unless a provider/host conversation is configured. No Nostr trading transport, continuous autonomous trading, real wallet or exchange order submission is claimed.

Keep “Demo money” visible, retain source times and reject stale quotes. Buys consume asks; sells consume bids. Missing liquidity cannot be turned into a successful cash-out. Late or lost responses must resolve the existing operation ID; `pending` means wait, not submit a second action.

## Acceptance in the website

Observe the hosted integration at the existing URL: Wolf contained in the center pane, the same ongoing Auma conversation, correct portal geometry, actual public markets, a $25 demo buy, add, partial sale and full cash-out, consistent activity, reload recovery, explicit selected-market research and honest offline/provider errors. Verify visitor isolation and secret handling before sharing it. Record the hosted build identity separately from the standalone app.

The original full specification remains the roadmap; a functioning standalone demo is not proof that these hosted integration steps have been completed.

## Observed standalone delivery

On 11 November 2026, the installed `~/Applications/AUKORA Wolf.app` served build `521f6f7b5bacdffb`. The native window visibly contained one Wolf pane and no conversation column. A $25 simulated buy created 312.5 Yes shares; full cash-out at the public bids returned $21.875, leaving $996.875 with no position. A new demo account restored $1,000, persisted through reload, and reconnected to live market data. The earlier account history was preserved.

Type checking, the production build, 30 native demo tests and the existing 112-test suite passed. These checks cover the standalone implementation; the hosted acceptance steps above remain the website integration task.
