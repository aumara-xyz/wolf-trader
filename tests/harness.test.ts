import { describe, expect, it } from 'vitest';
import { resolveMode, printCeilings, createGovernor, throttleKappa, brierScore, expectedCalibrationError } from '../packages/harness/index.js';
import { parseMindReceipts } from '../packages/engines/wolf-mind-story.js';

describe('mode ceilings', () => {
  it('defaults to PAPER and prints the ceilings', () => {
    const mode = resolveMode({});
    expect(mode.mode).toBe('PAPER');
    expect(mode.polymarketSpend).toBe(false);
    const gov = createGovernor({ maxDailyLossPct: 5, env: {} });
    const text = printCeilings(mode, gov).join('\n');
    expect(text).toContain('PAPER');
    expect(text).toContain('AUKORA-37');
    expect(text).toContain('Polymarket spend: off');
    expect(text).toContain('not investment advice');
  });

  it('refuses LIVE_MONEY instead of inventing a grant', () => {
    const mode = resolveMode({ AUKORA_WOLF_MODE: 'LIVE_MONEY' });
    expect(mode.requested).toBe('LIVE_MONEY');
    expect(mode.mode).toBe('PAPER');
    expect(mode.refused).toBe('LIVE_MONEY');
    expect(mode.polymarketSpend).toBe(false);
  });

  it('LIVE_TAPE stays paper money', () => {
    const mode = resolveMode({ AUKORA_WOLF_MODE: 'LIVE_TAPE' });
    expect(mode.mode).toBe('LIVE_TAPE');
    expect(mode.liveTape).toBe(true);
    expect(mode.polymarketSpend).toBe(false);
  });

  it('a set shadow flag does not turn spend on', () => {
    const mode = resolveMode({ POLYMARKET_SHADOW: '1' });
    expect(mode.polymarketSpend).toBe(false);
    expect(mode.polymarketShadow).toBe('flag-set-ignored');
  });
});

describe('process kill switch and loss cap', () => {
  it('trips from the env flag and from a breached floor', () => {
    const armed = createGovernor({ env: { AUKORA_WOLF_KILL: '1' } });
    expect(armed.killed).toBe(true);
    const gov = createGovernor({ maxDailyLossPct: 1, startEquity: 10_000, env: {} });
    expect(gov.floor).toBeCloseTo(9900, 6);
    expect(gov.killed).toBe(false);
    gov.noteEquity(9900);
    expect(gov.killed).toBe(true);
    expect(gov.killReason).toContain('loss cap');
  });
});

describe('ECE / Brier throttle', () => {
  it('an empty sample does not claim κ = 1', () => {
    const k = throttleKappa([]);
    expect(k.kappa).toBe(0.25);
    expect(k.ece).toBeNull();
  });

  it('a badly calibrated sample throttles harder than a sharp one', () => {
    const sharp = Array.from({ length: 20 }, (_, i) => ({ p: i < 10 ? 0.2 : 0.8, y: (i < 10 ? 0 : 1) as 0 | 1 }));
    const bad = Array.from({ length: 20 }, () => ({ p: 0.9, y: 0 as const }));
    const a = throttleKappa(sharp);
    const b = throttleKappa(bad);
    expect(brierScore(bad)).toBeGreaterThan(0.6);
    expect(expectedCalibrationError(bad)!).toBeGreaterThan(expectedCalibrationError(sharp)!);
    expect(b.kappa).toBeLessThan(a.kappa);
    expect(b.kappa).toBeGreaterThanOrEqual(0.05);
    expect(b.kappa).toBeLessThanOrEqual(1);
  });
});

describe('storyteller honesty floor', () => {
  it('refuses a receipt that claims a live brokerage', () => {
    const r = parseMindReceipts(JSON.stringify({ kind: 'start', mode: 'LIVE TRADING · real brokerage' }));
    expect(r.ok).toBe(false);
  });
});
