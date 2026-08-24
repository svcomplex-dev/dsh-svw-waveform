import assert from "node:assert/strict";
import test from "node:test";
import { transformIntegration } from "../scripts/sync-svw-integration.mjs";

test("applies only the reviewed downstream transforms", () => {
  const result = transformIntegration({
    index: 'import { execFile } from "node:child_process";\n' +
      'description: "VCD, FST, VENDOR_A, or VENDOR_B waveform path",\n' +
      'const binary = process.env.SVW_BIN?.trim() || "svw";\n',
    client: 'analysis. Keeps rendering format-agnostic — VCD/FST/VENDOR_A/VENDOR_B all arrive\n' +
      'id: "svw-dsh-waveform",\n',
    skill: "validated complete runtime-write stream; VCD/FST/VENDOR_A correctly remains\n",
  });
  assert.match(result.host, /resolveSvwBinary/);
  assert.match(result.browser, /id: "dsh-svw-waveform"/);
  assert.doesNotMatch(`${result.host}${result.browser}${result.skill}`, /VENDOR_A|VENDOR_B/);
});

test("upstream drift fails closed", () => {
  assert.throws(() => transformIntegration({ index: "changed", client: "changed", skill: "changed" }),
    /exactly one/);
});
