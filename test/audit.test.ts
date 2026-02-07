import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tools/registry.js";
import { DefaultToolPolicyEngine } from "../src/tools/policy.js";
import { messageTools } from "../src/tools/builtins/message.js";
import { shellTools } from "../src/tools/builtins/shell.js";
import { createStorageFixture, createToolContext } from "./test-utils.js";

test("tool policy denials are persisted to audit events", async () => {
  const fixture = createStorageFixture({
    allowShell: true
  });

  try {
    const registry = new ToolRegistry(new DefaultToolPolicyEngine());
    for (const tool of shellTools()) {
      registry.register(tool);
    }

    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatRole: "normal"
    });

    await assert.rejects(
      registry.execute(
        "shell.exec",
        {
          command: "echo denied"
        },
        context
      ),
      /Policy denied/
    );

    const events = fixture.storage.listAuditEvents(10, "tool.execute");
    const denied = events.find((entry) => entry.toolName === "shell.exec");
    assert.ok(denied);
    assert.equal(denied?.outcome, "denied");
    assert.match(denied?.reason ?? "", /only admin/i);
  } finally {
    fixture.cleanup();
  }
});

test("audit event arguments redact sensitive keys", async () => {
  const fixture = createStorageFixture({
    adminBootstrapKey: "expected-bootstrap"
  });

  try {
    const registry = new ToolRegistry(new DefaultToolPolicyEngine());
    for (const tool of messageTools()) {
      registry.register(tool);
    }

    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatRole: "normal",
      channel: "cli",
      chatId: "audit-redact"
    });

    await assert.rejects(
      registry.execute(
        "chat.register",
        {
          role: "admin",
          bootstrapKey: "very-secret-token"
        },
        context
      ),
      /Invalid admin bootstrap key/
    );

    const events = fixture.storage.listAuditEvents(10, "tool.execute");
    const event = events.find((entry) => entry.toolName === "chat.register");
    assert.ok(event);
    assert.equal(event?.outcome, "error");
    const argsJson = event?.argsJson ?? "";
    assert.match(argsJson, /\[REDACTED\]/);
    assert.equal(argsJson.includes("very-secret-token"), false);
  } finally {
    fixture.cleanup();
  }
});
