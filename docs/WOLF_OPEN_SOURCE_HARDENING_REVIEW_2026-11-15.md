# Wolf open source hardening review

**Research date: 15 November 2026. Report first; implementation awaits a separate decision.**

Wolf baseline: `1c1da15a226c21d51a08854997efde65958a3f51`. This review indexes **46 candidate repositories**, with additional comparison references. It is a broad, targeted landscape review, not an exhaustive inventory of GitHub. Public repositories, actual license files, current metadata and selected source/test/documentation paths were inspected. Upstream software was not installed or executed, and no model, feed, wallet or trading service was activated.

The [machine-readable inventory](./WOLF_OPEN_SOURCE_INVENTORY_2026-11-15.json) retains exact observed revisions, dates, license references and repository URLs. Observation pins are evidence for this report, not approved dependency versions. Default-branch activity and a release are different; implementation must select and test one coherent release/commit rather than mix their APIs.

License labels describe the inspected files, not a blanket compatibility ruling for the combined product. Distribution/service obligations, third-party components, weights, datasets and external data-processing terms require their own adoption review.

## 1. Recommendation

Harden the existing AUKORA control spine first, then improve the quality and realism of the evidence that flows through it. Keep owner grants, Kira's authority clamping, Nostr/Aura evidence, Cordis lifecycle behavior and the final financial governor. New models and agent frameworks should contribute bounded research, never become a second permission or ledger system.

The most useful initial additions are:

| Priority | Candidate | Concrete gain | First integration scope |
| --- | --- | --- | --- |
| 1 | **fast-check** | Search for permission/accounting failures across generated sequences and controlled asynchronous schedules. | Development tests with disposable accounts and an independent state model. |
| 2 | **Inspect AI plus scikit-learn** | Reproducible research evaluation, task-specific uncertainty measurement and calibration. | Offline adapter around existing Wolf research outputs; no production signing capability. |
| 3 | **Official Polymarket unified TypeScript SDK** | Current protocol/types, data conformance and a bounded streaming integration. | Public-data client behind Wolf's fixed-destination, bounded transport. |
| 4 | **OpenTelemetry plus Toxiproxy** | Measure actual pipeline timing and deliberately exercise network failures. | Redacted service spans and disposable network fault drills. |
| 5 | **OSV-Scanner plus Syft** | Dependency findings and inventory of what the built release actually ships. | Release checks; no automatic dependency fixes. |
| 6 | **Existing NautilusTrader, extended deliberately** | Better execution lifecycle/replay evidence without adding another whole trading engine. | Confirm adapter APIs/release availability, then an offline data/replay proof. |

**MiroFish is a promising later scenario laboratory. It is not the first control-hardening dependency.** Use it to generate difficult hypothetical events, contradictory interpretations and correlated reactions. Its simulations must not become real evidence, a calibrated event probability or trading authority by default.

Effort labels below describe a constrained proof of concept: **low** means a small test/adapter; **medium** means a new boundary, data mapping or evaluation workflow; **high** means substantial runtime, data, security or operational integration. They are not delivery-time estimates.

## 2. What Wolf already has and what remains exposed

The current code includes exact signed paper mandates, final authority/risk rechecks, durable account operations, versioned source observations, specialist providers, frozen weekly books, official-resolution scorecards and independently verifiable signed history. The [reviewer guide](./TRADER_REVIEW.md) and [commons proposal](./ROBIN_HOOD_RESEARCH_COMMONS_SPEC.md) distinguish implemented features from proposed work.

Specific opportunities found by reading the existing source:

- [Replay](../packages/autonomy/replay.mjs) currently supports the quote-momentum baseline with full historical executable depth or abstention. It explicitly omits partial fills, market impact, network-latency replay and final settlement; other strategies require their original timestamped forecast records.
- [Market normalization](../apps/service/markets.mjs) already distinguishes v1 token IDs and v2 position IDs. The gap is broader conformance, streaming/recovery and supported execution economics—not absence of any v2 handling. Fee-bearing and negative-risk markets remain browse-only.
- [Source retrieval](../packages/intelligence/sources.mjs) is deliberately narrow. Truth Social text is explicitly imported, not automatically monitored or independently authenticated.
- [Providers](../packages/providers/index.mjs) validate bounded results. Returned model confidence is not demonstrated task accuracy; Jev has no universal safety score or automatic low-confidence abstention policy in the current adapter.
- [Composition](../packages/runtime/composition.mjs) pauses dependent automation. This does not isolate the entire Node host from a compromised dependency or worker.
- The tracked repository has no GitHub Actions workflow at this baseline. Existing test and source/model pins are useful inputs for a release gate, not a substitute for one.
- A read-only `npm audit --json` returned **zero known npm vulnerabilities** on the research date. This does not cover every Python/model artifact, prove runtime containment or establish that the application has no security defect.

