import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import { computeNextRun } from "../../scheduler/utils.js";
import { nowIso } from "../../util/time.js";

export const taskTools = (): ToolSpec<any>[] => {
  const scheduleTool: ToolSpec<any> = {
    name: "tasks.schedule",
    description: "Schedule a task (cron/interval/once).",
    schema: z.object({
      prompt: z.string(),
      scheduleType: z.enum(["cron", "interval", "once"]),
      scheduleValue: z.string(),
      contextMode: z.enum(["group", "isolated"]).default("group")
    }),
    async run(args, ctx) {
      const nextRunAt = computeNextRun(
        {
          scheduleType: args.scheduleType,
          scheduleValue: args.scheduleValue,
          nextRunAt: null,
          status: "active"
        },
        new Date()
      );
      if (!nextRunAt) {
        throw new Error("Invalid schedule for task.");
      }
      const task = ctx.storage.createTask({
        chatFk: ctx.chat.id,
        prompt: args.prompt,
        scheduleType: args.scheduleType,
        scheduleValue: args.scheduleValue,
        contextMode: args.contextMode,
        nextRunAt
      });
      return JSON.stringify(task, null, 2);
    }
  };

  const listTool: ToolSpec<any> = {
    name: "tasks.list",
    description: "List scheduled tasks for this chat.",
    schema: z.object({
      includeInactive: z.boolean().default(true)
    }),
    async run(args, ctx) {
      const tasks = ctx.storage.listTasks(ctx.chat.id, args.includeInactive);
      return JSON.stringify(tasks, null, 2);
    }
  };

  const updateTool: ToolSpec<any> = {
    name: "tasks.update",
    description: "Update a task's status or schedule.",
    schema: z.object({
      taskId: z.string(),
      status: z.enum(["active", "paused", "done"]).optional(),
      scheduleType: z.enum(["cron", "interval", "once"]).optional(),
      scheduleValue: z.string().optional(),
      contextMode: z.enum(["group", "isolated"]).optional()
    }),
    async run(args, ctx) {
      const existing = ctx.storage.getTask(args.taskId);
      if (!existing) {
        throw new Error("Task not found.");
      }
      if (existing.chatFk !== ctx.chat.id && ctx.chat.role !== "admin") {
        throw new Error("Only admin can update tasks from other chats.");
      }
      const scheduleType = args.scheduleType ?? existing.scheduleType;
      const scheduleValue = args.scheduleValue ?? existing.scheduleValue;
      const status = args.status ?? existing.status;
      const nextRunAt = computeNextRun(
        {
          scheduleType,
          scheduleValue,
          nextRunAt: existing.nextRunAt,
          status
        },
        new Date()
      );
      if (status === "active" && !nextRunAt) {
        throw new Error("Invalid schedule for task.");
      }
      const updated = ctx.storage.updateTask(args.taskId, {
        scheduleType,
        scheduleValue,
        status,
        contextMode: args.contextMode ?? existing.contextMode,
        nextRunAt: status === "active" ? nextRunAt : null
      });
      return JSON.stringify(
        {
          updated,
          updatedAt: nowIso()
        },
        null,
        2
      );
    }
  };

  return [scheduleTool, listTool, updateTool];
};
