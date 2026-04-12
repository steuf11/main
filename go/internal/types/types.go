package types

// DexPrice holds the price data from a single DEX.
type DexPrice struct {
	Dex       string  `json:"dex"`
	Price     float64 `json:"price"`
	Liquidity float64 `json:"liquidity"`
	Fee       float64 `json:"fee"`
}

// PriceData aggregates prices from all monitored DEXes for a trading pair.
type PriceData struct {
	Pair      string              `json:"pair"`
	Timestamp string              `json:"timestamp"`
	Prices    map[string]DexPrice `json:"prices"`
}

// ArbitrageOpportunity describes a detected cross-DEX arbitrage trade.
type ArbitrageOpportunity struct {
	Pair               string  `json:"pair"`
	BuyDex             string  `json:"buy_dex"`
	BuyPrice           float64 `json:"buy_price"`
	SellDex            string  `json:"sell_dex"`
	SellPrice          float64 `json:"sell_price"`
	SpreadPct          float64 `json:"spread_pct"`
	EstimatedProfitUSD float64 `json:"estimated_profit_usd"`
	Confidence         float64 `json:"confidence"`
}

// TradeStatus is the outcome of a two-leg arbitrage execution.
type TradeStatus string

const (
	TradeSuccess TradeStatus = "success"
	TradeFailed  TradeStatus = "failed"
	TradePartial TradeStatus = "partial"
)

// TradeResult is returned by the trade executor after attempting a swap.
type TradeResult struct {
	TradeID    string      `json:"trade_id"`
	Status     TradeStatus `json:"status"`
	BuyTx      *string     `json:"buy_tx"`
	SellTx     *string     `json:"sell_tx"`
	ProfitUSD  float64     `json:"profit_usd"`
	FeesUSD    float64     `json:"fees_usd"`
	NetPnLUSD  float64     `json:"net_pnl_usd"`
	Timestamp  string      `json:"timestamp"`
	Error      *string     `json:"error,omitempty"`
}

// TradeRecord is a persisted trade entry from the SQLite log.
type TradeRecord struct {
	ID        string      `json:"id"`
	Pair      string      `json:"pair"`
	BuyDex    string      `json:"buy_dex"`
	SellDex   string      `json:"sell_dex"`
	BuyPrice  float64     `json:"buy_price"`
	SellPrice float64     `json:"sell_price"`
	Amount    float64     `json:"amount"`
	ProfitUSD float64     `json:"profit_usd"`
	FeesUSD   float64     `json:"fees_usd"`
	NetPnL    float64     `json:"net_pnl"`
	Status    TradeStatus `json:"status"`
	Timestamp string      `json:"timestamp"`
	TxHashes  []string    `json:"tx_hashes"`
}

// DailyStats summarises trading activity for a calendar day.
type DailyStats struct {
	Date       string  `json:"date"`
	TotalPnL   float64 `json:"total_pnl"`
	TradeCount int     `json:"trade_count"`
	WinRate    float64 `json:"win_rate"`
	BestTrade  float64 `json:"best_trade"`
	WorstTrade float64 `json:"worst_trade"`
}

// Config holds all runtime configuration loaded from the environment.
type Config struct {
	SolanaRPCURL        string  `json:"solana_rpc_url"`
	SolanaWalletKey     string  `json:"solana_wallet_key"`
	JupiterAPIKey       string  `json:"jupiter_api_key"`
	TelegramBotToken    string  `json:"telegram_bot_token"`
	TelegramChatID      string  `json:"telegram_chat_id"`
	MaxTradeSizeUSD     float64 `json:"max_trade_size_usd"`
	SlippageTolerancePct float64 `json:"slippage_tolerance_pct"`
	MinSpreadPct        float64 `json:"min_spread_pct"`
}
