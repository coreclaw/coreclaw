import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/load.js";
import { resolveProfilesConfig } from "../src/profiles/resolve.js";
import { ProfileRuntimeRegistry } from "../src/profiles/runtime.js";
import { createConfig, createStorageFixture } from "./test-utils.js";

test("loadConfig synthesizes implicit main profile for legacy single-runtime config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-profile-load-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    fs.writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify({
        workspaceDir: "workspace",
        dataDir: "data"
      }),
      "utf-8"
    );

    const config = loadConfig();
    assert.equal(config.profiles.list?.length, 1);
    assert.deepEqual(config.profiles.list?.[0], {
      id: "main",
      name: "Main",
      role: "general",
      workspace: "workspace",
      stateDir: "data"
    });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProfilesConfig merges defaults and resolves absolute runtime paths", () => {
  const fixture = createStorageFixture();
  try {
    const config = createConfig(fixture.workspaceDir, fixture.dataDir, {
      profiles: {
        defaults: {
          workspaceRoot: "profiles",
          stateRoot: "state",
          packs: ["engineering-common"],
          llmProfile: "default",
          toolProfile: "default",
          memory: {
            includeTeamMemory: true
          }
        },
        list: [
          {
            id: "dev",
            name: "Developer",
            role: "dev",
            packs: ["role-dev-base", "engineering-common"],
            surfaces: {
              allow: ["gitlab"],
              deny: ["slack"]
            }
          }
        ]
      }
    });

    const profiles = resolveProfilesConfig(config, { instanceRoot: fixture.rootDir });
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0]?.id, "dev");
    assert.equal(profiles[0]?.workspaceDir, path.join(fixture.rootDir, "profiles", "dev"));
    assert.equal(profiles[0]?.stateDir, path.join(fixture.rootDir, "state", "dev"));
    assert.deepEqual(profiles[0]?.enabledPackIds, ["engineering-common", "role-dev-base"]);
    assert.equal(profiles[0]?.llmProfile, "default");
    assert.equal(profiles[0]?.toolProfile, "default");
    assert.equal(profiles[0]?.memory.includeTeamMemory, true);
    assert.deepEqual(profiles[0]?.surfaces.allow, ["gitlab"]);
    assert.deepEqual(profiles[0]?.surfaces.deny, ["slack"]);
  } finally {
    fixture.cleanup();
  }
});

test("ProfileRuntimeRegistry resolves nested relative workspace roots from cwd", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-profile-runtime-root-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const resolvedRoot = fs.realpathSync(root);
    const config = createConfig("runtime/workspace", "runtime/data", {
      profiles: {
        defaults: {
          workspaceRoot: "runtime/workspace/profiles",
          stateRoot: "runtime/data/profiles",
          llmProfile: "default",
          toolProfile: "default"
        },
        list: [
          {
            id: "dev",
            name: "Developer",
            role: "dev"
          }
        ]
      }
    });

    const registry = new ProfileRuntimeRegistry(config);
    const profile = registry.getRequired("dev");
    assert.equal(
      profile.workspaceDir,
      path.join(resolvedRoot, "runtime", "workspace", "profiles", "dev")
    );
    assert.equal(profile.stateDir, path.join(resolvedRoot, "runtime", "data", "profiles", "dev"));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ProfileRuntimeRegistry exposes active profiles separately from disabled profiles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-profile-disabled-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const config = createConfig("workspace", "data", {
      profiles: {
        defaults: {
          workspaceRoot: "workspace/profiles",
          stateRoot: "data/profiles",
          llmProfile: "default",
          toolProfile: "default"
        },
        list: [
          {
            id: "active",
            name: "Active",
            role: "dev"
          },
          {
            id: "archived",
            name: "Archived",
            role: "qa",
            disabled: true
          }
        ]
      }
    });

    const registry = new ProfileRuntimeRegistry(config);
    registry.ensureDirectories();
    assert.deepEqual(registry.list().map((profile) => profile.id), ["active", "archived"]);
    assert.deepEqual(registry.listActive().map((profile) => profile.id), ["active"]);
    assert.equal(fs.existsSync(path.join(root, "workspace", "profiles", "active")), true);
    assert.equal(fs.existsSync(path.join(root, "workspace", "profiles", "archived")), false);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProfilesConfig rejects duplicate profile ids", () => {
  const fixture = createStorageFixture();
  try {
    const config = createConfig(fixture.workspaceDir, fixture.dataDir, {
      profiles: {
        list: [
          {
            id: "dev",
            name: "Developer One",
            role: "dev"
          },
          {
            id: "dev",
            name: "Developer Two",
            role: "dev"
          }
        ]
      }
    });

    assert.throws(() => resolveProfilesConfig(config), /Duplicate profile id: dev/);
  } finally {
    fixture.cleanup();
  }
});

test("resolveProfilesConfig rejects missing llm and tool profile references", () => {
  const fixture = createStorageFixture();
  try {
    const config = createConfig(fixture.workspaceDir, fixture.dataDir, {
      profiles: {
        list: [
          {
            id: "qa",
            name: "QA",
            role: "qa",
            llmProfile: "missing-llm",
            toolProfile: "missing-tools"
          }
        ]
      }
    });

    assert.throws(
      () => resolveProfilesConfig(config),
      /Profile qa references missing llmProfile: missing-llm/
    );
  } finally {
    fixture.cleanup();
  }
});

test("resolveProfilesConfig rejects colliding resolved paths across profiles", () => {
  const fixture = createStorageFixture();
  try {
    const config = createConfig(fixture.workspaceDir, fixture.dataDir, {
      profiles: {
        list: [
          {
            id: "pm",
            name: "PM",
            role: "pm",
            workspace: "shared/profile",
            stateDir: "shared/state"
          },
          {
            id: "qa",
            name: "QA",
            role: "qa",
            workspace: "shared/profile",
            stateDir: "shared/state-qa"
          }
        ]
      }
    });

    assert.throws(
      () => resolveProfilesConfig(config, { instanceRoot: fixture.rootDir }),
      /Resolved workspaceDir collides/
    );
  } finally {
    fixture.cleanup();
  }
});
