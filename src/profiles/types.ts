export const WORKCLAW_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{1,63}$/;

export type WorkclawRoleId = string;

export type WorkclawSandboxPolicy = {
  mode?: "off" | "all" | "non-interactive" | "high-risk-only";
  scope?: "profile" | "session" | "shared";
  workspaceAccess?: "rw" | "ro" | "none";
  image?: string;
  setupCommand?: string;
};

export type WorkclawProfileMemoryPolicy = {
  includeTeamMemory?: boolean;
  includeProjectMemory?: boolean;
  includeDailyMemory?: boolean;
  allowWriteLongTerm?: boolean;
  allowWriteDaily?: boolean;
  allowCrossProfileRead?: boolean;
};

export type WorkclawBootstrapPolicy = {
  injectRole?: boolean;
  injectTeam?: boolean;
  injectProject?: boolean;
  injectProcess?: boolean;
  injectTools?: boolean;
  injectMemory?: boolean;
  maxFileChars?: number;
  maxTotalChars?: number;
};

export type WorkclawProfileSchedulerPolicy = {
  enabled?: boolean;
  allowUserTasks?: boolean;
  allowSilentAutomation?: boolean;
  defaultContextMode?: "full" | "minimal" | "isolated";
};

export type WorkclawProfileSurfacePolicy = {
  allow?: string[];
  deny?: string[];
  defaults?: {
    replyMode?: "normal" | "silent" | "report-only";
  };
};

export type WorkclawProfileDefaults = {
  workspaceRoot?: string;
  stateRoot?: string;
  llmProfile?: string;
  toolProfile?: string;
  sandbox?: WorkclawSandboxPolicy;
  packs?: string[];
  memory?: WorkclawProfileMemoryPolicy;
  bootstrap?: WorkclawBootstrapPolicy;
  scheduler?: WorkclawProfileSchedulerPolicy;
  surfaces?: WorkclawProfileSurfacePolicy;
  metadata?: Record<string, string>;
};

export type WorkclawProfileConfig = {
  id: string;
  name: string;
  role: WorkclawRoleId;
  teams?: string[];
  workspace?: string;
  stateDir?: string;
  llmProfile?: string;
  toolProfile?: string;
  sandbox?: WorkclawSandboxPolicy;
  packs?: string[];
  memory?: WorkclawProfileMemoryPolicy;
  bootstrap?: WorkclawBootstrapPolicy;
  scheduler?: WorkclawProfileSchedulerPolicy;
  surfaces?: WorkclawProfileSurfacePolicy;
  metadata?: Record<string, string>;
  disabled?: boolean;
};

export type WorkclawProfilesConfig = {
  defaults?: WorkclawProfileDefaults;
  list?: WorkclawProfileConfig[];
};

export type WorkclawToolProfile = {
  allow?: string[];
  deny?: string[];
};

export type WorkclawLlmProfile = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
} & Record<string, unknown>;

export type WorkclawLlmConfig = {
  defaultProfile?: string;
  profiles?: Record<string, WorkclawLlmProfile>;
};

export type ResolvedWorkclawProfile = {
  id: string;
  name: string;
  role: WorkclawRoleId;
  teamIds: string[];
  teamWorkspaces: string[];
  workspaceDir: string;
  stateDir: string;
  llmProfile?: string;
  toolProfile?: string;
  enabledPackIds: string[];
  sandbox: WorkclawSandboxPolicy;
  memory: WorkclawProfileMemoryPolicy;
  bootstrap: WorkclawBootstrapPolicy;
  scheduler: WorkclawProfileSchedulerPolicy;
  surfaces: WorkclawProfileSurfacePolicy;
  toolPolicy: WorkclawToolProfile;
  metadata: Record<string, string>;
  disabled: boolean;
};
