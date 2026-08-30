import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

test("release preparation fails closed before repository or registry publication", () => {
  const prepare = workflow.indexOf("node scripts/prepare-svw-release.mjs");
  const sync = workflow.indexOf("node scripts/sync-svw-integration.mjs");
  const verify = workflow.indexOf("npm run verify");
  const commit = workflow.indexOf('git commit -m "release: track svw');
  const pack = workflow.indexOf("npm pack --workspace npm/linux-x64");
  const publish = workflow.indexOf("publish_one dsh-svw-waveform-linux-x64");
  assert.ok(prepare >= 0 && prepare < sync);
  assert.ok(sync < verify);
  assert.ok(verify < commit);
  assert.ok(commit < pack);
  assert.ok(pack < publish);
});

test("platform packages precede the entry bundle and the tag is last", () => {
  const linux = workflow.indexOf("publish_one dsh-svw-waveform-linux-x64");
  const darwin = workflow.indexOf("publish_one dsh-svw-waveform-darwin-arm64");
  const entry = workflow.indexOf('publish_one dsh-svw-waveform "$ENTRY_TGZ"');
  const tag = workflow.indexOf('git tag -a "$tag"');
  assert.ok(linux >= 0 && linux < darwin);
  assert.ok(darwin < entry);
  assert.ok(entry < tag);
});
