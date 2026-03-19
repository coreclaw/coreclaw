import type {
  DiscoveredWorkclawPack,
  WorkclawPackEnvRequirement,
  WorkclawPackToolPolicy
} from "./types.js";
import { PackGraphError } from "./errors.js";

const dedupe = (values: string[] | undefined): string[] => [...new Set(values ?? [])];

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
  let allow: string[] | undefined;
  const deny = new Set<string>();
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
    if (policy.allow) {
      allow = allow ? allow.filter((entry) => policy.allow?.includes(entry)) : [...policy.allow];
    }
    for (const entry of policy.deny ?? []) {
      deny.add(entry);
    }
    if (policy.elevated?.enabled === false) {
      elevatedEnabled = false;
    }
  }

  return {
    ...(profile ? { profile } : {}),
    ...(allow ? { allow: dedupe(allow) } : {}),
    ...(deny.size > 0 ? { deny: [...deny] } : {}),
    elevated: { enabled: elevatedEnabled }
  };
};
