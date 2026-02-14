import type { InboundMessage, TaskContextMode } from "../types.js";

export type RunModeKind = "chat" | "scheduled" | "heartbeat";

export type RunMode = {
  kind: RunModeKind;
  contextMode: TaskContextMode;
};

const parseTaskContextMode = (value: unknown): TaskContextMode =>
  value === "isolated" ? "isolated" : "group";

export const resolveRunMode = (inbound: InboundMessage): RunMode => {
  if (inbound.metadata?.isHeartbeat) {
    return {
      kind: "heartbeat",
      contextMode: "group"
    };
  }

  if (inbound.metadata?.isScheduledTask) {
    return {
      kind: "scheduled",
      contextMode: parseTaskContextMode(inbound.metadata?.contextMode)
    };
  }

  return {
    kind: "chat",
    contextMode: "group"
  };
};

export const shouldIncludeChatContext = (runMode: RunMode) =>
  runMode.kind === "chat" || runMode.contextMode === "group";

export const formatUserContentForRunMode = (
  runMode: RunMode,
  content: string
): string => (runMode.kind === "scheduled" ? `[Scheduled Task] ${content}` : content);

export const isHeartbeatRunMode = (runMode: RunMode) => runMode.kind === "heartbeat";

export const shouldWakeHeartbeatAfterRun = (runMode: RunMode) =>
  runMode.kind !== "heartbeat";
