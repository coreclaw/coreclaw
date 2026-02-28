import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { skillTools } from "../src/tools/builtins/skills.js";
import { ContextBuilder } from "../src/agent/context.js";
import type { SkillIndexEntry } from "../src/skills/types.js";
import { createStorageFixture, createToolContext } from "./test-utils.js";

const getTool = (name: string) => {
  const tool = skillTools().find((item) => item.name === name);
  if (!tool) {
    throw new Error(`${name} tool missing`);
  }
  return tool;
};

test("skills.enable/disable updates conversation state", async () => {
  const fixture = createStorageFixture();
  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const skill: SkillIndexEntry = {
      name: "sample",
      description: "sample skill",
      always: false,
      dir: path.join(fixture.workspaceDir, "skills", "sample"),
      skillPath: path.join(fixture.workspaceDir, "skills", "sample", "SKILL.md")
    };
    fs.mkdirSync(skill.dir, { recursive: true });
    fs.writeFileSync(skill.skillPath, "# Sample Skill\nBody", "utf-8");

    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      skills: [skill]
    });

    await getTool("skills.enable").run({ name: "sample" }, context);
    assert.deepEqual(fixture.storage.getConversationState(chat.id).enabledSkills, ["sample"]);

    const list = await getTool("skills.list").run({}, context);
    assert.match(list, /"enabled": true/);

    await getTool("skills.disable").run({ name: "sample" }, context);
    assert.deepEqual(fixture.storage.getConversationState(chat.id).enabledSkills, []);
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder injects enabled skill bodies", () => {
  const fixture = createStorageFixture();
  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const skill: SkillIndexEntry = {
      name: "writer",
      description: "writing helper",
      always: false,
      dir: path.join(fixture.workspaceDir, "skills", "writer"),
      skillPath: path.join(fixture.workspaceDir, "skills", "writer", "SKILL.md")
    };
    fs.mkdirSync(skill.dir, { recursive: true });
    fs.writeFileSync(skill.skillPath, "# Writer Skill\nUse concise writing.", "utf-8");
    fixture.storage.setConversationState({
      chatFk: chat.id,
      summary: "",
      enabledSkills: ["writer"],
      lastCompactAt: null
    });

    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const built = builder.build({
      chat,
      skills: [skill],
      inbound: {
        id: "1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString()
      }
    });

    assert.match(built.systemPrompt, /# Enabled Skills/);
    assert.match(built.systemPrompt, /Writer Skill/);
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder drops oldest history entries to respect token budget", () => {
  const fixture = createStorageFixture({
    provider: {
      maxInputTokens: 220,
      reserveOutputTokens: 100
    }
  });
  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    fixture.storage.insertMessage({
      chatFk: chat.id,
      senderId: "u1",
      role: "user",
      content: `OLD-${"a".repeat(420)}`,
      stored: true,
      createdAt: new Date(Date.now() - 2_000).toISOString()
    });
    fixture.storage.insertMessage({
      chatFk: chat.id,
      senderId: "a1",
      role: "assistant",
      content: `NEW-${"b".repeat(420)}`,
      stored: true,
      createdAt: new Date(Date.now() - 1_000).toISOString()
    });

    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const built = builder.build({
      chat,
      skills: [],
      inbound: {
        id: "budget-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: `INBOUND-${"c".repeat(120)}`,
        createdAt: new Date().toISOString()
      }
    });

    const contents = built.messages
      .flatMap((message) =>
        "content" in message && typeof message.content === "string" ? [message.content] : []
      )
      .join("\n");
    assert.ok(contents.includes("INBOUND-"));
    assert.ok(!contents.includes("OLD-"));
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder truncates oversized system prompt under token budget", () => {
  const fixture = createStorageFixture({
    provider: {
      maxInputTokens: 180,
      reserveOutputTokens: 120
    }
  });
  try {
    fs.writeFileSync(path.join(fixture.workspaceDir, "IDENTITY.md"), "x".repeat(2_000), "utf-8");
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const built = builder.build({
      chat,
      skills: [],
      inbound: {
        id: "budget-2",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: `REQUEST-${"y".repeat(120)}`,
        createdAt: new Date().toISOString()
      }
    });

    assert.match(built.systemPrompt, /\[truncated by token budget\]/);
    const last = built.messages[built.messages.length - 1];
    assert.ok(last && "content" in last && String(last.content).includes("REQUEST-"));
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder applies stricter budget for CJK-heavy prompts", () => {
  const fixture = createStorageFixture({
    provider: {
      maxInputTokens: 220,
      reserveOutputTokens: 120
    }
  });
  try {
    fs.writeFileSync(path.join(fixture.workspaceDir, "IDENTITY.md"), "你".repeat(600), "utf-8");
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const built = builder.build({
      chat,
      skills: [],
      inbound: {
        id: "budget-cjk-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "请总结",
        createdAt: new Date().toISOString()
      }
    });

    assert.match(built.systemPrompt, /\[truncated by token budget\]/);
    const last = built.messages[built.messages.length - 1];
    assert.ok(last && "content" in last && String(last.content).includes("请总结"));
  } finally {
    fixture.cleanup();
  }
});
