import fs from "node:fs";
import path from "node:path";

export const readLocalConfigFile = (rootDir: string = process.cwd()): Record<string, unknown> => {
  const configPath = path.join(rootDir, "config.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
};

export const writeLocalConfigFile = (
  rootDir: string,
  config: Record<string, unknown>
): string => {
  const configPath = path.join(rootDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
};
