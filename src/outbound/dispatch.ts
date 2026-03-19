import type { SqliteStorage } from "../storage/sqlite.js";

export const markOutboundActionSending = (storage: SqliteStorage, id: string): void => {
  storage.updateOutboundAction({ id, deliveryState: "sending" });
};

export const markOutboundActionSent = (storage: SqliteStorage, id: string): void => {
  storage.updateOutboundAction({ id, deliveryState: "sent", nextAttemptAt: null });
};

export const markOutboundActionFailed = (
  storage: SqliteStorage,
  id: string,
  retryCount: number,
  nextAttemptAt: string | null
): void => {
  storage.updateOutboundAction({
    id,
    deliveryState: "failed",
    retryCount,
    nextAttemptAt
  });
};
