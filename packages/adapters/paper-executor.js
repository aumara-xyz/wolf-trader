// Paper executor. Sizing is applied here, behind the process loss cap.
// There is no submit path, no order bytes, and no wallet.

export const FILL_SCHEMA = 'aukora-wolf-paper-fill-v1';

export function executePaper({ decision, quote, ledger, governor, adversePct = 0.02, feeBps = 10 }) {
  if (!decision || decision.schema !== 'aukora-wolf-gate-decision-v1') {
    return { ok: false, reason: 'missing gate decision' };
  }
  if (decision.liveOrder || decision.orderBytes != null) {
    return { ok: false, reason: 'paper executor refuses live orders and order bytes' };
  }
  if (governor?.killed) return { ok: false, reason: governor.killReason || 'kill switch' };
  if (decision.decision !== 'PAPER_ALLOW') return { ok: false, reason: decision.reason || 'gate denied' };
  const mark = { [quote.symbol]: quote.price };
  const equity = ledger.equity(mark);
  const room = governor.room(equity);
  if (!(room > 0)) {
    governor.kill('loss cap already breached');
    return { ok: false, reason: governor.killReason };
  }
  const feeRate = feeBps / 10_000;
  const maxNotional = room / (adversePct + feeRate);
  const requested = ledger.cash * decision.sizeFrac;
  const dollars = Math.min(requested, maxNotional, ledger.cash);
  if (!(dollars > 0)) return { ok: false, reason: 'size is zero after the loss cap' };
  const fill = ledger.buy(quote, dollars);
  if (!fill.ok) return { ok: false, reason: fill.reason, dollars };
  governor.noteEquity(ledger.equity(mark));
  const receipt = {
    schema: FILL_SCHEMA,
    mode: 'PAPER',
    thesisId: decision.thesisId,
    gateId: decision.id,
    symbol: quote.symbol,
    side: 'buy',
    dollars,
    qty: fill.qty,
    execPx: fill.execPx,
    fee: fill.fee,
    kappa: decision.kappa,
    sizeFrac: decision.sizeFrac,
    maxNotional,
    lossCapPct: governor.maxDailyLossPct,
    provenance: quote.provenance,
    liveOrder: false,
    orderBytes: null,
    polymarketSpend: false,
  };
  return { ok: true, dollars, fill, receipt, audit: ledger.audit() };
}
