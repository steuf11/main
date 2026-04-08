import { initTelegramHITL } from "../guards/human-loop";
import { logger } from "./logger";

export function initTelegramBot(botToken: string, chatId: string): void {
  logger.info("🤖 Init Telegram bot...", { chatId });
  initTelegramHITL(botToken);
}
