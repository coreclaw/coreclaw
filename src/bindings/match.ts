import type { WorkclawBinding, WorkclawBindingMatch, WorkclawEvent } from "./types.js";

const exactMatch = (expected: string | undefined, actual: string | undefined) =>
  expected === undefined || expected === actual;

export const matchesBinding = (event: WorkclawEvent, match: WorkclawBindingMatch): boolean => {
  if (!exactMatch(match.surface, event.surface)) return false;
  if (!exactMatch(match.event, event.event)) return false;
  if (!exactMatch(match.sourceKey, event.sourceKey)) return false;
  if (!exactMatch(match.projectKey, event.projectKey)) return false;
  if (!exactMatch(match.repoKey, event.repoKey)) return false;
  if (!exactMatch(match.threadKey, event.threadKey)) return false;
  if (!exactMatch(match.senderKey, event.senderKey)) return false;
  if (!exactMatch(match.channelKey, event.channelKey)) return false;
  if (match.metadata) {
    for (const [key, value] of Object.entries(match.metadata)) {
      if (event.metadata?.[key] !== value) {
        return false;
      }
    }
  }
  return true;
};

export const getBindingTier = (binding: WorkclawBinding): number => {
  const match = binding.match;
  if (match.threadKey) return 1;
  if (match.repoKey && match.event) return 2;
  if (match.projectKey && match.event) return 3;
  if (match.surface && match.event) return 4;
  if (match.surface) return 5;
  return 6;
};
