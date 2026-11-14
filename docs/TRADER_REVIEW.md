# Wolf Trader: a trading-industry review

Wolf is a runnable paper-trading research foundation, not a demonstrated trading edge. Its useful question is: **can a reviewer reconstruct the evidence, forecast, permission and account effect for an autonomous decision, including the decisions that failed or abstained?** Start with one narrow market family and make that answer independently checkable.

## Start without the rest of AUKORA

Follow the [README quickstart](../README.md#run-it). Node 24.9+, npm and Git run the app; public market access and the paper ledger need no model or trading keys. Free local research additionally requires `uv`, Bun, Ollama, Python packages and the pinned model downloads. Setup provisions Python 3.12. macOS arm64 is the observed provider platform; another machine must verify its own environment.

The service defaults to `http://127.0.0.1:4328/`. Check its `/release.json` and provider status rather than assuming the checkout or an old setup receipt identifies the running code. Keep the same browser profile for the owner key. The included source closures remove the need for donor-repository access; their licenses still apply.

The three visible sample scenarios are scripted UI content. Their confidence wheels and charts are neither live research nor price history. They have no executable market identifiers and never enter accounts, grants, evidence exports or scorecards. Run a real book separately.

## Review the complete loop

1. **Inspect a real contract.** Read its exact resolution rule, outcome and source timestamp. Open a supported market, request a quote, then make a small simulated transaction. Follow cash, shares and operation history through a reload. An unsupported or illiquid market should refuse an executable fill.
2. **Run a small real book.** In This Week, select one candidate first. Watch the actual provider status. Read its sources, stated thesis, opposing case, invalidation condition and abstention or probability. Discovery cutoff, source-information cutoff and issue time are separate. A pass or a provider failure is a result to preserve, not hide.
3. **Retain the original commitment.** Export the decision bundle before outcomes and keep a checkpoint outside the writer's machine. Verify the bundle with `npm run wolf:verify -- bundle.json`; supply an independently known public key and retained-head file when available. A valid self-supplied key proves consistency, not a known author. A local timestamp alone cannot prove when an outside observer first saw the book.
4. **Review authority before automation.** Only the owner enrolls the browser key and signs exact limits. In a disposable paper account, arm a small eligible book, inspect automatic actions and then Pause, Stop or revoke. An all-abstention book must remain unarmed. Challenges provide disposable positive and refusal cases without manufacturing eligible predictions in the owner's account.
5. **Return after official resolution.** Track Record keeps unresolved outcomes pending and scores the frozen universe against venue-reported resolution flags. Compare model and market scores on the same comparable cases; include passes and failures. Paper account change is a separate measurement, not evidence that one forecast caused the return.

The browser key is a nonextractable P-256 key, not a passkey or proof of human presence. The Node host remains trusted; only selected Wasm cells have the documented metered, zero-import boundary. Signatures authenticate recorded bytes and attribution, not source truth, model correctness or profit.

## Where the AUKORA contribution matters

| Mechanism | Practical value to test | Implementation |
| --- | --- | --- |
| Kira memory and corrections | Recalled context retains source ancestry; model text cannot promote itself to owner authority. | [Memory/evidence](../packages/aukora/index.mjs) |
| Nostr signatures and Aura commitments | Exported observations, proposals and effects can be checked against a retained signed history; corrections leave the original intact. | [Segmented verification](../packages/aukora/evidence.mjs) |
| Separate owner authority | A research model cannot sign a broader mandate; expiry, revocation, scope and use limits are checked by the service. | [Authority](../packages/authority/index.mjs) |
| Deterministic paper governor | Recheck current authority, signal, source/rule binding, account revision and limits immediately before the ledger effect. | [Autonomy](../packages/autonomy/index.mjs), [ledger](../apps/service/ledger.mjs) |
| Frozen weekly universe | Keep picks, passes and errors, then evaluate them against later official outcomes rather than a curated highlight reel. | [Weekly desk](../packages/weekly/index.mjs), [resolution](../packages/weekly/resolution.mjs) |
| Cordis and Spatial | Service dependency loss can pause automation; the same controlled center-pane app can use a host's resident Auma conversation. | [Composition](../packages/runtime/composition.mjs), [WolfApp](../packages/wolf-ui/WolfApp.tsx) |

Dexter supplies bounded source investigation, Laya structured classification, Kronos underlying-price forecasts and Nautilus underlying-asset replay. The event forecast is a separate uncalibrated local-model opinion. These outputs are different measurements, not interchangeable probabilities. Jev is an optional paid structured-judgment provider; its presence alone establishes neither a latency advantage nor a trading edge.

The combination gives an inspectable control and evaluation substrate. It is not a claim that no other financial system has comparable ideas. Its commercial value depends on reliable operation, useful forecasts and measured execution economics.

## Build next in this order

| Priority | Addition | Evidence that would justify continuing |
| --- | --- | --- |
| 1 | **A prospective event-forecast benchmark for one market family.** Register selection rules and cutoffs, retain all attempts, use enough resolved cases, report calibration and proper scores against the frozen market reference. Separate tuning data from evaluation data. | A reproducible report on previously unseen outcomes, with sample counts, uncertainty and abstention coverage. The existing weekly book is the starting data contract; sample scores and caller-supplied cases are insufficient. |
| 2 | **Venue-faithful execution measurement.** Record time-ordered books and actual observation latency; add fee-bearing contracts, partial fills, cancellations, spread/depth and settlement support deliberately. Replay the exact issued signal at its available time. | Results remain useful under declared costs, latency and unavailable exits. Current momentum replay and BTC/ETH Nautilus replay cannot establish prediction-market live execution quality. |
| 3 | **Independent receipt retention.** Let a reviewer retain a minimal signed commitment before outcomes, with explicit sharing permission and a verification tool that pins the known identity/prefix. Relay transport is one possible delivery mechanism. | A second machine detects changed or missing prior history without receiving private research, account facts or owner keys. Local signatures and timestamps alone are not external witnesses. |
| 4 | **A focused policy-event evidence desk.** Extend primary-source connectors with publication/first-observed times, revisions and exact contract mapping. Retain contradictory evidence and deduplicate common source families. | A reviewer can distinguish an announcement, enacted rule and legally relevant effective date from their source records. Existing Federal Register observations and explicit statement imports are a foundation, not comprehensive live news coverage. |
| 5 | **Operational and portfolio hardening.** Add isolated hosted model workers, durable visitor storage, recovery drills, cross-market concentration analysis and honest latency/resource telemetry. Keep authority outside research workers. | Reproducible clean-machine setup, account isolation, controlled failure/restart behavior and measured end-to-end timing. A frontend deploy or API key is not this infrastructure. |

After those measurements, compare additional models or lower-latency semantic workers against the frozen baseline. Keep full Scion code evolution, broader venue coverage and any live-money adapter as separate reviewed projects. A live adapter would require its own custody, authorization, venue-access and legal analysis; there is no real-order path to turn on in this release.

The best first collaboration is one independently verifiable, prospective paper experiment. Agree the market family, benchmark, costs and stopping criteria before optimizing the bot.
