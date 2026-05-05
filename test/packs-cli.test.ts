import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runWorkclawInit } from "../src/install/init.js";
import {
  runPackDisable,
  runPackEnable,
  runPackInfo,
  runPackInstall
} from "../src/cli-management.js";
import { loadConfig } from "../src/config/load.js";
import { discoverWorkclawPacks } from "../src/packs/discovery.js";
import { SkillLoader } from "../src/skills/loader.js";

test("bundle imports normalize command markdown and mcp fragments", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-bundle-import-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const packRoot = path.join(root, "builtin-packs", "bundle-pack");
    const bundleRoot = path.join(packRoot, "codex-bundle");
    fs.mkdirSync(path.join(bundleRoot, "commands"), { recursive: true });
    fs.mkdirSync(path.join(bundleRoot, "mcp"), { recursive: true });
    fs.writeFileSync(
      path.join(bundleRoot, "commands", "review.md"),
      "# Review bundle skill\nRun code review.",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(bundleRoot, "mcp", "gitlab.json"),
      JSON.stringify({ servers: { gitlab: { command: "noop" } } }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(packRoot, "workclaw.pack.json"),
      JSON.stringify({
        id: "bundle-pack",
        type: "role-pack",
        description: "bundle import pack",
        bundles: [{ format: "codex", path: "codex-bundle" }]
      }),
      "utf-8"
    );

    const discovered = discoverWorkclawPacks(loadConfig());
    const pack = discovered.find((entry) => entry.id === "bundle-pack");
    assert.ok(pack);
    assert.ok(pack?.mcpFragments.some((entry) => entry.endsWith(path.join("codex-bundle", "mcp"))));
    const skills = new SkillLoader(pack?.skillRoots ?? []).listSkills();
    assert.ok(skills.some((skill) => skill.name === "review"));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack install and enable commands persist pack state and profile config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-cli-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const packRoot = path.join(root, "builtin-packs", "engineering-common");
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "workclaw.pack.json"),
      JSON.stringify({ id: "engineering-common", type: "role-pack", description: "base" }),
      "utf-8"
    );

    const install = runPackInstall("engineering-common");
    const enable = runPackEnable("engineering-common", "main", root);
    const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf-8"));
    const info = runPackInfo("engineering-common");

    assert.equal(install.packId, "engineering-common");
    assert.equal(enable.enablement.packId, "engineering-common");
    assert.ok(config.profiles.list[0].packs.includes("engineering-common"));
    assert.equal(info.id, "engineering-common");

    const disable = runPackDisable("engineering-common", "main", root);
    const configAfterDisable = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf-8"));
    assert.equal(disable.packId, "engineering-common");
    assert.deepEqual(configAfterDisable.profiles.list[0].packs, []);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack enable and disable honor explicit rootDir when cwd differs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-cli-root-"));
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-cli-other-"));
  const previousCwd = process.cwd();
  try {
    runWorkclawInit(root);
    const packRoot = path.join(root, "builtin-packs", "engineering-common");
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "workclaw.pack.json"),
      JSON.stringify({ id: "engineering-common", type: "role-pack", description: "base" }),
      "utf-8"
    );

    process.chdir(otherRoot);
    const enable = runPackEnable("engineering-common", "main", root);
    assert.equal(process.cwd(), fs.realpathSync(otherRoot));
    const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf-8"));
    assert.equal(enable.enablement.packId, "engineering-common");
    assert.ok(config.profiles.list[0].packs.includes("engineering-common"));
    assert.ok(fs.existsSync(path.join(root, "data", "bot.sqlite")));
    assert.equal(fs.existsSync(path.join(otherRoot, "data", "bot.sqlite")), false);

    const disable = runPackDisable("engineering-common", "main", root);
    const configAfterDisable = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf-8"));
    assert.equal(disable.packId, "engineering-common");
    assert.deepEqual(configAfterDisable.profiles.list[0].packs, []);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(otherRoot, { recursive: true, force: true });
  }
});

