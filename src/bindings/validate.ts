import type { ResolvedWorkclawProfile } from "../profiles/types.js";
import type { WorkclawBinding } from "./types.js";

export type WorkclawBindingProfileIssue = {
  bindingId: string;
  profileId: string;
  reason: "missing" | "disabled";
};

export const collectBindingProfileIssues = (
  bindings: WorkclawBinding[],
  profiles: ResolvedWorkclawProfile[]
): WorkclawBindingProfileIssue[] => {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const issues: WorkclawBindingProfileIssue[] = [];
  for (const binding of bindings) {
    const profile = profilesById.get(binding.profileId);
    if (!profile) {
      issues.push({
        bindingId: binding.id,
        profileId: binding.profileId,
        reason: "missing"
      });
      continue;
    }
    if (profile.disabled) {
      issues.push({
        bindingId: binding.id,
        profileId: binding.profileId,
        reason: "disabled"
      });
    }
  }
  return issues;
};

export const filterBindingsForActiveProfiles = (
  bindings: WorkclawBinding[],
  profiles: ResolvedWorkclawProfile[]
): WorkclawBinding[] => {
  const activeProfileIds = new Set(
    profiles.filter((profile) => !profile.disabled).map((profile) => profile.id)
  );
  return bindings.filter((binding) => activeProfileIds.has(binding.profileId));
};
