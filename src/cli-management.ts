import path from "node:path";
import { SqliteStorage } from "./storage/sqlite.js";
import {
  materializeLocalProfilesConfig,
  readLocalConfigFile,
  writeLocalConfigFile
} from "./install/config-file.js";
import { loadConfig } from "./config/load.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import { discoverWorkclawPacks } from "./packs/discovery.js";
import { resolveEffectivePackGraph } from "./packs/graph.js";
import { disablePackForProfile, enablePackForProfile, recordDiscoveredPackInstall } from "./packs/install.js";

export const runProfilesList = () =>
  resolveProfilesConfig(loadConfig()).map((profile) => ({
    id: profile.id,
    role: profile.role,
    workspaceDir: profile.workspaceDir,
    stateDir: profile.stateDir,
    enabledPackIds: profile.enabledPackIds,
    disabled: profile.disabled
  }));

export const runProfilesResolve = (profileId: string) => {
  const profile = resolveProfilesConfig(loadConfig()).find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  return profile;
};

export const runPacksList = () => {
  const config = loadConfig();
  const profiles = resolveProfilesConfig(config);
  const discovered = discoverWorkclawPacks(config);
  return discovered.map((pack) => ({
    id: pack.id,
    type: pack.manifest.type,
    source: pack.sourceRoot,
    installState: pack.allowed ? "validated" : "blocked",
    enabledBy: profiles
      .filter((profile) => profile.enabledPackIds.includes(pack.id))
      .map((profile) => profile.id)
  }));
};

export const runPackInfo = (packId: string) => {
  const config = loadConfig();
  const discovered = discoverWorkclawPacks(config);
  const pack = discovered.find((entry) => entry.id === packId);
  if (!pack) {
    throw new Error(`Unknown pack: ${packId}`);
  }
  return {
    id: pack.id,
    allowed: pack.allowed,
    blockedReason: pack.blockedReason,
    manifest: pack.manifest,
    env: pack.manifest.env ?? [],
    skills: pack.skillRoots,
    mcp: pack.mcpFragments,
    graph: pack.allowed
      ? resolveEffectivePackGraph(discovered.filter((entry) => entry.allowed), [packId], {
          strict: config.packs.strict
        }).map((entry) => entry.id)
      : [],
    warnings: pack.warnings
  };
};

const withRootDir = <T>(rootDir: string, action: (resolvedRootDir: string) => T): T => {
  const resolvedRootDir = path.resolve(rootDir);
  const previousCwd = process.cwd();
  process.chdir(resolvedRootDir);
  try {
    return action(resolvedRootDir);
  } finally {
    process.chdir(previousCwd);
  }
};

const withLocalStorage = <T>(
  config: ReturnType<typeof loadConfig>,
  action: (storage: SqliteStorage) => T
): T => {
  const storage = new SqliteStorage(config);
  storage.init();
  try {
    return action(storage);
  } finally {
    storage.close();
  }
};

const ensureAllowedPackGraph = (
  packId: string,
  discovered: ReturnType<typeof discoverWorkclawPacks>,
  strict: boolean
) => {
  try {
    resolveEffectivePackGraph(discovered.filter((entry) => entry.allowed), [packId], { strict });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Pack ${packId} cannot be enabled: ${detail}`);
  }
};

const profileStillEnablesPackAfterDirectUpdate = (
  config: ReturnType<typeof loadConfig>,
  profileId: string,
  packId: string,
  packs: string[]
): boolean => {
  const list = (config.profiles.list ?? []).map((profile) =>
    profile.id === profileId ? { ...profile, packs } : profile
  );
  const simulated = resolveProfilesConfig({
    ...config,
    profiles: {
      ...config.profiles,
      list
    }
  }).find((profile) => profile.id === profileId);
  return simulated?.enabledPackIds.includes(packId) ?? false;
};

export const runPackInstall = (packId: string) => {
  const config = loadConfig();
  const discovered = discoverWorkclawPacks(config);
  const pack = discovered.find((entry) => entry.id === packId);
  if (!pack) {
    throw new Error(`Unknown pack: ${packId}`);
  }
  return withLocalStorage(config, (storage) => recordDiscoveredPackInstall(storage, pack));
};

export const runPackEnable = (
  packId: string,
  profileId: string,
  rootDir: string = process.cwd()
) => withRootDir(rootDir, (resolvedRootDir) => {
  const config = loadConfig();
  const discovered = discoverWorkclawPacks(config);
  const pack = discovered.find((entry) => entry.id === packId);
  if (!pack) {
    throw new Error(`Unknown pack: ${packId}`);
  }
  if (!pack.allowed) {
    throw new Error(`Pack ${packId} is blocked: ${pack.blockedReason ?? "not allowed by pack policy"}`);
  }
  ensureAllowedPackGraph(packId, discovered, config.packs.strict);

  const localConfig = readLocalConfigFile(resolvedRootDir);
  const profiles = materializeLocalProfilesConfig(localConfig);
  const list = profiles.list ?? [];
  const profile = list.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  const currentPacks = Array.isArray(profile.packs) ? (profile.packs as string[]) : [];
  if (!currentPacks.includes(packId)) {
    profile.packs = [...currentPacks, packId];
  }
  const configPath = writeLocalConfigFile(resolvedRootDir, {
    ...localConfig,
    profiles: {
      ...profiles,
      list
    }
  });

  const enablement = withLocalStorage(config, (storage) => {
    recordDiscoveredPackInstall(storage, pack);
    return enablePackForProfile(storage, profileId, packId);
  });

  return {
    configPath,
    enablement
  };
});

export const runPackDisable = (
  packId: string,
  profileId: string,
  rootDir: string = process.cwd()
) => withRootDir(rootDir, (resolvedRootDir) => {
  const config = loadConfig();
  const localConfig = readLocalConfigFile(resolvedRootDir);
  const profiles = materializeLocalProfilesConfig(localConfig);
  const list = profiles.list ?? [];
  const profile = list.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  const currentPacks = Array.isArray(profile.packs) ? (profile.packs as string[]) : [];
  const nextPacks = currentPacks.filter((entry) => entry !== packId);
  const effectiveProfile = resolveProfilesConfig(config).find((entry) => entry.id === profileId);
  if (
    effectiveProfile?.enabledPackIds.includes(packId) &&
    profileStillEnablesPackAfterDirectUpdate(config, profileId, packId, nextPacks)
  ) {
    throw new Error(
      `Pack ${packId} is inherited by profile ${profileId}; remove it from profiles.defaults.packs or team pack configuration instead.`
    );
  }
  profile.packs = nextPacks;
  const configPath = writeLocalConfigFile(resolvedRootDir, {
    ...localConfig,
    profiles: {
      ...profiles,
      list
    }
  });
  withLocalStorage(config, (storage) => disablePackForProfile(storage, profileId, packId));
  return {
    configPath,
    profileId,
    packId
  };
});
