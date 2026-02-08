import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import type { BusMessageDirection } from "../../types.js";

const parsePayload = (payload: string): unknown => {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
};

export const busTools = (): ToolSpec<any>[] => {
  const listDeadLetterTool: ToolSpec<any> = {
    name: "bus.dead_letter.list",
    description: "List dead-letter queue records.",
    schema: z.object({
      direction: z.enum(["inbound", "outbound"]).optional(),
      limit: z.number().int().min(1).max(200).default(20)
    }),
    async run(args, ctx) {
      const entries = ctx.bus.listDeadLetterMessages(
        args.direction as BusMessageDirection | undefined,
        args.limit
      );
      const formatted = entries.map((item) => ({
        id: item.id,
        direction: item.direction,
        attempts: item.attempts,
        maxAttempts: item.maxAttempts,
        createdAt: item.createdAt,
        deadLetteredAt: item.deadLetteredAt,
        lastError: item.lastError,
        payload: parsePayload(item.payload)
      }));
      return JSON.stringify(formatted, null, 2);
    }
  };

  const replayDeadLetterTool: ToolSpec<any> = {
    name: "bus.dead_letter.replay",
    description: "Replay dead-letter queue records back to pending.",
    schema: z.object({
      queueId: z.string().optional(),
      direction: z.enum(["inbound", "outbound"]).optional(),
      limit: z.number().int().min(1).max(200).default(10)
    }),
    async run(args, ctx) {
      const result = ctx.bus.replayDeadLetterMessages({
        queueId: args.queueId,
        direction: args.direction as BusMessageDirection | undefined,
        limit: args.limit
      });
      return JSON.stringify(result, null, 2);
    }
  };

  return [listDeadLetterTool, replayDeadLetterTool];
};
