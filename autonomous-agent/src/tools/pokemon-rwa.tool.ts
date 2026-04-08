import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";
import { logger } from "../utils/logger";
import { validateWhitelist } from "../guards/whitelist";
import { checkSpendLimit } from "../guards/spend-limit";
import type { PokemonRWAOpportunity, ChainName } from "../types";

async function fetchCourtyardFloor(
  collectionSlug: string
): Promise<{ floorUSD: number | null; tokenId: string | null; contractAddress: string | null }> {
  try {
    const { data } = await axios.get<{
      floor_price_usd?: number;
      floor_token_id?: string;
      contract_address?: string;
    }>(
      `${process.env["COURTYARD_API_URL"]}/v1/collections/${collectionSlug}`,
      { timeout: 10_000 }
    );
    return {
      floorUSD: data.floor_price_usd ?? null,
      tokenId:  data.floor_token_id ?? null,
      contractAddress: data.contract_address ?? null,
    };
  } catch (err) {
    logger.warn("Courtyard floor fetch failed", { collectionSlug, err });
    return { floorUSD: null, tokenId: null, contractAddress: null };
  }
}

async function scanPokemonCollections(
  collections: string[],
  thresholdUSD: number,
  minDiscountPct: number
): Promise<PokemonRWAOpportunity[]> {
  const opps: PokemonRWAOpportunity[] = [];

  for (const collection of collections) {
    try {
      const courtyard = await fetchCourtyardFloor(collection);

      if (courtyard.floorUSD !== null && courtyard.contractAddress) {
        const discount = ((thresholdUSD - courtyard.floorUSD) / thresholdUSD) * 100;
        if (discount >= minDiscountPct) {
          opps.push({
            collection,
            tokenId: courtyard.tokenId || "unknown",
            contractAddress: courtyard.contractAddress,
            chain: "polygon" as ChainName,
            floorPriceUSD: courtyard.floorUSD,
            thresholdUSD,
            discountPct: discount,
            recommendedSizeUSD: Math.min(
              courtyard.floorUSD,
              parseFloat(process.env["MAX_TX_AMOUNT_USDC"] || "50")
            ),
            platform: "courtyard",
          });
        }
      }
    } catch (err) {
      logger.error("Erreur scan collection Pokémon", { collection, err });
    }
  }

  return opps.sort((a, b) => b.discountPct - a.discountPct);
}

export const pokemonRWAScanTool = new DynamicStructuredTool({
  name: "pokemon_rwa_scan",
  description:
    "Surveille le floor price de cartes Pokémon tokenisées (RWA) sur Courtyard.io et MagicEden. " +
    "Détecte les opportunités d'arbitrage quand le prix passe sous le seuil cible.",
  schema: z.object({
    collections: z.array(z.string()).default([])
      .describe("Slugs des collections à scanner"),
    thresholdUSD: z.number().positive().optional()
      .describe("Prix seuil en USD"),
    minDiscountPct: z.number().min(0).max(100).default(10)
      .describe("Discount minimum en %"),
  }),
  func: async ({ collections, thresholdUSD, minDiscountPct }) => {
    logger.info("🃏 [Tool] pokemon_rwa_scan", { collections });

    try {
      const cols = collections.length > 0
        ? collections
        : (process.env["POKEMON_TARGET_COLLECTIONS"] || "").split(",").filter(Boolean);

      const threshold = thresholdUSD ?? parseFloat(process.env["POKEMON_FLOOR_THRESHOLD_USD"] || "150");

      if (!cols.length) {
        return JSON.stringify({ error: "Aucune collection configurée (POKEMON_TARGET_COLLECTIONS)", opportunities: [] });
      }

      const opps = await scanPokemonCollections(cols, threshold, minDiscountPct);

      if (!opps.length) {
        return JSON.stringify({ message: "Aucun arbitrage Pokémon RWA détecté", opportunities: [] });
      }

      const best = opps[0];
      if (!validateWhitelist(best.contractAddress, best.chain)) {
        return JSON.stringify({ error: "Contrat Pokémon RWA non whitelisté", opportunities: opps });
      }
      const spendCheck = checkSpendLimit(best.recommendedSizeUSD, "USD");
      if (!spendCheck.allowed) {
        return JSON.stringify({
          error: `Taille ${best.recommendedSizeUSD} USD > spend limit ${spendCheck.limit}`,
          opportunities: opps,
        });
      }

      return JSON.stringify({
        message: `${opps.length} opportunité(s) Pokémon RWA trouvée(s)`,
        opportunities: opps.map((o) => ({
          ...o,
          discountPct: `${o.discountPct.toFixed(1)}%`,
          requiresHumanApproval: true,
        })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("❌ [Tool] pokemon_rwa_scan erreur", { err: message });
      return JSON.stringify({ error: message, opportunities: [] });
    }
  },
});
