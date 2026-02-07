import fs from "node:fs";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import type { Config } from "../config/schema.js";

type ShellExecRequest = {
  command: string;
  cwd: string;
  timeoutMs: number;
  allowShell: boolean;
  allowedShellCommands: string[];
  allowedEnvKeys: string[];
  maxOutputChars: number;
};

type WebFetchPolicyRules = {
  allowedDomains: string[];
  allowedPorts: number[];
  blockedPorts: number[];
};

type WebFetchRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseChars: number;
  policy: WebFetchPolicyRules;
};

type FsWriteRequest = {
  workspaceDir: string;
  path: string;
  content: string;
  mode: "overwrite" | "append";
};

type IsolatedToolName = "shell.exec" | "web.fetch" | "fs.write";

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

const SAFE_ENV_KEY = /^[A-Z_][A-Z0-9_]*$/i;
const DEFAULT_SYSTEM_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT"
];
const DEFAULT_FS_WRITE_TIMEOUT_MS = 10_000;

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

const resolveWorkerEntrypoint = () => {
  const jsWorkerPath = fileURLToPath(new URL("./worker-process.js", import.meta.url));
  if (fs.existsSync(jsWorkerPath)) {
    return {
      command: process.execPath,
      args: [jsWorkerPath]
    };
  }

  const tsWorkerPath = fileURLToPath(new URL("./worker-process.ts", import.meta.url));
  if (fs.existsSync(tsWorkerPath)) {
    return {
      command: process.execPath,
      args: ["--import", "tsx/esm", tsWorkerPath]
    };
  }

  throw new Error("Isolated worker entrypoint not found.");
};

export class IsolatedToolRuntime {
  private readonly activeWorkers = new Set<ChildProcess>();
  private readonly slotWaiters: Array<() => void> = [];
  private readonly consecutiveFailures = new Map<IsolatedToolName, number>();
  private readonly circuitOpenUntilMs = new Map<IsolatedToolName, number>();
  private inFlightWorkers = 0;

  constructor(
    private config: Config,
    private logger: Logger
  ) {}

  isToolIsolated(toolName: string): boolean {
    if (!this.config.isolation.enabled) {
      return false;
    }
    return this.config.isolation.toolNames.includes(toolName);
  }

  async executeShell(request: ShellExecRequest): Promise<string> {
    const env = this.buildWorkerCommandEnv(request.allowedEnvKeys);
    const maxOutputChars = Math.max(
      1_000,
      Math.min(request.maxOutputChars, this.config.isolation.maxWorkerOutputChars)
    );

    const workerRequest: WorkerRequest = {
      toolName: "shell.exec",
      request: {
        command: request.command,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        allowShell: request.allowShell,
        allowedShellCommands: request.allowedShellCommands,
        env,
        maxOutputChars
      }
    };
    return this.executeIsolatedRequest("shell.exec", workerRequest, request.timeoutMs);
  }

  async executeWebFetch(request: WebFetchRequest): Promise<string> {
    const maxResponseChars = Math.max(
      1_000,
      Math.min(request.maxResponseChars, this.config.isolation.maxWorkerOutputChars)
    );

    const workerRequest: WorkerRequest = {
      toolName: "web.fetch",
      request: {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        timeoutMs: request.timeoutMs,
        maxResponseChars,
        policy: request.policy
      }
    };
    return this.executeIsolatedRequest("web.fetch", workerRequest, request.timeoutMs);
  }

  async executeFsWrite(request: FsWriteRequest): Promise<string> {
    const workerRequest: WorkerRequest = {
      toolName: "fs.write",
      request: {
        workspaceDir: request.workspaceDir,
        path: request.path,
        content: request.content,
        mode: request.mode
      }
    };
    return this.executeIsolatedRequest("fs.write", workerRequest, DEFAULT_FS_WRITE_TIMEOUT_MS);
  }

