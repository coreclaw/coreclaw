import path from "node:path";

export const resolveWorkspacePath = (workspaceDir: string, targetPath: string) => {
  const resolved = path.resolve(workspaceDir, targetPath);
  const normalizedWorkspace = path.resolve(workspaceDir);
  if (
    resolved !== normalizedWorkspace &&
    !resolved.startsWith(normalizedWorkspace + path.sep)
  ) {
    throw new Error("Path is outside workspace.");
  }
  return resolved;
};
