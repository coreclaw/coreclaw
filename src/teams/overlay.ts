import os from "node:os";
import path from "node:path";
import type { Config } from "../config/schema.js";
import type { ResolvedWorkclawProfile, WorkclawToolProfile } from "../profiles/types.js";
import type { ResolvedWorkclawTeamOverlay, WorkclawTeamOverlayToolPolicy } from "./types.js";

const dedupe = (values: string[] | undefined): string[] => [...new Set(values ?? [])];

const mergeToolPolicy = (
  base: WorkclawToolProfile | undefined,
  overlay: WorkclawTeamOverlayToolPolicy | undefined
): WorkclawToolProfile => {
  const overlayAllow = overlay?.allow?.filter(Boolean) ?? [];
  let allow =
    base?.allow && base.allow.length > 0 ? dedupe(base.allow.filter(Boolean)) : undefined;
  if (overlayAllow.length > 0) {
    allow = allow
      ? allow.filter((entry) => overlayAllow.includes(entry))
      : [...overlayAllow];
  }

  const deny = dedupe([...(base?.deny ?? []), ...(overlay?.deny ?? [])].filter(Boolean));
  return {
    ...(allow ? { allow } : {}),
    ...(deny.length > 0 ? { deny } : {})
  };
};

export const applyTeamOverlay = (
  profile: ResolvedWorkclawProfile,
  overlay: ResolvedWorkclawTeamOverlay | null
): ResolvedWorkclawProfile => {
  if (!overlay) {
    return profile;
  }
  return {
    ...profile,
    teamIds: dedupe([...(profile.teamIds ?? []), overlay.id]),
    teamWorkspaces: dedupe([...(profile.teamWorkspaces ?? []), overlay.workspaceDir]),
    enabledPackIds: dedupe([...(profile.enabledPackIds ?? []), ...(overlay.packs ?? [])]),
    metadata: {
      ...profile.metadata,
      ...(overlay.metadata ?? {})
    },
    toolPolicy: mergeToolPolicy(profile.toolPolicy, overlay.toolPolicy)
  };
};

const expandHome = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
};

export const resolveTeamOverlays = (
  config: Pick<Config, "workspaceDir" | "teams">,
  instanceRoot: string = process.cwd()
): ResolvedWorkclawTeamOverlay[] => {
  const workspaceRoot = path.resolve(instanceRoot, config.workspaceDir, "teams");
  return (config.teams.list ?? []).map((team) => {
    const configuredWorkspace = team.workspace ? expandHome(team.workspace) : undefined;
    const workspaceDir = configuredWorkspace
      ? path.isAbsolute(configuredWorkspace)
        ? path.normalize(configuredWorkspace)
        : path.resolve(instanceRoot, configuredWorkspace)
      : path.join(workspaceRoot, team.id);
    return {
      id: team.id,
      name: team.name,
      workspaceDir,
      profiles: [...new Set(team.profiles ?? [])],
      packs: [...new Set(team.packs ?? [])],
      metadata: team.metadata ?? {},
      toolPolicy: team.toolPolicy ?? {}
    };
  });
};
