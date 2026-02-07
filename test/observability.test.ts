import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeTelemetry } from "../src/observability/telemetry.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { McpManager } from "../src/mcp/manager.js";
import { createStorageFixture } from "./test-utils.js";

test("RuntimeTelemetry aggregates tool and scheduler metrics", () => {
  const telemetry = new RuntimeTelemetry();
  telemetry.recordToolExecution("fs.read", 20, true);
  telemetry.recordToolExecution("fs.read", 40, false);
  telemetry.recordToolExecution("web.fetch", 100, true);
  telemetry.recordSchedulerDispatch([50, 100, 25]);

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.tools.totals.calls, 3);
  assert.equal(snapshot.tools.totals.failures, 1);
  assert.equal(snapshot.tools.totals.failureRate, 1 / 3);
  assert.equal(snapshot.scheduler.tasks, 3);
  assert.equal(snapshot.scheduler.maxDelayMs, 100);
});

test("Scheduler reports task delay telemetry", async () => {
  const fixture = createStorageFixture({
    scheduler: { tickMs: 20 }
  });
  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    fixture.storage.createTask({
      chatFk: chat.id,
      prompt: "delay-test",
      scheduleType: "interval",
      scheduleValue: "60000",
      contextMode: "group",
      nextRunAt: new Date(Date.now() - 500).toISOString()
    });

    const telemetry = new RuntimeTelemetry();
    const bus = {
      publishInbound: () => undefined
    } as any;
    const logger = {
      info: () => undefined,
      warn: () => undefined
    } as any;

    const scheduler = new Scheduler(
      fixture.storage,
      bus,
      logger,
      fixture.config,
      telemetry
    );
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    scheduler.stop();

    const snapshot = telemetry.snapshot();
    assert.ok(snapshot.scheduler.tasks >= 1);
    assert.ok(snapshot.scheduler.maxDelayMs >= 500);
  } finally {
    fixture.cleanup();
  }
});

test("McpManager exposes health snapshot with call stats", async () => {
  let failLoad = false;
  let failCall = false;

  const manager = new McpManager({
    factory: {
      async createClient(server) {
        if (server.name === "bad" || failLoad) {
          throw new Error("load failure");
        }
        return {
          client: {
            async listTools() {
              return [{ name: "echo", description: "echo", inputSchema: { type: "object" } }];
            },
            async callTool() {
              if (failCall) {
                throw new Error("call failure");
              }
              return { ok: true };
            },
            async connect() {
              return;
            },
            async close() {
              return;
            }
          }
        };
      }
    },
    logger: { warn: () => undefined } as any
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "corebot-mcp-health-"));
  try {
    const configPath = path.join(root, "mcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        servers: {
          good: { command: "noop" },
          bad: { command: "noop" }
        }
      }),
      "utf-8"
    );

    await manager.loadFromConfig(configPath);
    let health = manager.getHealthSnapshot();
    assert.equal(health.good?.status, "healthy");
    assert.equal(health.bad?.status, "down");

    await manager.callTool("mcp__good__echo", {});
    health = manager.getHealthSnapshot();
    assert.equal(health.good?.calls, 1);
    assert.equal(health.good?.failures, 0);

    failCall = true;
    await assert.rejects(manager.callTool("mcp__good__echo", {}), /call failure/);
    health = manager.getHealthSnapshot();
    assert.equal(health.good?.status, "degraded");
    assert.equal(health.good?.calls, 2);
    assert.equal(health.good?.failures, 1);
  } finally {
    await manager.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
