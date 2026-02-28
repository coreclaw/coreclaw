import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "./config/load.js";
import { readMcpConfigFile } from "./mcp/config.js";
import { enforceSecurityProfile } from "./security/gate.js";

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

  return {
    resolvedMcpConfigPath,
    mcpConfigPresent: mcpConfig !== null,
    mcpServerCount: mcpConfig ? Object.keys(mcpConfig.servers).length : 0,
    workspaceDir,
    workspaceExists,
    identityFilePresent,
    toolsFilePresent,
    providerApiKeyPresent,
    warnings
  };
};
