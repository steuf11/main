import { WalletStats } from "./types";

/**
 * consistencyScore: approaches 1 when monthly profits have low variance.
 * We approximate it from the relationship between avgMonthlyProfit and totalProfit.
 * If the wallet has few positions, we reduce confidence.
 */
function consistencyScore(stats: WalletStats): number {
  const { totalProfit, avgMonthlyProfit, totalPositionsClosed } = stats;
  if (avgMonthlyProfit <= 0 || totalProfit <= 0) return 0;

  // Coefficient of variation proxy: lower spread from mean → higher score
  // Heuristic: if avg monthly is close to total/estimated_months, variance is low.
  // We use positions as a proxy for months (rough but usable without raw monthly data).
  const estimatedMonths = Math.max(totalPositionsClosed / 3, 1);
  const impliedTotal = avgMonthlyProfit * estimatedMonths;
  const deviation = Math.abs(totalProfit - impliedTotal) / (impliedTotal + 1);
  // deviation = 0 → score 1, deviation = 1 → score 0, >1 → clamped 0
  const raw = Math.max(0, 1 - deviation);
  return raw;
}

export function computeScore(stats: WalletStats): number {
  const cs = consistencyScore(stats);

  const score =
    stats.winRate * 40 +
    Math.min(stats.profitRatio / 0.01, 1) * 30 +
    Math.min(stats.avgMonthlyProfit / 5, 1) * 20 +
    cs * 10;

  // Clamp to [0, 100]
  return Math.min(100, Math.max(0, score));
}
