import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runDoctorChecks } from "../src/doctor.js";
import { runWorkclawInit } from "../src/install/init.js";
import { scaffoldTeamWorkspace } from "../src/install/team-init.js";

test("runWorkclawInit scaffolds config and main profile workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-init-"));
  try {
    const result = runWorkclawInit(root);
    assert.equal(fs.existsSync(result.configPath), true);
    assert.equal(fs.existsSync(path.join(result.mainProfileDir, "IDENTITY.md")), true);
    assert.equal(fs.existsSync(path.join(result.mainProfileDir, "ROLE.md")), true);
    assert.equal(fs.existsSync(path.join(result.mainProfileDir, "MEMORY.md")), true);
    assert.equal(fs.existsSync(path.join(result.mainProfileDir, "memory", "MEMORY.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("scaffoldTeamWorkspace creates team overlay files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-team-init-"));
  const teamDir = path.join(root, "workspace", "teams", "core");
  try {
    scaffoldTeamWorkspace(teamDir);
    assert.equal(fs.existsSync(path.join(teamDir, "TEAM.md")), true);
    assert.equal(fs.existsSync(path.join(teamDir, "PROCESS.md")), true);
    assert.equal(fs.existsSync(path.join(teamDir, "MEMORY.md")), true);
    assert.equal(fs.existsSync(path.join(teamDir, "memory", "MEMORY.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runDoctorChecks reports runtime sections for current instance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-doctor-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const report = runDoctorChecks();
    assert.ok(report.runtime.queue);
    assert.ok(Array.isArray(report.runtime.profileRuntimeHealth));
    assert.ok(Array.isArray(report.profiles));
    assert.ok(report.bindings.count >= 0);
    assert.ok(report.outbound);
    assert.ok(report.surfaces);
    assert.ok(report.mcp);
    assert.ok(report.storage);
    assert.ok(report.security);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runDoctorChecks resolves config-defined pack graphs without storage warmup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-doctor-packs-"));
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
    config.profiles.list[0].packs = ["engineering-common"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const report = runDoctorChecks();
    assert.deepEqual(report.profiles[0]?.enabledPackIds, ["engineering-common"]);
    assert.deepEqual(report.packs.effectiveGraphs, [
      { profileId: "main", graph: ["engineering-common"] }
    ]);
    assert.equal(report.storage.packInstalls, 0);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runDoctorChecks reports disabled profiles without resolving their pack graphs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-doctor-disabled-profile-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const configPath = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.profiles.list.push({
      id: "archived",
      name: "Archived",
      role: "qa",
      workspace: "./missing-archived-workspace",
      packs: ["missing-pack"],
      disabled: true
    });
    config.bindings = [
      { id: "archived-binding", profileId: "archived", match: { surface: "cli" } },
      { id: "missing-binding", profileId: "missing", match: { surface: "cli" } }
    ];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const report = runDoctorChecks();
    assert.equal(report.profiles.find((profile) => profile.id === "archived")?.disabled, true);
    assert.deepEqual(report.packs.effectiveGraphs, [{ profileId: "main", graph: [] }]);
    assert.deepEqual(report.bindings.profileIssues, [
      { bindingId: "archived-binding", profileId: "archived", reason: "disabled" },
      { bindingId: "missing-binding", profileId: "missing", reason: "missing" }
    ]);
    assert.equal(
      report.warnings.some((warning) => warning.includes("archived workspace is missing")),
      false
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
