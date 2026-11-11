AUKORA X1 + Wolf — integration review for a standalone trading application

Review date: 2026-10-26. This is an analysis and proposed integration map, not an implementation plan approved for execution and not a change to X1's canonical plan.

Packaging correction, 2026-10-26: the initial review mistook a sparse-checkout omission for absence from Git. Authoritative Git trees confirm that `organism/` and `organism-tools/` are present on the reviewed main commit. The organism tree is identical at the main and candidate pins. The source inventory below is corrected; its documented unwired status remains unchanged.

**Recommendation: build a standalone trading product using selected X1 control, memory and design components, with a dedicated trading engine and replaceable research/model providers.** Preserve an optional X1 host/intelligence adapter. Do not make the trader install the whole coding-agent desktop, and do not make the first paper experiment depend on completing X1's full Wasm rewrite.

**The reviewed source is ahead of the September Wolf architecture in some areas, but source, branch candidates and installed behavior are different things.**

| Reviewed material | Exact identity | Evidence level |
| --- | --- | --- |
| X1 main | `0bde871af2e1595fe905ed8ea56dfaaa961b0777` | Selective source inspection, including canonical plan v1.15, runtime callers, memory, model provenance and packaging declarations |
| X1 integration candidate | `swarm/chain-2026-10-26` at `109e8c9d483634b2b97ad882d5fc64534bad72e7` | Bounded differential source review; not treated as merged, accepted or installed |
| Wolf | `1d4f7b4b1681cd8d151ad8387bacee182a105f21`, plus existing uncommitted handoff and revision-3 plan | Existing paper prototype and proposed replacement; no new trading implementation |
| Genesis / Alpha / Diamond / AUKORA-37 | Earlier historical snapshots (planning note not bundled) | Historical reference findings, not fresh audits of their October heads |

No application was installed, restarted or changed. No tests, market sessions, paid inference or financial transactions were run for this review. Published test counts in X1 documents are the authors' recorded evidence, not new verification here. GitHub main and candidate can advance after these pins.

**What X1 actually adds.**

| X1 capability | What the inspected source contains | Proposed trading use | Important limit |
| --- | --- | --- | --- |
| Owner grants and permits | Session-bound grants, selected effects/paths, expiry, one-use permits, narrower delegated children | Arm a bounded trading mandate once, then authorize qualifying actions automatically | Current vocabulary is development operations, not orders/accounts/instruments/notional exposure |
| Wasm decision cells | Pinned modules, closed interfaces, import restrictions, execution-fuel limits on participating callers | Reproducible policy, sizing checks and bounded feature calculations | Main does not apply one uniform metered path everywhere; fuel is not a latency measurement or a financial limit |
| Rings / contract composition | Combine policy, scope and owner facts before an effect | Combine strategy permission, current risk state and session authority | The current first ring uses an approved effect-class ceiling; it is not a drawdown or market-health system |
| Kira memory | Signed note history, source/trust labels, corrections, quarantine and context/resume integration | Preserve research, forecasts, original theses, corrections and later outcomes across models/sessions | Retrieval is simple term scoring and ranking, not the semantic retrieval promised by the Kira 2 specification |
| Microverse kernel/body reference | Separate kernel/UI cells, Worker hosts, admission, fuel, watchdog/KILL, replay and typed host operations, present on main | A future portable host for small trading cells, with explicit effect boundaries | Both reviewed pins document the spine as not wired into the app; it is not a complete agent engine |
| Spatial design reference | Pinned original tokens, primitives, portals, lanes, screenshots and a Wasm layout controller | Build a new trading interface that retains the required AUKORA visual language | Reference assets are not proof that the active X1 interface already uses this complete shell |
| Laya lane | Pinning, advice/shadow infrastructure and a small WebNN pipeline fixture | Optional local event classification, after a real model runner and financial evaluation exist | Actual checkpoint weights/runtime are external; the full WebNN model/tokenizer path is missing |

