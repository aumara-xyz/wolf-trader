// Process mode labels for aukora-wolf.
// PAPER is the default. LIVE_TAPE is keyless public data, still paper money.
// LIVE_MONEY is refused in this repo: AUKORA-37 is not here, and this file
// will not invent a grant.

export const MODES = Object.freeze({
  PAPER: 'PAPER',
  LIVE_TAPE: 'LIVE_TAPE',
  LIVE_MONEY: 'LIVE_MONEY',
});

export function resolveMode(env = process.env) {
  const requested = String(env.AUKORA_WOLF_MODE || 'PAPER').trim().toUpperCase() || 'PAPER';
  const shadow = String(env.POLYMARKET_SHADOW || '0') === '1';
  if (requested === 'LIVE_MONEY') {
    return {
      requested,
      mode: 'PAPER',
      refused: 'LIVE_MONEY',
      reason: 'LIVE_MONEY requires an AUKORA-37 grant. That path is absent. No order will be submitted.',
      polymarketSpend: false,
      polymarketShadow: shadow ? 'flag-set-ignored' : false,
      liveTape: false,
    };
  }
  if (requested === 'LIVE_TAPE') {
    return {
      requested,
      mode: 'LIVE_TAPE',
      refused: null,
      reason: 'LIVE_TAPE may read keyless public prices. Money stays paper.',
      polymarketSpend: false,
      polymarketShadow: shadow ? 'flag-set-ignored' : false,
      liveTape: true,
    };
  }
  return {
    requested: 'PAPER',
    mode: 'PAPER',
    refused: requested === 'PAPER' ? null : 'UNKNOWN_MODE',
    reason: requested === 'PAPER'
      ? 'PAPER is the default. Simulated fills, friction on, no wallets, no orders.'
      : `Unknown mode "${requested}" — staying PAPER.`,
    polymarketSpend: false,
    polymarketShadow: shadow ? 'flag-set-ignored' : false,
    liveTape: false,
  };
}

export function printCeilings(mode, governor) {
  const lines = [
    'AUKORA WOLF — ceilings (measured, not promises)',
    `  mode: ${mode.mode} (requested ${mode.requested})`,
    mode.refused ? `  refused: ${mode.refused} — ${mode.reason}` : `  ${mode.reason}`,
    '  LIVE_MONEY: not implemented — AUKORA-37 grant path is absent',
    '  Polymarket spend: off',
    mode.polymarketShadow === 'flag-set-ignored'
      ? '  POLYMARKET_SHADOW=1 is set, and Phase 2 is not built — no shadow orders, no spend'
      : '  Polymarket shadow: off',
    `  kill switch: ${governor.killed ? `TRIPPED (${governor.killReason})` : 'clear'}`,
    `  loss cap: ${governor.maxDailyLossPct}% of session start equity (floor ${governor.floor})`,
    '  friction: fee 10 bps, slip 5 bps (ledger defaults)',
    '  starting paper cash: $10,000',
    '  not investment advice — no guaranteed returns',
    '  evidence / model speech never authorizes a live order',
  ];
  return lines;
}
