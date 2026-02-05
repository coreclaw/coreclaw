export type McpServerConfig = {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
};

export type McpConfigFile = {
  servers: Record<string, Omit<McpServerConfig, "name">>;
};
