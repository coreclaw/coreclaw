import type {
  ResolvedBindingAction,
  RoutedWorkclawEvent,
  WorkclawBinding,
  WorkclawEvent,
  WorkclawRoutingHints
} from "./types.js";
import { getBindingTier, matchesBinding } from "./match.js";
import { renderBindingTemplate } from "./template.js";

const resolveAction = (
  binding: WorkclawBinding,
  event: WorkclawEvent,
  hints?: WorkclawRoutingHints
): ResolvedBindingAction => {
  const action = binding.action ?? {};
  const mode = action.mode ?? "conversation";
  const defaultReplyMode =
    mode === "silent-automation" || mode === "task-enqueue"
      ? "silent"
      : mode === "fire-and-report"
        ? "report-only"
        : "normal";
  const defaultTargetMode =
    mode === "silent-automation" || mode === "task-enqueue" ? "none" : "reply-to-event";
  return {
    mode,
    threadKey: action.threadKeyTemplate
      ? renderBindingTemplate(action.threadKeyTemplate, event)
      : event.threadKey,
    registerConversation: action.registerConversation ?? true,
    replyMode: action.replyMode ?? defaultReplyMode,
    contextMode: action.contextMode ?? "full",
    outbound: {
      targetMode: hints?.suppressOutbound ? "none" : action.outbound?.targetMode ?? defaultTargetMode,
      surface: action.outbound?.surface,
      sourceKey: action.outbound?.sourceKeyTemplate
        ? renderBindingTemplate(action.outbound.sourceKeyTemplate, event)
        : undefined,
      threadKey: action.outbound?.threadKeyTemplate
        ? renderBindingTemplate(action.outbound.threadKeyTemplate, event)
        : undefined,
      channelKey: action.outbound?.channelKeyTemplate
        ? renderBindingTemplate(action.outbound.channelKeyTemplate, event)
        : undefined
    }
  };
};

export const resolveBinding = (
  event: WorkclawEvent,
  bindings: WorkclawBinding[],
  hints?: WorkclawRoutingHints
): RoutedWorkclawEvent | null => {
  const matched = bindings
    .filter((binding) => binding.enabled !== false)
    .filter((binding) => matchesBinding(event, binding.match))
    .filter((binding) => !hints?.bindingId || binding.id === hints.bindingId)
    .filter((binding) => !hints?.profileId || binding.profileId === hints.profileId)
    .map((binding, index) => ({ binding, index, tier: getBindingTier(binding) }))
    .sort((left, right) => left.tier - right.tier || left.index - right.index);

  const selected = matched[0];
  if (!selected) {
    return null;
  }

  const action = resolveAction(selected.binding, event, hints);
  return {
    event,
    profileId: selected.binding.profileId,
    conversationKey: action.threadKey ?? event.threadKey ?? event.sourceKey,
    action,
    policy: selected.binding.policy,
    bindingId: selected.binding.id,
    tier: selected.tier
  };
};
