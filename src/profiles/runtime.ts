import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config/schema.js";
import type { ResolvedWorkclawProfile } from "./types.js";
import { resolveProfilesConfig } from "./resolve.js";

export class ProfileRuntimeRegistry {
  private readonly profilesById: Map<string, ResolvedWorkclawProfile>;

  constructor(
    config: Pick<Config, "workspaceDir" | "dataDir" | "profiles" | "llm" | "toolProfiles" | "teams">,
    options: { instanceRoot?: string } = {}
  ) {
    const instanceRoot = path.resolve(
      options.instanceRoot ?? path.dirname(path.resolve(config.workspaceDir))
    );
    const profiles = resolveProfilesConfig(config, { instanceRoot });
    this.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  }

  list(): ResolvedWorkclawProfile[] {
    return [...this.profilesById.values()];
  }

  get(profileId: string): ResolvedWorkclawProfile | undefined {
    return this.profilesById.get(profileId);
  }

  getRequired(profileId: string): ResolvedWorkclawProfile {
    const profile = this.get(profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${profileId}`);
    }
    if (profile.disabled) {
      throw new Error(`Profile is disabled: ${profileId}`);
    }
    return profile;
  }

  ensureDirectories(): void {
    for (const profile of this.profilesById.values()) {
      fs.mkdirSync(profile.workspaceDir, { recursive: true });
      fs.mkdirSync(profile.stateDir, { recursive: true });
    }
  }
}
