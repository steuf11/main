import axios from "axios";

const OCTAV_BASE = "https://api.octav.fi";

export interface OctavPosition {
  symbol: string;
  amount: number;
  valueUsd: number;
  priceUsd: number;
  change24hPct: number | null;
}

export interface OctavPortfolio {
  wallet: string;
  totalValueUsd: number;
  positions: OctavPosition[];
  fetchedAt: string;
}

interface OctavRawToken {
  symbol: string;
  amount: number;
  usdValue: number;
  price: number;
  priceChange24h?: number;
}

interface OctavRawResponse {
  totalUsdValue?: number;
  tokens?: OctavRawToken[];
  // some versions use different field names
  total_value_usd?: number;
  positions?: OctavRawToken[];
}

export async function fetchOctavPortfolio(
  walletAddress: string
): Promise<OctavPortfolio> {
  const res = await axios.get(
    `${OCTAV_BASE}/api/v1/portfolios/${walletAddress}`,
    {
      headers: { "Content-Type": "application/json" },
      timeout: 15_000,
    }
  );

  const data = res.data as OctavRawResponse;
  const rawPositions = data.tokens ?? data.positions ?? [];
  const totalValueUsd = data.totalUsdValue ?? data.total_value_usd ?? 0;

  const positions: OctavPosition[] = rawPositions.map((p) => ({
    symbol: p.symbol.toUpperCase(),
    amount: p.amount,
    valueUsd: p.usdValue,
    priceUsd: p.price,
    change24hPct: p.priceChange24h ?? null,
  }));

  return {
    wallet: walletAddress,
    totalValueUsd,
    positions,
    fetchedAt: new Date().toISOString(),
  };
}

/** Filter to target symbols only */
export function filterPositions(
  portfolio: OctavPortfolio,
  symbols: string[]
): OctavPosition[] {
  const upper = symbols.map((s) => s.toUpperCase());
  return portfolio.positions.filter((p) => upper.includes(p.symbol));
}
