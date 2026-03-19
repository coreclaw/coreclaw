import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "./config/load.js";
import { readMcpConfigFile } from "./mcp/config.js";
import { enforceSecurityProfile } from "./security/gate.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import { discoverWorkclawPacks } from "./packs/discovery.js";
import { buildEffectiveMcpConfig } from "./packs/loader.js";
import { resolveEffectivePackGraph } from "./packs/graph.js";

export type PreflightOptions = {
  mcpConfigPath?: string;
};

export type PreflightReport = {
  resolvedMcpConfigPath: string;
  mcpConfigPresent: boolean;
  mcpServerCount: number;
  workspaceDir: string;
  workspaceExists: boolean;
  identityFilePresent: boolean;
  toolsFilePresent: boolean;
  providerApiKeyPresent: boolean;
  profilesResolved: number;
  bindingsCount: number;
  packCount: number;
  missingRequiredEnv: string[];
  warnings: string[];
};

export const runPreflightChecks = (options: PreflightOptions = {}): PreflightReport => {
  const config = loadConfig();
  enforceSecurityProfile(config);
  const resolvedMcpConfigPath = path.resolve(options.mcpConfigPath ?? config.mcpConfigPath);
  const mcpConfig = readMcpConfigFile(resolvedMcpConfigPath);
  const workspaceDir = path.resolve(config.workspaceDir);
  const workspaceExists = fs.existsSync(workspaceDir);
  const identityFilePresent = fs.existsSync(path.join(workspaceDir, "IDENTITY.md"));
  const toolsFilePresent = fs.existsSync(path.join(workspaceDir, "TOOLS.md"));
  const providerApiKeyPresent = Boolean(config.provider.apiKey?.trim());
  const profiles = resolveProfilesConfig(config);
  const discoveredPacks = discoverWorkclawPacks(config);
  const missingRequiredEnv = new Set<string>();
  const graphs = profiles.map((profile) => {
    const graph = resolveEffectivePackGraph(
      discoveredPacks.filter((pack) => pack.allowed),
      profile.enabledPackIds,
      {
        strict: config.packs.strict
      }
    );
    for (const pack of graph) {
      for (const requirement of pack.manifest.env ?? []) {
        if (requirement.required && !process.env[requirement.name]?.trim()) {
          missingRequiredEnv.add(requirement.name);
        }
      }
    }
    return { mcpFragments: graph.flatMap((pack) => pack.mcpFragments) };
  });
  buildEffectiveMcpConfig(mcpConfig, graphs);

  const warnings: string[] = [];
  if (!workspaceExists) {
    warnings.push(`Workspace directory does not exist yet: ${workspaceDir}`);
  }
  if (!providerApiKeyPresent) {
    warnings.push("OPENAI_API_KEY is not set.");
  }
  if (config.webhook.enabled && !config.webhook.authToken?.trim()) {
    warnings.push("Webhook is enabled without CORECLAW_WEBHOOK_AUTH_TOKEN.");
  }
  for (const envName of missingRequiredEnv) {
    warnings.push(`Required environment variable is missing: ${envName}`);
  }

  return {
    resolvedMcpConfigPath,
    mcpConfigPresent: mcpConfig !== null,
    mcpServerCount: mcpConfig ? Object.keys(mcpConfig.servers).length : 0,
    workspaceDir,
    workspaceExists,
    identityFilePresent,
    toolsFilePresent,
    providerApiKeyPresent,
    profilesResolved: profiles.length,
    bindingsCount: config.bindings.length,
    packCount: discoveredPacks.length,
    missingRequiredEnv: [...missingRequiredEnv],
    warnings
  };
};
