import { logger } from "../utils/logger";
import type { SpendCheckResult } from "../types";

export function checkSpendLimit(
  amount: number,
  currency: string = "USDC"
): SpendCheckResult {
  const limit = parseFloat(process.env["MAX_TX_AMOUNT_USDC"] || "50");
  const allowed = amount <= limit;
  if (!allowed) {
    logger.warn("💰 Spend limit dépassé", { requested: amount, limit, currency });
  }
  return { allowed, requested: amount, limit, currency };
}
