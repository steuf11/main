import Database from "better-sqlite3";
import path from "path";
import { DailyStats, TradeRecord, TradeResult } from "./types";
import { ArbitrageOpportunity } from "./types";

const DB_PATH = path.join(process.cwd(), "trades.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
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
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
      timestamp TEXT NOT NULL,
      tx_hashes TEXT NOT NULL,
      error TEXT,
      buy_tx TEXT,
      sell_tx TEXT,
      recovery_needed INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
  `);

  // Fix #11: migrate existing DBs — add columns if they don't exist yet
  const cols = (
    database.prepare("PRAGMA table_info(trades)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);

  if (!cols.includes("buy_tx")) {
    database.exec("ALTER TABLE trades ADD COLUMN buy_tx TEXT");
  }
  if (!cols.includes("sell_tx")) {
    database.exec("ALTER TABLE trades ADD COLUMN sell_tx TEXT");
  }
  if (!cols.includes("recovery_needed")) {
    database.exec(
      "ALTER TABLE trades ADD COLUMN recovery_needed INTEGER NOT NULL DEFAULT 0"
    );
  }
}

export function logTrade(
  opportunity: ArbitrageOpportunity,
  result: TradeResult,
  amount: number
): void {
  const database = getDb();
  const txHashes = [result.buy_tx, result.sell_tx].filter(Boolean);

  const stmt = database.prepare(`
    INSERT INTO trades
      (id, pair, buy_dex, sell_dex, buy_price, sell_price, amount,
       profit_usd, fees_usd, net_pnl, status, timestamp, tx_hashes, error,
       buy_tx, sell_tx, recovery_needed)
    VALUES
      (@id, @pair, @buy_dex, @sell_dex, @buy_price, @sell_price, @amount,
       @profit_usd, @fees_usd, @net_pnl, @status, @timestamp, @tx_hashes, @error,
       @buy_tx, @sell_tx, @recovery_needed)
  `);

  // Fix #11: partial trades flagged for recovery — buy succeeded but sell failed
  const recoveryNeeded = result.status === "partial" ? 1 : 0;

  stmt.run({
    id: result.trade_id,
    pair: opportunity.pair,
    buy_dex: opportunity.buy_dex,
    sell_dex: opportunity.sell_dex,
    buy_price: opportunity.buy_price,
    sell_price: opportunity.sell_price,
    amount,
    profit_usd: result.profit_usd,
    fees_usd: result.fees_usd,
    net_pnl: result.net_pnl_usd,
    status: result.status,
    timestamp: result.timestamp,
    tx_hashes: JSON.stringify(txHashes),
    error: result.error ?? null,
    buy_tx: result.buy_tx ?? null,
    sell_tx: result.sell_tx ?? null,
    recovery_needed: recoveryNeeded,
  });
}

export function getDailyStats(date?: string): DailyStats {
  const database = getDb();
  const targetDate = date ?? new Date().toISOString().split("T")[0];

  const row = database
    .prepare(
      `
    SELECT
      COUNT(*) as trade_count,
      SUM(net_pnl) as total_pnl,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as wins,
      MAX(net_pnl) as best_trade,
      MIN(net_pnl) as worst_trade
    FROM trades
    WHERE date(timestamp) = ?
  `
    )
    .get(targetDate) as {
    trade_count: number;
    total_pnl: number | null;
    wins: number;
    best_trade: number | null;
    worst_trade: number | null;
  };

  const winRate =
    row.trade_count > 0 ? (row.wins / row.trade_count) * 100 : 0;

  return {
    date: targetDate,
    total_pnl: parseFloat((row.total_pnl ?? 0).toFixed(2)),
    trade_count: row.trade_count,
    win_rate: parseFloat(winRate.toFixed(1)),
    best_trade: parseFloat((row.best_trade ?? 0).toFixed(2)),
    worst_trade: parseFloat((row.worst_trade ?? 0).toFixed(2)),
  };
}

export function getRecentTrades(limit: number = 10): TradeRecord[] {
  const database = getDb();
  const rows = database
    .prepare(
      `
    SELECT * FROM trades
    ORDER BY timestamp DESC
    LIMIT ?
  `
    )
    .all(limit) as Array<
    Omit<TradeRecord, "tx_hashes"> & { tx_hashes: string }
  >;

  return rows.map((r) => ({
    ...r,
    tx_hashes: JSON.parse(r.tx_hashes) as string[],
  }));
}

export function getLifetimePnL(): number {
  const database = getDb();
  const row = database
    .prepare("SELECT COALESCE(SUM(net_pnl), 0) as total FROM trades")
    .get() as { total: number };
  return parseFloat(row.total.toFixed(2));
}

/** Returns partial trades where the buy succeeded but sell failed — need manual recovery. */
export function getTradesNeedingRecovery(): Array<{
  id: string;
  pair: string;
  buy_tx: string;
  timestamp: string;
  amount: number;
}> {
  const database = getDb();
  return database
    .prepare(
      `SELECT id, pair, buy_tx, timestamp, amount
       FROM trades
       WHERE recovery_needed = 1
       ORDER BY timestamp DESC`
    )
    .all() as Array<{
    id: string;
    pair: string;
    buy_tx: string;
    timestamp: string;
    amount: number;
  }>;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
