// In-process kill switch and loss cap. These live in the process, not in a prompt.
// A tripped governor refuses further paper fills. It cannot grant live money.

export function createGovernor(opts = {}) {
  const maxDailyLossPct = Number.isFinite(opts.maxDailyLossPct) ? opts.maxDailyLossPct : 5;
  const startEquity = Number.isFinite(opts.startEquity) ? opts.startEquity : 10_000;
  const envKill = opts.env ? opts.env.AUKORA_WOLF_KILL === '1' : process.env.AUKORA_WOLF_KILL === '1';
  let killed = Boolean(opts.killed) || envKill;
  let killReason = killed ? (opts.killReason || (envKill ? 'AUKORA_WOLF_KILL=1' : 'kill switch set at start')) : null;
  const floor = startEquity * (1 - maxDailyLossPct / 100);

  return {
    maxDailyLossPct,
    startEquity,
    floor,
    get killed() { return killed; },
    get killReason() { return killReason; },
    room(equity) {
      return equity - floor;
    },
    kill(reason) {
      killed = true;
      killReason = reason || 'killed';
    },
    noteEquity(equity) {
      if (equity <= floor + 1e-6) this.kill(`loss cap: equity ${equity} <= floor ${floor}`);
    },
  };
}
