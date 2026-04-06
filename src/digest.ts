import axios from "axios";
import { OctavPortfolio, OctavPosition, filterPositions } from "./portfolio-octav";
import { TokenMarketData, TopMover } from "./market-coingecko";

const TELEGRAM_BASE = "https://api.telegram.org";

// Fixed BP holdings (16,000 tokens as per spec)
const BP_FIXED_AMOUNT = 16_000;

function formatChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatPrice(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}

function buildDigestMessage(
  portfolio: OctavPortfolio,
  marketData: TokenMarketData[],
  topMovers: TopMover[]
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Paris",
  });
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

  // Portfolio section — from Octav
  const targetSymbols = ["SOL", "HYPE", "BP"];
  const octavPositions = filterPositions(portfolio, targetSymbols);
  const marketBySymbol = Object.fromEntries(marketData.map((m) => [m.symbol, m]));

  let portfolioLines = "";
  for (const sym of targetSymbols) {
    const pos = octavPositions.find((p) => p.symbol === sym);
    const market = marketBySymbol[sym];

    const price = market?.priceUsd ?? pos?.priceUsd ?? 0;
    const change = market?.change24hPct ?? pos?.change24hPct ?? 0;
    const changeStr = formatChange(change);
    const priceStr = formatPrice(price);

    if (sym === "BP") {
      const value = (price * BP_FIXED_AMOUNT).toFixed(0);
      portfolioLines += `• BP: ${priceStr} (${changeStr}) — ${BP_FIXED_AMOUNT.toLocaleString()} tokens ($${value})\n`;
    } else if (pos) {
      const holdingStr = `${pos.amount.toFixed(2)} ${sym}`;
      portfolioLines += `• ${sym}: ${priceStr} (${changeStr}) — ${holdingStr}\n`;
    } else {
      portfolioLines += `• ${sym}: ${priceStr} (${changeStr})\n`;
    }
  }

  // Top movers section
  let moversLines = "";
  for (const mover of topMovers) {
    const arrow = mover.change24hPct >= 0 ? "🟢" : "🔴";
    moversLines += `${arrow} ${mover.symbol}: ${formatPrice(mover.priceUsd)} (${formatChange(mover.change24hPct)})\n`;
  }

  // Claude analysis — simple rule-based signal
  const solData = marketBySymbol["SOL"];
  let action = "Pas de signal fort. Observer.";
  if (solData) {
    if (solData.change24hPct > 5) {
      action = "SOL en forte hausse (+5%). Arbitrage actif, surveiller les spreads.";
    } else if (solData.change24hPct < -5) {
      action = "SOL en baisse (-5%). Réduire l'exposition, attendre stabilisation.";
    } else if (solData.change24hPct > 2) {
      action = "Momentum positif sur SOL. Bot arb en conditions favorables.";
    }
  }

  const totalValue = portfolio.totalValueUsd > 0
    ? `\n💼 Total portfolio: $${portfolio.totalValueUsd.toFixed(2)}\n`
    : "";

  return (
    `📊 <b>CRYPTO INTEL — ${dateStr} ${timeStr}</b>\n\n` +
    `💰 <b>PORTFOLIO (Octav):</b>\n${portfolioLines}${totalValue}\n` +
    `🔥 <b>TOP MOVERS Solana:</b>\n${moversLines}\n` +
    `🎯 <b>ACTION:</b> ${action}`
  );
}

export async function sendDigest(
  botToken: string,
  chatId: string,
  portfolio: OctavPortfolio,
  marketData: TokenMarketData[],
  topMovers: TopMover[]
): Promise<void> {
  const text = buildDigestMessage(portfolio, marketData, topMovers);

  await axios.post(
    `${TELEGRAM_BASE}/bot${botToken}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    },
    { timeout: 10_000 }
  );
}

/** Send a plain error alert to Telegram */
export async function sendErrorAlert(
  botToken: string,
  chatId: string,
  context: string,
  err: Error
): Promise<void> {
  const text = `🔴 <b>Intel Digest — Erreur</b>\n\nContexte: ${context}\nErreur: ${err.message}`;
  await axios
    .post(
      `${TELEGRAM_BASE}/bot${botToken}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "HTML" },
      { timeout: 10_000 }
    )
    .catch(() => {}); // never crash on alert failure
}
