import { loadConfig } from "./config/load.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import { discoverWorkclawPacks } from "./packs/discovery.js";
import { resolveEffectivePackGraph } from "./packs/graph.js";

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
    manifest: pack.manifest,
    env: pack.manifest.env ?? [],
    skills: pack.skillRoots,
    mcp: pack.mcpFragments,
    graph: resolveEffectivePackGraph(discovered.filter((entry) => entry.allowed), [packId], {
      strict: config.packs.strict
    }).map((entry) => entry.id),
    warnings: pack.warnings
  };
};
