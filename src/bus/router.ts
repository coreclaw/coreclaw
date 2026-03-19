import type { InboundMessage, OutboundMessage, ToolMessage } from "../types.js";
import { createHash } from "node:crypto";
import type { SqliteStorage } from "../storage/sqlite.js";
import type { ContextBuilder } from "../agent/context.js";
import type { AgentRuntime } from "../agent/runtime.js";
import { BusDeferMessageError, type MessageBus } from "./bus.js";
import type { Config } from "../config/schema.js";
import { resolveBinding } from "../bindings/resolve.js";
import type { WorkclawEvent, WorkclawRoutingHints } from "../bindings/types.js";
import type { Logger } from "pino";
import type { SkillIndexEntry } from "../skills/types.js";
import { compactConversation } from "../agent/compact.js";
import {
  isHeartbeatRunMode,
  resolveRunMode,
  shouldWakeHeartbeatAfterRun
} from "../agent/run-mode.js";
import { nowIso } from "../util/time.js";
import type { McpManager } from "../mcp/manager.js";
import type { IsolatedToolRuntime } from "../isolation/runtime.js";
import type { McpReloadRequest, McpReloadResult } from "../tools/registry.js";
import type { RuntimeTelemetry } from "../observability/telemetry.js";
import type { HeartbeatController } from "../heartbeat/service.js";
import { enqueueOutboundAction } from "../outbound/queue.js";

class SerialQueue {
  private tail = Promise.resolve();
  private pending = 0;
  private lastActiveAtMs = Date.now();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    this.lastActiveAtMs = Date.now();
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run.finally(() => {
      this.pending = Math.max(0, this.pending - 1);
      this.lastActiveAtMs = Date.now();
    });
  }

  isIdle(): boolean {
    return this.pending === 0;
  }

  lastActiveAtMsValue(): number {
    return this.lastActiveAtMs;
  }
}

const normalizeHeartbeatContent = (value: string) =>
  value.trim().replace(/\s+/g, " ");

const hashHeartbeatContent = (value: string) =>
  createHash("sha256")
    .update(normalizeHeartbeatContent(value).toLowerCase())
    .digest("hex");

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type RouterQueueOptions = {
  maxQueues: number;
  idleTtlMs: number;
  pruneIntervalMs: number;
};

const DEFAULT_ROUTER_QUEUE_OPTIONS: RouterQueueOptions = {
  maxQueues: 5_000,
  idleTtlMs: 30 * 60_000,
  pruneIntervalMs: 30_000
};

export class ConversationRouter {
  private queues = new Map<string, SerialQueue>();
  private queueOptions: RouterQueueOptions;
  private queueLastPruneAtMs = 0;

  constructor(
    private storage: SqliteStorage,
    private contextBuilder: ContextBuilder,
    private runtime: AgentRuntime,
    private mcp: McpManager,
    private bus: MessageBus,
    private logger: Logger,
    private config: Config,
    private skills: SkillIndexEntry[] | ((profileId?: string) => SkillIndexEntry[]),
    private isolatedRuntime?: IsolatedToolRuntime,
    private mcpReloader?: (params?: McpReloadRequest) => Promise<McpReloadResult>,
    private heartbeatController?: HeartbeatController,
    private wakeHeartbeat?: (reason: string) => void,
    private telemetry?: RuntimeTelemetry,
    queueOptions?: Partial<RouterQueueOptions>
  ) {
    const merged: RouterQueueOptions = {
      ...DEFAULT_ROUTER_QUEUE_OPTIONS,
      ...queueOptions
    };
    const defaultMaxQueues = Math.max(
      DEFAULT_ROUTER_QUEUE_OPTIONS.maxQueues,
      this.config.bus.maxPendingInbound * 2
    );
    const configuredMaxQueues =
      queueOptions?.maxQueues === undefined
        ? defaultMaxQueues
        : Math.floor(queueOptions.maxQueues);

    this.queueOptions = {
      maxQueues: Math.max(1, configuredMaxQueues),
      idleTtlMs: Math.max(1_000, Math.floor(merged.idleTtlMs)),
      pruneIntervalMs: Math.max(500, Math.floor(merged.pruneIntervalMs))
    };
  }

