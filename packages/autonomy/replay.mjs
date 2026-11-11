import { createHash } from 'node:crypto';
import { units, decimal, fail, SCALE } from '../wolf-core/fixed.mjs';
import { createPricing, priceQuantity, marketBinding, normalizedBook } from '../wolf-core/pricing.mjs';
import { resolveMandate, chooseProposal } from './strategy.mjs';

/** Chronological held-out replay of recorded books; no midpoint or invented fills. */
export function evaluateReplay({ observations = [], config, initialCash = '1000', holdoutFraction = 0.5 } = {}) {
  if (!Array.isArray(observations) || observations.length > 20000) fail('REPLAY_INPUT_INVALID', 'Replay accepts up to 20,000 recorded book observations.');
  if (typeof holdoutFraction !== 'number' || holdoutFraction < 0.2 || holdoutFraction > 0.8) fail('REPLAY_INPUT_INVALID', 'Reserve between 20% and 80% of observations for the held-out replay.');
  const ordered = observations.map(item => {
    if (!item || !Number.isFinite(Date.parse(item.at)) || !item.market || !item.book || typeof item.assetId !== 'string') fail('REPLAY_INPUT_INVALID', 'Each observation needs its market, full book and receipt time.');
    return structuredClone(item);
  }).sort((a, b) => Date.parse(a.availableAt ?? a.at) - Date.parse(b.availableAt ?? b.at));
  const hash = createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
  const frames = new Map();
  for (const item of ordered) {
    const at = item.availableAt ?? item.at;
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(item.at)) fail('REPLAY_INPUT_INVALID', 'An observation cannot be used before its receipt time.');
    if (!frames.has(at)) frames.set(at, []); frames.get(at).push(item);
  }
  const timeFrames = [...frames.entries()], split = Math.floor(timeFrames.length * (1 - holdoutFraction));
  if (timeFrames.length < 4 || timeFrames.length - split < 2) return { schema: 'wolf-replay-evaluation/v1', status: 'insufficient-observations', dataHash: hash, observations: ordered.length, frames: timeFrames.length, minimumFrames: 4, predictiveEdgeEstablished: false, reason: 'Record multiple chronological market observations before comparing a strategy with a baseline.' };
  const c = config ?? resolveMandate({ capitalMode: 'DEMO', marketIds: [...new Set(ordered.map(item => item.marketId))], intervalSeconds: 5 }, Date.parse(timeFrames[0][0]));
  if (c.strategy !== 'quote-momentum/v1') return { schema: 'wolf-replay-evaluation/v1', status: 'unsupported-strategy-data', dataHash: hash, predictiveEdgeEstablished: false, reason: 'Probability strategies need the original timestamped forecast and promotion record in addition to price books.' };
  let cash = units(initialCash), peak = cash, drawdown = 0n, turnover = 0n, paused = false;
  const initial = cash, positions = new Map(), managed = {}, previous = {}, lastBooks = new Map(), decisions = [];
  let fills = 0, grossCosts = 0n, firstBenchmark = null;
  const mark = () => {
    let equity = cash;
    for (const position of positions.values()) {
      const item = lastBooks.get(position.assetId);
      if (!item) return null;
      try { equity += priceQuantity(marketBinding(item.market, item.assetId), normalizedBook(item.book, item.assetId, Date.parse(item.at)), 'SELL', units(position.quantity)).proceeds; } catch { return null; }
    }
    return equity;
  };
  for (let index = 0; index < timeFrames.length; index++) {
    const [at, frame] = timeFrames[index], currentTime = Date.parse(at);
    for (const item of frame) {
      const book = normalizedBook(item.book, item.assetId, currentTime);
      if (!book.bids.length || !book.asks.length) fail('REPLAY_INPUT_INVALID', 'Replay needs both sides of each recorded book.');
      item.bid = decimal(book.bids[0].p); item.ask = decimal(book.asks[0].p);
      lastBooks.set(item.assetId, item);
    }
    if (index >= split && !firstBenchmark) {
      try { const item = frame[0], buy = createPricing({ market: item.market, book: item.book, assetId: item.assetId, side: 'BUY', amount: c.perOrder, now: currentTime }); firstBenchmark = { assetId: item.assetId, debit: buy.priced.debit, quantity: buy.priced.quantity, at }; } catch { /* Missing executable depth makes this baseline unavailable. */ }
    }
    const equity = mark();
    if (equity !== null && index >= split) { if (equity > peak) peak = equity; if (peak - equity > drawdown) drawdown = peak - equity; if (initial - equity >= units(c.maxSessionLoss)) paused = true; }
    if (index >= split && !paused) {
      const proposal = chooseProposal({ config: c, observations: frame, previous, positions: [...positions.values()], managed, now: currentTime });
      if (proposal) {
        try {
          const item = frame.find(value => value.assetId === proposal.assetId), result = createPricing({ ...proposal, market: item.market, book: item.book, now: currentTime });
          const exposure = [...positions.values()].reduce((sum, p) => sum + units(p.costBasis), 0n), gross = result.priced.gross;
          if (fills >= c.maxOrders || turnover + gross > units(c.maxTurnover)) fail('REPLAY_BUDGET', 'Replay mandate budget exhausted.');
          if (proposal.side === 'BUY') {
            const marketExposure = [...positions.values()].filter(p => p.marketId === item.marketId).reduce((sum, p) => sum + units(p.costBasis), 0n);
            const eventId = item.market.eventId ?? `market:${item.marketId}`;
            const eventExposure = [...positions.values()].filter(p => (lastBooks.get(p.assetId)?.market.eventId ?? `market:${p.marketId}`) === eventId).reduce((sum, p) => sum + units(p.costBasis), 0n);
            if (result.priced.debit > cash || exposure + result.priced.debit > units(c.maxExposure) || marketExposure + result.priced.debit > units(c.maxMarketExposure) || eventExposure + result.priced.debit > units(c.maxEventExposure)) fail('REPLAY_RISK', 'Replay exposure limit refused the proposal.');
            cash -= result.priced.debit;
            positions.set(item.assetId, { marketId: item.marketId, assetId: item.assetId, quantity: decimal(result.priced.quantity), costBasis: decimal(result.priced.debit), averageCost: decimal(result.priced.debit * SCALE / result.priced.quantity) });
            managed[item.assetId] = { openedAt: at, quantity: decimal(result.priced.quantity) };
            const immediateSell = priceQuantity(result.binding, result.book, 'SELL', result.priced.quantity);
            grossCosts += result.priced.debit - immediateSell.proceeds;
          } else { cash += result.priced.proceeds; positions.delete(item.assetId); delete managed[item.assetId]; }
          fills++; turnover += gross;
          decisions.push({ at, side: proposal.side, assetId: proposal.assetId, reason: proposal.reason, quantity: decimal(result.priced.quantity), value: decimal(gross), observedAt: item.at });
        } catch (error) { decisions.push({ at, action: 'abstained', reason: error.code ?? 'REPLAY_UNAVAILABLE' }); }
      }
    }
    for (const item of frame) previous[item.assetId] = { id: item.id, at, bid: item.bid, ask: item.ask, rulesVersion: item.rulesVersion };
  }
  const ending = mark(); let buyHold = null;
  if (ending !== null && peak - ending > drawdown) drawdown = peak - ending;
  if (firstBenchmark) {
    const latest = lastBooks.get(firstBenchmark.assetId);
    try { buyHold = initial - firstBenchmark.debit + priceQuantity(marketBinding(latest.market, latest.assetId), normalizedBook(latest.book, latest.assetId, Date.parse(latest.at)), 'SELL', firstBenchmark.quantity).proceeds; } catch { /* Never replace an unavailable liquidation with a price estimate. */ }
  }
  return { schema: 'wolf-replay-evaluation/v1', status: 'evaluated', strategy: c.strategy, strategyDigest: c.strategyDigest, dataHash: hash, observations: ordered.length, frames: timeFrames.length,
    partition: { warmupFrames: split, heldOutFrames: timeFrames.length - split, heldOutFrom: timeFrames[split][0], lastObservedAt: timeFrames.at(-1)[0], candidateSearchCount: 1, tuningPerformed: false },
    initialCash: decimal(initial), finalEquity: ending === null ? null : decimal(ending), netPnl: ending === null ? null : decimal(ending - initial), cash: decimal(cash), openPositions: positions.size,
    fills, turnover: decimal(turnover), observedEntrySpreadCost: decimal(grossCosts), maximumMarkedDrawdown: decimal(drawdown), stoppedByLossRule: paused,
    baselines: { noTrade: { equity: decimal(initial), pnl: '0.000000' }, buyFirstOutcomeAndHold: buyHold === null ? { status: 'unavailable' } : { equity: decimal(buyHold), pnl: decimal(buyHold - initial) } },
    decisions, predictiveEdgeEstablished: false, simulation: { fills: 'full executable historical depth or abstention', fees: 'supported zero-fee markets only', partialFills: false, latency: 'decisions and modeled fills at observed frame receipt; no network latency replay', marketImpact: 'not modeled', finalSettlement: 'not modeled', regimeGeneralization: 'not established', model: 'quote-momentum/v1 chronological experiment' } };
}
