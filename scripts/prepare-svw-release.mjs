#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const releasePattern = /^release-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function releaseParts(tag) {
  const match = releasePattern.exec(tag);
  if (!match) throw new Error("svw release must be release-MAJOR.MINOR.PATCH");
  return match.slice(1).map(Number);
}

function compare(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function nextPatch(version) {
  const match = versionPattern.exec(version);
  if (!match) throw new Error("package version must be MAJOR.MINOR.PATCH");
  const patch = Number(match[3]) + 1;
  if (!Number.isSafeInteger(patch)) throw new Error("package patch version overflow");
  return `${match[1]}.${match[2]}.${patch}`;
}

function validSha(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be lowercase SHA256`);
  return value;
}

export function prepareRelease(state, releaseTag, artifacts) {
  const requested = releaseParts(releaseTag);
  if (state.root.name !== "dsh-svw-waveform") throw new Error("unexpected root package identity");
  const current = releaseParts(state.root.svwRelease);
  if (compare(requested, current) < 0) {
    return { changed: false, skippedOlder: true, packageVersion: state.root.version, releaseTag: state.root.svwRelease };
  }

  for (const platform of ["linux-x64", "macos-arm64"]) {
    validSha(artifacts[platform].archiveSha256, `${platform} archive`);
    validSha(artifacts[platform].binarySha256, `${platform} binary`);
  }
  const desired = Object.fromEntries(["linux-x64", "macos-arm64"].map((platform) => [
    platform,
    {
      asset: `svw-${releaseTag}-${platform}.tar.gz`,
      archiveSha256: artifacts[platform].archiveSha256,
      binarySha256: artifacts[platform].binarySha256,
    },
  ]));
  const changed = state.root.svwRelease !== releaseTag ||
    JSON.stringify(state.root.svwArtifacts) !== JSON.stringify(desired);
  if (!changed) {
    return { changed: false, skippedOlder: false, packageVersion: state.root.version, releaseTag };
  }

  const packageVersion = nextPatch(state.root.version);
  state.root.version = packageVersion;
  state.root.svwRelease = releaseTag;
  state.root.svwArtifacts = desired;
  state.root.optionalDependencies["dsh-svw-waveform-linux-x64"] = packageVersion;
  state.root.optionalDependencies["dsh-svw-waveform-darwin-arm64"] = packageVersion;

  const platformState = {
    "linux-x64": state.linux,
    "macos-arm64": state.darwin,
  };
  for (const [platform, item] of Object.entries(platformState)) {
    item.manifest.version = packageVersion;
    item.provenance.svwRelease = releaseTag;
    item.provenance.asset = desired[platform].asset;
    item.provenance.archiveSha256 = desired[platform].archiveSha256;
    item.provenance.binarySha256 = desired[platform].binarySha256;
  }
  return { changed: true, skippedOlder: false, packageVersion, releaseTag };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function prepareFromFiles(releaseTag, artifactRoot, root = process.cwd()) {
  const state = {
    root: await readJson(join(root, "package.json")),
    linux: {
      manifest: await readJson(join(root, "npm/linux-x64/package.json")),
      provenance: await readJson(join(root, "npm/linux-x64/svw-provenance.json")),
    },
    darwin: {
      manifest: await readJson(join(root, "npm/darwin-arm64/package.json")),
      provenance: await readJson(join(root, "npm/darwin-arm64/svw-provenance.json")),
    },
  };
  const artifacts = {};
  for (const platform of ["linux-x64", "macos-arm64"]) {
    artifacts[platform] = {
      archiveSha256: (await readFile(join(artifactRoot, platform, "archive.sha256"), "utf8")).trim(),
      binarySha256: (await readFile(join(artifactRoot, platform, "binary.sha256"), "utf8")).trim(),
    };
  }
  const result = prepareRelease(state, releaseTag, artifacts);
  if (result.changed) {
    await writeJson(join(root, "package.json"), state.root);
    await writeJson(join(root, "npm/linux-x64/package.json"), state.linux.manifest);
    await writeJson(join(root, "npm/linux-x64/svw-provenance.json"), state.linux.provenance);
    await writeJson(join(root, "npm/darwin-arm64/package.json"), state.darwin.manifest);
    await writeJson(join(root, "npm/darwin-arm64/svw-provenance.json"), state.darwin.provenance);
  }
  return result;
}

async function main() {
  const [releaseTag, artifactRoot] = process.argv.slice(2);
  if (!releaseTag || !artifactRoot) {
    throw new Error("usage: prepare-svw-release.mjs release-X.Y.Z ARTIFACT_ROOT");
  }
  const result = await prepareFromFiles(releaseTag, artifactRoot);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      `changed=${result.changed}\nskipped_older=${result.skippedOlder}\n` +
      `package_version=${result.packageVersion}\nsvw_release=${result.releaseTag}\n`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
