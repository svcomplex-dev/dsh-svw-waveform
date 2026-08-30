import assert from "node:assert/strict";
import test from "node:test";
import { transformIntegration } from "../scripts/sync-svw-integration.mjs";

const client = 'analysis. Keeps rendering format-agnostic — VCD/FST/VENDOR_A/VENDOR_B all arrive\n' +
  'id: "svw-dsh-waveform",\n';
const skill = `header

## FSDB inputs: install and activate the bridge first

FSDB setup

## Workflow

When an FSDB/adapter supplies a packed struct.

An FSDB bridge activation/configuration failure is missing.
the FSDB path is not recovery.

validated complete runtime-write stream; VCD/FST/VENDOR_A correctly remains
`;

test("adapts the current packaged resolver without stripping its source implementation", () => {
  const result = transformIntegration({
    index: 'import { execFile } from "node:child_process";\n' +
      'description: "VCD, FST, VENDOR_A, or VENDOR_B waveform path",\n' +
      'function resolveSvwBinary() { return "svw"; }\n' +
      'const binary = resolveSvwBinary();\n',
    client,
    skill,
  });
  assert.match(result.host, /resolvePackagedSvwBinary\(\)/);
  assert.match(result.host, /function resolveSvwBinary\(\)/);
  assert.match(result.browser, /id: "dsh-svw-waveform"/);
  assert.doesNotMatch(`${result.host}${result.browser}${result.skill}`, /VENDOR_A|VENDOR_B|FSDB/);
});

test("still accepts the reviewed legacy resolver source", () => {
  const result = transformIntegration({
    index: 'import { execFile } from "node:child_process";\n' +
      'description: "VCD, FST, VENDOR_A, or VENDOR_B waveform path",\n' +
      'const binary = process.env.SVW_BIN?.trim() || "svw";\n',
    client,
    skill,
  });
  assert.match(result.host, /resolvePackagedSvwBinary\(\)/);
});

test("upstream drift fails closed", () => {
  assert.throws(() => transformIntegration({ index: "changed", client: "changed", skill: "changed" }),
    /exactly one/);
});
