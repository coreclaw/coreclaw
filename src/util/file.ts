import fs from "node:fs";
import path from "node:path";

const ensureWithinRoot = (rootPath: string, candidatePath: string) => {
  if (candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep)) {
    return;
  }
  throw new Error("Path is outside workspace.");
};

const resolveWorkspaceRoot = (workspaceDir: string) => {
  const absoluteRoot = path.resolve(workspaceDir);
  const realRoot = fs.realpathSync(absoluteRoot);
  return {
    absoluteRoot,
    realRoot
  };
};

const findNearestExistingAncestor = (absolutePath: string, rootAbsolute: string) => {
  let cursor = absolutePath;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  ensureWithinRoot(rootAbsolute, cursor);
  return cursor;
};

const sanitizeMemoryComponent = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }

  // Keep a stable, filesystem-safe component; remove path separators and controls.
  const encoded = encodeURIComponent(trimmed).replace(/%/g, "_");
  const cleaned = encoded
    .replace(/[\\/]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "");
  return cleaned.slice(0, 120) || "unknown";
};

export const getChatMemoryRelativePath = (channel: string, chatId: string) => {
  const safeChannel = sanitizeMemoryComponent(channel);
  const safeChatId = sanitizeMemoryComponent(chatId);
  return `memory/${safeChannel}_${safeChatId}.md`;
};

export const resolveWorkspacePath = (workspaceDir: string, targetPath: string) => {
  const { absoluteRoot, realRoot } = resolveWorkspaceRoot(workspaceDir);
  const absoluteTarget = path.resolve(absoluteRoot, targetPath);

  ensureWithinRoot(absoluteRoot, absoluteTarget);

  if (fs.existsSync(absoluteTarget)) {
    const realTarget = fs.realpathSync(absoluteTarget);
    ensureWithinRoot(realRoot, realTarget);
    return realTarget;
  }

  const existingAncestor = findNearestExistingAncestor(absoluteTarget, absoluteRoot);
  const realAncestor = fs.realpathSync(existingAncestor);
  ensureWithinRoot(realRoot, realAncestor);
  return absoluteTarget;
};
