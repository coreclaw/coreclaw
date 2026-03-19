#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPackInfo, runPacksList, runProfilesList, runProfilesResolve } from "./cli-management.js";
import { main } from "./main.js";
import { runDoctorChecks } from "./doctor.js";
import { runWorkclawInit } from "./install/init.js";
import { runProfileAdd } from "./install/profile-init.js";
import { scaffoldTeamWorkspace } from "./install/team-init.js";
import { runPreflightChecks } from "./preflight.js";

const HELP_TEXT = `workclaw - role-oriented AI runtime

Usage:
  workclaw [options]
  workclaw preflight [--mcp-config <path>]
  workclaw doctor
  workclaw init
  workclaw profiles list
  workclaw profiles resolve <id>
  workclaw profile add <id>
  workclaw packs list
  workclaw packs info <id>
  workclaw team init <id>

Options:
  -h, --help      Show help
  -v, --version   Show version
`;

const isDirectExecution = () => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

const readVersion = () => {
  try {
    const packagePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json"
    );
    const raw = fs.readFileSync(packagePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const runCli = async (args: string[] = process.argv.slice(2)) => {
  if (args[0] === "preflight") {
    const report = runPreflightChecks(parsePreflightArgs(args.slice(1)));
    process.stdout.write("preflight: ok\n");
    process.stdout.write(`mcp.config.path: ${report.resolvedMcpConfigPath}\n`);
    process.stdout.write(
      `mcp.config.status: ${report.mcpConfigPresent ? "valid" : "missing (treated as empty)"}\n`
    );
    process.stdout.write(`mcp.config.servers: ${report.mcpServerCount}\n`);
    process.stdout.write(`workspace.path: ${report.workspaceDir}\n`);
    process.stdout.write(`workspace.exists: ${report.workspaceExists ? "yes" : "no"}\n`);
    process.stdout.write(`workspace.identity: ${report.identityFilePresent ? "present" : "missing"}\n`);
    process.stdout.write(`workspace.tools: ${report.toolsFilePresent ? "present" : "missing"}\n`);
    process.stdout.write(`provider.api_key: ${report.providerApiKeyPresent ? "set" : "missing"}\n`);
    process.stdout.write(`profiles.resolved: ${report.profilesResolved}\n`);
    process.stdout.write(`bindings.count: ${report.bindingsCount}\n`);
    process.stdout.write(`packs.count: ${report.packCount}\n`);
    process.stdout.write(`missing.required_env: ${report.missingRequiredEnv.length}\n`);
    process.stdout.write(`warnings: ${report.warnings.length}\n`);
    for (const warning of report.warnings) {
      process.stdout.write(`warning: ${warning}\n`);
    }
    return;
  }
  if (args[0] === "doctor") {
    const report = runDoctorChecks();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (args[0] === "profiles" && args[1] === "list") {
    process.stdout.write(`${JSON.stringify(runProfilesList(), null, 2)}\n`);
    return;
  }
  if (args[0] === "profiles" && args[1] === "resolve") {
    const profileId = args[2]?.trim();
    if (!profileId) {
      throw new Error("Missing profile id for 'workclaw profiles resolve'.");
    }
    process.stdout.write(`${JSON.stringify(runProfilesResolve(profileId), null, 2)}\n`);
    return;
  }
  if (args[0] === "profile" && args[1] === "add") {
    const profileId = args[2]?.trim();
    if (!profileId) {
      throw new Error("Missing profile id for 'workclaw profile add'.");
    }
    process.stdout.write(`${JSON.stringify(runProfileAdd(profileId), null, 2)}\n`);
    return;
  }
  if (args[0] === "packs" && args[1] === "list") {
    process.stdout.write(`${JSON.stringify(runPacksList(), null, 2)}\n`);
    return;
  }
  if (args[0] === "packs" && args[1] === "info") {
    const packId = args[2]?.trim();
    if (!packId) {
      throw new Error("Missing pack id for 'workclaw packs info'.");
    }
    process.stdout.write(`${JSON.stringify(runPackInfo(packId), null, 2)}\n`);
    return;
  }
  if (args[0] === "init") {
    const result = runWorkclawInit();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (args[0] === "team" && args[1] === "init") {
    const teamId = args[2]?.trim();
    if (!teamId) {
      throw new Error("Missing team id for 'workclaw team init'.");
    }
    const workspaceDir = path.join(process.cwd(), "workspace", "teams", teamId);
    scaffoldTeamWorkspace(workspaceDir);
    process.stdout.write(`${JSON.stringify({ teamId, workspaceDir }, null, 2)}\n`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }
  await main();
};

const parsePreflightArgs = (args: string[]) => {
  const options: { mcpConfigPath?: string } = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--mcp-config") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --mcp-config.");
      }
      options.mcpConfigPath = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown preflight option: ${arg}`);
  }
  return options;
};

if (isDirectExecution()) {
  void runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`workclaw command failed: ${message}\n`);
    process.exit(1);
  });
}
