import fs from "node:fs";
import path from "node:path";
import type { InboundMessage, ChatMessage, ChatRecord } from "../types.js";
import type { SqliteStorage } from "../storage/sqlite.js";
import type { Config } from "../config/schema.js";
import type { ResolvedWorkclawProfile } from "../profiles/types.js";
import { ProfileRuntimeRegistry } from "../profiles/runtime.js";
import type { SkillIndexEntry } from "../skills/types.js";
import {
  resolveChatMemoryPath,
  resolveWorkspacePath
} from "../util/file.js";
import type { RunMode } from "./run-mode.js";
import {
  formatUserContentForRunMode,
  resolveRunMode,
  shouldIncludeChatContext
} from "./run-mode.js";

const readIfExists = (filePath: string) =>
  fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").trim() : "";

const TEAM_OVERLAY_FILES = [
  "TEAM.md",
  "PROJECTS.md",
  "OWNERSHIP.md",
  "GLOSSARY.md",
  "PROCESS.md",
  path.join("memory", "MEMORY.md")
];

const renderSkillsIndex = (skills: SkillIndexEntry[], enabledSkills: Set<string>) => {
  if (skills.length === 0) {
    return "(no skills available)";
  }
  return skills
    .map((skill) => {
      const flags: string[] = [];
      if (skill.always) {
        flags.push("always");
      }
      if (enabledSkills.has(skill.name)) {
        flags.push("enabled");
      }
      const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      return `- ${skill.name}${suffix}: ${skill.description}`;
    })
    .join("\n");
};

const ESTIMATED_CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
const CJK_CHAR_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const estimateCharTokens = (char: string) =>
  CJK_CHAR_PATTERN.test(char) ? 1 : 1 / ESTIMATED_CHARS_PER_TOKEN;

const estimateTextTokens = (text: string) =>
  Math.max(
    1,
    Math.ceil(
      [...text].reduce((sum, char) => sum + estimateCharTokens(char), 0)
    )
  );

const estimateMessageTokens = (message: ChatMessage) => {
  let total = MESSAGE_OVERHEAD_TOKENS;
  if (typeof message.content === "string") {
    total += estimateTextTokens(message.content);
  }
  if ("tool_calls" in message && Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      total += estimateTextTokens(call.function.name);
      total += estimateTextTokens(call.function.arguments);
    }
  }
  if ("tool_call_id" in message && typeof message.tool_call_id === "string") {
    total += estimateTextTokens(message.tool_call_id);
  }
  return total;
};

const estimateConversationTokens = (messages: ChatMessage[]) =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

const truncateTextToApproxTokens = (text: string, maxTokens: number) => {
  if (maxTokens <= 0) {
    return "";
  }
  if (estimateTextTokens(text) <= maxTokens) {
    return text;
  }
  const suffix = "\n...[truncated by token budget]";
  const suffixTokens = estimateTextTokens(suffix);
  const availableTokens = Math.max(0, maxTokens - suffixTokens);

  let usedTokens = 0;
  let keep = 0;
  for (const char of text) {
    const charTokens = estimateCharTokens(char);
    if (usedTokens + charTokens > availableTokens) {
      break;
    }
    usedTokens += charTokens;
    keep += char.length;
  }

  return `${text.slice(0, keep)}${suffix}`;
};

const applyTokenBudget = (
  messages: ChatMessage[],
  maxInputTokens: number,
  reserveOutputTokens: number
) => {
  if (messages.length === 0) {
    return messages;
  }

  const budget = Math.max(256, maxInputTokens - reserveOutputTokens);
  if (estimateConversationTokens(messages) <= budget) {
    return messages;
  }

  const [systemMessage, ...rest] = messages;
  const tail = [...rest];

  while (tail.length > 1 && estimateConversationTokens([systemMessage, ...tail]) > budget) {
    tail.shift();
  }

  let nextSystem = systemMessage;
  let candidate = [nextSystem, ...tail];
  if (estimateConversationTokens(candidate) > budget && nextSystem.role === "system") {
    const tailTokens = estimateConversationTokens(tail);
    const availableForSystem = Math.max(64, budget - tailTokens - MESSAGE_OVERHEAD_TOKENS);
    nextSystem = {
      ...nextSystem,
      content: truncateTextToApproxTokens(nextSystem.content, availableForSystem)
    };
    candidate = [nextSystem, ...tail];
  }

  if (candidate.length > 0 && estimateConversationTokens(candidate) > budget) {
    const lastIndex = candidate.length - 1;
    const last = candidate[lastIndex];
    if (
      last &&
      (last.role === "user" || last.role === "assistant" || last.role === "system")
    ) {
      const tokensWithoutLast =
        estimateConversationTokens(candidate) - estimateMessageTokens(last);
      const availableForLast = Math.max(
        32,
        budget - tokensWithoutLast - MESSAGE_OVERHEAD_TOKENS
      );
      candidate[lastIndex] = {
        ...last,
        content: truncateTextToApproxTokens(last.content, availableForLast)
      };
    }
  }

  return candidate;
};

export class ContextBuilder {
  private readonly profileRegistry: ProfileRuntimeRegistry;

  constructor(
    private storage: SqliteStorage,
    private config: Config,
    private workspaceDir: string,
    profileRegistry?: ProfileRuntimeRegistry
  ) {
    this.profileRegistry =
      profileRegistry ??
      new ProfileRuntimeRegistry(config, {
        instanceRoot: path.dirname(path.resolve(workspaceDir))
      });
  }

