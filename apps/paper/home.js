import { createLedger, isValidLedger, STARTING_CASH } from '/packages/engines/wolf-ledger.js';
import { createGovernor } from '/packages/harness/governor.js';
import { throttleKappa } from '/packages/harness/calibration.js';
import { fetchBook, listMarkets, paperQuote, searchMarkets } from '/packages/adapters/polymarket-public.js';
import { paperThesis, submitPaperBuy, submitPaperClose } from '/packages/adapters/polymarket-paper.js';

const LS = 'aukora-paper-ledger-v1';
const CHIPS = [100, 500, 1000];
const root = document.getElementById('app');

const ceilings = await fetch('/api/ceilings').then((r) => r.json()).catch(() => ({
  mode: 'PAPER',
  requested: 'PAPER',
  refused: null,
  polymarketSpend: false,
  killed: false,
  maxDailyLossPct: 5,
  startEquity: STARTING_CASH,
}));

const mode = {
  requested: ceilings.requested || 'PAPER',
  mode: ceilings.mode === 'LIVE_TAPE' ? 'LIVE_TAPE' : 'PAPER',
  refused: ceilings.refused || null,
  polymarketSpend: false,
};

function loadLedger() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS) || 'null');
    return createLedger(isValidLedger(parsed) ? parsed : undefined);
  } catch {
    return createLedger();
  }
}

const ledger = loadLedger();
const governor = createGovernor({
  env: {},
  killed: Boolean(ceilings.killed),
  killReason: ceilings.killReason || undefined,
  maxDailyLossPct: Number(ceilings.maxDailyLossPct) || 5,
  startEquity: Number(ceilings.startEquity) || STARTING_CASH,
});
const kappa = throttleKappa([]).kappa;

let markets = [];
let selected = null;
let outcome = 'YES';
let size = CHIPS[0];
let custom = '';
let busy = false;
let status = '';
let priceLine = '';
let loaded = false;
const marks = {};
const catalog = new Map();

