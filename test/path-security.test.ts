import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveWorkspacePath,
  getChatMemoryRelativePath,
  getLegacyChatMemoryRelativePath
} from "../src/util/file.js";
import { createStorageFixture, createToolContext } from "./test-utils.js";
import { memoryTools } from "../src/tools/builtins/memory.js";
import { ContextBuilder } from "../src/agent/context.js";

test("resolveWorkspacePath blocks symlink escape for existing and missing targets", () => {
  const fixture = createStorageFixture();
  try {
    const outsideDir = path.join(fixture.rootDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret", "utf-8");

    const linkPath = path.join(fixture.workspaceDir, "link-outside");
    fs.symlinkSync(outsideDir, linkPath, "dir");

    assert.throws(
      () => resolveWorkspacePath(fixture.workspaceDir, "link-outside/secret.txt"),
      /outside workspace/
    );
    assert.throws(
      () => resolveWorkspacePath(fixture.workspaceDir, "link-outside/new.txt"),
      /outside workspace/
    );
  } finally {
    fixture.cleanup();
  }
});

test("chat memory paths remain in workspace for traversal-like chat ids", async () => {
  const fixture = createStorageFixture();
  try {
    const chatId = "../../../../secret";
    const outsidePath = path.join(fixture.rootDir, "secret.md");
    fs.writeFileSync(outsidePath, "do-not-leak", "utf-8");

    const chat = fixture.storage.upsertChat({ channel: "webhook", chatId });
    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      channel: "webhook",
      chatId,
      chatRole: "admin"
    });

    const writeTool = memoryTools().find((tool) => tool.name === "memory.write");
    assert.ok(writeTool, "memory.write tool missing");
    await writeTool!.run(
      {
        scope: "chat",
        content: "safe-memory",
        mode: "replace"
      },
      context
    );

    const safeMemoryPath = resolveWorkspacePath(
      fixture.workspaceDir,
      getChatMemoryRelativePath("webhook", chatId)
    );
    assert.equal(fs.readFileSync(safeMemoryPath, "utf-8"), "safe-memory");
    assert.equal(fs.readFileSync(outsidePath, "utf-8"), "do-not-leak");

    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const built = builder.build({
      chat,
      skills: [],
      inbound: {
        id: "inbound-1",
        channel: "webhook",
        chatId,
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString()
      }
    });
    assert.ok(!built.systemPrompt.includes("do-not-leak"));
    assert.ok(built.systemPrompt.includes("safe-memory"));
  } finally {
    fixture.cleanup();
  }
});

test("chat memory falls back to existing legacy filename for compatibility", async () => {
  const fixture = createStorageFixture();
  try {
    const channel = "webhook";
    const chatId = "team alpha";
    const legacyPath = resolveWorkspacePath(
      fixture.workspaceDir,
      getLegacyChatMemoryRelativePath(channel, chatId)
    );
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, "legacy-memory", "utf-8");

    const chat = fixture.storage.upsertChat({ channel, chatId });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const built = builder.build({
      chat,
      skills: [],
      inbound: {
        id: "inbound-legacy",
        channel,
        chatId,
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString()
      }
    });
    assert.ok(built.systemPrompt.includes("legacy-memory"));

    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      channel,
      chatId,
      chatRole: "admin"
    });
    const writeTool = memoryTools().find((tool) => tool.name === "memory.write");
    assert.ok(writeTool, "memory.write tool missing");
    await writeTool!.run(
      {
        scope: "chat",
        content: "new-memory",
        mode: "append"
      },
      context
    );

    assert.equal(fs.readFileSync(legacyPath, "utf-8"), "legacy-memory\nnew-memory");
    const preferredPath = resolveWorkspacePath(
      fixture.workspaceDir,
      getChatMemoryRelativePath(channel, chatId)
    );
    if (preferredPath !== legacyPath) {
      assert.equal(fs.existsSync(preferredPath), false);
    }
  } finally {
    fixture.cleanup();
  }
});
