import type { MessageBus } from "../bus/bus.js";
import type { Logger } from "pino";

export interface Channel {
  readonly name: string;
  start: (bus: MessageBus, logger: Logger) => Promise<void>;
  send: (payload: { chatId: string; content: string }) => Promise<void>;
}
