package spreadcalc_test

import (
	"testing"

	"github.com/steuf11/arb-bot/internal/spreadcalc"
	"github.com/steuf11/arb-bot/internal/types"
)

// basePriceData mirrors the fixture in the TypeScript test suite.
// raydium→orca: (80.50 - 79.28) / 79.28 ≈ 1.54% raw spread → ~0.99% net after fees
var basePriceData = types.PriceData{
	Pair:      "SOL/USDC",
	Timestamp: "2024-01-01T00:00:00.000Z",
	Prices: map[string]types.DexPrice{
		"raydium": {Dex: "raydium", Price: 79.28, Liquidity: 8_000_000, Fee: 0.0025},
		"orca":    {Dex: "orca", Price: 80.50, Liquidity: 2_000_000, Fee: 0.003},
		"jupiter": {Dex: "jupiter", Price: 79.80, Liquidity: 5_000_000, Fee: 0.0025},
	},
}

func TestSortedByProfitDescending(t *testing.T) {
	ops := spreadcalc.FindArbitrageOpportunities(basePriceData, 100, 0.01, 1.0)
	if len(ops) == 0 {
		t.Fatal("expected at least one opportunity")
	}
	for i := 1; i < len(ops); i++ {
		if ops[i-1].EstimatedProfitUSD < ops[i].EstimatedProfitUSD {
			t.Errorf("results not sorted: ops[%d].profit=%.4f < ops[%d].profit=%.4f",
				i-1, ops[i-1].EstimatedProfitUSD, i, ops[i].EstimatedProfitUSD)
		}
	}
}

func TestRaydiumToOrcaIdentified(t *testing.T) {
	ops := spreadcalc.FindArbitrageOpportunities(basePriceData, 100, 0.01, 1.0)
	for _, op := range ops {
		if op.BuyDex == "raydium" && op.SellDex == "orca" {
			if op.SellPrice <= op.BuyPrice {
				t.Errorf("sell price %.4f should be > buy price %.4f", op.SellPrice, op.BuyPrice)
			}
			return
		}
	}
	t.Fatal("raydium→orca opportunity not found")
}

func TestFiltersOutBelowMinSpread(t *testing.T) {
	ops := spreadcalc.FindArbitrageOpportunities(basePriceData, 100, 100, 1.0)
	if len(ops) != 0 {
		t.Errorf("expected 0 opportunities with very high min spread, got %d", len(ops))
	}
}

func TestFeesDeductedFromSpread(t *testing.T) {
	ops := spreadcalc.FindArbitrageOpportunities(basePriceData, 100, 0.0, 1.0)
	var found *types.ArbitrageOpportunity
	for i := range ops {
		if ops[i].BuyDex == "raydium" && ops[i].SellDex == "orca" {
			found = &ops[i]
			break
		}
	}
	if found == nil {
		t.Fatal("raydium→orca opportunity not found")
	}
	rawSpread := ((80.50 - 79.28) / 79.28) * 100
	if found.SpreadPct >= rawSpread {
		t.Errorf("net spread %.4f should be less than raw spread %.4f", found.SpreadPct, rawSpread)
	}
}

func TestHighSlippageRejected(t *testing.T) {
	tightPrices := types.PriceData{
		Pair:      "SOL/USDC",
		Timestamp: "2024-01-01T00:00:00.000Z",
		Prices: map[string]types.DexPrice{
			"dex1": {Dex: "dex1", Price: 100.0, Liquidity: 500, Fee: 0.003},
			"dex2": {Dex: "dex2", Price: 100.1, Liquidity: 500, Fee: 0.003},
		},
	}
	ops := spreadcalc.FindArbitrageOpportunities(tightPrices, 100, 0.5, 0.5)
	if len(ops) != 0 {
		t.Errorf("expected 0 opportunities due to high slippage, got %d", len(ops))
	}
}

func TestBuyPriceAlwaysLowerThanSellPrice(t *testing.T) {
	ops := spreadcalc.FindArbitrageOpportunities(basePriceData, 100, 0.0, 1.0)
	for _, op := range ops {
		if op.BuyPrice >= op.SellPrice {
			t.Errorf("buy price %.4f >= sell price %.4f for %s→%s",
				op.BuyPrice, op.SellPrice, op.BuyDex, op.SellDex)
		}
	}
}

func TestConfidenceInRange(t *testing.T) {
	ops := spreadcalc.FindArbitrageOpportunities(basePriceData, 100, 0.0, 1.0)
	for _, op := range ops {
		if op.Confidence < 0 || op.Confidence > 1 {
			t.Errorf("confidence %.4f out of [0,1] for %s→%s",
				op.Confidence, op.BuyDex, op.SellDex)
		}
	}
}

func TestSingleDexNoOpportunities(t *testing.T) {
	singleDex := types.PriceData{
		Pair:      "SOL/USDC",
		Timestamp: "2024-01-01T00:00:00.000Z",
		Prices: map[string]types.DexPrice{
			"raydium": {Dex: "raydium", Price: 79.28, Liquidity: 8_000_000, Fee: 0.0025},
		},
	}
	ops := spreadcalc.FindArbitrageOpportunities(singleDex, 100, 0.0, 1.0)
	if len(ops) != 0 {
		t.Errorf("expected 0 opportunities with single DEX, got %d", len(ops))
	}
}
