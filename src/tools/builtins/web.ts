import { z } from "zod";
import type { ToolSpec } from "../registry.js";

const getAllowedEnv = (key: string, allowed: string[]) => {
  if (allowed.length === 0 || allowed.includes(key)) {
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
      body: z.string().optional()
    }),
    async run(args) {
      const response = await fetch(args.url, {
        method: args.method,
        headers: args.headers,
        body: args.method === "POST" ? args.body : undefined
      });
      const text = await response.text();
      return JSON.stringify(
        {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: text
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
      const data = await response.json();
      return JSON.stringify(data, null, 2);
    }
  };

  return [fetchTool, searchTool];
};
