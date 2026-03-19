import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { discoverWorkclawPlugins, NativePluginRegistry } from "../src/plugins/registry.js";
import { parseWorkclawPluginManifest } from "../src/plugins/schema.js";

test("parseWorkclawPluginManifest validates strict plugin manifests", () => {
  const manifest = parseWorkclawPluginManifest(
    JSON.stringify({
      id: "plugin-review",
      name: "Plugin Review",
      description: "review plugin",
      configSchema: "config.schema.json"
    })
  );
  assert.equal(manifest.id, "plugin-review");
});

test("discoverWorkclawPlugins rejects plugin config schemas that escape root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-plugin-discovery-"));
  try {
    const pluginRoot = path.join(root, "bad-plugin");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "workclaw.plugin.json"),
      JSON.stringify({
        id: "bad-plugin",
        name: "Bad Plugin",
        description: "bad",
        configSchema: "../escape.json"
      }),
      "utf-8"
    );
    assert.throws(() => discoverWorkclawPlugins([root]), /escapes plugin root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NativePluginRegistry only loads explicitly trusted plugins", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workclaw-plugin-runtime-"));
  try {
    const pluginRoot = path.join(root, "trusted-plugin");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "config.schema.json"), JSON.stringify({ type: "object" }), "utf-8");
    fs.writeFileSync(
      path.join(pluginRoot, "workclaw.plugin.json"),
      JSON.stringify({
        id: "trusted-plugin",
        name: "Trusted Plugin",
        description: "trusted",
        configSchema: "config.schema.json"
      }),
      "utf-8"
    );
    fs.writeFileSync(path.join(pluginRoot, "index.js"), "export const marker = 'loaded';\n", "utf-8");

    const plugin = discoverWorkclawPlugins([root])[0]!;
    const registry = new NativePluginRegistry();
    await assert.rejects(() => registry.loadTrustedPlugin(plugin, []), /not trusted/);
    const loaded = (await registry.loadTrustedPlugin(plugin, ["trusted-plugin"])) as {
      marker: string;
    };
    assert.equal(loaded.marker, "loaded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
