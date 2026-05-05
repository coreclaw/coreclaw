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
