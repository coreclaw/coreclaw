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
  return {
    mode: action.mode ?? "conversation",
    threadKey: action.threadKeyTemplate
      ? renderBindingTemplate(action.threadKeyTemplate, event)
      : event.threadKey,
    registerConversation: action.registerConversation ?? true,
    replyMode: action.replyMode ?? "normal",
    contextMode: action.contextMode ?? "full",
    outbound: {
      targetMode: hints?.suppressOutbound ? "none" : action.outbound?.targetMode ?? "reply-to-event",
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
    conversationKey: action.threadKey ?? event.threadKey ?? `${event.surface}:${event.sourceKey}`,
    action,
    bindingId: selected.binding.id,
    tier: selected.tier
  };
};
