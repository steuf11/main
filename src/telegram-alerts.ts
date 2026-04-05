import axios from "axios";
import { ArbitrageOpportunity, DailyStats, TradeResult } from "./types";

const TELEGRAM_BASE = "https://api.telegram.org";

async function sendMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  try {
    await axios.post(
      `${TELEGRAM_BASE}/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      },
      { timeout: 10_000 }
    );
  } catch (err) {
    console.error(
      "[Telegram] Failed to send message:",
      (err as Error).message
    );
  }
}

export async function alertSuccessfulTrade(
  botToken: string,
  chatId: string,
  opportunity: ArbitrageOpportunity,
  result: TradeResult,
  dailyStats: DailyStats
): Promise<void> {
  const text =
    `🔄 <b>ARBITRAGE EXECUTED</b>\n\n` +
    `Pair: <b>${opportunity.pair}</b>\n` +
    `Buy:  ${opportunity.buy_dex} @ $${opportunity.buy_price.toFixed(4)}\n` +
    `Sell: ${opportunity.sell_dex} @ $${opportunity.sell_price.toFixed(4)}\n\n` +
    `💰 Net Profit: <b>$${result.net_pnl_usd.toFixed(2)}</b>\n` +
    `   Gross: $${result.profit_usd.toFixed(2)} | Fees: $${result.fees_usd.toFixed(2)}\n\n` +
    `📊 Today's PnL: <b>$${dailyStats.total_pnl.toFixed(2)}</b> (${dailyStats.trade_count} trades, ${dailyStats.win_rate}% win rate)\n\n` +
    `🔗 Buy tx:  <code>${result.buy_tx ?? "N/A"}</code>\n` +
    `🔗 Sell tx: <code>${result.sell_tx ?? "N/A"}</code>`;

  await sendMessage(botToken, chatId, text);
}

export async function alertFailedTrade(
  botToken: string,
  chatId: string,
  opportunity: ArbitrageOpportunity,
  result: TradeResult
): Promise<void> {
  const text =
    `❌ <b>Trade Failed</b>\n\n` +
    `Pair: <b>${opportunity.pair}</b>\n` +
    `Expected profit: $${opportunity.estimated_profit_usd.toFixed(2)}\n` +
    `Status: ${result.status}\n` +
    `Reason: ${result.error ?? "Unknown error"}`;

  await sendMessage(botToken, chatId, text);
}

export async function alertPartialTrade(
  botToken: string,
  chatId: string,
  opportunity: ArbitrageOpportunity,
  result: TradeResult
): Promise<void> {
  const text =
    `⚠️ <b>Partial Trade — Manual Review Needed</b>\n\n` +
    `Pair: <b>${opportunity.pair}</b>\n` +
    `Buy tx: <code>${result.buy_tx ?? "not sent"}</code>\n` +
    `Sell tx: <code>${result.sell_tx ?? "FAILED"}</code>\n\n` +
    `⚡ Action required: check wallet balance and close position manually.\n` +
    `Error: ${result.error ?? "Unknown error"}`;

  await sendMessage(botToken, chatId, text);
}

export async function alertDailyReport(
  botToken: string,
  chatId: string,
  stats: DailyStats
): Promise<void> {
  const pnlEmoji = stats.total_pnl >= 0 ? "📈" : "📉";
  const text =
    `${pnlEmoji} <b>Daily Report — ${stats.date}</b>\n\n` +
    `Total PnL:   <b>$${stats.total_pnl.toFixed(2)}</b>\n` +
    `Trades:      ${stats.trade_count}\n` +
    `Win Rate:    ${stats.win_rate}%\n` +
    `Best Trade:  $${stats.best_trade.toFixed(2)}\n` +
    `Worst Trade: $${stats.worst_trade.toFixed(2)}`;

  await sendMessage(botToken, chatId, text);
}

export async function alertStartup(
  botToken: string,
  chatId: string
): Promise<void> {
  await sendMessage(
    botToken,
    chatId,
    "🚀 <b>Arbitrage Bot started</b> — monitoring Solana DEXs for opportunities."
  );
}

export async function alertError(
  botToken: string,
  chatId: string,
  context: string,
  err: Error
): Promise<void> {
  const text =
    `🔴 <b>Bot Error</b>\n\n` +
    `Context: ${context}\n` +
    `Error: ${err.message}`;
  await sendMessage(botToken, chatId, text);
}
