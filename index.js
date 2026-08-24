// SPDX-License-Identifier: MIT
// Copyright (c) 2026 code@svcomplex.ai
// svw waveform plugin for DeepSeek Harness.
//
// Registers the model-callable `svw_wave_render` tool. It runs the bounded
// `svw agent ... render --color ansi --view wave` command without a shell,
// returns only a compact completion summary to the model, and presents the
// complete colored canvas as a `terminal` tool-result card. The DeepSeek
// Harness web UI parses SGR (including truecolor) in terminal cards, so the
// frame renders with the same colors as the svw terminal UI.
//
// When the bundled web client half is loaded, tool results are instead
// rendered by an interactive canvas waveform viewer (zoom/pan/markers/radix/
// edge search) that runs entirely in the browser: every requested signal's
// value changes over the requested window ship inside presentationMeta, so
// the viewer needs no server round-trips. The terminal card remains the
// fallback everywhere else.
//
// The definition is hand-rolled against the dsh-tools ToolDefinition contract
// instead of importing `defineTool`, so the installed package stays free of
// runtime dependencies on `@deepseek-ai/*` packages.

import { execFile } from "node:child_process";
import { resolveSvwBinary } from "./lib/resolve-svw.js";

const MAX_FRAME_BYTES = 512 * 1024;
const SGR_SEQUENCE = /\x1b\[[0-9;]*m/g;

const name = "svw-waveform";
const inject = ["tools"];

function normalizeWaveformPath(path) {
	return path.startsWith("@") ? path.slice(1) : path;
}

// Column width of one already-stripped line: most terminals render the svw
// wave canvas glyphs as single columns; count East Asian wide/fullwidth code
// points as two so the width bound stays honest for CJK hierarchical names.
function visibleWidth(line) {
	let width = 0;
	for (const char of line) {
		const code = char.codePointAt(0);
		width +=
			(code >= 0x1100 &&
				(code <= 0x115f ||
					code === 0x2329 ||
					code === 0x232a ||
					(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
					(code >= 0xac00 && code <= 0xd7a3) ||
					(code >= 0xf900 && code <= 0xfaff) ||
					(code >= 0xfe30 && code <= 0xfe6f) ||
					(code >= 0xff00 && code <= 0xff60) ||
					(code >= 0xffe0 && code <= 0xffe6) ||
					(code >= 0x20000 && code <= 0x3fffd)))
				? 2
				: 1;
	}
	return width;
}

function validateFrame(ansi, expectedHeight, expectedWidth) {
	if (Buffer.byteLength(ansi, "utf8") > MAX_FRAME_BYTES) {
		throw new Error("svw returned an unexpectedly large waveform frame");
	}
	const plain = ansi.replace(SGR_SEQUENCE, "");
	if (/\x1b|[\x00-\x08\x0b-\x1f\x7f]/.test(plain)) {
		throw new Error("svw waveform frame contains unsupported terminal control sequences");
	}
	const lines = (plain.endsWith("\n") ? plain.slice(0, -1) : plain).split("\n");
	if (lines.length !== expectedHeight) {
		throw new Error(`svw returned ${lines.length} rows, expected ${expectedHeight}`);
	}
	if (lines.some((line) => visibleWidth(line) > expectedWidth)) {
		throw new Error("svw waveform frame exceeds its requested column bound");
	}
}

function validateParams(params) {
	if (typeof params.waveform !== "string" || params.waveform.length === 0) {
		throw new Error("waveform must be a non-empty waveform path");
	}
	for (const key of ["start", "end"]) {
		if (!Number.isInteger(params[key])) {
			throw new Error(`${key} must be an integer native waveform tick`);
		}
	}
	if (params.end <= params.start) {
		throw new Error("end must be greater than start");
	}
	if (
		!Array.isArray(params.hier) ||
		params.hier.length < 1 ||
		params.hier.length > 12 ||
		params.hier.some((entry) => typeof entry !== "string" || entry.length === 0)
	) {
		throw new Error("hier must name 1 to 12 exact full hierarchical signal names");
	}
	for (const [key, minimum, maximum] of [
		["width", 60, 240],
		["height", 14, 80],
	]) {
		if (params[key] === undefined) continue;
		if (!Number.isInteger(params[key]) || params[key] < minimum || params[key] > maximum) {
			throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
		}
	}
}

function runSvw(binary, args, signal) {
	return new Promise((resolve, reject) => {
		execFile(
			binary,
			args,
			{ signal, timeout: 30_000, maxBuffer: MAX_FRAME_BYTES + 64 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					const detail = (stderr || "").trim() || `svw failed: ${error.message}`;
					reject(new Error(detail.slice(0, 4096)));
					return;
				}
				resolve(stdout);
			},
		);
	});
}

const definition = {
	name: "svw_wave_render",
	description:
		"Render one to twelve exact full hierarchical signal names as a complete colored terminal waveform. " +
		"Use `svw agent WAVEFORM signals` first and copy its name fields exactly.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			waveform: {
				type: "string",
				description: "VCD or FST waveform path",
			},
			start: { type: "integer", description: "Inclusive starting native waveform tick" },
			end: { type: "integer", description: "Inclusive ending native waveform tick" },
			hier: {
				type: "array",
				items: { type: "string" },
				description:
					"1 to 12 exact full hierarchical signal names from svw agent signals, shown from top to bottom",
			},
			width: { type: "integer", description: "Frame columns, 60 to 240 (default 100)" },
			height: {
				type: "integer",
				description: "Frame rows, 14 to 80 (default 10 + 4 per signal, clamped)",
			},
		},
		required: ["waveform", "start", "end", "hier"],
	},
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				ansi: { type: "string", description: "Complete SGR-colored wave canvas" },
				waveform: { type: "string" },
				start: { type: "integer" },
				end: { type: "integer" },
				width: { type: "integer" },
				height: { type: "integer" },
				signals: { type: "integer" },
				hier: {
					type: "array",
					items: { type: "string" },
					description: "Exact hierarchical names in display order",
				},
				wave: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							name: { type: "string" },
							width: { type: "integer" },
							truncated: { type: "boolean" },
							changes: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										time: { type: "integer" },
										sequence: { type: "integer" },
										text: { type: "string" },
										kind: { type: "string" },
									},
									required: ["time", "sequence", "text", "kind"],
								},
							},
						},
						required: ["name", "width", "truncated", "changes"],
					},
					description: "Per-signal value changes over the requested window",
				},
				timeContext: {
					oneOf: [
						{
							type: "object",
							additionalProperties: false,
							properties: {
								available: { type: "boolean" },
								femtoseconds_per_tick: { type: "string" },
							},
							required: ["available", "femtoseconds_per_tick"],
						},
						{ type: "null" },
					],
				},
			},
			required: [
				"ansi", "waveform", "start", "end", "width", "height",
				"signals", "hier", "wave", "timeContext",
			],
		},
		// The model receives only a bounded summary; the full canvas reaches the
		// UI through presentationMeta + the terminal card instead of model text.
		render(_args, value) {
			return [
				{
					type: "text",
					text:
						`Rendered the complete ${value.width}x${value.height} svw wave canvas for ` +
						`${value.signals} signal(s) over native ticks ${value.start}..${value.end}. ` +
						"The colored frame is displayed by the DeepSeek Harness integration and is " +
						"intentionally not duplicated in model text.",
				},
			];
		},
		presentationMeta(_args, value) {
			// The interactive web viewer runs entirely in the browser on this
			// payload (no server round-trips); ansi remains the terminal-card
			// fallback for surfaces without the client bundle.
			return {
				ansi: value.ansi,
				exitCode: 0,
				waveform: value.waveform,
				start: value.start,
				end: value.end,
				hier: value.hier,
				wave: value.wave,
				timeContext: value.timeContext,
			};
		},
	},
	timeoutMs: 35_000,
	isConcurrencySafe: () => true,

	async execute(params, exec) {
		validateParams(params);
		const width = params.width ?? 100;
		const height = params.height ?? Math.max(14, Math.min(80, 10 + params.hier.length * 4));
		const waveform = normalizeWaveformPath(params.waveform);
		const binary = resolveSvwBinary();
		const stdout = await runSvw(
			binary,
			[
				"agent",
				waveform,
				"render",
				String(params.start),
				String(params.end),
				...params.hier,
				"--width",
				String(width),
				"--height",
				String(height),
				"--color",
				"ansi",
				"--view",
				"wave",
			],
			exec.signal,
		);
		const canvasHeight = 1 + params.hier.length * 4;
		validateFrame(stdout, canvasHeight, width);
		const { wave, timeContext } = await collectWaveData(
			runSvw, binary, waveform, params.hier, params.start, params.end,
			META_CHANGES_LIMIT, exec.signal,
		);
		return {
			ansi: stdout,
			waveform,
			start: params.start,
			end: params.end,
			width,
			height: canvasHeight,
			signals: params.hier.length,
			hier: [...params.hier],
			wave,
			timeContext,
		};
	},

	presentCall(params) {
		try {
			validateParams(params);
		} catch {
			return undefined;
		}
		const waveform = normalizeWaveformPath(params.waveform);
		return {
			card: "terminal",
			title: `svw agent ${waveform} render ${params.start} ${params.end}`,
			description: `svw waveform: ${params.hier.length} signal(s)`,
		};
	},

	presentResult(_params, result) {
		if (result.isError) {
			return undefined;
		}
		const meta = result.meta;
		if (!meta || typeof meta.ansi !== "string") {
			return undefined;
		}
		return { card: "terminal", output: meta.ansi, exitCode: meta.exitCode };
	},
};

