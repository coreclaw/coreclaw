import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrations } from "../src/storage/migrations.js";
import { SqliteStorage } from "../src/storage/sqlite.js";
import { createStorageFixture, createConfig } from "./test-utils.js";
import { recordDiscoveredPackInstall, enablePackForProfile, disablePackForProfile } from "../src/packs/install.js";
import { loadProfilePackGraph } from "../src/packs/loader.js";

test("fresh storage records pack installs and profile enablements", () => {
  const fixture = createStorageFixture();
  try {
    const discovered = {
      id: "engineering-common",
      rootDir: "/packs/engineering-common",
      sourceRoot: "/packs",
      manifestPath: "/packs/engineering-common/workclaw.pack.json",
      manifest: {
        id: "engineering-common",
        type: "role-pack" as const,
        description: "base"
      },
      skillRoots: [],
      mcpFragments: [],
      templateRoots: [],
      bootstrapEntries: [],
      allowed: true,
      warnings: []
    };

    const install = recordDiscoveredPackInstall(fixture.storage, discovered);
    assert.equal(install.packId, "engineering-common");
    assert.equal(install.installState, "validated");

    const enablement = enablePackForProfile(fixture.storage, "main", "engineering-common");
    assert.equal(enablement.profileId, "main");
    assert.equal(enablement.packId, "engineering-common");
    assert.equal(fixture.storage.listProfilePackEnablements("main").length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("loadProfilePackGraph resolves enabled packs for one profile", () => {
  const fixture = createStorageFixture();
  try {
    const discovered = [
      {
        id: "engineering-common",
        rootDir: "/packs/engineering-common",
        sourceRoot: "/packs",
        manifestPath: "/packs/engineering-common/workclaw.pack.json",
        manifest: {
          id: "engineering-common",
          type: "role-pack" as const,
          description: "base"
        },
        skillRoots: [],
        mcpFragments: [],
        templateRoots: [],
        bootstrapEntries: [],
        allowed: true,
        warnings: []
      },
      {
        id: "role-dev-base",
        rootDir: "/packs/role-dev-base",
        sourceRoot: "/packs",
        manifestPath: "/packs/role-dev-base/workclaw.pack.json",
        manifest: {
          id: "role-dev-base",
          type: "role-pack" as const,
          description: "dev",
          extends: ["engineering-common"]
        },
        skillRoots: [],
        mcpFragments: [],
        templateRoots: [],
        bootstrapEntries: [],
        allowed: true,
        warnings: []
      }
    ];

    recordDiscoveredPackInstall(fixture.storage, discovered[0]);
    recordDiscoveredPackInstall(fixture.storage, discovered[1]);
    enablePackForProfile(fixture.storage, "main", "role-dev-base");

    const loaded = loadProfilePackGraph(fixture.storage, discovered, "main");
    assert.deepEqual(loaded.graph.map((pack) => pack.id), ["engineering-common", "role-dev-base"]);
  } finally {
    fixture.cleanup();
  }
});

test("disablePackForProfile removes enablement but keeps install record", () => {
  const fixture = createStorageFixture();
  try {
    const discovered = {
      id: "engineering-common",
      rootDir: "/packs/engineering-common",
      sourceRoot: "/packs",
      manifestPath: "/packs/engineering-common/workclaw.pack.json",
      manifest: {
        id: "engineering-common",
        type: "role-pack" as const,
        description: "base"
      },
      skillRoots: [],
      mcpFragments: [],
      templateRoots: [],
      bootstrapEntries: [],
      allowed: true,
      warnings: []
    };

    recordDiscoveredPackInstall(fixture.storage, discovered);
    enablePackForProfile(fixture.storage, "main", "engineering-common");
    disablePackForProfile(fixture.storage, "main", "engineering-common");

    assert.equal(fixture.storage.getPackInstall("engineering-common")?.packId, "engineering-common");
    assert.equal(fixture.storage.getProfilePackEnablement("main", "engineering-common"), null);
  } finally {
    fixture.cleanup();
  }
});

test("legacy schema upgrades to pack install tables", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-migrate-"));
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
    for (const migration of migrations.filter((entry) => entry.id <= 8)) {
      db.exec(migration.sql);
    }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', '8')").run();
  } finally {
    db.close();
  }
  const storage = new SqliteStorage(config);
  try {
    storage.init();
    const discovered = {
      id: "engineering-common",
      rootDir: "/packs/engineering-common",
      sourceRoot: "/packs",
      manifestPath: "/packs/engineering-common/workclaw.pack.json",
      manifest: {
        id: "engineering-common",
        type: "role-pack" as const,
        description: "base"
      },
      skillRoots: [],
      mcpFragments: [],
      templateRoots: [],
      bootstrapEntries: [],
      allowed: true,
      warnings: []
    };

    recordDiscoveredPackInstall(storage, discovered);
    assert.equal(storage.listPackInstalls().length, 1);
    const history = storage.listMigrationHistory(20);
    assert.ok(history.some((entry) => entry.id === 9 && entry.status === "applied"));
  } finally {
    storage.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
