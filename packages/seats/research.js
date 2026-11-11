// Research seat stub. It reads a replayed SIM tape and emits a MacroThesis.
// The confidence number is a fixed stub prior, not a fitted probability.
// authorizesLiveOrder is always false. This seat cannot spend.

import { createMarket } from '../engines/wolf-market.js';

export const THESIS_SCHEMA = 'aukora-wolf-macro-thesis-v1';
export const THESIS_STUB_CONFIDENCE = 0.55;

export function observeTape(opts = {}) {
  const seed = (opts.seed ?? 7) >>> 0;
  const symbol = opts.symbol ?? 'RUT';
  const ticks = Math.max(8, Math.min(2000, opts.ticks ?? 80));
  const market = createMarket({ seed });
  let quotes = market.quotes('t0');
  for (let i = 0; i < ticks; i++) quotes = market.step(`t${i + 1}`);
  const quote = quotes.find((q) => q.symbol === symbol);
  if (!quote) throw new Error(`unknown symbol ${symbol}`);
  const hist = quote.history;
  const rets = [];
  for (let i = 1; i < hist.length; i++) rets.push(Math.log(hist[i] / hist[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const vol = Math.sqrt(Math.max(variance, 0));
  const total = hist[hist.length - 1] / hist[0] - 1;
  let direction = 'flat';
  if (total > 0.002) direction = 'up';
  else if (total < -0.002) direction = 'down';
  const thesis = {
    schema: THESIS_SCHEMA,
    id: `thesis-${symbol}-s${seed}-t${ticks}`,
    at: quote.provenance.at,
    symbol,
    horizon: 'session',
    claim: `Research note only: ${symbol} replay finished ${total >= 0 ? '+' : ''}${(total * 100).toFixed(2)}% over ${ticks} ticks and reads ${direction}. Stub confidence ${THESIS_STUB_CONFIDENCE} is not a forecast. This speech does not authorize an order.`,
    confidence: THESIS_STUB_CONFIDENCE,
    direction,
    vol,
    drift: mean,
    totalReturn: total,
    evidence: {
      source: quote.provenance.source,
      seed: quote.provenance.seed,
      tick: quote.provenance.tick,
    },
    authorizesLiveOrder: false,
    mode: 'PAPER',
  };
  return { thesis, quote };
}
