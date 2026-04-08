export type ChainName = "polygon" | "base" | "solana";

export type MissionName = "polymarket" | "pokemon_rwa";

export interface AgentContext {
  mission: MissionName;
  prompt: string;
}

export interface OpportunityResult {
  detected: boolean;
  marketId?: string;
  question?: string;
  currentOdds?: number;
  impliedProb?: number;
  expectedValue?: number;
  suggestedAmount?: number;
  confidence?: number;
  collection?: string;
  floorPriceUSD?: number;
  thresholdUSD?: number;
  discountPct?: number;
  tokenId?: string;
  contractAddress?: string;
  chain?: ChainName;
}

export interface SpendCheckResult {
  allowed: boolean;
  requested: number;
  limit: number;
  currency: string;
}

export interface TradeApprovalRequest {
  mission: MissionName;
  summary: string;
  amount: number;
  currency: string;
  contractAddress: string;
  chain: ChainName;
}

export interface PolymarketOpportunity {
  marketId: string;
  question: string;
  outcome: string;
  currentPrice: number;
  bestBid: number;
  bestAsk: number;
  impliedProbability: number;
  suggestedEV: number;
  recommendedSize: number;
  contractAddress: string;
}

export interface PokemonRWAOpportunity {
  collection: string;
  tokenId: string;
  contractAddress: string;
  chain: ChainName;
  floorPriceUSD: number;
  thresholdUSD: number;
  discountPct: number;
  recommendedSizeUSD: number;
  platform: "magiceden" | "courtyard";
  buyNowUrl?: string;
}
