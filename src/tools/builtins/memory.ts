import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import { resolveWorkspacePath } from "../../util/file.js";

const getGlobalMemoryPath = (workspaceDir: string) =>
  resolveWorkspacePath(workspaceDir, "memory/MEMORY.md");

const getChatMemoryPath = (workspaceDir: string, channel: string, chatId: string) =>
  resolveWorkspacePath(workspaceDir, `memory/${channel}_${chatId}.md`);

export const memoryTools = (): ToolSpec<any>[] => {
  const readTool: ToolSpec<z.ZodTypeAny> = {
    name: "memory.read",
    description: "Read memory (global or chat-specific).",
    schema: z.object({
      scope: z.enum(["global", "chat", "all"]).default("all")
    }),
    async run(args, ctx) {
      const globalPath = getGlobalMemoryPath(ctx.workspaceDir);
      const chatPath = getChatMemoryPath(
        ctx.workspaceDir,
        ctx.chat.channel,
        ctx.chat.chatId
      );
      const globalContent = fs.existsSync(globalPath)
        ? fs.readFileSync(globalPath, "utf-8")
        : "";
      const chatContent = fs.existsSync(chatPath)
        ? fs.readFileSync(chatPath, "utf-8")
        : "";

      if (args.scope === "global") {
        return globalContent;
      }
      if (args.scope === "chat") {
        return chatContent;
      }
      return [
        "# Global Memory",
        globalContent,
        "\n# Chat Memory",
        chatContent
      ].join("\n");
    }
  };

  const writeTool: ToolSpec<z.ZodTypeAny> = {
    name: "memory.write",
    description: "Write memory (global or chat-specific).",
    schema: z.object({
      scope: z.enum(["global", "chat"]).default("chat"),
      content: z.string(),
      mode: z.enum(["append", "replace"]).default("append")
    }),
    async run(args, ctx) {
      const target =
        args.scope === "global"
          ? getGlobalMemoryPath(ctx.workspaceDir)
          : getChatMemoryPath(ctx.workspaceDir, ctx.chat.channel, ctx.chat.chatId);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (args.mode === "append") {
        const prefix = fs.existsSync(target) && fs.readFileSync(target, "utf-8").trim()
          ? "\n"
          : "";
        fs.appendFileSync(target, prefix + args.content, "utf-8");
      } else {
        fs.writeFileSync(target, args.content, "utf-8");
      }
      return "ok";
    }
  };

  return [readTool, writeTool];
};
