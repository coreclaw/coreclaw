export const WORKCLAW_PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{1,127}$/;

export type WorkclawPackType = "role-pack" | "platform-pack" | "team-pack";

export type WorkclawPackEnvRequirement = {
  name: string;
  required: boolean;
  description?: string;
  example?: string;
  secret?: boolean;
  scope?: "profile" | "team" | "runtime";
};

export type WorkclawPackToolPolicy = {
  profile?: string;
  allow?: string[];
  deny?: string[];
  elevated?: {
    enabled?: boolean;
  };
};

export type WorkclawPackBundleImport = {
  format: "codex" | "claude" | "cursor";
  path: string;
  includeSkills?: boolean;
  includeMcp?: boolean;
  includeSettings?: boolean;
};

export type WorkclawPackManifest = {
  id: string;
  version?: string;
  type: WorkclawPackType;
  name?: string;
  description: string;
  roles?: string[];
  extends?: string[];
  skills?: string[];
  mcp?: string[];
  templates?: string[];
  bootstrap?: string[];
  env?: WorkclawPackEnvRequirement[];
  toolPolicy?: WorkclawPackToolPolicy;
  bundles?: WorkclawPackBundleImport[];
  metadata?: Record<string, string>;
};

export type WorkclawPacksConfig = {
  enabledRoots?: string[];
  allow?: string[];
  deny?: string[];
  strict?: boolean;
};

export type DiscoveredWorkclawPack = {
  id: string;
  rootDir: string;
  sourceRoot: string;
  manifestPath: string;
  manifest: WorkclawPackManifest;
  skillRoots: string[];
  mcpFragments: string[];
  templateRoots: string[];
  bootstrapEntries: string[];
  allowed: boolean;
  blockedReason?: string;
  warnings: string[];
};
