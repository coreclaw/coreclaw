export type MergeableToolPolicy = {
  allow?: string[];
  deny?: string[];
  allowGroups?: string[][];
};

const dedupePatterns = (values: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values ?? []) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

export const compileToolPattern = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
};

export const matchesToolPattern = (toolName: string, pattern: string) =>
  compileToolPattern(pattern).test(toolName);

export const matchesAnyToolPattern = (toolName: string, patterns: string[] | undefined) =>
  (patterns ?? []).some((pattern) => matchesToolPattern(toolName, pattern));

export const getToolPolicyAllowGroups = (
  policy: MergeableToolPolicy | undefined
): string[][] => {
  if (!policy) {
    return [];
  }
  if (policy.allowGroups && policy.allowGroups.length > 0) {
    return policy.allowGroups.map((group) => dedupePatterns(group));
  }
  const allow = dedupePatterns(policy.allow);
  return allow.length > 0 ? [allow] : [];
};

const patternCovers = (cover: string, candidate: string): boolean => {
  if (cover === candidate || cover === "*") {
    return true;
  }
  if (!candidate.includes("*")) {
    return matchesToolPattern(candidate, cover);
  }
  return false;
};

const intersectPatternLists = (left: string[], right: string[]): string[] => {
  const intersected: string[] = [];
  for (const leftPattern of left) {
    for (const rightPattern of right) {
      if (patternCovers(leftPattern, rightPattern)) {
        intersected.push(rightPattern);
      } else if (patternCovers(rightPattern, leftPattern)) {
        intersected.push(leftPattern);
      }
    }
  }
  return dedupePatterns(intersected);
};

const summarizeAllowGroups = (groups: string[][]): string[] | undefined => {
  if (groups.length === 0) {
    return undefined;
  }
  let current = groups[0] ?? [];
  for (const group of groups.slice(1)) {
    current = intersectPatternLists(current, group);
  }
  return dedupePatterns(current);
};

export const mergeToolPolicies = (
  ...policies: Array<MergeableToolPolicy | undefined>
): MergeableToolPolicy => {
  const allowGroups: string[][] = [];
  const deny = new Set<string>();

  for (const policy of policies) {
    allowGroups.push(...getToolPolicyAllowGroups(policy));
    for (const entry of policy?.deny ?? []) {
      if (entry) {
        deny.add(entry);
      }
    }
  }

  const allow = summarizeAllowGroups(allowGroups);
  return {
    ...(allow ? { allow } : {}),
    ...(allowGroups.length > 1 || allowGroups.some((group) => group.length === 0)
      ? { allowGroups }
      : {}),
    ...(deny.size > 0 ? { deny: [...deny] } : {})
  };
};
