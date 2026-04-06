# Solana DEX Arbitrage Bot

Monitors Jupiter, Orca, and Raydium for price discrepancies and executes profitable arbitrage trades automatically, with Telegram alerts and SQLite P&L logging.

## Architecture

```
DEX Price Monitor (every 30s)
    ↓
Spread Calculator (net spread after fees & slippage)
    ↓
Profitability Filter (>0.5% net spread by default)
    ↓
Trade Executor (two-leg swap via Jupiter API)
    ↓
PnL Logger (SQLite)
    ↓
Telegram Alert
```

## Project Structure

```
src/
  config.ts           — Load & validate env vars
  types.ts            — Shared TypeScript interfaces
  dex-monitor.ts      — Jupiter, Orca, Raydium price fetchers
  spread-calculator.ts — Arbitrage opportunity detection
  trade-executor.ts   — Solana transaction builder & sender
  pnl-logger.ts       — SQLite trade log & stats queries
  telegram-alerts.ts  — Telegram notification service
  main.ts             — Cron orchestrator (30s monitor, 23:00 report)
tests/
  spread-calculator.test.ts
  pnl-logger.test.ts
```

## Setup

### 1. Prerequisites

- Node.js ≥ 18
- A Solana wallet funded with SOL (min 0.05 SOL for fees) and USDC
- A Telegram bot token (create via [@BotFather](https://t.me/BotFather))

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WALLET_KEY=<your-base58-private-key>
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>
MAX_TRADE_SIZE_USD=100
SLIPPAGE_TOLERANCE_PCT=0.5
MIN_SPREAD_PCT=0.5
```

> **Security:** never commit your `.env` file. Use a dedicated trading wallet with only the funds you're willing to risk.

### 4. Run

```bash
# Development (ts-node, no build step)
npm run dev

# Production
npm run build
npm start
```

### 5. Tests

```bash
npm test
```

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | mainnet-beta public | Solana RPC endpoint |
| `SOLANA_WALLET_KEY` | required | Base58 private key |
| `JUPITER_API_KEY` | (empty) | Optional Jupiter API key |
| `TELEGRAM_BOT_TOKEN` | required | Telegram bot token |
| `TELEGRAM_CHAT_ID` | required | Target chat/user ID |
| `MAX_TRADE_SIZE_USD` | 100 | Max per-trade size in USD |
| `SLIPPAGE_TOLERANCE_PCT` | 0.5 | Max acceptable slippage % per leg |
| `MIN_SPREAD_PCT` | 0.5 | Minimum net spread % to execute |

## Risk Management

- Maximum trade size capped at `MAX_TRADE_SIZE_USD`
- Slippage tolerance enforced per leg before execution
- Wallet SOL balance checked before every trade (min 0.05 SOL)
- Partial trades (buy succeeded, sell failed) trigger an urgent Telegram alert
- 3 retries with exponential backoff on transaction failure
- Concurrent trade guard — only one trade executes at a time

## Telegram Alerts

| Event | Alert |
|---|---|
| Bot startup | Startup message |
| Successful trade | P&L breakdown + tx hashes |
| Failed trade | Reason + expected profit missed |
| Partial trade | Urgent — manual action required |
| Daily report | 23:00 UTC summary |
| Unhandled error | Error context |

## Deployment (VPS / Linux)

```bash
# Build
npm run build

# Run with PM2
npm install -g pm2
pm2 start dist/main.js --name arb-bot
pm2 save
pm2 startup
```

## Disclaimer

This software executes real financial transactions on Solana mainnet. Use at your own risk. Always test on devnet first, start with small amounts, and never invest more than you can afford to lose.
