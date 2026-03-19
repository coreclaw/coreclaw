import { z } from "zod";
import { WORKCLAW_PACK_ID_PATTERN } from "./types.js";
import { PackValidationError } from "./errors.js";

const StringArraySchema = z.array(z.string()).default([]);
const StringRecordSchema = z.record(z.string(), z.string()).default({});

export const WorkclawPackEnvRequirementSchema = z
  .object({
    name: z.string().min(1),
    required: z.boolean(),
    description: z.string().optional(),
    example: z.string().optional(),
    secret: z.boolean().optional(),
    scope: z.enum(["profile", "team", "runtime"]).optional()
  })
  .strict();

export const WorkclawPackToolPolicySchema = z
  .object({
    profile: z.string().optional(),
    allow: StringArraySchema.optional(),
    deny: StringArraySchema.optional(),
    elevated: z
      .object({
        enabled: z.boolean().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const WorkclawPackBundleImportSchema = z
  .object({
    format: z.enum(["codex", "claude", "cursor"]),
    path: z.string().min(1),
    includeSkills: z.boolean().optional(),
    includeMcp: z.boolean().optional(),
    includeSettings: z.boolean().optional()
  })
  .strict();

export const WorkclawPackManifestSchema = z
  .object({
    id: z.string().regex(WORKCLAW_PACK_ID_PATTERN, "pack id is invalid"),
    version: z.string().optional(),
    type: z.enum(["role-pack", "platform-pack", "team-pack"]),
    name: z.string().optional(),
    description: z.string().min(1),
    roles: StringArraySchema.optional(),
    extends: StringArraySchema.optional(),
    skills: StringArraySchema.optional(),
    mcp: StringArraySchema.optional(),
    templates: StringArraySchema.optional(),
    bootstrap: StringArraySchema.optional(),
    env: z.array(WorkclawPackEnvRequirementSchema).optional(),
    toolPolicy: WorkclawPackToolPolicySchema.optional(),
    bundles: z.array(WorkclawPackBundleImportSchema).optional(),
    metadata: StringRecordSchema.optional()
  })
  .strict();

export const WorkclawPacksConfigSchema = z
  .object({
    enabledRoots: StringArraySchema.optional(),
    allow: StringArraySchema.optional(),
    deny: StringArraySchema.optional(),
    strict: z.boolean().default(true)
  })
  .strict();

export const parseWorkclawPackManifestJson = (raw: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PackValidationError(`Invalid pack manifest JSON: ${detail}`);
  }

  const validated = WorkclawPackManifestSchema.safeParse(parsed);
  if (!validated.success) {
    throw new PackValidationError(validated.error.message);
  }
  return validated.data;
};
