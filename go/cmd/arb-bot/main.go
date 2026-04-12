package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/steuf11/arb-bot/internal/config"
	"github.com/steuf11/arb-bot/internal/dexmonitor"
	"github.com/steuf11/arb-bot/internal/pnllogger"
	"github.com/steuf11/arb-bot/internal/spreadcalc"
	"github.com/steuf11/arb-bot/internal/telegram"
	"github.com/steuf11/arb-bot/internal/tradeexec"
	"github.com/steuf11/arb-bot/internal/types"
)

const (
	monitorInterval          = 30 * time.Second
	dailyReportHourUTC       = 23
	circuitBreakerThreshold  = 3
)

var monitoredPairs = []string{"SOL/USDC"}

type bot struct {
	cfg              *types.Config
	mu               sync.Mutex
	consecutiveLosses int
	circuitOpen      bool
}

func (b *bot) recordLoss() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consecutiveLosses++
	if b.consecutiveLosses >= circuitBreakerThreshold && !b.circuitOpen {
		b.circuitOpen = true
		log.Printf("[Main] Circuit breaker OPEN after %d consecutive losses. Trading halted.", b.consecutiveLosses)
		_ = telegram.AlertError(b.cfg.TelegramBotToken, b.cfg.TelegramChatID, "Circuit breaker",
			fmt.Errorf("trading halted after %d consecutive losses — restart to reset", b.consecutiveLosses))
	}
}

func (b *bot) recordWin() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consecutiveLosses = 0
}

func (b *bot) isCircuitOpen() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.circuitOpen
}

func (b *bot) monitorCycle() {
	if b.isCircuitOpen() {
		log.Println("[Main] Circuit breaker open — trading halted. Restart to reset.")
		return
	}

	for _, pair := range monitoredPairs {
		priceData, err := dexmonitor.FetchPrices(pair, b.cfg.MaxTradeSizeUSD)
		if err != nil {
			log.Printf("[Main] Error fetching prices for %s: %v", pair, err)
			_ = telegram.AlertError(b.cfg.TelegramBotToken, b.cfg.TelegramChatID,
				fmt.Sprintf("price fetch for %s", pair), err)
			continue
		}

		if len(priceData.Prices) < 2 {
			log.Printf("[Main] Not enough DEX data for %s (%d sources).", pair, len(priceData.Prices))
			continue
		}

		opportunities := spreadcalc.FindArbitrageOpportunities(
			priceData,
			b.cfg.MaxTradeSizeUSD,
			b.cfg.MinSpreadPct,
			b.cfg.SlippageTolerancePct,
		)

		if len(opportunities) == 0 {
			log.Printf("[Main] No arbitrage opportunity for %s.", pair)
			continue
		}

		best := opportunities[0]
		log.Printf("[Main] Opportunity: %s → %s | spread %.3f%% | est. profit $%.2f",
			best.BuyDex, best.SellDex, best.SpreadPct, best.EstimatedProfitUSD)

		result, err := tradeexec.ExecuteArbitrage(
			best,
			b.cfg.SolanaRPCURL,
			b.cfg.SolanaWalletKey,
			b.cfg.MaxTradeSizeUSD,
			b.cfg.SlippageTolerancePct,
		)
		if err != nil {
			log.Printf("[Main] Unexpected executor error: %v", err)
			continue
		}

		if logErr := pnllogger.LogTrade(best, result, b.cfg.MaxTradeSizeUSD); logErr != nil {
			log.Printf("[Main] Failed to log trade: %v", logErr)
		}

		stats, _ := pnllogger.GetDailyStats("")

		switch result.Status {
		case types.TradeSuccess:
			b.recordWin()
			log.Printf("[Main] Trade successful. Net PnL: $%.2f", result.NetPnLUSD)
			_ = telegram.AlertSuccessfulTrade(b.cfg.TelegramBotToken, b.cfg.TelegramChatID, best, result, stats)
		case types.TradePartial:
			b.recordLoss()
			log.Println("[Main] Partial trade — manual review needed!")
			_ = telegram.AlertPartialTrade(b.cfg.TelegramBotToken, b.cfg.TelegramChatID, best, result)
		default:
			b.recordLoss()
			errMsg := ""
			if result.Error != nil {
				errMsg = *result.Error
			}
			log.Printf("[Main] Trade failed: %s", errMsg)
			_ = telegram.AlertFailedTrade(b.cfg.TelegramBotToken, b.cfg.TelegramChatID, best, result)
		}
	}
}

func (b *bot) runDailyReportAt23() {
	for {
		now := time.Now().UTC()
		next := time.Date(now.Year(), now.Month(), now.Day(), dailyReportHourUTC, 0, 0, 0, time.UTC)
		if !next.After(now) {
			next = next.Add(24 * time.Hour)
		}
		time.Sleep(time.Until(next))

		stats, err := pnllogger.GetDailyStats("")
		if err != nil {
			log.Printf("[Main] Daily stats error: %v", err)
			continue
		}
		lifetime, _ := pnllogger.GetLifetimePnL()
		log.Printf("[Main] Daily stats: $%.2f PnL, %d trades | Lifetime: $%.2f",
			stats.TotalPnL, stats.TradeCount, lifetime)
		_ = telegram.AlertDailyReport(b.cfg.TelegramBotToken, b.cfg.TelegramChatID, stats)
	}
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[Main] Config error: %v", err)
	}

	b := &bot{cfg: cfg}

	log.Println("[Main] Starting Solana DEX Arbitrage Bot...")
	if err := telegram.AlertStartup(cfg.TelegramBotToken, cfg.TelegramChatID); err != nil {
		log.Printf("[Main] Startup alert failed: %v", err)
	}

	// Monitor loop.
	ticker := time.NewTicker(monitorInterval)
	defer ticker.Stop()

	// Daily report goroutine.
	go b.runDailyReportAt23()

	// Graceful shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	log.Printf("[Main] Bot running. Monitoring: %v", monitoredPairs)
	log.Println("[Main] Press Ctrl+C to stop.")

	for {
		select {
		case <-ticker.C:
			b.monitorCycle()
		case sig := <-quit:
			log.Printf("[Main] %s received. Shutting down gracefully...", sig)
			pnllogger.CloseDB()
			os.Exit(0)
		}
	}
}
