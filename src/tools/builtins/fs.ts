import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveWorkspacePath } from "../../util/file.js";
import type { ToolSpec } from "../registry.js";

export const fsTools = (): ToolSpec<any>[] => {
  const readTool: ToolSpec<z.ZodTypeAny> = {
    name: "fs.read",
    description: "Read a text file within the workspace.",
    schema: z.object({
      path: z.string()
    }),
    async run(args, ctx) {
      const target = resolveWorkspacePath(ctx.workspaceDir, args.path);
      return fs.readFileSync(target, "utf-8");
    }
  };

  const writeTool: ToolSpec<z.ZodTypeAny> = {
    name: "fs.write",
    description: "Write a text file within the workspace (isolated runtime optional).",
    schema: z.object({
      path: z.string(),
      content: z.string(),
      mode: z.enum(["overwrite", "append"]).default("overwrite")
    }),
    async run(args, ctx) {
      const isolatedRuntime = ctx.isolatedRuntime;
      if (isolatedRuntime?.isToolIsolated("fs.write")) {
        return isolatedRuntime.executeFsWrite({
          workspaceDir: ctx.workspaceDir,
          path: args.path,
          content: args.content,
          mode: args.mode
        });
      }

      const target = resolveWorkspacePath(ctx.workspaceDir, args.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (args.mode === "append") {
        fs.appendFileSync(target, args.content, "utf-8");
      } else {
        fs.writeFileSync(target, args.content, "utf-8");
      }
      return "ok";
    }
  };

  const listTool: ToolSpec<z.ZodTypeAny> = {
    name: "fs.list",
    description: "List files in a workspace directory.",
    schema: z.object({
      path: z.string().default(".")
    }),
    async run(args, ctx) {
      const target = resolveWorkspacePath(ctx.workspaceDir, args.path);
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const output = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file"
      }));
      return JSON.stringify(output, null, 2);
    }
  };

  return [readTool, writeTool, listTool];
};
