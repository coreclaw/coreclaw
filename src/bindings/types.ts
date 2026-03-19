export type WorkclawEvent = {
  id: string;
  surface: string;
  event: string;
  sourceKey: string;
  projectKey?: string;
  repoKey?: string;
  threadKey?: string;
  senderKey?: string;
  channelKey?: string;
  createdAt: string;
  correlationId?: string;
  trustLevel?: "trusted" | "verified" | "untrusted";
  metadata?: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type WorkclawRoutingHints = {
  profileId?: string;
  bindingId?: string;
  suppressOutbound?: boolean;
};

export type WorkclawBindingMatch = {
  surface?: string;
  event?: string;
  sourceKey?: string;
  projectKey?: string;
  repoKey?: string;
  threadKey?: string;
  senderKey?: string;
  channelKey?: string;
  metadata?: Record<string, string>;
};

export type WorkclawBindingPolicy = {
  dedupeWindowMs?: number;
  cooldownMs?: number;
  maxConcurrent?: number;
  onNoMatch?: "drop" | "warn";
};

export type WorkclawBindingAction = {
  mode?: "conversation" | "fire-and-report" | "silent-automation" | "task-enqueue";
  threadKeyTemplate?: string;
  registerConversation?: boolean;
  replyMode?: "normal" | "silent" | "report-only";
  contextMode?: "full" | "minimal" | "isolated";
  outbound?: {
    targetMode?: "reply-to-event" | "explicit-target" | "none";
    surface?: string;
    sourceKeyTemplate?: string;
    threadKeyTemplate?: string;
    channelKeyTemplate?: string;
  };
};

export type WorkclawBinding = {
  id: string;
  enabled?: boolean;
  profileId: string;
  match: WorkclawBindingMatch;
  policy?: WorkclawBindingPolicy;
  action?: WorkclawBindingAction;
  metadata?: Record<string, string>;
};

export type ResolvedBindingAction = {
  mode: "conversation" | "fire-and-report" | "silent-automation" | "task-enqueue";
  threadKey?: string;
  registerConversation: boolean;
  replyMode: "normal" | "silent" | "report-only";
  contextMode: "full" | "minimal" | "isolated";
  outbound: {
    targetMode: "reply-to-event" | "explicit-target" | "none";
    surface?: string;
    sourceKey?: string;
    threadKey?: string;
    channelKey?: string;
  };
};

export type RoutedWorkclawEvent = {
  event: WorkclawEvent;
  profileId: string;
  conversationKey: string;
  action: ResolvedBindingAction;
  bindingId: string;
  tier: number;
};
