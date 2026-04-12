package pnllogger_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/steuf11/arb-bot/internal/pnllogger"
	"github.com/steuf11/arb-bot/internal/types"
)

func TestMain(m *testing.M) {
	// Use a temp DB so tests don't touch the real trades.db.
	tmp, err := os.MkdirTemp("", "arb-bot-test-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp dir: %v\n", err)
		os.Exit(1)
	}
	os.Setenv("DB_PATH_OVERRIDE", filepath.Join(tmp, "test-trades.db"))

	code := m.Run()

	pnllogger.CloseDB()
	os.RemoveAll(tmp)
	os.Exit(code)
}

var mockOpportunity = types.ArbitrageOpportunity{
	Pair:               "SOL/USDC",
	BuyDex:             "raydium",
	BuyPrice:           79.28,
	SellDex:            "orca",
	SellPrice:          79.45,
	SpreadPct:          0.21,
	EstimatedProfitUSD: 42.5,
	Confidence:         0.85,
}

func newSuccessResult() types.TradeResult {
	buyTx := "txhash1"
	sellTx := "txhash2"
	return types.TradeResult{
		TradeID:   fmt.Sprintf("test-%d-success", time.Now().UnixNano()),
		Status:    types.TradeSuccess,
		BuyTx:     &buyTx,
		SellTx:    &sellTx,
		ProfitUSD: 38.2,
		FeesUSD:   4.3,
		NetPnLUSD: 33.9,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
}

func newFailedResult() types.TradeResult {
	errMsg := "Slippage exceeded"
	return types.TradeResult{
		TradeID:   fmt.Sprintf("test-%d-failed", time.Now().UnixNano()),
		Status:    types.TradeFailed,
		ProfitUSD: 0,
		FeesUSD:   0,
		NetPnLUSD: 0,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Error:     &errMsg,
	}
}

func TestLogSuccessfulTrade(t *testing.T) {
	if err := pnllogger.LogTrade(mockOpportunity, newSuccessResult(), 100); err != nil {
		t.Errorf("LogTrade (success) returned error: %v", err)
	}
}

func TestLogFailedTrade(t *testing.T) {
	if err := pnllogger.LogTrade(mockOpportunity, newFailedResult(), 100); err != nil {
		t.Errorf("LogTrade (failed) returned error: %v", err)
	}
}

func TestGetDailyStatsCountsAndPnL(t *testing.T) {
	// Seed at least two trades for today.
	_ = pnllogger.LogTrade(mockOpportunity, newSuccessResult(), 100)
	_ = pnllogger.LogTrade(mockOpportunity, newFailedResult(), 100)

	stats, err := pnllogger.GetDailyStats("")
	if err != nil {
		t.Fatalf("GetDailyStats: %v", err)
	}
	if stats.TradeCount < 2 {
		t.Errorf("expected trade_count >= 2, got %d", stats.TradeCount)
	}
	if stats.WinRate < 0 || stats.WinRate > 100 {
		t.Errorf("win_rate out of range: %.1f", stats.WinRate)
	}
}

func TestGetRecentTradesReturnsSlice(t *testing.T) {
	trades, err := pnllogger.GetRecentTrades(5)
	if err != nil {
		t.Fatalf("GetRecentTrades: %v", err)
	}
	// trades is a slice (possibly empty) — just verify the type is correct.
	_ = trades
}

func TestGetLifetimePnLReturnsNumber(t *testing.T) {
	pnl, err := pnllogger.GetLifetimePnL()
	if err != nil {
		t.Fatalf("GetLifetimePnL: %v", err)
	}
	// Must be a finite float — no NaN/Inf.
	if pnl != pnl {
		t.Error("GetLifetimePnL returned NaN")
	}
}

func TestTxHashesUnmarshalled(t *testing.T) {
	trades, err := pnllogger.GetRecentTrades(10)
	if err != nil {
		t.Fatalf("GetRecentTrades: %v", err)
	}
	for _, tr := range trades {
		if tr.TxHashes == nil {
			t.Errorf("trade %s has nil TxHashes (expected slice)", tr.ID)
		}
	}
}

func TestPartialTradeMarkedForRecovery(t *testing.T) {
	buyTx := "partial-buy-tx"
	partial := types.TradeResult{
		TradeID:   fmt.Sprintf("test-%d-partial", time.Now().UnixNano()),
		Status:    types.TradePartial,
		BuyTx:     &buyTx,
		ProfitUSD: 0,
		FeesUSD:   0.5,
		NetPnLUSD: -0.5,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	if err := pnllogger.LogTrade(mockOpportunity, partial, 100); err != nil {
		t.Fatalf("LogTrade (partial): %v", err)
	}
	recoveries, err := pnllogger.GetTradesNeedingRecovery()
	if err != nil {
		t.Fatalf("GetTradesNeedingRecovery: %v", err)
	}
	if len(recoveries) == 0 {
		t.Error("expected at least one recovery trade after logging a partial trade")
	}
}
