export type SkillRequirement = {
  node?: string;
  env?: string[];
  command?: string[];
};

export type SkillMcpConfig = {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
};

export type SkillMeta = {
  name: string;
  description: string;
  always: boolean;
  requires?: SkillRequirement[];
  tools?: string[];
  mcp?: SkillMcpConfig[];
};

export type SkillIndexEntry = SkillMeta & {
  dir: string;
  skillPath: string;
};
