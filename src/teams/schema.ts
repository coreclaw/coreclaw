import { z } from "zod";

const StringArraySchema = z.array(z.string()).default([]);
const StringRecordSchema = z.record(z.string(), z.string()).default({});

export const WorkclawTeamOverlayToolPolicySchema = z
  .object({
    allow: StringArraySchema.optional(),
    deny: StringArraySchema.optional()
  })
  .strict();

export const WorkclawTeamOverlaySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    workspace: z.string().optional(),
    profiles: StringArraySchema.optional(),
    packs: StringArraySchema.optional(),
    metadata: StringRecordSchema.optional(),
    toolPolicy: WorkclawTeamOverlayToolPolicySchema.optional()
  })
  .strict();

export const WorkclawTeamsConfigSchema = z
  .object({
    list: z.array(WorkclawTeamOverlaySchema).optional()
  })
  .strict();
