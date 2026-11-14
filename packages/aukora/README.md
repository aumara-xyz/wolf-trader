# Trading memory and verifiable evidence

`createAukoraIntelligence({dataDir, now?, segmentSize?})` owns a fresh local Nostr identity and SQLite store outside the repository. Research observations, model interpretations, strategy proposals and execution results can be linked through signed evidence IDs. No existing owner identity, personal memory, keys or trading data is imported. The service does not connect to relays or publish automatically.

The Kira, Nostr and Aura operations execute the exact pinned Wasm assets under `../aukora-vendor`. `status()` reports their actual invocation counts and byte pins. The service rechecks the signed event chain on startup and rebuilds disposable memory/candidate indexes from it. Corrections retain the earlier claim instead of rewriting it. Model-created memory stays context; Kira clamps claimed authority and carries source ancestry. Recall uses bounded term overlap and the genuine Kira recall-ranking cell, not an unimplemented semantic search engine.

## Service interface

All methods are synchronous and return detached JSON values; the owning service serializes requests. Call `close()` when shutting down.

| Method | Behavior |
| --- | --- |
| `record(kind, payload, parents=[])` | Appends signed evidence and updates the Aura root/checkpoint atomically. Use domain kinds such as `market.observed`, `research.completed`, `strategy.proposed`, `execution.recorded`. `memory.*`, `candidate.*`, `network.*` are reserved for typed operations. |
| `remember({text,sources,kind,capture,parents})` | Classifies and stores a `finding` or `experience`. Model/web claims cannot gain owner authority. Sources are reference strings or small objects with `id`/`url`. |
| `recall(query,{limit=8})` | Returns current matching memories, source references, classifications and a method label. |
| `correct(id,replacement)` | Records a new version and supersedes the prior current note; history remains verifiable. |
| `exportEvidence()` / `verifyEvidence(bundle, options)` | Exports a local bundle or cold-verifies signatures, order, causal parents and Merkle checkpoint. Optional `expectedPubkey` and `expectedHead:{size,root}` bind verification to an independently retained identity/prefix. |
| `exportManifest()` / `exportSegment(index)` / `verifyArchive(manifest, parts, options)` | Exports a signed segmented archive and verifies its complete ordered segments. The archive verifier accepts the same independently known identity/prefix options. |
| `exportNostrEvent(id)` / `importNostrEvent(event)` | Exchanges individual NIP-01 events. Verified external events remain untrusted evidence, with no order authority. Duplicates are stable. |
| `createCandidate(spec)` | Freezes an exact content-addressed probability-combination artifact. Current method: `weighted-probabilities/v1`, with explicit `modelWeight` in [0,1]. No arbitrary JS is executed. |
| `evaluateCandidate(id,{splitId,cases})` | Computes Brier score against the market-probability baseline on unique dated resolved cases. Cases and results remain in evidence. Each case has `id`, `predictedAt`, `resolvedAt`, `marketProbability`, `modelProbability`, `outcome` (0 or 1). |
| `promoteCandidate(id,{evaluationId,expectedActiveId,allowPaper:true})` | Requires improvement over the baseline on at least 20 cases, scope permission and an unchanged active artifact. The result is paper-only and cannot widen a financial mandate. |

Candidate evaluation is reproducible arithmetic over supplied cases. It does not independently establish source authenticity, unseen holdouts, economic returns or absence of selection bias. Its explicit current label says so. It is a versioned evaluation mechanism inspired by AUKORA candidate promotion, not a claim that the entire Scion code-rewriting runtime executes here.

## Integrity and operational limits

Signatures establish which identity recorded bytes, not whether a source is true or a model is correct. An exported bundle that brings its own public key is self-authenticating but not tied to a known identity until the verifier supplies `expectedPubkey`. An independently retained prefix detects rollback/forks relative to that prefix; replacing both the local database and key or restoring both to an old copy cannot be detected without an external retained anchor.

Private evidence can contain research or account facts. Export is local and explicit; publication requires a separate sharing decision. Credential-shaped fields are rejected, but callers must still avoid secrets embedded inside arbitrary prose. Keys stay in a 0600 file and are zeroed after use; evidence bundles contain public keys/signatures only.

Evidence now uses linked signed segments, with 128 events per segment by default and no 4,096-record operational ceiling. Existing flat histories migrate without rewriting their signed events. Each segment is bounded by event count and bytes. Full exports are limited to 64 MiB; larger histories use the manifest and bounded segment exports, and recording can continue. The legacy flat-export verifier retains its original 4,096-event bound for legacy bundles. Each operation also has payload, nesting, parent and source limits. These are integrity/resource bounds, not trading-capital or monetary-loss limits.
