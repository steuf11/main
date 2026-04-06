/**
 * Single source of truth for token mints and decimals.
 * Both dex-monitor.ts and trade-executor.ts import from here —
 * a typo in one place won't silently corrupt amounts.
 */
export const TOKEN_MINTS: Readonly<Record<string, string>> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
} as const;

export const DECIMALS: Readonly<Record<string, number>> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  BONK: 5,
} as const;
