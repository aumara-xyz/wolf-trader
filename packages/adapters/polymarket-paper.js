// Manual paper ticket against a witnessed Polymarket quote.
// The gate may allow paper. It never receives or emits live order bytes.

import { decideGate, GATE_SCHEMA } from '../seats/gate.js';
import { POLY_SOURCE } from './polymarket-public.js';

export const PAPER_THESIS_SCHEMA = 'aukora-wolf-macro-thesis-v1';
export const PAPER_STUB_CONFIDENCE = 0.55;

const ADVERSE_PCT = 0.02;
const FEE_RATE = 0.001;

export function paperThesis({ symbol, question, outcome, price }) {
  return {
    schema: PAPER_THESIS_SCHEMA,
    id: `paper-${symbol}`,
    at: new Date().toISOString(),
    symbol,
    horizon: 'session',
    claim: 'Paper long. This note does not authorize an order.',
    confidence: PAPER_STUB_CONFIDENCE,
    direction: 'up',
    vol: 0.04,
    drift: 0,
    totalReturn: 0,
    evidence: {
      source: POLY_SOURCE,
      question: question || '',
      outcome: outcome || '',
      price: Number(price),
    },
    invalidation: null,
    maxAllocation: null,
    authorizesLiveOrder: false,
    mode: 'PAPER',
  };
}

function refused(mode) {
  return mode?.polymarketSpend === true || mode?.refused === 'LIVE_MONEY' || mode?.requested === 'LIVE_MONEY';
}

export function submitPaperBuy({ ledger, governor, mode, kappa, thesis, quote, dollars, marks }) {
  if (refused(mode)) return { ok: false, reason: 'refused' };
  if (!quote?.provenance || quote.provenance.source !== POLY_SOURCE) return { ok: false, reason: 'price uncertain' };
  if (thesis?.schema !== PAPER_THESIS_SCHEMA || thesis.authorizesLiveOrder === true) return { ok: false, reason: 'denied' };
  if (governor?.killed) return { ok: false, reason: 'killed' };
  const decision = decideGate({ thesis, governor, kappa, mode });
  if (decision.schema !== GATE_SCHEMA || decision.liveOrder !== false || decision.orderBytes != null) {
    return { ok: false, reason: 'refused', decision };
  }
  if (decision.decision !== 'PAPER_ALLOW') return { ok: false, reason: 'denied', decision };
  const marked = { ...marks, [quote.symbol]: quote.price };
  governor.noteEquity(ledger.equity(marked));
  if (governor.killed) return { ok: false, reason: 'killed', decision };
  const room = governor.room(ledger.equity(marked));
  const maxNotional = room / (ADVERSE_PCT + FEE_RATE);
  const amt = Math.min(Number(dollars), maxNotional, ledger.cash);
  if (!(amt > 0)) return { ok: false, reason: 'capped', decision };
  const fill = ledger.buy(quote, amt);
  if (!fill.ok) return { ok: false, reason: 'no fill', decision };
  governor.noteEquity(ledger.equity(marked));
  return { ok: true, dollars: amt, fill, decision, audit: ledger.audit() };
}

export function submitPaperClose({ ledger, governor, quote, marks }) {
  if (governor?.killed) return { ok: false, reason: 'killed' };
  if (!quote?.provenance || quote.provenance.source !== POLY_SOURCE) return { ok: false, reason: 'price uncertain' };
  const fill = ledger.sell(quote, 1);
  if (!fill.ok) return { ok: false, reason: 'no fill' };
  const marked = { ...marks };
  delete marked[quote.symbol];
  governor.noteEquity(ledger.equity(marked));
  return { ok: true, fill, audit: ledger.audit() };
}
