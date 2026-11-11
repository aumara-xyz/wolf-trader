# Real intelligence providers

These are executable upstream integrations. They do not receive an order signer, account credential, balance mutation method or live execution capability. Their output is evidence for the rest of Wolf, with `authorizesOrder: false`.

| Provider | Executed implementation | Boundary |
| --- | --- | --- |
| Dexter | Exact upstream `Agent`, its `web_fetch` tool, and local Qwen3 1.7B through Ollama | Reads only frozen source snapshots supplied by Wolf. It cannot independently search the whole web. No paid model or financial-data key is needed for this mode. |
| Kronos | Exact upstream model code; pinned Kronos-mini and tokenizer safetensors | Predicts OHLCV for the supplied asset. Its return is **not** a probability that a prediction-market contract resolves Yes. |
| Laya | `laya==0.4.12`, pinned English checkpoint, verified ONNX export or public PyTorch checkpoint | Typed semantic judgments. Low-confidence abstentions remain visible. English financial-task calibration is not established. |
| Jev | Official TypeSafe `POST /v1/systemone`, pinned `jev-1.13.0`, typed-answer validation | Hosted integration is executable but unavailable until the owner supplies a key **and** explicitly enables paid calls. No live Jev call was made during this build. |
| NautilusTrader | `nautilus_trader==1.231.0` real `BacktestEngine` | Independent BTC/ETH bar replay with frozen intents and explicit fees. It is not a Polymarket settlement or historical CLOB-depth simulator. |

## Setup

