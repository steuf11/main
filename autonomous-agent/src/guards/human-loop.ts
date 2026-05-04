import TelegramBot from "node-telegram-bot-api";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import type { TradeApprovalRequest } from "../types";

let bot: TelegramBot | null = null;

const pendingApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; timeoutHandle: NodeJS.Timeout }
>();

export function initTelegramHITL(botToken: string): void {
  bot = new TelegramBot(botToken, { polling: true });

  bot.on("message", (msg) => {
    const text = msg.text?.trim().toLowerCase() || "";
    const chatId = msg.chat.id.toString();
    if (chatId !== process.env["TELEGRAM_CHAT_ID"]) return;

    const approveMatch = text.match(/^\/approve_([a-z0-9]+)$/);
    const rejectMatch  = text.match(/^\/reject_([a-z0-9]+)$/);

    const handle = (id: string, approved: boolean): void => {
      const pending = pendingApprovals.get(id);
      if (!pending) return;
      clearTimeout(pending.timeoutHandle);
      pendingApprovals.delete(id);
      pending.resolve(approved);
      const emoji = approved ? "✅" : "❌";
      const label = approved ? "approuvé" : "rejeté";
      void bot?.sendMessage(chatId, `${emoji} Trade \`${id}\` *${label}*.`, {
        parse_mode: "Markdown",
      });
    };

    if (approveMatch) handle(approveMatch[1], true);
    if (rejectMatch)  handle(rejectMatch[1],  false);
  });

  logger.info("📱 Telegram HITL bot initialisé");
}

export async function requestHumanApproval(
  request: TradeApprovalRequest,
  timeoutMs = 10 * 60 * 1000
): Promise<boolean> {
  if (!bot) {
    logger.error("Bot Telegram non initialisé — REJET automatique");
    return false;
  }

  const tradeId = uuidv4().replace(/-/g, "").substring(0, 8);
  const chatId  = process.env["TELEGRAM_CHAT_ID"]!;
  const emoji   = request.mission === "polymarket" ? "📊" : "🃏";

  const message = [
    `${emoji} *VALIDATION REQUISE — ${request.mission.toUpperCase()}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📋 *Résumé :* ${request.summary}`,
    `💰 *Montant :* ${request.amount} ${request.currency}`,
    `🔗 *Chaîne :* ${request.chain}`,
    `📍 *Contrat :* \`${request.contractAddress}\``,
    `🆔 *Trade ID :* \`${tradeId}\``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `✅ /approve_${tradeId}`,
    `❌ /reject_${tradeId}`,
    `⏳ Timeout 10 min → rejet auto`,
  ].join("\n");

  await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  logger.info("📱 Demande HITL envoyée", { tradeId, mission: request.mission });

  return new Promise<boolean>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      pendingApprovals.delete(tradeId);
      logger.warn("⏰ HITL timeout — rejet auto", { tradeId });
      void bot?.sendMessage(
        chatId,
        `⏰ Timeout \`${tradeId}\` — *Rejeté automatiquement*.`,
        { parse_mode: "Markdown" }
      );
      resolve(false);
    }, timeoutMs);
    pendingApprovals.set(tradeId, { resolve, timeoutHandle });
  });
}
