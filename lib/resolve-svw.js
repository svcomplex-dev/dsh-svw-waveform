// SPDX-License-Identifier: MIT
// Copyright (c) 2026 code@svcomplex.ai

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const PLATFORM_PACKAGES = new Map([
	["linux:x64", "dsh-svw-waveform-linux-x64"],
	["darwin:arm64", "dsh-svw-waveform-darwin-arm64"],
]);

export function platformPackageName(platform = process.platform, arch = process.arch) {
	return PLATFORM_PACKAGES.get(`${platform}:${arch}`);
}

export function resolveSvwBinary({
	env = process.env,
	platform = process.platform,
	arch = process.arch,
	resolvePackage = require.resolve,
	exists = existsSync,
} = {}) {
	const configured = env.SVW_BIN?.trim();
	if (configured) return configured;

	const packageName = platformPackageName(platform, arch);
	if (packageName) {
		try {
			const manifest = resolvePackage(`${packageName}/package.json`);
			const binary = join(dirname(manifest), "bin", "svw");
			if (exists(binary)) return binary;
		} catch (error) {
			if (error?.code !== "MODULE_NOT_FOUND") throw error;
		}
	}

	if (platform === "darwin" && arch === "arm64") {
		for (const binary of ["/opt/homebrew/bin/svw", "/usr/local/bin/svw"]) {
			if (exists(binary)) return binary;
		}
	}

	return "svw";
}
