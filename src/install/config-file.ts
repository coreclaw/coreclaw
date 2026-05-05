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

export type LocalProfilesConfig = {
  defaults?: Record<string, unknown>;
  list?: Array<Record<string, unknown>>;
};

export const getLocalProfilesConfig = (localConfig: Record<string, unknown>): LocalProfilesConfig =>
  localConfig.profiles && typeof localConfig.profiles === "object"
    ? (localConfig.profiles as LocalProfilesConfig)
    : { defaults: {}, list: [] };

export const materializeLocalProfilesConfig = (
  localConfig: Record<string, unknown>
): LocalProfilesConfig => {
  const profiles = getLocalProfilesConfig(localConfig);
  const list = profiles.list ?? [];
  if (list.length === 0) {
    list.push({
      id: "main",
      name: "Main",
      role: "general",
      workspace: typeof localConfig.workspaceDir === "string" ? localConfig.workspaceDir : "./workspace",
      stateDir: typeof localConfig.dataDir === "string" ? localConfig.dataDir : "./data"
    });
  }
  profiles.list = list;
  return profiles;
};
