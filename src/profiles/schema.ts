import { z } from "zod";
import { WORKCLAW_PROFILE_ID_PATTERN } from "./types.js";

const StringArraySchema = z.array(z.string()).default([]);
const StringRecordSchema = z.record(z.string(), z.string()).default({});

export const WorkclawSandboxPolicySchema = z
  .object({
    mode: z.enum(["off", "all", "non-interactive", "high-risk-only"]).optional(),
    scope: z.enum(["profile", "session", "shared"]).optional(),
    workspaceAccess: z.enum(["rw", "ro", "none"]).optional(),
    image: z.string().optional(),
    setupCommand: z.string().optional()
  })
  .strict();

export const WorkclawProfileMemoryPolicySchema = z
  .object({
    includeTeamMemory: z.boolean().optional(),
    includeProjectMemory: z.boolean().optional(),
    includeDailyMemory: z.boolean().optional(),
    allowWriteLongTerm: z.boolean().optional(),
    allowWriteDaily: z.boolean().optional(),
    allowCrossProfileRead: z.boolean().optional()
  })
  .strict();

export const WorkclawBootstrapPolicySchema = z
  .object({
    injectRole: z.boolean().optional(),
    injectTeam: z.boolean().optional(),
    injectProject: z.boolean().optional(),
    injectProcess: z.boolean().optional(),
    injectTools: z.boolean().optional(),
    injectMemory: z.boolean().optional(),
    maxFileChars: z.number().int().min(1).optional(),
    maxTotalChars: z.number().int().min(1).optional()
  })
  .strict();

export const WorkclawProfileSchedulerPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    allowUserTasks: z.boolean().optional(),
    allowSilentAutomation: z.boolean().optional(),
    defaultContextMode: z.enum(["full", "minimal", "isolated"]).optional()
  })
  .strict();

export const WorkclawProfileSurfacePolicySchema = z
  .object({
    allow: StringArraySchema.optional(),
    deny: StringArraySchema.optional(),
    defaults: z
      .object({
        replyMode: z.enum(["normal", "silent", "report-only"]).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const WorkclawProfileDefaultsSchema = z
  .object({
    workspaceRoot: z.string().optional(),
    stateRoot: z.string().optional(),
    llmProfile: z.string().optional(),
    toolProfile: z.string().optional(),
    sandbox: WorkclawSandboxPolicySchema.optional(),
    packs: StringArraySchema.optional(),
    memory: WorkclawProfileMemoryPolicySchema.optional(),
    bootstrap: WorkclawBootstrapPolicySchema.optional(),
    scheduler: WorkclawProfileSchedulerPolicySchema.optional(),
    surfaces: WorkclawProfileSurfacePolicySchema.optional(),
    metadata: StringRecordSchema.optional()
  })
  .strict();

export const WorkclawProfileConfigSchema = z
  .object({
    id: z.string().regex(WORKCLAW_PROFILE_ID_PATTERN, "profiles.list[].id is invalid"),
    name: z.string().min(1),
    role: z.string().min(1),
    teams: StringArraySchema.optional(),
    workspace: z.string().optional(),
    stateDir: z.string().optional(),
    llmProfile: z.string().optional(),
    toolProfile: z.string().optional(),
    sandbox: WorkclawSandboxPolicySchema.optional(),
    packs: StringArraySchema.optional(),
    memory: WorkclawProfileMemoryPolicySchema.optional(),
    bootstrap: WorkclawBootstrapPolicySchema.optional(),
    scheduler: WorkclawProfileSchedulerPolicySchema.optional(),
    surfaces: WorkclawProfileSurfacePolicySchema.optional(),
    metadata: StringRecordSchema.optional(),
    disabled: z.boolean().optional()
  })
  .strict();

export const WorkclawProfilesConfigSchema = z
  .object({
    defaults: WorkclawProfileDefaultsSchema.optional(),
    list: z.array(WorkclawProfileConfigSchema).optional()
  })
  .strict();

export const WorkclawToolProfileSchema = z
  .object({
    allow: StringArraySchema.optional(),
    deny: StringArraySchema.optional()
  })
  .strict();

export const WorkclawToolProfilesSchema = z.record(z.string(), WorkclawToolProfileSchema).default({});

export const WorkclawLlmProfileSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().optional(),
    temperature: z.number().optional()
  })
  .catchall(z.unknown());

export const WorkclawLlmConfigSchema = z
  .object({
    defaultProfile: z.string().optional(),
    profiles: z.record(z.string(), WorkclawLlmProfileSchema).default({})
  })
  .strict();
