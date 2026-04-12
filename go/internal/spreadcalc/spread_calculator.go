package spreadcalc

import (
	"math"
	"sort"

	"github.com/steuf11/arb-bot/internal/types"
)

// estimateSlippage returns an estimated slippage % using a simple linear model:
// slippage ≈ tradeSize / liquidity * 100.
// When liquidity is unknown (≤ 0) a conservative 1 % is assumed.
func estimateSlippage(liquidity, tradeSizeUSD float64) float64 {
	if liquidity <= 0 {
		return 1.0
	}
	return (tradeSizeUSD / liquidity) * 100
}

// calcConfidence scores an opportunity in [0, 1] based on liquidity depth and spread size.
func calcConfidence(buyLiquidity, sellLiquidity, spreadPct, tradeSizeUSD float64) float64 {
	minLiquidity := math.Min(buyLiquidity, sellLiquidity)
	liquidityScore := math.Min(1.0, minLiquidity/(tradeSizeUSD*20))
	spreadScore := math.Min(1.0, spreadPct/2) // cap at 2 % spread
	raw := liquidityScore*0.6 + spreadScore*0.4
	// Round to 2 decimal places.
	return math.Round(raw*100) / 100
}

// roundTo4 rounds v to 4 decimal places.
func roundTo4(v float64) float64 { return math.Round(v*10000) / 10000 }

// roundTo2 rounds v to 2 decimal places.
func roundTo2(v float64) float64 { return math.Round(v*100) / 100 }

// FindArbitrageOpportunities scans priceData for cross-DEX arbitrage opportunities.
// It deducts fees and estimated slippage from the raw spread, filters out pairs
// below minSpreadPct or where any leg exceeds slippageTolerancePct, and returns
// results sorted by estimated profit descending.
func FindArbitrageOpportunities(
	priceData types.PriceData,
	tradeSizeUSD,
	minSpreadPct,
	slippageTolerancePct float64,
) []types.ArbitrageOpportunity {
	var opportunities []types.ArbitrageOpportunity

	dexNames := make([]string, 0, len(priceData.Prices))
	for name := range priceData.Prices {
		dexNames = append(dexNames, name)
	}

	for i := range dexNames {
		for j := range dexNames {
			if i == j {
				continue
			}

			buyDex := dexNames[i]
			sellDex := dexNames[j]
			buyData := priceData.Prices[buyDex]
			sellData := priceData.Prices[sellDex]

			// We buy on buyDex (lower price) and sell on sellDex (higher price).
			if sellData.Price <= buyData.Price {
				continue
			}

			rawSpreadPct := ((sellData.Price - buyData.Price) / buyData.Price) * 100
			totalFeesPct := (buyData.Fee + sellData.Fee) * 100
			buySlippage := estimateSlippage(buyData.Liquidity, tradeSizeUSD)
			sellSlippage := estimateSlippage(sellData.Liquidity, tradeSizeUSD)
			totalSlippage := buySlippage + sellSlippage

			netSpreadPct := rawSpreadPct - totalFeesPct - totalSlippage

			if netSpreadPct < minSpreadPct {
				continue
			}

			// Reject if any leg's slippage exceeds the configured tolerance.
			if buySlippage > slippageTolerancePct || sellSlippage > slippageTolerancePct {
				continue
			}

			estimatedProfitUSD := (netSpreadPct / 100) * tradeSizeUSD
			confidence := calcConfidence(buyData.Liquidity, sellData.Liquidity, netSpreadPct, tradeSizeUSD)

			opportunities = append(opportunities, types.ArbitrageOpportunity{
				Pair:               priceData.Pair,
				BuyDex:             buyDex,
				BuyPrice:           buyData.Price,
				SellDex:            sellDex,
				SellPrice:          sellData.Price,
				SpreadPct:          roundTo4(netSpreadPct),
				EstimatedProfitUSD: roundTo2(estimatedProfitUSD),
				Confidence:         confidence,
			})
		}
	}

	// Sort by estimated profit descending.
	sort.Slice(opportunities, func(i, j int) bool {
		return opportunities[i].EstimatedProfitUSD > opportunities[j].EstimatedProfitUSD
	})

	return opportunities
}
