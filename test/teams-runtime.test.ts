import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ContextBuilder } from "../src/agent/context.js";
import { resolveProfilesConfig } from "../src/profiles/resolve.js";
import { createStorageFixture } from "./test-utils.js";
import { runWorkclawInit } from "../src/install/init.js";
import { runTeamInit } from "../src/install/team-init.js";

test("resolveProfilesConfig applies team overlays to packs and metadata", () => {
  const fixture = createStorageFixture({
    profiles: {
      list: [
        {
          id: "dev",
          name: "Developer",
          role: "dev",
          packs: ["role-dev-base"]
        }
      ]
    },
    teams: {
      list: [
        {
          id: "platform",
          name: "Platform Team",
          packs: ["team-shared"],
          profiles: ["dev"],
          metadata: { team: "platform" },
          toolPolicy: {
            allow: ["gitlab"],
            deny: ["github"]
          }
        }
      ]
    }
  });
  try {
    const profile = resolveProfilesConfig(fixture.config, { instanceRoot: fixture.rootDir })[0]!;
    assert.deepEqual(profile.teamIds, ["platform"]);
    assert.ok(profile.enabledPackIds.includes("team-shared"));
    assert.equal(profile.metadata.team, "platform");
    assert.deepEqual(profile.toolPolicy.allow, ["gitlab"]);
    assert.deepEqual(profile.toolPolicy.deny, ["github"]);
  } finally {
    fixture.cleanup();
  }
});

test("ContextBuilder injects team overlay workspace files", () => {
  const fixture = createStorageFixture({
    profiles: {
      defaults: {
        workspaceRoot: "profiles",
        stateRoot: "state",
        llmProfile: "default",
        toolProfile: "default"
      },
      list: [
        {
          id: "dev",
          name: "Developer",
          role: "dev",
          teams: ["platform"]
        }
      ]
    },
    teams: {
      list: [
        {
          id: "platform",
          name: "Platform Team"
        }
      ]
    }
  });
  try {
    const profileWorkspace = path.join(fixture.rootDir, "profiles", "dev");
    fs.mkdirSync(path.join(profileWorkspace, "memory"), { recursive: true });
    const teamDir = path.join(fixture.workspaceDir, "teams", "platform");
    fs.mkdirSync(path.join(teamDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(teamDir, "TEAM.md"), "PLATFORM TEAM", "utf-8");
    const chat = fixture.storage.upsertChat({ profileId: "dev", channel: "cli", chatId: "local" });
    const builder = new ContextBuilder(fixture.storage, fixture.config, fixture.workspaceDir);
    const result = builder.build({
      chat,
      inbound: {
        id: "evt-team-1",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "hello",
        createdAt: new Date().toISOString()
      },
      skills: []
    });
    assert.match(result.systemPrompt, /PLATFORM TEAM/);
  } finally {
    fixture.cleanup();
  }
});

test("runTeamInit scaffolds team workspace, member profiles, and example bindings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-team-init-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    runWorkclawInit(root);
    const result = runTeamInit("platform", root);
    const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf-8"));
    assert.equal(fs.existsSync(path.join(result.workspaceDir, "TEAM.md")), true);
    assert.ok(config.teams.list.some((entry: { id: string }) => entry.id === "platform"));
    assert.ok(config.profiles.list.some((entry: { id: string }) => entry.id === "platform-dev"));
    const devProfile = config.profiles.list.find((entry: { id: string }) => entry.id === "platform-dev");
    const pmProfile = config.profiles.list.find((entry: { id: string }) => entry.id === "platform-pm");
    assert.ok(devProfile?.teams.includes("platform"));
    assert.ok(devProfile?.packs.includes("platform-gitlab"));
    assert.ok(pmProfile?.packs.includes("role-pm-base"));
    assert.ok(
      config.bindings.some((entry: { id: string }) => entry.id === "platform.gitlab.merge-request")
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
