# Parallel Futures scenario lab

Parallel Futures is a local interactive demonstration of scenario exploration, competing interpretations and bounded decisions. It borrows the scenario-first principle discussed in the [MiroFish review](./WOLF_OPEN_SOURCE_HARDENING_REVIEW_2026-11-15.md), using original code and authored fixtures. It does not install or invoke MiroFish, Zep, a language model or an external feed.

## Try the complete story

Open Parallel Futures in Wolf's center pane. Choose Policy shock, Rate surprise or Market rumor. The initial announcement is insufficient evidence for the fictional contract, so the isolated paper proposal waits.

Change the evidence to Confirmed. A primary confirmation appears in the fictional packet, the interpreter's view changes and the five deterministic demo checks can admit a $25 synthetic proposal. Lower the demo order cap, delay the source or revoke the demo permission to see a refusal. Add copied witnesses: deliveries increase, independent source families do not. Contradicted evidence retains the original claim and appends its correction.

Each control change is a fresh counterfactual replay from $1,000, not a continuous portfolio session. Revocation demonstrates blocking a new action; it does not unwind previously held positions.

The four agent views are authored deterministic roles, not live inference. Their numeric semantic scores are scripted and uncalibrated. The risk steward displays a rule verdict rather than a safety probability. All three curves are hypothetical signal indices starting at 100; none represents price history, event odds or expected returns.

## Inspect actual record integrity

The browser creates a fresh ephemeral ECDSA P-256 key and signs a canonical envelope containing the exact scenario inputs and results. The private key is nonextractable, never exported or persisted. The exported bundle contains the payload, SHA-256 digest, signature, public JWK and an explicit demo issuer label.

The UI independently verifies the created bundle. Change a recorded fact and verify again: the altered copy must fail. Exporting downloads only the synthetic demo packet. Verification proves consistency under the included public key; it does not establish a known author, owner approval, truthful evidence, complete observation, model reasoning or profitable results. An attacker can create a different self-signed bundle. A known independently retained identity/checkpoint would be needed for stronger attribution/history claims.

This demonstration key is separate from Wolf's real owner key, production Nostr identity, signed research history and paper ledger. Demo permission controls never enroll a key, sign an owner grant, arm a strategy, change a real paper balance or send an order. The component receives no Wolf service client or account capability. Its engine performs no network or storage access.

## Implementation and tests

- [Pure engine](../packages/scenario-lab/engine.ts): bounded fixture inputs, source revisions, agent views, branches, five checks and synthetic cash/exposure.
- [Receipt signing and verification](../packages/scenario-lab/receipts.ts): canonical bounded JSON, strict envelope/key validation and actual WebCrypto signatures.
- [Scenario portal](../packages/wolf-ui/ScenarioLab.tsx): responsive center-pane presentation, local controls, async-generation guards and receipt export.
- [Engine tests](../tests/scenario-lab.test.ts): deterministic replay, conservation, cap/freshness boundaries, revocation, evidence states, copied sources and input filtering.
- [Receipt tests](../tests/scenario-receipts.test.ts): independent verification, tampering, key substitution, malformed input, mutation during awaits and size/depth bounds.

The source release hash includes the scenario package. In a hosted app, pass `active` to ignore obsolete signing results when its app surface is hidden. The lab remains available when the separately hosted research engine is unavailable; this does not imply the model service is connected.

## Next integration boundary

The reusable engine/result structure illustrates where permitted source snapshots, bounded model judgments, signed owner grants, actual paper effects and independently retained research could meet. Replacing any fixture with a live capability requires an explicit adapter and prospective validation. Do not promote these fictional scores, curves or confirmations into production research or execution signals. The existing [commons specification](./ROBIN_HOOD_RESEARCH_COMMONS_SPEC.md) describes that larger proposed system.
