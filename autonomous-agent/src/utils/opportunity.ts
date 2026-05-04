import axios from "axios";
import { logger } from "./logger";
import type { OpportunityResult } from "../types";

// ── Détecteur Polymarket (sans LLM) ──────────────────────────────────────────

export async function detectPolymarketOpportunity(): Promise<OpportunityResult> {
  try {
    const minEV  = parseFloat(process.env["POLYMARKET_MIN_EV_THRESHOLD"] || "5");
    const minVol = parseFloat(process.env["POLYMARKET_MIN_VOLUME"] || "1000");

    const { data } = await axios.get<{ data: Array<{
      active: boolean;
      closed: boolean;
      volume: string;
      condition_id: string;
      question: string;
      outcomes: string[];
      outcomePrices: string[];
    }> }>(
      `${process.env["POLYMARKET_CLOB_API_URL"]}/markets`,
      { params: { active: true, closed: false, limit: 50 }, timeout: 10_000 }
    );

    const markets = data.data || [];

    for (const market of markets) {
      if (!market.active || market.closed) continue;
      if (parseFloat(market.volume) < minVol) continue;

      for (let i = 0; i < (market.outcomes || []).length; i++) {
        const price = parseFloat(market.outcomePrices?.[i] || "0");
        if (price <= 0.02 || price >= 0.98) continue;

        const roughEV = Math.abs(0.5 - price) * 100 * 2;
        if (roughEV >= minEV) {
          return {
            detected: true,
            marketId: market.condition_id,
            question: market.question,
            currentOdds: price,
            impliedProb: price,
            expectedValue: roughEV,
            suggestedAmount: Math.min(10, parseFloat(process.env["MAX_TX_AMOUNT_USDC"] || "50")),
            confidence: 0.6,
          };
        }
      }
    }

    return { detected: false };
  } catch (err) {
    logger.error("Erreur detectPolymarketOpportunity", { err });
    return { detected: false };
  }
}

// ── Détecteur Pokémon RWA (sans LLM) ─────────────────────────────────────────

export async function detectPokemonOpportunity(): Promise<OpportunityResult> {
  try {
    const collections = (process.env["POKEMON_TARGET_COLLECTIONS"] || "").split(",").filter(Boolean);
    const threshold   = parseFloat(process.env["POKEMON_FLOOR_THRESHOLD_USD"] || "150");
    const minDiscount = parseFloat(process.env["POKEMON_MIN_DISCOUNT_PCT"] || "10");

    if (!collections.length) return { detected: false };

    for (const slug of collections) {
      try {
        const { data } = await axios.get<{
          floor_price_usd: number;
          floor_token_id?: string;
          contract_address?: string;
        }>(
          `${process.env["COURTYARD_API_URL"]}/v1/collections/${slug}`,
          { timeout: 8_000 }
        );

        const floorUSD = data.floor_price_usd;
        if (!floorUSD) continue;

        const discount = ((threshold - floorUSD) / threshold) * 100;
        if (discount >= minDiscount) {
          return {
            detected: true,
            collection: slug,
            floorPriceUSD: floorUSD,
            thresholdUSD: threshold,
            discountPct: discount,
            tokenId: data.floor_token_id || "unknown",
            contractAddress: data.contract_address || "",
            chain: "polygon",
          };
        }
      } catch { /* skip collection en erreur */ }
    }

    return { detected: false };
  } catch (err) {
    logger.error("Erreur detectPokemonOpportunity", { err });
    return { detected: false };
  }
}
