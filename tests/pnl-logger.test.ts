import path from "path";
import fs from "fs";

// Use a temp DB for tests
process.env["DB_PATH_OVERRIDE"] = path.join(__dirname, "test-trades.db");

// We need to patch the DB path before importing pnl-logger
// Since better-sqlite3 creates the file on open, we just make sure cleanup happens.
const TEST_DB = path.join(__dirname, "test-trades.db");

afterAll(() => {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
});

// Reimport after env setup
import { logTrade, getDailyStats, getRecentTrades, getLifetimePnL, closeDb } from "../src/pnl-logger";
import { ArbitrageOpportunity, TradeResult } from "../src/types";

const mockOpportunity: ArbitrageOpportunity = {
  pair: "SOL/USDC",
  buy_dex: "raydium",
  buy_price: 79.28,
  sell_dex: "orca",
  sell_price: 79.45,
  spread_pct: 0.21,
  estimated_profit_usd: 42.5,
  confidence: 0.85,
};

// IDs are generated fresh each test run to avoid UNIQUE constraint failures
function makeSuccessResult(): TradeResult {
  return {
    trade_id: `test-${Date.now()}-success`,
    status: "success",
    buy_tx: "txhash1",
    sell_tx: "txhash2",
    profit_usd: 38.2,
    fees_usd: 4.3,
    net_pnl_usd: 33.9,
    timestamp: new Date().toISOString(),
  };
}

function makeFailedResult(): TradeResult {
  return {
    trade_id: `test-${Date.now()}-failed`,
    status: "failed",
    buy_tx: null,
    sell_tx: null,
    profit_usd: 0,
    fees_usd: 0,
    net_pnl_usd: 0,
    timestamp: new Date().toISOString(),
    error: "Slippage exceeded",
  };
}

describe("PnL Logger", () => {
  beforeAll(() => {
    // Seed two trades so stats queries have data to work with
    logTrade(mockOpportunity, makeSuccessResult(), 100);
    logTrade(mockOpportunity, makeFailedResult(), 100);
  });

  afterAll(() => {
    closeDb();
  });

  it("logs a successful trade without throwing", () => {
    expect(() => logTrade(mockOpportunity, makeSuccessResult(), 100)).not.toThrow();
  });

  it("logs a failed trade without throwing", () => {
    expect(() => logTrade(mockOpportunity, makeFailedResult(), 100)).not.toThrow();
  });

  it("getDailyStats returns correct counts and PnL", () => {
    const today = new Date().toISOString().split("T")[0];
    const stats = getDailyStats(today);

    expect(stats.trade_count).toBeGreaterThanOrEqual(2);
    expect(stats.win_rate).toBeGreaterThanOrEqual(0);
    expect(stats.win_rate).toBeLessThanOrEqual(100);
    expect(typeof stats.total_pnl).toBe("number");
  });

  it("getRecentTrades returns an array", () => {
    const trades = getRecentTrades(5);
    expect(Array.isArray(trades)).toBe(true);
  });

  it("getLifetimePnL returns a number", () => {
    const pnl = getLifetimePnL();
    expect(typeof pnl).toBe("number");
  });

  it("tx_hashes are parsed back as arrays", () => {
    const trades = getRecentTrades(10);
    for (const trade of trades) {
      expect(Array.isArray(trade.tx_hashes)).toBe(true);
    }
  });
});
