import axios, { AxiosInstance } from "axios";
import { DexPrice, PriceData } from "./types";
import { TOKEN_MINTS, DECIMALS } from "./token-registry";
import { fetchRaydiumClmmPrice } from "./raydium-client";

const JUPITER_BASE_URL = "https://quote-api.jup.ag/v6";
const ORCA_BASE_URL = "https://api.mainnet.orca.so";

// Known Orca whirlpool addresses for common pairs
const ORCA_POOLS: Record<string, string> = {
  "SOL/USDC": "HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",
};

const http: AxiosInstance = axios.create({ timeout: 10_000 });

export async function fetchJupiterPrice(
  inputMint: string,
  outputMint: string,
  amountLamports: bigint
): Promise<DexPrice | null> {
  try {
    const res = await http.get(`${JUPITER_BASE_URL}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports.toString(), // bigint → string, no precision loss
        slippageBps: 50,
      },
    });

    const data = res.data;
    // Fix #7: validate required fields before using
    if (
      typeof data?.inAmount !== "string" ||
      typeof data?.outAmount !== "string" ||
      Number(data.inAmount) === 0
    ) {
      console.warn("[DEX Monitor] Jupiter: unexpected quote shape", data);
      return null;
    }

    const inAmount = Number(data.inAmount);
    const outAmount = Number(data.outAmount);
    const price = outAmount / inAmount;
    const fee =
      (data.routePlan as Array<{ swapInfo?: { feeAmount?: number } }> ?? [])
        .reduce((acc, r) => acc + (r.swapInfo?.feeAmount ?? 0), 0) / inAmount;

    return { dex: "jupiter", price, liquidity: data.contextSlot ?? 0, fee };
  } catch (err) {
    console.error("[DEX Monitor] Jupiter fetch failed:", (err as Error).message);
    return null;
  }
}

export async function fetchOrcaPrice(
  poolAddress: string
): Promise<DexPrice | null> {
  try {
    const res = await http.get(`${ORCA_BASE_URL}/v1/whirlpool/list`);
    // Fix #7: validate response shape
    const whirlpools = res.data?.whirlpools;
    if (!Array.isArray(whirlpools)) {
      console.warn("[DEX Monitor] Orca: unexpected response shape");
      return null;
    }

    const pool = (
      whirlpools as Array<{
        address: string;
        price: number;
        liquidity: number;
        feeRate: number;
      }>
    ).find((p) => p.address === poolAddress);

    if (!pool) return null;

    return {
      dex: "orca",
      price: pool.price,
      liquidity: pool.liquidity,
      fee: pool.feeRate / 1_000_000,
    };
  } catch (err) {
    console.error("[DEX Monitor] Orca fetch failed:", (err as Error).message);
    return null;
  }
}

/**
 * Fetch Raydium price directly from CLMM pool state.
 * Falls back to the price-list API if no pool is registered for the pair.
 */
export async function fetchRaydiumPrice(
  inputMint: string,
  outputMint: string,
  pair: string
): Promise<DexPrice | null> {
  // Primary: CLMM pool (accurate, includes real fee rate + liquidity)
  const clmm = await fetchRaydiumClmmPrice(pair);
  if (clmm) return clmm;

  // Fallback: price-list API (less accurate, no liquidity data)
  try {
    const res = await http.get("https://api.raydium.io/v2/main/price");
    const prices = res.data?.data ?? res.data;
    if (!prices || typeof prices !== "object") {
      console.warn("[DEX Monitor] Raydium fallback: unexpected response shape");
      return null;
    }

    const priceMap = prices as Record<string, number>;
    const inputPrice = priceMap[inputMint];
    const outputPrice = priceMap[outputMint];
    if (!inputPrice || !outputPrice) return null;

    return {
      dex: "raydium",
      price: outputPrice / inputPrice,
      liquidity: 0,
      fee: 0.0025, // standard AMM fee
    };
  } catch (err) {
    console.error("[DEX Monitor] Raydium fallback fetch failed:", (err as Error).message);
    return null;
  }
}

export async function fetchPrices(
  pair: string,
  amountUsd: number = 100
): Promise<PriceData> {
  const [base, quote] = pair.split("/");
  const inputMint = TOKEN_MINTS[base];
  const outputMint = TOKEN_MINTS[quote];

  if (!inputMint || !outputMint) {
    throw new Error(`Unknown token pair: ${pair}`);
  }

  // Fix #5: use DECIMALS from single source of truth
  const baseDecimals = DECIMALS[base] ?? 9;
  const amountLamports =
    BigInt(Math.floor(amountUsd)) * BigInt(10 ** baseDecimals);

  const [jupiter, orca, raydium] = await Promise.all([
    fetchJupiterPrice(inputMint, outputMint, amountLamports),
    ORCA_POOLS[pair]
      ? fetchOrcaPrice(ORCA_POOLS[pair])
      : Promise.resolve(null),
    fetchRaydiumPrice(inputMint, outputMint, pair),
  ]);

  const prices: Record<string, DexPrice> = {};
  if (jupiter) prices.jupiter = jupiter;
  if (orca) prices.orca = orca;
  if (raydium) prices.raydium = raydium;

  return { pair, timestamp: new Date().toISOString(), prices };
}
