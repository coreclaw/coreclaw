import test from "node:test";
import assert from "node:assert/strict";
import {
  formatUserContentForRunMode,
  isHeartbeatRunMode,
  resolveRunMode,
  shouldIncludeChatContext,
  shouldWakeHeartbeatAfterRun
} from "../src/agent/run-mode.js";

test("resolveRunMode maps chat, scheduled and heartbeat messages", () => {
  const chat = resolveRunMode({
    id: "m1",
    channel: "cli",
    chatId: "c1",
    senderId: "u1",
    content: "hello",
    createdAt: new Date().toISOString()
  });
  assert.deepEqual(chat, {
    kind: "chat",
    contextMode: "group"
  });

  const scheduled = resolveRunMode({
    id: "m2",
    channel: "cli",
    chatId: "c1",
    senderId: "scheduler",
    content: "task",
    createdAt: new Date().toISOString(),
    metadata: {
      isScheduledTask: true,
      contextMode: "isolated"
    }
  });
  assert.deepEqual(scheduled, {
    kind: "scheduled",
    contextMode: "isolated"
  });

  const heartbeat = resolveRunMode({
    id: "m3",
    channel: "cli",
    chatId: "c1",
    senderId: "heartbeat",
    content: "heartbeat",
    createdAt: new Date().toISOString(),
    metadata: {
      isHeartbeat: true,
      isScheduledTask: true,
      contextMode: "isolated"
    }
  });
  assert.deepEqual(heartbeat, {
    kind: "heartbeat",
    contextMode: "group"
  });
});

test("RunMode helpers keep routing and context behavior consistent", () => {
  const scheduledIsolated = {
    kind: "scheduled",
    contextMode: "isolated"
  } as const;
  assert.equal(shouldIncludeChatContext(scheduledIsolated), false);
  assert.equal(
    formatUserContentForRunMode(scheduledIsolated, "check backups"),
    "[Scheduled Task] check backups"
  );
  assert.equal(shouldWakeHeartbeatAfterRun(scheduledIsolated), true);

  const heartbeat = {
    kind: "heartbeat",
    contextMode: "group"
  } as const;
  assert.equal(isHeartbeatRunMode(heartbeat), true);
  assert.equal(shouldWakeHeartbeatAfterRun(heartbeat), false);
  assert.equal(shouldIncludeChatContext(heartbeat), true);
});
