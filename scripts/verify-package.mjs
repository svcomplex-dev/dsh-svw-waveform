#!/usr/bin/env node
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = process.cwd();
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const manifest = await readJson("package.json");
const linux = await readJson("npm/linux-x64/package.json");
const darwin = await readJson("npm/darwin-arm64/package.json");
const linuxProvenance = await readJson("npm/linux-x64/svw-provenance.json");
const darwinProvenance = await readJson("npm/darwin-arm64/svw-provenance.json");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

invariant(manifest.name === "dsh-svw-waveform", "unexpected root package name");
invariant(manifest.dsh?.bundle?.patch === "./cordis.patch.yml", "missing dsh bundle patch");
invariant(manifest.dsh?.client?.platform === "web", "missing dsh web client declaration");
invariant(!manifest.scripts?.install && !manifest.scripts?.postinstall && !manifest.scripts?.prepare,
  "entry package must not execute install lifecycle scripts");
for (const platform of [linux, darwin]) {
  invariant(platform.version === manifest.version, `${platform.name} version differs from entry package`);
  invariant(!platform.scripts, `${platform.name} must not have lifecycle scripts`);
}
invariant(manifest.optionalDependencies[linux.name] === manifest.version, "Linux optional dependency is not exact");
invariant(manifest.optionalDependencies[darwin.name] === manifest.version, "macOS optional dependency is not exact");
invariant(JSON.stringify(linux.os) === '["linux"]' && JSON.stringify(linux.cpu) === '["x64"]',
  "Linux package selector is wrong");
invariant(JSON.stringify(darwin.os) === '["darwin"]' && JSON.stringify(darwin.cpu) === '["arm64"]',
  "macOS package selector is wrong");

for (const [platform, provenance] of [["linux-x64", linuxProvenance], ["macos-arm64", darwinProvenance]]) {
  const expected = manifest.svwArtifacts[platform];
  invariant(provenance.svwRelease === manifest.svwRelease, `${platform} release differs`);
  invariant(provenance.asset === expected.asset, `${platform} asset differs`);
  invariant(provenance.archiveSha256 === expected.archiveSha256, `${platform} archive hash differs`);
  invariant(provenance.binarySha256 === expected.binarySha256, `${platform} binary hash differs`);
  invariant(/^[0-9a-f]{64}$/.test(provenance.archiveSha256), `${platform} archive hash is invalid`);
  invariant(provenance.binarySha256 === "" || /^[0-9a-f]{64}$/.test(provenance.binarySha256),
    `${platform} binary hash is invalid`);
}

const policyFiles = ["README.md", "index.js", "client.cjs", "skills/svw-waveform/SKILL.md"];
for (const path of policyFiles) {
  const content = await readFile(join(root, path), "utf8");
  invariant(!/fsdb|mxv/i.test(content), `${path} advertises an unsupported waveform format`);
}
invariant((await readFile(join(root, "cordis.patch.yml"), "utf8")).includes("name: 'dsh-svw-waveform'"),
  "bundle patch does not load this package");
invariant((await readFile(join(root, "client.cjs"), "utf8")).includes('id: "dsh-svw-waveform"'),
  "browser module id does not match this package");
invariant((await readFile(join(root, "index.js"), "utf8")).includes("resolveSvwBinary()"),
  "host plugin does not use the package-private binary resolver");

for (const [platform, directory, provenance] of [
  ["linux-x64", "npm/linux-x64", linuxProvenance],
  ["macos-arm64", "npm/darwin-arm64", darwinProvenance],
]) {
  const binary = join(root, directory, "bin/svw");
  try {
    await access(binary, constants.X_OK);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  const info = await stat(binary);
  invariant(info.isFile(), `${platform} SVW is not a regular file`);
  const bytes = await readFile(binary);
  const actual = createHash("sha256").update(bytes).digest("hex");
  invariant(actual === provenance.binarySha256, `${platform} packaged binary hash differs`);
}

process.stdout.write(`verified ${manifest.name}@${manifest.version} for ${manifest.svwRelease}\n`);
