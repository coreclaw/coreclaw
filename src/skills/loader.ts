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

const loadSkillEntry = (params: {
  skillPath: string;
  dir: string;
  fallbackName: string;
}): SkillIndexEntry | null => {
  const content = fs.readFileSync(params.skillPath, "utf-8");
  const { meta, body } = extractFrontmatter(content);
  const name = meta?.name || params.fallbackName;
  const description =
    meta?.description ||
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ||
    `${name} imported skill`;
  if (!name) {
    return null;
  }
  return {
    name,
    description,
    always: Boolean(meta?.always),
    requires: meta?.requires,
    tools: meta?.tools,
    mcp: meta?.mcp,
    dir: params.dir,
    skillPath: params.skillPath
  };
};

export class SkillLoader {
  private readonly skillsDirs: string[];

  constructor(skillsDir: string | string[]) {
    this.skillsDirs = Array.isArray(skillsDir) ? skillsDir : [skillsDir];
  }

  listSkills(): SkillIndexEntry[] {
    const skills: SkillIndexEntry[] = [];
    const seenNames = new Set<string>();
    for (const skillsDir of this.skillsDirs) {
      if (!fs.existsSync(skillsDir)) {
        continue;
      }
      const entries = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isFile());
      for (const entry of entries) {
        const skillPath = entry.isDirectory()
          ? path.join(skillsDir, entry.name, "SKILL.md")
          : path.join(skillsDir, entry.name);
        if (!fs.existsSync(skillPath) || !skillPath.endsWith(".md")) {
          continue;
        }
        const skill = loadSkillEntry({
          skillPath,
          dir: entry.isDirectory() ? path.join(skillsDir, entry.name) : skillsDir,
          fallbackName: entry.isDirectory() ? entry.name : path.basename(entry.name, ".md")
        });
        if (!skill) {
          continue;
        }
        if (seenNames.has(skill.name)) {
          throw new Error(`Duplicate skill name discovered across roots: ${skill.name}`);
        }
        seenNames.add(skill.name);
        skills.push(skill);
      }
    }
    return skills;
  }

  readSkill(skill: SkillIndexEntry): string {
    return fs.readFileSync(skill.skillPath, "utf-8");
  }
}
