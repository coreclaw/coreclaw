import type {
  DiscoveredWorkclawPack,
  WorkclawPackEnvRequirement,
  WorkclawPackToolPolicy
} from "./types.js";
import { PackGraphError } from "./errors.js";
import { mergeToolPolicies } from "../tools/policy-merge.js";

export const resolveEffectivePackGraph = (
  discovered: Iterable<DiscoveredWorkclawPack>,
  rootPackIds: string[],
  options: { strict?: boolean } = {}
): DiscoveredWorkclawPack[] => {
  const strict = options.strict ?? true;
  const packsById = new Map<string, DiscoveredWorkclawPack>();
  for (const pack of discovered) {
    packsById.set(pack.id, pack);
  }

  const resolved: DiscoveredWorkclawPack[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();

  const visit = (packId: string, stack: string[]) => {
    const pack = packsById.get(packId);
    if (!pack) {
      if (strict) {
        throw new PackGraphError(`Unknown pack in graph: ${packId}`);
      }
      return;
    }
    if (visiting.has(packId)) {
      throw new PackGraphError(`Pack extends cycle detected: ${[...stack, packId].join(" -> ")}`);
    }
    if (emitted.has(packId)) {
      return;
    }

    visiting.add(packId);
    for (const dependency of pack.manifest.extends ?? []) {
      visit(dependency, [...stack, packId]);
    }
    visiting.delete(packId);

    emitted.add(packId);
    resolved.push(pack);
  };

  for (const packId of rootPackIds) {
    visit(packId, []);
  }

  return resolved;
};

export const mergePackEnvRequirements = (
  graph: DiscoveredWorkclawPack[]
): WorkclawPackEnvRequirement[] => {
  const merged = new Map<string, WorkclawPackEnvRequirement>();
  for (const pack of graph) {
    for (const requirement of pack.manifest.env ?? []) {
      merged.set(requirement.name, requirement);
    }
  }
  return [...merged.values()];
};

export const mergePackToolPolicies = (
  graph: DiscoveredWorkclawPack[]
): WorkclawPackToolPolicy => {
  let profile: string | undefined;
  let elevatedEnabled = true;

  for (const pack of graph) {
    const policy = pack.manifest.toolPolicy;
    if (!policy) {
      continue;
    }
    if (policy.profile) {
      profile = policy.profile;
    }
    if (policy.elevated?.enabled === false) {
      elevatedEnabled = false;
    }
  }

  const merged = mergeToolPolicies(...graph.map((pack) => pack.manifest.toolPolicy));
  return {
    ...(profile ? { profile } : {}),
    ...merged,
    elevated: { enabled: elevatedEnabled }
  };
};
