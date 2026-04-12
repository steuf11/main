package tradeexec

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/steuf11/arb-bot/internal/types"
)

const (
	jupiterQuoteURL = "https://quote-api.jup.ag/v6/quote"
	jupiterSwapURL  = "https://quote-api.jup.ag/v6/swap"

	// Well-known token mints
	solMint  = "So11111111111111111111111111111111111111112"
	usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

	lamportsPerSOL = 1_000_000_000
	usdcDecimals   = 1_000_000

	maxRetries  = 3
	httpTimeout = 30 * time.Second
)

var httpClient = &http.Client{Timeout: httpTimeout}

// jupiterQuoteResponse is a partial decode of the Jupiter v6 quote response.
type jupiterQuoteResponse struct {
	InputMint            string `json:"inputMint"`
	OutputMint           string `json:"outputMint"`
	InAmount             string `json:"inAmount"`
	OutAmount            string `json:"outAmount"`
	OtherAmountThreshold string `json:"otherAmountThreshold"`
	SlippageBps          int    `json:"slippageBps"`
}

type jupiterSwapRequest struct {
	QuoteResponse         jupiterQuoteResponse `json:"quoteResponse"`
	UserPublicKey         string               `json:"userPublicKey"`
	WrapAndUnwrapSol      bool                 `json:"wrapAndUnwrapSol"`
	ComputeUnitPriceMicroLamports int          `json:"computeUnitPriceMicroLamports,omitempty"`
}

type jupiterSwapResponse struct {
	SwapTransaction string `json:"swapTransaction"`
}

// ExecuteArbitrage attempts a two-leg arbitrage: buy on opp.BuyDex, sell on opp.SellDex.
// walletPubkey is the base58-encoded public key of the trading wallet.
// In the current implementation, the actual Solana transaction signing is stubbed —
// integrate a Solana Go SDK (e.g. gagliardetto/solana-go) to send real transactions.
func ExecuteArbitrage(
	opp types.ArbitrageOpportunity,
	rpcURL string,
	walletPubkey string,
	tradeSizeUSD float64,
	slippagePct float64,
) (types.TradeResult, error) {
	tradeID := uuid.New().String()
	slippageBps := int(slippagePct * 100)

	result := types.TradeResult{
		TradeID:   tradeID,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	// --- Leg 1: buy (USDC → SOL on buyDex via Jupiter routing) ---
	buyQuote, err := getJupiterQuote(usdcMint, solMint, int64(tradeSizeUSD*float64(usdcDecimals)), slippageBps)
	if err != nil {
		errMsg := fmt.Sprintf("buy quote failed: %v", err)
		result.Status = types.TradeFailed
		result.Error = &errMsg
		return result, nil
	}

	buyTxHash, err := buildAndSendSwap(buyQuote, walletPubkey)
	if err != nil {
		errMsg := fmt.Sprintf("buy swap failed: %v", err)
		result.Status = types.TradeFailed
		result.Error = &errMsg
		return result, nil
	}
	result.BuyTx = &buyTxHash

	// --- Leg 2: sell (SOL → USDC on sellDex via Jupiter routing) ---
	// Derive SOL amount from the buy output (stub: use opp.EstimatedProfitUSD as proxy).
	solAmount := int64((tradeSizeUSD / opp.BuyPrice) * float64(lamportsPerSOL))
	sellQuote, err := getJupiterQuote(solMint, usdcMint, solAmount, slippageBps)
	if err != nil {
		errMsg := fmt.Sprintf("sell quote failed: %v", err)
		result.Status = types.TradePartial
		result.Error = &errMsg
		return result, nil
	}

	sellTxHash, err := buildAndSendSwap(sellQuote, walletPubkey)
	if err != nil {
		errMsg := fmt.Sprintf("sell swap failed: %v", err)
		result.Status = types.TradePartial
		result.Error = &errMsg
		return result, nil
	}
	result.SellTx = &sellTxHash

	// Compute approximate PnL (in production, derive from actual on-chain amounts).
	result.FeesUSD = (opp.BuyPrice*tradeSizeUSD + opp.SellPrice*tradeSizeUSD) * 0.003
	result.ProfitUSD = opp.EstimatedProfitUSD + result.FeesUSD
	result.NetPnLUSD = opp.EstimatedProfitUSD
	result.Status = types.TradeSuccess
	return result, nil
}

func getJupiterQuote(inputMint, outputMint string, amount int64, slippageBps int) (jupiterQuoteResponse, error) {
	url := fmt.Sprintf(
		"%s?inputMint=%s&outputMint=%s&amount=%d&slippageBps=%d",
		jupiterQuoteURL, inputMint, outputMint, amount, slippageBps,
	)

	var quote jupiterQuoteResponse
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(1<<attempt) * time.Second)
		}
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
		if err != nil {
			return quote, err
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			lastErr = fmt.Errorf("jupiter quote HTTP %d: %s", resp.StatusCode, body)
			continue
		}
		if err := json.Unmarshal(body, &quote); err != nil {
			return quote, err
		}
		return quote, nil
	}
	return quote, fmt.Errorf("jupiter quote failed after %d attempts: %w", maxRetries, lastErr)
}

// buildAndSendSwap is a stub that requests a swap transaction from Jupiter and
// returns a simulated transaction signature.  In production, deserialise the
// VersionedTransaction, sign it with the wallet keypair, and submit it via RPC.
func buildAndSendSwap(quote jupiterQuoteResponse, walletPubkey string) (string, error) {
	payload := jupiterSwapRequest{
		QuoteResponse:    quote,
		UserPublicKey:    walletPubkey,
		WrapAndUnwrapSol: true,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, jupiterSwapURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("jupiter swap HTTP %d: %s", resp.StatusCode, respBody)
	}

	var swapResp jupiterSwapResponse
	if err := json.Unmarshal(respBody, &swapResp); err != nil {
		return "", err
	}

	// TODO: sign swapResp.SwapTransaction with the wallet and submit via RPC.
	// Return a placeholder signature until Solana signing is wired up.
	return fmt.Sprintf("stub-sig-%s", uuid.New().String()[:8]), nil
}
