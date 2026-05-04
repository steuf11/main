/**
 * Intel Digest Scheduler
 * Sends portfolio + market digest to Telegram at 07:30 and 17:30 Paris time.
 *
 * Run independently from the arb bot:
 *   npx ts-node src/intel-scheduler.ts
 *   node dist/intel-scheduler.js
 */

import * as cron from "node-cron";
import * as dotenv from "dotenv";
import { fetchOctavPortfolio } from "./portfolio-octav";
import { fetchTokenPrices, fetchTopSolanaMovers } from "./market-coingecko";
import { sendDigest, sendErrorAlert } from "./digest";

dotenv.config();

const WALLET = process.env["INTEL_WALLET_ADDRESS"] ?? "";
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const CHAT_ID = process.env["TELEGRAM_CHAT_ID"] ?? "";
const TARGET_SYMBOLS = ["SOL", "HYPE", "BP"];

if (!WALLET || !BOT_TOKEN || !CHAT_ID) {
  console.error(
    "[Intel] Missing env vars: INTEL_WALLET_ADDRESS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID"
  );
  process.exit(1);
}

async function runDigest(): Promise<void> {
  console.log("[Intel] Running digest...");

  const [portfolio, marketData, topMovers] = await Promise.all([
    fetchOctavPortfolio(WALLET),
    fetchTokenPrices(TARGET_SYMBOLS),
    fetchTopSolanaMovers(5),
  ]);

  await sendDigest(BOT_TOKEN, CHAT_ID, portfolio, marketData, topMovers);
  console.log("[Intel] Digest sent.");
}

async function safeRunDigest(): Promise<void> {
  try {
    await runDigest();
  } catch (err) {
    console.error("[Intel] Digest failed:", (err as Error).message);
    await sendErrorAlert(BOT_TOKEN, CHAT_ID, "Intel Digest", err as Error);
  }
}

// 07:30 Paris time (Europe/Paris = UTC+1 winter / UTC+2 summer)
cron.schedule("30 7 * * *", () => void safeRunDigest(), {
  timezone: "Europe/Paris",
});

// 17:30 Paris time
cron.schedule("30 17 * * *", () => void safeRunDigest(), {
  timezone: "Europe/Paris",
});

console.log("[Intel] Scheduler started — digest at 07:30 + 17:30 Europe/Paris");
console.log("[Intel] Wallet:", WALLET);

// Send one immediately on startup so you can validate it works
console.log("[Intel] Sending startup digest...");
void safeRunDigest();
