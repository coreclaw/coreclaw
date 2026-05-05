import fs from "node:fs";
import path from "node:path";
import {
  materializeLocalProfilesConfig,
  readLocalConfigFile,
  writeLocalConfigFile
} from "./config-file.js";

const DEFAULT_PROFILE_FILES: Record<string, string> = {
  "IDENTITY.md": "# Identity\n",
  "USER.md": "# User\n",
  "ROLE.md": "# Role\n",
  "TEAM.md": "# Team\n",
  "PROJECT.md": "# Project\n",
  "PROCESS.md": "# Process\n",
  "TOOLS.md": "# Tools\n",
  "MEMORY.md": "# Memory\n"
};

export const scaffoldProfileWorkspace = (workspaceDir: string): void => {
  fs.mkdirSync(path.join(workspaceDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "skills"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "playbooks"), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, "templates"), { recursive: true });
  const memoryPath = path.join(workspaceDir, "memory", "MEMORY.md");
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, "# Memory\n", "utf-8");
  }
  for (const [fileName, content] of Object.entries(DEFAULT_PROFILE_FILES)) {
    const filePath = path.join(workspaceDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
};

export const runProfileAdd = (
  profileId: string,
  role = "general",
  rootDir: string = process.cwd()
) => {
  const config = readLocalConfigFile(rootDir);
  const profiles = materializeLocalProfilesConfig(config);
  const list = profiles.list ?? [];
  if (list.some((entry) => entry.id === profileId)) {
    throw new Error(`Profile already exists: ${profileId}`);
  }

  const workspaceRoot =
    typeof profiles.defaults?.workspaceRoot === "string"
      ? profiles.defaults.workspaceRoot
      : "./workspace/profiles";
  const profileWorkspaceDir = path.resolve(rootDir, workspaceRoot, profileId);
  scaffoldProfileWorkspace(profileWorkspaceDir);
  list.push({ id: profileId, name: profileId, role });
  const configPath = writeLocalConfigFile(rootDir, {
    ...config,
    profiles: {
      ...profiles,
      list
    }
  });
  return {
    configPath,
    profileId,
    workspaceDir: profileWorkspaceDir
  };
};
