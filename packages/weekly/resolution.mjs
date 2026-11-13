/** Read-only venue resolution. A terminal quote alone never establishes an outcome. */
const refuse = message => { throw Object.assign(new Error(message), { code: 'WEEKLY_RESOLUTION_INVALID', status: 400 }); };
export function validateVenueResolution(raw, market, observedAt) {
  if (!raw || raw.condition_id !== market.conditionId) refuse('The venue returned a different condition.');
  if (raw.closed !== true || raw.accepting_orders !== false) return { status: 'pending', authority: 'venue-reported', final: false };
  if (!Array.isArray(raw.tokens) || raw.tokens.length !== 2 || market.outcomes.length !== 2) refuse('A binary resolution requires two exact outcome tokens.');
  const ids = new Set();
  const payouts = market.outcomes.map(outcome => {
    const token = raw.tokens.find(t => t.token_id === outcome.assetId);
    if (!token || ids.has(token.token_id) || token.outcome !== outcome.name || typeof token.winner !== 'boolean') refuse('Resolution token identity, label or winner flag is inconsistent.');
    ids.add(token.token_id); return token.winner ? 1 : 0;
  });
  if (payouts[0] + payouts[1] !== 1) return { status: 'awaiting-binary-final-result', authority: 'venue-reported', final: false };
  return { schema: 'wolf-venue-resolution/v1', status: 'resolved', final: true, authority: 'venue-reported', onChainVerified: false, marketId: market.id, conditionId: market.conditionId, rulesVersion: market.rulesVersion, sourceUrl: `https://clob.polymarket.com/markets/${market.conditionId}`, observedAt, outcomes: market.outcomes.map((o, i) => ({ assetId: o.assetId, name: o.name, payout: payouts[i] })), basis: 'Official CLOB closed market and exact tokens[].winner flags; not inferred from prices.' };
}
export async function readVenueResolution({ market, fetchImpl = fetch, signal, now = Date.now }) {
  if (market.closed !== true) return { status: 'pending', final: false, authority: 'venue-reported' };
  if (!/^0x[a-fA-F0-9]{64}$/.test(market.conditionId ?? '') || market.protocolVersion !== 'v1') return { status: 'unsupported-resolution-protocol', final: false, authority: 'none' };
  const response = await fetchImpl(`https://clob.polymarket.com/markets/${market.conditionId}`, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(12000)]) });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw Object.assign(new Error('The venue resolution source is unavailable.'), { code: 'WEEKLY_RESOLUTION_UNAVAILABLE' }); }
  const chunks = [], reader = response.body.getReader(); let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 250000) { await reader.cancel(); refuse('The venue resolution response exceeded its limit.'); } chunks.push(value); } } finally { reader.releaseLock(); }
  let raw; try { raw = JSON.parse(Buffer.concat(chunks).toString()); } catch { refuse('The venue resolution response is not JSON.'); }
  return validateVenueResolution(raw, market, new Date(now()).toISOString());
}
