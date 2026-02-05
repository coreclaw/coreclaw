import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { SkillIndexEntry, SkillMeta } from "./types.js";

const extractFrontmatter = (content: string): { meta: SkillMeta | null; body: string } => {
  if (!content.startsWith("---")) {
    return { meta: null, body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { meta: null, body: content };
  }
  const raw = content.slice(3, end);
  const body = content.slice(end + 4);
  try {
    const parsed = YAML.parse(raw) as Record<string, unknown> | null;
    if (!parsed) {
      return { meta: null, body };
    }
    const meta: SkillMeta = {
      name: typeof parsed.name === "string" ? parsed.name : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      always: Boolean(parsed.always),
      requires: Array.isArray(parsed.requires)
        ? (parsed.requires as SkillMeta["requires"])
        : undefined,
      tools: Array.isArray(parsed.tools) ? (parsed.tools as string[]) : undefined,
      mcp: Array.isArray(parsed.mcp) ? (parsed.mcp as SkillMeta["mcp"]) : undefined
    };
    return { meta, body };
  } catch {
    return { meta: null, body };
  }
};

export class SkillLoader {
  constructor(private skillsDir: string) {}

  listSkills(): SkillIndexEntry[] {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }
    const entries = fs
      .readdirSync(this.skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    const skills: SkillIndexEntry[] = [];
    for (const entry of entries) {
      const skillPath = path.join(this.skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        continue;
      }
      const content = fs.readFileSync(skillPath, "utf-8");
      const { meta } = extractFrontmatter(content);
      if (!meta || !meta.name) {
        continue;
      }
      skills.push({
        ...meta,
        dir: path.join(this.skillsDir, entry.name),
        skillPath
      });
    }
    return skills;
  }

  readSkill(skill: SkillIndexEntry): string {
    return fs.readFileSync(skill.skillPath, "utf-8");
  }
}