  async shutdown(): Promise<void> {
    if (this.activeWorkers.size === 0) {
      return;
    }

    const workers = [...this.activeWorkers];
    for (const worker of workers) {
      if (!worker.killed && worker.exitCode === null) {
        worker.kill("SIGTERM");
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        for (const worker of workers) {
          if (!worker.killed && worker.exitCode === null) {
            worker.kill("SIGKILL");
          }
        }
        resolve();
      }, 1_000);
    });
  }

  private buildWorkerCommandEnv(allowedKeys: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of DEFAULT_SYSTEM_ENV_KEYS) {
      const value = process.env[key];
      if (typeof value === "string") {
        env[key] = value;
      }
    }
    for (const key of allowedKeys) {
      if (!SAFE_ENV_KEY.test(key)) {
        continue;
      }
      const value = process.env[key];
      if (typeof value === "string") {
        env[key] = value;
      }
    }
    return env;
  }

  private async executeIsolatedRequest(
    toolName: IsolatedToolName,
    request: WorkerRequest,
    commandTimeoutMs: number
  ): Promise<string> {
    this.ensureCircuitClosed(toolName);
    try {
      const response = await this.executeWorker(request, commandTimeoutMs);
      if (!response.ok) {
        throw new Error(response.error);
      }
      this.consecutiveFailures.set(toolName, 0);
      return response.result;
    } catch (error) {
      this.recordFailure(toolName, error);
      throw error;
    }
  }

  private ensureCircuitClosed(toolName: IsolatedToolName) {
    const openUntilMs = this.circuitOpenUntilMs.get(toolName);
    if (!openUntilMs) {
      return;
    }

    if (Date.now() >= openUntilMs) {
      this.circuitOpenUntilMs.delete(toolName);
      this.consecutiveFailures.set(toolName, 0);
      this.logger.info(
        {
          toolName
        },
        "isolated runtime circuit closed after cooldown"
      );
      return;
    }

    throw new Error(
      `Isolated runtime circuit open for ${toolName} until ${new Date(openUntilMs).toISOString()}.`
    );
  }

  private recordFailure(toolName: IsolatedToolName, error: unknown) {
    const nextFailures = (this.consecutiveFailures.get(toolName) ?? 0) + 1;
    const threshold = this.config.isolation.openCircuitAfterFailures;
    if (nextFailures < threshold) {
      this.consecutiveFailures.set(toolName, nextFailures);
      return;
    }

    const openUntilMs = Date.now() + this.config.isolation.circuitResetMs;
    this.circuitOpenUntilMs.set(toolName, openUntilMs);
    this.consecutiveFailures.set(toolName, 0);
    this.logger.warn(
      {
        toolName,
        threshold,
        openUntil: new Date(openUntilMs).toISOString(),
        error: error instanceof Error ? error.message : String(error)
      },
      "isolated runtime circuit opened after repeated failures"
    );
  }

  private async acquireWorkerSlot() {
    const maxConcurrentWorkers = this.config.isolation.maxConcurrentWorkers;
    if (this.inFlightWorkers < maxConcurrentWorkers) {
      this.inFlightWorkers += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.slotWaiters.push(resolve);
    });
    this.inFlightWorkers += 1;
  }

  private releaseWorkerSlot() {
    if (this.inFlightWorkers > 0) {
      this.inFlightWorkers -= 1;
    }
    const next = this.slotWaiters.shift();
    if (next) {
      next();
    }
  }

  private async executeWorker(
    request: WorkerRequest,
    commandTimeoutMs: number
  ): Promise<WorkerResponse> {
    await this.acquireWorkerSlot();
    const launch = resolveWorkerEntrypoint();
    const workerTimeoutMs = Math.max(
      this.config.isolation.workerTimeoutMs,
      commandTimeoutMs + 2_000
    );
    const maxStdioChars = this.config.isolation.maxWorkerOutputChars + 4_096;

    return new Promise<WorkerResponse>((resolve, reject) => {
      let worker: ChildProcessWithoutNullStreams;
      try {
        worker = spawn(launch.command, launch.args, {
          cwd: process.cwd(),
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (error) {
        this.releaseWorkerSlot();
        reject(error);
        return;
      }
      this.activeWorkers.add(worker);

      let stdout = "";
      let stderr = "";
      let stdioTruncated = false;
      let settled = false;

      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.activeWorkers.delete(worker);
        this.releaseWorkerSlot();
      };

      const timeout = setTimeout(() => {
        worker.kill("SIGTERM");
        setTimeout(() => {
          if (!worker.killed && worker.exitCode === null) {
            worker.kill("SIGKILL");
          }
        }, 1_000);
      }, workerTimeoutMs);

      worker.stdout.on("data", (chunk: Buffer | string) => {
        const appended = appendWithLimit(stdout, chunk.toString(), maxStdioChars);
        stdout = appended.value;
        stdioTruncated = stdioTruncated || appended.truncated;
      });

      worker.stderr.on("data", (chunk: Buffer | string) => {
        const appended = appendWithLimit(stderr, chunk.toString(), maxStdioChars);
        stderr = appended.value;
        stdioTruncated = stdioTruncated || appended.truncated;
      });

      worker.on("error", (error) => {
        cleanup();
        reject(error);
      });

      worker.on("close", (code) => {
        cleanup();
        if (code !== 0 && !stdout.trim()) {
          const reason = stderr.trim() || `isolated worker exited with code ${code}`;
          reject(new Error(reason));
          return;
        }
        if (stdioTruncated && !stdout.trim()) {
          reject(new Error("isolated worker output exceeded limit"));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as WorkerResponse;
          resolve(parsed);
        } catch (error) {
          this.logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
              code,
              stdout,
              stderr
            },
            "failed to parse isolated worker output"
          );
          reject(new Error("failed to parse isolated worker output"));
        }
      });

      worker.stdin.end(JSON.stringify(request));
    });
  }
}
