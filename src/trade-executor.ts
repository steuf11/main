import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import axios from "axios";
import bs58 from "bs58";
import { v4 as uuidv4 } from "uuid";
import { ArbitrageOpportunity, TradeResult } from "./types";

const JUPITER_BASE_URL = "https://quote-api.jup.ag/v6";
const MIN_SOL_FOR_FEES = 0.05;

// Token mint addresses
const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

const DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  BONK: 5,
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number
): Promise<unknown> {
  const res = await axios.get(`${JUPITER_BASE_URL}/quote`, {
    params: {
      inputMint,
      outputMint,
      amount: amountLamports,
      slippageBps,
    },
    timeout: 10_000,
  });
  return res.data;
}

async function buildJupiterSwapTx(
  quote: unknown,
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
    { timeout: 10_000 }
  );
  return res.data.swapTransaction; // base64-encoded VersionedTransaction
}

async function sendWithRetry(
  connection: Connection,
  transaction: VersionedTransaction,
  retries: number = 3
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const sig = await connection.sendTransaction(transaction, {
        maxRetries: 2,
        skipPreflight: false,
      });

      // Wait for confirmation
      const { value } = await connection.confirmTransaction(sig, "confirmed");
      if (value.err) {
        throw new Error(`Transaction error: ${JSON.stringify(value.err)}`);
      }

      return sig;
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = 2 ** attempt * 500;
      console.warn(
        `[Trade Executor] Attempt ${attempt} failed, retrying in ${backoff}ms...`
      );
      await sleep(backoff);
    }
  }
  throw new Error("All retry attempts exhausted");
}

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

  const baseDecimals = DECIMALS[base] ?? 9;
  const quoteDecimals = DECIMALS[quote] ?? 6;
  const amountInLamports = Math.floor(tradeSizeUsd * 10 ** quoteDecimals);

  // Check SOL balance for fees
  const solBalance = await connection.getBalance(wallet.publicKey);
  if (solBalance / 1e9 < MIN_SOL_FOR_FEES) {
    return {
      trade_id: tradeId,
      status: "failed",
      buy_tx: null,
      sell_tx: null,
      profit_usd: 0,
      fees_usd: 0,
      net_pnl_usd: 0,
      timestamp,
      error: `Insufficient SOL for fees: ${(solBalance / 1e9).toFixed(4)} SOL < ${MIN_SOL_FOR_FEES} required`,
    };
  }

  let buyTxHash: string | null = null;
  let sellTxHash: string | null = null;

  try {
    // --- LEG 1: Buy (USDC → SOL on buy DEX) ---
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
    const buyTxBytes = Buffer.from(buySwapTxBase64, "base64");
    const buyTx = VersionedTransaction.deserialize(buyTxBytes);
    buyTx.sign([wallet]);

    console.log(
      `[Trade Executor] Sending buy leg on ${opportunity.buy_dex}...`
    );
    buyTxHash = await sendWithRetry(connection, buyTx);
    console.log(`[Trade Executor] Buy leg confirmed: ${buyTxHash}`);

    // Get the SOL amount received from the buy
    const buyQuoteData = buyQuote as { outAmount: string };
    const solReceived = parseInt(buyQuoteData.outAmount);

    // --- LEG 2: Sell (SOL → USDC on sell DEX) ---
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
    const sellTxBytes = Buffer.from(sellSwapTxBase64, "base64");
    const sellTx = VersionedTransaction.deserialize(sellTxBytes);
    sellTx.sign([wallet]);

    console.log(
      `[Trade Executor] Sending sell leg on ${opportunity.sell_dex}...`
    );
    sellTxHash = await sendWithRetry(connection, sellTx);
    console.log(`[Trade Executor] Sell leg confirmed: ${sellTxHash}`);

    // Calculate actual P&L
    const sellQuoteData = sellQuote as { outAmount: string };
    const usdcReceived = parseInt(sellQuoteData.outAmount) / 10 ** quoteDecimals;
    const networkFeesSol = 0.000015 * 2; // ~2 transactions
    const networkFeesUsd = networkFeesSol * opportunity.buy_price;
    const dexFees =
      (opportunity.buy_price * tradeSizeUsd * 0.0025 +
        opportunity.sell_price * tradeSizeUsd * 0.003) /
      100;
    const totalFeesUsd = networkFeesUsd + dexFees;
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

export function loadWallet(privateKeyBase58: string): Keypair {
  const secret = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(secret);
}

export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}
