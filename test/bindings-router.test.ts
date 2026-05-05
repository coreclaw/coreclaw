import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MessageBus } from "../src/bus/bus.js";
import { ConversationRouter } from "../src/bus/router.js";
import { ContextBuilder } from "../src/agent/context.js";
import { AgentRuntime, type LlmProvider } from "../src/agent/runtime.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { McpManager } from "../src/mcp/manager.js";
import { IsolatedToolRuntime } from "../src/isolation/runtime.js";
import type { ChatMessage, ToolCall } from "../src/types.js";
import { createStorageFixture } from "./test-utils.js";

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

test("ConversationRouter routes normalized gitlab events through bindings and records outbound actions", async () => {
  const fixture = createStorageFixture({
    bindings: [
      {
        id: "binding.gitlab.mr.dev",
        profileId: "dev",
        match: {
          surface: "gitlab",
          event: "merge_request.opened",
          repoKey: "group/project"
        },
        action: {
          mode: "conversation",
          threadKeyTemplate: "gitlab:mr:${payload.mergeRequestIid}"
        }
      }
    ],
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "dev",
          name: "Developer",
          role: "dev"
        }
      ]
    },
    bus: {
      pollMs: 10,
      batchSize: 20,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 5_000,
      maxPendingOutbound: 5_000,
      overloadPendingThreshold: 2_000,
      overloadBackoffMs: 500,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 120
    }
  });

  const provider = new MockProvider(async () => ({ content: "reviewed" }));
  fs.mkdirSync(path.join(fixture.rootDir, "profiles", "dev", "memory"), { recursive: true });
  const runtime = new AgentRuntime(provider, new ToolRegistry(), fixture.config, logger);
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const contextBuilder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
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
  bus.onInbound(router.handleInbound);

  try {
    bus.start();
    bus.publishInbound({
      id: "evt-1",
      channel: "webhook",
      chatId: "mr-42",
      senderId: "gitlab",
      content: "opened",
      createdAt: new Date().toISOString(),
      metadata: {
        surface: "gitlab",
        event: "merge_request.opened",
        repoKey: "group/project",
        payload: {
          mergeRequestIid: 42
        },
        sourceKey: "gitlab:group/project",
        channelKey: "gitlab:group/project"
      }
    });

    await waitUntil(() => fixture.storage.listOutboundActions().length >= 1);
    const chat = fixture.storage.getChat("webhook", "gitlab:mr:42", "dev");
    const outbound = fixture.storage.listOutboundActions({ profileId: "dev" })[0];

    assert.equal(chat?.profileId, "dev");
    assert.equal(outbound?.bindingId, "binding.gitlab.mr.dev");
    assert.equal(outbound?.profileId, "dev");
    assert.equal(outbound?.targetSurface, "gitlab");
    assert.equal(outbound?.targetThreadKey, "gitlab:mr:42");
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("ConversationRouter keeps immediate CLI replies while also recording outbound actions", async () => {
  const fixture = createStorageFixture({
    bindings: [
      {
        id: "binding.cli.qa",
        profileId: "qa",
        match: {
          surface: "cli",
          event: "message.received"
        }
      }
    ],
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "qa",
          name: "QA",
          role: "qa"
        }
      ]
    },
    bus: {
      pollMs: 10,
      batchSize: 20,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 5_000,
      maxPendingOutbound: 5_000,
      overloadPendingThreshold: 2_000,
      overloadBackoffMs: 500,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 120
    }
  });
  const provider = new MockProvider(async () => ({ content: "qa reply" }));
  fs.mkdirSync(path.join(fixture.rootDir, "profiles", "qa", "memory"), { recursive: true });
  const runtime = new AgentRuntime(provider, new ToolRegistry(), fixture.config, logger);
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const contextBuilder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
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
  bus.onInbound(router.handleInbound);
  const outboundMessages: string[] = [];
  bus.onOutbound(async (message) => {
    outboundMessages.push(message.content);
  });

  try {
    bus.start();
    bus.publishInbound({
      id: "evt-cli-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "hello",
      createdAt: new Date().toISOString()
    });

    await waitUntil(() => outboundMessages.length >= 1);
    assert.equal(outboundMessages[0], "qa reply");
    assert.equal(fixture.storage.listOutboundActions({ profileId: "qa" }).length, 1);
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("ConversationRouter sends same-surface explicit-target replies to resolved target chat", async () => {
  const fixture = createStorageFixture({
    bindings: [
      {
        id: "binding.cli.explicit.qa",
        profileId: "qa",
        match: {
          surface: "cli",
          event: "message.received"
        },
        action: {
          outbound: {
            targetMode: "explicit-target",
            surface: "cli",
            threadKeyTemplate: "target:${payload.room}"
          }
        }
      }
    ],
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "qa",
          name: "QA",
          role: "qa"
        }
      ]
    },
    bus: {
      pollMs: 10,
      batchSize: 20,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 5_000,
      maxPendingOutbound: 5_000,
      overloadPendingThreshold: 2_000,
      overloadBackoffMs: 500,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 120
    }
  });
  const provider = new MockProvider(async () => ({ content: "qa explicit reply" }));
  fs.mkdirSync(path.join(fixture.rootDir, "profiles", "qa", "memory"), { recursive: true });
  const runtime = new AgentRuntime(provider, new ToolRegistry(), fixture.config, logger);
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const contextBuilder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
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
  bus.onInbound(router.handleInbound);
  const outboundMessages: Array<{ channel: string; chatId: string; content: string }> = [];
  bus.onOutbound(async (message) => {
    outboundMessages.push({
      channel: message.channel,
      chatId: message.chatId,
      content: message.content
    });
  });

  try {
    bus.start();
    bus.publishInbound({
      id: "evt-cli-explicit-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "hello",
      createdAt: new Date().toISOString(),
      metadata: {
        surface: "cli",
        payload: {
          room: "qa"
        }
      }
    });

    await waitUntil(() => outboundMessages.length >= 1);
    assert.deepEqual(outboundMessages[0], {
      channel: "cli",
      chatId: "target:qa",
      content: "qa explicit reply"
    });
    const outboundAction = fixture.storage.listOutboundActions({ profileId: "qa" })[0];
    assert.equal(outboundAction?.targetThreadKey, "target:qa");
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("ConversationRouter honors binding registerConversation=false", async () => {
  const fixture = createStorageFixture({
    bindings: [
      {
        id: "binding.silent.audit",
        profileId: "qa",
        match: {
          surface: "audit",
          event: "message.received"
        },
        action: {
          registerConversation: false,
          replyMode: "silent",
          outbound: { targetMode: "none" }
        }
      }
    ],
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "qa",
          name: "QA",
          role: "qa"
        }
      ]
    },
    bus: {
      pollMs: 10,
      batchSize: 20,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 5_000,
      maxPendingOutbound: 5_000,
      overloadPendingThreshold: 2_000,
      overloadBackoffMs: 500,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 120
    }
  });
  const provider = new MockProvider(async () => ({ content: "processed" }));
  fs.mkdirSync(path.join(fixture.rootDir, "profiles", "qa", "memory"), { recursive: true });
  const runtime = new AgentRuntime(provider, new ToolRegistry(), fixture.config, logger);
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const contextBuilder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
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
  bus.onInbound(router.handleInbound);

  try {
    bus.start();
    bus.publishInbound({
      id: "evt-audit-1",
      channel: "webhook",
      chatId: "audit-1",
      senderId: "audit",
      content: "run",
      createdAt: new Date().toISOString(),
      metadata: {
        surface: "audit"
      }
    });

    await waitUntil(() => fixture.storage.countBusMessagesByStatus("inbound").processed >= 1);
    const chat = fixture.storage.getChat("webhook", "webhook:audit-1", "qa");
    assert.ok(chat);
    assert.equal(fixture.storage.countMessages(chat.id), 0);
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("ConversationRouter drops duplicated binding events within dedupe window", async () => {
  let calls = 0;
  const fixture = createStorageFixture({
    bindings: [
      {
        id: "binding.dedupe",
        profileId: "qa",
        match: {
          surface: "dedupe",
          event: "message.received"
        },
        policy: {
          dedupeWindowMs: 60_000
        },
        action: {
          outbound: { targetMode: "none" }
        }
      }
    ],
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "qa",
          name: "QA",
          role: "qa"
        }
      ]
    },
    bus: {
      pollMs: 10,
      batchSize: 20,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 5_000,
      maxPendingOutbound: 5_000,
      overloadPendingThreshold: 2_000,
      overloadBackoffMs: 500,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 120
    }
  });
  const provider = new MockProvider(async () => {
    calls += 1;
    return { content: "processed" };
  });
  fs.mkdirSync(path.join(fixture.rootDir, "profiles", "qa", "memory"), { recursive: true });
  const runtime = new AgentRuntime(provider, new ToolRegistry(), fixture.config, logger);
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const contextBuilder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
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
  bus.onInbound(router.handleInbound);

  try {
    bus.start();
    const base = {
      id: "same-event",
      channel: "webhook",
      chatId: "dedupe-1",
      senderId: "dedupe",
      content: "run",
      createdAt: new Date().toISOString(),
      metadata: {
        surface: "dedupe"
      }
    };
    bus.publishInbound(base);
    bus.publishInbound({
      ...base,
      chatId: "dedupe-2"
    });

    await waitUntil(() => fixture.storage.countBusMessagesByStatus("inbound").processed >= 2);
    assert.equal(calls, 1);
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});
