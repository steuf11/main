package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/joho/godotenv"
	"github.com/steuf11/arb-bot/internal/types"
)

// Load reads configuration from the environment (and an optional .env file).
// Required variables cause an error if absent; optional ones fall back to defaults.
func Load() (*types.Config, error) {
	// Best-effort .env load — ignore error when file doesn't exist in production.
	_ = godotenv.Load()

	walletKey, err := requireEnv("SOLANA_WALLET_KEY")
	if err != nil {
		return nil, err
	}
	botToken, err := requireEnv("TELEGRAM_BOT_TOKEN")
	if err != nil {
		return nil, err
	}
	chatID, err := requireEnv("TELEGRAM_CHAT_ID")
	if err != nil {
		return nil, err
	}

	maxTrade, err := parseFloatEnv("MAX_TRADE_SIZE_USD", 100)
	if err != nil {
		return nil, err
	}
	slippage, err := parseFloatEnv("SLIPPAGE_TOLERANCE_PCT", 0.5)
	if err != nil {
		return nil, err
	}
	minSpread, err := parseFloatEnv("MIN_SPREAD_PCT", 0.5)
	if err != nil {
		return nil, err
	}

	return &types.Config{
		SolanaRPCURL:         optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
		SolanaWalletKey:      walletKey,
		JupiterAPIKey:        optionalEnv("JUPITER_API_KEY", ""),
		TelegramBotToken:     botToken,
		TelegramChatID:       chatID,
		MaxTradeSizeUSD:      maxTrade,
		SlippageTolerancePct: slippage,
		MinSpreadPct:         minSpread,
	}, nil
}

func requireEnv(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("missing required environment variable: %s", key)
	}
	return v, nil
}

func optionalEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseFloatEnv(key string, fallback float64) (float64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid value for %s: %w", key, err)
	}
	return v, nil
}
