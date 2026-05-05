import fs from "node:fs";
import path from "node:path";
import type { SqliteStorage } from "../storage/sqlite.js";
import type { McpConfigFile } from "../mcp/types.js";
import { parseMcpConfigJson } from "../mcp/config.js";
import type { DiscoveredWorkclawPack } from "./types.js";
import {
  mergePackEnvRequirements,
  mergePackToolPolicies,
  resolveEffectivePackGraph
} from "./graph.js";

export const loadProfilePackGraph = (
  storage: SqliteStorage,
  discovered: DiscoveredWorkclawPack[],
  profileId: string,
  options: { strict?: boolean } = {}
) => {
  const enabled = storage
    .listProfilePackEnablements(profileId)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.packId);
  const graph = resolveEffectivePackGraph(discovered, enabled, options);
  return {
    graph,
    env: mergePackEnvRequirements(graph),
    toolPolicy: mergePackToolPolicies(graph),
    skillRoots: graph.flatMap((pack) => pack.skillRoots),
    mcpFragments: graph.flatMap((pack) => pack.mcpFragments)
  };
};

const readMcpFragment = (fragmentPath: string): McpConfigFile => {
  const stat = fs.statSync(fragmentPath);
  if (stat.isDirectory()) {
    const merged: McpConfigFile = { servers: {} };
    const entries = fs
      .readdirSync(fragmentPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const parsed = parseMcpConfigJson(
        fs.readFileSync(path.join(fragmentPath, entry.name), "utf-8")
      );
      Object.assign(merged.servers, parsed.servers);
    }
    return merged;
  }

  return parseMcpConfigJson(fs.readFileSync(fragmentPath, "utf-8"));
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
};

const assertCompatibleMcpServer = (
  signatures: Map<string, string>,
  server: string,
  config: unknown,
  source: string
): boolean => {
  const signature = stableStringify(config);
  const existing = signatures.get(server);
  if (!existing) {
    signatures.set(server, signature);
    return false;
  }
  if (existing !== signature) {
    throw new Error(`MCP server '${server}' has conflicting definitions; use unique server names in ${source}.`);
  }
  return true;
};

export const buildEffectiveMcpConfig = (
  baseConfig: McpConfigFile | null,
  graphs: Array<{ mcpFragments: string[] }>
): McpConfigFile => {
  const merged: McpConfigFile = {
    servers: {
      ...(baseConfig?.servers ?? {})
    }
  };
  const serverSignatures = new Map<string, string>();
  for (const [server, serverConfig] of Object.entries(baseConfig?.servers ?? {})) {
    serverSignatures.set(server, stableStringify(serverConfig));
  }

  const seen = new Set<string>();
  for (const graph of graphs) {
    for (const fragmentPath of graph.mcpFragments) {
      if (seen.has(fragmentPath) || !fs.existsSync(fragmentPath)) {
        continue;
      }
      seen.add(fragmentPath);
      const parsed = readMcpFragment(fragmentPath);
      for (const [server, serverConfig] of Object.entries(parsed.servers)) {
        if (assertCompatibleMcpServer(serverSignatures, server, serverConfig, fragmentPath)) {
          continue;
        }
        merged.servers[server] = serverConfig;
      }
    }
  }

  return merged;
};

export const buildMcpServerProfileScopes = (
  baseConfig: McpConfigFile | null,
  graphs: Array<{ profileId?: string; mcpFragments: string[] }>
): Map<string, Set<string>> => {
  const baseServers = new Set(Object.keys(baseConfig?.servers ?? {}));
  const serverSignatures = new Map<string, string>();
  for (const [server, serverConfig] of Object.entries(baseConfig?.servers ?? {})) {
    serverSignatures.set(server, stableStringify(serverConfig));
  }
  const scopes = new Map<string, Set<string>>();

  for (const graph of graphs) {
    if (!graph.profileId) {
      continue;
    }
    for (const fragmentPath of graph.mcpFragments) {
      if (!fs.existsSync(fragmentPath)) {
        continue;
      }
      const parsed = readMcpFragment(fragmentPath);
      for (const [server, serverConfig] of Object.entries(parsed.servers)) {
        assertCompatibleMcpServer(serverSignatures, server, serverConfig, fragmentPath);
        if (baseServers.has(server)) {
          continue;
        }
        const profiles = scopes.get(server) ?? new Set<string>();
        profiles.add(graph.profileId);
        scopes.set(server, profiles);
      }
    }
  }

  return scopes;
};
