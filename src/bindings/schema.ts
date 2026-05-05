import { z } from "zod";

const StringRecordSchema = z.record(z.string(), z.string()).default({});

export const WorkclawEventSchema = z
  .object({
    id: z.string().min(1),
    surface: z.string().min(1),
    event: z.string().min(1),
    sourceKey: z.string().min(1),
    projectKey: z.string().optional(),
    repoKey: z.string().optional(),
    threadKey: z.string().optional(),
    senderKey: z.string().optional(),
    channelKey: z.string().optional(),
    createdAt: z.string().min(1),
    correlationId: z.string().optional(),
    trustLevel: z.enum(["trusted", "verified", "untrusted"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    payload: z.record(z.string(), z.unknown())
  })
  .strict();

export const WorkclawRoutingHintsSchema = z
  .object({
    profileId: z.string().optional(),
    bindingId: z.string().optional(),
    suppressOutbound: z.boolean().optional()
  })
  .strict();

export const WorkclawBindingMatchSchema = z
  .object({
    surface: z.string().optional(),
    event: z.string().optional(),
    sourceKey: z.string().optional(),
    projectKey: z.string().optional(),
    repoKey: z.string().optional(),
    threadKey: z.string().optional(),
    senderKey: z.string().optional(),
    channelKey: z.string().optional(),
    metadata: StringRecordSchema.optional()
  })
  .strict();

export const WorkclawBindingPolicySchema = z
  .object({
    dedupeWindowMs: z.number().int().min(0).optional(),
    cooldownMs: z.number().int().min(0).optional(),
    maxConcurrent: z.number().int().min(1).optional()
  })
  .strict();

export const WorkclawBindingActionSchema = z
  .object({
    mode: z.enum(["conversation", "fire-and-report", "silent-automation"]).optional(),
    threadKeyTemplate: z.string().optional(),
    registerConversation: z.boolean().optional(),
    replyMode: z.enum(["normal", "silent", "report-only"]).optional(),
    contextMode: z.enum(["full", "minimal", "isolated"]).optional(),
    outbound: z
      .object({
        targetMode: z.enum(["reply-to-event", "explicit-target", "none"]).optional(),
        surface: z.string().optional(),
        sourceKeyTemplate: z.string().optional(),
        threadKeyTemplate: z.string().optional(),
        channelKeyTemplate: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const WorkclawBindingSchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    profileId: z.string().min(1),
    match: WorkclawBindingMatchSchema,
    policy: WorkclawBindingPolicySchema.optional(),
    action: WorkclawBindingActionSchema.optional(),
    metadata: StringRecordSchema.optional()
  })
  .strict();

export const WorkclawBindingsSchema = z.array(WorkclawBindingSchema).default([]);
