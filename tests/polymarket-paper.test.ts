import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bookTop, fetchBook, listMarkets, normalizeMarket, paperQuote, searchMarkets, POLY_SOURCE,
} from '../packages/adapters/polymarket-public.js';
import { paperThesis, submitPaperBuy, PAPER_THESIS_SCHEMA } from '../packages/adapters/polymarket-paper.js';
import { RESEARCH_DISABLED, researchStatus, writeResearchNote } from '../packages/adapters/research-note.js';
import { createLedger } from '../packages/engines/wolf-ledger.js';
import { createGovernor, resolveMode, throttleKappa } from '../packages/harness/index.js';
import { THESIS_SCHEMA } from '../packages/seats/research.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rawMarket = {
  id: '42',
  question: 'Will the sample resolve yes?',
  outcomes: '["Yes","No"]',
  outcomePrices: '["0.52","0.48"]',
  clobTokenIds: '["yes-token","no-token"]',
  bestBid: 0.51,
  bestAsk: 0.53,
  acceptingOrders: true,
  enableOrderBook: true,
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

const market = normalizeMarket(rawMarket)!;

describe('polymarket public reads', () => {
  it('normalizes a binary market and ignores a one-sided book', () => {
    expect(market.yesToken).toBe('yes-token');
    expect(market.yes).toBe(0.52);
    expect(bookTop({ bids: [{ price: '0.001' }], asks: [{ price: '0.999' }] }).ok).toBe(false);
    const top = bookTop({
      bids: [{ price: '0.10' }, { price: '0.51' }],
      asks: [{ price: '0.90' }, { price: '0.53' }],
    });
    expect(top.ok).toBe(true);
    if (top.ok) {
      expect(top.bestBid).toBe(0.51);
      expect(top.bestAsk).toBe(0.53);
      expect(top.mid).toBeCloseTo(0.52, 8);
    }
  });

  it('lists and searches from fixtures, fail closed on garbage', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('/public-search')) {
        return jsonResponse({ events: [{ markets: [rawMarket, { id: 'nope' }] }] });
      }
      if (String(url).includes('/markets')) return jsonResponse([rawMarket, null]);
      return jsonResponse({}, false);
    }) as unknown as typeof fetch;
    const listed = await listMarkets(fetchImpl);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.markets[0].question).toBe(rawMarket.question);
    const found = await searchMarkets('sample', fetchImpl);
    expect(found.ok).toBe(true);
    expect((await listMarkets((async () => { throw new Error('down'); }) as unknown as typeof fetch)).ok).toBe(false);
    expect((await fetchBook('yes-token', (async () => jsonResponse({ bids: [], asks: [] })) as unknown as typeof fetch)).ok).toBe(false);
  });

  it('settles at the ask only when Gamma and the book agree', () => {
    const book = { ok: true as const, bestBid: 0.51, bestAsk: 0.53, mid: 0.52 };
    const agreed = paperQuote({ market, outcome: 'YES', book });
    expect(agreed.ok).toBe(true);
    if (agreed.ok) {
      expect(agreed.quote.price).toBe(0.53);
      expect(agreed.quote.symbol).toBe('pm:42:YES');
      expect(agreed.quote.provenance.source).toBe(POLY_SOURCE);
      expect(agreed.quote.provenance).not.toHaveProperty('orderBytes');
    }
    const far = paperQuote({ market, outcome: 'YES', book: { ...book, mid: 0.7, bestAsk: 0.71, bestBid: 0.69 } });
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.reason).toBe('price uncertain');
    expect(paperQuote({ market, outcome: 'YES', book: { ok: false, reason: 'price uncertain' } }).ok).toBe(false);
  });

  it('has no order submission surface', () => {
    const src = fs.readFileSync(path.join(root, 'packages/adapters/polymarket-public.js'), 'utf8');
    expect(src).not.toMatch(/\/order\b/);
    expect(src).not.toMatch(/privateKey|apiSecret|mnemonic|walletSeed/i);
    const home = fs.readFileSync(path.join(root, 'apps/paper/home.js'), 'utf8');
    expect(home).not.toMatch(/THE DEN|THE PACK|THE MIND|burning a hole|fictional instruments/);
    const about = fs.readFileSync(path.join(root, 'apps/paper/about.html'), 'utf8');
    expect(about).not.toMatch(/THE DEN|THE PACK|THE MIND/);
    const serve = fs.readFileSync(path.join(root, 'scripts/serve-ui.mjs'), 'utf8');
    expect(serve).not.toContain('wolf-ui');
    expect(serve).toContain('/about');
    expect(serve).toContain('127.0.0.1');
  });
});

describe('polymarket paper ticket', () => {
  it('buys through the gate and the ledger, and never sets live bytes', () => {
    expect(PAPER_THESIS_SCHEMA).toBe(THESIS_SCHEMA);
    const quoted = paperQuote({
      market,
      outcome: 'YES',
      book: { ok: true, bestBid: 0.51, bestAsk: 0.53, mid: 0.52 },
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    const thesis = paperThesis({
      symbol: quoted.quote.symbol,
      question: market.question,
      outcome: 'YES',
      price: quoted.quote.price,
    });
    expect(thesis.authorizesLiveOrder).toBe(false);
    const governor = createGovernor({ env: {} });
    const mode = resolveMode({});
    const ledger = createLedger();
    const bought = submitPaperBuy({
      ledger,
      governor,
      mode,
      kappa: throttleKappa([]).kappa,
      thesis,
      quote: quoted.quote,
      dollars: 100,
      marks: {},
    });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.decision.decision).toBe('PAPER_ALLOW');
    expect(bought.decision.liveOrder).toBe(false);
    expect(bought.decision.orderBytes).toBeNull();
    expect(bought.audit.ok).toBe(true);
    expect(ledger.cash).toBeLessThan(10_000);
    expect(ledger.positions[quoted.quote.symbol].qty).toBeGreaterThan(0);
    const killed = createGovernor({ killed: true, killReason: 'drill', env: {} });
    const blocked = submitPaperBuy({
      ledger: createLedger(),
      governor: killed,
      mode,
      kappa: 1,
      thesis,
      quote: quoted.quote,
      dollars: 100,
      marks: {},
    });
    expect(blocked.ok).toBe(false);
  });
});

describe('research note', () => {
  it('stays disabled without a key and does not invent a note', async () => {
    expect(researchStatus({}).enabled).toBe(false);
    expect(researchStatus({}).reason).toBe(RESEARCH_DISABLED);
    const note = await writeResearchNote({ question: 'Q', outcome: 'YES', price: 0.4 }, {});
    expect(note.ok).toBe(false);
    if (!note.ok) expect(note.reason).toBe(RESEARCH_DISABLED);
  });

  it('keeps a model note off the live-order bit', async () => {
    const fetchImpl = (async () => jsonResponse({
      choices: [{ message: { content: '{"invalidation":"two closes the other way","maxAllocation":0.9,"authorizesLiveOrder":true}' } }],
    })) as unknown as typeof fetch;
    const note = await writeResearchNote(
      { question: 'Q', outcome: 'YES', price: 0.4, symbol: 'pm:42:YES' },
      { OPENROUTER_API_KEY: 'test-key' },
      fetchImpl,
    );
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.note.authorizesLiveOrder).toBe(false);
    expect(note.note.invalidation).toContain('two closes');
    expect(note.note.maxAllocation).toBeLessThanOrEqual(0.25);
  });
});
