#!/usr/bin/env node
// Stranger path: ceilings, one public Polymarket paper fill, audit,
// a refused live-claim receipt, and a refused LIVE_MONEY request.
// Reads Gamma and the public CLOB book. Submits no order. Holds no wallet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMode, createGovernor, printCeilings, throttleKappa } from '../packages/harness/index.js';
import { createSignalBus } from '../packages/bus/signal-bus.js';
import { parseMindReceipts } from '../packages/engines/wolf-mind-story.js';
import { createLedger } from '../packages/engines/wolf-ledger.js';
import { fetchBook, listMarkets, paperQuote } from '../packages/adapters/polymarket-public.js';
import { paperThesis, submitPaperBuy } from '../packages/adapters/polymarket-paper.js';

const mode = resolveMode(process.env);
const governor = createGovernor({ maxDailyLossPct: 5 });
for (const line of printCeilings(mode, governor)) console.log(line);

const busDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-wolf-demo-'));
const bus = createSignalBus({ dir: busDir });
console.log(`\nsignal bus: files at ${busDir}`);
console.log(process.env.REDIS_URL
  ? 'redis: REDIS_URL is set, and this demo does not open a Redis client — files remain the bus'
  : 'redis: not configured — files are the bus');

const cal = throttleKappa([]);
console.log(`calibration: ${cal.reason}; κ=${cal.kappa}`);

const listed = await listMarkets();
if (!listed.ok) {
  console.error(`\nPolymarket read failed closed: ${listed.reason}`);
  process.exit(1);
}

let ticket = null;
for (const market of listed.markets) {
  const book = await fetchBook(market.yesToken);
  if (!book.ok) continue;
  const quoted = paperQuote({ market, outcome: 'YES', book });
  if (!quoted.ok) continue;
  ticket = { market, quote: quoted.quote };
  break;
}
if (!ticket) {
  console.error('\nPolymarket read failed closed: price uncertain');
  process.exit(1);
}

const thesis = paperThesis({
  symbol: ticket.quote.symbol,
  question: ticket.market.question,
  outcome: 'YES',
  price: ticket.quote.price,
});
console.log(`\npaper market: ${ticket.market.question}`);
console.log(`  ${thesis.claim}`);
console.log(`  authorizesLiveOrder=${thesis.authorizesLiveOrder}`);
await bus.append('thesis', thesis);

const ledger = createLedger();
const marks = { [ticket.quote.symbol]: ticket.quote.price };
const result = submitPaperBuy({
  ledger,
  governor,
  mode,
  kappa: cal.kappa,
  thesis,
  quote: ticket.quote,
  dollars: 100,
  marks,
});
if (result.decision) await bus.append('gate', result.decision);
console.log(`\ngate: ${result.decision?.decision || 'none'}`);
if (result.decision) {
  console.log(`  ${result.decision.reason}`);
  console.log(`  liveOrder=${result.decision.liveOrder} orderBytes=${result.decision.orderBytes} aukora37=${result.decision.aukora37}`);
}
console.log('\npaper fill:');
console.log(result.ok ? JSON.stringify({
  ok: true,
  symbol: ticket.quote.symbol,
  dollars: result.dollars,
  price: ticket.quote.price,
  provenance: ticket.quote.provenance.source,
  polymarketSpend: false,
  orderSubmitted: false,
}, null, 2) : result.reason);

const audit = result.audit || ledger.audit();
console.log('\naudit:', JSON.stringify(audit));

const liveClaim = [
  JSON.stringify({ kind: 'start', mode: 'LIVE TRADING · real brokerage', runId: 'nope' }),
  JSON.stringify({ kind: 'summary', mode: 'LIVE TRADING · real brokerage' }),
].join('\n');
const refused = parseMindReceipts(liveClaim);
console.log('\nstoryteller on a live-claim receipt:', refused.ok ? 'ACCEPTED' : refused.reason);

const liveMoney = resolveMode({ ...process.env, AUKORA_WOLF_MODE: 'LIVE_MONEY' });
console.log('\nLIVE_MONEY request:', liveMoney.reason);
console.log('order submission: none');

const view = {
  mode,
  ceilings: printCeilings(mode, governor),
  market: ticket.market.question,
  thesis,
  decision: result.decision || null,
  fill: result.ok ? { dollars: result.dollars, provenance: ticket.quote.provenance } : { ok: false, reason: result.reason },
  audit,
  storytellerRefused: refused,
  liveMoney,
  polymarketSpend: false,
  orderSubmitted: false,
};
const viewPath = path.join(busDir, 'stranger-view.json');
fs.writeFileSync(viewPath, `${JSON.stringify(view, null, 2)}\n`);
console.log(`\nstranger view: ${viewPath}`);

const failed = [];
if (mode.mode !== 'PAPER' && mode.mode !== 'LIVE_TAPE') failed.push('mode');
if (mode.polymarketSpend !== false) failed.push('spend');
if (!result.ok) failed.push('fill');
if (!audit.ok) failed.push('audit');
if (refused.ok) failed.push('storyteller');
if (liveMoney.refused !== 'LIVE_MONEY' || liveMoney.mode !== 'PAPER') failed.push('live-money');
if (thesis.authorizesLiveOrder !== false) failed.push('thesis-auth');
if (!result.decision || result.decision.liveOrder !== false || result.decision.orderBytes != null) failed.push('gate-live');
if (ticket.quote.provenance.source !== 'POLYMARKET · PAPER') failed.push('provenance');
if (failed.length) {
  console.error(`demo failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\npaper demo ok — Polymarket prices, local paper fill, no spend, no live grant');
