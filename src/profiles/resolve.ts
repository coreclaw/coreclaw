import os from "node:os";
import path from "node:path";
import type { Config } from "../config/schema.js";
import type {
  ResolvedWorkclawProfile,
  WorkclawBootstrapPolicy,
  WorkclawProfileConfig,
  WorkclawProfileMemoryPolicy,
  WorkclawProfileSchedulerPolicy,
  WorkclawProfileSurfacePolicy,
  WorkclawProfilesConfig,
  WorkclawSandboxPolicy
} from "./types.js";

type ResolveProfilesOptions = {
  instanceRoot?: string;
};

const DEFAULT_MAIN_PROFILE: Pick<WorkclawProfileConfig, "id" | "name" | "role"> = {
  id: "main",
  name: "Main",
  role: "general"
};

const dedupeStrings = (values: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values ?? []) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

const mergeObjects = <T extends Record<string, unknown>>(base: T | undefined, patch: T | undefined): T => ({
  ...(base ?? {}),
  ...(patch ?? {})
}) as T;

const mergeSurfacePolicy = (
  defaults: WorkclawProfileSurfacePolicy | undefined,
  profile: WorkclawProfileSurfacePolicy | undefined
): WorkclawProfileSurfacePolicy => ({
  ...mergeObjects(defaults, profile),
  allow: dedupeStrings([...(defaults?.allow ?? []), ...(profile?.allow ?? [])]),
  deny: dedupeStrings([...(defaults?.deny ?? []), ...(profile?.deny ?? [])]),
  defaults: mergeObjects(defaults?.defaults, profile?.defaults)
});

const expandHome = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
};

const resolveConfigPath = (instanceRoot: string, value: string): string => {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(instanceRoot, expanded);
};

const ensureUniquePaths = (profiles: ResolvedWorkclawProfile[], field: "workspaceDir" | "stateDir") => {
  const seen = new Map<string, string>();
  for (const profile of profiles) {
    const normalized = path.normalize(profile[field]);
    const prior = seen.get(normalized);
    if (prior) {
      throw new Error(`Resolved ${field} collides for profiles ${prior} and ${profile.id}.`);
    }
    seen.set(normalized, profile.id);
  }
};

export const materializeProfilesConfig = (
  config: Pick<Config, "workspaceDir" | "dataDir" | "profiles">,
  _options: ResolveProfilesOptions = {}
): WorkclawProfilesConfig => {
  if ((config.profiles.list?.length ?? 0) > 0) {
    return config.profiles;
  }
  return {
    defaults: config.profiles.defaults,
    list: [
      {
        ...DEFAULT_MAIN_PROFILE,
        workspace: config.workspaceDir,
        stateDir: config.dataDir
      }
    ]
  };
};

export const resolveProfilesConfig = (
  config: Pick<Config, "workspaceDir" | "dataDir" | "profiles" | "llm" | "toolProfiles">,
  options: ResolveProfilesOptions = {}
): ResolvedWorkclawProfile[] => {
  const instanceRoot = path.resolve(options.instanceRoot ?? process.cwd());
  const profilesConfig = materializeProfilesConfig(config, options);
  const defaults = profilesConfig.defaults ?? {};
  const list = profilesConfig.list ?? [];
  const workspaceRoot = defaults.workspaceRoot ?? path.join(config.workspaceDir, "profiles");
  const stateRoot = defaults.stateRoot ?? path.join(config.dataDir, "profiles");
  const ids = new Set<string>();

  const resolved = list.map((profile) => {
    if (ids.has(profile.id)) {
      throw new Error(`Duplicate profile id: ${profile.id}`);
    }
    ids.add(profile.id);

    const llmProfile = profile.llmProfile ?? defaults.llmProfile ?? config.llm.defaultProfile;
    if (llmProfile && !config.llm.profiles[llmProfile]) {
      throw new Error(`Profile ${profile.id} references missing llmProfile: ${llmProfile}`);
    }

    const toolProfile = profile.toolProfile ?? defaults.toolProfile;
    if (toolProfile && !config.toolProfiles[toolProfile]) {
      throw new Error(`Profile ${profile.id} references missing toolProfile: ${toolProfile}`);
    }

    return {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      workspaceDir: resolveConfigPath(instanceRoot, profile.workspace ?? path.join(workspaceRoot, profile.id)),
      stateDir: resolveConfigPath(instanceRoot, profile.stateDir ?? path.join(stateRoot, profile.id)),
      llmProfile,
      toolProfile,
      enabledPackIds: dedupeStrings([...(defaults.packs ?? []), ...(profile.packs ?? [])]),
      sandbox: mergeObjects<WorkclawSandboxPolicy>(defaults.sandbox, profile.sandbox),
      memory: mergeObjects<WorkclawProfileMemoryPolicy>(defaults.memory, profile.memory),
      bootstrap: mergeObjects<WorkclawBootstrapPolicy>(defaults.bootstrap, profile.bootstrap),
      scheduler: mergeObjects<WorkclawProfileSchedulerPolicy>(defaults.scheduler, profile.scheduler),
      surfaces: mergeSurfacePolicy(defaults.surfaces, profile.surfaces),
      metadata: mergeObjects<Record<string, string>>(defaults.metadata, profile.metadata),
      disabled: profile.disabled ?? false
    } satisfies ResolvedWorkclawProfile;
  });

  ensureUniquePaths(resolved, "workspaceDir");
  ensureUniquePaths(resolved, "stateDir");
  return resolved;
};
