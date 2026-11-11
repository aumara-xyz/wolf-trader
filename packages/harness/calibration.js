// ECE / Brier stub. κ throttles paper size. An empty sample does not
// pretend to be calibrated: κ stays at 0.25 until there are outcomes.

export const UNTRUSTED_KAPPA = 0.25;

export function brierScore(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  let sum = 0;
  for (const { p, y } of pairs) {
    if (!Number.isFinite(p) || (y !== 0 && y !== 1)) return null;
    sum += (p - y) ** 2;
  }
  return sum / pairs.length;
}

export function expectedCalibrationError(pairs, bins = 10) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const buckets = Array.from({ length: bins }, () => ({ n: 0, conf: 0, acc: 0 }));
  for (const { p, y } of pairs) {
    if (!Number.isFinite(p) || (y !== 0 && y !== 1)) return null;
    const i = Math.min(bins - 1, Math.max(0, Math.floor(Math.min(0.999999, Math.max(0, p)) * bins)));
    buckets[i].n += 1;
    buckets[i].conf += p;
    buckets[i].acc += y;
  }
  let ece = 0;
  const n = pairs.length;
  for (const b of buckets) {
    if (!b.n) continue;
    ece += (b.n / n) * Math.abs(b.acc / b.n - b.conf / b.n);
  }
  return ece;
}

export function throttleKappa(pairs) {
  const ece = expectedCalibrationError(pairs);
  const brier = brierScore(pairs);
  if (ece == null || brier == null) {
    return {
      kappa: UNTRUSTED_KAPPA,
      ece: null,
      brier: null,
      reason: 'no calibration sample — κ held at 0.25 (untrusted), not 1',
    };
  }
  const kappa = Math.min(1, Math.max(0.05, (1 - ece) * (1 - Math.min(1, brier))));
  return {
    kappa,
    ece,
    brier,
    reason: 'κ = clamp((1 − ECE) × (1 − Brier), 0.05, 1)',
  };
}
