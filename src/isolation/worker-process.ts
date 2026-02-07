import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertPublicUrl, readBodyWithLimit } from "../tools/web-fetch-core.js";
import { resolveWorkspacePath } from "../util/file.js";

type WebFetchPolicyRules = {
  allowedDomains: string[];
  allowedPorts: number[];
  blockedPorts: number[];
};

type WorkerRequest = {
  toolName: "shell.exec";
  request: {
    command: string;
    cwd: string;
    timeoutMs: number;
    allowShell: boolean;
    allowedShellCommands: string[];
    env: Record<string, string>;
    maxOutputChars: number;
  };
} | {
  toolName: "web.fetch";
  request: {
    url: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    maxResponseChars: number;
    policy: WebFetchPolicyRules;
  };
} | {
  toolName: "fs.write";
  request: {
    workspaceDir: string;
    path: string;
    content: string;
    mode: "overwrite" | "append";
  };
};

type WorkerResponse =
  | {
      ok: true;
      result: string;
    }
  | {
      ok: false;
      error: string;
    };

const appendWithLimit = (
  current: string,
  chunk: string,
  maxChars: number
): { value: string; truncated: boolean } => {
  if (current.length >= maxChars) {
    return { value: current, truncated: true };
  }
  const next = current + chunk;
  if (next.length <= maxChars) {
    return { value: next, truncated: false };
  }
  return { value: next.slice(0, maxChars), truncated: true };
};

const tokenizeCommand = (input: string): string[] => {
  const command = input.trim();
  if (!command) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped || quote) {
    throw new Error("Invalid command format: unterminated escape or quote.");
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
};

const readStdin = async (): Promise<string> => {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
};

const executeShell = async (request: WorkerRequest["request"]): Promise<string> => {
  if (!("allowShell" in request)) {
    throw new Error("invalid shell request payload");
  }

  if (!request.allowShell) {
    throw new Error("Shell execution is disabled.");
  }

  const tokens = tokenizeCommand(request.command);
  if (tokens.length === 0) {
    throw new Error("Command is empty.");
  }
  const [file, ...args] = tokens;

  if (request.allowedShellCommands.length > 0) {
    const allowed = request.allowedShellCommands.includes(file);
    if (!allowed) {
      throw new Error("Executable not in allowlist.");
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: request.cwd,
      env: request.env,
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 1_000);
    }, request.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      const appended = appendWithLimit(stdout, chunk.toString(), request.maxOutputChars);
      stdout = appended.value;
      truncated = truncated || appended.truncated;
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const appended = appendWithLimit(stderr, chunk.toString(), request.maxOutputChars);
      stderr = appended.value;
      truncated = truncated || appended.truncated;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out after ${request.timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        const message = stderr.trim() || `Command exited with code ${code}.`;
        reject(new Error(message));
        return;
      }
      let output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (truncated) {
        output = output
          ? `${output}\n...truncated`
          : "...truncated";
      }
      resolve(output);
    });
  });
};

const executeWebFetch = async (
  request: Extract<WorkerRequest, { toolName: "web.fetch" }>["request"]
): Promise<string> => {
  const url = new URL(request.url);
  await assertPublicUrl(url, {
    allowedDomains: request.policy.allowedDomains,
    allowedPorts: request.policy.allowedPorts,
    blockedPorts: request.policy.blockedPorts
  });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), request.timeoutMs);

  const response = await fetch(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "POST" ? request.body : undefined,
    signal: abort.signal,
    redirect: "error"
  }).finally(() => {
    clearTimeout(timer);
  });

  const { body, truncated } = await readBodyWithLimit(response, request.maxResponseChars);
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
};

const executeFsWrite = async (
  request: Extract<WorkerRequest, { toolName: "fs.write" }>["request"]
): Promise<string> => {
  const target = resolveWorkspacePath(request.workspaceDir, request.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (request.mode === "append") {
    fs.appendFileSync(target, request.content, "utf-8");
  } else {
    fs.writeFileSync(target, request.content, "utf-8");
  }
  return "ok";
};

const writeResponse = (response: WorkerResponse) => {
  process.stdout.write(JSON.stringify(response));
};

const main = async () => {
  try {
    const raw = await readStdin();
    const request = JSON.parse(raw) as WorkerRequest;
    let result = "";
    if (request.toolName === "shell.exec") {
      result = await executeShell(request.request);
    } else if (request.toolName === "web.fetch") {
      result = await executeWebFetch(request.request);
    } else if (request.toolName === "fs.write") {
      result = await executeFsWrite(request.request);
    } else {
      throw new Error(`unsupported isolated tool: ${(request as { toolName: string }).toolName}`);
    }
    writeResponse({
      ok: true,
      result
    });
  } catch (error) {
    writeResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  }
};

void main();
