import * as cron from "node-cron";
import pLimit from "p-limit";
import { loadConfig } from "./config";
import { fetchPrices } from "./dex-monitor";
import { findArbitrageOpportunities } from "./spread-calculator";
import { executeArbitrage, loadWallet, createConnection } from "./trade-executor";
import {
  logTrade,
  getDailyStats,
  getLifetimePnL,
  closeDb,
} from "./pnl-logger";
import {
  alertStartup,
  alertSuccessfulTrade,
  alertFailedTrade,
  alertPartialTrade,
  alertDailyReport,
  alertError,
} from "./telegram-alerts";
import { Config } from "./types";

const MONITORED_PAIRS = ["SOL/USDC"];

// Fix #4: p-limit(1) guarantees only one concurrent execution — atomic, no race condition
const executeLimit = pLimit(1);

// Fix #10: Circuit breaker — halt trading after N consecutive losses
const CIRCUIT_BREAKER_THRESHOLD = 3;
let consecutiveLosses = 0;
let circuitOpen = false;

function recordLoss(config: Config): void {
  consecutiveLosses++;
  if (consecutiveLosses >= CIRCUIT_BREAKER_THRESHOLD && !circuitOpen) {
    circuitOpen = true;
    console.error(
      `[Main] Circuit breaker OPEN after ${consecutiveLosses} consecutive losses. Trading halted.`
    );
    alertError(
      config.telegram_bot_token,
      config.telegram_chat_id,
      "Circuit breaker",
      new Error(
        `Trading halted after ${consecutiveLosses} consecutive losses. Restart bot to reset.`
      )
    ).catch(() => {});
  }
}

function recordWin(): void {
  consecutiveLosses = 0;
}

async function monitorCycle(config: Config): Promise<void> {
  // Fix #10: skip if circuit open
  if (circuitOpen) {
    console.log("[Main] Circuit breaker open — trading halted. Restart to reset.");
    return;
  }

  // Fix #4: wrap the entire trade execution in p-limit(1) — not just a flag check
  return executeLimit(async () => {
    for (const pair of MONITORED_PAIRS) {
      try {
        console.log(`[Main] Fetching prices for ${pair}...`);
        const priceData = await fetchPrices(pair, config.max_trade_size_usd);

        if (Object.keys(priceData.prices).length < 2) {
          console.log(
            `[Main] Not enough DEX data for ${pair} (got ${Object.keys(priceData.prices).length} sources).`
          );
          continue;
        }

        const opportunities = findArbitrageOpportunities(
          priceData,
          config.max_trade_size_usd,
          config.min_spread_pct,
          config.slippage_tolerance_pct
        );

        if (opportunities.length === 0) {
          console.log(`[Main] No arbitrage opportunity for ${pair}.`);
          continue;
        }

        const best = opportunities[0];
        console.log(
          `[Main] Opportunity found: ${best.buy_dex} → ${best.sell_dex} | ` +
            `spread ${best.spread_pct.toFixed(3)}% | est. profit $${best.estimated_profit_usd}`
        );

        const connection = createConnection(config.solana_rpc_url);
        const wallet = loadWallet(config.solana_wallet_key);

        const result = await executeArbitrage(
          best,
          connection,
          wallet,
          config.max_trade_size_usd,
          config.slippage_tolerance_pct
        );

        logTrade(best, result, config.max_trade_size_usd);
        const dailyStats = getDailyStats();

        if (result.status === "success") {
          recordWin();
          console.log(`[Main] Trade successful. Net PnL: $${result.net_pnl_usd}`);
          await alertSuccessfulTrade(
            config.telegram_bot_token,
            config.telegram_chat_id,
            best,
            result,
            dailyStats
          );
        } else if (result.status === "partial") {
          recordLoss(config);
          console.warn("[Main] Partial trade — manual review needed!");
          await alertPartialTrade(
            config.telegram_bot_token,
            config.telegram_chat_id,
            best,
            result
          );
        } else {
          recordLoss(config);
          console.log(`[Main] Trade failed: ${result.error}`);
          await alertFailedTrade(
            config.telegram_bot_token,
            config.telegram_chat_id,
            best,
            result
          );
        }
      } catch (err) {
        console.error(
          `[Main] Error in monitor cycle for ${pair}:`,
          (err as Error).message
        );
        await alertError(
          config.telegram_bot_token,
          config.telegram_chat_id,
          `Monitor cycle for ${pair}`,
          err as Error
        ).catch(() => {});
      }
    }
  });
}

async function main(): Promise<void> {
  console.log("[Main] Starting Solana DEX Arbitrage Bot...");

  const config = loadConfig();

  await alertStartup(config.telegram_bot_token, config.telegram_chat_id);

  // Monitor every 30 seconds
  cron.schedule("*/30 * * * * *", async () => {
    await monitorCycle(config).catch((err: Error) => {
      console.error("[Main] Unhandled error in monitor cycle:", err.message);
    });
  });

  // Daily report at 23:00 UTC
  cron.schedule(
    "0 23 * * *",
    async () => {
      const stats = getDailyStats();
      const lifetime = getLifetimePnL();
      console.log(
        `[Main] Daily stats: $${stats.total_pnl} PnL, ${stats.trade_count} trades | Lifetime: $${lifetime}`
      );
      await alertDailyReport(
        config.telegram_bot_token,
        config.telegram_chat_id,
        stats
      ).catch((err: Error) =>
        console.error("[Main] Failed to send daily report:", err.message)
      );
    },
    { timezone: "UTC" }
  );

  console.log("[Main] Bot running. Monitoring:", MONITORED_PAIRS.join(", "));
  console.log("[Main] Press Ctrl+C to stop.");

  process.on("SIGINT", () => {
    console.log("\n[Main] Shutting down gracefully...");
    closeDb();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("[Main] SIGTERM received. Shutting down...");
    closeDb();
    process.exit(0);
  });
}

main().catch((err: Error) => {
  console.error("[Main] Fatal error:", err.message);
  process.exit(1);
});
