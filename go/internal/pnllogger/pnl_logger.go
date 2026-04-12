package pnllogger

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/steuf11/arb-bot/internal/types"
)

const defaultDBPath = "trades.db"

var (
	mu sync.Mutex
	db *sql.DB
)

func dbPath() string {
	if p := os.Getenv("DB_PATH_OVERRIDE"); p != "" {
		return p
	}
	return defaultDBPath
}

// GetDB returns (and lazily initialises) the singleton database connection.
func GetDB() (*sql.DB, error) {
	mu.Lock()
	defer mu.Unlock()
	if db != nil {
		return db, nil
	}
	conn, err := sql.Open("sqlite3", dbPath())
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := initSchema(conn); err != nil {
		conn.Close()
		return nil, err
	}
	db = conn
	return db, nil
}

func initSchema(conn *sql.DB) error {
	_, err := conn.Exec(`
		CREATE TABLE IF NOT EXISTS trades (
			id TEXT PRIMARY KEY,
			pair TEXT NOT NULL,
			buy_dex TEXT NOT NULL,
			sell_dex TEXT NOT NULL,
			buy_price REAL NOT NULL,
			sell_price REAL NOT NULL,
			amount REAL NOT NULL,
			profit_usd REAL NOT NULL,
			fees_usd REAL NOT NULL,
			net_pnl REAL NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('success','failed','partial')),
			timestamp TEXT NOT NULL,
			tx_hashes TEXT NOT NULL,
			error TEXT,
			buy_tx TEXT,
			sell_tx TEXT,
			recovery_needed INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
		CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
	`)
	return err
}

// LogTrade persists a completed arbitrage attempt to the database.
func LogTrade(opp types.ArbitrageOpportunity, result types.TradeResult, amount float64) error {
	conn, err := GetDB()
	if err != nil {
		return err
	}

	txHashes := []string{}
	if result.BuyTx != nil {
		txHashes = append(txHashes, *result.BuyTx)
	}
	if result.SellTx != nil {
		txHashes = append(txHashes, *result.SellTx)
	}
	hashesJSON, _ := json.Marshal(txHashes)

	var errStr *string
	if result.Error != nil {
		errStr = result.Error
	}

	recoveryNeeded := 0
	if result.Status == types.TradePartial {
		recoveryNeeded = 1
	}

	_, err = conn.Exec(`
		INSERT INTO trades
			(id, pair, buy_dex, sell_dex, buy_price, sell_price, amount,
			 profit_usd, fees_usd, net_pnl, status, timestamp, tx_hashes, error,
			 buy_tx, sell_tx, recovery_needed)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		result.TradeID, opp.Pair, opp.BuyDex, opp.SellDex,
		opp.BuyPrice, opp.SellPrice, amount,
		result.ProfitUSD, result.FeesUSD, result.NetPnLUSD,
		string(result.Status), result.Timestamp, string(hashesJSON),
		errStr, result.BuyTx, result.SellTx, recoveryNeeded,
	)
	return err
}

// GetDailyStats returns aggregated trading statistics for the given date (YYYY-MM-DD).
// When date is empty, today's date (UTC) is used.
func GetDailyStats(date string) (types.DailyStats, error) {
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}

	conn, err := GetDB()
	if err != nil {
		return types.DailyStats{}, err
	}

	row := conn.QueryRow(`
		SELECT
			COUNT(*) as trade_count,
			COALESCE(SUM(net_pnl), 0) as total_pnl,
			SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as wins,
			COALESCE(MAX(net_pnl), 0) as best_trade,
			COALESCE(MIN(net_pnl), 0) as worst_trade
		FROM trades
		WHERE date(timestamp) = ?`, date)

	var tradeCount, wins int
	var totalPnL, bestTrade, worstTrade float64
	if err := row.Scan(&tradeCount, &totalPnL, &wins, &bestTrade, &worstTrade); err != nil {
		return types.DailyStats{}, fmt.Errorf("query daily stats: %w", err)
	}

	winRate := 0.0
	if tradeCount > 0 {
		winRate = float64(wins) / float64(tradeCount) * 100
	}

	return types.DailyStats{
		Date:       date,
		TotalPnL:   round2(totalPnL),
		TradeCount: tradeCount,
		WinRate:    round1(winRate),
		BestTrade:  round2(bestTrade),
		WorstTrade: round2(worstTrade),
	}, nil
}

// GetRecentTrades returns the most recent n trades ordered by timestamp descending.
func GetRecentTrades(limit int) ([]types.TradeRecord, error) {
	conn, err := GetDB()
	if err != nil {
		return nil, err
	}

	rows, err := conn.Query(`
		SELECT id, pair, buy_dex, sell_dex, buy_price, sell_price, amount,
		       profit_usd, fees_usd, net_pnl, status, timestamp, tx_hashes
		FROM trades
		ORDER BY timestamp DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []types.TradeRecord
	for rows.Next() {
		var r types.TradeRecord
		var hashesJSON string
		if err := rows.Scan(
			&r.ID, &r.Pair, &r.BuyDex, &r.SellDex,
			&r.BuyPrice, &r.SellPrice, &r.Amount,
			&r.ProfitUSD, &r.FeesUSD, &r.NetPnL,
			&r.Status, &r.Timestamp, &hashesJSON,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(hashesJSON), &r.TxHashes)
		records = append(records, r)
	}
	return records, rows.Err()
}

// GetLifetimePnL returns the sum of net_pnl across all recorded trades.
func GetLifetimePnL() (float64, error) {
	conn, err := GetDB()
	if err != nil {
		return 0, err
	}
	var total float64
	err = conn.QueryRow("SELECT COALESCE(SUM(net_pnl), 0) FROM trades").Scan(&total)
	return round2(total), err
}

// RecoveryTrade is a partial trade where the buy succeeded but the sell failed.
type RecoveryTrade struct {
	ID        string
	Pair      string
	BuyTx     string
	Timestamp string
	Amount    float64
}

// GetTradesNeedingRecovery returns partial trades where the buy succeeded but the sell failed.
func GetTradesNeedingRecovery() ([]RecoveryTrade, error) {
	conn, err := GetDB()
	if err != nil {
		return nil, err
	}
	rows, err := conn.Query(`
		SELECT id, pair, COALESCE(buy_tx,''), timestamp, amount
		FROM trades
		WHERE recovery_needed = 1
		ORDER BY timestamp DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []RecoveryTrade
	for rows.Next() {
		var r RecoveryTrade
		if err := rows.Scan(&r.ID, &r.Pair, &r.BuyTx, &r.Timestamp, &r.Amount); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// CloseDB closes the singleton database connection.
func CloseDB() {
	mu.Lock()
	defer mu.Unlock()
	if db != nil {
		db.Close()
		db = nil
	}
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round1(v float64) float64 { return math.Round(v*10) / 10 }
