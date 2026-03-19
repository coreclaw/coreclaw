import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkclawPluginManifest } from "./types.js";

const StringArraySchema = z.array(z.string()).default([]);
const StringRecordSchema = z.record(z.string(), z.string()).default({});

export const WorkclawPluginManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    configSchema: z.string().min(1),
    tools: StringArraySchema.optional(),
    surfaces: StringArraySchema.optional(),
    kinds: StringArraySchema.optional(),
    skills: StringArraySchema.optional(),
    uiHints: StringRecordSchema.optional(),
    env: z
      .array(
        z
          .object({
            name: z.string().min(1),
            required: z.boolean(),
            description: z.string().optional()
          })
          .strict()
      )
      .optional()
  })
  .strict();

export const parseWorkclawPluginManifest = (raw: string): WorkclawPluginManifest =>
  WorkclawPluginManifestSchema.parse(JSON.parse(raw));

export const validatePluginConfigSchemaPath = (pluginRoot: string, relativePath: string): string => {
  const absolutePath = path.resolve(pluginRoot, relativePath);
  const relative = path.relative(pluginRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Plugin configSchema escapes plugin root: ${relativePath}`);
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Plugin configSchema file is missing: ${relativePath}`);
  }
  return absolutePath;
};
