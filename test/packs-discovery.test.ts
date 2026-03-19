import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorkclawPackManifestJson } from "../src/packs/schema.js";
import { discoverWorkclawPacks } from "../src/packs/discovery.js";
import {
  mergePackEnvRequirements,
  mergePackToolPolicies,
  resolveEffectivePackGraph
} from "../src/packs/graph.js";
import type { DiscoveredWorkclawPack } from "../src/packs/types.js";
import { createConfig } from "./test-utils.js";

const writePack = (
  rootDir: string,
  manifest: Record<string, unknown>
): string => {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "workclaw.pack.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  return rootDir;
};

test("parseWorkclawPackManifestJson accepts a valid pack manifest", () => {
  const manifest = parseWorkclawPackManifestJson(
    JSON.stringify({
      id: "engineering-common",
      type: "role-pack",
      description: "Shared engineering defaults"
    })
  );
  assert.equal(manifest.id, "engineering-common");
  assert.equal(manifest.type, "role-pack");
});

test("parseWorkclawPackManifestJson rejects invalid manifest JSON", () => {
  assert.throws(() => parseWorkclawPackManifestJson("{"), /Invalid pack manifest JSON/);
});

test("discoverWorkclawPacks rejects manifest paths that escape the pack root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-discovery-"));
  try {
    const workspaceDir = path.join(root, "workspace");
    const dataDir = path.join(root, "data");
    const packsRoot = path.join(root, "packs");
    writePack(path.join(packsRoot, "bad-pack"), {
      id: "bad-pack",
      type: "role-pack",
      description: "bad",
      skills: ["../escape"]
    });
    const config = createConfig(workspaceDir, dataDir, {
      packs: {
        enabledRoots: [packsRoot]
      }
    });

    assert.throws(() => discoverWorkclawPacks(config, { instanceRoot: root }), /escapes pack root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveEffectivePackGraph preserves root order and resolves extends before local packs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-graph-"));
  try {
    const workspaceDir = path.join(root, "workspace");
    const dataDir = path.join(root, "data");
    const packsRoot = path.join(root, "packs");
    writePack(path.join(packsRoot, "A"), {
      id: "a-pack",
      type: "role-pack",
      description: "A"
    });
    writePack(path.join(packsRoot, "X"), {
      id: "x-pack",
      type: "role-pack",
      description: "X"
    });
    writePack(path.join(packsRoot, "B"), {
      id: "b-pack",
      type: "role-pack",
      description: "B",
      extends: ["x-pack"]
    });
    writePack(path.join(packsRoot, "Y"), {
      id: "y-pack",
      type: "role-pack",
      description: "Y"
    });
    writePack(path.join(packsRoot, "Z"), {
      id: "z-pack",
      type: "role-pack",
      description: "Z"
    });
    writePack(path.join(packsRoot, "C"), {
      id: "c-pack",
      type: "role-pack",
      description: "C",
      extends: ["y-pack", "z-pack"]
    });

    const config = createConfig(workspaceDir, dataDir, {
      packs: {
        enabledRoots: [packsRoot]
      }
    });
    const discovered = discoverWorkclawPacks(config, { instanceRoot: root });
    const resolved = resolveEffectivePackGraph(discovered, ["a-pack", "b-pack", "c-pack"]);
    assert.deepEqual(
      resolved.map((pack) => pack.id),
      ["a-pack", "x-pack", "b-pack", "y-pack", "z-pack", "c-pack"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveEffectivePackGraph rejects extends cycles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-pack-cycle-"));
  try {
    const workspaceDir = path.join(root, "workspace");
    const dataDir = path.join(root, "data");
    const packsRoot = path.join(root, "packs");
    writePack(path.join(packsRoot, "A"), {
      id: "a-pack",
      type: "role-pack",
      description: "A",
      extends: ["b-pack"]
    });
    writePack(path.join(packsRoot, "B"), {
      id: "b-pack",
      type: "role-pack",
      description: "B",
      extends: ["a-pack"]
    });

    const config = createConfig(workspaceDir, dataDir, {
      packs: {
        enabledRoots: [packsRoot]
      }
    });
    const discovered = discoverWorkclawPacks(config, { instanceRoot: root });
    assert.throws(() => resolveEffectivePackGraph(discovered, ["a-pack"]), /cycle detected/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pack env and tool policy merges are deterministic", () => {
  const graph: DiscoveredWorkclawPack[] = [
    {
      id: "base-pack",
      rootDir: "/tmp/base",
      sourceRoot: "/tmp",
      manifestPath: "/tmp/base/workclaw.pack.json",
      allowed: true,
      warnings: [],
      skillRoots: [],
      mcpFragments: [],
      templateRoots: [],
      bootstrapEntries: [],
      manifest: {
        id: "base-pack",
        type: "role-pack",
        description: "base",
        env: [{ name: "OPENAI_API_KEY", required: true, secret: true }],
        toolPolicy: { allow: ["group:web", "group:memory"], deny: ["shell.exec"] }
      }
    },
    {
      id: "child-pack",
      rootDir: "/tmp/child",
      sourceRoot: "/tmp",
      manifestPath: "/tmp/child/workclaw.pack.json",
      allowed: true,
      warnings: [],
      skillRoots: [],
      mcpFragments: [],
      templateRoots: [],
      bootstrapEntries: [],
      manifest: {
        id: "child-pack",
        type: "role-pack",
        description: "child",
        env: [{ name: "OPENAI_API_KEY", required: false, secret: true }],
        toolPolicy: { allow: ["group:web"], deny: ["fs.write"], elevated: { enabled: false } }
      }
    }
  ];

  assert.deepEqual(mergePackEnvRequirements(graph), [
    { name: "OPENAI_API_KEY", required: false, secret: true }
  ]);
  assert.deepEqual(mergePackToolPolicies(graph), {
    allow: ["group:web"],
    deny: ["shell.exec", "fs.write"],
    elevated: { enabled: false }
  });
});
