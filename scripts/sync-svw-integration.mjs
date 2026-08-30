#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`expected exactly one ${label} transform site`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexExactlyOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected exactly one ${label} transform site`);
  return source.replace(pattern, after);
}

function replaceOneReviewedSite(source, sites, after, label) {
  const matches = sites.filter((site) => source.includes(site));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${label} transform site`);
  }
  return replaceExactlyOnce(source, matches[0], after, label);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function transformIntegration({ index, client, skill }) {
  let host = replaceExactlyOnce(
    index,
    'import { execFile } from "node:child_process";',
    'import { execFile } from "node:child_process";\nimport { resolveSvwBinary as resolvePackagedSvwBinary } from "./lib/resolve-svw.js";',
    "host resolver import",
  );
  host = replaceRegexExactlyOnce(
    host,
    /description: "VCD, FST, [^"\n]+ waveform path",/g,
    'description: "VCD or FST waveform path",',
    "supported waveform description",
  );
  host = replaceOneReviewedSite(
    host,
    [
      'const binary = process.env.SVW_BIN?.trim() || "svw";',
      "const binary = resolveSvwBinary();",
    ],
    "const binary = resolvePackagedSvwBinary();",
    "package-private binary resolver",
  );

  let browser = replaceRegexExactlyOnce(
    client,
    /analysis\. Keeps rendering format-agnostic — [^\n]+ all arrive/g,
    "analysis. Keeps rendering format-agnostic across supported waveforms.",
    "browser waveform description",
  );
  browser = replaceExactlyOnce(
    browser,
    'id: "svw-dsh-waveform",',
    'id: "dsh-svw-waveform",',
    "browser module id",
  );

  let adaptedSkill = replaceRegexExactlyOnce(
    skill,
    /\n## FSDB inputs: install and activate the bridge first\n[\s\S]+?(?=\n## Workflow\n)/g,
    "",
    "FSDB bridge section",
  );
  adaptedSkill = replaceExactlyOnce(
    adaptedSkill,
    "When an FSDB/adapter",
    "When an adapter",
    "typed adapter wording",
  );
  adaptedSkill = replaceRegexExactlyOnce(
    adaptedSkill,
    /\nAn FSDB bridge activation\/configuration failure[\s\S]+?the FSDB path is not recovery\.\n/g,
    "",
    "FSDB recovery paragraph",
  );
  adaptedSkill = replaceRegexExactlyOnce(
    adaptedSkill,
    /validated complete runtime-write stream; VCD\/FST\/[^\n]+ correctly remains/g,
    "validated complete runtime-write stream; VCD/FST correctly remains",
    "skill waveform description",
  );

  return { host, browser, skill: adaptedSkill };
}

export async function syncIntegration(sourceDir, releaseTag, root = process.cwd()) {
  const original = {
    index: await readFile(join(sourceDir, "index.js"), "utf8"),
    client: await readFile(join(sourceDir, "client.cjs"), "utf8"),
    skill: await readFile(join(sourceDir, "skills", "svw-waveform", "SKILL.md"), "utf8"),
  };
  const transformed = transformIntegration(original);
  await writeFile(join(root, "index.js"), transformed.host);
  await writeFile(join(root, "client.cjs"), transformed.browser);
  await writeFile(join(root, "skills", "svw-waveform", "SKILL.md"), transformed.skill);
  const source = {
    release: releaseTag,
    asset: `svw-${releaseTag}-linux-x64.tar.gz`,
    files: {
      "index.js": sha256(original.index),
      "client.cjs": sha256(original.client),
      "skills/svw-waveform/SKILL.md": sha256(original.skill),
    },
    downstreamTransforms: [
      "resolve the package-private SVW runtime",
      "rename the browser module to dsh-svw-waveform",
      "advertise only VCD and FST waveform inputs",
    ],
  };
  await writeFile(join(root, "svw-source.json"), `${JSON.stringify(source, null, 2)}\n`);
  return source;
}

async function main() {
  const [sourceDir, releaseTag] = process.argv.slice(2);
  if (!sourceDir || !/^release-\d+\.\d+\.\d+$/.test(releaseTag ?? "")) {
    throw new Error("usage: sync-svw-integration.mjs SOURCE_DIR release-X.Y.Z");
  }
  const source = await syncIntegration(sourceDir, releaseTag);
  process.stdout.write(`${JSON.stringify(source)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
