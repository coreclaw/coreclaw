import fs from "node:fs";
import type { Config } from "./config/schema.js";
import { discoverWorkclawPacks } from "./packs/discovery.js";
import { buildEffectiveMcpConfig } from "./packs/loader.js";
import { mergePackEnvRequirements, resolveEffectivePackGraph } from "./packs/graph.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import type { McpConfigFile } from "./mcp/types.js";

export type PackPreflightReport = {
  packCount: number;
  profileGraphs: Array<{ profileId: string; graph: string[] }>;
  missingRequiredEnv: string[];
  templateIssues: string[];
  bundleIssues: string[];
  mcpFragmentCount: number;
};

export const runPackPreflightChecks = (
  config: Config,
  baseMcpConfig: McpConfigFile | null
): PackPreflightReport => {
  const profiles = resolveProfilesConfig(config);
  const discovered = discoverWorkclawPacks(config);
  const missingRequiredEnv = new Set<string>();
  const templateIssues = new Set<string>();
  const bundleIssues = new Set<string>();
  const graphs = profiles.map((profile) => {
    const graph = resolveEffectivePackGraph(
      discovered.filter((pack) => pack.allowed),
      profile.enabledPackIds,
      {
        strict: config.packs.strict
      }
    );
    for (const requirement of mergePackEnvRequirements(graph)) {
      if (requirement.required && !process.env[requirement.name]?.trim()) {
        missingRequiredEnv.add(requirement.name);
      }
    }
    for (const pack of graph) {
      for (const templateRoot of pack.templateRoots) {
        if (!fs.existsSync(templateRoot)) {
          templateIssues.add(`Missing template root: ${templateRoot}`);
        }
      }
      for (const bundle of pack.manifest.bundles ?? []) {
        const bundlePath = `${pack.rootDir}/${bundle.path}`;
        if (!fs.existsSync(bundlePath)) {
          bundleIssues.add(`Missing bundle source: ${bundlePath}`);
        }
      }
    }
    return {
      profileId: profile.id,
      graph,
      mcpFragments: graph.flatMap((pack) => pack.mcpFragments)
    };
  });

  buildEffectiveMcpConfig(baseMcpConfig, graphs);

  return {
    packCount: discovered.length,
    profileGraphs: graphs.map((entry) => ({
      profileId: entry.profileId,
      graph: entry.graph.map((pack) => pack.id)
    })),
    missingRequiredEnv: [...missingRequiredEnv],
    templateIssues: [...templateIssues],
    bundleIssues: [...bundleIssues],
    mcpFragmentCount: graphs.flatMap((entry) => entry.mcpFragments).length
  };
};
