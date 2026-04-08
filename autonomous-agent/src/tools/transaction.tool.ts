import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  ThirdwebClient,
  getContract,
  prepareContractCall,
  sendTransaction,
  waitForReceipt,
} from "thirdweb";
import type { Account } from "thirdweb/wallets";
import { logger } from "../utils/logger";
import { validateWhitelist } from "../guards/whitelist";
import { checkSpendLimit } from "../guards/spend-limit";
import { requestHumanApproval } from "../guards/human-loop";
import { polygonChain } from "../chains/polygon";
import { baseChain } from "../chains/base";
import type { ChainName, MissionName } from "../types";

function getEvmChain(chainName: ChainName) {
  switch (chainName) {
    case "polygon": return polygonChain;
    case "base":    return baseChain;
    default: throw new Error(`Chain non supportée pour EVM : ${chainName}`);
  }
}

export function transactionTool(
  client: ThirdwebClient,
  account: Account
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "transaction_execute",
    description:
      "Exécute une transaction sur Polygon ou Base via Thirdweb. " +
      "TOUJOURS appeler polymarket_scan ou pokemon_rwa_scan AVANT cet outil. " +
      "Déclenche automatiquement la validation Telegram (HITL) avant signature.",
    schema: z.object({
      chain: z.enum(["polygon", "base"]).describe("Chaîne cible"),
      contractAddress: z.string().describe("Adresse du contrat (doit être whitelisté)"),
      method: z.string().describe("Nom de la méthode du contrat à appeler"),
      params: z.array(z.unknown()).describe("Paramètres de la méthode"),
      amountUSDC: z.number().positive().describe("Montant en USDC pour la vérification du spend limit"),
      tradeSummary: z.string().describe("Résumé lisible du trade pour validation Telegram"),
    }),
    func: async ({ chain, contractAddress, method, params, amountUSDC, tradeSummary }) => {
      logger.info("💸 [Tool] transaction_execute demandé", {
        chain, contractAddress, method, amountUSDC,
      });

      try {
        // ── Garde-fou 1 : Whitelist ───────────────────────────────────────
        if (!validateWhitelist(contractAddress, chain as ChainName)) {
          return JSON.stringify({ success: false, error: "Contrat non whitelisté — transaction annulée" });
        }

        // ── Garde-fou 2 : Spend limit ─────────────────────────────────────
        const spendCheck = checkSpendLimit(amountUSDC, "USDC");
        if (!spendCheck.allowed) {
          return JSON.stringify({
            success: false,
            error: `Spend limit dépassé : ${amountUSDC} > ${spendCheck.limit} USDC`,
          });
        }

        // ── Garde-fou 3 : Validation humaine Telegram ─────────────────────
        const polymarketAddr = (process.env["POLYMARKET_CONTRACT_ADDRESS"] || "NEVER").toLowerCase();
        const mission: MissionName = contractAddress.toLowerCase().includes(polymarketAddr)
          ? "polymarket"
          : "pokemon_rwa";

        const approved = await requestHumanApproval({
          mission,
          summary: tradeSummary,
          amount: amountUSDC,
          currency: "USDC",
          contractAddress,
          chain: chain as ChainName,
        });

        if (!approved) {
          logger.info("🚫 Transaction rejetée par l'utilisateur", { chain, contractAddress });
          return JSON.stringify({ success: false, reason: "Rejeté par l'utilisateur via Telegram" });
        }

        // ── Exécution Thirdweb ────────────────────────────────────────────
        const evmChain = getEvmChain(chain as ChainName);
        const contract = getContract({
          client,
          address: contractAddress as `0x${string}`,
          chain: evmChain,
        });

        const tx = prepareContractCall({
          contract,
          method: `function ${method}`,
          params: params as never[],
        });

        const { transactionHash } = await sendTransaction({ transaction: tx, account });
        logger.info("✅ Transaction envoyée", { transactionHash, chain });

        const receipt = await waitForReceipt({ client, transactionHash, chain: evmChain });
        logger.info("✅ Transaction confirmée", {
          transactionHash,
          blockNumber: receipt.blockNumber?.toString(),
          status: receipt.status,
        });

        return JSON.stringify({
          success: true,
          transactionHash,
          blockNumber: receipt.blockNumber?.toString(),
          status: receipt.status,
          chain,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("❌ [Tool] transaction_execute erreur", { err: message });
        return JSON.stringify({ success: false, error: message });
      }
    },
  });
}
