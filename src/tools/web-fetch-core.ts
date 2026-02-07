import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { validateWebTargetByPolicy } from "./web-guard.js";

export const DEFAULT_WEB_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_WEB_FETCH_MAX_RESPONSE_CHARS = 200_000;

const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
};

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isPrivateIpv4(mapped);
  }
  return false;
};

const isPrivateAddress = (ip: string): boolean => {
  const version = isIP(ip);
  if (version === 4) {
    return isPrivateIpv4(ip);
  }
  if (version === 6) {
    return isPrivateIpv6(ip);
  }
  return true;
};

export type WebFetchPolicyRules = {
  allowedDomains: string[];
  allowedPorts: number[];
  blockedPorts: number[];
};

export const assertPublicUrl = async (url: URL, rules: WebFetchPolicyRules) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed.");
  }

  const policyError = validateWebTargetByPolicy(url, {
    allowedWebDomains: rules.allowedDomains,
    allowedWebPorts: rules.allowedPorts,
    blockedWebPorts: rules.blockedPorts
  });
  if (policyError) {
    throw new Error(policyError);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost access is blocked.");
  }

  if (isIP(hostname) > 0) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private network access is blocked.");
    }
    return;
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error("Unable to resolve host.");
  }
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private network access is blocked.");
  }
};

export const readBodyWithLimit = async (
  response: Response,
  maxChars: number
): Promise<{ body: string; truncated: boolean }> => {
  if (!response.body) {
    return { body: "", truncated: false };
  }

  let output = "";
  let truncated = false;

  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    output += Buffer.from(chunk).toString("utf-8");
    if (output.length > maxChars) {
      output = output.slice(0, maxChars);
      truncated = true;
      break;
    }
  }

  return { body: output, truncated };
};
