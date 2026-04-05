import { ArbitrageOpportunity, PriceData } from "./types";

/**
 * Estimate slippage based on trade size vs available liquidity.
 * Simple linear model: slippage_pct ≈ tradeSize / liquidity * 100.
 */
function estimateSlippage(
  liquidity: number,
  tradeSizeUsd: number
): number {
  if (liquidity <= 0) return 0.01; // assume 1% for unknown liquidity
  return (tradeSizeUsd / liquidity) * 100;
}

/**
 * Calculate confidence score based on liquidity depth and spread size.
 * Returns value between 0 and 1.
 */
function calcConfidence(
  buyLiquidity: number,
  sellLiquidity: number,
  spreadPct: number,
  tradeSizeUsd: number
): number {
  const minLiquidity = Math.min(buyLiquidity, sellLiquidity);
  const liquidityScore = Math.min(1, minLiquidity / (tradeSizeUsd * 20));
  const spreadScore = Math.min(1, spreadPct / 2); // cap at 2% spread
  return parseFloat(((liquidityScore * 0.6 + spreadScore * 0.4)).toFixed(2));
}

export function findArbitrageOpportunities(
  priceData: PriceData,
  tradeSizeUsd: number,
  minSpreadPct: number,
  slippageTolerancePct: number
): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  const dexNames = Object.keys(priceData.prices);

  for (let i = 0; i < dexNames.length; i++) {
    for (let j = 0; j < dexNames.length; j++) {
      if (i === j) continue;

      const buyDex = dexNames[i];
      const sellDex = dexNames[j];
      const buyData = priceData.prices[buyDex];
      const sellData = priceData.prices[sellDex];

      // We buy on buyDex (lower price) and sell on sellDex (higher price)
      if (sellData.price <= buyData.price) continue;

      const rawSpreadPct =
        ((sellData.price - buyData.price) / buyData.price) * 100;

      const totalFeesPct = (buyData.fee + sellData.fee) * 100;
      const buySlippage = estimateSlippage(buyData.liquidity, tradeSizeUsd);
      const sellSlippage = estimateSlippage(sellData.liquidity, tradeSizeUsd);
      const totalSlippage = buySlippage + sellSlippage;

      const netSpreadPct = rawSpreadPct - totalFeesPct - totalSlippage;

      if (netSpreadPct < minSpreadPct) continue;

      // Reject if any leg slippage exceeds tolerance
      if (
        buySlippage > slippageTolerancePct ||
        sellSlippage > slippageTolerancePct
      ) {
        continue;
      }

      const estimatedProfitUsd = (netSpreadPct / 100) * tradeSizeUsd;
      const confidence = calcConfidence(
        buyData.liquidity,
        sellData.liquidity,
        netSpreadPct,
        tradeSizeUsd
      );

      opportunities.push({
        pair: priceData.pair,
        buy_dex: buyDex,
        buy_price: buyData.price,
        sell_dex: sellDex,
        sell_price: sellData.price,
        spread_pct: parseFloat(netSpreadPct.toFixed(4)),
        estimated_profit_usd: parseFloat(estimatedProfitUsd.toFixed(2)),
        confidence,
      });
    }
  }

  // Sort by estimated profit descending
  return opportunities.sort(
    (a, b) => b.estimated_profit_usd - a.estimated_profit_usd
  );
}