## 3. MiroFish in depth

**Repository:** [666ghj/MiroFish](https://github.com/666ghj/MiroFish). Inspected revision `7657031ac01184afe2cb220f5ee3545573b5e843`; default-branch commit 1 October 2026; repository push 16 October. Root license: **AGPL-3.0**. Nonarchived at inspection.

### What it actually does

MiroFish builds a seed knowledge graph, generates agent profiles, runs OASIS Twitter/Reddit social simulations, retains simulated activities and produces reports by querying the graph and interviewing simulated participants. This can help explore narratives and social dynamics under stated assumptions. The README's broad prediction claims are not evidence that outputs are calibrated probabilities or profitable financial signals. [Project overview](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/README.md).

Its current supported graph route is **Zep Cloud**. Configuration requires credentials and explicitly rejects `ZEP_API_URL`; the graph builder sends document chunks to the graph service. Open source therefore does not mean the present integration is fully local or free of external processing. Model inference also needs an appropriately configured provider. [Configuration](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/app/config.py), [graph builder](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/app/services/graph_builder.py), [dependencies](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/requirements.txt).

The inspected implementation pins Zep/CAMEL/OASIS dependencies, runs simulations in subprocesses and can update its graph from generated activity. A wrapper must retain a clear synthetic namespace. Feeding those generated claims back into Kira as real observations would contaminate source ancestry and create false corroboration.

### Security and operational integration concerns

The simulation runner copies the parent environment into subprocesses; Wolf must instead supply a minimal environment with no owner/account secrets. The Flask setup allows wildcard CORS for API paths. That is a reason to avoid importing or exposing the full upstream web application inside Wolf's trusted service boundary, not a claim that an exploit was demonstrated. [Runner](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/app/services/simulation_runner.py#L531), [API configuration](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/app/__init__.py#L43).

There are real operational tests, including report-tool result sanitization and simulation/Zep lifecycle behavior. No prospective Polymarket calibration or execution-performance evidence was found in the reviewed README and test artifacts. That is a bounded review finding, not a claim about every possible external experiment. [Report agent](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/app/services/report_agent.py), [sanitizer tests](https://github.com/666ghj/MiroFish/blob/7657031ac01184afe2cb220f5ee3545573b5e843/backend/tests/test_report_tool_result_sanitizer.py).

### Recommended Wolf role

Run it only as an optional, isolated, budgeted scenario worker. Input a frozen packet of permitted public/synthetic observations plus exact contract rules. Return scenario assumptions, alternative interpretations, countercases and synthetic event sequences. Keep its UI separate from Wolf's existing center pane, or expose only a narrow result adapter.

A useful test is a tariff rumor followed by a denial and then a narrower official document. Simulated participants can disagree, repeat one source, arrive late and revise their views. Wolf should retain that disagreement, reject manufactured source independence, honor revoked permissions and evaluate the resulting paper decisions. The experiment tests Wolf's behavior under stress; it does not establish that a simulated crowd predicts a real market.

**Decision: high-cost, later experimental lane.** Start with direct OASIS if only synthetic social interactions are needed; choose MiroFish when its graph/report workflow adds measurable value. Review AGPL distribution/service obligations and external data-processing terms for the chosen deployment. A process boundary is not an automatic license exemption.

## 4. Forecasting and research candidates

| Repository | License and inspected state | Contribution and boundary | Decision |
| --- | --- | --- | --- |
| [OASIS](https://github.com/camel-ai/oasis) | Apache-2.0; `fced886`, 9 Nov 2026. | The simulation engine beneath MiroFish. More focused social interaction scenarios, but CAMEL/graph/embedding dependencies and inference still add cost. Generated consensus is synthetic. | Medium/high; optional scenario worker. |
| [BettaFish](https://github.com/666ghj/BettaFish) | GPL-2.0 root; MindSpider subtree MIT; `b67928f`, 1 Oct. | Multi-source investigation, forum critique and reporting patterns. Full crawling/browser/database/LLM stack is much broader than Wolf needs. Source access rights remain separate. | High; study patterns, defer whole-system integration. |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | Apache-2.0; `9fa1196`, 4 Nov. | Structured analyst/debate roles, point-in-time tests, Polymarket vendor and optional Jev social screening. Overlaps Dexter and adds LangGraph/LangChain infrastructure. | Medium; one bounded research challenger, no orders. |
| [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) | Apache-2.0; `63e1884`, 24 Oct. | Numerical audit gates, provenance and valuation-consistency tests. Multiple generations coexist; the PyPI package is the older educational generation, not the newer desktop system. Equity analysis does not supply binary-contract execution semantics. | Medium/high; reuse audit patterns selectively. |
| [Qlib](https://github.com/microsoft/qlib) | MIT; `5435523`, 8 Oct. | Offline experiment/dataset/model comparison infrastructure. Equity calendars/backtests need adaptation. Latest inspected commit constrains config-driven execution; do not accept untrusted executable configs or pickled artifacts. | Medium/high; later if research volume justifies it. |
| [StatsForecast](https://github.com/Nixtla/statsforecast) | Apache-2.0; `652a4e9`, 13 Nov. | Cheap statistical/naive baselines to test whether Kronos improves on simpler completed-candle forecasts. | Low/medium; useful early offline baseline. |
| [Chronos](https://github.com/amazon-science/chronos-forecasting) | Apache-2.0 code and inspected Chronos-2 model card; `1224faf`, 5 Oct. | Optional local quantile/covariate time-series challenger. No required cloud service for local inference; weights/compute still need provisioning. | Medium; after a baseline exposes a real need. |
| [TimesFM](https://github.com/google-research/timesfm) | Apache-2.0 code; `918df02`, 13 Nov. **Latest 3.0 weights have a separate restrictive license.** | Older explicitly pinned weights through 2.5 remain candidates. The latest self-hosted weights cannot be assumed commercially deployable because the repository code is Apache. | Defer 3.0; review an older explicit artifact if justified. |

TradingAgents' [Jev screener](https://github.com/TauricResearch/TradingAgents/blob/9fa1196fffbcfd9de5146d2dd2869df84ab99838/tradingagents/agents/post_screen.py), [Polymarket vendor](https://github.com/TauricResearch/TradingAgents/blob/9fa1196fffbcfd9de5146d2dd2869df84ab99838/tradingagents/dataflows/vendors/polymarket.py) and [point-in-time memory tests](https://github.com/TauricResearch/TradingAgents/blob/9fa1196fffbcfd9de5146d2dd2869df84ab99838/tests/test_memory_pointintime.py) make it a relevant comparison. It is not evidence that adding its debate loop improves Wolf's returns.

FinRobot's [numeric audit tests](https://github.com/AI4Finance-Foundation/FinRobot/blob/63e1884a42ea7b729551a5424b4bd6a65af636e0/finrobot_desktop/tests/artifact/test_numeric_audit_gate.py) are more directly useful for hardening than importing another complete app.

The current [TimesFM 3.0 weight license](https://huggingface.co/google/timesfm-3.0-pytorch/blob/main/LICENSE) specifies non-commercial/non-production use. Check code, weights, datasets and service terms separately. Do not automatically upgrade Wolf to a differently licensed model generation.

## 5. Evaluation and confidence

### ForecastBench and Forecast-Dojo

[ForecastBench](https://github.com/forecastingresearch/forecastbench), MIT, inspected `5ca6c48` from 9 November, provides a prospective forecasting benchmark and public methodology. Its [dataset repository](https://github.com/forecastingresearch/forecastbench-datasets), inspected `34a974d` from 14 November, has **CC-BY-SA-4.0** data terms, distinct from the code. Its full operational stack expects its own cloud/deployment workflow. Adapt export, temporal discipline and scoring interfaces rather than deploy the entire benchmark into the native app. Dataset/upstream content rights remain relevant.

[Forecast-Dojo](https://github.com/Forecast-Dojo/Forecast-Dojo), inspected `877f377` from 26 October, offers repeatable dated-news environments over resolved Polymarket events. Root code is MIT, specified files retain Apache headers and released data has separate stated CC-BY-4.0 terms. Its [environment](https://github.com/Forecast-Dojo/Forecast-Dojo/blob/877f377593978eedec7476c83221fac79c78f8c4/src/environment/env.py) applies retrieval time windows; its [metrics](https://github.com/Forecast-Dojo/Forecast-Dojo/blob/877f377593978eedec7476c83221fac79c78f8c4/src/evaluation/metrics.py) provide useful experiment contracts.

Start with a small adapter and permitted captured data, not its full news corpus/tool infrastructure. Full tool mode has Linux namespace and substantial retrieval/compute requirements. Historical date filters cannot prove that a newer model did not learn the eventual outcome during training. Use a prospective Wolf cohort as decisive evidence. Its summed multiclass Brier metric also differs from Wolf's single-binary-probability scale; define comparable metrics before comparing numbers.

[PolyBench](https://github.com/NostalgiaJohn/PolyBench), `280fbb3` from 10 March, is a research reference only: **no license file was found in its inspected complete tree**. Do not copy it pending permission. The project's contamination-proof label was not verified. Its date-limited news query fetches current article URLs, and its trading engine contains real-order credentials/submission paths. Those are not suitable imports into Wolf's research process.

### Inspect AI and scikit-learn

[Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai), MIT, observed release 0.3.290 on 14 November and HEAD `f68c610`, is the preferred common evaluation harness. A [custom model adapter](https://inspect.aisi.org.uk/extensions-model-api.html) can call Wolf's existing bounded research interface. Preserve original input/book hashes, distinct infrastructure failures, source fidelity, contradictions, malformed values and abstentions. Its [metric implementation and tests](https://github.com/UKGovernmentBEIS/inspect_ai/blob/f68c610e99f04829045ab8ebe75b2b8bd71dc042/tests/scorer/test_metric.py) are inspectable.

Inspect's logs can contain inputs, outputs and raw provider calls. Keep them private/local, filter sensitive logging and configure providers explicitly. An evaluation worker gets no production owner key or arm route. An LLM judge can help grade a task but cannot certify financial correctness. [Logging documentation](https://inspect.aisi.org.uk/eval-logs.html).

[scikit-learn](https://github.com/scikit-learn/scikit-learn), BSD-3-Clause, `ee56c8b` from 13 November, supplies reliability curves, scoring and calibration methods. Fit calibrators on a time-separated labelled set, validate on later untouched events, version by task/model and report coverage. Brier score combines calibration, discrimination and uncertainty; an improved Brier score alone is not proof of better calibration. [Official calibration guidance](https://scikit-learn.org/stable/modules/calibration.html).

[MAPIE](https://github.com/scikit-learn-contrib/MAPIE), BSD-3-Clause, `d5ea5e0` from 10 November, is a later uncertainty-research candidate. Its conformal prediction/risk-control methods require appropriate calibration data and assumptions. New adaptive/exchangeability tooling does not make financial regime change harmless. Do not present marginal coverage results as per-trade safety or guaranteed loss bounds.

**Required distinctions:** semantic classification confidence, event probability, expected net value and deterministic permission checks are separate measurements. Calibrating one does not calibrate the others.

## 6. Execution and portfolio risk

### Official venue SDK first

[Polymarket/ts-sdk](https://github.com/Polymarket/ts-sdk), MIT, inspected `3f0d9b8` from 9 November, contains `@polymarket/client` 0.18.0 with Node 24 support. Its [market actions](https://github.com/Polymarket/ts-sdk/blob/3f0d9b85532d745b513596f4715aa49647acea1d/packages/client/src/actions/markets.ts) and [market WebSocket](https://github.com/Polymarket/ts-sdk/blob/3f0d9b85532d745b513596f4715aa49647acea1d/packages/client/src/websockets/clob/market.ts) are promising current-venue boundaries.

Use the public-data client first; retain Wolf's destination allowlists, body limits, schema validation, overall deadlines and freshness checks. SDK transport controls include experimental interfaces, and a per-attempt header timeout is not a total pagination/body deadline. Its 0.x minor releases can introduce breaking changes; pin an exact reviewed version and lock dependencies. Test the complete operation. Keep wallet/secure-client functions outside model workers. [Current migration guide](https://docs.polymarket.com/migrate/clob-sdk-to-unified-sdk).

The [Python unified SDK](https://github.com/Polymarket/py-sdk), MIT, `0661c24` from 9 November, is an alternative if the venue service moves to Python. Avoid maintaining both without a clear need. The active [TypeScript v2 precursor](https://github.com/Polymarket/clob-client-v2) and [Python v2 precursor](https://github.com/Polymarket/py-clob-client-v2) remain MIT, but current new-work guidance favors unified clients. Original `clob-client` and `py-clob-client` are archived; do not conflate them with active v2 repos.

### Deepen Nautilus rather than add another full engine

[NautilusTrader](https://github.com/nautechsystems/nautilus_trader), LGPL-3.0, inspected develop `1298203` from 14 November, has substantial Polymarket code for [book recovery](https://github.com/nautechsystems/nautilus_trader/blob/12982032fb970cabc085f00169c720792c3edecf/crates/adapters/polymarket/src/book/recovery.rs), [fill tracking](https://github.com/nautechsystems/nautilus_trader/blob/12982032fb970cabc085f00169c720792c3edecf/crates/adapters/polymarket/src/execution/fill_tracker.rs) and [reconciliation](https://github.com/nautechsystems/nautilus_trader/blob/12982032fb970cabc085f00169c720792c3edecf/crates/adapters/polymarket/src/execution/reconciliation.rs).

Wolf already uses Nautilus for underlying-asset bar replay. The [inspected Polymarket guide](https://github.com/nautechsystems/nautilus_trader/blob/12982032fb970cabc085f00169c720792c3edecf/docs/integrations/polymarket.md) discusses Python V2 release-candidate wheels/source builds. The latest observed GitHub release, v1.231.0, matches Wolf's package pin, but that does not prove its stable wheel exposes every feature seen on develop. First verify the installed/public artifact's APIs and protocol support. Some documented areas remain unverified and fee commissions may be estimates rather than venue confirmations.

Medium effort for a bounded offline/data proof; high for a future execution bridge. Reconcile ledger semantics and preserve Wolf's grant/governor. Historical depth/vendor data may have cost and license constraints independent of engine code.

### Execution challenger and risk alternatives

| Repository | License and observed state | Best use and limitation |
| --- | --- | --- |
| [hftbacktest](https://github.com/nkaz001/hftbacktest) | MIT; `5f3ec40`, 23 Dec 2025; nonarchived but quieter. | Medium/high offline queue, latency and partial-fill challenger against recorded intentions/books. Historical replay cannot change the market; taking liquidity can still be modeled optimistically. [Fill assumptions](https://hftbacktest.readthedocs.io/en/latest/order_fill.html). |
| [skfolio](https://github.com/skfolio/skfolio) | BSD-3-Clause; `9ad7b60`, 14 Nov 2026. | Preferred optional offline portfolio/research checker: walk-forward/purged evaluation and risk scenarios. Its [walk-forward implementation](https://github.com/skfolio/skfolio/blob/9ad7b60db3d17065a4305d774df05616c0f0241e/src/skfolio/model_selection/_walk_forward.py) discusses execution-delay leakage. Generic returns do not automatically represent binary payouts. |
| [Riskfolio-Lib](https://github.com/dcajasn/Riskfolio-Lib) | BSD-3-Clause; `344b899`, 4 Nov. | CVaR, drawdown and scenario/risk contribution analysis. Heavy stack; some large/advanced formulations recommend commercial solvers. Optional advisory analysis only. |
| [PyPortfolioOpt](https://github.com/PyPortfolio/PyPortfolioOpt) | MIT; `a6638d2`, 7 July. | A simpler optimizer alternative for shrinkage/HRP prototypes. Still needs appropriate binary-event scenario assumptions. Choose one optimizer, not all three. |
| [CCXT](https://github.com/ccxt/ccxt) | MIT; `3eef3f5`, 13 Nov. | Current source includes Polymarket/prediction-market support. Useful for genuine multi-venue scope later; the official single-venue SDK is a smaller current boundary. Verify fees, protocol and settlement independently. |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | GPL-3.0; `5197bed`, 12 Nov. | Study lookahead/recursive analysis and reproducible experiment workflows. Adding its full crypto-bot runtime duplicates account/control concepts. |
| [Hummingbot](https://github.com/hummingbot/hummingbot) | Apache-2.0; `9af100d`, default commit 22 Sept, pushed 13 Nov. | Study executor lifecycle/market making. No Polymarket path was found in inspected main. Full runtime and Gateway add operational overlap. |
| [ABIDES JPM public](https://github.com/jpmorganchase/abides-jpmc-public) | Actual LICENSE files BSD-3-Clause; archived 2 June 2025; `f9cbe51` from Dec 2023. | Academic interacting-market-agent reference, not a new maintained production dependency. Synthetic market agents do not establish real impact. |
| [vectorbt](https://github.com/polakowo/vectorbt) | Inspected `9ac1b69`, 11 Nov; **Apache-2.0 with Commons Clause**. | Exclude from an uncomplicated commercial-OSS shortlist pending license review. The [actual license](https://github.com/polakowo/vectorbt/blob/9ac1b697166b00911def494cf95937274218aa54/LICENSE.md) restricts selling software-derived products/services, including relevant hosting/support. |

Start portfolio hardening with exact event-family exposure and mutually exclusive payout scenarios. An optimizer's recommended allocation cannot increase owner caps or solve uncalibrated forecast inputs.

## 7. Control testing, security and operations

### fast-check

[fast-check](https://github.com/dubzzz/fast-check), MIT, observed release v4.10.2 from 19 September and HEAD `449ba8b`, is the strongest direct fit for Wolf's Node state machine. Generate sequences involving enroll/grant/revoke/arm/quote/Stop/restart/retry, compare against a small independent financial model and retain the seed/path plus minimized counterexample.

Its [model runner](https://github.com/dubzzz/fast-check/blob/449ba8b39a3a1a7a68417d07f68264c8f347992e/packages/fast-check/src/check/model/ModelRunner.ts) and [scheduler tests](https://github.com/dubzzz/fast-check/blob/449ba8b39a3a1a7a68417d07f68264c8f347992e/packages/fast-check/test/AsyncScheduler.spec.ts) support this approach. The scheduler only controls promise boundaries the test exposes; it does not automatically control arbitrary network events. Medium effort; no external service needed.

Acceptance should include at-most-once effects after a lost response/retry, no use of consumed arm grants, no new effect after Stop/revocation, account conservation, no overspending across concurrent proposals and explicit reconciliation when a receipt fails after an effect. Do not duplicate production arithmetic as the test oracle.

### OpenTelemetry and Toxiproxy

[OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js), Apache-2.0, observed v3.1.1 from 9 November and HEAD `5a78e6a`, supports Node 24; browser instrumentation remains experimental. Start with manual spans around fetch, queue, provider, governor, commit, cancellation and reconciliation. Use an in-memory/local exporter before any hosted backend. [Exporter source](https://github.com/open-telemetry/opentelemetry-js/blob/5a78e6aef1fcbbe8306d982c0b3f0f1ea57eb032/packages/sdk-trace/src/export/InMemorySpanExporter.ts).

Allowlist attributes, including on exception events. Exclude prompts, source bodies, cookies, capability tokens, keys and account identities. Link opaque local receipt IDs only where disclosure is appropriate. Traces are operational measurements, not signed truth records. [Sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/).

[Toxiproxy](https://github.com/Shopify/toxiproxy), MIT, observed v2.13.0 from 14 October, supplies controlled latency, resets, drops and bandwidth faults against disposable endpoints. Low/medium effort. Keep its control API local and outside production configuration. It does not simulate database corruption or process crashes; those need separate recovery drills.

### Alternative evaluation and monitoring tools

| Candidate | License / observed release | Fit and material condition |
| --- | --- | --- |
| [Hypothesis](https://github.com/HypothesisWorks/hypothesis) | MPL-2.0 except noted third-party code; 6.170.15, 6 Nov. | Python stateful/input tests if worker-specific invariants need them. Keep Node accounting in fast-check. Local example databases retain generated inputs. |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | MIT source; 0.125.1, 25 Oct. | Node-native evaluation alternative to Inspect. Many financial/indirect-injection plugins require hosted inference; disable flags are not an egress firewall. Standard self-host UI is experimental with no built-in auth/scaling. [Data handling](https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/), [self-hosting](https://www.promptfoo.dev/docs/usage/self-hosting/). |
| [garak](https://github.com/NVIDIA/garak) | Apache-2.0 core, separate dataset/model terms; 0.17.1, 16 Oct. | Selected adversarial probes against a disposable research target. Reports retain prompts/outputs; defaults may run a large suite. Useful periodic testing, not proof of containment. |
| [Giskard v3](https://github.com/Giskard-AI/giskard-oss) | Apache-2.0; component release `giskard-agents/v1.0.6`, 25 Oct. | Alternative multi-turn/evaluation harness, Python 3.12+. v2 is no longer actively maintained. Configure local providers explicitly and set analytics opt-out before import. |
| [Langfuse](https://github.com/langfuse/langfuse) | MIT core, separately licensed EE directory families; 4.80.0, 13 Nov. | A later rich operations UI. Postgres/ClickHouse/Redis/blob infrastructure is substantial. OSS telemetry can be disabled; self-hosted EE license telemetry cannot be disabled. [License](https://github.com/langfuse/langfuse/blob/main/LICENSE), [telemetry](https://langfuse.com/self-hosting/security/telemetry). |
| [Litestream](https://github.com/benbjohnson/litestream) | Apache-2.0; 0.5.18, 3 Nov. | Conditional SQLite replication after whole-app restore design. Several Wolf databases plus identity/browser keys need a consistent recovery policy; independent per-DB replication is insufficient. Current 0.5.x does **not** support age client-side encryption. [Encryption warning](https://litestream.io/reference/config/#encryption). |
| [OSV-Scanner](https://github.com/google/osv-scanner) | Apache-2.0; 2.7.1, 9 Nov. | Low-effort dependency/release checks. Use exact v2 flags; full offline mode differs from offline-vulnerability-only mode. Do not automatically run fixes. [Offline behavior](https://google.github.io/osv-scanner/usage/offline-mode/). |
| [Syft](https://github.com/anchore/syft) | Apache-2.0 code; logo has separate CC-BY terms; 1.57.1, 9 Nov. | Low-effort SBOM of recognized packages in the actual release directory. Supplement it with explicit hashes/manifests for custom Wasm, model and native artifacts. An inventory is not a vulnerability or model-integrity proof. |

Do not deploy Inspect, Promptfoo and Giskard simultaneously as mandatory infrastructure. Pick one main evaluation harness and import useful test cases deliberately. Keep financial boundary tests deterministic even when adversarial research uses models.

Comparison references outside the 46-entry inventory: [Phoenix's current server license](https://github.com/Arize-ai/phoenix/blob/main/LICENSE) is ELv2 with hosted-service restrictions; do not call the full current server unrestricted OSS. [OPA](https://github.com/open-policy-agent/opa) and [Cedar](https://github.com/cedar-policy/cedar) have Apache-2.0 licenses but overlap current authorization; a stateless policy answer does not replace signed-grant possession, durable use consumption or a synchronous financial gate. [OpenSSF Scorecard](https://github.com/ossf/scorecard) is useful Apache-2.0 hygiene feedback, but an aggregate repository score cannot establish financial safety.

## 8. Evidence transport, source quality and isolation

| Candidate | License and inspected revision | Specific use and boundary |
| --- | --- | --- |
| [nostr-tools](https://github.com/nbd-wtf/nostr-tools) | **Unlicense**, `dbbe3da`, 7 Nov; inspected package 2.26.0. | Optional JS relay transport and protocol interoperation. Retain the existing signed evidence verifier, admitted schemas, replay protection and distinct research/owner keys. Transport events cannot grant trading authority. A signed peer claim is not source truth or proof of distinct people. |
| [OpenTimestamps client](https://github.com/opentimestamps/opentimestamps-client) | LGPL-3.0-or-later; `f3a9e92`, 27 Oct; [Python library](https://github.com/opentimestamps/python-opentimestamps) `8c3dc6f`, same date/license family. | Optional independent, asynchronous witness for an explicitly shared batch commitment. Blockchain proof establishes existence before an attestation point, not the exact arrival time or factual truth. Standard client verification expects Bitcoin Core; network calendar availability and confirmation delay matter. Never put it in the trading hot path or publish private account-chain roots automatically. [How it works](https://opentimestamps.org/). |
| [gVisor](https://github.com/google/gvisor) | Apache-2.0; `90159c1`, 15 Nov. | Stronger Linux hosted-worker isolation for untrusted research/tool execution. It is not a native macOS drop-in. Restrict mounts, credentials, egress and resources; test model/accelerator compatibility. A sandbox does not replace the owner governor or make an allowed destination trustworthy. [Platform limits](https://gvisor.dev/docs/user_guide/faq/). |
| [Trafilatura](https://github.com/adbar/trafilatura) | Apache-2.0; `8f054a1`, 13 Nov. | Optional extraction of already authorized captured HTML into text/metadata. Use extraction functions behind fixed-source fetchers, preserving raw hashes and dates. Do not let model-selected URLs turn its crawler into an arbitrary fetch/SSRF path. Extraction does not grant data-access or redistribution rights. |

Independent timestamping is particularly relevant to the commons proposal: a writer's own signed timestamp cannot prove when a second party first possessed a forecast. Start with retained checkpoints on a second machine; add an external witness only if its privacy, availability and verification tradeoffs are justified.

## 9. Integration architecture

```text
Existing AUKORA authority, memory, evidence and ledger
                    |
       Validated public-data and source adapters
                    |
     Bounded local/optional research contributions
                    |
     Frozen experiments and independent evaluation
                    |
      Current deterministic financial governor
                    |
          Supported paper ledger effects

Parallel development/operations lanes:
  fast-check / fault drills     -> minimized failures and recovery evidence
  Inspect / scoring            -> labelled, prospective evaluation records
  MiroFish / OASIS              -> synthetic scenarios only
  OTel                        -> redacted measured timings
  OSV / Syft                  -> release findings and component inventory
  Nostr / optional witness     -> explicitly disclosed independent retention
```

No simulator, critic, optimizer, telemetry product or external evaluation agent receives an owner signing key, financial mutation capability or authority to change limits. Every new component must have a bounded input/output contract, version/identity, timeout/resource budget, data disclosure policy and explicit unavailable state. Preserve the one-pane UI and resident Auma; avoid importing another project's shell.

## 10. Proposed hardening passes

### Pass A: Falsify control failures

Add a small independent financial state model and fast-check command/scheduler tests. Use replayable seeds and disposable accounts. Add Toxiproxy drills for slow/lost source/quote/provider responses; separately test restart and post-effect receipt failure. Start release inventory/scanning with reviewed Syft/OSV versions. Preserve actual failure artifacts with no owner secrets.

**Acceptance:** duplicate retries cannot duplicate effects; revoked/expired/consumed permissions fail; concurrent proposals cannot overspend caps; missing marks never become zero loss; stop/restart remains paused and reconciled; dependency changes cannot silently broaden permissions.

### Pass B: Measure research and uncertainty

Build one Inspect adapter and a labelled source/contract reference set. Use scikit-learn metrics/calibration on time-separated tasks, with prospective Wolf events decisive. Adopt useful ForecastBench/Forecast-Dojo record/scoring conventions; keep all failures, passes and pending outcomes. Add StatsForecast as the cheap same-window underlying baseline before another large model.

**Acceptance:** task probabilities have defined meaning and calibration status; reference labels are independently reviewed; historical model-knowledge leakage is disclosed; metric scales match; no self-graded safety certificate; prospective scoring includes the full declared universe.

### Pass C: Make execution measurements believable

Compare the official SDK public-data output with current validated adapters. Record exact protocol/rules, time-ordered books/trades, gaps, fees and observation timestamps for one contract family. Probe the public Nautilus artifact/API before adopting its wider adapter. Compare current paper simulation with a venue-aware offline path and optionally hftbacktest using the same frozen intentions.

**Acceptance:** delays, liquidity limits, fees, partial/unfilled intentions, cancellation and reconnect behavior remain visible. Do not infer profit from midpoint fills or bar replay. Unsupported settlement stays pending. Real-money execution remains a separate project.

### Pass D: Add scenario stress and shared verification

Choose direct OASIS or isolated MiroFish, not both by default. Feed it only permitted/synthetic packets, bound cost/egress, and keep generated claims in a synthetic namespace. Generate coordinated misinformation, source edits, delayed observations, correlated agents and conflicting interpretations. Let a second machine retain and verify disclosed commitments.

**Acceptance:** synthetic repetition cannot become independent evidence; a room event cannot authorize an order; compromised/removed contributors invalidate affected pending proposals under the signed local policy; privacy projections expose no private grants/accounts; measured scenario value justifies the additional runtime.

### Pass E: Operational deployment

Only after the prior proofs, select hosted Linux isolation, whole-app backups/restore and a richer operations interface if needed. Keep the actual installed and hosted builds observable. A source pin, container startup, passing unit tests or frontend deployment alone is not a running, validated financial service.

## 11. The decision worth making next

Approve a **small hardening pass with fast-check, fault/recovery drills, redacted measurements and an offline evaluation adapter**. Select explicit package versions and success criteria before adding runtime dependencies. Evaluate SDK/Nautilus scope separately from any wallet/live-order project.

Then run one prospective policy-event experiment in which every forecast and pass is retained before outcomes. Use MiroFish/OASIS to try to break interpretation and controls in a separate synthetic lane. The claim to demonstrate is that Wolf remains bounded and inspectable while useful research quality and execution measurements improve.

This review found valuable projects, but adding all of them would duplicate frameworks, widen dependency/credential exposure and make failure diagnosis harder. The next implementation should add the smallest set that closes a measured gap and preserves AUKORA's existing ownership and evidence boundaries.
