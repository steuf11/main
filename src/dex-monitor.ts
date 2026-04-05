import axios, { AxiosInstance } from "axios";
import { DexPrice, PriceData } from "./types";

const JUPITER_BASE_URL = "https://quote-api.jup.ag/v6";
const ORCA_BASE_URL = "https://api.mainnet.orca.so";

// Token mint addresses (mainnet)
const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

// Known Orca pool addresses for common pairs
const ORCA_POOLS: Record<string, string> = {
  "SOL/USDC": "HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",
};

const http: AxiosInstance = axios.create({ timeout: 10_000 });

export async function fetchJupiterPrice(
  inputMint: string,
  outputMint: string,
  amountLamports: number
): Promise<DexPrice | null> {
  try {
    const res = await http.get(`${JUPITER_BASE_URL}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount: amountLamports,
        slippageBps: 50,
      },
    });

    const data = res.data;
    const inAmount = parseInt(data.inAmount);
    const outAmount = parseInt(data.outAmount);

    // Price = out / in (normalised for decimals externally)
    const price = outAmount / inAmount;
    const fee = data.routePlan?.reduce(
      (acc: number, r: { swapInfo?: { feeAmount?: number } }) =>
        acc + (r.swapInfo?.feeAmount ?? 0),
      0
    ) ?? 0;

    return {
      dex: "jupiter",
      price,
      liquidity: data.contextSlot ?? 0,
      fee: fee / inAmount,
    };
  } catch (err) {
    console.error("[DEX Monitor] Jupiter fetch failed:", (err as Error).message);
    return null;
  }
}

export async function fetchOrcaPrice(
  poolAddress: string,
  amountIn: number
): Promise<DexPrice | null> {
  try {
    const res = await http.get(`${ORCA_BASE_URL}/v1/whirlpool/list`);
    const pools: Array<{
      address: string;
      price: number;
      liquidity: number;
      feeRate: number;
    }> = res.data.whirlpools;

    const pool = pools.find((p) => p.address === poolAddress);
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

export async function fetchRaydiumPrice(
  inputMint: string,
  outputMint: string
): Promise<DexPrice | null> {
  try {
    const res = await http.get("https://price.raydium.io/list");
    const prices: Record<string, number> = res.data.data;

    const inputPrice = prices[inputMint] ?? null;
    const outputPrice = prices[outputMint] ?? null;
    if (!inputPrice || !outputPrice) return null;

    return {
      dex: "raydium",
      price: outputPrice / inputPrice,
      liquidity: 0,
      fee: 0.0025,
    };
  } catch (err) {
    console.error(
      "[DEX Monitor] Raydium fetch failed:",
      (err as Error).message
    );
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

  // For SOL, 1 unit = 1e9 lamports; for USDC, 1 unit = 1e6 micro-USDC
  const decimals = base === "SOL" ? 9 : 6;
  const amountLamports = Math.floor(amountUsd * 10 ** decimals);

  const [jupiter, orca, raydium] = await Promise.all([
    fetchJupiterPrice(inputMint, outputMint, amountLamports),
    ORCA_POOLS[pair]
      ? fetchOrcaPrice(ORCA_POOLS[pair], amountUsd)
      : Promise.resolve(null),
    fetchRaydiumPrice(inputMint, outputMint),
  ]);

  const prices: Record<string, DexPrice> = {};
  if (jupiter) prices.jupiter = jupiter;
  if (orca) prices.orca = orca;
  if (raydium) prices.raydium = raydium;

  return {
    pair,
    timestamp: new Date().toISOString(),
    prices,
  };
}

export const TOKEN_MINTS_MAP = TOKEN_MINTS;
