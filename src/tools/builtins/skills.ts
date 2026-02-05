import fs from "node:fs";
import { z } from "zod";
import type { ToolSpec } from "../registry.js";

export const skillTools = (): ToolSpec<any>[] => {
  const listTool: ToolSpec<z.ZodTypeAny> = {
    name: "skills.list",
    description: "List available skills.",
    schema: z.object({}),
    async run(_args, ctx) {
      const list = ctx.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        always: skill.always
      }));
      return JSON.stringify(list, null, 2);
    }
  };

  const readTool: ToolSpec<z.ZodTypeAny> = {
    name: "skills.read",
    description: "Read a skill file.",
    schema: z.object({
      name: z.string()
    }),
    async run(args, ctx) {
      const skill = ctx.skills.find((entry) => entry.name === args.name);
      if (!skill) {
        throw new Error(`Skill not found: ${args.name}`);
      }
      return fs.readFileSync(skill.skillPath, "utf-8");
    }
  };

  return [listTool, readTool];
};
