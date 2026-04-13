export interface WalletStats {
  address: string;
  totalPositionsClosed: number;
  avgInvestedPerPosition: number; // SOL
  totalProfit: number;            // SOL
  avgMonthlyProfit: number;       // SOL
  winRate: number;                // 0–1
  profitRatio: number;            // totalProfit / (avgInvested * totalPositionsClosed)
  followers?: number;
  score: number;                  // 0–100
  passesFilter: boolean;
}

export interface HunterFilters {
  minWinRate: number;
  minProfitRatio: number;
  minPositionsClosed: number;
  minAvgInvestedSOL: number;
  maxFollowers: number;
}

export interface HunterConfig {
  filters: HunterFilters;
  concurrency: number;
  outputDir: string;
}