Prerequisites: Node 22+, [uv](https://docs.astral.sh/uv/getting-started/installation/), [Bun](https://bun.sh/docs/installation), [Ollama](https://docs.ollama.com/quickstart), and Git. macOS arm64 is the observed platform. Other supported Python wheel platforms require verification on their own machine.

```sh
npm run wolf:setup
# Optional: execute public-data research, forecasting and replay, plus a labeled classifier diagnostic.
npm run wolf:setup -- --verify
```

Default provider runtime:

- macOS: `~/Library/Application Support/Wolf Trader/providers`
- Other systems: `~/.local/share/wolf-trader/providers`
- Override: `WOLF_PROVIDER_RUNTIME_DIR` or `--runtime-dir DIR` during setup and the matching runtime configuration when running the app.

Setup downloads about 2.3 GB of public model artifacts plus Python dependencies, checks available disk space, verifies exact artifact sizes and SHA-256 digests, installs a hash-locked Python environment, and installs exact Dexter source with its frozen Bun lock. Models and dependencies stay outside Git. Setup never reads trading credentials, invokes a paid provider or submits an order. It does not install prerequisite applications automatically.

Select a subset with `--kronos`, `--laya`, `--dexter` or `--nautilus`. The default selects all four free integrations. `--laya-model-dir DIR` imports only the exact verified ONNX artifact set listed in `pins.json`. Without that export, setup downloads the pinned **public** original English checkpoint and uses the actual Laya PyTorch SDK. Genesis, X1, X2 and a private model directory are not required to reproduce this provider runtime.

Owner-specified executable locations are supported by `WOLF_UV_PATH`, `WOLF_BUN_PATH` and `WOLF_OLLAMA_PATH`. These are local launch configuration, never model-generated commands or web request fields.

## Registry contract

```js
const providers = createProviderRegistry({
  dataDir,
  config: {
    runtimeDir,               // Optional; default above.
    timeoutMs: 120000,
    dexterTimeoutMs: 120000,
    classifier: 'laya',
    allowPaidProviders: false,
    jevModel: 'jev-1.13.0',
  },
});
```

- `status()` distinguishes installed, configured, available and **verified in this registry process**. File presence alone does not mark inference verified. Dexter discovery imports the actual pinned Agent and checks its local model manifest/runtime. Python discovery inspects installed package metadata and model availability. Cached diagnostics refresh without waiting behind an active inference. A successful setup receipt is not proof of a current running inference.
- `research({question,sources,signal})` accepts 1–8 source records with `{id,url,title,text,observedAt}`. It deterministically invokes the actual upstream `web_fetch` tool for the primary source, then gives that observed tool result, original source text and source catalog to the real Dexter Agent. The Agent can request additional allowed source reads. Every read uses the exact recorded snapshot through a bounded HTTP adapter. At least one successful tool read is required. Returned sources expose `readSucceeded`; a listed source is not automatically a reviewed source. Generated conclusions still require review against the evidence. Budget: three agent iterations and a bounded wall-clock timeout.
- `forecast({candles,intervalSeconds,horizon,symbol,sourceUrl,observedAt,signal})` accepts 32–512 completed, contiguous OHLCV observations and 1–24 future candles. Fields are `{timestamp,open,high,low,close,volume}`. Timestamp is ISO text or epoch seconds/milliseconds. Supported intervals: 60, 300, 900, 3600, 86400 seconds. CPU inference uses seed 7 and one sampled path. It returns raw predicted candles, a forecasted asset return, model/data provenance, and `eventProbability: null`.
- `classify({provider,text,market:{question,rules},state,signal})` asks fixed relevance/action questions. It rejects oversized inputs, silently omitted rules and actual tokenizer truncation. The pinned Laya context is 512 tokens, so callers should submit a clearly identified short evidence excerpt and preserve original records separately. Excerpted contract rules must not be represented as a full contract review. `abstained` means the result must not be promoted into a decisive action fact. Every semantic score is distinct from event odds.
- `replay({bars,intervalSeconds,symbol,startingCash,feeBps,orders,signal})` accepts 3–2000 bars, BTC-USD or ETH-USD, and at most 300 frozen intents `{afterBar,side,quantity}`. The bar index is zero based; no intent may target the final bar. Source candles become visible at bucket close. Nautilus matches subsequent market intents using its bar model, including explicit fees. Zero latency and missing spread/depth/queue information can make fills optimistic. Undefined statistics are `null`, not invented zero values.
- `close()` cancels the local worker and active/queued research. Operation signals support cancellation. Failures have bounded error codes; there is no silent provider substitution.

Successful results carry an input hash, source/model revision, timestamp, provider identity and explicit limitations. `provider-runs.json` records successful current-process runs in the caller's private data directory. It does not confer predictive validation or execution authority.

## Jev configuration

Set `config.allowPaidProviders = true` **only after owner authorization** and supply `WOLF_JEV_API_KEY` to the server process. A key's presence alone never enables a paid call. `TYPESAFE_API_KEY` is accepted only under the same explicit policy. The official endpoint is fixed; redirects and model-version drift are rejected. Tests use labeled response fixtures and prove the request/response boundary, not a live hosted inference.

## Local runtime isolation

Python inference is offline and loads only pinned local files. Dexter runs with an isolated working directory and a minimal environment; no shell, file, account, trading or autonomous browsing tools are enabled. Tool-generated URLs cannot widen its source set. Upstream dependencies are installed with package scripts disabled.

Dexter starts an app-owned Ollama server on loopback port **11437** when needed, with separate model storage and cloud features disabled. It verifies the exact local model digest and shuts down a server it started after completion/cancellation. It does not shut down a server it merely found. Ollama requires the real OS home to initialize its own installation identity; that home value is preserved, never redirected. Wolf does not read or copy that identity, and no cloud inference is enabled. An unrelated service occupying this port or a changed model digest causes failure rather than remote fallback.

## Observed execution, 2026-11-11

The setup path and all four free integrations ran on this Mac. These measurements are execution evidence, **not trading performance or an alpha claim**:

- Kronos generated three hourly candles from 64 actual public Coinbase BTC-USD observations: about **1.85 s** in the combined verification process.
- Laya ONNX classified a clearly labeled tariff diagnostic: about **5.59 s**. It **abstained**. An earlier announced-not-enacted diagnostic chose the wrong class with 0.391 answer confidence and correctly exposed low confidence/abstention. This is evidence for retaining abstention, not evidence of dependable financial classification.
- The fresh public Laya checkpoint also downloaded through the reproducible setup and executed through the actual PyTorch SDK; no private model export is necessary.
- Nautilus executed frozen buy/sell intents on observed Coinbase bars. A separate 32-bar replay charged the configured fees and ended at **$9,986.13 from $10,000**, a loss. It completed in about **2.47 s**; a later warm 64-bar run took about **1.09 s**. This verifies the matching/accounting path, not a profitable strategy.
- Dexter started Ollama itself, called upstream `web_fetch` on the supplied public Coinbase snapshot, used Qwen for extraction and a final source-attributed answer, and shut down its owned server. Two agent iterations took about **48.6 s cold**. Research must therefore remain outside the fast execution boundary.
- Jev was **not live verified** because no owner-enabled key was supplied. There were no paid model calls and no trading-account calls.

The setup's `--verify` writes current detailed results to `verification.json` outside Git. Re-running a subset replaces that verification file with the subset's actual results; it never merges stale results into a current-success claim. Nine boundary tests cover input validation, credential/policy gating, response/model drift, cancellation and missing-runtime behavior. Synthetic inputs and mocked hosted responses are explicitly test fixtures.

## Sources and licenses

Exact revisions, artifacts and model digests are in [`pins.json`](./pins.json).

- [Dexter](https://github.com/virattt/dexter) source is installed from exact revision `534f6be455523c5926eba72bdaf4f914555be5c9`. Its README declares MIT, but that pinned repository has no separate LICENSE file. This package does not invent one or vendor Dexter source. The source-closure digest and frozen lock are checked before use.
- [Kronos](https://github.com/shiyu-coder/Kronos) `model/` source is copied unchanged from `67b630e67f6a18c9e9be918d9b4337c960db1e9a`, with its MIT license retained in `workers/vendor/kronos/LICENSE`. Model and tokenizer cards are downloaded at exact Hugging Face revisions.
- [Laya](https://github.com/NandhaKishorM/laya) / [public checkpoint](https://huggingface.co/convaiinnovations/laya): Apache-2.0, retained under `workers/licenses`. The ONNX exporter provenance revision in `pins.json` is distinct from the separately pinned `laya==0.4.12` runtime distribution.
- [Qwen3](https://ollama.com/library/qwen3:1.7b): exact manifest/layer hashes, Apache-2.0 license retained under `workers/licenses`.
- [NautilusTrader](https://github.com/nautechsystems/nautilus_trader): LGPL-3.0-or-later, unmodified pinned wheel loaded in an external Python process; license retained under `workers/licenses`.
- [Jev API](https://docs.typesafe.ai/api/system-one): hosted service terms apply; no Jev weights or proprietary source are bundled.

None of these upstream licenses grants rights to unrelated private AUKORA source. No private repo access token, API key, wallet, personal account data or model weights belong in this repository.
