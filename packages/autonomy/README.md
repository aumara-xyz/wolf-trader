# Standing paper mandates

`createAutonomyService` turns an explicitly armed paper mandate into repeated proposals and simulated account actions. It is an actual scheduled service, not a model prompt. It uses the canonical Wolf ledger and public market adapter. It holds no wallet, exchange signing key or live submission path.

One arm defines exact market IDs, a versioned strategy, per-order/market/event/account exposure limits, turnover and order budgets, session loss threshold, expiry, quote freshness and spread/entry-price limits. Valid actions then execute without a separate approval. Pause and Stop invalidate queued actions, including an intent whose final market-data request is still in flight. They retain existing positions; a loss threshold cannot guarantee a maximum loss or an executable exit.

The service persists mandates, observations, intent reservations, decisions and evaluation reports in `wolf-autonomy.sqlite` inside the application's private data directory. Its money remains in the separate canonical Wolf ledger. A lost result resolves the original operation ID. A restart pauses the mandate, reconciles any prior effect, and requires an explicit rearm. It never blindly resubmits an unknown action.

## Strategies

| ID | Executable behavior | Limits |
| --- | --- | --- |
| `quote-momentum/v1` | Compare two fresh observations of an outcome's executable quotes; enter a bounded position after the configured positive move, exit after a holding period or configured adverse/profit move. | Experimental baseline. Volume, quote direction and relevance are not independently estimated win probabilities. |
| `kronos-direction/v1` | Consume an actual underlying-price forecast, compare its terminal price with an explicitly approved contract threshold plus a directional cushion, and propose a bounded paper position. | Exact owner-approved outcome, strike, symbol, horizon, model artifact and rule version must match. No conversion to event probability. A named-price forecast does not automatically apply to a similarly worded contract. |
| `forecast-edge/v1` | Compare an approved event-probability artifact with the current executable price and a minimum edge threshold. | Requires a server-owned promotion record with a pinned calibration report. No approved artifact is supplied by default. A signal's own `calibrated` claim cannot authorize this path. |

All three use the same independent paper governor. Strategy output never adjusts capital limits. Probability approval, mapping approval and the exact signal are checked again synchronously immediately before the ledger effect. A withdrawn signal, revoked mapping, changed rule, expired mandate, changed account, widened spread or stale valuation refuses that effect.

## Host wiring

```js
const autonomy = createAutonomyService({
  dataDir,
  ledger,
  markets,
  intelligence, // synchronous durable record(kind, payload, parents)
  scan, // optional bounded refresh inside a tick; omit for the independent research timer
  readSignals, // synchronous current server-owned signal snapshot
  approvedMappings, // synchronous owner-approved exact mapping lookup
  approvedForecasts, // synchronous approved probability artifact lookup
});
autonomy.start(); // starts the scheduler; does not arm a session
```

The host must authenticate mutation routes. `arm(config)` is an owner action; never expose it as a model tool. `status()`, `events()`, `tick()`, `pause()`, `stop()`, `evaluate()` and idempotent asynchronous `close()` complete the API. `scan` gets market IDs, the paper capital mode and mandate ID. For research outside the order loop, call synchronous `reserveResearchScan()` immediately before launch, after checking the research worker is idle. It returns `{allowed, mandateId, attempt, remaining}` and durably counts launch attempts, including failures, against the current mandate's `maxScans`; exhaustion or expiry refuses the launch and pauses or expires the mandate. The host must not reserve merely to check availability. Provider monetary/compute budgets remain the provider service's responsibility. A quote-only baseline does not require a provider key.

Required ledger integration: `commitDemo(input, {beforeEffect})` calls the synchronous guard with `{market, book, pricing}` inside its transaction, after network reads and before cash or position mutation. A network boundary or asynchronous callback must not replace that final check. The runner assumes one canonical local financial writer; it does not claim hostile-process containment or production custody.

When AUKORA intelligence is supplied, mandate, intent, refusal and fill events are actually appended to its signed evidence history with causal parent links. Evidence failure before a new effect refuses the operation and pauses; failure after a recorded financial effect pauses and preserves that effect. It never claims the trade rolled back. Large attachments are retained in the local event log and committed by hash in the evidence record. The log remains available for inspection.

## Replay and evidence

`evaluate()` uses recorded full books in chronological availability order. The beginning is warmup, the remainder is a held-out replay with the strategy frozen. It compares results with no new trades and a small first-outcome buy-and-hold baseline, models spread and depth, and reports unpriced liquidations as unavailable. No tuning is performed, and the report never declares an edge established.

The current replay supports the momentum baseline. Probability and Kronos strategy replay additionally need historical forecast and promotion records; they are explicitly refused by this replay rather than replaced by price hindsight. The simulation assumes zero-fee supported markets, full quantity or abstention, no market impact, no latency replay and no final settlement. These are material experiment assumptions, not live-execution guarantees.

Run focused behavior checks with `node --test tests/autonomy-*.test.mjs`. The tests use isolated disposable paper accounts and deterministic market fixtures; they do not establish profitable trading performance.