Source anchors: [owner and delegation](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/src/aukora-owner.ts), [metered cell caller](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/src/aukora-metered-cell.ts), [contract/rings wiring](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/src/aukora-contract.ts), [Kira store](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/src/kira-store.ts), [candidate organism](https://github.com/aumara-xyz/aukora-x1/blob/109e8c9d483634b2b97ad882d5fc64534bad72e7/dsh-plugin-desktop/organism/README.md), [Spatial reference](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/spatial/README.md), [Laya provenance](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/laya/model/PROVENANCE.md).

**The proposed application has two cooperating loops.** Research runs asynchronously: gather evidence, retrieve relevant history, refresh forecasts, classify incoming events and publish versioned signals with timestamps and expiry. The order loop consumes valid signals and current market/account state, applies deterministic controls, reserves exposure durably, and sends an exact intent to the paper executor or later broker adapter. Slow research and interactive approval dialogs do not sit inside each ordinary in-scope order.

```text
Market data + source documents
             |
             v
Dexter/research ---- Kira cited history ---- Kronos forecast worker
             \             |              /
              versioned, time-bounded signals
                           |
                Jev OR evaluated local Laya
                           |
                    Strategy proposal
                           |
        Trading governor + X1-derived permission checks
                           |
            Durable reservations and order state
                           |
             Paper executor / later broker adapter
                           |
           Fills, costs, results, evidence and evaluation
```

This diagram is a proposal. It does not describe a working integrated app. A simple strategy may not need all the research/model stages; every added stage must earn its cost and delay.

**Each external system has one job.**

| Technology | Recommended role | Integration decision |
| --- | --- | --- |
| Dexter | Financial investigation, tool-driven data gathering and sourced theses | Use a bounded research provider; avoid two competing top-level agent orchestrators |
| Kronos | Quantitative forecasts from candle/volume histories | Separate worker; validate its horizon and market fit, especially before transferring it to binary-event markets |
| Jev | Narrow structured semantic judgments: relevance, contradiction, evidence quality and routing | First classifier candidate if useful; scores/confidence are not automatically win probabilities or sizing inputs |
| Laya | Local alternative or specialized classifier | Optional later; implement a real runner before evaluating the intended classifier |
| Nautilus | Order lifecycle, portfolio/risk infrastructure, historical and real-time simulation | Consider when the chosen venue/adapters fit; a thin venue adapter is a valid smaller first scope |
| Exchange/broker/data APIs | Actual observations and, later, order submission/fill evidence | Venue-specific contracts; no model receives trading credentials |

The primary sources support these roles, not profitability claims: [Dexter](https://github.com/virattt/dexter), [Kronos](https://github.com/shiyu-coder/Kronos), [Jev](https://docs.typesafe.ai/introduction), [Nautilus](https://nautilustrader.io/docs/latest/concepts/architecture/). The target venue remains undecided: Polymarket was the older prototype's choice, not evidence that it suits the friend's strategy.

**The permission model can now start from more concrete X1 machinery.** Its reviewed owner service implements an eight-hour grant and an 800-permit default for development work. Those are not recommended trading settings. A trading profile must explicitly bind account, venue, instruments, strategy/model versions, expiry, allowed actions, quantity/notional, price bounds, exposure and outstanding reservations. Exact order permissions would be issued automatically inside that mandate. Initial arming, expansion, strategy changes and exceptional recovery remain owner decisions.

Keep three independent budgets: (1) compute/time/fuel, (2) model/data spending, and (3) trading capital/exposure. A Wasm fuel cap or an 800-call allowance cannot establish how much money may be lost. Current X1 closes restored grants without a current session binding; an unattended trading restart needs a deliberately designed reconciliation and reauthorization/resumption policy.

**Earlier AUKORA repositories remain sources of mechanisms and evidence.** Alpha and AUKORA-37 contribute exact-operation authorization and interrupted-effect handling; Diamond contributes independent verification patterns; Genesis contributes memory/control lineage and the visual language. Their earlier inspected effects were memory/configuration operations, not trades. X1 overlaps their generic responsibilities, but equivalence has not been demonstrated. Select one financial authority implementation and one order/account state owner; do not put several independent grant systems in series or let competing ledgers disagree about reserved capital. Reuse relevant tests and verifier rules only after mapping their assumptions to the new trading schemas.

**Substantial trading work remains.**

1. A timestamped market-data recorder and explicit stale/missing-data behavior.
2. Durable cash, positions, open orders, reservations and financial arithmetic; current Wolf's browser/localStorage state is not sufficient.
3. Realistic paper fills: bid/ask direction, depth, delay, fees, partial fills and conservative liquidity consumption.
4. Order identifiers, idempotency, uncertain-submission states and reconciliation; software-context restoration is not position recovery.
5. Trading-specific limits, persistent stop behavior and permitted exit/cancellation rules.
6. A precise strategy hypothesis, simple baseline and held-out comparison. Store enough timestamp/provenance information to avoid hindsight leakage and double-counting repeated versions of the same news.
7. The new interface and a clean-machine standalone installer/run path.
8. A trading evidence schema and a separately usable verifier, with broker fill evidence kept distinct from locally signed claims.

The first useful product is an unattended paper session that your friend can install, arm, observe, stop, restart and evaluate. Add research and model layers one at a time against that baseline. X1's future self-change, whole-harness rewrite, Nostr cross-device sync and full Wasm painting are not prerequisites for this first product.

**The source review exposes maturity gaps that affect the choice of starting point.** Main and the candidate must not be mixed casually. Main already contains the Microverse body/kernel and organism tools as reference implementations. The candidate adds shared admission and more metering, identity/Aura evidence integration, plus an `assets/**` packaging declaration that main lacks. Its `src/aukora-organism.ts` mirrors identity/evidence; it does not boot the Microverse host/controller. Neither pin establishes a working full agent loop or complete containment. Grant-history authentication/chaining and some operational budget handling still need hardening before they can be relied on for financial authority. The root plan itself names these unfinished areas. These are defensive design limitations from source inspection, not newly executed security tests.

The Laya WebNN fixture is an eight-input/two-logit matmul, not the 421M-parameter classifier. The real model's approximately 1.6 GiB weights, tokenizer and native runtime are not bundled; its model-card pin is not an installed model. Kira's current memory can improve continuity and attribution, but neither memory storage nor a signed note establishes truth, semantic understanding or predictive skill. The proposed experience/learning loops still need measured promotion criteria.

Relevant primary X1 evidence: [plan and declared hardening targets](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/docs/plan/X1-PLAN.md), [main ledger](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/native/grant-ledger/src/lib.rs), [candidate package declaration](https://github.com/aumara-xyz/aukora-x1/blob/109e8c9d483634b2b97ad882d5fc64534bad72e7/dsh-plugin-desktop/package.json), [candidate body contract](https://github.com/aumara-xyz/aukora-x1/blob/109e8c9d483634b2b97ad882d5fc64534bad72e7/dsh-plugin-desktop/organism/BODY.md), [current recall policy](https://github.com/aumara-xyz/aukora-x1/blob/0bde871af2e1595fe905ed8ea56dfaaa961b0777/dsh-plugin-desktop/native/kira-store-policy/src/lib.rs).

**Standalone distribution and eventual X1 integration are compatible.** The trading application should own its UI, account/order state, strategies and venue adapters, with a fresh identity/data directory. Small shared packages provide selected AUKORA mechanisms. A versioned intelligence interface can connect to X1, and a host-surface adapter can embed the same trading view later. Turning off that optional connector must not corrupt account state, enlarge permissions or silently change a strategy that requires it.

Use X1's pinned Spatial tokens, portals and design references as the visual source. Build new trading screens; do not reuse the rejected Wolf interface. Keep model/strategy code separate from protected limits and credentials. Measure the whole decision-to-execution path: Wasm can make selected computations bounded and portable, but it does not prove a faster market feed or superior fills.

**For the later friend ZIP, distinguish a source kit from a runnable combined product.** Recommended contents:

- The complete current Wolf source, tests, lockfile, notices and handoffs, clearly labelled as the existing prototype.
- This integration review and an implementation-status matrix.
- Selected X1 source modules with their full required dependency closure, source pins, corresponding Wasm artifacts, build scripts and relevant vectors. Keep unmerged candidate material in a separately labelled reference section.
- The pinned Spatial design references needed for the new interface, including their own license/provenance files.
- A manifest of external repos/models, exact selected versions, setup requirements and optional downloads. Include actual upstream source only when needed and with its notices, rather than a misleading collection of empty folders or links presented as integrated code.
- Fresh configuration examples and an explicit list of missing implementation.

Exclude the owner's profiles, Kira notes, keys, grants, mailboxes, tokens, personal histories and trading/account state. Do not copy a legacy `.dsh` home into the trading app. Root MIT is not a license inventory: the pinned Spatial face declares AGPL-3.0-or-later, Laya declares Apache-2.0, and Wolf's extracted engines carry AGPL notices. Preserve each selected component's notices; this review does not relicense anything.

A full X1 checkout brings a large vendored desktop/runtime dependency graph and release commands that refresh external packages. A reproducible friend package needs pinned inputs and a demonstrated asset/dependency closure. The candidate fixes one declared asset omission in source, but no packaged build was tested here. A future ZIP of reference source must not be advertised as a working combined trading app.

**The opportunity is stronger as an engineering product than as a prediction claim.** X1 provides a more concrete path to model-independent memory, bounded autonomous work, reproducible small decisions and inspectable evidence. The durable advantage would come from the quality of that implementation, domain-specific research/strategy knowledge, accumulated evaluated experience and trader usability. No inspected source establishes profitable alpha, global uniqueness, automatic self-improvement or an HFT speed advantage.

Next step after the owner reviews this analysis: agree the friend handoff contents and create the requested source kit. App implementation, X1 changes and live deployment remain separate work.
