import fs from "node:fs";
import { loadConfig } from "./config/load.js";
import { resolveProfilesConfig } from "./profiles/resolve.js";
import { discoverWorkclawPacks } from "./packs/discovery.js";
import { resolveEffectivePackGraph } from "./packs/graph.js";
import { SqliteStorage } from "./storage/sqlite.js";
import { readMcpConfigFile } from "./mcp/config.js";

export type DoctorReport = {
  runtime: {
    queue: ReturnType<SqliteStorage["countBusMessagesByStatus"]>;
    profileRuntimeHealth: Array<{ profileId: string; status: "ok" | "warning" }>;
  };
  profiles: Array<{
    id: string;
    workspaceDir: string;
    stateDir: string;
    workspaceExists: boolean;
    stateDirExists: boolean;
    enabledPackIds: string[];
    disabled: boolean;
  }>;
  packs: {
    discovered: Array<{ id: string; allowed: boolean; warnings: string[] }>;
    effectiveGraphs: Array<{ profileId: string; graph: string[] }>;
  };
  bindings: {
    count: number;
    ids: string[];
    surfaces: string[];
  };
  outbound: {
    queued: number;
    sending: number;
    sent: number;
    failed: number;
  };
  surfaces: {
    configured: string[];
    webhook: { enabled: boolean; authConfigured: boolean };
  };
  mcp: {
    configPresent: boolean;
    serverCount: number;
    runtimeConfigPresent: boolean;
  };
  storage: {
    sqlitePath: string;
    schemaVersion: string | null;
    packInstalls: number;
    teamOverlays: number;
  };
  security: {
    allowShell: boolean;
    webhookAuthConfigured: boolean;
    allowedWebDomains: number;
  };
  warnings: string[];
};

export const runDoctorChecks = (): DoctorReport => {
  const config = loadConfig();
  const storage = new SqliteStorage(config);
  storage.init();
  try {
    const bindingSurfaces = [
      ...new Set(
        config.bindings
          .map((binding) => binding.match.surface)
          .filter((surface): surface is string => Boolean(surface))
      )
    ];
    const baseMcpConfig = readMcpConfigFile(config.mcpConfigPath);
    const profiles = resolveProfilesConfig(config).map((profile) => ({
      id: profile.id,
      workspaceDir: profile.workspaceDir,
      stateDir: profile.stateDir,
      workspaceExists: fs.existsSync(profile.workspaceDir),
      stateDirExists: fs.existsSync(profile.stateDir),
      enabledPackIds: profile.enabledPackIds,
      disabled: profile.disabled
    }));
    const discovered = discoverWorkclawPacks(config);
    const warnings = [...discovered.flatMap((pack) => pack.warnings)];
    const effectiveGraphs: Array<{ profileId: string; graph: string[] }> = [];
    const profileRuntimeHealth: Array<{ profileId: string; status: "ok" | "warning" }> = [];
    for (const profile of profiles.filter((entry) => !entry.disabled)) {
      if (!profile.workspaceExists) {
        warnings.push(`Profile ${profile.id} workspace is missing: ${profile.workspaceDir}`);
      }
      if (!profile.stateDirExists) {
        warnings.push(`Profile ${profile.id} state dir is missing: ${profile.stateDir}`);
      }
      if (profile.workspaceDir.startsWith("/") && !profile.workspaceDir.includes(process.cwd())) {
        warnings.push(`Profile ${profile.id} uses non-portable absolute workspace path.`);
      }
      const graph = resolveEffectivePackGraph(discovered.filter((pack) => pack.allowed), profile.enabledPackIds, {
        strict: config.packs.strict
      });
      effectiveGraphs.push({ profileId: profile.id, graph: graph.map((pack) => pack.id) });
      profileRuntimeHealth.push({
        profileId: profile.id,
        status: profile.workspaceExists && profile.stateDirExists ? "ok" : "warning"
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
        queue: storage.countBusMessagesByStatus(),
        profileRuntimeHealth
      },
      profiles,
      packs: {
        discovered: discovered.map((pack) => ({
          id: pack.id,
          allowed: pack.allowed,
          warnings: pack.warnings
        })),
        effectiveGraphs
      },
      bindings: {
        count: config.bindings.length,
        ids: config.bindings.map((binding) => binding.id),
        surfaces: bindingSurfaces
      },
      outbound,
      surfaces: {
        configured: bindingSurfaces,
        webhook: {
          enabled: config.webhook.enabled,
          authConfigured: Boolean(config.webhook.authToken?.trim())
        }
      },
      mcp: {
        configPresent: baseMcpConfig !== null,
        serverCount: baseMcpConfig ? Object.keys(baseMcpConfig.servers).length : 0,
        runtimeConfigPresent: fs.existsSync(config.dataDir + "/workclaw.mcp.runtime.json")
      },
      storage: {
        sqlitePath: config.sqlitePath,
        schemaVersion: storage.getSchemaVersion(),
        packInstalls: storage.listPackInstalls().length,
        teamOverlays: storage.listTeamOverlays().length
      },
      security: {
        allowShell: config.allowShell,
        webhookAuthConfigured: Boolean(config.webhook.authToken?.trim()),
        allowedWebDomains: config.allowedWebDomains.length
      },
      warnings
    };
  } finally {
    storage.close();
  }
};
