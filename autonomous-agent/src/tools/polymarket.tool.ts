import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { logger } from "../utils/logger";
import { validateWhitelist } from "../guards/whitelist";
import { checkSpendLimit } from "../guards/spend-limit";
import type { PolymarketOpportunity } from "../types";

interface ClobMarket {
  condition_id: string;
  question: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  active: boolean;
  closed: boolean;
}

interface OrderBook {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

function calculateEV(trueProb: number, marketPrice: number): number {
  if (marketPrice <= 0 || marketPrice >= 1) return -Infinity;
  return (trueProb / marketPrice - 1) * 100;
}

function estimateMidFromOrderBook(book: OrderBook): number {
  if (!book.bids.length || !book.asks.length) return 0;
  return (parseFloat(book.bids[0].price) + parseFloat(book.asks[0].price)) / 2;
}

async function fetchActiveMarkets(slug?: string): Promise<ClobMarket[]> {
  const { data } = await axios.get<{ data: ClobMarket[] }>(
    `${process.env["POLYMARKET_CLOB_API_URL"]}/markets`,
    {
      params: { active: true, closed: false, limit: 20, ...(slug ? { slug } : {}) },
      timeout: 10_000,
    }
  );
  return data.data || [];
}

async function fetchOrderBook(tokenId: string): Promise<OrderBook> {
  const { data } = await axios.get<OrderBook>(
    `${process.env["POLYMARKET_CLOB_API_URL"]}/book`,
    { params: { token_id: tokenId }, timeout: 8_000 }
  );
  return data;
}

async function scanForEVOpportunities(
  slugs: string[],
  minEV = 5,
  minVolume = 1000
): Promise<PolymarketOpportunity[]> {
  const opps: PolymarketOpportunity[] = [];

  for (const slug of slugs) {
    try {
      const markets = await fetchActiveMarkets(slug);
      for (const market of markets) {
        if (!market.active || market.closed) continue;
        if (parseFloat(market.volume) < minVolume) continue;

        for (let i = 0; i < market.outcomes.length; i++) {
          const marketPrice = parseFloat(market.outcomePrices[i] ?? "0");
          if (marketPrice <= 0.02 || marketPrice >= 0.98) continue;

          let trueProb = marketPrice;
          try {
            const book = await fetchOrderBook(`${market.condition_id}_${i}`);
            trueProb = estimateMidFromOrderBook(book) || marketPrice;
          } catch { /* fallback */ }

          const ev = calculateEV(trueProb, marketPrice);
          if (ev < minEV) continue;

          const maxBet = parseFloat(process.env["MAX_TX_AMOUNT_USDC"] || "50");
          const kelly  = Math.max(0, (trueProb - (1 - trueProb)) / 1) / 4;
          const size   = Math.min(kelly * maxBet, maxBet);

          opps.push({
            marketId: market.condition_id,
            question: market.question,
            outcome: market.outcomes[i] ?? "",
            currentPrice: marketPrice,
            bestBid: 0,
            bestAsk: marketPrice,
            impliedProbability: trueProb,
            suggestedEV: ev,
            recommendedSize: size,
            contractAddress: process.env["POLYMARKET_CONTRACT_ADDRESS"] || "",
          });
        }
      }
    } catch (err) {
      logger.error("Erreur scan marché Polymarket", { slug, err });
    }
  }

  return opps.sort((a, b) => b.suggestedEV - a.suggestedEV);
}

export const polymarketScanTool = new DynamicStructuredTool({
  name: "polymarket_scan",
  description:
    "Scanne l'API CLOB de Polymarket pour détecter des opportunités EV+. " +
    "À utiliser en premier pour analyser les marchés avant toute exécution.",
  schema: z.object({
    eventSlugs: z.array(z.string()).default([])
      .describe("Slugs d'événements à scanner"),
    minEVThreshold: z.number().min(0).max(100).default(5)
      .describe("Seuil minimum EV en %"),
    maxResults: z.number().int().min(1).max(10).default(3)
      .describe("Nombre maximum de résultats"),
  }),
  func: async ({ eventSlugs, minEVThreshold, maxResults }) => {
    logger.info("🔍 [Tool] polymarket_scan", { slugs: eventSlugs, minEV: minEVThreshold });

    try {
      const contractAddress = process.env["POLYMARKET_CONTRACT_ADDRESS"] || "";
      if (!validateWhitelist(contractAddress, "polygon")) {
        return JSON.stringify({ error: "Contrat Polymarket non whitelisté", opportunities: [] });
      }

      const slugsToScan = eventSlugs.length > 0
        ? eventSlugs
        : (process.env["POLYMARKET_TARGET_SLUGS"] || "").split(",").filter(Boolean);

      if (!slugsToScan.length) {
        return JSON.stringify({ error: "Aucun slug configuré (POLYMARKET_TARGET_SLUGS)", opportunities: [] });
      }

      const opps = await scanForEVOpportunities(slugsToScan, minEVThreshold);
      const top  = opps.slice(0, maxResults);

      if (!top.length) {
        return JSON.stringify({ message: "Aucune opportunité EV+ détectée", opportunities: [] });
      }

      const spendCheck = checkSpendLimit(top[0].recommendedSize, "USDC");
      if (!spendCheck.allowed) {
        return JSON.stringify({
          error: `Taille ${top[0].recommendedSize} USDC > spend limit ${spendCheck.limit} USDC`,
          opportunities: top,
        });
      }

      return JSON.stringify({
        message: `${top.length} opportunité(s) trouvée(s)`,
        opportunities: top.map((o) => ({
          ...o,
          expectedValue: `${o.suggestedEV.toFixed(2)}%`,
          recommendedSize: `${o.recommendedSize.toFixed(2)} USDC`,
          requiresHumanApproval: true,
        })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("❌ [Tool] polymarket_scan erreur", { err: message });
      return JSON.stringify({ error: message, opportunities: [] });
    }
  },
});
