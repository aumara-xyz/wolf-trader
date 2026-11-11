import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSignalBus } from '../packages/bus/signal-bus.js';
import { observeTape, THESIS_STUB_CONFIDENCE } from '../packages/seats/research.js';
import { decideGate } from '../packages/seats/gate.js';
import { executePaper } from '../packages/adapters/paper-executor.js';
import { createGovernor, resolveMode, throttleKappa } from '../packages/harness/index.js';
import { createLedger, STARTING_CASH } from '../packages/engines/wolf-ledger.js';

function upThesis() {
  for (let seed = 1; seed <= 40; seed++) {
    const observed = observeTape({ seed, symbol: 'RUT', ticks: 80 });
    if (observed.thesis.direction === 'up') return observed;
  }
  throw new Error('no up tape in seeds 1..40');
}

describe('research seat', () => {
  it('emits a paper thesis that cannot authorize a live order', () => {
    const { thesis } = observeTape({ seed: 7, symbol: 'LUM', ticks: 40 });
    expect(thesis.schema).toBe('aukora-wolf-macro-thesis-v1');
    expect(thesis.authorizesLiveOrder).toBe(false);
    expect(thesis.mode).toBe('PAPER');
    expect(thesis.confidence).toBe(THESIS_STUB_CONFIDENCE);
    expect(thesis.claim).toContain('does not authorize');
    expect(['up', 'down', 'flat']).toContain(thesis.direction);
  });

  it('is deterministic for the same seed', () => {
    const a = observeTape({ seed: 4, symbol: 'KNV', ticks: 30 });
    const b = observeTape({ seed: 4, symbol: 'KNV', ticks: 30 });
    expect(a.thesis).toEqual(b.thesis);
    expect(a.quote.price).toBe(b.quote.price);
  });
});

describe('signal bus', () => {
  it('round-trips thesis and gate records on files, and mirrors redis', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-bus-'));
    const redisRows: string[] = [];
    const redis = {
      async rpush(_key: string, value: string) { redisRows.push(value); return redisRows.length; },
      async lrange() { return redisRows; },
    };
    const bus = createSignalBus({ dir, redis });
    const { thesis } = observeTape({ seed: 3, symbol: 'RUT', ticks: 20 });
    await bus.append('thesis', thesis);
    const back = await bus.read('thesis');
    expect(back).toEqual([thesis]);
    expect(JSON.parse(redisRows[0]).id).toBe(thesis.id);
    expect(fs.existsSync(path.join(dir, 'thesis.jsonl'))).toBe(true);
  });

  it('refuses wallet and API secret fields', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-bus-'));
    const bus = createSignalBus({ dir });
    await expect(bus.append('fills', { privateKey: 'nope' })).rejects.toThrow(/refusing field/);
    await expect(bus.append('fills', { nested: { apiKey: 'sk' } })).rejects.toThrow(/refusing field/);
  });
});

describe('gate', () => {
  it('denies model speech that claims to authorize a live order', () => {
    const { thesis } = upThesis();
    const poisoned = { ...thesis, authorizesLiveOrder: true };
    const d = decideGate({
      thesis: poisoned,
      governor: createGovernor({ env: {} }),
      kappa: 1,
      mode: resolveMode({}),
    });
    expect(d.decision).toBe('DENY');
    expect(d.reason).toContain('cannot authorize');
    expect(d.liveOrder).toBe(false);
    expect(d.orderBytes).toBeNull();
  });

  it('denies LIVE_MONEY and a tripped kill switch', () => {
    const { thesis } = upThesis();
    const live = decideGate({
      thesis,
      governor: createGovernor({ env: {} }),
      kappa: 1,
      mode: resolveMode({ AUKORA_WOLF_MODE: 'LIVE_MONEY' }),
    });
    expect(live.decision).toBe('DENY');
    expect(live.reason).toContain('AUKORA-37');
    const killed = decideGate({
      thesis,
      governor: createGovernor({ killed: true, killReason: 'drill', env: {} }),
      kappa: 1,
      mode: resolveMode({}),
    });
    expect(killed.decision).toBe('DENY');
  });

  it('scales paper size with κ', () => {
    const { thesis } = upThesis();
    const gov = createGovernor({ env: {} });
    const mode = resolveMode({});
    const full = decideGate({ thesis, governor: gov, kappa: 1, mode });
    const tenth = decideGate({ thesis, governor: gov, kappa: 0.1, mode });
    expect(full.decision).toBe('PAPER_ALLOW');
    expect(tenth.decision).toBe('PAPER_ALLOW');
    expect(tenth.sizeFrac).toBeCloseTo(full.sizeFrac * 0.1, 8);
    expect(full.liveOrder).toBe(false);
  });
});

describe('paper executor', () => {
  it('fills behind the loss cap and audits clean', () => {
    const { thesis, quote } = upThesis();
    const governor = createGovernor({ maxDailyLossPct: 5, env: {} });
    const decision = decideGate({ thesis, governor, kappa: throttleKappa([]).kappa, mode: resolveMode({}) });
    expect(decision.decision).toBe('PAPER_ALLOW');
    const ledger = createLedger();
    const result = executePaper({ decision, quote, ledger, governor });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dollars).toBeLessThan(STARTING_CASH * decision.sizeFrac + 1e-6);
    expect(result.dollars).toBeGreaterThan(0);
    expect(result.receipt.mode).toBe('PAPER');
    expect(result.receipt.polymarketSpend).toBe(false);
    expect(result.receipt.orderBytes).toBeNull();
    expect(JSON.stringify(result.receipt)).not.toMatch(/privateKey|apiKey|mnemonic/);
    expect(result.audit.ok).toBe(true);
  });

  it('clamps notional so one adverse move stays inside a tight loss cap', () => {
    const { quote } = upThesis();
    const governor = createGovernor({ maxDailyLossPct: 0.2, startEquity: STARTING_CASH, env: {} });
    const decision = {
      schema: 'aukora-wolf-gate-decision-v1',
      id: 'gate-drill',
      thesisId: 'thesis-drill',
      decision: 'PAPER_ALLOW',
      reason: 'drill',
      sizeFrac: 0.75,
      kappa: 1,
      side: 'buy',
      liveOrder: false,
      orderBytes: null,
      aukora37: 'ABSENT',
    };
    const ledger = createLedger();
    const result = executePaper({ decision, quote, ledger, governor, adversePct: 0.02, feeBps: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const room = STARTING_CASH * 0.002;
    const maxNotional = room / (0.02 + 0.001);
    expect(result.dollars).toBeLessThanOrEqual(maxNotional + 1e-6);
    expect(result.dollars).toBeLessThan(STARTING_CASH * 0.75);
  });

  it('refuses order bytes even when the decision says paper allow', () => {
    const { quote } = upThesis();
    const governor = createGovernor({ env: {} });
    const ledger = createLedger();
    const result = executePaper({
      decision: {
        schema: 'aukora-wolf-gate-decision-v1',
        id: 'g',
        thesisId: 't',
        decision: 'PAPER_ALLOW',
        sizeFrac: 0.1,
        kappa: 1,
        liveOrder: false,
        orderBytes: '0xdead',
      },
      quote,
      ledger,
      governor,
    });
    expect(result.ok).toBe(false);
    expect(ledger.cash).toBe(STARTING_CASH);
  });
});
