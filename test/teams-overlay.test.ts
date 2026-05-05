import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createStorageFixture, createConfig } from "./test-utils.js";
import { applyTeamOverlay } from "../src/teams/overlay.js";
import { resolveProfilesConfig } from "../src/profiles/resolve.js";
import { migrations } from "../src/storage/migrations.js";
import { SqliteStorage } from "../src/storage/sqlite.js";

test("applyTeamOverlay appends packs and merges tool policy without changing surfaces", () => {
  const fixture = createStorageFixture({
    profiles: {
      list: [
        {
          id: "dev",
          name: "Developer",
          role: "dev",
          packs: ["role-dev-base"],
          surfaces: {
            allow: ["gitlab", "github"],
            deny: ["slack"]
          }
        }
      ]
    }
  });
  try {
    const profile = resolveProfilesConfig(fixture.config)[0]!;
    const merged = applyTeamOverlay(profile, {
      id: "team-core",
      name: "Core Team",
      workspaceDir: "/tmp/team-core",
      packs: ["engineering-common"],
      metadata: { team: "core" },
      toolPolicy: {
        allow: ["gitlab"],
        deny: ["github"]
      }
    });
    assert.deepEqual(merged.enabledPackIds, ["role-dev-base", "engineering-common"]);
    assert.deepEqual(merged.surfaces.allow, ["gitlab", "github"]);
    assert.deepEqual(merged.surfaces.deny, ["slack"]);
    assert.deepEqual(merged.toolPolicy.allow, ["gitlab"]);
    assert.deepEqual(merged.toolPolicy.deny, ["github"]);
    assert.equal(merged.metadata.team, "core");
  } finally {
    fixture.cleanup();
  }
});

test("team overlay migration adds persistent overlay records", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-team-overlay-"));
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
    for (const migration of migrations.filter((entry) => entry.id <= 10)) {
      db.exec(migration.sql);
    }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', '10')").run();
  } finally {
    db.close();
  }

  const storage = new SqliteStorage(config);
  try {
    storage.init();
    storage.upsertTeamOverlay({
      id: "team-core",
      name: "Core Team",
      workspaceDir: "/tmp/team-core",
      manifestJson: JSON.stringify({ id: "team-core" })
    });
    assert.equal(storage.listTeamOverlays().length, 1);
    const history = storage.listMigrationHistory(20);
    assert.ok(history.some((entry) => entry.id === 11 && entry.status === "applied"));
  } finally {
    storage.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
