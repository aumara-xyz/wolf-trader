import { createHash } from 'node:crypto';
import { SCALE, units, decimal, fail } from '../wolf-core/fixed.mjs';

export const STRATEGIES = Object.freeze([
  { id: 'weekly-hypothesis/v1', title: 'Weekly research hypotheses', forecast: false, description: 'Experimental paper actions from an explicitly uncalibrated, frozen weekly research book. No proven predictive edge.' },
  { id: 'quote-momentum/v1', title: 'Quote momentum baseline', forecast: false, description: 'Tests whether a recent executable quote move continues. It is a disclosed experimental rule, not a prediction model or a proven edge.' },
  { id: 'forecast-edge/v1', title: 'Approved probability forecast', forecast: true, description: 'Uses only a separately approved probability artifact and calibration report. Text relevance and classifier scores cannot enter this strategy.' },
  { id: 'kronos-direction/v1', title: 'Kronos threshold experiment', forecast: true, description: 'Tests an underlying-price forecast against an explicitly approved binary-contract threshold mapping. It does not estimate the contract’s win probability.' },
]);
export const strategyDigest = id => createHash('sha256').update(`wolf-autonomy-strategy/v1:${id}`).digest('hex');
const signed = value => /^-/.test(String(value)) ? -units(String(value).slice(1)) : units(value);
export const signedUnits = signed;
const signalDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Resolve an owner-supplied paper mandate into explicit, versioned limits. */
export function resolveMandate(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('MANDATE_REQUIRED', 'Set the paper session limits first.');
  if (input.capitalMode !== 'DEMO') fail('PAPER_ONLY', 'Autonomy can only operate the simulated account.', 403);
  const strategy = input.strategy ?? 'quote-momentum/v1';
  if (!STRATEGIES.some(item => item.id === strategy)) fail('STRATEGY_UNAVAILABLE', 'Choose an implemented strategy.');
  if (!Array.isArray(input.marketIds) || !input.marketIds.length || input.marketIds.length > 20 || input.marketIds.some(id => typeof id !== 'string' || !/^\d{1,100}$/.test(id))) fail('MARKET_SCOPE_REQUIRED', 'Select one to twenty exact market IDs.');
  const integer = (key, fallback, min, max) => { const value = input[key] ?? fallback; if (!Number.isInteger(value) || value < min || value > max) fail('MANDATE_LIMIT_INVALID', `${key} must be between ${min} and ${max}.`); return value; };
  const amount = (key, fallback, max = '1000000') => { const value = units(input[key] ?? fallback, key); if (value <= 0n || value > units(max)) fail('MANDATE_LIMIT_INVALID', `${key} must be positive and at most ${max}.`); return decimal(value); };
  const config = {
    schema: 'wolf-paper-mandate/v1', capitalMode: 'DEMO', strategy, strategyDigest: strategyDigest(strategy), marketIds: [...new Set(input.marketIds)],
    perOrder: amount('perOrder', '10'), maxExposure: amount('maxExposure', '50'), maxMarketExposure: amount('maxMarketExposure', '25'), maxEventExposure: amount('maxEventExposure', '50'),
    maxSessionLoss: amount('maxSessionLoss', '10'), maxTurnover: amount('maxTurnover', '100'), maxOrders: integer('maxOrders', 10, 1, 10000),
    durationMinutes: integer('durationMinutes', 60, 1, 10080), intervalSeconds: integer('intervalSeconds', 60, 5, 3600), maxScans: integer('maxScans', 120, 1, 10000),
    maxSpread: amount('maxSpread', '0.04', '0.50'), minMomentum: amount('minMomentum', '0.02', '0.50'), exitMove: amount('exitMove', '0.02', '0.50'), takeProfitMove: amount('takeProfitMove', '0.04', '0.50'),
    maxEntryPrice: amount('maxEntryPrice', '0.80', '0.99'),
    minEdge: amount('minEdge', '0.05', '0.50'), maxHoldMinutes: integer('maxHoldMinutes', 30, 1, 10080), maxDataAgeMs: integer('maxDataAgeMs', 5000, 100, 5000),
    maxSignalAgeMs: integer('maxSignalAgeMs', 300000, 1000, 3600000), manageExistingPositions: input.manageExistingPositions === true,
    authority: input.authority ?? null, weeklyBookId: strategy === 'weekly-hypothesis/v1' ? input.weeklyBookId : null,
    forecastArtifact: strategy === 'forecast-edge/v1' ? input.forecastArtifact : null,
    forecastMappingId: strategy === 'kronos-direction/v1' ? input.forecastMappingId : null,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + integer('durationMinutes', 60, 1, 10080) * 60000).toISOString(),
    restartPolicy: 'paused-until-owner-rearms', stopBehavior: 'stop-new-actions-retain-positions', simulation: 'public-depth-no-market-impact-fee-free',
  };
  if (units(config.perOrder) > units(config.maxMarketExposure) || units(config.maxMarketExposure) > units(config.maxExposure) || units(config.maxEventExposure) > units(config.maxExposure)) fail('MANDATE_LIMIT_INVALID', 'Per-order, market and event limits must fit within the session exposure limit.');
  if (strategy === 'forecast-edge/v1' && (typeof config.forecastArtifact !== 'string' || !/^[a-f0-9]{64}$/.test(config.forecastArtifact))) fail('APPROVED_FORECAST_REQUIRED', 'Select an approved, calibrated probability artifact.');
  if (strategy === 'kronos-direction/v1' && (typeof config.forecastMappingId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(config.forecastMappingId))) fail('APPROVED_MAPPING_REQUIRED', 'Select an owner-approved exact contract mapping.');
  if (strategy === 'weekly-hypothesis/v1' && (typeof config.weeklyBookId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(config.weeklyBookId))) fail('WEEKLY_BOOK_REQUIRED', 'Select an exact completed weekly research book.');
  return config;
}

