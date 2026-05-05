import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runWorkclawInit } from "../src/install/init.js";
import { runProfileAdd } from "../src/install/profile-init.js";
import { runPackInfo, runPacksList, runProfilesList, runProfilesResolve } from "../src/cli-management.js";

test("runProfileAdd updates config and scaffolds workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-profile-add-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const result = runProfileAdd("qa", "qa", root);
    const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf-8"));
    assert.equal(fs.existsSync(path.join(result.workspaceDir, "IDENTITY.md")), true);
    assert.equal(fs.existsSync(path.join(result.workspaceDir, "ROLE.md")), true);
    assert.equal(fs.existsSync(path.join(result.workspaceDir, "memory", "MEMORY.md")), true);
    assert.ok(config.profiles.list.some((entry: { id: string }) => entry.id === "qa"));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runProfilesList and runProfilesResolve reflect current config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-profiles-list-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    runProfileAdd("qa", "qa", root);
    assert.ok(runProfilesList().some((profile) => profile.id === "qa"));
    assert.equal(runProfilesResolve("qa").id, "qa");
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPacksList and runPackInfo inspect discovered packs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-packs-list-"));
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
    const packs = runPacksList();
    const info = runPackInfo("engineering-common");
    assert.ok(packs.some((pack) => pack.id === "engineering-common"));
    assert.equal(info.id, "engineering-common");
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
