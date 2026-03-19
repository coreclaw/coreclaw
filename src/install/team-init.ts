import fs from "node:fs";
import path from "node:path";

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
  for (const [fileName, content] of Object.entries(DEFAULT_TEAM_FILES)) {
    const filePath = path.join(workspaceDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
};