function apply(ctx) {
	ctx.tools.register(definition);
}

const MAX_SIGNAL_PAGES = 5;
const META_CHANGES_LIMIT = 2000;

// Resolve one exact hierarchical name to its stable signal record. The
// signals CLI takes a substring filter, so exact matches are picked out of
// bounded pages.
async function resolveSignal(run, binary, waveform, hier, signal) {
	let cursor;
	for (let page = 0; page < MAX_SIGNAL_PAGES; page += 1) {
		const args = ["agent", waveform, "signals", hier, "1000"];
		if (cursor) args.push(cursor);
		const listing = JSON.parse(await run(binary, args, signal));
		const exact = listing.signals.find((entry) => entry.name === hier);
		if (exact) {
			const raw = listing.time_context;
			const timeContext = raw && typeof raw === "object"
				? {
					available: raw.available === true,
					femtoseconds_per_tick: String(raw.femtoseconds_per_tick ?? ""),
				}
				: null;
			return { record: exact, timeContext };
		}
		if (!listing.next_cursor) break;
		cursor = listing.next_cursor;
	}
	throw new Error(`signal not found in waveform: ${hier}`);
}

async function fetchChanges(run, binary, waveform, id, start, end, limit, signal) {
	const changes = [];
	let cursor;
	let truncated = false;
	// svw caps one changes page at 1000 rows; accumulate up to `limit` total.
	const pageSize = Math.min(limit, 1000);
	while (changes.length < limit) {
		const args = ["agent", waveform, "changes", id, String(start), String(end), String(pageSize)];
		if (cursor) args.push(cursor);
		const page = JSON.parse(await run(binary, args, signal));
		for (const change of page.changes) {
			changes.push({
				time: change.time,
				sequence: change.sequence,
				text: change.value?.text ?? "",
				kind: change.value?.kind ?? "bits",
			});
		}
		if (!page.next_cursor) break;
		cursor = page.next_cursor;
	}
	if (cursor && changes.length >= limit) truncated = true;
	return { changes, truncated };
}

// Collect every requested signal's value changes over the requested window.
// The result rides presentationMeta to the web viewer, which then runs
// entirely in the browser — no server round-trips. `run` is injectable for
// tests; it must behave like runSvw (binary, args, signal) => stdout.
async function collectWaveData(run, binary, waveform, hier, start, end, limit, signal) {
	let timeContext = null;
	const wave = [];
	for (const hierName of hier) {
		const resolved = await resolveSignal(run, binary, waveform, hierName, signal);
		timeContext ??= resolved.timeContext;
		const { changes, truncated } = await fetchChanges(
			run, binary, waveform, resolved.record.id, start, end, limit, signal,
		);
		wave.push({
			name: hierName,
			width: resolved.record.width,
			changes,
			truncated,
		});
	}
	return { wave, timeContext };
}

export {
	apply,
	collectWaveData,
	definition,
	inject,
	name,
	normalizeWaveformPath,
	validateFrame,
	validateParams,
	visibleWidth,
};
