import fs from "node:fs";
import path from "node:path";
import { scaffoldProfileWorkspace } from "./profile-init.js";

export const runWorkclawInit = (rootDir: string = process.cwd()) => {
  const workspaceDir = path.join(rootDir, "workspace");
  const dataDir = path.join(rootDir, "data");
  const builtinPacksDir = path.join(rootDir, "builtin-packs");
  const profilesRoot = path.join(workspaceDir, "profiles");
  const mainProfileDir = path.join(profilesRoot, "main");
  const stateProfilesRoot = path.join(dataDir, "profiles");
  const mainStateDir = path.join(stateProfilesRoot, "main");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(builtinPacksDir, { recursive: true });
  fs.mkdirSync(profilesRoot, { recursive: true });
  fs.mkdirSync(stateProfilesRoot, { recursive: true });
  fs.mkdirSync(mainStateDir, { recursive: true });
  scaffoldProfileWorkspace(mainProfileDir);

  const configPath = path.join(rootDir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          workspaceDir: "./workspace",
          dataDir: "./data",
          sqlitePath: "./data/bot.sqlite",
          llm: {
            defaultProfile: "default",
            profiles: {
              default: {
                provider: "openai",
                model: "gpt-4o-mini"
              }
            }
          },
          toolProfiles: {
            default: {
              allow: [],
              deny: []
            }
          },
          packs: {
            enabledRoots: ["./builtin-packs", "./workspace/.workclaw/packs"],
            allow: [],
            deny: [],
            strict: true
          },
          profiles: {
            defaults: {
              workspaceRoot: "./workspace/profiles",
              stateRoot: "./data/profiles",
              llmProfile: "default",
              toolProfile: "default"
            },
            list: [
              {
                id: "main",
                name: "Main",
                role: "general"
              }
            ]
          },
          bindings: []
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  return {
    configPath,
    workspaceDir,
    dataDir,
    profilesRoot,
    mainProfileDir,
    mainStateDir
  };
};
