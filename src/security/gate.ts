import type { Config } from "../config/schema.js";

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "localhost"
]);

const isLoopbackHost = (host: string) => {
  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (LOOPBACK_HOSTS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith("127.")) {
    return true;
  }
  return false;
};

export const enforceSecurityProfile = (config: Config) => {
  if (config.securityProfile !== "hardened") {
    return;
  }

  if (config.allowShell) {
    throw new Error("hardened profile forbids allowShell=true.");
  }

  if (config.allowedWebDomains.length === 0) {
    throw new Error("hardened profile requires CORECLAW_WEB_ALLOWLIST.");
  }

  if (config.webhook.enabled) {
    if (!isLoopbackHost(config.webhook.host)) {
      throw new Error("hardened profile requires webhook.host to be loopback.");
    }
    if (!config.webhook.authToken?.trim()) {
      throw new Error("hardened profile requires webhook.authToken when webhook is enabled.");
    }
  }

  if (config.observability.http.enabled && !isLoopbackHost(config.observability.http.host)) {
    throw new Error("hardened profile requires observability.http.host to be loopback.");
  }
};
