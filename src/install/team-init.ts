import fs from "node:fs";
import path from "node:path";
import { readLocalConfigFile, writeLocalConfigFile } from "./config-file.js";
import { runProfileAdd } from "./profile-init.js";

const DEFAULT_TEAM_FILES: Record<string, string> = {
  "TEAM.md": "# Team\n",
  "PROJECTS.md": "# Projects\n",
  "OWNERSHIP.md": "# Ownership\n",
  "GLOSSARY.md": "# Glossary\n",
  "PROCESS.md": "# Process\n",
  "MEMORY.md": "# Memory\n"
};

export const scaffoldTeamWorkspace = (workspaceDir: string): void => {
  fs.mkdirSync(path.join(workspaceDir, "memory"), { recursive: true });
  const memoryPath = path.join(workspaceDir, "memory", "MEMORY.md");
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, "# Memory\n", "utf-8");
  }
  for (const [fileName, content] of Object.entries(DEFAULT_TEAM_FILES)) {
    const filePath = path.join(workspaceDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
};

export const runTeamInit = (teamId: string, rootDir: string = process.cwd()) => {
  const workspaceDir = path.join(rootDir, "workspace", "teams", teamId);
  scaffoldTeamWorkspace(workspaceDir);

  const config = readLocalConfigFile(rootDir);
  const teams =
    config.teams && typeof config.teams === "object"
      ? (config.teams as { list?: Array<Record<string, unknown>> })
      : { list: [] };
  const profiles =
    config.profiles && typeof config.profiles === "object"
      ? (config.profiles as { list?: Array<Record<string, unknown>>; defaults?: Record<string, unknown> })
      : { list: [], defaults: {} };
  const bindings = Array.isArray(config.bindings) ? [...config.bindings] : [];

  const memberProfiles = [
    { id: `${teamId}-pm`, role: "pm", packs: ["role-pm-base"] },
    { id: `${teamId}-dev`, role: "dev", packs: ["role-dev-base", "platform-gitlab", "platform-jenkins"] },
    {
      id: `${teamId}-qa`,
      role: "qa",
      packs: ["role-qa-base", "platform-jenkins", "platform-playwright"]
    }
  ];

  for (const member of memberProfiles) {
    const existing = profiles.list?.find((entry) => entry.id === member.id);
    if (!existing) {
      runProfileAdd(member.id, member.role, rootDir);
    }
  }

  const refreshed = readLocalConfigFile(rootDir);
  profiles.list = ((refreshed.profiles as { list?: Array<Record<string, unknown>> })?.list ?? []) as Array<Record<string, unknown>>;

  for (const member of memberProfiles) {
    const profile = profiles.list?.find((entry) => entry.id === member.id);
    if (!profile) {
      continue;
    }
    profile.teams = [...new Set([...(Array.isArray(profile.teams) ? (profile.teams as string[]) : []), teamId])];
    profile.packs = [...new Set([...(Array.isArray(profile.packs) ? (profile.packs as string[]) : []), ...member.packs])];
  }

  const teamList = teams.list ?? [];
  if (!teamList.some((entry) => entry.id === teamId)) {
    teamList.push({
      id: teamId,
      name: teamId,
      workspace: `./workspace/teams/${teamId}`,
      packs: ["team-shared"],
      profiles: memberProfiles.map((entry) => entry.id)
    });
  }

  const exampleBindings = [
    {
      id: `${teamId}.gitlab.merge-request`,
      profileId: `${teamId}-dev`,
      match: { surface: "gitlab", event: "merge_request.opened" }
    },
    {
      id: `${teamId}.jenkins.failed-build`,
      profileId: `${teamId}-qa`,
      match: { surface: "jenkins", event: "build.failed" }
    },
    {
      id: `${teamId}.issue.created`,
      profileId: `${teamId}-pm`,
      match: { surface: "issues", event: "issue.created" }
    }
  ];
  for (const binding of exampleBindings) {
    if (!bindings.some((entry) => entry.id === binding.id)) {
      bindings.push(binding);
    }
  }

  const configPath = writeLocalConfigFile(rootDir, {
    ...config,
    profiles: {
      ...profiles,
      list: profiles.list ?? []
    },
    teams: {
      list: teamList
    },
    bindings
  });

  return {
    teamId,
    workspaceDir,
    profiles: memberProfiles.map((entry) => entry.id),
    configPath
  };
};
