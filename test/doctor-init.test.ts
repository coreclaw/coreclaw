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
    assert.equal(fs.existsSync(path.join(result.mainProfileDir, "ROLE.md")), true);
    assert.equal(fs.existsSync(path.join(result.mainProfileDir, "MEMORY.md")), true);
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
    assert.ok(Array.isArray(report.profiles));
    assert.ok(report.bindings.count >= 0);
    assert.ok(report.outbound);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
