import assert from "node:assert/strict";
import test from "node:test";
import { platformPackageName, resolveSvwBinary } from "../lib/resolve-svw.js";

test("maps only supported platform packages", () => {
  assert.equal(platformPackageName("linux", "x64"), "dsh-svw-waveform-linux-x64");
  assert.equal(platformPackageName("darwin", "arm64"), "dsh-svw-waveform-darwin-arm64");
  assert.equal(platformPackageName("win32", "x64"), undefined);
});

test("SVW_BIN takes precedence", () => {
  assert.equal(resolveSvwBinary({ env: { SVW_BIN: "/custom/svw" } }), "/custom/svw");
});

test("resolves the package-private executable", () => {
  const result = resolveSvwBinary({
    env: {},
    platform: "linux",
    arch: "x64",
    resolvePackage: () => "/packages/linux/package.json",
    exists: (path) => path === "/packages/linux/bin/svw",
  });
  assert.equal(result, "/packages/linux/bin/svw");
});

test("falls back to Homebrew and then PATH", () => {
  assert.equal(resolveSvwBinary({
    env: {}, platform: "darwin", arch: "arm64",
    resolvePackage: () => { const error = new Error("missing"); error.code = "MODULE_NOT_FOUND"; throw error; },
    exists: (path) => path === "/opt/homebrew/bin/svw",
  }), "/opt/homebrew/bin/svw");
  assert.equal(resolveSvwBinary({
    env: {}, platform: "linux", arch: "arm64",
    resolvePackage: () => { throw new Error("must not resolve unsupported package"); },
    exists: () => false,
  }), "svw");
});