test("pack enable materializes implicit main profile for legacy config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-cli-legacy-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    delete config.profiles;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const packRoot = path.join(root, "builtin-packs", "engineering-common");
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "workclaw.pack.json"),
      JSON.stringify({ id: "engineering-common", type: "role-pack", description: "base" }),
      "utf-8"
    );

    const enable = runPackEnable("engineering-common", "main", root);
    const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    assert.equal(enable.enablement.profileId, "main");
    assert.deepEqual(
      updated.profiles.list.map((profile: { id: string }) => profile.id),
      ["main"]
    );
    assert.deepEqual(updated.profiles.list[0].packs, ["engineering-common"]);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack info reports blocked discovered packs without graph errors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-info-blocked-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const packRoot = path.join(root, "builtin-packs", "engineering-common");
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "workclaw.pack.json"),
      JSON.stringify({ id: "engineering-common", type: "role-pack", description: "base" }),
      "utf-8"
    );
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.packs.deny = ["engineering-common"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const info = runPackInfo("engineering-common");
    assert.equal(info.allowed, false);
    assert.equal(info.blockedReason, "denied by packs.deny");
    assert.deepEqual(info.graph, []);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack enable rejects blocked packs before mutating profile config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-enable-blocked-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const packRoot = path.join(root, "builtin-packs", "engineering-common");
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "workclaw.pack.json"),
      JSON.stringify({ id: "engineering-common", type: "role-pack", description: "base" }),
      "utf-8"
    );
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.packs.deny = ["engineering-common"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    assert.throws(
      () => runPackEnable("engineering-common", "main", root),
      /Pack engineering-common is blocked: denied by packs\.deny/
    );
    const configAfterEnable = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(configAfterEnable.profiles.list[0].packs, undefined);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack enable rejects packs with blocked dependencies before mutating profile config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-enable-blocked-dep-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const baseRoot = path.join(root, "builtin-packs", "base-pack");
    const childRoot = path.join(root, "builtin-packs", "child-pack");
    fs.mkdirSync(baseRoot, { recursive: true });
    fs.mkdirSync(childRoot, { recursive: true });
    fs.writeFileSync(
      path.join(baseRoot, "workclaw.pack.json"),
      JSON.stringify({ id: "base-pack", type: "role-pack", description: "base" }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(childRoot, "workclaw.pack.json"),
      JSON.stringify({
        id: "child-pack",
        type: "role-pack",
        description: "child",
        extends: ["base-pack"]
      }),
      "utf-8"
    );
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.packs.deny = ["base-pack"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    assert.throws(
      () => runPackEnable("child-pack", "main", root),
      /Pack child-pack cannot be enabled: Unknown pack in graph: base-pack/
    );
    const configAfterEnable = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(configAfterEnable.profiles.list[0].packs, undefined);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack disable rejects inherited default packs before mutating profile config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-disable-inherited-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.profiles.defaults.packs = ["engineering-common"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    assert.throws(
      () => runPackDisable("engineering-common", "main", root),
      /Pack engineering-common is inherited by profile main/
    );
    const configAfterDisable = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.deepEqual(configAfterDisable.profiles.defaults.packs, ["engineering-common"]);
    assert.equal(configAfterDisable.profiles.list[0].packs, undefined);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack disable rejects inherited team packs before mutating profile config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-disable-team-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.teams = {
      list: [
        {
          id: "platform",
          name: "Platform",
          profiles: ["main"],
          packs: ["team-shared"]
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    assert.throws(
      () => runPackDisable("team-shared", "main", root),
      /Pack team-shared is inherited by profile main/
    );
    const configAfterDisable = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.deepEqual(configAfterDisable.teams.list[0].packs, ["team-shared"]);
    assert.equal(configAfterDisable.profiles.list[0].packs, undefined);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
