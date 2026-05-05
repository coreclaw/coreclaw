import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tools/registry.js";
import { taskTools } from "../src/tools/builtins/tasks.js";
import { createStorageFixture, createToolContext } from "./test-utils.js";

test("task tools accept all scheduled context modes", async () => {
  const fixture = createStorageFixture();
  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const registry = new ToolRegistry();
    for (const tool of taskTools()) {
      registry.register(tool);
    }
    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      chatId: "local"
    });

    const scheduled = JSON.parse(
      await registry.execute(
        "tasks.schedule",
        {
          prompt: "summarize unresolved work",
          scheduleType: "once",
          scheduleValue: new Date(Date.now() + 60_000).toISOString(),
          contextMode: "minimal"
        },
        context
      )
    );
    assert.equal(scheduled.contextMode, "minimal");

    const updated = JSON.parse(
      await registry.execute(
        "tasks.update",
        {
          taskId: scheduled.id,
          contextMode: "full"
        },
        context
      )
    );
    assert.equal(updated.updated.contextMode, "full");
    assert.equal(fixture.storage.getTask(scheduled.id)?.contextMode, "full");
  } finally {
    fixture.cleanup();
  }
});
