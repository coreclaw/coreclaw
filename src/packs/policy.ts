import type { Config } from "../config/schema.js";
import type { ResolvedWorkclawProfile } from "../profiles/types.js";
import { mergeToolPolicies, type MergeableToolPolicy } from "../tools/policy-merge.js";
import type { WorkclawPackToolPolicy } from "./types.js";

export const resolvePackToolProfilePolicy = (
  toolProfiles: Config["toolProfiles"],
  packToolPolicy: WorkclawPackToolPolicy | undefined
): MergeableToolPolicy | undefined => {
  const profileId = packToolPolicy?.profile;
  if (!profileId) {
    return undefined;
  }
  const policy = toolProfiles[profileId];
  if (!policy) {
    throw new Error(`Pack references missing toolProfile: ${profileId}`);
  }
  return policy;
};

export const resolveRuntimeToolPolicy = (params: {
  config: Pick<Config, "toolProfiles">;
  profile: Pick<ResolvedWorkclawProfile, "toolProfile" | "toolPolicy"> | undefined;
  packToolPolicy: WorkclawPackToolPolicy | undefined;
}): MergeableToolPolicy => {
  const configuredProfilePolicy = params.profile?.toolProfile
    ? params.config.toolProfiles[params.profile.toolProfile]
    : undefined;
  const packProfilePolicy = resolvePackToolProfilePolicy(
    params.config.toolProfiles,
    params.packToolPolicy
  );
  return mergeToolPolicies(
    configuredProfilePolicy,
    params.profile?.toolPolicy,
    packProfilePolicy,
    params.packToolPolicy
  );
};
