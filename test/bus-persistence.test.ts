import test from "node:test";
import assert from "node:assert/strict";
import { MessageBus } from "../src/bus/bus.js";
import { createStorageFixture } from "./test-utils.js";

const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 2_500,
  intervalMs = 25
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
};

test("MessageBus retries failed inbound messages and eventually processes them", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    let calls = 0;
    bus.onInbound(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("fail once");
      }
    });

    bus.publishInbound({
      id: "msg-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "hello",
      createdAt: new Date().toISOString()
    });

    bus.start();
    await waitUntil(() => calls >= 2);

    const counts = fixture.storage.countBusMessagesByStatus("inbound");
    assert.equal(counts.processed, 1);
    assert.equal(counts.dead_letter, 0);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus moves repeatedly failing messages to dead-letter", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 2,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    bus.onInbound(async () => {
      throw new Error("always fails");
    });

    bus.publishInbound({
      id: "msg-2",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "dead",
      createdAt: new Date().toISOString()
    });

    bus.start();
    await waitUntil(() => fixture.storage.countBusMessagesByStatus("inbound").dead_letter >= 1);

    const dead = fixture.storage.listDeadLetterBusMessages("inbound", 10);
    assert.equal(dead.length, 1);
    assert.match(dead[0]?.lastError ?? "", /always fails/);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus recovers stale processing messages on startup", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 20
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    const queued = fixture.storage.enqueueBusMessage({
      direction: "inbound",
      payload: {
        id: "msg-3",
        channel: "cli",
        chatId: "local",
        senderId: "user",
        content: "recover",
        createdAt: new Date().toISOString()
      },
      maxAttempts: 3
    });
    fixture.storage.claimBusMessage(
      queued.queueId,
      new Date(Date.now() - 2_000).toISOString()
    );

    let calls = 0;
    bus.onInbound(async () => {
      calls += 1;
    });

    bus.start();
    await waitUntil(() => calls >= 1);
    assert.equal(fixture.storage.countBusMessagesByStatus("inbound").processed, 1);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus deduplicates inbound publishes by message id", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    let calls = 0;
    bus.onInbound(async () => {
      calls += 1;
    });

    const message = {
      id: "msg-dup-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "hello",
      createdAt: new Date().toISOString()
    };
    bus.publishInbound(message);
    bus.publishInbound(message);

    bus.start();
    await waitUntil(() => calls >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(calls, 1);
    const counts = fixture.storage.countBusMessagesByStatus("inbound");
    assert.equal(counts.processed, 1);
    assert.equal(counts.pending, 0);
    assert.equal(counts.processing, 0);
    assert.equal(counts.dead_letter, 0);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus deduplicates outbound publishes by message id", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    let calls = 0;
    bus.onOutbound(async () => {
      calls += 1;
    });

    const message = {
      id: "out-dup-1",
      channel: "cli",
      chatId: "local",
      content: "hello",
      createdAt: new Date().toISOString()
    };
    bus.publishOutbound(message);
    bus.publishOutbound(message);

    bus.start();
    await waitUntil(() => calls >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(calls, 1);
    const counts = fixture.storage.countBusMessagesByStatus("outbound");
    assert.equal(counts.processed, 1);
    assert.equal(counts.pending, 0);
    assert.equal(counts.processing, 0);
    assert.equal(counts.dead_letter, 0);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus times out stuck inbound handler and continues with next message", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 1,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 60
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    let processed = 0;
    bus.onInbound(async (message) => {
      if (message.id === "msg-hang-1") {
        await new Promise(() => undefined);
      }
      processed += 1;
    });

    bus.publishInbound({
      id: "msg-hang-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "hang",
      createdAt: new Date().toISOString()
    });
    bus.publishInbound({
      id: "msg-ok-2",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "ok",
      createdAt: new Date().toISOString()
    });

    bus.start();
    await waitUntil(() => processed >= 1);
    await waitUntil(() => fixture.storage.countBusMessagesByStatus("inbound").dead_letter >= 1);

    const counts = fixture.storage.countBusMessagesByStatus("inbound");
    assert.equal(counts.processed, 1);
    assert.equal(counts.dead_letter, 1);
    const dead = fixture.storage.listDeadLetterBusMessages("inbound", 10);
    assert.match(dead[0]?.lastError ?? "", /timed out/i);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus dead-letters new inbound messages when queue is full", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 1,
      maxPendingOutbound: 10,
      overloadPendingThreshold: 9,
      overloadBackoffMs: 50,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 100
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    bus.publishInbound({
      id: "bp-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "first",
      createdAt: new Date().toISOString()
    });
    bus.publishInbound({
      id: "bp-2",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "second",
      createdAt: new Date().toISOString()
    });

    const counts = fixture.storage.countBusMessagesByStatus("inbound");
    assert.equal(counts.pending, 1);
    assert.equal(counts.dead_letter, 1);
    const dead = fixture.storage.listDeadLetterBusMessages("inbound", 10);
    assert.equal(dead.length, 1);
    assert.match(dead[0]?.lastError ?? "", /Queue overflow/);
  } finally {
    fixture.cleanup();
  }
});

test("MessageBus applies overload backoff delay before dispatching", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 100,
      maxPendingOutbound: 100,
      overloadPendingThreshold: 1,
      overloadBackoffMs: 250,
      perChatRateLimitWindowMs: 60_000,
      perChatRateLimitMax: 100
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    let calls = 0;
    bus.onInbound(async () => {
      calls += 1;
    });

    bus.publishInbound({
      id: "ol-1",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "one",
      createdAt: new Date().toISOString()
    });
    bus.publishInbound({
      id: "ol-2",
      channel: "cli",
      chatId: "local",
      senderId: "user",
      content: "two",
      createdAt: new Date().toISOString()
    });

    bus.start();
    await waitUntil(() => calls >= 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 1);
    await waitUntil(() => calls >= 2, 2_000);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});

test("MessageBus enforces per-chat inbound rate limit", async () => {
  const fixture = createStorageFixture({
    bus: {
      pollMs: 20,
      batchSize: 10,
      maxAttempts: 3,
      retryBackoffMs: 10,
      maxRetryBackoffMs: 100,
      processingTimeoutMs: 500,
      maxPendingInbound: 100,
      maxPendingOutbound: 100,
      overloadPendingThreshold: 80,
      overloadBackoffMs: 10,
      perChatRateLimitWindowMs: 10_000,
      perChatRateLimitMax: 1
    }
  });

  const bus = new MessageBus(fixture.storage, fixture.config);
  try {
    let calls = 0;
    bus.onInbound(async () => {
      calls += 1;
    });

    bus.publishInbound({
      id: "rl-1",
      channel: "cli",
      chatId: "same",
      senderId: "user",
      content: "one",
      createdAt: new Date().toISOString()
    });
    bus.publishInbound({
      id: "rl-2",
      channel: "cli",
      chatId: "same",
      senderId: "user",
      content: "two",
      createdAt: new Date().toISOString()
    });

    bus.start();
    await waitUntil(() => calls >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(calls, 1);
    const counts = fixture.storage.countBusMessagesByStatus("inbound");
    assert.equal(counts.processed, 1);
    assert.equal(counts.dead_letter, 1);
    const dead = fixture.storage.listDeadLetterBusMessages("inbound", 10);
    assert.equal(dead.length, 1);
    assert.match(dead[0]?.lastError ?? "", /Rate limit exceeded/);
  } finally {
    bus.stop();
    fixture.cleanup();
  }
});
