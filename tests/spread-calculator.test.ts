import { findArbitrageOpportunities } from "../src/spread-calculator";
import { PriceData } from "../src/types";

// Spread must be large enough to cover fees (0.0025 + 0.003 = 0.55% combined)
// raydium→orca: (80.50 - 79.28) / 79.28 ≈ 1.54% raw spread → ~0.99% net after fees
const basePriceData: PriceData = {
  pair: "SOL/USDC",
  timestamp: "2024-01-01T00:00:00.000Z",
  prices: {
    raydium: { dex: "raydium", price: 79.28, liquidity: 8_000_000, fee: 0.0025 },
    orca:    { dex: "orca",    price: 80.50, liquidity: 2_000_000, fee: 0.003  },
    jupiter: { dex: "jupiter", price: 79.80, liquidity: 5_000_000, fee: 0.0025 },
  },
};

describe("findArbitrageOpportunities", () => {
  it("returns opportunities sorted by estimated profit descending", () => {
    const ops = findArbitrageOpportunities(basePriceData, 100, 0.01, 1.0);
    expect(ops.length).toBeGreaterThan(0);
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i - 1].estimated_profit_usd).toBeGreaterThanOrEqual(
        ops[i].estimated_profit_usd
      );
    }
  });

  it("identifies raydium → orca as a valid opportunity", () => {
    const ops = findArbitrageOpportunities(basePriceData, 100, 0.01, 1.0);
    const op = ops.find(
      (o) => o.buy_dex === "raydium" && o.sell_dex === "orca"
    );
    expect(op).toBeDefined();
    expect(op!.sell_price).toBeGreaterThan(op!.buy_price);
  });

  it("filters out opportunities below min spread", () => {
    // With a very high min spread, no opportunities should pass
    const ops = findArbitrageOpportunities(basePriceData, 100, 100, 1.0);
    expect(ops).toHaveLength(0);
  });

  it("deducts fees from spread", () => {
    const ops = findArbitrageOpportunities(basePriceData, 100, 0.0, 1.0);
    const op = ops.find(
      (o) => o.buy_dex === "raydium" && o.sell_dex === "orca"
    );
    expect(op).toBeDefined();

    // Raw spread = (80.50 - 79.28) / 79.28 ≈ 1.54%
    // Fees = (0.0025 + 0.003) * 100 = 0.55% → net ≈ 0.99%
    // Net spread must be strictly less than raw spread
    const rawSpread = ((80.50 - 79.28) / 79.28) * 100;
    expect(op!.spread_pct).toBeLessThan(rawSpread);
  });

  it("rejects pairs with insufficient spread after slippage", () => {
    const tightPrices: PriceData = {
      pair: "SOL/USDC",
      timestamp: new Date().toISOString(),
      prices: {
        dex1: { dex: "dex1", price: 100.0, liquidity: 500, fee: 0.003 },
        dex2: { dex: "dex2", price: 100.1, liquidity: 500, fee: 0.003 },
      },
    };
    // Very low liquidity should cause high slippage, rejecting the trade
    const ops = findArbitrageOpportunities(tightPrices, 100, 0.5, 0.5);
    expect(ops).toHaveLength(0);
  });

  it("never returns an opportunity where buy_price >= sell_price", () => {
    const ops = findArbitrageOpportunities(basePriceData, 100, 0.0, 1.0);
    for (const op of ops) {
      expect(op.sell_price).toBeGreaterThan(op.buy_price);
    }
  });

  it("assigns confidence between 0 and 1", () => {
    const ops = findArbitrageOpportunities(basePriceData, 100, 0.0, 1.0);
    for (const op of ops) {
      expect(op.confidence).toBeGreaterThanOrEqual(0);
      expect(op.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns empty array when only one DEX has data", () => {
    const singleDex: PriceData = {
      pair: "SOL/USDC",
      timestamp: new Date().toISOString(),
      prices: {
        raydium: { dex: "raydium", price: 79.28, liquidity: 8_000_000, fee: 0.0025 },
      },
    };
    const ops = findArbitrageOpportunities(singleDex, 100, 0.0, 1.0);
    expect(ops).toHaveLength(0);
  });
});
