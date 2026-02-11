import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ToolCall } from "../src/types.js";
import {
  AgentRuntime,
  OpenAICompatibleProvider,
  type LlmProvider
} from "../src/agent/runtime.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createStorageFixture, createToolContext } from "./test-utils.js";

test("OpenAICompatibleProvider aborts hung requests by timeout", async () => {
  const fixture = createStorageFixture({
    provider: {
      timeoutMs: 30
    }
  });
  try {
    const fetchNever: typeof fetch = async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const error = new Error("aborted");
          (error as Error & { name: string }).name = "AbortError";
          reject(error);
        };
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    };
    const provider = new OpenAICompatibleProvider(fixture.config, fetchNever);
    await assert.rejects(
      provider.chat({
        model: fixture.config.provider.model,
        messages: [{ role: "user", content: "ping" }]
      }),
      /Provider request timed out after 30ms/
    );
  } finally {
    fixture.cleanup();
  }
});

test("OpenAICompatibleProvider validates response schema", async () => {
  const fixture = createStorageFixture();
  try {
    const fetchInvalid: typeof fetch = async () =>
      new Response(JSON.stringify({ notChoices: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    const provider = new OpenAICompatibleProvider(fixture.config, fetchInvalid);
    await assert.rejects(
      provider.chat({
        model: fixture.config.provider.model,
        messages: [{ role: "user", content: "ping" }]
      }),
      /Invalid provider response/
    );
  } finally {
    fixture.cleanup();
  }
});

test("OpenAICompatibleProvider parses tool calls and content parts", async () => {
  const fixture = createStorageFixture();
  try {
    const fetchValid: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ type: "output_text", text: "hello" }, { text: "world" }],
                tool_calls: [
                  {
                    id: "call-1",
                    function: {
                      name: "memory.write",
                      arguments: "{\"scope\":\"chat\",\"content\":\"x\"}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    const provider = new OpenAICompatibleProvider(fixture.config, fetchValid);
    const result = await provider.chat({
      model: fixture.config.provider.model,
      messages: [{ role: "user", content: "ping" }]
    });

    assert.equal(result.content, "hello\nworld");
    assert.deepEqual(result.toolCalls, [
      {
        id: "call-1",
        name: "memory.write",
        args: {
          scope: "chat",
          content: "x"
        }
      }
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("AgentRuntime enforces timeout guard even for custom provider", async () => {
  const fixture = createStorageFixture({
    provider: {
      timeoutMs: 30
    }
  });
  try {
    const hangingProvider: LlmProvider = {
      chat: async (_req: {
        model: string;
        messages: ChatMessage[];
        tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
        temperature?: number;
      }): Promise<{ content?: string; toolCalls?: ToolCall[] }> => {
        return await new Promise(() => undefined);
      }
    };
    const runtime = new AgentRuntime(
      hangingProvider,
      new ToolRegistry(),
      fixture.config,
      {
        fatal: () => undefined,
        error: () => undefined,
        warn: () => undefined,
        info: () => undefined,
        debug: () => undefined,
        trace: () => undefined,
        child: () =>
          ({
            fatal: () => undefined,
            error: () => undefined,
            warn: () => undefined,
            info: () => undefined,
            debug: () => undefined,
            trace: () => undefined
          }) as any
      } as any
    );
    const chat = fixture.storage.upsertChat({ channel: "cli", chatId: "local" });
    const { context } = createToolContext({
      config: fixture.config,
      storage: fixture.storage,
      workspaceDir: fixture.workspaceDir,
      chatFk: chat.id,
      chatRole: "admin"
    });
    await assert.rejects(
      runtime.run({
        messages: [{ role: "user", content: "ping" }],
        toolContext: context
      }),
      /LLM call timed out after 30ms/
    );
  } finally {
    fixture.cleanup();
  }
});
