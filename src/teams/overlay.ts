import type { ResolvedWorkclawProfile } from "../profiles/types.js";
import type { WorkclawTeamOverlay } from "./types.js";

const dedupe = (values: string[] | undefined): string[] => [...new Set(values ?? [])];

export const applyTeamOverlay = (
  profile: ResolvedWorkclawProfile,
  overlay: WorkclawTeamOverlay | null
): ResolvedWorkclawProfile => {
  if (!overlay) {
    return profile;
  }
  const allow =
    profile.surfaces.allow && overlay.toolPolicy?.allow
      ? profile.surfaces.allow.filter((entry) => overlay.toolPolicy?.allow?.includes(entry))
      : profile.surfaces.allow;
  const deny = dedupe([...(profile.surfaces.deny ?? []), ...(overlay.toolPolicy?.deny ?? [])]);
  return {
    ...profile,
    enabledPackIds: dedupe([...(profile.enabledPackIds ?? []), ...(overlay.packs ?? [])]),
    metadata: {
      ...profile.metadata,
      ...(overlay.metadata ?? {})
    },
    surfaces: {
      ...profile.surfaces,
      ...(allow ? { allow } : {}),
      deny
    }
  };
};
