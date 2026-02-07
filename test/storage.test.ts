import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createStorageFixture } from "./test-utils.js";

test("listTasks supports global listing without chat filter", () => {
  const fixture = createStorageFixture();
  try {
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    fixture.storage.createTask({
      chatFk: chat.id,
      prompt: "Ping me",
      scheduleType: "interval",
      scheduleValue: "60000",
      contextMode: "group",
      nextRunAt: new Date(Date.now() + 60_000).toISOString()
    });

    const allTasks = fixture.storage.listTasks();
    assert.equal(allTasks.length, 1);
    assert.equal(allTasks[0]?.chatFk, chat.id);
  } finally {
    fixture.cleanup();
  }
});

test("countAdminChats reflects admin role assignments", () => {
  const fixture = createStorageFixture();
  try {
    const first = fixture.storage.upsertChat({ channel: "cli", chatId: "a" });
    const second = fixture.storage.upsertChat({ channel: "cli", chatId: "b" });
    fixture.storage.setChatRole(first.id, "admin");
    fixture.storage.setChatRole(second.id, "normal");

    assert.equal(fixture.storage.countAdminChats(), 1);
  } finally {
    fixture.cleanup();
  }
});

test("admin bootstrap usage flag is persisted in meta table", () => {
  const fixture = createStorageFixture();
  try {
    assert.equal(fixture.storage.isAdminBootstrapUsed(), false);
    fixture.storage.setAdminBootstrapUsed(true);
    assert.equal(fixture.storage.isAdminBootstrapUsed(), true);
  } finally {
    fixture.cleanup();
  }
});

test("admin bootstrap security state is persisted in meta table", () => {
  const fixture = createStorageFixture();
  try {
    assert.deepEqual(fixture.storage.getAdminBootstrapSecurityState(), {
      failedAttempts: 0,
      lockUntil: null
    });
    const lockUntil = "2030-01-01T00:00:00.000Z";
    fixture.storage.setAdminBootstrapSecurityState({
      failedAttempts: 3,
      lockUntil
    });
    assert.deepEqual(fixture.storage.getAdminBootstrapSecurityState(), {
      failedAttempts: 3,
      lockUntil
    });
  } finally {
    fixture.cleanup();
  }
});

test("migration history records applied migrations with backup path", () => {
  const fixture = createStorageFixture();
  try {
    const history = fixture.storage.listMigrationHistory(20);
    assert.ok(history.length >= 5);
    assert.equal(history[0]?.status, "applied");
    const backup = history[0]?.backupPath;
    assert.ok(backup);
    assert.equal(fs.existsSync(String(backup)), true);
  } finally {
    fixture.cleanup();
  }
});
