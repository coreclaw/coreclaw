import type { SqliteStorage } from "../storage/sqlite.js";
import type { DiscoveredWorkclawPack } from "./types.js";

export const recordDiscoveredPackInstall = (
  storage: SqliteStorage,
  pack: DiscoveredWorkclawPack
) =>
  storage.upsertPackInstall({
    packId: pack.id,
    version: pack.manifest.version ?? null,
    sourceKind: "local",
    sourcePath: pack.rootDir,
    installState: pack.allowed ? "validated" : "blocked",
    manifestJson: JSON.stringify(pack.manifest)
  });

export const enablePackForProfile = (
  storage: SqliteStorage,
  profileId: string,
  packId: string,
  source: "direct" | "inherited" | "team" = "direct"
) => storage.enablePackForProfile({ profileId, packId, source });

export const disablePackForProfile = (
  storage: SqliteStorage,
  profileId: string,
  packId: string
) => storage.disablePackForProfile(profileId, packId);
