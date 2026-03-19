import type { WorkclawEvent } from "./types.js";
import { BindingResolutionError } from "./errors.js";

const readPath = (root: unknown, pathSegments: string[]): unknown => {
  let cursor = root;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

export const renderBindingTemplate = (template: string, event: WorkclawEvent): string =>
  template.replace(/\$\{([^}]+)\}/g, (_whole, token) => {
    const value = readPath(event, String(token).split("."));
    if (value === undefined || value === null) {
      throw new BindingResolutionError(`Binding template references missing key: ${token}`);
    }
    return String(value);
  });
