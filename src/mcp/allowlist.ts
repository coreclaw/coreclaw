const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globToRegex = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => escapeRegex(part))
      .join(".*")}$`
  );

export const parseMcpToolFullName = (fullName: string): { server: string; tool: string } | null => {
  if (!fullName.startsWith("mcp__")) {
    return null;
  }
  const remainder = fullName.slice("mcp__".length);
  const separator = remainder.indexOf("__");
  if (separator <= 0 || separator >= remainder.length - 2) {
    return null;
  }
  const server = remainder.slice(0, separator);
  const tool = remainder.slice(separator + 2);
  return {
    server,
    tool
  };
};

export const isMcpServerAllowed = (allowedServers: string[], server: string) => {
  if (allowedServers.length === 0) {
    return true;
  }
  return allowedServers.includes(server);
};

export const isMcpToolAllowed = (allowedPatterns: string[], params: {
  fullName: string;
  server: string;
  tool: string;
}) => {
  if (allowedPatterns.length === 0) {
    return true;
  }
  const aliases = [
    params.fullName,
    `${params.server}.${params.tool}`,
    `${params.server}/${params.tool}`
  ];
  return allowedPatterns.some((pattern) => {
    const regex = globToRegex(pattern);
    return aliases.some((alias) => regex.test(alias));
  });
};
