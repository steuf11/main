import * as cron from "node-cron";
import dotenv from "dotenv";
import type { AgentExecutor } from "langchain/agents";
import { createAgent, runAgentCycle } from "./agent";
import { detectPolymarketOpportunity, detectPokemonOpportunity } from "./utils/opportunity";
import { initTelegramBot } from "./utils/telegram";
import { logger } from "./utils/logger";

dotenv.config();

function validateEnv(): void {
  const required = [
    "ANTHROPIC_API_KEY",
    "THIRDWEB_CLIENT_ID",
    "THIRDWEB_SECRET_KEY",
    "WALLET_PRIVATE_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(", ")}`);
  }
}

async function runMissionA(agent: AgentExecutor): Promise<void> {
  logger.info("🔍 Mission A — Scan Polymarket...");
  try {
    const opp = await detectPolymarketOpportunity();
    if (!opp.detected) {
      logger.info("✅ Mission A — Aucune opportunité Polymarket détectée");
      return;
    }

    logger.info("🎯 Mission A — Opportunité détectée", {
      marketId: opp.marketId,
      question: opp.question,
      ev: opp.expectedValue,
    });

    await runAgentCycle(agent, {
      mission: "polymarket",
      prompt: `Analyse cette opportunité Polymarket et décide si elle vaut l'exécution :
- Marché : ${opp.question}
- Prix actuel : ${opp.currentOdds}
- EV estimé : ${opp.expectedValue?.toFixed(2)}%
- Montant suggéré : ${opp.suggestedAmount} USDC
- Contract : ${opp.contractAddress || process.env["POLYMARKET_CONTRACT_ADDRESS"]}

Utilise polymarket_scan pour vérifier l'orderbook puis transaction_execute si EV > 5% et confiance > 60%.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("❌ Mission A erreur", { err: message });
  }
}

async function runMissionB(agent: AgentExecutor): Promise<void> {
  logger.info("🃏 Mission B — Scan Pokémon RWA...");
  try {
    const opp = await detectPokemonOpportunity();
    if (!opp.detected) {
      logger.info("✅ Mission B — Aucun arbitrage Pokémon RWA détecté");
      return;
    }

    logger.info("🎯 Mission B — Arbitrage détecté", {
      collection: opp.collection,
      floorPriceUSD: opp.floorPriceUSD,
      discountPct: opp.discountPct,
    });

    await runAgentCycle(agent, {
      mission: "pokemon_rwa",
      prompt: `Analyse cette opportunité Pokémon RWA et décide si elle vaut l'exécution :
- Collection : ${opp.collection}
- Floor price : ${opp.floorPriceUSD} USD
- Seuil cible : ${opp.thresholdUSD} USD
- Discount : ${opp.discountPct?.toFixed(1)}%
- Token ID : ${opp.tokenId}
- Contract : ${opp.contractAddress}
- Chain : ${opp.chain}

Utilise pokemon_rwa_scan pour valider puis transaction_execute si discount > 10%.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("❌ Mission B erreur", { err: message });
  }
}

async function main(): Promise<void> {
  logger.info("🚀 Démarrage de l'agent autonome multi-chain...");

  try {
    validateEnv();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("❌ Validation env échouée", { err: message });
    process.exit(1);
  }

  const botToken  = process.env["TELEGRAM_BOT_TOKEN"]!;
  const chatId    = process.env["TELEGRAM_CHAT_ID"]!;
  const interval  = parseInt(process.env["CRON_INTERVAL_MINUTES"] || "15", 10);

  initTelegramBot(botToken, chatId);

  let agent: AgentExecutor;
  try {
    agent = await createAgent({
      anthropicApiKey:   process.env["ANTHROPIC_API_KEY"]!,
      thirdwebClientId:  process.env["THIRDWEB_CLIENT_ID"]!,
      thirdwebSecretKey: process.env["THIRDWEB_SECRET_KEY"]!,
      privateKey:        process.env["WALLET_PRIVATE_KEY"]!,
      telegramBotToken:  botToken,
      telegramChatId:    chatId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("❌ Impossible de créer l'agent", { err: message });
    process.exit(1);
  }

  logger.info(`⏰ Planification CRON toutes les ${interval} minutes`);

  cron.schedule(`*/${interval} * * * *`, async () => {
    logger.info("⏰ CRON déclenché — lancement des missions");
    await runMissionA(agent);
    await runMissionB(agent);
  });

  // Lancer un premier cycle immédiatement au démarrage
  logger.info("▶️ Premier cycle au démarrage...");
  await runMissionA(agent);
  await runMissionB(agent);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`🛑 Signal ${signal} reçu — arrêt propre`);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("💥 Erreur fatale", { err: message });
  process.exit(1);
});
