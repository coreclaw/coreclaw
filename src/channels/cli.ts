import readline from "node:readline";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";
import type { Channel } from "./base.js";
import type { MessageBus } from "../bus/bus.js";
import type { Logger } from "pino";
import type { BusMessageDirection } from "../types.js";

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
      if (trimmed.startsWith("/dlq")) {
        this.handleDeadLetterCommand(trimmed);
        this.rl?.prompt();
        return;
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

  private handleDeadLetterCommand(input: string) {
    const [, action, arg1, arg2] = input.split(/\s+/);
    const bus = this.bus;
    if (!bus) {
      process.stdout.write("\nBus is not initialized.\n");
      return;
    }

    if (action === "list") {
      const direction = this.parseDirectionArg(arg1);
      if (arg1 && !direction && arg1 !== "all") {
        process.stdout.write("\nUsage: /dlq list [inbound|outbound|all] [limit]\n");
        return;
      }
      const limit = this.parseLimitArg(arg2, 20);
      const result = bus.listDeadLetterMessages(direction, limit);
      process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (action === "replay") {
      if (!arg1) {
        process.stdout.write(
          "\nUsage: /dlq replay <queueId|inbound|outbound|all> [limit]\n"
        );
        return;
      }
      const direction = this.parseDirectionArg(arg1);
      const limit = this.parseLimitArg(arg2, 10);
      const replay = bus.replayDeadLetterMessages(
        direction || arg1 === "all"
          ? {
              direction,
              limit
            }
          : {
              queueId: arg1
            }
      );
      process.stdout.write(`\n${JSON.stringify(replay, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      "\nUsage:\n  /dlq list [inbound|outbound|all] [limit]\n  /dlq replay <queueId|inbound|outbound|all> [limit]\n"
    );
  }

  private parseDirectionArg(
    value?: string
  ): BusMessageDirection | undefined {
    if (!value || value === "all") {
      return undefined;
    }
    if (value === "inbound" || value === "outbound") {
      return value;
    }
    return undefined;
  }

  private parseLimitArg(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(Math.floor(parsed), 200);
  }
}
