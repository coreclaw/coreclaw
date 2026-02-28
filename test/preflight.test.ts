import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/bin.js";
import { runPreflightChecks } from "../src/preflight.js";

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
