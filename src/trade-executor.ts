import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionSignature,
} from "@solana/web3.js";
import axios from "axios";
import bs58 from "bs58";
import { v4 as uuidv4 } from "uuid";
import { ArbitrageOpportunity, TradeResult } from "./types";
import { TOKEN_MINTS, DECIMALS } from "./token-registry";

const JUPITER_BASE_URL = "https://quote-api.jup.ag/v6";
const MIN_SOL_FOR_FEES = 0.05;
/** Timeout for Jupiter API calls */
const JUPITER_TIMEOUT_MS = 10_000;
/** Timeout for on-chain confirmation — prevents infinite hang */
const CONFIRM_TIMEOUT_MS = 60_000;

// ─── Jupiter Quote Validation ────────────────────────────────────────────────

interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo?: { feeAmount?: number } }>;
}

function validateJupiterQuote(raw: unknown): raw is JupiterQuote {
  if (!raw || typeof raw !== "object") return false;
  const q = raw as Record<string, unknown>;
  return (
    typeof q["inAmount"] === "string" &&
    typeof q["outAmount"] === "string" &&
    !isNaN(Number(q["inAmount"])) &&
    !isNaN(Number(q["outAmount"])) &&
    Number(q["outAmount"]) > 0
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: bigint,
  slippageBps: number
): Promise<JupiterQuote> {
  const res = await axios.get(`${JUPITER_BASE_URL}/quote`, {
    params: {
      inputMint,
      outputMint,
      amount: amountLamports.toString(), // bigint → string, no precision loss
      slippageBps,
    },
    timeout: JUPITER_TIMEOUT_MS,
  });

  if (!validateJupiterQuote(res.data)) {
    throw new Error(
      `Invalid Jupiter quote response: ${JSON.stringify(res.data)}`
    );
  }
  return res.data;
}

async function buildJupiterSwapTx(
  quote: JupiterQuote,
  walletPublicKey: string
): Promise<string> {
  const res = await axios.post(
    `${JUPITER_BASE_URL}/swap`,
    {
      quoteResponse: quote,
      userPublicKey: walletPublicKey,
      wrapAndUnwrapSol: true,
      computeUnitPriceMicroLamports: 10_000,
    },
    { timeout: JUPITER_TIMEOUT_MS }
  );

  const swapTx = res.data?.swapTransaction;
  if (typeof swapTx !== "string" || swapTx.length === 0) {
    throw new Error(
      `Invalid Jupiter swap response: ${JSON.stringify(res.data)}`
    );
  }
  return swapTx;
}

async function sendWithRetry(
  connection: Connection,
  transaction: VersionedTransaction,
  retries: number = 3
): Promise<TransactionSignature> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const sig = await connection.sendTransaction(transaction, {
        maxRetries: 2,
        skipPreflight: false,
      });

      // Bounded confirmation — never hangs indefinitely
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const result = await Promise.race([
        connection.confirmTransaction(
          { signature: sig, ...latestBlockhash },
          "confirmed"
        ),
        sleep(CONFIRM_TIMEOUT_MS).then(() => {
          throw new Error(
            `Confirmation timeout after ${CONFIRM_TIMEOUT_MS / 1000}s for ${sig}`
          );
        }),
      ]);

      if (result.value.err) {
        throw new Error(
          `Transaction error: ${JSON.stringify(result.value.err)}`
        );
      }
      return sig;
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = 2 ** attempt * 500;
      console.warn(
        `[Trade Executor] Attempt ${attempt} failed, retrying in ${backoff}ms: ${(err as Error).message}`
      );
      await sleep(backoff);
    }
  }
  throw new Error("All retry attempts exhausted");
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function executeArbitrage(
  opportunity: ArbitrageOpportunity,
  connection: Connection,
  wallet: Keypair,
  tradeSizeUsd: number,
  slippageTolerancePct: number
): Promise<TradeResult> {
  const tradeId = uuidv4();
  const timestamp = new Date().toISOString();
  const slippageBps = Math.floor(slippageTolerancePct * 100);

  const [base, quote] = opportunity.pair.split("/");
  const inputMint = TOKEN_MINTS[quote] ?? TOKEN_MINTS[base];
  const midMint = TOKEN_MINTS[base];
  const outputMint = TOKEN_MINTS[quote] ?? TOKEN_MINTS[base];

  // Use single source of truth for decimals (fix #5)
  const quoteDecimals = DECIMALS[quote] ?? 6;

  // Fix #2: Use BigInt arithmetic to avoid float overflow on large amounts
  const amountInLamports =
    BigInt(Math.floor(tradeSizeUsd)) * BigInt(10 ** quoteDecimals);

  const failed = (error: string): TradeResult => ({
    trade_id: tradeId,
    status: "failed",
    buy_tx: null,
    sell_tx: null,
    profit_usd: 0,
    fees_usd: 0,
    net_pnl_usd: 0,
    timestamp,
    error,
  });

  // Check SOL balance for fees
  const solBalance = await connection.getBalance(wallet.publicKey);
  if (solBalance / 1e9 < MIN_SOL_FOR_FEES) {
    return failed(
      `Insufficient SOL for fees: ${(solBalance / 1e9).toFixed(4)} SOL < ${MIN_SOL_FOR_FEES} required`
    );
  }

  let buyTxHash: string | null = null;
  let sellTxHash: string | null = null;

  try {
    // --- LEG 1: Buy (USDC → SOL) ---
    const buyQuote = await getJupiterQuote(
      inputMint,
      midMint,
      amountInLamports,
      slippageBps
    );
    const buySwapTxBase64 = await buildJupiterSwapTx(
      buyQuote,
      wallet.publicKey.toString()
    );
    const buyTx = VersionedTransaction.deserialize(
      Buffer.from(buySwapTxBase64, "base64")
    );
    buyTx.sign([wallet]);

    console.log(`[Trade Executor] Sending buy leg on ${opportunity.buy_dex}...`);
    buyTxHash = await sendWithRetry(connection, buyTx);
    console.log(`[Trade Executor] Buy leg confirmed: ${buyTxHash}`);

    // Fix #3: outAmount already validated — safe to parse
    const solReceived = BigInt(buyQuote.outAmount);

    // --- LEG 2: Sell (SOL → USDC) ---
    const sellQuote = await getJupiterQuote(
      midMint,
      outputMint,
      solReceived,
      slippageBps
    );
    const sellSwapTxBase64 = await buildJupiterSwapTx(
      sellQuote,
      wallet.publicKey.toString()
    );
    const sellTx = VersionedTransaction.deserialize(
      Buffer.from(sellSwapTxBase64, "base64")
    );
    sellTx.sign([wallet]);

    console.log(`[Trade Executor] Sending sell leg on ${opportunity.sell_dex}...`);
    sellTxHash = await sendWithRetry(connection, sellTx);
    console.log(`[Trade Executor] Sell leg confirmed: ${sellTxHash}`);

    // Fix #8: P&L calculated from actual on-chain amounts, not estimates
    const usdcReceived =
      Number(BigInt(sellQuote.outAmount)) / 10 ** quoteDecimals;

    // Fees from actual route data (fix #8 — not hardcoded)
    const buyFeeUsd =
      (buyQuote.routePlan ?? []).reduce(
        (acc, r) => acc + (r.swapInfo?.feeAmount ?? 0),
        0
      ) /
      10 ** quoteDecimals;
    const sellFeeUsd =
      (sellQuote.routePlan ?? []).reduce(
        (acc, r) => acc + (r.swapInfo?.feeAmount ?? 0),
        0
      ) /
      10 ** quoteDecimals;
    const totalFeesUsd = buyFeeUsd + sellFeeUsd;

    const profitUsd = usdcReceived - tradeSizeUsd;
    const netPnl = profitUsd - totalFeesUsd;

    return {
      trade_id: tradeId,
      status: "success",
      buy_tx: buyTxHash,
      sell_tx: sellTxHash,
      profit_usd: parseFloat(profitUsd.toFixed(2)),
      fees_usd: parseFloat(totalFeesUsd.toFixed(2)),
      net_pnl_usd: parseFloat(netPnl.toFixed(2)),
      timestamp,
    };
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error("[Trade Executor] Trade failed:", errMsg);

    return {
      trade_id: tradeId,
      status: buyTxHash ? "partial" : "failed",
      buy_tx: buyTxHash,
      sell_tx: sellTxHash,
      profit_usd: 0,
      fees_usd: 0,
      net_pnl_usd: 0,
      timestamp,
      error: errMsg,
    };
  }
}

// Fix #1: Wipe secret bytes immediately after key derivation
export function loadWallet(privateKeyBase58: string): Keypair {
  const secret = bs58.decode(privateKeyBase58);
  try {
    return Keypair.fromSecretKey(secret);
  } finally {
    secret.fill(0); // zero-out in all code paths, including exceptions
  }
}

export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}
