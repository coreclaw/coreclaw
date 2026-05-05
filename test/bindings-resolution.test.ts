import test from "node:test";
import assert from "node:assert/strict";
import { resolveBinding } from "../src/bindings/resolve.js";
import { renderBindingTemplate } from "../src/bindings/template.js";
import { getBindingTier } from "../src/bindings/match.js";
import { WorkclawBindingActionSchema, WorkclawBindingPolicySchema } from "../src/bindings/schema.js";

const event = {
  id: "evt-1",
  surface: "gitlab",
  event: "merge_request.opened",
  sourceKey: "gitlab:group/project",
  projectKey: "core-api",
  repoKey: "group/project",
  threadKey: "mr:42",
  senderKey: "user:alice",
  channelKey: "gitlab:group/project",
  createdAt: new Date().toISOString(),
  payload: {
    mergeRequestIid: 42,
    nested: { id: "nested-1" }
  }
} as const;

test("renderBindingTemplate resolves event and payload placeholders", () => {
  assert.equal(renderBindingTemplate("gitlab:mr:${payload.mergeRequestIid}", event), "gitlab:mr:42");
  assert.equal(renderBindingTemplate("${payload.nested.id}", event), "nested-1");
});

test("renderBindingTemplate fails on missing keys", () => {
  assert.throws(
    () => renderBindingTemplate("${payload.missing}", event),
    /missing key: payload.missing/
  );
});

test("resolveBinding prefers exact thread key tier", () => {
  const resolved = resolveBinding(event, [
    {
      id: "surface-match",
      profileId: "dev",
      match: { surface: "gitlab", event: "merge_request.opened" }
    },
    {
      id: "thread-match",
      profileId: "qa",
      match: { threadKey: "mr:42" }
    }
  ]);
  assert.equal(resolved?.bindingId, "thread-match");
  assert.equal(resolved?.tier, 1);
});

test("resolveBinding uses config order as tie-break inside one tier", () => {
  const bindings = [
    {
      id: "first",
      profileId: "dev",
      match: { repoKey: "group/project", event: "merge_request.opened" }
    },
    {
      id: "second",
      profileId: "qa",
      match: { repoKey: "group/project", event: "merge_request.opened" }
    }
  ];
  assert.equal(resolveBinding(event, bindings)?.bindingId, "first");
});

test("resolveBinding ignores disabled bindings and supports hint narrowing", () => {
  const bindings = [
    {
      id: "disabled",
      enabled: false,
      profileId: "dev",
      match: { surface: "gitlab", event: "merge_request.opened" }
    },
    {
      id: "pm-route",
      profileId: "pm",
      match: { surface: "gitlab", event: "merge_request.opened" }
    },
    {
      id: "qa-route",
      profileId: "qa",
      match: { surface: "gitlab", event: "merge_request.opened" }
    }
  ];
  assert.equal(resolveBinding(event, bindings)?.bindingId, "pm-route");
  assert.equal(resolveBinding(event, bindings, { profileId: "qa" })?.bindingId, "qa-route");
});

test("resolveBinding computes final action and outbound suppression", () => {
  const resolved = resolveBinding(
    event,
    [
      {
        id: "gitlab-mr",
        profileId: "dev",
        match: { repoKey: "group/project", event: "merge_request.opened" },
        action: {
          mode: "conversation",
          threadKeyTemplate: "gitlab:mr:${payload.mergeRequestIid}",
          outbound: {
            targetMode: "explicit-target",
            channelKeyTemplate: "gitlab:${repoKey}"
          }
        }
      }
    ],
    { suppressOutbound: true }
  );

  assert.equal(resolved?.conversationKey, "gitlab:mr:42");
  assert.equal(resolved?.action.outbound.targetMode, "none");
});

test("WorkclawBindingPolicySchema rejects misplaced no-match policy", () => {
  assert.throws(
    () => WorkclawBindingPolicySchema.parse({ onNoMatch: "warn" }),
    /Unrecognized key/
  );
});

test("WorkclawBindingActionSchema rejects unimplemented task enqueue mode", () => {
  assert.throws(
    () => WorkclawBindingActionSchema.parse({ mode: "task-enqueue" }),
    /Invalid option/
  );
});

test("getBindingTier follows documented precedence", () => {
  assert.equal(getBindingTier({ id: "a", profileId: "dev", match: { threadKey: "mr:42" } }), 1);
  assert.equal(
    getBindingTier({ id: "b", profileId: "dev", match: { repoKey: "group/project", event: "merge_request.opened" } }),
    2
  );
  assert.equal(
    getBindingTier({ id: "c", profileId: "dev", match: { projectKey: "core-api", event: "merge_request.opened" } }),
    3
  );
  assert.equal(getBindingTier({ id: "d", profileId: "dev", match: { surface: "gitlab", event: "merge_request.opened" } }), 4);
  assert.equal(getBindingTier({ id: "e", profileId: "dev", match: { surface: "gitlab" } }), 5);
  assert.equal(getBindingTier({ id: "f", profileId: "dev", match: {} }), 6);
});
