import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SkillLoader } from "../src/skills/loader.js";
import { createCoreclawApp } from "../src/app.js";
import {
  buildEffectiveMcpConfig,
  buildMcpServerProfileScopes,
  listMcpFragmentConfigFiles,
  loadProfilePackGraph
} from "../src/packs/loader.js";
import { enablePackForProfile, recordDiscoveredPackInstall } from "../src/packs/install.js";
import { resolveRuntimeToolPolicy } from "../src/packs/policy.js";
import { resolveProfilesConfig } from "../src/profiles/resolve.js";
import { createConfig, createStorageFixture } from "./test-utils.js";

const logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  child: () => logger
} as any;

test("pack-enabled skill roots become visible to SkillLoader", () => {
  const fixture = createStorageFixture();
  try {
    const packRoot = path.join(fixture.rootDir, "packs", "engineering-common");
    const skillRoot = path.join(packRoot, "skills");
    fs.mkdirSync(path.join(skillRoot, "pack-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, "pack-skill", "SKILL.md"),
      `---\nname: pack-skill\ndescription: from pack\nalways: false\n---\n# Pack Skill`,
      "utf-8"
    );
    const discovered = {
      id: "engineering-common",
      rootDir: packRoot,
      sourceRoot: path.join(fixture.rootDir, "packs"),
      manifestPath: path.join(packRoot, "workclaw.pack.json"),
      manifest: {
        id: "engineering-common",
        type: "role-pack" as const,
        description: "base",
        skills: ["skills"]
      },
      skillRoots: [skillRoot],
      mcpFragments: [],
      templateRoots: [],
      bootstrapEntries: [],
      allowed: true,
      warnings: []
    };
    recordDiscoveredPackInstall(fixture.storage, discovered);
    enablePackForProfile(fixture.storage, "main", "engineering-common");
    const loaded = loadProfilePackGraph(fixture.storage, [discovered], "main");
    const skills = new SkillLoader([fixture.config.skillsDir, ...loaded.skillRoots]).listSkills();
    assert.ok(skills.some((skill) => skill.name === "pack-skill"));
  } finally {
    fixture.cleanup();
  }
});

test("pack MCP fragments merge into effective runtime MCP config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-mcp-"));
  try {
    const fragmentDir = path.join(root, "mcp");
    fs.mkdirSync(fragmentDir, { recursive: true });
    fs.writeFileSync(
      path.join(fragmentDir, "gitlab.json"),
      JSON.stringify({
        servers: {
          gitlab: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-gitlab"]
          }
        }
      }),
      "utf-8"
    );

    assert.deepEqual(listMcpFragmentConfigFiles(fragmentDir).map((entry) => path.basename(entry)), [
      "gitlab.json"
    ]);

    const merged = buildEffectiveMcpConfig(
      {
        servers: {
          base: {
            command: "node",
            args: ["base.js"]
          }
        }
      },
      [{ mcpFragments: [fragmentDir] }]
    );

    assert.deepEqual(Object.keys(merged.servers).sort(), ["base", "gitlab"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack MCP directory fragments reject conflicting server definitions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-mcp-dir-conflict-"));
  try {
    const fragmentDir = path.join(root, "mcp");
    fs.mkdirSync(fragmentDir, { recursive: true });
    fs.writeFileSync(
      path.join(fragmentDir, "a.json"),
      JSON.stringify({
        servers: {
          shared: { command: "node", args: ["a.js"] }
        }
      }),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(fragmentDir, "b.json"),
      JSON.stringify({
        servers: {
          shared: { command: "node", args: ["b.js"] }
        }
      }),
      "utf-8"
    );

    assert.throws(
      () => buildEffectiveMcpConfig(null, [{ mcpFragments: [fragmentDir] }]),
      /MCP server 'shared' has conflicting definitions/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack MCP server scopes are derived from profile graphs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-mcp-scope-"));
  try {
    const devFragment = path.join(root, "dev.json");
    const qaFragment = path.join(root, "qa.json");
    fs.writeFileSync(
      devFragment,
      JSON.stringify({
        servers: {
          devtools: { command: "node", args: ["dev.js"] },
          shared: { command: "node", args: ["shared-dev.js"] },
          base: { command: "node", args: ["base.js"] }
        }
      }),
      "utf-8"
    );
    fs.writeFileSync(
      qaFragment,
      JSON.stringify({
        servers: {
          qatools: { command: "node", args: ["qa.js"] },
          shared: { command: "node", args: ["shared-dev.js"] }
        }
      }),
      "utf-8"
    );

    const scopes = buildMcpServerProfileScopes(
      {
        servers: {
          base: { command: "node", args: ["base.js"] }
        }
      },
      [
        { profileId: "dev", mcpFragments: [devFragment] },
        { profileId: "qa", mcpFragments: [qaFragment] }
      ]
    );
    const normalized = Object.fromEntries(
      [...scopes.entries()].map(([server, profiles]) => [server, [...profiles].sort()])
    );

    assert.deepEqual(normalized, {
      devtools: ["dev"],
      qatools: ["qa"],
      shared: ["dev", "qa"]
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack MCP server merge rejects conflicting scoped server definitions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-mcp-conflict-"));
  try {
    const devFragment = path.join(root, "dev.json");
    const qaFragment = path.join(root, "qa.json");
    fs.writeFileSync(
      devFragment,
      JSON.stringify({
        servers: {
          shared: { command: "node", args: ["dev.js"] }
        }
      }),
      "utf-8"
    );
    fs.writeFileSync(
      qaFragment,
      JSON.stringify({
        servers: {
          shared: { command: "node", args: ["qa.js"] }
        }
      }),
      "utf-8"
    );

    assert.throws(
      () =>
        buildEffectiveMcpConfig(null, [
          { mcpFragments: [devFragment] },
          { mcpFragments: [qaFragment] }
        ]),
      /MCP server 'shared' has conflicting definitions/
    );
    assert.throws(
      () =>
        buildEffectiveMcpConfig(
          {
            servers: {
              shared: { command: "node", args: ["base.js"] }
            }
          },
          [{ mcpFragments: [devFragment] }]
        ),
      /MCP server 'shared' has conflicting definitions/
    );
    assert.throws(
      () =>
        buildMcpServerProfileScopes(null, [
          { profileId: "dev", mcpFragments: [devFragment] },
          { profileId: "qa", mcpFragments: [qaFragment] }
        ]),
      /MCP server 'shared' has conflicting definitions/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createCoreclawApp removes stale pack enablements that are no longer in config", async () => {
  const fixture = createStorageFixture({
    cli: { enabled: false },
    webhook: { enabled: false },
    observability: {
      enabled: false,
      http: { enabled: false, host: "127.0.0.1", port: 3210 }
    }
  });
  try {
    fixture.storage.enablePackForProfile({
      profileId: "main",
      packId: "stale-pack"
    });
    const app = await createCoreclawApp({
      config: fixture.config,
      logger
    });
    try {
      assert.equal(app.storage.getProfilePackEnablement("main", "stale-pack"), null);
    } finally {
      await app.mcpManager.shutdown();
      await app.isolatedRuntime.shutdown();
      app.storage.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("runtime tool policy applies pack referenced tool profile and elevated gate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-policy-"));
  try {
    const config = createConfig(path.join(root, "workspace"), path.join(root, "data"), {
      toolProfiles: {
        default: {
          allow: ["fs.*"],
          deny: []
        },
        packSafe: {
          allow: ["fs.read"],
          deny: ["shell.exec"]
        }
      }
    });
    const profile = resolveProfilesConfig(config, { instanceRoot: root })[0]!;
    const policy = resolveRuntimeToolPolicy({
      config,
      profile,
      packToolPolicy: {
        profile: "packSafe",
        elevated: { enabled: false }
      }
    });

    assert.deepEqual(policy.allow, ["fs.read"]);
    assert.deepEqual(policy.allowGroups, [["fs.*"], ["fs.read"]]);
    assert.deepEqual(policy.deny, ["shell.exec"]);
    assert.deepEqual(policy.elevated, { enabled: false });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
