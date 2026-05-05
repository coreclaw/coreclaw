import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/bin.js";
import { runPreflightChecks } from "../src/preflight.js";
import { runPackPreflightChecks } from "../src/preflight-packs.js";
import { createConfig } from "./test-utils.js";

const writePack = (rootDir: string, manifest: Record<string, unknown>) => {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "workclaw.pack.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
};

test("runPreflightChecks validates explicit MCP config path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coreclaw-preflight-"));
  try {
    const mcpPath = path.join(root, "mcp.json");
    fs.writeFileSync(mcpPath, JSON.stringify({ servers: { demo: { command: "noop" } } }), "utf-8");

    const report = runPreflightChecks({ mcpConfigPath: mcpPath });
    assert.equal(report.mcpConfigPresent, true);
    assert.equal(report.mcpServerCount, 1);
    assert.equal(report.resolvedMcpConfigPath, path.resolve(mcpPath));
    assert.equal(typeof report.workspaceExists, "boolean");
    assert.equal(typeof report.identityFilePresent, "boolean");
    assert.equal(typeof report.toolsFilePresent, "boolean");
    assert.equal(typeof report.providerApiKeyPresent, "boolean");
    assert.equal(typeof report.profilesResolved, "number");
    assert.equal(typeof report.bindingsCount, "number");
    assert.equal(typeof report.packCount, "number");
    assert.ok(Array.isArray(report.profileGraphs));
    assert.equal(typeof report.mcpFragmentCount, "number");
    assert.ok(Array.isArray(report.missingRequiredEnv));
    assert.ok(Array.isArray(report.templateIssues));
    assert.ok(Array.isArray(report.bundleIssues));
    assert.equal(typeof report.surfaceAuthConsistent, "boolean");
    assert.ok(Array.isArray(report.warnings));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("coreclaw preflight command accepts missing MCP config file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coreclaw-preflight-missing-"));
  try {
    const mcpPath = path.join(root, "missing.json");
    await runCli(["preflight", "--mcp-config", mcpPath]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("coreclaw preflight command rejects invalid MCP config", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coreclaw-preflight-invalid-"));
  try {
    const mcpPath = path.join(root, "mcp.json");
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({
        servers: {
          broken: { command: "noop", url: "http://localhost:4321" }
        }
      }),
      "utf-8"
    );
    await assert.rejects(
      runCli(["preflight", "--mcp-config", mcpPath]),
      /Invalid MCP config/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack preflight checks required env after effective graph merge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coreclaw-preflight-pack-env-"));
  const envName = "WORKCLAW_PREFLIGHT_REQUIRED_OVERRIDE_TEST";
  const previousEnv = process.env[envName];
  try {
    delete process.env[envName];
    const workspaceDir = path.join(root, "workspace");
    const dataDir = path.join(root, "data");
    const packsRoot = path.join(root, "packs");
    writePack(path.join(packsRoot, "base-pack"), {
      id: "base-pack",
      type: "role-pack",
      description: "base",
      env: [{ name: envName, required: true }]
    });
    writePack(path.join(packsRoot, "child-pack"), {
      id: "child-pack",
      type: "role-pack",
      description: "child",
      extends: ["base-pack"],
      env: [{ name: envName, required: false }]
    });
    const config = createConfig(workspaceDir, dataDir, {
      packs: {
        enabledRoots: [packsRoot]
      },
      profiles: {
        defaults: {
          packs: ["child-pack"]
        }
      }
    });

    const report = runPackPreflightChecks(config, null);
    assert.deepEqual(report.profileGraphs, [{ profileId: "main", graph: ["base-pack", "child-pack"] }]);
    assert.deepEqual(report.missingRequiredEnv, []);
  } finally {
    if (previousEnv === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = previousEnv;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack preflight skips disabled profile pack graphs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coreclaw-preflight-disabled-profile-"));
  const envName = "WORKCLAW_PREFLIGHT_DISABLED_PROFILE_ENV_TEST";
  const previousEnv = process.env[envName];
  try {
    delete process.env[envName];
    const workspaceDir = path.join(root, "workspace");
    const dataDir = path.join(root, "data");
    const packsRoot = path.join(root, "packs");
    writePack(path.join(packsRoot, "disabled-pack"), {
      id: "disabled-pack",
      type: "role-pack",
      description: "disabled",
      env: [{ name: envName, required: true }]
    });
    const config = createConfig(workspaceDir, dataDir, {
      packs: {
        enabledRoots: [packsRoot]
      },
      profiles: {
        list: [
          {
            id: "main",
            name: "Main",
            role: "general"
          },
          {
            id: "archived",
            name: "Archived",
            role: "qa",
            packs: ["disabled-pack"],
            disabled: true
          }
        ]
      }
    });

    const report = runPackPreflightChecks(config, null);
    assert.deepEqual(report.profileGraphs, [{ profileId: "main", graph: [] }]);
    assert.deepEqual(report.missingRequiredEnv, []);
  } finally {
    if (previousEnv === undefined) {
      delete process.env[envName];
    } else {
      process.env[envName] = previousEnv;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPreflightChecks enforces hardened security profile", () => {
  const previousProfile = process.env.CORECLAW_SECURITY_PROFILE;
  const previousAllowShell = process.env.CORECLAW_ALLOW_SHELL;
  const previousAllowlist = process.env.CORECLAW_WEB_ALLOWLIST;

  process.env.CORECLAW_SECURITY_PROFILE = "hardened";
  process.env.CORECLAW_ALLOW_SHELL = "true";
  process.env.CORECLAW_WEB_ALLOWLIST = "example.com";

  try {
    assert.throws(() => runPreflightChecks(), /hardened profile/);
  } finally {
    if (previousProfile === undefined) {
      delete process.env.CORECLAW_SECURITY_PROFILE;
    } else {
      process.env.CORECLAW_SECURITY_PROFILE = previousProfile;
    }
    if (previousAllowShell === undefined) {
      delete process.env.CORECLAW_ALLOW_SHELL;
    } else {
      process.env.CORECLAW_ALLOW_SHELL = previousAllowShell;
    }
    if (previousAllowlist === undefined) {
      delete process.env.CORECLAW_WEB_ALLOWLIST;
    } else {
      process.env.CORECLAW_WEB_ALLOWLIST = previousAllowlist;
    }
  }
});
