import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ContextBuilder } from "../src/agent/context.js";
import { createCoreclawApp } from "../src/app.js";
import { ProfileRuntimeRegistry } from "../src/profiles/runtime.js";
import { MessageBus } from "../src/bus/bus.js";
import { ConversationRouter } from "../src/bus/router.js";
import { AgentRuntime, type LlmProvider } from "../src/agent/runtime.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { McpManager } from "../src/mcp/manager.js";
import { IsolatedToolRuntime } from "../src/isolation/runtime.js";
import { RuntimeTelemetry } from "../src/observability/telemetry.js";
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

test("ContextBuilder reads identity from the chat profile workspace", () => {
  const fixture = createStorageFixture({
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
    }
  });

  try {
    const devWorkspace = path.join(fixture.rootDir, "profiles", "dev");
    fs.mkdirSync(path.join(devWorkspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspaceDir, "IDENTITY.md"), "MAIN IDENTITY", "utf-8");
    fs.writeFileSync(path.join(devWorkspace, "IDENTITY.md"), "DEV IDENTITY", "utf-8");

    const chat = fixture.storage.upsertChat({
      profileId: "dev",
      channel: "cli",
      chatId: "local"
    });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const result = builder.build({
      chat,
      inbound: {
        id: "in-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString(),
        metadata: { profileId: "dev" }
      },
      skills: []
    });

    assert.equal(result.profile.id, "dev");
    assert.match(result.systemPrompt, /DEV IDENTITY/);
    assert.doesNotMatch(result.systemPrompt, /MAIN IDENTITY/);
  } finally {
    fixture.cleanup();
  }
});

test("ConversationRouter persists requested profile id and uses profile workspace", async () => {
  const fixture = createStorageFixture({
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

  const qaWorkspace = path.join(fixture.rootDir, "profiles", "qa");
  fs.mkdirSync(path.join(qaWorkspace, "memory"), { recursive: true });
  fs.writeFileSync(path.join(qaWorkspace, "IDENTITY.md"), "QA IDENTITY", "utf-8");

  const telemetry = new RuntimeTelemetry();
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const registry = new ToolRegistry(undefined, telemetry);
  const provider = new MockProvider(async (req) => {
    const system = req.messages[0];
    const content = system && "content" in system ? system.content : "";
    return { content: content.includes("QA IDENTITY") ? "qa-workspace" : "wrong-workspace" };
  });
  const runtime = new AgentRuntime(provider, registry, fixture.config, logger);
  const profileRegistry = new ProfileRuntimeRegistry(fixture.config, {
    instanceRoot: fixture.rootDir
  });
  const contextBuilder = new ContextBuilder(
    fixture.storage,
    fixture.config,
    fixture.workspaceDir,
    profileRegistry
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
  bus.onInbound(router.handleInbound);
  const outbound: string[] = [];
  bus.onOutbound(async (message) => {
    outbound.push(message.content);
  });

  try {
    bus.start();
    bus.publishInbound({
      id: "profile-qa-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "run",
      createdAt: new Date().toISOString(),
      metadata: {
        profileId: "qa"
      }
    });

    await waitUntil(() => outbound.length >= 1);
    assert.equal(outbound[0], "qa-workspace");
    assert.equal(fixture.storage.getChat("cli", "local", "qa")?.profileId, "qa");
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("ConversationRouter applies per-profile LLM model and temperature", async () => {
  const seen: Array<{ model: string; temperature?: number }> = [];
  const fixture = createStorageFixture({
    llm: {
      profiles: {
        qaModel: {
          provider: "openai",
          model: "qa-model",
          temperature: 0.7
        }
      }
    },
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
          role: "qa",
          llmProfile: "qaModel"
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

  const qaWorkspace = path.join(fixture.rootDir, "profiles", "qa");
  fs.mkdirSync(path.join(qaWorkspace, "memory"), { recursive: true });
  const telemetry = new RuntimeTelemetry();
  const mcp = new McpManager({ logger });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, logger);
  const registry = new ToolRegistry(undefined, telemetry);
  const provider = new MockProvider(async (req) => {
    seen.push({ model: req.model, temperature: req.temperature });
    return { content: "ok" };
  });
  const runtime = new AgentRuntime(provider, registry, fixture.config, logger);
  const profileRegistry = new ProfileRuntimeRegistry(fixture.config, {
    instanceRoot: fixture.rootDir
  });
  const contextBuilder = new ContextBuilder(
    fixture.storage,
    fixture.config,
    fixture.workspaceDir,
    profileRegistry
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
  bus.onInbound(router.handleInbound);

  try {
    bus.start();
    bus.publishInbound({
      id: "profile-llm-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "run",
      createdAt: new Date().toISOString(),
      metadata: {
        profileId: "qa"
      }
    });

    await waitUntil(() => seen.length >= 1);
    assert.equal(seen[0]?.model, "qa-model");
    assert.equal(seen[0]?.temperature, 0.7);
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});

test("createCoreclawApp materializes configured profile workspace and state directories", async () => {
  const fixture = createStorageFixture({
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "pm",
          name: "PM",
          role: "pm"
        },
        {
          id: "qa",
          name: "QA",
          role: "qa"
        }
      ]
    },
    cli: { enabled: false },
    webhook: { enabled: false },
    observability: {
      enabled: false,
      http: { enabled: false, host: "127.0.0.1", port: 3210 }
    }
  });

  try {
    const app = await createCoreclawApp({
      config: fixture.config,
      logger
    });
    try {
      assert.equal(fs.existsSync(path.join(fixture.rootDir, "profiles", "pm")), true);
      assert.equal(fs.existsSync(path.join(fixture.rootDir, "profiles", "qa")), true);
      assert.equal(fs.existsSync(path.join(fixture.rootDir, "state", "pm")), true);
      assert.equal(fs.existsSync(path.join(fixture.rootDir, "state", "qa")), true);
    } finally {
      await app.mcpManager.shutdown();
      await app.isolatedRuntime.shutdown();
      app.storage.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("createCoreclawApp loads skills from the active profile workspace", async () => {
  const fixture = createStorageFixture({
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
    cli: { enabled: false },
    webhook: { enabled: false },
    observability: {
      enabled: false,
      http: { enabled: false, host: "127.0.0.1", port: 3210 }
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

  const devSkillDir = path.join(fixture.rootDir, "profiles", "dev", "skills", "profile-skill");
  fs.mkdirSync(devSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(devSkillDir, "SKILL.md"),
    "---\nname: profile-skill\ndescription: from profile\nalways: false\n---\n# Profile Skill\n",
    "utf-8"
  );

  try {
    const app = await createCoreclawApp({
      config: fixture.config,
      logger
    });
    const outbound: string[] = [];
    try {
      app.runtime.provider = new MockProvider(async (req) => {
        const system = req.messages[0];
        const content = system && "content" in system ? system.content : "";
        return {
          content: content.includes("profile-skill")
            ? "profile-skill-visible"
            : "profile-skill-missing"
        };
      });
      app.bus.onOutbound(async (message) => {
        outbound.push(message.content);
      });
      await app.start();
      app.bus.publishInbound({
        id: "profile-skill-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "run",
        createdAt: new Date().toISOString(),
        metadata: {
          profileId: "dev"
        }
      });

      await waitUntil(() => outbound.length >= 1);
      assert.equal(outbound[0], "profile-skill-visible");
    } finally {
      await app.stop();
    }
  } finally {
    fixture.cleanup();
  }
});
