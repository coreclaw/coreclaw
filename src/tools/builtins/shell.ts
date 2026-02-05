import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { resolveWorkspacePath } from "../../util/file.js";
import type { ToolSpec } from "../registry.js";

const execAsync = promisify(exec);

export const shellTools = (): ToolSpec<any>[] => {
  const shellExec: ToolSpec<z.ZodTypeAny> = {
    name: "shell.exec",
    description: "Execute a shell command within the workspace (restricted).",
    schema: z.object({
      command: z.string(),
      cwd: z.string().optional()
    }),
    async run(args, ctx) {
      if (!ctx.config.allowShell) {
        throw new Error("Shell execution is disabled.");
      }
      if (ctx.config.allowedShellCommands.length > 0) {
        const allowed = ctx.config.allowedShellCommands.some((prefix) =>
          args.command.startsWith(prefix)
        );
        if (!allowed) {
          throw new Error("Command not in allowlist.");
        }
      }
      const cwd = args.cwd
        ? resolveWorkspacePath(ctx.workspaceDir, args.cwd)
        : ctx.workspaceDir;
      const { stdout, stderr } = await execAsync(args.command, { cwd });
      return [stdout, stderr].filter(Boolean).join("\n").trim();
    }
  };

  return [shellExec];
};
