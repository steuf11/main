import * as dotenv from "dotenv";
import { Config } from "./types";

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    solana_rpc_url: optionalEnv(
      "SOLANA_RPC_URL",
      "https://api.mainnet-beta.solana.com"
    ),
    solana_wallet_key: requireEnv("SOLANA_WALLET_KEY"),
    jupiter_api_key: optionalEnv("JUPITER_API_KEY", ""),
    telegram_bot_token: requireEnv("TELEGRAM_BOT_TOKEN"),
    telegram_chat_id: requireEnv("TELEGRAM_CHAT_ID"),
    max_trade_size_usd: parseFloat(optionalEnv("MAX_TRADE_SIZE_USD", "100")),
    slippage_tolerance_pct: parseFloat(
      optionalEnv("SLIPPAGE_TOLERANCE_PCT", "0.5")
    ),
    min_spread_pct: parseFloat(optionalEnv("MIN_SPREAD_PCT", "0.5")),
  };
}
