import assert from "node:assert/strict";
import test from "node:test";
import { prepareRelease } from "../scripts/prepare-svw-release.mjs";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
const d = "d".repeat(64);

function state() {
  return {
    root: {
      name: "dsh-svw-waveform", version: "0.1.0", svwRelease: "release-0.1.0",
      svwArtifacts: {
        "linux-x64": { asset: "svw-release-0.1.0-linux-x64.tar.gz", archiveSha256: a, binarySha256: b },
        "macos-arm64": { asset: "svw-release-0.1.0-macos-arm64.tar.gz", archiveSha256: c, binarySha256: d },
      },
      optionalDependencies: {
        "dsh-svw-waveform-linux-x64": "0.1.0",
        "dsh-svw-waveform-darwin-arm64": "0.1.0",
      },
    },
    linux: { manifest: { version: "0.1.0" }, provenance: {} },
    darwin: { manifest: { version: "0.1.0" }, provenance: {} },
  };
}

test("an identical dispatch is idempotent", () => {
  const result = prepareRelease(state(), "release-0.1.0", {
    "linux-x64": { archiveSha256: a, binarySha256: b },
    "macos-arm64": { archiveSha256: c, binarySha256: d },
  });
  assert.equal(result.changed, false);
});

test("a new release advances every package atomically", () => {
  const value = state();
  const result = prepareRelease(value, "release-0.2.0", {
    "linux-x64": { archiveSha256: b, binarySha256: c },
    "macos-arm64": { archiveSha256: d, binarySha256: a },
  });
  assert.equal(result.packageVersion, "0.1.1");
  assert.equal(value.root.version, "0.1.1");
  assert.equal(value.linux.manifest.version, "0.1.1");
  assert.equal(value.darwin.manifest.version, "0.1.1");
  assert.equal(value.root.optionalDependencies["dsh-svw-waveform-linux-x64"], "0.1.1");
});

test("replaced assets under the same tag create a new package version", () => {
  const value = state();
  const result = prepareRelease(value, "release-0.1.0", {
    "linux-x64": { archiveSha256: b, binarySha256: c },
    "macos-arm64": { archiveSha256: c, binarySha256: d },
  });
  assert.equal(result.changed, true);
  assert.equal(result.packageVersion, "0.1.1");
});

test("older and malformed releases do not downgrade the package", () => {
  const value = state();
  assert.equal(prepareRelease(value, "release-0.0.9", {}).skippedOlder, true);
  assert.throws(() => prepareRelease(value, "latest", {}), /release-MAJOR/);
});
