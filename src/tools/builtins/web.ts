import { z } from "zod";
import type { ToolSpec } from "../registry.js";
import {
  assertPublicUrl,
  DEFAULT_WEB_FETCH_MAX_RESPONSE_CHARS,
  DEFAULT_WEB_FETCH_TIMEOUT_MS,
  readBodyWithLimit
} from "../web-fetch-core.js";

const getAllowedEnv = (key: string, allowed: string[]) => {
  if (allowed.includes(key)) {
    return process.env[key];
  }
  return undefined;
};

export const webTools = (): ToolSpec<any>[] => {
  const fetchTool: ToolSpec<z.ZodTypeAny> = {
    name: "web.fetch",
    description: "Fetch a URL over HTTP.",
    schema: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]).default("GET"),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(DEFAULT_WEB_FETCH_TIMEOUT_MS),
      maxResponseChars: z
        .number()
        .int()
        .min(1_000)
        .max(1_000_000)
        .default(DEFAULT_WEB_FETCH_MAX_RESPONSE_CHARS)
    }),
    async run(args, ctx) {
      const url = new URL(args.url);
      const policy = {
        allowedDomains: ctx.config.allowedWebDomains,
        allowedPorts: ctx.config.allowedWebPorts,
        blockedPorts: ctx.config.blockedWebPorts
      };
      await assertPublicUrl(url, policy);
      const timeoutMs = args.timeoutMs ?? DEFAULT_WEB_FETCH_TIMEOUT_MS;
      const maxResponseChars = args.maxResponseChars ?? DEFAULT_WEB_FETCH_MAX_RESPONSE_CHARS;

      const isolatedRuntime = ctx.isolatedRuntime;
      if (isolatedRuntime?.isToolIsolated("web.fetch")) {
        return isolatedRuntime.executeWebFetch({
          url: url.toString(),
          method: args.method,
          headers: args.headers,
          body: args.body,
          timeoutMs,
          maxResponseChars,
          policy
        });
      }

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);

      const response = await fetch(url.toString(), {
        method: args.method,
        headers: args.headers,
        body: args.method === "POST" ? args.body : undefined,
        signal: abort.signal,
        redirect: "error"
      }).finally(() => {
        clearTimeout(timer);
      });

      const { body, truncated } = await readBodyWithLimit(response, maxResponseChars);
      return JSON.stringify(
        {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
          truncated
        },
        null,
        2
      );
    }
  };

  const searchTool: ToolSpec<z.ZodTypeAny> = {
    name: "web.search",
    description: "Search the web using Brave Search API.",
    schema: z.object({
      query: z.string().min(1),
      count: z.number().int().min(1).max(10).default(5)
    }),
    async run(args, ctx) {
      const apiKey = getAllowedEnv("BRAVE_API_KEY", ctx.config.allowedEnv);
      if (!apiKey) {
        throw new Error("BRAVE_API_KEY not available.");
      }
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", args.query);
      url.searchParams.set("count", String(args.count));
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey
        }
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brave search failed: ${response.status} ${body}`);
      }
      const data = await response.json();
      return JSON.stringify(data, null, 2);
    }
  };

  return [fetchTool, searchTool];
};
