import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import { nowIso } from "../../util/time.js";
import { newId } from "../../util/ids.js";

export const messageTools = (): ToolSpec<any>[] => {
  const sendTool: ToolSpec<z.ZodTypeAny> = {
    name: "message.send",
    description: "Send a message to a channel chat.",
    schema: z.object({
      channel: z.string().optional(),
      chatId: z.string().optional(),
      content: z.string()
    }),
    async run(args, ctx) {
      const channel = args.channel ?? ctx.chat.channel;
      const chatId = args.chatId ?? ctx.chat.chatId;
      if (
        (channel !== ctx.chat.channel || chatId !== ctx.chat.chatId) &&
        ctx.chat.role !== "admin"
      ) {
        throw new Error("Only admin can send cross-chat messages.");
      }
      ctx.bus.publishOutbound({
        id: newId(),
        channel,
        chatId,
        content: args.content,
        createdAt: nowIso()
      });
      return "ok";
    }
  };

  const registerChat: ToolSpec<z.ZodTypeAny> = {
    name: "chat.register",
    description: "Register a chat for full message storage.",
    schema: z.object({
      channel: z.string().optional(),
      chatId: z.string().optional(),
      role: z.enum(["admin", "normal"]).optional(),
      bootstrapKey: z.string().optional()
    }),
    async run(args, ctx) {
      const channel = args.channel ?? ctx.chat.channel;
      const chatId = args.chatId ?? ctx.chat.chatId;
      const isCrossChat = channel !== ctx.chat.channel || chatId !== ctx.chat.chatId;
      if (
        isCrossChat &&
        ctx.chat.role !== "admin"
      ) {
        throw new Error("Only admin can register other chats.");
      }

      const isBootstrapAdminElevation = args.role === "admin" && ctx.chat.role !== "admin";
      if (isBootstrapAdminElevation) {
        const bootstrapKey = ctx.config.adminBootstrapKey;
        if (!bootstrapKey) {
          throw new Error("Admin bootstrap is not configured.");
        }
        if (ctx.config.adminBootstrapSingleUse && ctx.storage.isAdminBootstrapUsed()) {
          throw new Error("Admin bootstrap key has already been used.");
        }
        if (ctx.storage.countAdminChats() > 0) {
          throw new Error("Admin already exists. Ask an admin to grant role.");
        }
        const now = new Date();
        const security = ctx.storage.getAdminBootstrapSecurityState();
        const lockUntilMs = security.lockUntil
          ? new Date(security.lockUntil).getTime()
          : Number.NaN;
        if (Number.isFinite(lockUntilMs) && lockUntilMs > now.getTime()) {
          throw new Error(`Admin bootstrap is locked until ${security.lockUntil}.`);
        }

        if (args.bootstrapKey !== bootstrapKey) {
          const nextFailed = security.failedAttempts + 1;
          const maxAttempts = ctx.config.adminBootstrapMaxAttempts;
          if (nextFailed >= maxAttempts) {
            const lockUntil = new Date(
              now.getTime() + ctx.config.adminBootstrapLockoutMinutes * 60_000
            ).toISOString();
            ctx.storage.setAdminBootstrapSecurityState({
              failedAttempts: nextFailed,
              lockUntil
            });
            throw new Error(
              `Invalid admin bootstrap key. Too many failed attempts; locked until ${lockUntil}.`
            );
          }
          ctx.storage.setAdminBootstrapSecurityState({
            failedAttempts: nextFailed,
            lockUntil: null
          });
          const remaining = maxAttempts - nextFailed;
          throw new Error(
            `Invalid admin bootstrap key. ${remaining} attempt(s) remaining before lockout.`
          );
        }

        ctx.storage.setAdminBootstrapSecurityState({
          failedAttempts: 0,
          lockUntil: null
        });
      }

      if (args.role && ctx.chat.role !== "admin" && args.role !== "admin") {
        throw new Error("Only admin can set chat roles.");
      }

      const chat = ctx.storage.upsertChat({ channel, chatId });
      ctx.storage.setChatRegistered(chat.id, true);
      if (args.role) {
        ctx.storage.setChatRole(chat.id, args.role);
        if (isBootstrapAdminElevation && ctx.config.adminBootstrapSingleUse) {
          ctx.storage.setAdminBootstrapUsed(true);
        }
      }
      return "ok";
    }
  };

  const setRole: ToolSpec<z.ZodTypeAny> = {
    name: "chat.set_role",
    description: "Set chat role (admin/normal).",
    schema: z.object({
      channel: z.string(),
      chatId: z.string(),
      role: z.enum(["admin", "normal"])
    }),
    async run(args, ctx) {
      if (ctx.chat.role !== "admin") {
        throw new Error("Only admin can change roles.");
      }
      const chat = ctx.storage.upsertChat({
        channel: args.channel,
        chatId: args.chatId
      });
      ctx.storage.setChatRole(chat.id, args.role);
      return "ok";
    }
  };

  return [sendTool, registerChat, setRole];
};