function money(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cents(p) {
  return `${(Number(p) * 100).toFixed(1)}¢`;
}

function qty(n) {
  if (!Number.isFinite(n)) return '—';
  return n >= 100 ? n.toFixed(1) : n.toFixed(2);
}

function pnl(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 0.005) return money(0);
  return `${v > 0 ? '+' : '-'}${money(Math.abs(v)).slice(1)}`;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function persist() {
  localStorage.setItem(LS, JSON.stringify(ledger.toJSON()));
}

function questionFor(symbol) {
  for (const row of ledger.timeline) {
    if (row.symbol === symbol && row.provenance?.question) return row.provenance.question;
  }
  const hit = markets.find((m) => `pm:${m.id}:YES` === symbol || `pm:${m.id}:NO` === symbol);
  return hit ? hit.question : symbol;
}

function outcomeFor(symbol, row) {
  if (row?.provenance?.outcome) return row.provenance.outcome;
  return symbol.endsWith(':NO') ? 'NO' : 'YES';
}

function seedMarks() {
  for (const row of [...ledger.timeline].reverse()) {
    if ((row.kind === 'buy' || row.kind === 'sell') && row.symbol && Number.isFinite(row.price)) {
      marks[row.symbol] = row.price;
    }
  }
}
seedMarks();

function equity() {
  return ledger.equity(marks);
}

const header = el('header', 'top');
const equityEl = el('b', 'num', '');
const killBtn = el('button', 'kill', 'Kill');
const auditBtn = el('button', 'quiet', 'Audit');
const resetBtn = el('button', 'quiet', 'Reset');
header.append(el('div', 'brand', 'WOLF'), el('div', 'pill', 'PAPER'), el('span', 'grow'), equityEl, auditBtn, resetBtn, killBtn);

const hero = el('section', 'hero');
const cashEl = el('b', null, '');
const eqEl = el('b', null, '');
const pnlEl = el('b', null, '');
for (const [node, label] of [[cashEl, 'Cash'], [eqEl, 'Equity'], [pnlEl, 'Session P&L']]) {
  const cell = el('div');
  cell.append(node, el('span', null, label));
  hero.append(cell);
}

const search = el('input', 'search');
search.type = 'search';
search.placeholder = 'Search';
search.autocomplete = 'off';
const list = el('div', 'list');
const picked = el('p', 'picked', '');
const trade = el('div', 'trade');
const yesBtn = el('button', 'side', 'Yes');
const noBtn = el('button', 'side', 'No');
yesBtn.type = 'button';
noBtn.type = 'button';
const chips = CHIPS.map((n) => {
  const b = el('button', 'chip', `$${n}`);
  b.type = 'button';
  b.addEventListener('click', () => { size = n; custom = ''; customInput.value = ''; render(); });
  return b;
});
const customInput = el('input', 'custom');
customInput.inputMode = 'decimal';
customInput.placeholder = 'Custom';
customInput.addEventListener('input', () => { custom = customInput.value; render(); });
const buyBtn = el('button', 'primary', 'Paper buy');
buyBtn.type = 'button';
trade.append(yesBtn, noBtn, ...chips, customInput, buyBtn);
const statusEl = el('p', 'status');
const priceEl = el('p', 'line');

const posHead = el('h2', null, 'Positions');
const posHost = el('div');
const actHead = el('h2', null, 'Activity');
const actHost = el('div');
const foot = el('p', 'foot');
const about = el('a', null, 'About');
about.href = '/about';
foot.append(about);

root.append(header, hero, search, list, picked, priceEl, trade, statusEl, posHead, posHost, actHead, actHost, foot);

function dollars() {
  if (custom.trim()) {
    const n = Number(custom);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return size;
}

function renderPositions() {
  posHost.replaceChildren();
  const entries = Object.entries(ledger.positions);
  if (!entries.length) {
    posHost.append(el('p', 'empty', 'Flat.'));
    return;
  }
  const table = el('table');
  const head = el('tr');
  for (const label of ['Market', 'Qty', 'Value', '']) head.append(el('th', null, label));
  table.append(head);
  for (const [symbol, pos] of entries) {
    const tr = el('tr');
    const mark = marks[symbol];
    const value = Number.isFinite(mark) ? pos.qty * mark : 0;
    tr.append(el('td', 'q', `${questionFor(symbol)} · ${outcomeFor(symbol)}`), el('td', null, qty(pos.qty)), el('td', null, Number.isFinite(mark) ? money(value) : '—'));
    const close = el('button', 'close', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => closePosition(symbol));
    const td = el('td');
    td.append(close);
    tr.append(td);
    table.append(tr);
  }
  posHost.append(table);
}

function renderActivity() {
  actHost.replaceChildren();
  const table = el('table');
  const head = el('tr');
  for (const label of ['Time', 'Action', 'Amount', 'Market', '']) head.append(el('th', null, label));
  table.append(head);
  for (const row of ledger.timeline) {
    const tr = el('tr');
    const when = row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    let action = row.kind || '';
    let amount = '';
    let market = '';
    let tag = '';
    if (row.kind === 'buy' || row.kind === 'sell') {
      const side = outcomeFor(row.symbol, row);
      action = `${row.kind === 'buy' ? 'Buy' : 'Sell'} ${side}`;
      amount = money(row.dollars);
      market = row.provenance?.question || questionFor(row.symbol);
      tag = String(row.provenance?.source || '').includes('POLYMARKET') ? 'POLY' : '';
    } else if (row.kind === 'genesis') {
      action = 'Open';
      amount = money(STARTING_CASH);
    } else if (row.kind === 'reset') {
      action = 'Reset';
    } else {
      continue;
    }
    tr.append(el('td', null, when), el('td', null, action), el('td', null, amount), el('td', 'q', market));
    const td = el('td');
    if (tag) td.append(el('span', 'tag', tag));
    tr.append(td);
    table.append(tr);
  }
  actHost.append(table);
}

function renderList() {
  list.replaceChildren();
  if (!loaded) return;
  if (!markets.length) {
    list.append(el('p', 'empty', 'None'));
    return;
  }
  for (const market of markets) {
    const btn = el('button', 'market');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', selected?.id === market.id ? 'true' : 'false');
    const title = el('b', null, market.question);
    const yes = el('span', 'px', `Yes ${cents(market.yes)}`);
    const no = el('span', 'px no', `No ${cents(market.no)}`);
    btn.append(title, yes, no);
    btn.addEventListener('click', () => { selected = market; priceLine = ''; refreshQuote(); render(); });
    list.append(btn);
  }
}

function render() {
  const eq = equity();
  equityEl.textContent = money(eq);
  cashEl.textContent = money(ledger.cash);
  eqEl.textContent = money(eq);
  pnlEl.textContent = pnl(eq - STARTING_CASH);
  killBtn.textContent = governor.killed ? 'Killed' : 'Kill';
  killBtn.setAttribute('aria-pressed', governor.killed ? 'true' : 'false');
  yesBtn.setAttribute('aria-pressed', outcome === 'YES' ? 'true' : 'false');
  noBtn.setAttribute('aria-pressed', outcome === 'NO' ? 'true' : 'false');
  chips.forEach((btn, i) => btn.setAttribute('aria-pressed', !custom.trim() && size === CHIPS[i] ? 'true' : 'false'));
  picked.textContent = selected ? selected.question : '';
  priceEl.textContent = priceLine;
  statusEl.textContent = status;
  buyBtn.disabled = busy || !selected || governor.killed;
  renderList();
  renderPositions();
  renderActivity();
}

async function refreshQuote() {
  if (!selected) { priceLine = ''; return; }
  const market = selected;
  const side = outcome;
  const book = await fetchBook(side === 'NO' ? market.noToken : market.yesToken);
  if (selected !== market || outcome !== side) return;
  const quoted = paperQuote({ market, outcome: side, book });
  priceLine = quoted.ok ? cents(quoted.quote.price) : 'price uncertain';
  if (quoted.ok) marks[quoted.quote.symbol] = quoted.quote.price;
  render();
}

async function paperBuy() {
  if (!selected || busy || governor.killed) return;
  const amt = dollars();
  if (!(amt > 0)) { status = 'No fill'; render(); return; }
  busy = true;
  status = '';
  render();
  const market = selected;
  const side = outcome;
  const book = await fetchBook(side === 'NO' ? market.noToken : market.yesToken);
  const quoted = paperQuote({ market, outcome: side, book });
  if (!quoted.ok) {
    priceLine = 'price uncertain';
    status = 'price uncertain';
    busy = false;
    render();
    return;
  }
  const quote = quoted.quote;
  marks[quote.symbol] = quote.price;
  priceLine = cents(quote.price);
  const thesis = paperThesis({ symbol: quote.symbol, question: market.question, outcome: side, price: quote.price });
  const result = submitPaperBuy({ ledger, governor, mode, kappa, thesis, quote, dollars: amt, marks });
  if (!result.ok) {
    status = result.reason === 'killed' ? 'Killed' : result.reason === 'price uncertain' ? 'price uncertain' : result.reason === 'denied' || result.reason === 'refused' ? 'Denied' : result.reason === 'capped' ? 'Capped' : 'No fill';
  } else {
    status = '';
    persist();
  }
  busy = false;
  render();
}

async function closePosition(symbol) {
  if (busy || governor.killed) { status = governor.killed ? 'Killed' : status; render(); return; }
  const id = symbol.split(':')[1];
  const market = catalog.get(id) || markets.find((m) => m.id === id);
  const side = symbol.endsWith(':NO') ? 'NO' : 'YES';
  if (!market) { status = 'price uncertain'; render(); return; }
  busy = true;
  render();
  const book = await fetchBook(side === 'NO' ? market.noToken : market.yesToken);
  const quoted = paperQuote({ market, outcome: side, book });
  if (!quoted.ok) {
    status = 'price uncertain';
    busy = false;
    render();
    return;
  }
  const result = submitPaperClose({ ledger, governor, quote: quoted.quote, marks });
  if (!result.ok) status = result.reason === 'killed' ? 'Killed' : 'price uncertain';
  else { status = ''; persist(); }
  busy = false;
  render();
}

killBtn.addEventListener('click', () => {
  if (!governor.killed) governor.kill('kill switch');
  status = governor.killed ? 'Killed' : '';
  render();
});

auditBtn.addEventListener('click', () => {
  const report = ledger.audit();
  status = report.ok ? 'Clean' : 'Fail';
  render();
});

resetBtn.addEventListener('click', () => {
  ledger.reset();
  for (const key of Object.keys(marks)) delete marks[key];
  persist();
  status = '';
  render();
});

yesBtn.addEventListener('click', () => { outcome = 'YES'; refreshQuote(); render(); });
noBtn.addEventListener('click', () => { outcome = 'NO'; refreshQuote(); render(); });
buyBtn.addEventListener('click', () => { paperBuy(); });

let timer = 0;
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(loadMarkets, 250);
});

async function loadMarkets() {
  const q = search.value.trim();
  const res = q.length >= 2 ? await searchMarkets(q) : await listMarkets();
  loaded = true;
  if (!res.ok) {
    markets = [];
    if (!status) status = 'no markets';
  } else {
    markets = res.markets;
    for (const market of markets) catalog.set(market.id, market);
    if (!selected && markets[0]) selected = markets[0];
    if (status === 'no markets') status = '';
  }
  render();
  if (selected) refreshQuote();
}

render();
loadMarkets();
