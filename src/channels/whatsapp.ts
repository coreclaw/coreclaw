import type { Channel } from "./base.js";
import type { MessageBus } from "../bus/bus.js";
import type { Logger } from "pino";

export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp";

  async start(_bus: MessageBus, _logger: Logger) {
    throw new Error("WhatsApp channel not implemented.");
  }

  async send(_payload: { chatId: string; content: string }) {
    throw new Error("WhatsApp channel not implemented.");
  }
}
