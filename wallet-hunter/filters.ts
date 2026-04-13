import { WalletStats, HunterFilters } from "./types";

export function applyFilters(
  stats: WalletStats,
  filters: HunterFilters
): boolean {
  if (stats.winRate < filters.minWinRate) return false;
  if (stats.profitRatio < filters.minProfitRatio) return false;
  if (stats.totalPositionsClosed < filters.minPositionsClosed) return false;
  if (stats.avgInvestedPerPosition < filters.minAvgInvestedSOL) return false;
  if (
    filters.maxFollowers > 0 &&
    stats.followers !== undefined &&
    stats.followers > filters.maxFollowers
  )
    return false;
  return true;
}
