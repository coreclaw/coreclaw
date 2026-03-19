import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrations } from "../src/storage/migrations.js";
import { SqliteStorage } from "../src/storage/sqlite.js";
import { createConfig, createStorageFixture } from "./test-utils.js";

test("fresh storage creates default main profile and tags new chats with profile_id", () => {
  const fixture = createStorageFixture();
  try {
    const profiles = fixture.storage.listProfiles();
    assert.equal(profiles.length, 1);
    assert.deepEqual(profiles[0], {
      id: "main",
      name: "Main",
      role: "general",
      workspaceDir: fixture.workspaceDir,
      stateDir: fixture.dataDir,
      llmProfile: "default",
      toolProfile: "default",
      disabled: false,
      createdAt: profiles[0]?.createdAt,
      updatedAt: profiles[0]?.updatedAt
    });

    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    assert.equal(chat.profileId, "main");
    assert.equal(fixture.storage.getChat("cli", "local")?.profileId, "main");
  } finally {
    fixture.cleanup();
  }
});

test("legacy schema upgrades existing chats and backfills main profile", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-profile-migrate-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const config = createConfig(workspaceDir, dataDir);
  const dbPath = config.sqlitePath;
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        error TEXT,
        backup_path TEXT
      );
    `);
    for (const migration of migrations.filter((entry) => entry.id <= 7)) {
      db.exec(migration.sql);
    }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', '7')").run();
    db.prepare(
      "INSERT INTO chats(id, channel, chat_id, display_name, last_message_at, role, registered) VALUES(?,?,?,?,?,?,?)"
    ).run("legacy-chat", "cli", "legacy", null, new Date().toISOString(), "normal", 0);
  } finally {
    db.close();
  }

  const storage = new SqliteStorage(config);
  try {
    storage.init();
    const profile = storage.getProfile("main");
    assert.ok(profile);
    assert.equal(profile?.workspaceDir, workspaceDir);
    assert.equal(profile?.stateDir, dataDir);

    const chat = storage.getChat("cli", "legacy");
    assert.ok(chat);
    assert.equal(chat?.profileId, "main");

    const history = storage.listMigrationHistory(20);
    assert.ok(history.some((entry) => entry.id === 8 && entry.status === "applied"));
  } finally {
    storage.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
