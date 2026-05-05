import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseWorkclawPluginManifest, validatePluginConfigSchemaPath } from "./schema.js";
import type { DiscoveredWorkclawPlugin } from "./types.js";

const MANIFEST_FILE = "workclaw.plugin.json";

const matchesAnyPattern = (value: string, patterns: string[]): boolean =>
  patterns.some((pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value));

export const discoverWorkclawPlugins = (
  roots: string[],
  options: { allow?: string[]; deny?: string[] } = {}
): DiscoveredWorkclawPlugin[] => {
  const allow = options.allow ?? [];
  const deny = options.deny ?? [];
  const discovered: DiscoveredWorkclawPlugin[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pluginRoot = path.join(root, entry.name);
      const manifestPath = path.join(pluginRoot, MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      const manifest = parseWorkclawPluginManifest(fs.readFileSync(manifestPath, "utf-8"));
      validatePluginConfigSchemaPath(pluginRoot, manifest.configSchema);
      const allowedByAllowList = allow.length === 0 || matchesAnyPattern(manifest.id, allow);
      const deniedByPolicy = deny.length > 0 && matchesAnyPattern(manifest.id, deny);
      discovered.push({
        id: manifest.id,
        rootDir: pluginRoot,
        manifestPath,
        manifest,
        allowed: allowedByAllowList && !deniedByPolicy,
        blockedReason: !allowedByAllowList
          ? "not allowed by plugins.allow"
          : deniedByPolicy
            ? "denied by plugins.deny"
            : undefined
      });
    }
  }
  return discovered;
};

export class NativePluginRegistry {
  private readonly loaded = new Map<string, unknown>();

  async loadTrustedPlugin(plugin: DiscoveredWorkclawPlugin, trustedIds: string[]): Promise<unknown> {
    if (!plugin.allowed) {
      throw new Error(`Plugin is blocked: ${plugin.id}`);
    }
    if (!trustedIds.includes(plugin.id)) {
      throw new Error(`Plugin is not trusted for in-process load: ${plugin.id}`);
    }
    const runtimePath = path.join(plugin.rootDir, "index.js");
    if (!fs.existsSync(runtimePath)) {
      throw new Error(`Plugin runtime entry is missing: ${runtimePath}`);
    }
    const loaded = await import(pathToFileURL(runtimePath).href);
    this.loaded.set(plugin.id, loaded);
    return loaded;
  }

  get(pluginId: string): unknown {
    return this.loaded.get(pluginId);
  }
}
