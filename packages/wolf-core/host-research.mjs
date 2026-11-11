/**
 * Browser-safe boundary for the existing Auma host -> Wolf surface.
 * A host proposal selects public IDs. It supplies no authoritative market facts,
 * quote, balance, outcome selection, transaction intent or permission.
 * resolveMarket must call Wolf's same-origin service; schema checks are not
 * an authenticity proof and must never replace that service round trip.
 */
export class HostResearchContractError extends Error {
  constructor(code, message) { super(message); this.name = 'HostResearchContractError'; this.code = code; }
}
const refuse = (code, message) => { throw new HostResearchContractError(code, message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value, label = 'market ID') => {
  if (typeof value !== 'string' || !/^\d{1,100}$/.test(value)) refuse('HOST_RESEARCH_ID', `A valid source ${label} is required.`);
  return value;
};
const optionalNote = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : undefined;
const cancelled = signal => {
  if (signal?.aborted) refuse('HOST_RESEARCH_CANCELLED', 'This host research request is no longer active.');
};

/** Extract only bounded identifiers and explicitly non-authoritative plain notes. */
export function extractHostResearchReferences(input, { maxMarkets = 20 } = {}) {
  if (!record(input)) refuse('HOST_RESEARCH_SCHEMA', 'A structured research result is required.');
  if (!Number.isInteger(maxMarkets) || maxMarkets < 1 || maxMarkets > 20) refuse('HOST_RESEARCH_LIMIT', 'Research supports at most twenty markets.');
  if (input.authorizesOrder === true) refuse('HOST_RESEARCH_AUTHORITY', 'Research cannot authorize a transaction.');
  const rawMarkets = input.markets ?? [], proposals = input.opportunities ?? [];
  if (!Array.isArray(rawMarkets) || !Array.isArray(proposals)) refuse('HOST_RESEARCH_SCHEMA', 'Research market references must be arrays.');
  if (rawMarkets.length > maxMarkets || proposals.length > maxMarkets) refuse('HOST_RESEARCH_LIMIT', 'This research result contains too many markets.');
  const ids = new Set(), findings = {};
  for (const value of rawMarkets) {
    if (!record(value)) refuse('HOST_RESEARCH_SCHEMA', 'Each market reference must be an object.');
    ids.add(identity(value.id));
  }
  for (const value of proposals) {
    if (!record(value)) refuse('HOST_RESEARCH_SCHEMA', 'Each opportunity reference must be an object.');
    const marketId = identity(value.marketId); ids.add(marketId);
    if (value.authorizesOrder === true) refuse('HOST_RESEARCH_AUTHORITY', 'An opportunity cannot authorize a transaction.');
    // Caller-supplied URLs, prices, balances, outcome IDs and arbitrary fields are discarded.
    findings[marketId] = {
      marketId, relevance: optionalNote(value.relevance, 500), countercase: optionalNote(value.countercase, 600),
      interpretation: true, authorizesOrder: false,
    };
  }
  if (ids.size > maxMarkets) refuse('HOST_RESEARCH_LIMIT', 'This research result contains too many distinct markets.');
  return { marketIds: [...ids], findings };
}

/** Check an actual service response and optionally bind a requested outcome. */
export function validateResolvedHostMarket(market, expectedMarketId, options = {}) {
  identity(expectedMarketId);
  if (!record(market) || market.id !== expectedMarketId) refuse('HOST_MARKET_MISMATCH', 'The market service returned a different market.');
  if (typeof market.question !== 'string' || !market.question.trim() || !Array.isArray(market.outcomes) || typeof market.supported !== 'boolean') refuse('HOST_MARKET_SCHEMA', 'The market service returned an incomplete normalized market.');
  const seen = new Set();
  for (const outcome of market.outcomes) {
    if (!record(outcome) || typeof outcome.name !== 'string') refuse('HOST_MARKET_SCHEMA', 'The market service returned an invalid outcome.');
    if (outcome.assetId === null && !market.supported) continue;
    const assetId = identity(outcome.assetId, 'outcome asset ID');
    if (seen.has(assetId)) refuse('HOST_MARKET_SCHEMA', 'The market service returned duplicate outcome identities.');
    seen.add(assetId);
  }
  if (market.supported && (market.outcomes.length !== 2 || seen.size !== 2)) refuse('HOST_MARKET_SCHEMA', 'Executable demo markets require two distinct verified outcomes.');
  const requestedAssetId = typeof options === 'string' ? options : options.assetId;
  if (requestedAssetId !== undefined && requestedAssetId !== null) {
    identity(requestedAssetId, 'outcome asset ID');
    if (!seen.has(requestedAssetId)) refuse('HOST_OUTCOME_MISMATCH', 'That outcome does not belong to the selected market.');
  }
  return market;
}

/**
 * Atomically resolve a proposal: return all validated records or reject it.
 * The UI must merge only after this resolves, cancel superseded/unmounted work,
 * and leave the explicit user-controlled quote/commit flow unchanged.
 */
export async function resolveHostResearch(input, resolveMarket, { signal, maxMarkets = 20 } = {}) {
  const { marketIds, findings } = extractHostResearchReferences(input, { maxMarkets });
  if (typeof resolveMarket !== 'function') refuse('HOST_RESEARCH_RESOLVER', 'A Wolf service market resolver is required.');
  cancelled(signal);
  const markets = await Promise.all(marketIds.map(async id => {
    cancelled(signal);
    const market = await resolveMarket(id, { signal, fresh: true });
    cancelled(signal);
    return validateResolvedHostMarket(market, id);
  }));
  cancelled(signal);
  return { marketIds, markets, findings };
}
