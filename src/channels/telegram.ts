import type { Channel } from "./base.js";
import type { MessageBus } from "../bus/bus.js";
import type { Logger } from "pino";

export class TelegramChannel implements Channel {
  readonly name = "telegram";

  async start(_bus: MessageBus, _logger: Logger) {
    throw new Error("Telegram channel not implemented.");
  }

  async send(_payload: { chatId: string; content: string }) {
    throw new Error("Telegram channel not implemented.");
  }
}