  handleInbound = async (message: InboundMessage) => {
    const key = `${this.resolveConversationProfileId(message)}:${message.channel}:${message.chatId}`;
    const queue = this.queues.get(key) ?? new SerialQueue();
    this.queues.set(key, queue);
    if (!queue.isIdle()) {
      this.pruneQueues(key);
      throw new BusDeferMessageError(
        "Inbound chat queue is busy",
        this.config.bus.retryBackoffMs
      );
    }
    const processing = queue.enqueue(() => this.processMessage(message));
    this.pruneQueues(key);
    try {
      await processing;
    } finally {
      this.pruneQueues(key);
    }
  };

  private pruneQueues(activeKey?: string) {
    const nowMs = Date.now();
    const overCapacity = this.queues.size > this.queueOptions.maxQueues;
    if (!overCapacity && nowMs - this.queueLastPruneAtMs < this.queueOptions.pruneIntervalMs) {
      return;
    }
    this.queueLastPruneAtMs = nowMs;

    for (const [key, queue] of this.queues.entries()) {
      if (key === activeKey || !queue.isIdle()) {
        continue;
      }
      if (nowMs - queue.lastActiveAtMsValue() > this.queueOptions.idleTtlMs) {
        this.queues.delete(key);
      }
    }

    if (this.queues.size <= this.queueOptions.maxQueues) {
      return;
    }

    const idleCandidates = [...this.queues.entries()]
      .filter(([key, queue]) => key !== activeKey && queue.isIdle())
      .sort((a, b) => a[1].lastActiveAtMsValue() - b[1].lastActiveAtMsValue());

    for (const [key] of idleCandidates) {
      if (this.queues.size <= this.queueOptions.maxQueues) {
        break;
      }
      this.queues.delete(key);
    }
  }

