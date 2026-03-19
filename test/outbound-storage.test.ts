import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createStorageFixture, createConfig } from "./test-utils.js";
import { enqueueOutboundAction } from "../src/outbound/queue.js";
import {
  markOutboundActionFailed,
  markOutboundActionSending,
  markOutboundActionSent
} from "../src/outbound/dispatch.js";
import { migrations } from "../src/storage/migrations.js";
import { SqliteStorage } from "../src/storage/sqlite.js";

test("enqueueOutboundAction stores queued outbound actions", () => {
  const fixture = createStorageFixture();
  try {
    const action = enqueueOutboundAction(fixture.storage, {
      sourceEventId: "evt-1",
      bindingId: "binding.qa",
      profileId: "main",
      targetSurface: "internal",
      targetChannelKey: "qa",
      payload: { summary: "handoff" }
    });
    assert.equal(action.deliveryState, "queued");
    assert.equal(fixture.storage.listOutboundActions().length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("outbound action dispatch helpers update delivery state", () => {
  const fixture = createStorageFixture();
  try {
    const action = enqueueOutboundAction(fixture.storage, {
      profileId: "main",
      targetSurface: "internal",
      payload: { summary: "handoff" }
    });
    markOutboundActionSending(fixture.storage, action.id);
    assert.equal(fixture.storage.getOutboundAction(action.id)?.deliveryState, "sending");
    markOutboundActionFailed(fixture.storage, action.id, 2, "2030-01-01T00:00:00.000Z");
    assert.equal(fixture.storage.getOutboundAction(action.id)?.deliveryState, "failed");
    markOutboundActionSent(fixture.storage, action.id);
    assert.equal(fixture.storage.getOutboundAction(action.id)?.deliveryState, "sent");
  } finally {
    fixture.cleanup();
  }
});

test("legacy schema upgrades to outbound_actions table", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-outbound-migrate-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const config = createConfig(workspaceDir, dataDir);
  const db = new Database(config.sqlitePath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        error TEXT,
        backup_path TEXT
      );
    `);
    for (const migration of migrations.filter((entry) => entry.id <= 9)) {
      db.exec(migration.sql);
    }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', '9')").run();
  } finally {
    db.close();
  }

  const storage = new SqliteStorage(config);
  try {
    storage.init();
    enqueueOutboundAction(storage, {
      profileId: "main",
      targetSurface: "internal",
      payload: { summary: "handoff" }
    });
    assert.equal(storage.listOutboundActions().length, 1);
    const history = storage.listMigrationHistory(20);
    assert.ok(history.some((entry) => entry.id === 10 && entry.status === "applied"));
  } finally {
    storage.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
