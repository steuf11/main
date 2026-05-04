import { logger } from "../utils/logger";
import type { ChainName } from "../types";

function getWhitelist(chain: ChainName): string[] {
  const raw = (() => {
    switch (chain) {
      case "polygon": return process.env["WHITELIST_POLYGON_CONTRACTS"] || "";
      case "base":    return process.env["WHITELIST_BASE_CONTRACTS"] || "";
      case "solana":  return process.env["WHITELIST_SOLANA_PROGRAMS"] || "";
    }
  })();
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function validateWhitelist(
  contractAddress: string,
  chain: ChainName
): boolean {
  const whitelist = getWhitelist(chain);
  if (whitelist.length === 0) {
    logger.warn("⚠️  Whitelist vide pour la chaîne", { chain });
    return false;
  }
  const normalized = contractAddress.trim().toLowerCase();
  const allowed = whitelist.includes(normalized);
  if (!allowed) {
    logger.warn("🚫 Contrat non whitelisté", { contractAddress, chain });
  }
  return allowed;
}
