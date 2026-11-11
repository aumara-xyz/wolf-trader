// Gate stub. A thesis may be allowed onto the paper book. It can never
// become a live order. Model speech that claims to authorize a live order
// is denied. LIVE_MONEY is denied because AUKORA-37 is absent.

export const GATE_SCHEMA = 'aukora-wolf-gate-decision-v1';

export function decideGate({ thesis, governor, kappa, mode }) {
  const k = Number.isFinite(kappa) ? Math.min(1, Math.max(0, kappa)) : 0;
  const base = {
    schema: GATE_SCHEMA,
    id: `gate-${thesis?.id ?? 'none'}`,
    thesisId: thesis?.id ?? null,
    kappa: k,
    liveOrder: false,
    orderBytes: null,
    aukora37: 'ABSENT',
    sizeFrac: 0,
    side: null,
  };
  const deny = (reason) => ({ ...base, decision: 'DENY', reason });
  if (!thesis || thesis.schema !== 'aukora-wolf-macro-thesis-v1') return deny('not a macro thesis');
  if (thesis.authorizesLiveOrder === true) return deny('model speech cannot authorize a live order');
  if (mode?.refused === 'LIVE_MONEY' || mode?.requested === 'LIVE_MONEY') {
    return deny('LIVE_MONEY requires AUKORA-37; no grant exists in this process');
  }
  if (governor?.killed) return deny(governor.killReason || 'kill switch');
  if (thesis.direction === 'down') return deny('long-only book never shorts; down thesis stays observation');
  if (thesis.direction !== 'up') return deny('no directional claim — no order');
  const kelly = Math.max(0, Math.min(0.25, 2 * Number(thesis.confidence) - 1));
  const vol = Number(thesis.vol);
  const volFrac = Number.isFinite(vol) && vol > 0 ? Math.min(0.25, 0.01 / vol) : 0;
  const sizeFrac = Math.min(kelly, volFrac) * k;
  if (!(sizeFrac > 0)) return deny('size collapsed to zero after Kelly, vol, and κ');
  return {
    ...base,
    decision: 'PAPER_ALLOW',
    reason: `paper allow: size ${(sizeFrac * 100).toFixed(2)}% of cash after Kelly, vol target, and κ; the executor still clamps to the loss cap`,
    sizeFrac,
    side: 'buy',
  };
}
