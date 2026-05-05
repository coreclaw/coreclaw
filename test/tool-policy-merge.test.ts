import test from "node:test";
import assert from "node:assert/strict";
import { mergeToolPolicies } from "../src/tools/policy-merge.js";

test("mergeToolPolicies preserves layered allow semantics for glob refinements", () => {
  const merged = mergeToolPolicies({ allow: ["fs.*"] }, { allow: ["fs.read"] });

  assert.deepEqual(merged.allow, ["fs.read"]);
  assert.deepEqual(merged.allowGroups, [["fs.*"], ["fs.read"]]);
});

test("mergeToolPolicies keeps disjoint allow layers restrictive", () => {
  const merged = mergeToolPolicies({ allow: ["fs.*"] }, { allow: ["memory.*"] });

  assert.deepEqual(merged.allow, []);
  assert.deepEqual(merged.allowGroups, [["fs.*"], ["memory.*"]]);
});
