import axios from "axios";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// CoinGecko IDs for target tokens
export const COINGECKO_IDS: Record<string, string> = {
  SOL: "solana",
  HYPE: "hyperliquid",
  BP: "backpack-exchange",
};

export interface TokenMarketData {
  symbol: string;
  coingeckoId: string;
  priceUsd: number;
  change24hPct: number;
  marketCapUsd: number;
  volume24hUsd: number;
}

export interface TopMover {
  symbol: string;
  priceUsd: number;
  change24hPct: number;
}

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
}

export async function fetchTokenPrices(
  symbols: string[]
): Promise<TokenMarketData[]> {
  const ids = symbols
    .map((s) => COINGECKO_IDS[s.toUpperCase()])
    .filter(Boolean);

  if (ids.length === 0) return [];

  const res = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
    params: {
      vs_currency: "usd",
      ids: ids.join(","),
      order: "market_cap_desc",
      per_page: ids.length,
      page: 1,
      sparkline: false,
      price_change_percentage: "24h",
    },
    timeout: 10_000,
  });

  const coins = res.data as CoinGeckoMarket[];

  // Map back from CoinGecko ID to our symbol
  const idToSymbol: Record<string, string> = {};
  for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
    idToSymbol[id] = sym;
  }

  return coins.map((c) => ({
    symbol: idToSymbol[c.id] ?? c.symbol.toUpperCase(),
    coingeckoId: c.id,
    priceUsd: c.current_price,
    change24hPct: c.price_change_percentage_24h ?? 0,
    marketCapUsd: c.market_cap,
    volume24hUsd: c.total_volume,
  }));
}

/** Fetch top movers in Solana ecosystem (by 24h gain) */
export async function fetchTopSolanaMovers(limit: number = 5): Promise<TopMover[]> {
  const res = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
    params: {
      vs_currency: "usd",
      category: "solana-ecosystem",
      order: "price_change_percentage_24h_desc",
      per_page: limit,
      page: 1,
      sparkline: false,
    },
    timeout: 10_000,
  });

  const coins = res.data as CoinGeckoMarket[];

  return coins.map((c) => ({
    symbol: c.symbol.toUpperCase(),
    priceUsd: c.current_price,
    change24hPct: c.price_change_percentage_24h ?? 0,
  }));
}
