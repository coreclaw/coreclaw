import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "../config/schema.js";
import type { DiscoveredWorkclawPack, WorkclawPackManifest } from "./types.js";
import { parseWorkclawPackManifestJson } from "./schema.js";
import { PackValidationError } from "./errors.js";

const MANIFEST_FILE = "workclaw.pack.json";

const expandHome = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
};

const resolveRootPath = (instanceRoot: string, value: string): string => {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(instanceRoot, expanded);
};

const pathStaysWithinRoot = (rootDir: string, relativePath: string): string => {
  const resolved = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PackValidationError(`Path escapes pack root: ${relativePath}`);
  }
  return resolved;
};

const compilePattern = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
};

const matchesAnyPattern = (value: string, patterns: string[]): boolean =>
  patterns.some((pattern) => compilePattern(pattern).test(value));

const resolvePackPaths = (
  rootDir: string,
  manifest: WorkclawPackManifest,
  key: "skills" | "mcp" | "templates" | "bootstrap"
): string[] => (manifest[key] ?? []).map((entry) => pathStaysWithinRoot(rootDir, entry));

export const resolvePackDiscoveryRoots = (
  config: Pick<Config, "workspaceDir" | "packs">,
  options: { instanceRoot?: string } = {}
): string[] => {
  const instanceRoot = path.resolve(options.instanceRoot ?? path.dirname(path.resolve(config.workspaceDir)));
  const configured = config.packs.enabledRoots;
  const roots =
    configured && configured.length > 0
      ? configured
      : [
          path.join(config.workspaceDir, ".workclaw", "packs"),
          path.join(os.homedir(), ".workclaw", "packs"),
          "builtin-packs"
        ];
  return roots.map((root) => resolveRootPath(instanceRoot, root));
};

export const discoverWorkclawPacks = (
  config: Pick<Config, "workspaceDir" | "packs">,
  options: { instanceRoot?: string } = {}
): DiscoveredWorkclawPack[] => {
  const roots = resolvePackDiscoveryRoots(config, options);
  const discovered: DiscoveredWorkclawPack[] = [];
  const seen = new Map<string, string>();

  for (const sourceRoot of roots) {
    if (!fs.existsSync(sourceRoot)) {
      continue;
    }

    const candidates = new Set<string>();
    if (fs.existsSync(path.join(sourceRoot, MANIFEST_FILE))) {
      candidates.add(sourceRoot);
    }
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.add(path.join(sourceRoot, entry.name));
      }
    }

    for (const rootDir of candidates) {
      const manifestPath = path.join(rootDir, MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      const manifest = parseWorkclawPackManifestJson(fs.readFileSync(manifestPath, "utf-8"));
      const warnings: string[] = [];
      if (!manifest.version) {
        warnings.push(`Pack ${manifest.id} is missing version.`);
      }
      if (
        !manifest.skills?.length &&
        !manifest.mcp?.length &&
        !manifest.templates?.length &&
        !manifest.bootstrap?.length &&
        !manifest.bundles?.length
      ) {
        warnings.push(`Pack ${manifest.id} has no effective content.`);
      }

      const firstRoot = seen.get(manifest.id);
      if (firstRoot) {
        const existing = discovered.find((pack) => pack.id === manifest.id);
        existing?.warnings.push(`Duplicate pack id ignored from ${rootDir}; first match from ${firstRoot} wins.`);
        continue;
      }
      seen.set(manifest.id, rootDir);

      const allow = config.packs.allow ?? [];
      const deny = config.packs.deny ?? [];
      const allowedByAllowList = allow.length === 0 || matchesAnyPattern(manifest.id, allow);
      const deniedByPolicy = deny.length > 0 && matchesAnyPattern(manifest.id, deny);
      const allowed = allowedByAllowList && !deniedByPolicy;
      const blockedReason = !allowedByAllowList
        ? "not allowed by packs.allow"
        : deniedByPolicy
          ? "denied by packs.deny"
          : undefined;

      discovered.push({
        id: manifest.id,
        rootDir,
        sourceRoot,
        manifestPath,
        manifest,
        skillRoots: resolvePackPaths(rootDir, manifest, "skills"),
        mcpFragments: resolvePackPaths(rootDir, manifest, "mcp"),
        templateRoots: resolvePackPaths(rootDir, manifest, "templates"),
        bootstrapEntries: resolvePackPaths(rootDir, manifest, "bootstrap"),
        allowed,
        blockedReason,
        warnings
      });
    }
  }

  return discovered;
};
