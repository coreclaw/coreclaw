import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ContextBuilder } from "../src/agent/context.js";
import { createStorageFixture } from "./test-utils.js";

test("ContextBuilder full mode injects pack index, memory, summary, and skill bodies", () => {
  const fixture = createStorageFixture({
    profiles: {
      list: [
        {
          id: "dev",
          name: "Developer",
          role: "dev",
          packs: ["role-dev-base"]
        }
      ]
    }
  });
  try {
    const profileDir = path.join(fixture.workspaceDir, "profiles", "dev");
    fs.mkdirSync(path.join(profileDir, "memory"), { recursive: true });
    fs.mkdirSync(path.join(profileDir, "skills", "bundle-skill"), { recursive: true });
    fs.writeFileSync(path.join(profileDir, "memory", "MEMORY.md"), "GLOBAL MEMORY", "utf-8");
    fs.writeFileSync(
      path.join(profileDir, "skills", "bundle-skill", "SKILL.md"),
      "---\nname: bundle-skill\ndescription: bundle skill\nalways: false\n---\n# Bundle Skill\nDetails",
      "utf-8"
    );
    const chat = fixture.storage.upsertChat({ profileId: "dev", channel: "cli", chatId: "local" });
    fixture.storage.setConversationState({
      chatFk: chat.id,
      summary: "RECENT SUMMARY",
      enabledSkills: ["bundle-skill"],
      lastCompactAt: null
    });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const result = builder.build({
      chat,
      inbound: {
        id: "full-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString()
      },
      skills: [
        {
          name: "bundle-skill",
          description: "bundle skill",
          always: false,
          dir: path.join(profileDir, "skills", "bundle-skill"),
          skillPath: path.join(profileDir, "skills", "bundle-skill", "SKILL.md")
        }
      ]
    });
    assert.match(result.systemPrompt, /Pack Index/);
    assert.match(result.systemPrompt, /role-dev-base/);
    assert.match(result.systemPrompt, /GLOBAL MEMORY/);
    assert.match(result.systemPrompt, /RECENT SUMMARY/);
    assert.match(result.systemPrompt, /Bundle Skill/);
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder minimal mode keeps summary and pack index but omits memory and skill bodies", () => {
  const fixture = createStorageFixture({
    profiles: {
      list: [
        {
          id: "qa",
          name: "QA",
          role: "qa",
          packs: ["role-qa-base"]
        }
      ]
    }
  });
  try {
    const profileDir = path.join(fixture.workspaceDir, "profiles", "qa");
    fs.mkdirSync(path.join(profileDir, "memory"), { recursive: true });
    fs.mkdirSync(path.join(profileDir, "skills", "test-skill"), { recursive: true });
    fs.writeFileSync(path.join(profileDir, "memory", "MEMORY.md"), "GLOBAL MEMORY", "utf-8");
    fs.writeFileSync(
      path.join(profileDir, "skills", "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: test skill\nalways: false\n---\n# Hidden Body\n",
      "utf-8"
    );
    const chat = fixture.storage.upsertChat({ profileId: "qa", channel: "cli", chatId: "local" });
    fixture.storage.setConversationState({
      chatFk: chat.id,
      summary: "MINIMAL SUMMARY",
      enabledSkills: ["test-skill"],
      lastCompactAt: null
    });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const result = builder.build({
      chat,
      inbound: {
        id: "minimal-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString(),
        metadata: { isScheduledTask: true, contextMode: "minimal" }
      },
      runMode: { kind: "scheduled", contextMode: "minimal" },
      skills: [
        {
          name: "test-skill",
          description: "test skill",
          always: false,
          dir: path.join(profileDir, "skills", "test-skill"),
          skillPath: path.join(profileDir, "skills", "test-skill", "SKILL.md")
        }
      ]
    });
    assert.match(result.systemPrompt, /Pack Index/);
    assert.match(result.systemPrompt, /MINIMAL SUMMARY/);
    assert.doesNotMatch(result.systemPrompt, /GLOBAL MEMORY/);
    assert.doesNotMatch(result.systemPrompt, /Hidden Body/);
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder isolated mode omits conversation summary and global memory", () => {
  const fixture = createStorageFixture();
  try {
    const chat = fixture.storage.upsertChat({ profileId: "main", channel: "cli", chatId: "local" });
    fixture.storage.setConversationState({
      chatFk: chat.id,
      summary: "ISOLATED SUMMARY",
      enabledSkills: [],
      lastCompactAt: null
    });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const result = builder.build({
      chat,
      inbound: {
        id: "isolated-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString(),
        metadata: { isScheduledTask: true, contextMode: "isolated" }
      },
      runMode: { kind: "scheduled", contextMode: "isolated" },
      skills: []
    });
    assert.doesNotMatch(result.systemPrompt, /ISOLATED SUMMARY/);
    assert.doesNotMatch(result.systemPrompt, /Global Memory/);
  } finally {
    fixture.cleanup();
  }
});
