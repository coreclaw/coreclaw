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

const waitUntil = async (predicate: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for scenario.");
};

const createHarness = () => {
  const fixture = createStorageFixture({
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        { id: "pm", name: "PM", role: "pm" },
        { id: "dev", name: "Dev", role: "dev" },
        { id: "qa", name: "QA", role: "qa" }
      ]
    },
    bindings: [
      { id: "gitlab.dev", profileId: "dev", match: { surface: "gitlab", event: "merge_request.opened" } },
      { id: "jenkins.qa", profileId: "qa", match: { surface: "jenkins", event: "build.failed" } },
      { id: "issues.pm", profileId: "pm", match: { surface: "issues", event: "issue.created" } },
      { id: "slack.pm", profileId: "pm", match: { surface: "slack", event: "chat.message" } }
    ],
    bus: {
      pollMs: 10,
      batchSize: 20,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 5000,
      maxPendingOutbound: 5000,
      overloadPendingThreshold: 2000,
      overloadBackoffMs: 500,
      perChatRateLimitWindowMs: 60000,
      perChatRateLimitMax: 120
    }
  });
  for (const profileId of ["pm", "dev", "qa"]) {
    fs.mkdirSync(path.join(fixture.rootDir, "profiles", profileId, "memory"), { recursive: true });
    fs.writeFileSync(path.join(fixture.rootDir, "profiles", profileId, "IDENTITY.md"), profileId.toUpperCase(), "utf-8");
  }
  const provider = new MockProvider(async (req) => {
    const system = req.messages[0];
    const content = system && "content" in system ? system.content : "";
    if (content.includes("DEV")) return { content: "dev-summary" };
    if (content.includes("QA")) return { content: "qa-summary" };
    return { content: "pm-summary" };
  });
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
  return { fixture, bus, mcp, isolatedRuntime };
};

test("GitLab merge request, Jenkins failure, issue intake, and Slack message route to intended profiles", async () => {
  const { fixture, bus, mcp, isolatedRuntime } = createHarness();
  try {
    bus.start();
    bus.publishInbound({
      id: "evt-gitlab",
      channel: "webhook",
      chatId: "mr-42",
      senderId: "gitlab",
      content: "opened",
      createdAt: new Date().toISOString(),
      metadata: { surface: "gitlab", event: "merge_request.opened", sourceKey: "gitlab:group/project" }
    });
    bus.publishInbound({
      id: "evt-jenkins",
      channel: "webhook",
      chatId: "build-1",
      senderId: "jenkins",
      content: "failed",
      createdAt: new Date().toISOString(),
      metadata: { surface: "jenkins", event: "build.failed", sourceKey: "jenkins:nightly" }
    });
    bus.publishInbound({
      id: "evt-issue",
      channel: "webhook",
      chatId: "issue-1",
      senderId: "tracker",
      content: "new issue",
      createdAt: new Date().toISOString(),
      metadata: { surface: "issues", event: "issue.created", sourceKey: "issues:project" }
    });
    bus.publishInbound({
      id: "evt-slack",
      channel: "webhook",
      chatId: "slack-thread",
      senderId: "slack-user",
      content: "hello team",
      createdAt: new Date().toISOString(),
      metadata: { surface: "slack", event: "chat.message", sourceKey: "slack:team" }
    });

    await waitUntil(() => fixture.storage.listOutboundActions().length >= 4);
    assert.equal(fixture.storage.getChat("webhook", "gitlab:group/project", "dev")?.profileId, "dev");
    assert.equal(fixture.storage.getChat("webhook", "jenkins:nightly", "qa")?.profileId, "qa");
    assert.equal(fixture.storage.getChat("webhook", "issues:project", "pm")?.profileId, "pm");
    assert.equal(fixture.storage.getChat("webhook", "slack:team", "pm")?.profileId, "pm");
  } finally {
    bus.stop();
    await isolatedRuntime.shutdown();
    await mcp.shutdown();
    fixture.cleanup();
  }
});
