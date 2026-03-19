import fs from "node:fs";
import path from "node:path";

const DEFAULT_PROFILE_FILES: Record<string, string> = {
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
  for (const [fileName, content] of Object.entries(DEFAULT_PROFILE_FILES)) {
    const filePath = path.join(workspaceDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
};
