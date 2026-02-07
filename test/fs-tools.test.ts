import test from "node:test";
import assert from "node:assert/strict";
import { fsTools } from "../src/tools/builtins/fs.js";
import { IsolatedToolRuntime } from "../src/isolation/runtime.js";
import { createStorageFixture, createToolContext } from "./test-utils.js";

const getTool = (name: string) => {
  const tool = fsTools().find((item) => item.name === name);
  if (!tool) {
    throw new Error(`${name} tool missing`);
  }
  return tool;
};

const createNoopLogger = () =>
  ({
    fatal: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    child: () => createNoopLogger()
  }) as any;

test("fs.write isolated runtime writes and appends content", async () => {
  const fixture = createStorageFixture({
    isolation: {
      enabled: true,
      toolNames: ["fs.write"],
      workerTimeoutMs: 30_000,
      maxWorkerOutputChars: 250_000
    }
  });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, createNoopLogger());

  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      isolatedRuntime
    });
    const writeTool = getTool("fs.write");
    const readTool = getTool("fs.read");

    await writeTool.run({ path: "notes/value.txt", content: "hello\n" }, context);
    await writeTool.run(
      { path: "notes/value.txt", content: "world\n", mode: "append" },
      context
    );

    const content = await readTool.run({ path: "notes/value.txt" }, context);
    assert.equal(content, "hello\nworld\n");
  } finally {
    await isolatedRuntime.shutdown();
    fixture.cleanup();
  }
});

test("fs.write isolated runtime enforces workspace boundary", async () => {
  const fixture = createStorageFixture({
    isolation: {
      enabled: true,
      toolNames: ["fs.write"],
      workerTimeoutMs: 30_000,
      maxWorkerOutputChars: 250_000
    }
  });
  const isolatedRuntime = new IsolatedToolRuntime(fixture.config, createNoopLogger());

  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      isolatedRuntime
    });
    const writeTool = getTool("fs.write");

    await assert.rejects(
      writeTool.run({ path: "../outside.txt", content: "blocked" }, context),
      /outside workspace/
    );
  } finally {
    await isolatedRuntime.shutdown();
    fixture.cleanup();
  }
});