export function mappingIsCurrent(mapping, config, now) {
  if (!mapping || mapping.then || mapping.id !== config.forecastMappingId || mapping.status !== 'approved' || !config.marketIds.includes(mapping.marketId) || typeof mapping.assetId !== 'string' || typeof mapping.rulesVersion !== 'string' || typeof mapping.symbol !== 'string' || !mapping.symbol || typeof mapping.modelArtifact !== 'string' || !mapping.modelArtifact || !['above', 'below'].includes(mapping.direction)) return false;
  if (!Number.isFinite(Date.parse(mapping.horizonEnd)) || Date.parse(mapping.horizonEnd) <= now || !Number.isFinite(Date.parse(mapping.expiresAt)) || Date.parse(mapping.expiresAt) <= now) return false;
  try { const strike = units(mapping.strike), cushion = units(mapping.minRelativeMove ?? '0.01'); return strike > 0n && cushion > 0n && cushion <= 200000n; } catch { return false; }
}

/** Deterministic proposal only. The independent runner checks money and authority. */
export function chooseProposal({ config, observations, previous, positions, managed, now, signals = [], forecastApproval, forecastMapping }) {
  for (const position of positions) {
    if (!config.marketIds.includes(position.marketId)) continue;
    const ownership = managed[position.assetId];
    if (!ownership && !config.manageExistingPositions) continue;
    const current = observations.find(item => item.assetId === position.assetId);
    if (!current) continue;
    const average = units(position.averageCost), bid = units(current.bid);
    const openedAt = ownership?.openedAt ?? config.createdAt;
    const reason = now - Date.parse(openedAt) >= config.maxHoldMinutes * 60000 ? 'holding-horizon' : average - bid >= units(config.exitMove) ? 'adverse-price-move' : bid - average >= units(config.takeProfitMove) ? 'profit-taking-rule' : null;
    if (reason) {
      const held = units(position.quantity), owned = ownership ? units(ownership.quantity) : held;
      const quantity = config.manageExistingPositions || held < owned ? held : owned;
      if (quantity > 0n) return { side: 'SELL', marketId: current.marketId, assetId: current.assetId, quantity: decimal(quantity), reason, observationId: current.id };
    }
  }
  for (const current of observations) {
    if (positions.some(p => p.assetId === current.assetId && units(p.quantity) > 0n)) continue;
    if (units(current.ask) - units(current.bid) > units(config.maxSpread)) continue;
    if (units(current.ask) > units(config.maxEntryPrice)) continue;
    if (config.strategy === 'quote-momentum/v1') {
      const prior = previous[current.assetId];
      if (!prior || prior.rulesVersion !== current.rulesVersion || Date.parse(current.at) - Date.parse(prior.at) < config.intervalSeconds * 1000 || Date.parse(current.at) - Date.parse(prior.at) > config.intervalSeconds * 3000) continue;
      const midpoint = (units(current.ask) + units(current.bid)) / 2n, old = (units(prior.ask) + units(prior.bid)) / 2n;
      if (midpoint - old >= units(config.minMomentum)) return { side: 'BUY', marketId: current.marketId, assetId: current.assetId, amount: config.perOrder, reason: 'momentum-baseline-entry', observationId: current.id, priorObservationId: prior.id, observedMove: decimal(midpoint - old), forecast: false };
    } else if (config.strategy === 'weekly-hypothesis/v1') {
      const candidate=signals.find(s=>s?.kind==='weekly-event-hypothesis'&&s.bookId===config.weeklyBookId&&s.marketId===current.marketId&&s.assetId===current.assetId&&s.rulesVersion===current.rulesVersion&&s.calibrated===false&&s.invalidated!==true&&typeof s.evidenceId==='string');
      if(!candidate)continue;
      const at=Date.parse(candidate.observedAt),expiry=Date.parse(candidate.expiresAt);
      if(!Number.isFinite(at)||!Number.isFinite(expiry)||at>now||now-at>config.maxSignalAgeMs||expiry<=now)continue;
      let p;try{p=units(candidate.probability);}catch{continue;}
      if(p<=0n||p>=SCALE||p-units(current.ask)<units(config.minEdge))continue;
      return {side:'BUY',marketId:current.marketId,assetId:current.assetId,amount:config.perOrder,reason:'experimental-weekly-hypothesis',observationId:current.id,signalId:candidate.id,signalDigest:signalDigest(candidate),probability:candidate.probability,signalExpiresAt:candidate.expiresAt,weeklyHypothesis:true,calibrated:false,forecast:false};
    } else if (config.strategy === 'forecast-edge/v1') {
      if (!forecastApproval || forecastApproval.artifactHash !== config.forecastArtifact || forecastApproval.status !== 'approved' || forecastApproval.task !== 'event-probability' || !/^[a-f0-9]{64}$/.test(forecastApproval.calibrationReportHash ?? '') || !Number.isFinite(Date.parse(forecastApproval.expiresAt)) || Date.parse(forecastApproval.expiresAt) <= now) continue;
      const candidate = signals.find(signal => signal?.kind === 'event-probability' && signal.marketId === current.marketId && signal.assetId === current.assetId && signal.artifactHash === forecastApproval.artifactHash && signal.calibrationReportHash === forecastApproval.calibrationReportHash && signal.rulesVersion === current.rulesVersion && typeof signal.id === 'string' && signal.id.length <= 200 && Array.isArray(signal.sources) && signal.sources.length > 0);
      if (!candidate) continue;
      const observed = Date.parse(candidate.observedAt), expires = Date.parse(candidate.expiresAt);
      if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > now || now - observed > config.maxSignalAgeMs || expires <= now) continue;
      let p;
      try { p = units(candidate.probability); } catch { continue; }
      if (p <= 0n || p >= SCALE || p - units(current.ask) < units(config.minEdge)) continue;
      if (candidate.invalidated === true) continue;
      return { side: 'BUY', marketId: current.marketId, assetId: current.assetId, amount: config.perOrder, reason: 'approved-probability-edge', observationId: current.id, signalId: candidate.id, signalDigest: signalDigest(candidate), artifactHash: candidate.artifactHash, calibrationReportHash: candidate.calibrationReportHash, probability: candidate.probability, estimatedEdge: decimal(p - units(current.ask)), signalExpiresAt: candidate.expiresAt, forecast: true };
    } else if (config.strategy === 'kronos-direction/v1') {
      if (!mappingIsCurrent(forecastMapping, config, now) || forecastMapping.marketId !== current.marketId || forecastMapping.assetId !== current.assetId || forecastMapping.rulesVersion !== current.rulesVersion) continue;
      const mapping = forecastMapping;
      const candidate = signals.find(signal => signal?.kind === 'underlying-price-forecast' && signal.mappingId === mapping.id && signal.marketId === mapping.marketId && signal.assetId === mapping.assetId && signal.rulesVersion === mapping.rulesVersion && signal.symbol === mapping.symbol && signal.modelArtifact === mapping.modelArtifact && signal.strike === mapping.strike && signal.direction === mapping.direction && signal.horizonEnd === mapping.horizonEnd && typeof signal.id === 'string' && /^[a-f0-9]{64}$/.test(signal.inputHash ?? ''));
      if (!candidate) continue;
      const at = Date.parse(candidate.forecastAt), expiry = Date.parse(candidate.expiresAt);
      if (!Number.isFinite(at) || !Number.isFinite(expiry) || at > now || now - at > config.maxSignalAgeMs || expiry <= now) continue;
      let terminal, strike, cushion;
      try { terminal = units(candidate.terminalPrice); strike = units(mapping.strike); cushion = strike * units(mapping.minRelativeMove ?? '0.01') / SCALE; } catch { continue; }
      if (terminal <= 0n || (mapping.direction === 'above' ? terminal < strike + cushion : terminal > strike - cushion)) continue;
      if (candidate.invalidated === true) continue;
      return { side: 'BUY', marketId: current.marketId, assetId: current.assetId, amount: config.perOrder, reason: 'kronos-threshold-experiment', observationId: current.id, signalId: candidate.id, signalDigest: signalDigest(candidate), mappingId: mapping.id, mappingDigest: signalDigest(mapping), modelArtifact: candidate.modelArtifact, inputHash: candidate.inputHash, terminalPrice: candidate.terminalPrice, signalExpiresAt: candidate.expiresAt, forecast: false, underlyingPriceForecast: true, probabilityClaim: false };
    }
  }
  return null;
}
