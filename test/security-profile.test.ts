import test from "node:test";
import assert from "node:assert/strict";
import { createStorageFixture } from "./test-utils.js";
import { enforceSecurityProfile } from "../src/security/gate.js";

test("hardened profile rejects allowShell=true", () => {
  const fixture = createStorageFixture({
    securityProfile: "hardened",
    allowShell: true,
    allowedWebDomains: ["example.com"]
  });
  try {
    assert.throws(() => enforceSecurityProfile(fixture.config), /forbids allowShell/);
  } finally {
    fixture.cleanup();
  }
});

test("hardened profile requires web allowlist", () => {
  const fixture = createStorageFixture({
    securityProfile: "hardened"
  });
  try {
    assert.throws(() => enforceSecurityProfile(fixture.config), /requires CORECLAW_WEB_ALLOWLIST/);
  } finally {
    fixture.cleanup();
  }
});

test("hardened profile requires loopback webhook host and auth token", () => {
  const fixture = createStorageFixture({
    securityProfile: "hardened",
    allowedWebDomains: ["example.com"],
    webhook: {
      enabled: true,
      host: "0.0.0.0"
    }
  });
  try {
    assert.throws(() => enforceSecurityProfile(fixture.config), /webhook.host/);

    fixture.config.webhook.host = "127.0.0.1";
    assert.throws(() => enforceSecurityProfile(fixture.config), /webhook.authToken/);
  } finally {
    fixture.cleanup();
  }
});

test("hardened profile requires loopback observability host", () => {
  const fixture = createStorageFixture({
    securityProfile: "hardened",
    allowedWebDomains: ["example.com"],
    observability: {
      http: {
        enabled: true,
        host: "0.0.0.0"
      }
    }
  });
  try {
    assert.throws(() => enforceSecurityProfile(fixture.config), /observability\.http\.host/);
  } finally {
    fixture.cleanup();
  }
});

test("hardened profile passes with safe config", () => {
  const fixture = createStorageFixture({
    securityProfile: "hardened",
    allowedWebDomains: ["example.com"],
    webhook: {
      enabled: true,
      host: "127.0.0.1",
      authToken: "token"
    },
    observability: {
      http: {
        enabled: true,
        host: "127.0.0.1"
      }
    }
  });
  try {
    assert.doesNotThrow(() => enforceSecurityProfile(fixture.config));
  } finally {
    fixture.cleanup();
  }
});
