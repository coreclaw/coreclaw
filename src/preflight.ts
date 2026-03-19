import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "./config/load.js";
import { readMcpConfigFile } from "./mcp/config.js";
import { enforceSecurityProfile } from "./security/gate.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import { runPackPreflightChecks } from "./preflight-packs.js";

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
  profileGraphs: Array<{ profileId: string; graph: string[] }>;
  mcpFragmentCount: number;
  missingRequiredEnv: string[];
  templateIssues: string[];
  bundleIssues: string[];
  surfaceAuthConsistent: boolean;
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
  const packReport = runPackPreflightChecks(config, mcpConfig);
  const surfaceAuthConsistent = !config.webhook.enabled || Boolean(config.webhook.authToken?.trim());

  const warnings: string[] = [];
  if (!workspaceExists) {
    warnings.push(`Workspace directory does not exist yet: ${workspaceDir}`);
  }
  if (!providerApiKeyPresent) {
    warnings.push("OPENAI_API_KEY is not set.");
  }
  if (!surfaceAuthConsistent) {
    warnings.push("Webhook is enabled without CORECLAW_WEBHOOK_AUTH_TOKEN.");
  }
  for (const envName of packReport.missingRequiredEnv) {
    warnings.push(`Required environment variable is missing: ${envName}`);
  }
  for (const issue of packReport.templateIssues) {
    warnings.push(issue);
  }
  for (const issue of packReport.bundleIssues) {
    warnings.push(issue);
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
    packCount: packReport.packCount,
    profileGraphs: packReport.profileGraphs,
    mcpFragmentCount: packReport.mcpFragmentCount,
    missingRequiredEnv: packReport.missingRequiredEnv,
    templateIssues: packReport.templateIssues,
    bundleIssues: packReport.bundleIssues,
    surfaceAuthConsistent,
    warnings
  };
};