  private resolveProfile(chat: ChatRecord): ResolvedWorkclawProfile {
    return this.profileRegistry.getRequired(chat.profileId);
  }

  build(params: {
    chat: ChatRecord;
    inbound: InboundMessage;
    runMode?: RunMode;
    skills: SkillIndexEntry[];
  }): { messages: ChatMessage[]; systemPrompt: string; profile: ResolvedWorkclawProfile } {
    const profile = this.resolveProfile(params.chat);
    const identityPath = resolveWorkspacePath(profile.workspaceDir, "IDENTITY.md");
    const userPath = resolveWorkspacePath(profile.workspaceDir, "USER.md");
    const toolsPath = resolveWorkspacePath(profile.workspaceDir, "TOOLS.md");
    const globalMemoryPath = resolveWorkspacePath(profile.workspaceDir, "memory/MEMORY.md");
    const chatMemoryPath = resolveChatMemoryPath(
      profile.workspaceDir,
      params.chat.channel,
      params.chat.chatId
    );

    const identity = readIfExists(identityPath);
    const userProfile = readIfExists(userPath);
    const toolsPolicy = readIfExists(toolsPath);
    const globalMemory = readIfExists(globalMemoryPath);
    const chatMemory = readIfExists(chatMemoryPath);
    const teamOverlaySections = profile.teamWorkspaces
      .flatMap((workspace) =>
        TEAM_OVERLAY_FILES.map((relativePath) => {
          const filePath = resolveWorkspacePath(workspace, relativePath);
          const content = readIfExists(filePath);
          if (!content) {
            return null;
          }
          return `# Team Overlay ${path.basename(relativePath, path.extname(relativePath))}\n${content}`;
        })
      )
      .filter((section): section is string => Boolean(section));

    const runMode = params.runMode ?? resolveRunMode(params.inbound);
    const effectiveContextMode = runMode.contextMode === "group" ? "full" : runMode.contextMode;
    const state = this.storage.getConversationState(params.chat.id);
    const includeChatContext = shouldIncludeChatContext(runMode);
    const includeGlobalMemory = effectiveContextMode === "full";
    const includeConversationSummary = effectiveContextMode !== "isolated";
    const includeSkillBodies = effectiveContextMode === "full";
    const enabledSkills = new Set(state.enabledSkills);

    const systemSections: string[] = [];
    if (identity) {
      systemSections.push(`# Identity\n${identity}`);
    }
    if (toolsPolicy) {
      systemSections.push(`# Tool Policy\n${toolsPolicy}`);
    }
    if (userProfile) {
      systemSections.push(`# User Profile\n${userProfile}`);
    }
    if (teamOverlaySections.length > 0) {
      systemSections.push(teamOverlaySections.join("\n\n"));
    }
    systemSections.push(`# Pack Index\n${profile.enabledPackIds.join("\n") || "(no packs enabled)"}`);
    if (includeGlobalMemory && globalMemory) {
      systemSections.push(`# Global Memory\n${globalMemory}`);
    }
    if (includeChatContext && effectiveContextMode === "full" && chatMemory) {
      systemSections.push(`# Chat Memory\n${chatMemory}`);
    }
    systemSections.push("# Skills Index\n" + renderSkillsIndex(params.skills, enabledSkills));

    const alwaysSkills = params.skills.filter((skill) => skill.always);
    if (includeSkillBodies && alwaysSkills.length > 0) {
      const skillBodies = alwaysSkills
        .map((skill) => {
          const content = readIfExists(skill.skillPath);
          return `# Skill: ${skill.name}\n${content}`;
        })
        .join("\n\n");
      systemSections.push(`# Always Skills\n${skillBodies}`);
    }

    const activeSkills = params.skills.filter(
      (skill) => !skill.always && enabledSkills.has(skill.name)
    );
    if (includeSkillBodies && activeSkills.length > 0) {
      const skillBodies = activeSkills
        .map((skill) => {
          const content = readIfExists(skill.skillPath);
          return `# Skill: ${skill.name}\n${content}`;
        })
        .join("\n\n");
      systemSections.push(`# Enabled Skills\n${skillBodies}`);
    }

    if (includeConversationSummary && state.summary) {
      systemSections.push(`# Conversation Summary\n${state.summary}`);
    }

    const systemPrompt = systemSections.filter(Boolean).join("\n\n");

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

    if (includeChatContext && effectiveContextMode === "full") {
      const history = this.storage.listRecentMessages(
        params.chat.id,
        this.config.historyMaxMessages
      );
      for (const msg of history) {
        if (!msg.content) {
          continue;
        }
        if (msg.role === "assistant" || msg.role === "user") {
          messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }

    const userContent = formatUserContentForRunMode(
      runMode,
      params.inbound.content
    );

    messages.push({ role: "user", content: userContent });

    const bounded = applyTokenBudget(
      messages,
      this.config.provider.maxInputTokens,
      this.config.provider.reserveOutputTokens
    );
    const first = bounded[0];
    const boundedSystemPrompt =
      first && first.role === "system" ? first.content : systemPrompt;

    return { messages: bounded, systemPrompt: boundedSystemPrompt, profile };
  }
}
