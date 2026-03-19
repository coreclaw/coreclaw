export type WorkclawPluginManifest = {
  id: string;
  name: string;
  description: string;
  configSchema: string;
  tools?: string[];
  surfaces?: string[];
  kinds?: string[];
  skills?: string[];
  uiHints?: Record<string, string>;
  env?: Array<{
    name: string;
    required: boolean;
    description?: string;
  }>;
};

export type DiscoveredWorkclawPlugin = {
  id: string;
  rootDir: string;
  manifestPath: string;
  manifest: WorkclawPluginManifest;
  allowed: boolean;
  blockedReason?: string;
};
