import type { SqliteStorage } from "../storage/sqlite.js";
import type { OutboundActionRecord } from "../types.js";

export const enqueueOutboundAction = (
  storage: SqliteStorage,
  params: Omit<
    Parameters<SqliteStorage["createOutboundAction"]>[0],
    "payloadJson"
  > & {
    payload: Record<string, unknown>;
  }
): OutboundActionRecord =>
  storage.createOutboundAction({
    ...params,
    payloadJson: JSON.stringify(params.payload)
  });
