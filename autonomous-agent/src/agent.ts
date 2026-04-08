import { ChatAnthropic } from "@langchain/anthropic";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { createThirdwebClient } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { polymarketScanTool } from "./tools/polymarket.tool";
import { pokemonRWAScanTool } from "./tools/pokemon-rwa.tool";
import { transactionTool } from "./tools/transaction.tool";
import { logger } from "./utils/logger";
import type { AgentContext } from "./types";

export interface AgentConfig {
  anthropicApiKey: string;
  thirdwebClientId: string;
  thirdwebSecretKey: string;
  privateKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

const SYSTEM_PROMPT = `Tu es un agent de trading autonome expert en deux missions :

**Mission A - Polymarket (Polygon)** :
- Analyser les cotes de marchés prédictifs
- N'agir QUE si EV > 5% avec haute confiance (> 60%)

**Mission B - Pokémon RWA (Polygon/Solana)** :
- Détecter les arbitrages quand le floor price < seuil cible
- N'acheter QUE si le discount est > 10%

**Règles absolues** :
1. JAMAIS interagir avec un contrat non whitelisté
2. JAMAIS dépasser 50 USDC par transaction
3. TOUJOURS valider via Telegram avant signature
4. En cas de doute → REJETER et logger

Sois concis. Justifie chaque décision avec les données numériques.`;

export function initThirdwebClient(config: AgentConfig) {
  const client = createThirdwebClient({
    clientId: config.thirdwebClientId,
    secretKey: config.thirdwebSecretKey,
  });
  const account = privateKeyToAccount({
    client,
    privateKey: config.privateKey as `0x${string}`,
  });
  logger.info("✅ Thirdweb wallet initialisé", { address: account.address });
  return { client, account };
}

export async function createAgent(config: AgentConfig): Promise<AgentExecutor> {
  const llm = new ChatAnthropic({
    apiKey: config.anthropicApiKey,
    model: "claude-3-5-sonnet-20241022",
    temperature: 0.1,
    maxTokens: 1024,
    timeout: 30_000,
  });

  const { client, account } = initThirdwebClient(config);

  const tools = [
    polymarketScanTool,
    pokemonRWAScanTool,
    transactionTool(client, account),
  ];

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  const agent = createToolCallingAgent({ llm, tools, prompt });

  const executor = new AgentExecutor({
    agent,
    tools,
    verbose: process.env["NODE_ENV"] === "development",
    maxIterations: 5,
    returnIntermediateSteps: true,
  });

  logger.info("🤖 Agent LangChain initialisé");
  return executor;
}

export async function runAgentCycle(
  executor: AgentExecutor,
  context: AgentContext
): Promise<void> {
  logger.info(`🔄 Cycle agent — Mission: ${context.mission}`);
  try {
    const result = await executor.invoke({
      input: context.prompt,
      chat_history: [],
    });
    logger.info("✅ Cycle terminé", {
      output: result["output"] as string,
      steps: (result["intermediateSteps"] as unknown[])?.length ?? 0,
    });
  } catch (error) {
    logger.error("❌ Erreur cycle agent", { error, mission: context.mission });
    throw error;
  }
}
