# Wolf Robin Hood research commons specification

**Status: proposed extension, not implemented or activated by this document.**

Prepared 14 November 2026 against Wolf Trader `562c982`. Audience: trading developers evaluating and extending [Wolf Trader](https://github.com/aumara-xyz/wolf-trader). Read the [current reviewer guide](./TRADER_REVIEW.md) and [README](../README.md) first.

Build an event-driven research network in which people and independent bots contribute timely evidence, challenge interpretations, publish prospective forecasts and verify retained decision histories. Each participant runs a separately governed paper portfolio. The public contribution is shared evidence and scrutiny; money, owner keys and execution authority remain individually controlled.

The first release is a **research and autonomous paper-trading experiment**. It contains no real-money execution, shared custody or group order coordination. Its success is a reproducible, independently checkable experiment with measured costs and uncertainty. A profitable screenshot or a fast model demo is insufficient.

## 1. Product proposition

The proposed loop is:

```text
Authorized observations and exact contract rules
                  |
       Capture, deduplicate and retain revisions
                  |
        Signed research contributions
                  |
       Interpretations <--> Critics and verifiers
                  |
     Local, versioned strategy and owner mandate
                  |
    Deterministic final checks against current state
                  |
     Independent paper action or explicit refusal
                  |
    Retained checkpoint and later outcome evaluation
```

The useful question is whether a participant can reconstruct what information was available, which interpretation was made, what authority existed, and what simulated effect followed. Model output and external messages are evidence inputs, never instructions that can grant financial authority.

The Robin Hood ambition is broadly accessible research, open verification tools and an honest record of contributors' performance. Participants can improve a common evidence base without installing the full AUKORA core or sharing their accounts. Better contributors earn attention through measured outcomes and correction behavior, rather than follower counts or claims of secret access.

## 2. Current implementation and proposed additions

| Area | Present in the baseline | Work required for this proposal |
| --- | --- | --- |
| Public source retrieval | Coinbase candles and Federal Register presidential-document catalog metadata/abstracts. | Authorized event-feed adapters, durable cursors, revisions and reliable reconnect behavior. |
| Truth Social | Explicit text imports with original source URLs, content hashes and a label saying the text was user-supplied and not independently fetched. | An authorized automatic acquisition route. No Truth Social watcher, streaming integration or social-event trading trigger is shipped. |
| Specialist models | Local Dexter/Qwen, Laya, Kronos and Nautilus integrations; optional explicitly enabled Jev adapter. | Event-specific questions, task-specific evaluation, abstention thresholds and measured latency. No live Jev performance benchmark is claimed. |
| Weekly research | Frozen candidate books, explicit forecasts/passes, source cutoffs and official-resolution scoring. | An event experiment registry, additional prospective comparisons and a group contribution workflow. |
| Authority | Separate browser-signed permissions, expiry/revocation/use checks and owner-approved paper limits. | An exact new grant resource binding the event strategy and its additional inputs. |
| Execution | Four existing paper strategies, deterministic checks and durable account operations. | A disabled-by-default `event-paper/v1` strategy with a complete supported simulation model. |
| Evidence | Nostr-signed records, causal references, linked signed segments, Aura commitments and independent verification. | A normalized decision receipt, peer transport, disclosure controls and independently retained group checkpoints. |
| Networking | Explicit event import/export. | An optional relay client and research rooms. No automatic relay publication currently exists. |
| Interface | One Spatial center pane with resident host Auma; illustrative sample cards separated from real books. | The event timeline, group research view and new signed-permission controls. |

The running Node host remains trusted. Selected Wasm cells have specific metered boundaries; those boundaries do not contain the whole application. Browser-key possession is not hardware attestation, KYC or proof that a human reviewed each action.

## 3. Source access and the Mastodon connection

Truth Social publishes Mastodon-derived source. Upstream Mastodon documents structured status and notification streams. This suggests a connector investigation; it does not establish that Truth Social enables federation, exposes the same endpoints, allows the intended use, or delivers events with a particular delay. [Truth Social source information](https://help.truthsocial.com/legal/open-source/), [Mastodon streaming](https://docs.joinmastodon.org/methods/streaming/).

Truth Social's published terms restrict automated access, systematic retrieval and certain commercial uses. An automatic connector therefore remains disabled until the operator has an appropriate permission or licensed feed and has reviewed the intended storage, model-processing and redistribution rights. Upstream open-source licensing does not grant access rights to a hosted service. [Truth Social terms](https://help.truthsocial.com/legal/terms-of-service/).

Supported acquisition stages:

1. **Recorded fixture replay:** invented or redistributable examples, conspicuously marked as replay. It can validate behavior, not a real-time advantage.
2. **Explicit imports:** preserve the current user-supplied label. A pasted URL and a signed observer claim do not independently authenticate text.
3. **Authorized automatic feed:** fixed source/account allowlists, documented permitted access, connector version, bounded requests, authentication kept outside model workers, and an operator-controlled enablement.
4. **Additional independent acquisition paths:** separate rights and provenance for each. Measure disagreement and arrival distributions; do not assume that extra identities create independent evidence.

Do not carry forward the earlier proposal's claimed rate limits, open VIP endpoints, CDN delays, instant push access, proxy/burner schemes, anonymity guarantees or guaranteed trading window. They are not verified capabilities. This specification includes no access-control or geographic-restriction bypass.

Each adapter must have a local access record: source identity, allowed accounts/content, endpoint allowlist, credential reference, agreement/reference identifier, reviewed date, retention policy, model-processing permission, redistribution policy and revocation status. The record is an operational control, not a legal certification. Never publish its credentials or confidential agreement text.

## 4. A concrete first use case

Choose one narrow family of policy-event contracts. Freeze exact contracts, outcome identifiers, deadlines, resolution sources and rules before interpreting the event. A headline about a tariff, a formal executive action, its effective date and the final settlement of a contract are different facts.

The first demonstration should deliberately include disagreement:

1. An authorized observation or clearly marked fixture says a tariff **will** be introduced.
2. An analyst interprets that as enactment; a critic identifies future-tense wording and missing primary authority.
3. A contract interpreter shows why an announcement contract and an enactment contract require different evidence.
4. Two independently governed paper accounts apply different previously signed mandates. Each records its own allowed action or refusal. Agreement is not required.
5. A later official document changes the available evidence. The system appends a correction while retaining the original interpretation.
6. A second machine verifies both recorded histories against checkpoints it retained earlier.
7. After authoritative outcomes, the report scores original forecasts and displays passes, failures, corrections and pending cases.

A simultaneous revocation challenge should show that an already prepared proposal cannot fill after its permission is revoked. Use disposable test identities and accounts for that challenge. Do not manufacture an eligible forecast in an owner's actual paper account.

## 5. Components and responsibilities

| Component | Responsibility | Must never receive or control |
| --- | --- | --- |
| Feed adapter | Acquire permitted observations, bound payloads, preserve original bytes and cursors, report gaps. | Owner signing keys, ledger mutation tools, arbitrary model-selected URLs. |
| Event store | Normalize identities, retain revisions, append evidence, deduplicate deliveries. | The power to declare external claims true. |
| Contract registry | Retain canonical venue/version/market/outcome/rule bindings and their expiry. | Silent guesses from similar question titles. |
| Semantic workers | Interpret supplied snapshots and expose task-specific uncertainty. | Account credentials, permission signing, tool access that widens the source set. |
| Critics | Identify contradictions, missing evidence, prompt injection and contract mismatches. | An override of the financial governor. |
| Strategy | Produce a bounded local proposal from approved inputs and a versioned valuation method. | The ability to change the owner's risk limits. |
| Authority and governor | Verify exact authority and current state immediately before an effect. | Reliance on a model's claim that permission exists. |
| Paper ledger | Atomically apply supported simulated effects with revisions and idempotency. | Wallet custody or exchange order submission in this release. |
| Research room | Transport admitted, explicitly shared research contributions and corrections. | Remote orders, common wallets, account state or implicit trading delegation. |
| Evaluator | Score frozen attempts against later authoritative outcomes and execution assumptions. | Rewriting the original prediction or dropping failed attempts. |

Reuse current AUKORA components rather than building a parallel identity, evidence or authority stack. Kira's source ancestry and authority clamping, Nostr signatures, Aura commitments and Cordis lifecycle controls retain their existing meanings.

## 6. System One and the distinction between different scores

Jev answers structured questions about supplied state using typed responses. Its API can return probabilities for defined yes/no questions and distributions for choices. The provider describes uncertainty-aware automation; financial calibration and operational suitability require task-specific measurement. [System One API](https://docs.typesafe.ai/api/system-one), [TypeSafe description](https://typesafe.ai/).

Keep the following fields distinct:

| Quantity | Example meaning | What it does not establish |
| --- | --- | --- |
| Acquisition status | An admitted observer retrieved this payload through a named route. | The source account was uncompromised or its claim true. |
| Semantic probability | The supplied text describes an enacted policy rather than a proposal. | The policy is valid, effective or sufficient for the exact contract. |
| Rule-match assessment | The evidence appears to meet a named clause of the frozen rules. | Authoritative resolution or legal interpretation. |
| Event forecast | Estimated probability of one exact outcome by its deadline. | Positive expected return at the executable price. |
| Expected net value | A versioned valuation using forecast, costs, liquidity and exposure. | Guaranteed return or an available exit. |
| Deterministic gate result | Current proposal passed exact checks under current authority. | A probabilistic statement that the investment is safe. |

There is no universal safety confidence score. A high model probability never expands a grant, bypasses a hard check or substitutes for a calibrated event forecast. Returned values are judgments on defined questions, not certificates.

Proposed worker tasks include action-status classification, quotation/negation detection, whether a required entity/date is present, contradiction detection and identification of missing evidence. Sarcasm, screenshots, translated excerpts, changed accounts and truncated context need explicit unsupported or abstention states.

Each task version freezes its question text, available labels, exact input limits, model version, calibration cohort and threshold policy. Log raw typed values as well as the selected label. Reject malformed values, missing required answers, model-version drift and incomplete input. A timeout or low-confidence result becomes an explicit abstention/failure, with no actionable signal. Do not silently substitute a provider or lower a threshold to maintain activity.

The current Jev adapter validates structure and ranges; it does not implement a universal low-confidence abstention policy. Add and evaluate that policy before connecting Jev to the new event strategy. A direct provider-registry call is not automatically a signed receipt; use the surrounding signed research service.

## 7. Two processing loops and measured latency

**Preparation loop:** discover permitted markets; verify exact rules; maintain reviewed mappings; refresh executable books; investigate source families; establish valuation/calibration artifacts; and obtain an owner mandate. Dexter and deeper local-model investigation belong primarily here.

**Event loop:** accept a permitted observation, deduplicate it, retrieve its existing mappings, perform a bounded semantic assessment if required, build a signed proposal, recheck current market/account/authority state, and apply a supported paper action or record a refusal. Expired signals are discarded. A slow model result must not become actionable merely because it eventually arrived.

Maintain clocks for source-claimed publication time, first byte received locally, normalization, assessment start/end, proposal recorded, gate evaluated, paper commit, checkpoint creation and any relay acknowledgment. Use monotonic clocks for local duration measurements and retain clock-skew uncertainty for cross-machine comparisons. A source timestamp or an observer's clock is not independently witnessed publication time.

Report p50/p95/p99, failures, stale-result rate, queue time and cost for each stage, plus end-to-end totals. Compare a deterministic baseline, local classification and Jev under the same captured events and workloads. Predeclare deadlines for each experiment; there is no hard-coded promised millisecond target in this proposal.

This is event-driven trading research. It is not a demonstrated HFT system. Exchange connectivity can operate at microsecond timescales; a fast hosted-model demo is not an end-to-end execution benchmark. [Nasdaq connectivity](https://www.nasdaq.com/products/north-american-markets/connectivity/co-location).

Keep relay publishing outside the local execution dependency path. A network acknowledgment must not be required for every paper effect. The local intent/evidence write must succeed before an effect; if post-effect evidence or acknowledgment fails, pause and reconcile the operation rather than claim it rolled back.

## 8. Proposed versioned records

These are logical schema requirements, not existing endpoints or copied wire examples. Define bounded JSON schemas and canonical encoding before implementation. Use decimal strings/integer units for financial values; validate timestamps, finite probabilities, enums and maximum sizes.

### Source event v1

Include source identity, canonical source URL, account/subject ID, post/document ID, revision ID, predecessor hash, original-byte digest, normalized-text digest, publication/receipt timestamps, observation route, acquisition/verification status, source family, rights-policy ID, replay flag and parent evidence references.

Preserve original bytes separately where storage is permitted. Keep byte hash and normalized-text hash distinct. Delivery deduplication uses source/account/post/revision identity; edits append a new version and invalidate affected pending proposals. Two routes receiving the same post are two deliveries of one underlying source.

### Semantic assessment v1

Include exact input/source references, contract/rules binding, task/question version, provider/model revision, raw typed answers and distributions, selected labels, abstention and reason, evaluation/calibration reference, source-information cutoff, elapsed/queue times, usage and paid-call authorization reference. State explicitly that the output has no order authority.

### Event proposal v1

Include experiment/strategy version, exact venue protocol/market/outcome/asset identifiers, mapping and rule hashes, source/assessment parents, valuation artifact, observation/book snapshot, proposed side/quantity or spend, expiry, invalidation conditions, expected account revision and immutable proposal digest. Missing valuation means watch/research only.

### Decision receipt v1

Join the proposal digest, exact grant/resource digest, governor version, current account/book revision, evaluated controls and reason codes, allow/refuse status, operation ID, pre-effect intent reference, simulated execution details or refusal, and any reconciliation status. Append a final result linked to the intent; do not rewrite an earlier record after a fill.

Keep the full local receipt separate from a shareable disclosure. Construct the public disclosure from an allowlisted bounded schema that rejects extra and nested unknown fields, rather than redacting a private receipt. Exclude grant IDs, account revisions, portfolio values, exact order intentions and private account-chain roots/identifiers. Use a distinct research-transport identity; linking it to an account identity requires an explicit disclosure choice. The disclosure has a new digest/signature; the original signature does not authenticate edited content.

Distinguish `publicParents`, which a recipient must retrieve and verify for the claimed public chain, from optional `privateCommitments`. Private commitments are absent by default. Any later private-commitment feature needs an explicitly approved, reviewed domain-separated salted commitment scheme; plain hashes of predictable account facts can leak information through guessing and linkage. Accepting an opaque commitment neither requires disclosure of private account history nor claims to verify that unseen history. Mark conclusions needing unavailable evidence as unverified or ineligible under local policy.

### Experiment, outcome and correction records

Experiments freeze selection rules, universe, versions, deadlines, costs, baselines, exclusions, stopping criteria and publication policy before results. Outcomes reference authoritative venue evidence and supported payout semantics. Corrections link the superseded record and explain what changed; original forecasts remain scored under the predeclared method. Never update an old probability in place.

## 9. Contract mappings and financial eligibility

Map to exact opaque venue/version/market/outcome/asset IDs. Retain rules text, hash, resolution source, deadline, event-family concentration grouping and supported fee/settlement model. Reject changed rules or outcome identifiers until the mapping is reviewed again. A keyword match creates a research lead, not an executable mapping.

An enactment strategy needs evidence meeting the contract's enactment definition. A mention strategy may have different source requirements. Neither a social announcement nor a price near one is automatically an official resolution. Polymarket documents source-specific rules and exceptional outcomes, including some non-binary payouts. [Resolution documentation](https://docs.polymarket.com/concepts/resolution).

Every candidate must declare one valuation path:

- **Watch only:** semantic evidence with no justified event valuation. No execution eligibility.
- **Experimental paper hypothesis:** a separately enabled, clearly labelled uncalibrated event forecast, bound to a prospective experiment. Report it separately from approved/calibrated strategies.
- **Evaluated forecast:** an exact event-probability artifact with task-specific evaluation, validity period and preapproved promotion record.

Jev/Laya classification, Kronos asset paths and the number of agreeing peers cannot silently substitute for those paths. Compute any expected advantage against current executable cost under the declared fill model, including applicable fees and uncertainty assumptions. Refuse unsupported markets rather than assume zero fees or full liquidity.

## 10. Owner authority and the paper governor

The proposed `event-paper/v1` strategy is disabled by default. Its owner-signed resource must bind the strategy/policy/model versions, acquisition adapter and permitted subjects, contract mappings, valuation artifacts, experiment, semantic/abstention policy, source/signal expiry rules and financial limits. Where feed/paid-model use needs separate permission, use distinct bounded scopes.

Financial terms include exact markets/outcomes; per-order spend/quantity; total, market and event-family exposure; turnover and order-count caps; entry-price limit; maximum spread/slippage; minimum executable depth; observation freshness; grant expiry; and pause/stopping conditions. Bind the session-loss threshold, starting baseline, valuation method, stale/missing-mark treatment and response policy explicitly. The default response blocks new exposure and pauses; an attempted exit requires its own supported, previously signed policy. Do not describe an unmarked account as having zero loss. Sign thresholds and configuration versions as well as nominal amounts. A model may recommend more conservative treatment or abstain; changing signed policy requires owner approval.

Immediately before the paper effect, independently check:

1. The enrolled owner signature, exact resource binding, expiry, use count and revocation state.
2. Current source/mapping/model/rule revisions, dependency state and absence of invalidation.
3. Signal and market freshness, supported market state, matching asset/outcome, fees and sufficient executable liquidity.
4. Current account epoch/revision, holdings, reserved exposure, other pending operations and all signed caps.
5. Proposal expiry, original operation identity and durable idempotency, including retry/restart reconciliation.

Perform the final authority/ledger check without an asynchronous gap that permits a revoked grant or changed account to slip through. Preserve one-writer durable accounting. Multiple research workers may propose concurrently; they cannot each spend the same remaining budget.

Pause/Stop invalidate pending eligibility. Restart leaves the runner paused and reconciles operations before a fresh signed arm grant. No automatic restart rearming. Loss thresholds are triggers for attempted controls, not guaranteed maximum losses or guaranteed liquidation. Missing liquidity can prevent an exit even in a faithful simulation.

## 11. The group research commons

### Participant roles

| Role | Shared contribution | Local or independently enforced boundary |
| --- | --- | --- |
| Observer | Permitted observation, source link/digest, revision and timing information. | No claim that observation signatures are publisher signatures. |
| Contract interpreter | Exact mapping and the evidence required by a rule clause. | No ability to authorize another participant's strategy or account. |
| Analyst | Prospective forecast, stated rationale, countercase and invalidation. | Model outputs retain their uncertainty and provenance. |
| Critic | Contradictions, missing primary evidence, correlated sources and injection attempts. | Criticism is evidence, not a remote stop/order command. |
| Verifier | Signature/history checks and retained checkpoints; later outcome checks. | A valid chain is not proof of truth or complete capture. |
| Portfolio owner | Optional selective research disclosure and independently governed paper results. | Owner key, account state, mandates and execution stay private by default. |

One process can perform multiple roles, but the interface must disclose shared operator/model lineage rather than count those roles as independent witnesses.

### Research rooms and interoperability

Start with an invitation/admission allowlist and a small room whose participants agree its permitted sources, payload schemas, disclosure policy and benchmark before connecting bots. This is an application protocol over signed transport, not a new pooled investment vehicle.

A room carries observations, interpretations, contradictions, forecasts, corrections, experiment commitments and verification acknowledgments. It has no `BUY`, `SELL`, `COPY_ORDER`, remote grant or wallet-funding message. An outside bot submits a research contribution, not executable code or an order. Receiving applications revalidate the content and evaluate it under their own local policy.

Room administrators may admit/remove message senders or moderate the shared interface. They cannot remotely sign financial permissions, stop another machine's unrelated work, or erase previously distributed evidence. Each owner can revoke local subscriptions and pause local automation.

Bind a versioned local trust/admission policy into the owner's experiment/mandate. Maintain an evidence-dependency index. Under the default signed policy, participant removal or suspected compromise marks affected contributions disputed, invalidates pending proposals that depend on them, and triggers review of existing paper exposure. Read current trust-policy state at the final gate, not only on message arrival. This is enforcement of the owner's previously selected dependency policy; it is not financial authority granted to a room administrator. An administrator can disrupt availability, which must remain visible.

### Nostr transport

Use current NIP-01 event serialization, IDs and signatures, with an explicit Wolf schema namespace, protocol version, causal event references and content digest. [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md).

Before selecting an event kind, review the current NIP registry and relay behavior, pin the chosen convention and document it. Do not invent a supposedly standardized Wolf event kind or use replaceable events as the sole history of forecasts/corrections. The first implementation may retain explicit signed import/export while transport interoperation is tested.

Validate signature, kind/schema allowlist, size/nesting bounds, public causal references, expiry, room membership and replay keys before admission. Validate an opaque private commitment's shape without claiming to have checked its undisclosed contents. Unknown or expired content remains quarantined. Message TTL is a receiver eligibility rule, not a promise that relays delete data. Reject arbitrary fetch URLs embedded in contributions; resolve evidence only through approved adapters.

Use at least two independently administered relays only when transport is enabled and measure their availability. Relay delivery or storage acknowledgment is not source authentication, a universal timestamp, agreement among participants or guaranteed durability. Retain checkpoints outside the history writer. A verifier acknowledgment says what was received and checked, not that the financial claim was endorsed.

Private transport requires a separately reviewed encrypted-message implementation and explicit recipient keys. Public relay messages reveal metadata. Neither encryption nor gift wrapping provides a blanket anonymity/untraceability guarantee. Keep owner permission keys separate from research transport identities.

### Independence, reputation and disagreement

Three keys do not imply three independent witnesses. Track declared operator, acquisition path, source family and model lineage. Syndicated stories and mirrors of the same post remain one source family; repeated model calls are not independent confirmation. Treat declarations as claims. In Stage D, unknown independence contributes no additional witness count; one admitted operator/source family contributes at most one bounded review unit regardless of key count. Unknown or unverified reputation may alter display/review priority only and contributes zero automatic valuation authority. Freeze any later aggregation algorithm and its operator, model and source-family caps in a new experiment version.

Maintain distinct measures for capture reliability, semantic task accuracy/calibration, contract-mapping quality, event forecast score, correction behavior, uptime and reproducibility. Display sample counts, cohort/version, uncertainty and abstention coverage. A useful classifier need not be a good forecaster. A profitable account is not automatically a reliable source.

Precommit the evaluation universe and cutoffs. Retain failed attempts, unresolved cases and abstentions. Do not reward message volume, trading frequency, extreme forecasts or selective publication of winners. Weighting can prioritize review; it cannot override a governor check or authoritative settlement evidence.

New keys start without earned reputation. Reviewed signed key rotation can link an existing record; suspected compromise freezes inherited weighting until reviewed. Maintain local weighting and visible disagreement rather than claiming a global consensus. Network partitions must not cause local permissions to expand.

### Fair publication and contribution incentives

Declare whether each experiment is public or private and its release policy before forecasts. Public streams use the same service release policy for all permitted recipients; network delivery cannot be simultaneous. Do not design an operator-only trading interval before releasing a supposedly public signal. Do not market returns based on followers buying after an operator.

Make that policy inspectable: for the explicitly selected public paper experiment, record a signed release containing the exact disclosure digest, audience policy and release sequence, and atomically enqueue its durable publication outbox entry before the disclosure becomes eligible to drive that experiment. Record dispatch, delivery failures and first independent retention separately. This proves only the recorded dispatch policy, not simultaneous receipt or the absence of an operator's undisclosed external trades. Local execution remains independent of relay acknowledgments; any stronger publication-success condition must be explicit in the signed experiment and accept its availability/latency cost.

Default shared payloads to permitted links, digests, short attributed excerpts, research conclusions and verification artifacts. Exclude credentials, holdings, wallet/account identifiers, exact order plans and confidential feed content. Redistribution rights require their own review. A hash without available underlying evidence has limited independent verification value.

Initial incentives are contributor attribution, reproducible results and recognition for useful corrections. Later bounties can reward verified data quality, test cases and software improvements under declared rules. Token issuance, profit sharing, referral commissions and paid investment-signal rooms are outside the first release and require separate analysis.

No coordinated liquidity sweeps, price-pumping campaigns, wash trading, synchronized order instructions, fabricated consensus, confidential-information sharing or pooled custody. Common research can still produce correlated exposures; show that risk and keep each owner's concentration limits independent.

## 12. Prospective evaluation

Before connecting automatic acquisition or paper execution, register the selected market family, discovery universe, event selection, source and information cutoffs, model/task versions, strategy, cost assumptions, baseline, evaluation period and stopping criteria. Keep tuning and evaluation periods separate. A historical replay must use what was available at each recorded time; later corrected text cannot leak into an earlier decision.

Report four separate result sets:

| Result | Required measurements |
| --- | --- |
| Acquisition | Authorized coverage, gaps, revisions, receipt-time distributions, duplicate rate, clock uncertainty and independent-path agreement. |
| Interpretation | Confusion matrix by task, false-positive/negative rates, calibration by cohort, abstention coverage, adversarial cases and failure rate. |
| Forecasting | Frozen universe, all attempts, resolved/pending/unsupported cases, Brier score and calibration against the same comparable frozen market reference. |
| Paper execution | Fees, spread, depth, delay, rejected/partial fills, turnover, drawdown, account changes and exposure; clearly declared omitted effects. |

Report performance separately by strategy, supported contract family and software version. Retain the relation between publication, first observation, issued signal and attempted fill. A high semantic score does not establish predictive edge; good prediction scores do not establish attainable execution profit.

The current Polymarket paper ledger and its momentum replay support verified zero-fee contracts and have explicit fill/settlement limitations. The separate Nautilus underlying-asset bar replay already accepts configurable fees; it does not reproduce prediction-market books. Reuse each only for supported experiments with its assumptions visible. A venue-faithful prediction-market extension must add fees, partial fills, cancellations, book sequencing, reconnect gaps, market impact assumptions and official settlement before claiming that broader behavior. Do not treat bar replay as historical prediction-market book replay.

Use authoritative supported resolution/payout evidence. Price approaching one, a news headline or a model declaration is insufficient. Keep unsupported/ambiguous resolutions pending rather than manufacturing a score or settlement. Redemptions and paper account settlement are separate ledger work from recognizing an outcome for forecasting evaluation.

## 13. Failure handling and operational controls

| Failure | Required behavior |
| --- | --- |
| Missing source rights or revoked connector permission | Stop automatic acquisition; preserve permitted existing records; no silent alternate scrape. |
| Lost feed cursor, out-of-order revision or gap | Mark the gap, resynchronize through the permitted route, withhold affected signals until continuity requirements pass. |
| Source edited/deleted or primary account authenticity disputed | Append revision/invalidation; refuse affected queued proposals and investigate existing exposure under the signed exit policy. |
| Prompt injection in a post, contribution or webpage | Treat it as untrusted data; no tool/permission/configuration changes; record the detected problem and abstain as required. |
| Model timeout, malformed response, version drift or low-confidence condition | Signed failure/abstention; no actionable signal and no silent provider substitution. |
| Stale mapping/book, changed rules, unsupported fees or inadequate liquidity | Watch/refuse; do not force a fill or imply an available exit. |
| Revoked grant, exhausted cap, concurrent budget consumption or changed account revision | Final check refuses the effect; preserve idempotency and the refusal record. |
| Required service loss or process restart | Pause, reconcile durable operations, require explicit fresh rearming. |
| Evidence store unavailable before effect | Refuse the effect. |
| Receipt or confirmation failure after an effect | Pause and reconcile; preserve the original operation ID; never assume the effect did not happen. |
| Relay compromise, spam, Sybil behavior or censorship | Quarantine/drop messages, cap influence, retain local state; do not widen permissions or treat majority traffic as truth. |
| Research transport key compromised | Revoke local trust in the key, record rotation/review, freeze affected reputation; keep owner grant keys separate. |

Use bounded queues, payloads, model budgets and retry counts. Backpressure should produce visible abstention or paused work rather than unbounded resource use. Store secrets in local configuration/secret storage outside Git and model inputs. Do not log bearer tokens or confidential source credentials.

## 14. Interface within Wolf

Keep Wolf entirely within its existing center pane. Use existing Spatial header, portal primitives, typography, palette and gold wolf mark. Use the host's resident Auma conversation; never introduce another chat or split the app surface.

Add an optional **Events** portal for the timeline and source/contract bindings, a **Commons** portal for admitted research contributions, and extend existing **Permissions** and **Track Record** rather than creating competing control systems. Reuse existing responsive visual components where appropriate.

For an event, show arrival/revision time, original source link and acquisition label; competing interpretations; exact contract/rule binding; model probability meaning; abstention or proposal; local gate reason; and later outcome. Distinguish observed facts, model judgments, signed owner permissions, transport acknowledgments and simulated effects in plain language.

Label probability graphics by their actual task: for example, "probability the supplied statement announces enactment." Do not display a generic safety wheel. Show calibration status, cohort size and freshness adjacent to the score. A refusal can be a successful control outcome and should be easy to inspect.

Auma may explain recorded evidence and propose research. Her prose does not create permissions or commit trades. Opening a contribution or clicking "Discuss with Auma" must not arm a strategy, join a room, enable a feed or approve paid calls.

Retain illustrative cards as separate presentation content. Replays, fixtures, shadow observations and prospective paper results must remain visibly distinguishable. A disconnected host must show its actual unavailable capabilities; a frontend deployment does not provision model workers, durable storage or a relay service.

## 15. Proposed implementation map and API

| Location | Change |
| --- | --- |
| `packages/event-feed/` (new) | Adapter interface, source access records, normalized events, durable cursors and revision/dedup handling. |
| `packages/event-signals/` (new) | Contract mappings, typed assessments, experiment registry, valuation eligibility and proposal/receipt schemas. |
| `packages/research-commons/` (new, optional) | Explicit import/export first; later bounded relay transport, room admission, contribution validation and disclosure. |
| [Existing sources](../packages/intelligence/sources.mjs) and [research service](../packages/intelligence/service.mjs) | Bridge permitted observations into current signed research records and model calls. Preserve user-import labels. |
| [Providers](../packages/providers/index.mjs) and [pins](../packages/providers/pins.json) | Reuse exact providers; add versioned event tasks and measured abstention policy without broadening worker tools. |
| [Authority](../packages/authority/index.mjs) | Add exact event-resource preparation and verification; no peer-granted financial authority. |
| [Strategy](../packages/autonomy/strategy.mjs) and [runner](../packages/autonomy/index.mjs) | Add disabled `event-paper/v1`; retain final governor checks, durable reservations and recovery. |
| [Evidence](../packages/aukora/index.mjs) and [verifier](../packages/aukora/evidence.mjs) | Typed receipt parents, independent commitment retention and sanitized disclosure verification. |
| [Runtime composition](../packages/runtime/composition.mjs) | Compose optional dependencies with pause/stop behavior and actual capability reporting. |
| [Service](../apps/service/server.mjs) and [client](../packages/wolf-ui/api.ts) | Bounded authenticated routes; preserve local-session and hosted per-user isolation. |
| [Wolf UI](../packages/wolf-ui/WolfApp.tsx) | Center-pane portals, timeline, exact permission controls, outcome dashboard and resident-chat callbacks. |

Proposed routes, not currently implemented:

- `POST event-feed/import`, `POST event-feed/replay`, `GET event-feed/status`.
- `POST event-research/run`, `POST event-research/cancel`, `GET event-research/status`.
- `POST event-experiments/prepare`, `POST event-experiments/start`, `GET event-experiments/report`.
- `POST commons/import`, `POST commons/export`, `GET commons/status`; transport connection/publication require a separate explicit local sharing control.

Keep financial arming on the existing prepared-request, owner-signature and verified-grant route. All mutations require the existing authenticated local session or an authenticated isolated hosted account. Enforce ownership on reads as well in hosting. Imported payloads cannot set filesystem paths, executable names, relay destinations or network allowlists.

Public Git may contain the spec, schemas, code, notices and clearly synthetic fixtures. A separate gateway/model service, durable per-user storage and explicit disclosure/authorization are still required for public multi-user operation.

## 16. Delivery stages and acceptance gates

| Stage | Deliverable | Gate before the next stage |
| --- | --- | --- |
| A: Replay and records | Schema validation, explicit imports, immutable observations/revisions, exact mappings, deterministic recorded replay and signed receipts. | A second machine reproduces deterministic rule decisions from retained model outputs, original book/account/time snapshots and pinned policy/runtime versions. Repeat model inference is a separate experiment. Changed bytes and missing history relative to a retained checkpoint are detected. |
| B: Shadow assessments | Versioned Jev/local tasks, bounded paid budgets, measured latency, uncertainty and abstention. No paper effects. | Frozen task evaluation passes predeclared criteria; malformed, late or changed-provider results cannot become signals. |
| C: Independent paper automation | Exact signed event mandate, disabled-by-default strategy, current book checks and durable simulated effects. | Positive disposable control plus refusal tests pass; stop/revoke/restart/concurrency cannot produce unauthorized additional effects. |
| D: Small research room | Explicit contribution exchange, signed corrections, critics and independently retained checkpoints. | Peers cannot submit orders or grant authority; duplicate/Sybil/correlated-source tests do not manufacture independence; disclosure and admission work. |
| E: Prospective experiment | Precommitted universe, declared costs/baselines, full attempt history, calibration and outcome reporting. | Enough resolved comparable cases for the predeclared decision, with uncertainty and failure coverage. Do not invent a universal minimum sample count. |
| F: Wider deployment | Verified source permissions, operational recovery, isolated hosting, reproducible setup, security review and applicable legal review. | Evidence supports the claimed service and market scope. No silent conversion from research software to client-account management. |

Real-money execution is a separate later project. It requires its own authorized venue/account integration, custody/key design, current venue eligibility and data rights, order lifecycle/reconciliation/settlement, operational controls and jurisdiction-specific review. A signed receipt is not a license or legal immunity.

Minimum meaningful acceptance cases:

1. Distinguish announcement, enactment, denial, quotation, sarcasm and insufficient evidence; preserve abstentions.
2. Duplicate delivery cannot create a second action; an edit invalidates a prepared proposal; out-of-order revisions do not restore older eligibility.
3. Changed contract rules, model/task/threshold versions or valuation artifact fail the exact mandate binding.
4. Expiry, revocation during pending work, exhausted caps, stopped dependencies and account revisions refuse effects.
5. Concurrent proposals cannot overspend a shared local cap; repeated operation IDs reconcile to at most one ledger effect.
6. Provider timeout, HTTP failure, schema failure, malformed distributions and a stale result leave signed failure/abstention records and no order eligibility.
7. Peer messages containing instructions, fake grants, arbitrary URLs, executable code or huge nested payloads cannot widen capabilities.
8. Multiple identities copying one underlying source/model do not count as independent confirmations.
9. Public export excludes secrets, holdings, private grants and restricted raw feed text; an edited disclosure verifies only under its new signature.
10. A cold verifier checks original signatures, causal links and retained-prefix consistency; a valid but self-supplied key does not acquire a real-world identity claim.
11. Retrospective replays cannot read later revisions, outcomes or source data; prospective reports retain all registered attempts and version changes.
12. UI actions for viewing/discussion never arm a strategy or enable paid calls, publication or automatic feed access.
13. Loss-threshold equality, crossing, restart baselines and missing/stale valuations follow the exact signed response policy; no mark failure is converted into zero loss or a guaranteed exit.
14. Ten newly admitted keys copying one underlying source do not increase the independent witness count or change actionable valuation; removal/compromise invalidates affected pending proposals under the exact local trust policy.
15. Public disclosures reject extra private fields, use a separate transport identity and verify their public parents without demanding private account history. Public-experiment eligibility requires the recorded release/outbox step, with delivery failures and claim limitations visible.

## 17. Public repository assessment

This design is appropriate to add as a **public proposal**: it describes authorized data acquisition, research interoperability, individually governed paper experiments and verifiable records. Publishing it does not enable any connector, start a research room, authorize paid use or add an execution route.

Before publishing future implementation changes, inspect tracked content and history for credentials, transport/owner identity files, accounts, receipts, confidential agreements, personal research and licensed data. Use synthetic fixtures with no association to an owner's actual account. Preserve the existing component/source notices; public visibility does not replace license terms or grant rights to unrelated AUKORA repositories.

The public scope does not include evasion instructions, claims of anonymity, undisclosed operator-first trading, coordinated orders or promises of safety/profit. Research publication, paid signals, financial advice, client-money operation and market-data redistribution each have their own legal and contractual questions. Keep those service choices explicit rather than treating every use of open code as the same activity.

## 18. Builder handoff

Start with the current source and focused tests. Produce a small architecture/file-change plan, then implement Stage A as an isolated optional module. Preserve existing strategies and UI behavior. Do not access Truth Social automatically, connect public relays, spend provider credits, enroll owner keys, sign permissions or submit financial transactions as part of initial setup.

Deliver a reproducible local replay, a documented schema contract, a positive control and refusal cases, a portable evidence bundle and a second-machine verification procedure. Label fixture, replay, shadow, experimental paper and prospective results accurately. Report actual loaded builds separately from Git revisions.

The first result worth showing a trader is the disagreement demonstration in Section 4: exact source evidence, opposing interpretations, separately enforced permissions, an action/refusal, an append-only correction and an independently checkable later score. That makes the proposed AUKORA contribution concrete while leaving its financial value open to measurement.
