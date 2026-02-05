import readline from "node:readline";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";
import type { Channel } from "./base.js";
import type { MessageBus } from "../bus/bus.js";
import type { Logger } from "pino";

export class CliChannel implements Channel {
  readonly name = "cli";
  private rl: readline.Interface | null = null;
  private bus: MessageBus | null = null;
  private logger: Logger | null = null;
  private chatId: string;

  constructor(chatId = "local") {
    this.chatId = chatId;
  }

  async start(bus: MessageBus, logger: Logger) {
    this.bus = bus;
    this.logger = logger;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "> "
    });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }
      if (trimmed === "/exit") {
        this.rl?.close();
        process.exit(0);
      }
      this.bus?.publishInbound({
        id: newId(),
        channel: this.name,
        chatId: this.chatId,
        senderId: "user",
        content: trimmed,
        createdAt: nowIso()
      });
      this.rl?.prompt();
    });

    this.rl.on("close", () => {
      this.logger?.info("CLI channel closed");
    });

    this.rl.prompt();
  }

  async send(payload: { chatId: string; content: string }) {
    if (payload.chatId !== this.chatId) {
      return;
    }
    process.stdout.write(`\n${payload.content}\n> `);
  }
}
