import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ToolCall } from "../src/types.js";
import { MessageBus } from "../src/bus/bus.js";
import { ConversationRouter } from "../src/bus/router.js";
import { ContextBuilder } from "../src/agent/context.js";
import { AgentRuntime, type LlmProvider } from "../src/agent/runtime.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { DefaultToolPolicyEngine } from "../src/tools/policy.js";
import { builtInTools } from "../src/tools/builtins/index.js";
import { McpManager } from "../src/mcp/manager.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { RuntimeTelemetry } from "../src/observability/telemetry.js";
import { IsolatedToolRuntime } from "../src/isolation/runtime.js";
import { createStorageFixture } from "./test-utils.js";

const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 3_000,
  intervalMs = 25
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
};

class MockProvider implements LlmProvider {
  constructor(
    private responder: (req: {
      model: string;
      messages: ChatMessage[];
      tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
      temperature?: number;
    }) => Promise<{ content?: string; toolCalls?: ToolCall[] }>
  ) {}

  async chat(req: {
    model: string;
    messages: ChatMessage[];
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    temperature?: number;
  }): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    return this.responder(req);
  }
}

const logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  child: () => logger
} as any;

test("Chaos: post-router crash retried by bus does not duplicate runtime or outbound", async () => {
  let providerCalls = 0;
  const fixture = createStorageFixture({
    bus: {
      pollMs: 10,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 100,
      maxPendingOutbound: 100,
      overloadPendingThreshold: 80,
      overloadBackoffMs: 10,
      perChatRateLimitWindowMs: 10_000,
      perChatRateLimitMax: 100
    }
  });

  const provider = new MockProvider(async (req) => {
    providerCalls += 1;
    const last = req.messages[req.messages.length - 1];
    const content = "content" in last ? last.content : "";
    return { content: `echo:${content}` };
  });

  const telemetry = new RuntimeTelemetry();
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const registry = new ToolRegistry(new DefaultToolPolicyEngine(), telemetry);
  for (const tool of builtInTools()) {
    registry.register(tool);
  }

  const runtime = new AgentRuntime(provider, registry, fixture.config, logger);
  const contextBuilder = new ContextBuilder(
    fixture.storage,
    fixture.config,
    fixture.workspaceDir
  );
  const bus = new MessageBus(fixture.storage, fixture.config, logger);
  const router = new ConversationRouter(
    fixture.storage,
    contextBuilder,
    runtime,
    mcp,
    bus,
    logger,
    fixture.config,
    [],
    isolatedRuntime
  );

  let crashOnce = true;
  bus.onInbound(async (message) => {
    await router.handleInbound(message);
    if (crashOnce) {
      crashOnce = false;
      throw new Error("chaos: crash after router completed");
    }
  });

  const outbound: Array<{ content: string }> = [];
  bus.onOutbound(async (message) => {
    outbound.push({ content: message.content });
  });

  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "chaos" });
    fixture.storage.setChatRegistered(chat.id, true);

    bus.start();
    bus.publishInbound({
      id: "chaos-in-1",
      channel: "cli",
      chatId: "chaos",
      senderId: "user",
      content: "run chaos",
      createdAt: new Date().toISOString()
    });

    await waitUntil(() => outbound.length >= 1);
    await waitUntil(
      () => fixture.storage.countBusMessagesByStatus("inbound").processed >= 1
    );
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(providerCalls, 1);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0]?.content, "echo:run chaos");

    const history = fixture.storage.listRecentMessages(chat.id, 20);
    assert.equal(
      history.filter((item) => item.role === "assistant" && item.content === "echo:run chaos")
        .length,
      1
    );
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("Chaos: scheduler message retried after crash keeps single task run log", async () => {
  let providerCalls = 0;
  const fixture = createStorageFixture({
    scheduler: { tickMs: 20 },
    bus: {
      pollMs: 10,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 100,
      maxPendingOutbound: 100,
      overloadPendingThreshold: 80,
      overloadBackoffMs: 10,
      perChatRateLimitWindowMs: 10_000,
      perChatRateLimitMax: 100
    }
  });

  const provider = new MockProvider(async () => {
    providerCalls += 1;
    return { content: "scheduled-chaos-ok" };
  });

  const telemetry = new RuntimeTelemetry();
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const registry = new ToolRegistry(new DefaultToolPolicyEngine(), telemetry);
  for (const tool of builtInTools()) {
    registry.register(tool);
  }

  const runtime = new AgentRuntime(provider, registry, fixture.config, logger);
  const contextBuilder = new ContextBuilder(
    fixture.storage,
    fixture.config,
    fixture.workspaceDir
  );
  const bus = new MessageBus(fixture.storage, fixture.config, logger);
  const router = new ConversationRouter(
    fixture.storage,
    contextBuilder,
    runtime,
    mcp,
    bus,
    logger,
    fixture.config,
    [],
    isolatedRuntime
  );
  const scheduler = new Scheduler(
    fixture.storage,
    bus,
    logger,
    fixture.config,
    telemetry
  );

  let crashOnce = true;
  bus.onInbound(async (message) => {
    await router.handleInbound(message);
    if (message.metadata?.taskId && crashOnce) {
      crashOnce = false;
      throw new Error("chaos: scheduler crash after router completed");
    }
  });

  const outbound: Array<{ content: string }> = [];
  bus.onOutbound(async (message) => {
    outbound.push({ content: message.content });
  });

  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "chaos-scheduler" });
    fixture.storage.setChatRegistered(chat.id, true);
    const task = fixture.storage.createTask({
      chatFk: chat.id,
      prompt: "run scheduled chaos",
      scheduleType: "interval",
      scheduleValue: "60000",
      contextMode: "group",
      nextRunAt: new Date(Date.now() - 1_000).toISOString()
    });

    bus.start();
    scheduler.start();

    await waitUntil(() => outbound.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(providerCalls, 1);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0]?.content, "scheduled-chaos-ok");

    const runs = fixture.storage.listTaskRuns(task.id, 10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "success");
  } finally {
    scheduler.stop();
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});
