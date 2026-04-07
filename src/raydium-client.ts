/**
 * Raydium DEX Client
 *
 * Provides two capabilities:
 * 1. Real-time price fetching from Raydium CLMM pools (replaces the basic price-list API)
 * 2. Direct swap execution via Raydium's transaction API (parallel route alongside Jupiter)
 *
 * APIs used:
 *   Pool data:  https://api.raydium.io/v2/ammV3/ammPools
 *   Swap quote: https://transaction-v1.raydium.io/compute/swap-base-in
 *   Swap tx:    https://transaction-v1.raydium.io/transaction/swap-base-in
 */

import axios from "axios";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_MINTS, DECIMALS } from "./token-registry";
import { DexPrice } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const RAYDIUM_API = "https://api.raydium.io/v2";
const RAYDIUM_TX_API = "https://transaction-v1.raydium.io";
const TIMEOUT_MS = 10_000;
const CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Known Raydium CLMM pool IDs for common pairs.
 * Source: https://raydium.io/clmm/pools/
 */
export const RAYDIUM_POOLS: Record<string, string> = {
  "SOL/USDC": "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv",
  "SOL/USDT": "HkG7fJJSNgKkBXmPbVqXZ8GQnk2YLJthrHHB2kFZMiMU",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface RaydiumPoolData {
  id: string;
  price: number;
  tvl: number;
  feeRate: number; // raw fee rate (e.g. 2500 = 0.25%)
}

interface RaydiumSwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: number;
  feeAmount: string;
  poolId: string;
}

interface RaydiumSwapQuoteResponse {
  id: string;
  success: boolean;
  data: RaydiumSwapQuote;
}

interface RaydiumSwapTxResponse {
  id: string;
  success: boolean;
  data: {
    transaction: string; // base64 VersionedTransaction
  };
}

// ─── Price Fetching ───────────────────────────────────────────────────────────

/**
 * Fetch live price from a Raydium CLMM pool.
 * Returns null on any fetch/parse error so the monitor loop continues gracefully.
 */
export async function fetchRaydiumClmmPrice(
  pair: string
): Promise<DexPrice | null> {
  const poolId = RAYDIUM_POOLS[pair];
  if (!poolId) return null;

  try {
    const res = await axios.get(`${RAYDIUM_API}/ammV3/ammPools`, {
      params: { poolId },
      timeout: TIMEOUT_MS,
    });

    const pools: RaydiumPoolData[] = res.data?.data ?? [];
    const pool = pools.find((p) => p.id === poolId);

    if (!pool || typeof pool.price !== "number" || pool.price <= 0) {
      console.warn(
        `[Raydium] Pool ${poolId} not found or invalid price:`,
        pool
      );
      return null;
    }

    // feeRate is in hundredths of a bip (e.g. 2500 → 0.25%)
    const feeDecimal = pool.feeRate / 1_000_000;

    return {
      dex: "raydium",
      price: pool.price,
      liquidity: pool.tvl ?? 0,
      fee: feeDecimal,
    };
  } catch (err) {
    console.error(
      "[Raydium] CLMM price fetch failed:",
      (err as Error).message
    );
    return null;
  }
}

// ─── Swap Quote ───────────────────────────────────────────────────────────────

function validateSwapQuote(raw: unknown): raw is RaydiumSwapQuoteResponse {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (!r["success"]) return false;
  const d = r["data"] as Record<string, unknown> | undefined;
  return (
    !!d &&
    typeof d["outputAmount"] === "string" &&
    Number(d["outputAmount"]) > 0
  );
}

export async function getRaydiumSwapQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: bigint,
  slippageBps: number,
  pair: string
): Promise<RaydiumSwapQuote | null> {
  const poolId = RAYDIUM_POOLS[pair];
  if (!poolId) return null;

  try {
    const res = await axios.get(
      `${RAYDIUM_TX_API}/compute/swap-base-in`,
      {
        params: {
          inputMint,
          outputMint,
          amount: amountLamports.toString(),
          slippageBps,
          txVersion: "V0",
        },
        timeout: TIMEOUT_MS,
      }
    );

    if (!validateSwapQuote(res.data)) {
      console.warn("[Raydium] Invalid swap quote response:", res.data);
      return null;
    }

    return (res.data as RaydiumSwapQuoteResponse).data;
  } catch (err) {
    console.error("[Raydium] Swap quote failed:", (err as Error).message);
    return null;
  }
}

// ─── Swap Execution ───────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildRaydiumSwapTx(
  quote: RaydiumSwapQuote,
  walletPublicKey: string,
  priorityFeePerCu: number = 10_000
): Promise<string> {
  const res = await axios.post(
    `${RAYDIUM_TX_API}/transaction/swap-base-in`,
    {
      computeUnitPriceMicroLamports: String(priorityFeePerCu),
      swapResponse: quote,
      txVersion: "V0",
      wallet: walletPublicKey,
      wrapSol: true,
      unwrapSol: true,
    },
    { timeout: TIMEOUT_MS }
  );

  const txData = res.data as RaydiumSwapTxResponse;
  if (!txData.success || !txData.data?.transaction) {
    throw new Error(
      `Raydium swap tx build failed: ${JSON.stringify(res.data)}`
    );
  }

  return txData.data.transaction;
}

/**
 * Execute a direct Raydium swap with retry + bounded confirmation.
 * Returns the transaction signature on success.
 */
export async function executeRaydiumSwap(
  connection: Connection,
  wallet: Keypair,
  inputMint: string,
  outputMint: string,
  amountLamports: bigint,
  slippageBps: number,
  pair: string,
  retries: number = 3
): Promise<string> {
  const quote = await getRaydiumSwapQuote(
    inputMint,
    outputMint,
    amountLamports,
    slippageBps,
    pair
  );

  if (!quote) {
    throw new Error(
      `[Raydium] No quote available for ${pair} (pool not registered or API down)`
    );
  }

  const txBase64 = await buildRaydiumSwapTx(
    quote,
    wallet.publicKey.toString()
  );

  const tx = VersionedTransaction.deserialize(
    Buffer.from(txBase64, "base64")
  );
  tx.sign([wallet]);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const sig = await connection.sendTransaction(tx, {
        maxRetries: 2,
        skipPreflight: false,
      });

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const result = await Promise.race([
        connection.confirmTransaction(
          { signature: sig, ...latestBlockhash },
          "confirmed"
        ),
        sleep(CONFIRM_TIMEOUT_MS).then(() => {
          throw new Error(
            `Raydium confirmation timeout after ${CONFIRM_TIMEOUT_MS / 1000}s`
          );
        }),
      ]);

      if (result.value.err) {
        throw new Error(
          `Raydium tx error: ${JSON.stringify(result.value.err)}`
        );
      }

      return sig;
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = 2 ** attempt * 500;
      console.warn(
        `[Raydium] Attempt ${attempt} failed, retrying in ${backoff}ms: ${(err as Error).message}`
      );
      await sleep(backoff);
    }
  }

  throw new Error("[Raydium] All retry attempts exhausted");
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Estimate effective output amount including Raydium fees.
 * Useful for profitability comparison before committing a trade leg to Raydium vs Jupiter.
 */
export function estimateRaydiumOutput(
  inputAmount: number,
  price: number,
  feeDecimal: number
): number {
  const grossOut = inputAmount * price;
  return grossOut * (1 - feeDecimal);
}
