import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ConfigSchema, type Config } from "./schema.js";

const parseCsv = (value?: string) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

const parseNumberCsv = (value?: string) => {
  const parsed = parseCsv(value);
  if (!parsed) {
    return undefined;
  }
  return parsed.map((item) => Number(item));
};

const readJsonIfExists = (filePath: string): Record<string, unknown> => {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const loadConfig = (): Config => {
  dotenv.config();
  const root = process.cwd();
  const configPath = path.join(root, "config.json");
  const fileConfig = readJsonIfExists(configPath);

  const envConfig: Record<string, unknown> = {
    securityProfile: process.env.CORECLAW_SECURITY_PROFILE,
    workspaceDir: process.env.CORECLAW_WORKSPACE,
    dataDir: process.env.CORECLAW_DATA_DIR,
    sqlitePath: process.env.CORECLAW_SQLITE_PATH,
    logLevel: process.env.CORECLAW_LOG_LEVEL,
    historyMaxMessages: process.env.CORECLAW_HISTORY_MAX
      ? Number(process.env.CORECLAW_HISTORY_MAX)
      : undefined,
    storeFullMessages: process.env.CORECLAW_STORE_FULL
      ? process.env.CORECLAW_STORE_FULL === "true"
      : undefined,
    maxToolIterations: process.env.CORECLAW_MAX_TOOL_ITER
      ? Number(process.env.CORECLAW_MAX_TOOL_ITER)
      : undefined,
    maxToolOutputChars: process.env.CORECLAW_MAX_TOOL_OUTPUT
      ? Number(process.env.CORECLAW_MAX_TOOL_OUTPUT)
      : undefined,
    skillsDir: process.env.CORECLAW_SKILLS_DIR,
    mcpConfigPath: process.env.CORECLAW_MCP_CONFIG,
    mcpSync: {
      failureBackoffBaseMs: process.env.CORECLAW_MCP_SYNC_BACKOFF_BASE_MS
        ? Number(process.env.CORECLAW_MCP_SYNC_BACKOFF_BASE_MS)
        : undefined,
      failureBackoffMaxMs: process.env.CORECLAW_MCP_SYNC_BACKOFF_MAX_MS
        ? Number(process.env.CORECLAW_MCP_SYNC_BACKOFF_MAX_MS)
        : undefined,
      openCircuitAfterFailures: process.env.CORECLAW_MCP_SYNC_OPEN_CIRCUIT_AFTER_FAILURES
        ? Number(process.env.CORECLAW_MCP_SYNC_OPEN_CIRCUIT_AFTER_FAILURES)
        : undefined,
      circuitResetMs: process.env.CORECLAW_MCP_SYNC_CIRCUIT_RESET_MS
        ? Number(process.env.CORECLAW_MCP_SYNC_CIRCUIT_RESET_MS)
        : undefined
    },
    heartbeat: {
      enabled: process.env.CORECLAW_HEARTBEAT_ENABLED
        ? process.env.CORECLAW_HEARTBEAT_ENABLED === "true"
        : undefined,
      intervalMs: process.env.CORECLAW_HEARTBEAT_INTERVAL_MS
        ? Number(process.env.CORECLAW_HEARTBEAT_INTERVAL_MS)
        : undefined,
      wakeDebounceMs: process.env.CORECLAW_HEARTBEAT_WAKE_DEBOUNCE_MS
        ? Number(process.env.CORECLAW_HEARTBEAT_WAKE_DEBOUNCE_MS)
        : undefined,
      wakeRetryMs: process.env.CORECLAW_HEARTBEAT_WAKE_RETRY_MS
        ? Number(process.env.CORECLAW_HEARTBEAT_WAKE_RETRY_MS)
        : undefined,
      promptPath: process.env.CORECLAW_HEARTBEAT_PROMPT_PATH,
      activeHours: process.env.CORECLAW_HEARTBEAT_ACTIVE_HOURS,
      skipWhenInboundBusy: process.env.CORECLAW_HEARTBEAT_SKIP_WHEN_INBOUND_BUSY
        ? process.env.CORECLAW_HEARTBEAT_SKIP_WHEN_INBOUND_BUSY === "true"
        : undefined,
      ackToken: process.env.CORECLAW_HEARTBEAT_ACK_TOKEN,
      suppressAck: process.env.CORECLAW_HEARTBEAT_SUPPRESS_ACK
        ? process.env.CORECLAW_HEARTBEAT_SUPPRESS_ACK === "true"
        : undefined,
      dedupeWindowMs: process.env.CORECLAW_HEARTBEAT_DEDUPE_WINDOW_MS
        ? Number(process.env.CORECLAW_HEARTBEAT_DEDUPE_WINDOW_MS)
        : undefined,
      maxDispatchPerRun: process.env.CORECLAW_HEARTBEAT_MAX_DISPATCH_PER_RUN
        ? Number(process.env.CORECLAW_HEARTBEAT_MAX_DISPATCH_PER_RUN)
        : undefined
    },
    bus: {
      pollMs: process.env.CORECLAW_BUS_POLL_MS
        ? Number(process.env.CORECLAW_BUS_POLL_MS)
        : undefined,
      batchSize: process.env.CORECLAW_BUS_BATCH_SIZE
        ? Number(process.env.CORECLAW_BUS_BATCH_SIZE)
        : undefined,
      maxAttempts: process.env.CORECLAW_BUS_MAX_ATTEMPTS
        ? Number(process.env.CORECLAW_BUS_MAX_ATTEMPTS)
        : undefined,
      retryBackoffMs: process.env.CORECLAW_BUS_RETRY_BACKOFF_MS
        ? Number(process.env.CORECLAW_BUS_RETRY_BACKOFF_MS)
        : undefined,
      maxRetryBackoffMs: process.env.CORECLAW_BUS_MAX_RETRY_BACKOFF_MS
        ? Number(process.env.CORECLAW_BUS_MAX_RETRY_BACKOFF_MS)
        : undefined,
      processingTimeoutMs: process.env.CORECLAW_BUS_PROCESSING_TIMEOUT_MS
        ? Number(process.env.CORECLAW_BUS_PROCESSING_TIMEOUT_MS)
        : undefined,
      maxPendingInbound: process.env.CORECLAW_BUS_MAX_PENDING_INBOUND
        ? Number(process.env.CORECLAW_BUS_MAX_PENDING_INBOUND)
        : undefined,
      maxPendingOutbound: process.env.CORECLAW_BUS_MAX_PENDING_OUTBOUND
        ? Number(process.env.CORECLAW_BUS_MAX_PENDING_OUTBOUND)
        : undefined,
      overloadPendingThreshold: process.env.CORECLAW_BUS_OVERLOAD_PENDING_THRESHOLD
        ? Number(process.env.CORECLAW_BUS_OVERLOAD_PENDING_THRESHOLD)
        : undefined,
      overloadBackoffMs: process.env.CORECLAW_BUS_OVERLOAD_BACKOFF_MS
        ? Number(process.env.CORECLAW_BUS_OVERLOAD_BACKOFF_MS)
        : undefined,
      perChatRateLimitWindowMs: process.env.CORECLAW_BUS_CHAT_RATE_WINDOW_MS
        ? Number(process.env.CORECLAW_BUS_CHAT_RATE_WINDOW_MS)
        : undefined,
      perChatRateLimitMax: process.env.CORECLAW_BUS_CHAT_RATE_MAX
        ? Number(process.env.CORECLAW_BUS_CHAT_RATE_MAX)
        : undefined
    },
    observability: {
      enabled: process.env.CORECLAW_OBS_ENABLED
        ? process.env.CORECLAW_OBS_ENABLED === "true"
        : undefined,
      reportIntervalMs: process.env.CORECLAW_OBS_REPORT_MS
        ? Number(process.env.CORECLAW_OBS_REPORT_MS)
        : undefined,
      http: {
        enabled: process.env.CORECLAW_OBS_HTTP_ENABLED
          ? process.env.CORECLAW_OBS_HTTP_ENABLED === "true"
          : undefined,
        host: process.env.CORECLAW_OBS_HTTP_HOST,
        port: process.env.CORECLAW_OBS_HTTP_PORT
          ? Number(process.env.CORECLAW_OBS_HTTP_PORT)
          : undefined
      }
    },
    slo: {
      enabled: process.env.CORECLAW_SLO_ENABLED
        ? process.env.CORECLAW_SLO_ENABLED === "true"
        : undefined,
      alertCooldownMs: process.env.CORECLAW_SLO_ALERT_COOLDOWN_MS
        ? Number(process.env.CORECLAW_SLO_ALERT_COOLDOWN_MS)
        : undefined,
      maxPendingQueue: process.env.CORECLAW_SLO_MAX_PENDING_QUEUE
        ? Number(process.env.CORECLAW_SLO_MAX_PENDING_QUEUE)
        : undefined,
      maxDeadLetterQueue: process.env.CORECLAW_SLO_MAX_DEAD_LETTER_QUEUE
        ? Number(process.env.CORECLAW_SLO_MAX_DEAD_LETTER_QUEUE)
        : undefined,
      maxToolFailureRate: process.env.CORECLAW_SLO_MAX_TOOL_FAILURE_RATE
        ? Number(process.env.CORECLAW_SLO_MAX_TOOL_FAILURE_RATE)
        : undefined,
      maxSchedulerDelayMs: process.env.CORECLAW_SLO_MAX_SCHEDULER_DELAY_MS
        ? Number(process.env.CORECLAW_SLO_MAX_SCHEDULER_DELAY_MS)
        : undefined,
      maxMcpFailureRate: process.env.CORECLAW_SLO_MAX_MCP_FAILURE_RATE
        ? Number(process.env.CORECLAW_SLO_MAX_MCP_FAILURE_RATE)
        : undefined,
      alertWebhookUrl: process.env.CORECLAW_SLO_ALERT_WEBHOOK_URL
    },
    isolation: {
      enabled: process.env.CORECLAW_ISOLATION_ENABLED
        ? process.env.CORECLAW_ISOLATION_ENABLED === "true"
        : undefined,
      toolNames: parseCsv(process.env.CORECLAW_ISOLATION_TOOLS),
      workerTimeoutMs: process.env.CORECLAW_ISOLATION_WORKER_TIMEOUT_MS
        ? Number(process.env.CORECLAW_ISOLATION_WORKER_TIMEOUT_MS)
        : undefined,
      maxWorkerOutputChars: process.env.CORECLAW_ISOLATION_MAX_WORKER_OUTPUT_CHARS
        ? Number(process.env.CORECLAW_ISOLATION_MAX_WORKER_OUTPUT_CHARS)
        : undefined,
      maxConcurrentWorkers: process.env.CORECLAW_ISOLATION_MAX_CONCURRENT_WORKERS
        ? Number(process.env.CORECLAW_ISOLATION_MAX_CONCURRENT_WORKERS)
        : undefined,
      openCircuitAfterFailures: process.env.CORECLAW_ISOLATION_OPEN_CIRCUIT_AFTER_FAILURES
        ? Number(process.env.CORECLAW_ISOLATION_OPEN_CIRCUIT_AFTER_FAILURES)
        : undefined,
      circuitResetMs: process.env.CORECLAW_ISOLATION_CIRCUIT_RESET_MS
        ? Number(process.env.CORECLAW_ISOLATION_CIRCUIT_RESET_MS)
        : undefined
    },
    allowShell: process.env.CORECLAW_ALLOW_SHELL
      ? process.env.CORECLAW_ALLOW_SHELL === "true"
      : undefined,
    allowedShellCommands: parseCsv(process.env.CORECLAW_SHELL_ALLOWLIST),
    allowedEnv: parseCsv(process.env.CORECLAW_ALLOWED_ENV),
    allowedWebDomains: parseCsv(process.env.CORECLAW_WEB_ALLOWLIST)?.map((item) =>
      item.toLowerCase().replace(/^\*\./, "")
    ),
    allowedWebPorts: parseNumberCsv(process.env.CORECLAW_WEB_ALLOWED_PORTS),
    blockedWebPorts: parseNumberCsv(process.env.CORECLAW_WEB_BLOCKED_PORTS),
    allowedMcpServers: parseCsv(process.env.CORECLAW_MCP_ALLOWED_SERVERS),
    allowedMcpTools: parseCsv(process.env.CORECLAW_MCP_ALLOWED_TOOLS),
    allowedChannelIdentities: parseCsv(process.env.CORECLAW_CHANNEL_ALLOWLIST),
    adminBootstrapKey: process.env.CORECLAW_ADMIN_BOOTSTRAP_KEY,
    adminBootstrapSingleUse: process.env.CORECLAW_ADMIN_BOOTSTRAP_SINGLE_USE
      ? process.env.CORECLAW_ADMIN_BOOTSTRAP_SINGLE_USE === "true"
      : undefined,
    adminBootstrapMaxAttempts: process.env.CORECLAW_ADMIN_BOOTSTRAP_MAX_ATTEMPTS
      ? Number(process.env.CORECLAW_ADMIN_BOOTSTRAP_MAX_ATTEMPTS)
      : undefined,
    adminBootstrapLockoutMinutes: process.env.CORECLAW_ADMIN_BOOTSTRAP_LOCKOUT_MINUTES
      ? Number(process.env.CORECLAW_ADMIN_BOOTSTRAP_LOCKOUT_MINUTES)
      : undefined,
    webhook: {
      enabled: process.env.CORECLAW_WEBHOOK_ENABLED
        ? process.env.CORECLAW_WEBHOOK_ENABLED === "true"
        : undefined,
      host: process.env.CORECLAW_WEBHOOK_HOST,
      port: process.env.CORECLAW_WEBHOOK_PORT
        ? Number(process.env.CORECLAW_WEBHOOK_PORT)
        : undefined,
      path: process.env.CORECLAW_WEBHOOK_PATH,
      authToken: process.env.CORECLAW_WEBHOOK_AUTH_TOKEN,
      maxBodyBytes: process.env.CORECLAW_WEBHOOK_MAX_BODY_BYTES
        ? Number(process.env.CORECLAW_WEBHOOK_MAX_BODY_BYTES)
        : undefined,
      outboxMaxPerChat: process.env.CORECLAW_WEBHOOK_OUTBOX_MAX_PER_CHAT
        ? Number(process.env.CORECLAW_WEBHOOK_OUTBOX_MAX_PER_CHAT)
        : undefined,
      outboxMaxChats: process.env.CORECLAW_WEBHOOK_OUTBOX_MAX_CHATS
        ? Number(process.env.CORECLAW_WEBHOOK_OUTBOX_MAX_CHATS)
        : undefined,
      outboxChatTtlMs: process.env.CORECLAW_WEBHOOK_OUTBOX_CHAT_TTL_MS
        ? Number(process.env.CORECLAW_WEBHOOK_OUTBOX_CHAT_TTL_MS)
        : undefined
    },
    provider: {
      type: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
      temperature: process.env.OPENAI_TEMPERATURE
        ? Number(process.env.OPENAI_TEMPERATURE)
        : undefined,
      timeoutMs: process.env.CORECLAW_PROVIDER_TIMEOUT_MS
        ? Number(process.env.CORECLAW_PROVIDER_TIMEOUT_MS)
        : process.env.OPENAI_TIMEOUT_MS
          ? Number(process.env.OPENAI_TIMEOUT_MS)
          : undefined,
      maxInputTokens: process.env.CORECLAW_PROVIDER_MAX_INPUT_TOKENS
        ? Number(process.env.CORECLAW_PROVIDER_MAX_INPUT_TOKENS)
        : undefined,
      reserveOutputTokens: process.env.CORECLAW_PROVIDER_RESERVE_OUTPUT_TOKENS
        ? Number(process.env.CORECLAW_PROVIDER_RESERVE_OUTPUT_TOKENS)
        : undefined
    }
  };

  const parsed = ConfigSchema.safeParse({
    ...fileConfig,
    ...envConfig,
    bus: {
      ...(typeof fileConfig.bus === "object" ? fileConfig.bus : {}),
      ...(typeof envConfig.bus === "object" ? envConfig.bus : {})
    },
    observability: {
      ...(typeof fileConfig.observability === "object"
        ? fileConfig.observability
        : {}),
      ...(typeof envConfig.observability === "object"
        ? envConfig.observability
        : {}),
      http: {
        ...((typeof (fileConfig.observability as any)?.http === "object"
          ? (fileConfig.observability as any).http
          : {}) as Record<string, unknown>),
        ...((typeof (envConfig.observability as any)?.http === "object"
          ? (envConfig.observability as any).http
          : {}) as Record<string, unknown>)
      }
    },
    slo: {
      ...(typeof fileConfig.slo === "object" ? fileConfig.slo : {}),
      ...(typeof envConfig.slo === "object" ? envConfig.slo : {})
    },
    isolation: {
      ...(typeof fileConfig.isolation === "object" ? fileConfig.isolation : {}),
      ...(typeof envConfig.isolation === "object" ? envConfig.isolation : {})
    },
    mcpSync: {
      ...(typeof fileConfig.mcpSync === "object" ? fileConfig.mcpSync : {}),
      ...(typeof envConfig.mcpSync === "object" ? envConfig.mcpSync : {})
    },
    heartbeat: {
      ...(typeof fileConfig.heartbeat === "object" ? fileConfig.heartbeat : {}),
      ...(typeof envConfig.heartbeat === "object" ? envConfig.heartbeat : {})
    },
    webhook: {
      ...(typeof fileConfig.webhook === "object" ? fileConfig.webhook : {}),
      ...(typeof envConfig.webhook === "object" ? envConfig.webhook : {})
    },
    provider: {
      ...(typeof fileConfig.provider === "object" ? fileConfig.provider : {}),
      ...(typeof envConfig.provider === "object" ? envConfig.provider : {})
    }
  });

  if (!parsed.success) {
    throw new Error(`Invalid config: ${parsed.error.message}`);
  }

  return parsed.data;
};
