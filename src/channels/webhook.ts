import type { Channel } from "./base.js";
import type { MessageBus } from "../bus/bus.js";
import type { Logger } from "pino";

export class WebhookChannel implements Channel {
  readonly name = "webhook";

  async start(_bus: MessageBus, _logger: Logger) {
    throw new Error("Webhook channel not implemented.");
  }

  async send(_payload: { chatId: string; content: string }) {
    throw new Error("Webhook channel not implemented.");
  }
}
