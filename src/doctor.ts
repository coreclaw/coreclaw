import fs from "node:fs";
import { loadConfig } from "./config/load.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import { discoverWorkclawPacks } from "./packs/discovery.js";
import { loadProfilePackGraph } from "./packs/loader.js";
import { SqliteStorage } from "./storage/sqlite.js";

export type DoctorReport = {
  runtime: {
    queue: ReturnType<SqliteStorage["countBusMessagesByStatus"]>;
  };
  profiles: Array<{
    id: string;
    workspaceDir: string;
    stateDir: string;
    workspaceExists: boolean;
    stateDirExists: boolean;
    enabledPackIds: string[];
  }>;
  packs: {
    discovered: Array<{ id: string; allowed: boolean; warnings: string[] }>;
  };
  bindings: {
    count: number;
    ids: string[];
  };
  outbound: {
    queued: number;
    sending: number;
    sent: number;
    failed: number;
  };
  warnings: string[];
};

export const runDoctorChecks = (): DoctorReport => {
  const config = loadConfig();
  const storage = new SqliteStorage(config);
  storage.init();
  try {
    const profiles = resolveProfilesConfig(config).map((profile) => ({
      id: profile.id,
      workspaceDir: profile.workspaceDir,
      stateDir: profile.stateDir,
      workspaceExists: fs.existsSync(profile.workspaceDir),
      stateDirExists: fs.existsSync(profile.stateDir),
      enabledPackIds: profile.enabledPackIds
    }));
    const discovered = discoverWorkclawPacks(config);
    const warnings = [...discovered.flatMap((pack) => pack.warnings)];
    for (const profile of profiles) {
      if (!profile.workspaceExists) {
        warnings.push(`Profile ${profile.id} workspace is missing: ${profile.workspaceDir}`);
      }
      if (!profile.stateDirExists) {
        warnings.push(`Profile ${profile.id} state dir is missing: ${profile.stateDir}`);
      }
      if (profile.workspaceDir.startsWith("/") && !profile.workspaceDir.includes(process.cwd())) {
        warnings.push(`Profile ${profile.id} uses non-portable absolute workspace path.`);
      }
      loadProfilePackGraph(storage, discovered.filter((pack) => pack.allowed), profile.id, {
        strict: config.packs.strict
      });
    }

    const outbound = {
      queued: storage.listOutboundActions({ deliveryState: "queued" }).length,
      sending: storage.listOutboundActions({ deliveryState: "sending" }).length,
      sent: storage.listOutboundActions({ deliveryState: "sent" }).length,
      failed: storage.listOutboundActions({ deliveryState: "failed" }).length
    };

    return {
      runtime: {
        queue: storage.countBusMessagesByStatus()
      },
      profiles,
      packs: {
        discovered: discovered.map((pack) => ({
          id: pack.id,
          allowed: pack.allowed,
          warnings: pack.warnings
        }))
      },
      bindings: {
        count: config.bindings.length,
        ids: config.bindings.map((binding) => binding.id)
      },
      outbound,
      warnings
    };
  } finally {
    storage.close();
  }
};