  private async processMessage(message: InboundMessage) {
    const event = this.normalizeInboundEvent(message);
    const routingHints = this.extractRoutingHints(message);
    const binding = resolveBinding(event, this.config.bindings, routingHints);
    const requestedProfileId = binding?.profileId ?? this.resolveConversationProfileId(message);
    const chat = this.storage.upsertChat({
      profileId: requestedProfileId,
      channel: message.channel,
      chatId: message.chatId
    });

    if (this.mcpReloader) {
      try {
        await this.mcpReloader({
          force: false,
          reason: "inbound:auto-sync",
          audit: {
            chatFk: chat.id,
            channel: chat.channel,
            chatId: chat.chatId,
            actorRole: chat.role
          }
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn({ error: detail }, "failed to auto-sync MCP tools");
      }
    }

    const skills = this.resolveSkills(chat.profileId);
    const baseRunMode = resolveRunMode(message);
    const runMode = binding?.action.contextMode
      ? {
          ...baseRunMode,
          contextMode:
            (binding.action.contextMode === "full"
              ? "group"
              : binding.action.contextMode) as typeof baseRunMode.contextMode
        }
      : baseRunMode;

    const executionNow = nowIso();
    const execution = this.storage.startInboundExecution({
      channel: message.channel,
      chatId: message.chatId,
      inboundId: message.id,
      now: executionNow,
      staleBefore: new Date(
        Date.now() - this.config.bus.processingTimeoutMs
      ).toISOString()
    });
    if (execution.state === "running") {
      this.logger.warn(
        {
          channel: message.channel,
          chatId: message.chatId,
          inboundId: message.id
        },
        "inbound execution already in progress"
      );
      throw new BusDeferMessageError(
        "Inbound execution is still running",
        this.config.bus.retryBackoffMs
      );
    }

    const { messages, profile } = this.contextBuilder.build({
      chat,
      inbound: message,
      runMode,
      skills
    });

    const toolContext = {
      workspaceDir: profile.workspaceDir,
      chat: {
        channel: chat.channel,
        chatId: chat.chatId,
        role: chat.role,
        id: chat.id,
        profileId: chat.profileId
      },
      profile: {
        id: profile.id,
        workspaceDir: profile.workspaceDir,
        stateDir: profile.stateDir,
        role: profile.role
      },
      storage: this.storage,
      mcp: this.mcp,
      heartbeat: this.heartbeatController,
      logger: this.logger,
      bus: this.bus,
      config: this.config,
      skills,
      mcpReloader: this.mcpReloader,
      isolatedRuntime: this.isolatedRuntime
    };

    const start = Date.now();
    let responseContent = "";
    let toolMessages: ToolMessage[] = [];
    let errorMessage: string | null = null;
    if (execution.state === "completed") {
      responseContent = execution.responseContent;
      try {
        toolMessages = JSON.parse(execution.toolMessagesJson) as ToolMessage[];
      } catch {
        toolMessages = [];
      }
    } else {
      const leaseIntervalMs = Math.max(
        250,
        Math.floor(this.config.bus.processingTimeoutMs / 3)
      );
      const leaseTimer = setInterval(() => {
        try {
          this.storage.touchInboundExecution({
            channel: message.channel,
            chatId: message.chatId,
            inboundId: message.id,
            updatedAt: nowIso()
          });
        } catch {
          // keepalive is best-effort and should not fail message processing.
        }
      }, leaseIntervalMs);
      leaseTimer.unref?.();

      try {
        const result = await this.runtime.run({
          messages,
          toolContext
        });
        responseContent = result.content;
        toolMessages = result.toolMessages;
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        responseContent = `Error: ${errorMessage}`;
        this.logger.error({ error: errorMessage }, "runtime error");
      } finally {
        clearInterval(leaseTimer);
      }
      this.storage.completeInboundExecution({
        channel: message.channel,
        chatId: message.chatId,
        inboundId: message.id,
        responseContent,
        toolMessagesJson: JSON.stringify(toolMessages),
        completedAt: nowIso()
      });
    }

    const stored = this.config.storeFullMessages || chat.registered;
    this.storage.insertMessage({
      id: `user:${message.channel}:${message.chatId}:${message.id}`,
      chatFk: chat.id,
      senderId: message.senderId,
      role: "user",
      content: message.content,
      stored,
      createdAt: message.createdAt
    });

    for (const toolMessage of toolMessages) {
      this.storage.insertMessage({
        id: `tool:${message.channel}:${message.chatId}:${message.id}:${toolMessage.tool_call_id}`,
        chatFk: chat.id,
        senderId: toolMessage.tool_call_id,
        role: "tool",
        content: toolMessage.content,
        stored: true,
        createdAt: nowIso()
      });
    }

    this.storage.insertMessage({
      id: `assistant:${message.channel}:${message.chatId}:${message.id}`,
      chatFk: chat.id,
      senderId: "assistant",
      role: "assistant",
      content: responseContent,
      stored: true,
      createdAt: nowIso()
    });

    const shouldCompact =
      this.storage.countMessages(chat.id) > this.config.historyMaxMessages * 2;
    if (shouldCompact) {
      const state = this.storage.getConversationState(chat.id);
      const summarySource = this.storage
        .listRecentMessages(chat.id, this.config.historyMaxMessages * 2)
        .flatMap((entry) =>
          (entry.role === "user" || entry.role === "assistant") && entry.content
            ? [{ role: entry.role as "user" | "assistant", content: entry.content }]
            : []
        );
      const summary = await compactConversation({
        provider: this.runtime.provider,
        config: this.config,
        messages: summarySource
      });
      this.storage.setConversationState({
        chatFk: chat.id,
        summary,
        enabledSkills: state.enabledSkills,
        lastCompactAt: nowIso()
      });
      this.storage.pruneMessages(chat.id, this.config.historyMaxMessages);
    }

    const outbound: OutboundMessage = {
      id: `outbound:${message.channel}:${message.chatId}:${message.id}`,
      channel: message.channel,
      chatId: message.chatId,
      content: responseContent,
      createdAt: nowIso(),
      replyToId: message.id
    };
    if (binding && binding.action.outbound.targetMode !== "none") {
      const targetSurface =
        binding.action.outbound.targetMode === "explicit-target"
          ? binding.action.outbound.surface ?? event.surface
          : event.surface;
      enqueueOutboundAction(this.storage, {
        sourceEventId: event.id,
        bindingId: binding.bindingId,
        profileId: binding.profileId,
        targetSurface,
        targetSourceKey:
          binding.action.outbound.targetMode === "explicit-target"
            ? binding.action.outbound.sourceKey ?? null
            : event.sourceKey,
        targetThreadKey: binding.action.outbound.threadKey ?? binding.action.threadKey ?? event.threadKey,
        targetChannelKey:
          binding.action.outbound.targetMode === "explicit-target"
            ? binding.action.outbound.channelKey ?? null
            : event.channelKey,
        payload: {
          content: responseContent,
          replyToId: message.id,
          eventId: event.id
        }
      });
    }

    if (isHeartbeatRunMode(runMode)) {
      const delivery = this.handleHeartbeatDelivery({
        message,
        chat,
        responseContent
      });
      if (delivery.send) {
        outbound.metadata = {
          ...(message.metadata ?? {}),
          isHeartbeat: true
        };
        this.bus.publishOutbound(outbound);
      }
    } else {
      const shouldSendImmediateReply =
        !binding ||
        (binding.action.outbound.targetMode !== "none" &&
          (binding.action.outbound.targetMode === "reply-to-event" ||
            (binding.action.outbound.targetMode === "explicit-target" &&
              (binding.action.outbound.surface ?? event.surface) === message.channel)));
      if (shouldSendImmediateReply && binding?.action.replyMode !== "silent") {
        this.bus.publishOutbound(outbound);
      }
      if (shouldWakeHeartbeatAfterRun(runMode)) {
        this.wakeHeartbeat?.("router:message-processed");
      }
    }

    if (message.metadata?.taskId) {
      this.storage.logTaskRun({
        taskFk: String(message.metadata.taskId),
        inboundId: message.id,
        runAt: nowIso(),
        durationMs: Date.now() - start,
        status: errorMessage ? "error" : "success",
        resultPreview: responseContent.slice(0, 240),
        error: errorMessage ?? undefined
      });
    }
  }

  private resolveConversationProfileId(message: InboundMessage): string {
    const requested =
      typeof message.metadata?.profileId === "string" && message.metadata.profileId.trim()
        ? message.metadata.profileId.trim()
        : undefined;
    if (requested) {
      return requested;
    }
    return this.storage.getChat(message.channel, message.chatId)?.profileId ?? "main";
  }

  private extractRoutingHints(message: InboundMessage): WorkclawRoutingHints | undefined {
    const profileId =
      typeof message.metadata?.profileId === "string" && message.metadata.profileId.trim()
        ? message.metadata.profileId.trim()
        : undefined;
    const bindingId =
      typeof message.metadata?.bindingId === "string" && message.metadata.bindingId.trim()
        ? message.metadata.bindingId.trim()
        : undefined;
    const suppressOutbound = message.metadata?.suppressOutbound === true ? true : undefined;
    if (!profileId && !bindingId && suppressOutbound === undefined) {
      return undefined;
    }
    return { profileId, bindingId, suppressOutbound };
  }

  private normalizeInboundEvent(message: InboundMessage): WorkclawEvent {
    const metadata = message.metadata ?? {};
    const payload =
      metadata.payload && typeof metadata.payload === "object"
        ? (metadata.payload as Record<string, unknown>)
        : { content: message.content };
    return {
      id: message.id,
      surface:
        typeof metadata.surface === "string" && metadata.surface.trim()
          ? metadata.surface.trim()
          : message.channel,
      event:
        typeof metadata.event === "string" && metadata.event.trim()
          ? metadata.event.trim()
          : "message.received",
      sourceKey:
        typeof metadata.sourceKey === "string" && metadata.sourceKey.trim()
          ? metadata.sourceKey.trim()
          : `${message.channel}:${message.chatId}`,
      projectKey: typeof metadata.projectKey === "string" ? metadata.projectKey : undefined,
      repoKey: typeof metadata.repoKey === "string" ? metadata.repoKey : undefined,
      threadKey: typeof metadata.threadKey === "string" ? metadata.threadKey : undefined,
      senderKey:
        typeof metadata.senderKey === "string" ? metadata.senderKey : `user:${message.senderId}`,
      channelKey:
        typeof metadata.channelKey === "string"
          ? metadata.channelKey
          : `${message.channel}:${message.chatId}`,
      createdAt: message.createdAt,
      correlationId: typeof metadata.correlationId === "string" ? metadata.correlationId : undefined,
      trustLevel:
        metadata.trustLevel === "trusted" ||
        metadata.trustLevel === "verified" ||
        metadata.trustLevel === "untrusted"
          ? metadata.trustLevel
          : undefined,
      metadata: metadata as Record<string, unknown>,
      payload
    };
  }

  private resolveSkills(profileId?: string): SkillIndexEntry[] {
    const resolved = typeof this.skills === "function" ? this.skills(profileId) : this.skills;
    return [...resolved];
  }

  private handleHeartbeatDelivery(params: {
    message: InboundMessage;
    chat: {
      id: string;
      channel: string;
      chatId: string;
      role: "admin" | "normal";
    };
    responseContent: string;
  }): { send: boolean } {
    const content = normalizeHeartbeatContent(params.responseContent);
    const contentHash = hashHeartbeatContent(content);
    const metadata: Record<string, unknown> = {
      contentHash,
      triggerReason: params.message.metadata?.heartbeatReason ?? null,
      suppressAck: this.config.heartbeat.suppressAck
    };

    if (!content) {
      this.recordHeartbeatDeliveryAudit({
        chat: params.chat,
        outcome: "skipped",
        reason: "empty_response",
        metadata
      });
      this.telemetry?.recordHeartbeat({ scope: "delivery", outcome: "skipped" });
      return { send: false };
    }

    if (this.config.heartbeat.suppressAck) {
      const token = this.config.heartbeat.ackToken.trim();
      const tokenRegex = new RegExp(`^\\W*${escapeRegex(token)}\\W*$`, "i");
      if (tokenRegex.test(content)) {
        this.recordHeartbeatDeliveryAudit({
          chat: params.chat,
          outcome: "skipped",
          reason: "ok_token",
          metadata
        });
        this.telemetry?.recordHeartbeat({ scope: "delivery", outcome: "skipped" });
        return { send: false };
      }
    }

    const dedupeSince = new Date(
      Date.now() - this.config.heartbeat.dedupeWindowMs
    ).toISOString();
    const duplicate = this.storage.hasRecentHeartbeatDelivery({
      chatFk: params.chat.id,
      contentHash,
      since: dedupeSince
    });
    if (duplicate) {
      this.recordHeartbeatDeliveryAudit({
        chat: params.chat,
        outcome: "skipped",
        reason: "duplicate",
        metadata
      });
      this.telemetry?.recordHeartbeat({ scope: "delivery", outcome: "skipped" });
      return { send: false };
    }

    this.recordHeartbeatDeliveryAudit({
      chat: params.chat,
      outcome: "sent",
      reason: contentHash,
      metadata
    });
    this.telemetry?.recordHeartbeat({ scope: "delivery", outcome: "sent" });
    return { send: true };
  }

  private recordHeartbeatDeliveryAudit(params: {
    chat: {
      id: string;
      channel: string;
      chatId: string;
      role: "admin" | "normal";
    };
    outcome: "sent" | "skipped";
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      this.storage.insertAuditEvent({
        at: nowIso(),
        eventType: "heartbeat.delivery",
        toolName: "heartbeat.delivery",
        chatFk: params.chat.id,
        channel: params.chat.channel,
        chatId: params.chat.chatId,
        actorRole: params.chat.role,
        outcome: params.outcome,
        reason: params.reason,
        metadataJson: params.metadata ? JSON.stringify(params.metadata) : undefined
      });
    } catch {
      // best-effort audit
    }
  }
}
