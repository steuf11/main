package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/steuf11/arb-bot/internal/types"
)

const (
	baseURL     = "https://api.telegram.org/bot"
	httpTimeout = 10 * time.Second
)

var httpClient = &http.Client{Timeout: httpTimeout}

func send(botToken, chatID, text string) error {
	url := fmt.Sprintf("%s%s/sendMessage", baseURL, botToken)
	payload := map[string]string{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("telegram API returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// AlertStartup notifies that the bot has started.
func AlertStartup(botToken, chatID string) error {
	msg := fmt.Sprintf("🤖 <b>Solana Arb Bot started</b>\n%s UTC", time.Now().UTC().Format("2006-01-02 15:04:05"))
	return send(botToken, chatID, msg)
}

// AlertSuccessfulTrade sends a trade success summary.
func AlertSuccessfulTrade(botToken, chatID string, opp types.ArbitrageOpportunity, result types.TradeResult, stats types.DailyStats) error {
	buyTx, sellTx := "–", "–"
	if result.BuyTx != nil {
		buyTx = *result.BuyTx
	}
	if result.SellTx != nil {
		sellTx = *result.SellTx
	}
	msg := fmt.Sprintf(
		"✅ <b>Trade executed</b>\nPair: %s\nRoute: %s → %s\nSpread: %.3f%%\nNet PnL: <b>$%.2f</b>\nFees: $%.2f\nBuy tx: <code>%s</code>\nSell tx: <code>%s</code>\n\nToday: %d trades | $%.2f PnL | %.1f%% win rate",
		opp.Pair, opp.BuyDex, opp.SellDex, opp.SpreadPct,
		result.NetPnLUSD, result.FeesUSD, buyTx, sellTx,
		stats.TradeCount, stats.TotalPnL, stats.WinRate,
	)
	return send(botToken, chatID, msg)
}

// AlertFailedTrade notifies of a failed trade attempt.
func AlertFailedTrade(botToken, chatID string, opp types.ArbitrageOpportunity, result types.TradeResult) error {
	errMsg := ""
	if result.Error != nil {
		errMsg = *result.Error
	}
	msg := fmt.Sprintf(
		"❌ <b>Trade failed</b>\nPair: %s\nRoute: %s → %s\nExpected profit: $%.2f\nReason: %s",
		opp.Pair, opp.BuyDex, opp.SellDex, opp.EstimatedProfitUSD, errMsg,
	)
	return send(botToken, chatID, msg)
}

// AlertPartialTrade sends an urgent alert when only the buy leg executed.
func AlertPartialTrade(botToken, chatID string, opp types.ArbitrageOpportunity, result types.TradeResult) error {
	buyTx := "–"
	if result.BuyTx != nil {
		buyTx = *result.BuyTx
	}
	msg := fmt.Sprintf(
		"⚠️ <b>PARTIAL TRADE — MANUAL ACTION REQUIRED</b>\nPair: %s\nBuy (%s) succeeded, sell (%s) failed.\nBuy tx: <code>%s</code>\nManually sell the acquired asset to close the position.",
		opp.Pair, opp.BuyDex, opp.SellDex, buyTx,
	)
	return send(botToken, chatID, msg)
}

// AlertDailyReport sends the end-of-day statistics.
func AlertDailyReport(botToken, chatID string, stats types.DailyStats) error {
	msg := fmt.Sprintf(
		"📊 <b>Daily Report — %s</b>\nTrades: %d\nNet PnL: <b>$%.2f</b>\nWin rate: %.1f%%\nBest trade: $%.2f\nWorst trade: $%.2f",
		stats.Date, stats.TradeCount, stats.TotalPnL, stats.WinRate, stats.BestTrade, stats.WorstTrade,
	)
	return send(botToken, chatID, msg)
}

// AlertError sends an unhandled error notification.
func AlertError(botToken, chatID, context string, err error) error {
	msg := fmt.Sprintf("🚨 <b>Error in %s</b>\n%v", context, err)
	return send(botToken, chatID, msg)
}
