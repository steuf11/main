export interface DexPrice {
  dex: string;
  price: number;
  liquidity: number;
  fee: number;
}

export interface PriceData {
  pair: string;
  timestamp: string;
  prices: Record<string, DexPrice>;
}

export interface ArbitrageOpportunity {
  pair: string;
  buy_dex: string;
  buy_price: number;
  sell_dex: string;
  sell_price: number;
  spread_pct: number;
  estimated_profit_usd: number;
  confidence: number;
}

export interface TradeResult {
  trade_id: string;
  status: "success" | "failed" | "partial";
  buy_tx: string | null;
  sell_tx: string | null;
  profit_usd: number;
  fees_usd: number;
  net_pnl_usd: number;
  timestamp: string;
  error?: string;
}

export interface TradeRecord {
  id: string;
  pair: string;
  buy_dex: string;
  sell_dex: string;
  buy_price: number;
  sell_price: number;
  amount: number;
  profit_usd: number;
  fees_usd: number;
  net_pnl: number;
  status: "success" | "failed" | "partial";
  timestamp: string;
  tx_hashes: string[];
}

export interface DailyStats {
  date: string;
  total_pnl: number;
  trade_count: number;
  win_rate: number;
  best_trade: number;
  worst_trade: number;
}

export interface Config {
  solana_rpc_url: string;
  solana_wallet_key: string;
  jupiter_api_key: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  max_trade_size_usd: number;
  slippage_tolerance_pct: number;
  min_spread_pct: number;
}
