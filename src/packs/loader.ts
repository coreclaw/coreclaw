import type { SqliteStorage } from "../storage/sqlite.js";
import type { DiscoveredWorkclawPack } from "./types.js";
import {
  mergePackEnvRequirements,
  mergePackToolPolicies,
  resolveEffectivePackGraph
} from "./graph.js";

export const loadProfilePackGraph = (
  storage: SqliteStorage,
  discovered: DiscoveredWorkclawPack[],
  profileId: string,
  options: { strict?: boolean } = {}
) => {
  const enabled = storage
    .listProfilePackEnablements(profileId)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.packId);
  const graph = resolveEffectivePackGraph(discovered, enabled, options);
  return {
    graph,
    env: mergePackEnvRequirements(graph),
    toolPolicy: mergePackToolPolicies(graph)
  };
};
