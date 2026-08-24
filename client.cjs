// svw waveform web viewer for DeepSeek Harness — browser client bundle.
//
// Hand-written in the dsh client bundle format (window.__ModuleLoader__.load)
// so the package needs no build step. The file is also require()-able from
// Node for unit tests: in that case it exports only the pure waveform logic
// and never touches browser globals.
//
// The component registers a keyed `tool.call.toolview` slot entry for
// `svw_wave_render` and draws an interactive canvas waveform (VaporView-style:
// name column, time ruler, traces, wheel zoom, drag pan, markers, radix
// switching, edge search). Every signal's value changes over the requested
// window ship inside the tool result's presentationMeta, so the viewer runs
// entirely in the browser with no server round-trips.
(function (global) {
	"use strict";

	// ------------------------------------------------------------------
	// Pure logic (unit-tested in Node; no browser dependencies)
	// ------------------------------------------------------------------

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function spanOf(view) {
		return view.end - view.start;
	}

	function timeToX(time, view, pixels) {
		return ((time - view.start) / spanOf(view)) * pixels;
	}

	function xToTime(x, view, pixels) {
		return view.start + (x / pixels) * spanOf(view);
	}

	// Zoom around an anchor time. factor > 1 zooms in. The span is clamped to
	// [minSpan, maxSpan] and the anchor keeps its screen position.
	function zoomView(view, anchorTime, factor, minSpan, maxSpan) {
		const span = clamp(spanOf(view) / factor, minSpan, maxSpan);
		const ratio = (anchorTime - view.start) / spanOf(view);
		const start = anchorTime - ratio * span;
		return { start, end: start + span };
	}

	function panView(view, deltaTime) {
		return { start: view.start + deltaTime, end: view.end + deltaTime };
	}

	// Keep a view inside [bounds.start, bounds.end] without rescaling; windows
	// wider than the bounds are pinned to the bounds.
	function clampView(view, bounds) {
		const span = spanOf(view);
		const outer = spanOf(bounds);
		if (span >= outer) return { start: bounds.start, end: bounds.end };
		const start = clamp(view.start, bounds.start, bounds.end - span);
		return { start, end: start + span };
	}

	// Last change at or before `time`; changes are sorted by (time, sequence),
	// so for same-timestamp bursts the highest sequence wins. Returns null when
	// the first change is after `time`.
	function valueAtTime(changes, time) {
		let low = 0;
		let high = changes.length - 1;
		let found = -1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (changes[mid].time <= time) {
				found = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		return found >= 0 ? changes[found] : null;
	}

	// Distinct timestamps with at least one change, ascending.
	function changeTimes(changes) {
		const times = [];
		for (const change of changes) {
			if (times.length === 0 || times[times.length - 1] !== change.time) {
				times.push(change.time);
			}
		}
		return times;
	}

	// Timestamps carrying a same-time burst (more than one sequence) — the
	// delta-cycle indicator.
	function deltaTimes(changes) {
		const times = [];
		for (let i = 1; i < changes.length; i += 1) {
			if (changes[i].time === changes[i - 1].time &&
				(times.length === 0 || times[times.length - 1] !== changes[i].time)) {
				times.push(changes[i].time);
			}
		}
		return times;
	}

	// Nearest change timestamp to `time` (marker snap); null when empty.
	function nearestChange(changes, time) {
		if (changes.length === 0) return null;
		let best = changes[0].time;
		for (const change of changes) {
			if (Math.abs(change.time - time) < Math.abs(best - time)) best = change.time;
		}
		return best;
	}

	// Verdi-style edge search on one signal. mode: "any" | "rise" | "fall".
	// dir: +1 searches strictly after `from`, -1 strictly before. Returns the
	// timestamp or null. Works on distinct timestamps; the winning value at a
	// timestamp is its highest-sequence entry.
	function findEdge(changes, from, dir, mode) {
		const times = changeTimes(changes);
		const matches = (time) => {
			if (mode === "any") return true;
			const value = valueAtTime(changes, time);
			if (!value) return false;
			if (mode === "rise") return value.text === "1";
			if (mode === "fall") return value.text === "0";
			return false;
		};
		if (dir > 0) {
			for (const time of times) if (time > from && matches(time)) return time;
		} else {
			for (let i = times.length - 1; i >= 0; i -= 1) {
				if (times[i] < from && matches(times[i])) return times[i];
			}
		}
		return null;
	}

	// Four-state classification of a bits value text.
	function classifyBits(text) {
		if (typeof text !== "string" || text.length === 0) return "empty";
		let hasZeroOne = false;
		let hasX = false;
		let hasZ = false;
		for (const char of text.toLowerCase()) {
			if (char === "0" || char === "1") hasZeroOne = true;
			else if (char === "x") hasX = true;
			else if (char === "z") hasZ = true;
			else return "mixed";
		}
		if (hasX) return hasZeroOne || hasZ ? "mixed" : "x";
		if (hasZ) return hasZeroOne ? "mixed" : "z";
		return "binary";
	}

	// Real-number waveform values (svw real signals) pass through untouched.
	function isRealText(text) {
		return typeof text === "string" && text.length > 0 &&
			!/^[01xzXZ]+$/.test(text) && !Number.isNaN(Number(text));
	}

	function bitsToBigInt(text) {
		let value = 0n;
		for (const char of text) value = (value << 1n) | (char === "1" ? 1n : 0n);
		return value;
	}

	// Radix formatting for binary bus values; four-state and real texts keep
	// their raw form.
	function formatRadix(text, radix) {
		const kind = classifyBits(text);
		if (kind !== "binary") return kind === "empty" ? "" : text;
		if (text.length === 1) return text;
		const value = bitsToBigInt(text);
		switch (radix) {
			case "dec":
				return value.toString(10);
			case "signed": {
				const signBit = 1n << BigInt(text.length - 1);
				const signed = (value & signBit) !== 0n ? value - (1n << BigInt(text.length)) : value;
				return signed.toString(10);
			}
			case "bin":
				return "0b" + text;
			case "hex":
			default: {
				const digits = Math.ceil(text.length / 4);
				return "0x" + value.toString(16).padStart(digits, "0");
			}
		}
	}

	// Default (hex) display text.
	function formatBits(text) {
		return formatRadix(text, "hex");
	}

	// Format one native tick as physical time with an SI unit. fsPerTick is the
	// decimal femtoseconds-per-tick string from svw time_context; without it the
	// raw tick is returned.
	function formatTime(tick, fsPerTick) {
		if (!fsPerTick) return String(tick);
		const fs = BigInt(tick) * BigInt(fsPerTick);
		const units = [
			["s", 1000000000000000n],
			["ms", 1000000000000n],
			["us", 1000000000n],
			["ns", 1000000n],
			["ps", 1000n],
		];
		for (const [unit, scale] of units) {
			if (fs >= scale) {
				const whole = fs / scale;
				const frac = ((fs % scale) * 1000n) / scale;
				return frac === 0n ? `${whole}${unit}` : `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}${unit}`;
			}
		}
		return `${fs}fs`;
	}

	// Nice ruler ticks: the smallest 1/2/5 * 10^n step (in tick units) that
	// keeps labels at least minPx apart.
	function rulerTicks(view, pixels, minPx) {
		const span = spanOf(view);
		if (!(span > 0) || !(pixels > 0)) return [];
		const rawStep = (span * minPx) / pixels;
		const base = 10 ** Math.floor(Math.log10(rawStep));
		let step = base * 10;
		for (const multiplier of [1, 2, 5, 10]) {
			if (base * multiplier >= rawStep) {
				step = base * multiplier;
				break;
			}
		}
		const ticks = [];
		const first = Math.ceil(view.start / step) * step;
		for (let time = first; time <= view.end; time += step) {
			ticks.push(time);
		}
		return ticks;
	}

	// Merge consecutive same-value entries and split at window edges so each
	// segment knows its end time. The segment covering `start` extends from
	// the previous change so the left edge draws the carried value.
	function buildSegments(changes, start, end) {
		const segments = [];
		let current = valueAtTime(changes, start);
		const queue = changes.filter((change) => change.time > start && change.time <= end);
		let segmentStart = start;
		for (const change of queue) {
			if (current) segments.push({
				from: segmentStart, to: change.time, text: current.text, kind: current.kind,
			});
			current = change;
			segmentStart = change.time;
		}
		if (current) segments.push({ from: segmentStart, to: end, text: current.text, kind: current.kind });
		return segments;
	}

	// Pixel-level decimation: runs of segments narrower than minPx collapse
	// into one dense marker (like the svw TUI's rail activity marker), so a
	// zoomed-out lane never issues thousands of draws.
	function decimateSegments(segments, view, pixels, minPx) {
		const out = [];
		let denseFrom = null;
		let denseTo = null;
		const flush = () => {
			if (denseFrom !== null) {
				out.push({ dense: true, from: denseFrom, to: denseTo });
				denseFrom = null;
				denseTo = null;
			}
		};
		for (const segment of segments) {
			const px = ((segment.to - segment.from) / spanOf(view)) * pixels;
			if (px < minPx) {
				if (denseFrom === null) denseFrom = segment.from;
				denseTo = segment.to;
			} else {
				flush();
				out.push(segment);
			}
		}
		flush();
		return out;
	}

	// Display classification for one change/segment: the svw value kind wins
	// (real/string are format-level types), bits fall back to four-state text
	// analysis. Keeps rendering format-agnostic across supported waveforms.
	// through the same kind/text contract.
	function displayKind(change) {
		if (change.kind === "string") return "string";
		if (change.kind === "real") return "real";
		return classifyBits(change.text);
	}

	// Label text for one segment under the active radix.
	function segmentLabel(segment, radix) {
		if (segment.kind === "string") return segment.text.replace(/^"|"$/g, "");
		if (segment.kind === "real") return segment.text;
		return formatRadix(segment.text, radix);
	}

	const COLORS = {
		trace: "#c3e88d",
		grid: "#3b4261",
		name: "#828bb8",
		x: "#ff757f",
		z: "#ff966c",
		mixed: "#9d7cd8",
		ruler: "#828bb8",
		marker: "#ffcb6b",
		markerB: "#7dcfff",
		dense: "#565f89",
		warning: "#ff9e64",
	};

	const api = {
		COLORS,
		buildSegments,
		changeTimes,
		clampView,
		classifyBits,
		decimateSegments,
		deltaTimes,
		displayKind,
		findEdge,
		formatBits,
		formatRadix,
		formatTime,
		isRealText,
		nearestChange,
		panView,
		rulerTicks,
		segmentLabel,
		timeToX,
		valueAtTime,
		xToTime,
		zoomView,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
		return;
	}

	// ------------------------------------------------------------------
	// Browser bundle: dsh client module
	// ------------------------------------------------------------------

	global.__ModuleLoader__.load({
		id: "dsh-svw-waveform",
		factory: (require) => {
			const React = require("react");
			const { useEffect, useRef, useState } = React;

			const RULER_HEIGHT = 22;
			const LANE_HEIGHT = 26;
			const MIN_SPAN = 1;

			function measureNameWidth(ctx2d, names) {
				ctx2d.font = "11px monospace";
				let width = 40;
				for (const name of names) width = Math.max(width, ctx2d.measureText(name).width + 12);
				return clamp(Math.ceil(width), 60, 220);
			}

			function segmentFill(ctx2d, kind) {
				ctx2d.fillStyle = kind === "x" ? COLORS.x : kind === "z" ? COLORS.z : COLORS.mixed;
			}

			function drawWave(canvas, state) {
				const { data, view, nameWidth, width, radix } = state;
				const markerA = state.markerA;
				const markerB = state.markerB;
				const dpr = global.devicePixelRatio || 1;
				const lanes = data.signals.length;
				const height = RULER_HEIGHT + lanes * LANE_HEIGHT + 4;
				canvas.width = width * dpr;
				canvas.height = height * dpr;
				canvas.style.height = `${height}px`;
				const ctx2d = canvas.getContext("2d");
				ctx2d.scale(dpr, dpr);
				ctx2d.clearRect(0, 0, width, height);
				const waveWidth = Math.max(1, width - nameWidth);
				const fsPerTick = data.timeContext?.available
					? data.timeContext.femtoseconds_per_tick
					: null;

				// Ruler
				ctx2d.font = "10px monospace";
				ctx2d.textBaseline = "middle";
				for (const tick of rulerTicks(view, waveWidth, 70)) {
					const x = nameWidth + timeToX(tick, view, waveWidth);
					ctx2d.strokeStyle = COLORS.grid;
					ctx2d.beginPath();
					ctx2d.moveTo(x, 4);
					ctx2d.lineTo(x, height - 4);
					ctx2d.stroke();
					ctx2d.fillStyle = COLORS.ruler;
					ctx2d.fillText(formatTime(tick, fsPerTick), x + 3, 11);
				}

				data.signals.forEach((signal, index) => {
					const top = RULER_HEIGHT + index * LANE_HEIGHT + 2;
					const high = top + 3;
					const low = top + LANE_HEIGHT - 7;
					const mid = (high + low) / 2;

					ctx2d.fillStyle = index === state.selected ? COLORS.marker : COLORS.name;
					ctx2d.font = "11px monospace";
					ctx2d.fillText(signal.name, 6, top + LANE_HEIGHT / 2 - 2);

					// Value at the primary marker, next to the name column edge.
					if (markerA !== null) {
						const hit = valueAtTime(signal.changes, markerA);
						if (hit) {
							ctx2d.fillStyle = COLORS.marker;
							ctx2d.textAlign = "right";
							ctx2d.fillText(segmentLabel(hit, radix), nameWidth - 6, top + LANE_HEIGHT / 2 - 2);
							ctx2d.textAlign = "left";
						}
					}

					// Delta-cycle indicators for same-timestamp bursts.
					ctx2d.fillStyle = COLORS.mixed;
					for (const time of deltaTimes(signal.changes)) {
						if (time < view.start || time > view.end) continue;
						const x = nameWidth + timeToX(time, view, waveWidth);
						ctx2d.fillText("δ", x - 2, top - 1);
					}

					const segments = decimateSegments(
						buildSegments(signal.changes, view.start, view.end), view, waveWidth, 1.5);
					for (const segment of segments) {
						const x0 = nameWidth + timeToX(segment.from, view, waveWidth);
						const x1 = nameWidth + timeToX(segment.to, view, waveWidth);
						const px = x1 - x0;
						if (segment.dense) {
							ctx2d.fillStyle = COLORS.dense;
							ctx2d.fillRect(x0, high, Math.max(px, 1), low - high);
							continue;
						}
						const kind = displayKind(segment);
						// Bit lanes draw 0/1 levels and x/z bands; everything
						// wider — and every real/string value — draws as a box.
						const bitLane = signal.width === 1 && kind !== "real" && kind !== "string";
						if (bitLane) {
							if (kind === "binary") {
								const y = segment.text === "1" ? high : low;
								ctx2d.strokeStyle = COLORS.trace;
								ctx2d.beginPath();
								ctx2d.moveTo(x0, y);
								ctx2d.lineTo(x1, y);
								ctx2d.stroke();
								ctx2d.beginPath();
								ctx2d.moveTo(x0, high);
								ctx2d.lineTo(x0, low);
								ctx2d.stroke();
							} else {
								segmentFill(ctx2d, kind);
								ctx2d.globalAlpha = 0.45;
								ctx2d.fillRect(x0, high, Math.max(px, 1), low - high);
								ctx2d.globalAlpha = 1;
								if (px > 10) {
									ctx2d.fillStyle = "#1a1b26";
									ctx2d.fillText(kind === "z" ? "z" : "x", x0 + 2, mid);
								}
							}
						} else {
							if (kind === "binary" || kind === "real") {
								ctx2d.strokeStyle = COLORS.trace;
								ctx2d.strokeRect(x0 + 0.5, high, Math.max(px - 1, 1), low - high);
								const label = segmentLabel(segment, radix);
								if (ctx2d.measureText(label).width < px - 6) {
									ctx2d.fillStyle = COLORS.trace;
									ctx2d.fillText(label, x0 + 3, mid);
								}
							} else if (kind === "string") {
								ctx2d.fillStyle = COLORS.name;
								ctx2d.globalAlpha = 0.3;
								ctx2d.fillRect(x0, high, Math.max(px, 1), low - high);
								ctx2d.globalAlpha = 1;
								const label = segmentLabel(segment, radix);
								if (ctx2d.measureText(label).width < px - 6) {
									ctx2d.fillStyle = COLORS.name;
									ctx2d.fillText(label, x0 + 3, mid);
								}
							} else {
								segmentFill(ctx2d, kind);
								ctx2d.globalAlpha = 0.45;
								ctx2d.fillRect(x0, high, Math.max(px, 1), low - high);
								ctx2d.globalAlpha = 1;
								const label = segment.text.slice(0, 8);
								if (px > 14) {
									ctx2d.fillStyle = "#1a1b26";
									ctx2d.fillText(label, x0 + 3, mid);
								}
							}
						}
					}

					// Truncation warning: changes were cut at the collection bound.
					if (signal.truncated) {
						const x = nameWidth + waveWidth - 3;
						ctx2d.strokeStyle = COLORS.warning;
						ctx2d.beginPath();
						ctx2d.moveTo(x, high);
						ctx2d.lineTo(x, low);
						ctx2d.stroke();
					}
				});

				for (const [marker, color] of [[markerA, COLORS.marker], [markerB, COLORS.markerB]]) {
					if (marker === null || marker < view.start || marker > view.end) continue;
					const x = nameWidth + timeToX(marker, view, waveWidth);
					ctx2d.strokeStyle = color;
					ctx2d.beginPath();
					ctx2d.moveTo(x, RULER_HEIGHT);
					ctx2d.lineTo(x, height - 4);
					ctx2d.stroke();
				}
			}

			const buttonStyle = {
				background: "none",
				border: `1px solid ${COLORS.grid}`,
				borderRadius: "3px",
				color: COLORS.name,
				cursor: "pointer",
				fontFamily: "monospace",
				fontSize: "10px",
				marginRight: "4px",
				padding: "1px 6px",
			};

			function SvwWaveView(props) {
				const meta = props.block?.meta ?? {};
				const canvasRef = useRef(null);
				const boxRef = useRef(null);
				const bounds = { start: meta.start ?? 0, end: meta.end ?? 1 };
				const [view, setView] = useState(bounds);
				const [markerA, setMarkerA] = useState(null);
				const [markerB, setMarkerB] = useState(null);
				const [selected, setSelected] = useState(null);
				const [radix, setRadix] = useState("hex");
				const [searchMode, setSearchMode] = useState("any");
				const [width, setWidth] = useState(600);
				const [nameWidth, setNameWidth] = useState(120);
				const dragRef = useRef(null);

				// All data ships with the tool result; the viewer is browser-only.
				const data = {
					signals: Array.isArray(meta.wave) ? meta.wave : [],
					timeContext: meta.timeContext ?? null,
				};

				useEffect(() => {
					const box = boxRef.current;
					if (!box) return undefined;
					const observer = new ResizeObserver((entries) => {
						setWidth(Math.max(200, Math.floor(entries[0].contentRect.width)));
					});
					observer.observe(box);
					return () => observer.disconnect();
				}, []);

				useEffect(() => {
					if (!data.signals.length) return;
					const probe = document.createElement("canvas").getContext("2d");
					setNameWidth(measureNameWidth(probe, data.signals.map((s) => s.name)));
				}, [data]);

				useEffect(() => {
					const canvas = canvasRef.current;
					if (!canvas || !data.signals.length) return;
					drawWave(canvas, {
						data, view, markerA, markerB, width, nameWidth, radix, selected,
					});
				}, [data, view, markerA, markerB, width, nameWidth, radix, selected]);

				useEffect(() => {
					const canvas = canvasRef.current;
					if (!canvas) return undefined;
					const onWheel = (event) => {
						event.preventDefault();
						const rect = canvas.getBoundingClientRect();
						const waveWidth = Math.max(1, rect.width - nameWidth);
						const anchor = xToTime(event.clientX - rect.left - nameWidth, view, waveWidth);
						const factor = event.deltaY < 0 ? 1.25 : 0.8;
						setView((current) =>
							clampView(zoomView(current, anchor, factor, MIN_SPAN, spanOf(bounds)), bounds));
					};
					canvas.addEventListener("wheel", onWheel, { passive: false });
					return () => canvas.removeEventListener("wheel", onWheel);
				}, [nameWidth, view]);

				if (!meta.waveform) {
					const blocks = props.block?.content ?? [];
					const text = blocks.map((block) => block.text ?? "").join("\n");
					return React.createElement(
						"pre",
						{ style: { whiteSpace: "pre-wrap" } },
						text || "svw_wave_render: no waveform metadata",
					);
				}

				const jumpToEdge = (dir) => {
					if (selected === null) return;
					const signal = data.signals[selected];
					if (!signal) return;
					const from = markerA ?? view.start + spanOf(view) / 2;
					const time = findEdge(signal.changes, from, dir, searchMode);
					if (time === null) return;
					setMarkerA(time);
					const span = spanOf(view);
					setView(clampView({ start: time - span / 2, end: time + span / 2 }, bounds));
				};

				const truncatedNames = data.signals.filter((s) => s.truncated).map((s) => s.name);
				const fsPerTick = data.timeContext?.available
					? data.timeContext.femtoseconds_per_tick
					: null;

				return React.createElement("div", { ref: boxRef, style: { width: "100%" } },
					React.createElement("div", { style: { marginBottom: "2px" } },
						React.createElement("button", {
							style: buttonStyle,
							title: "Fit the requested window",
							onClick: () => setView(bounds),
						}, "fit"),
						["hex", "dec", "signed", "bin"].map((choice) =>
							React.createElement("button", {
								key: choice,
								style: {
									...buttonStyle,
									color: radix === choice ? COLORS.marker : COLORS.name,
								},
								onClick: () => setRadix(choice),
							}, choice)),
						["any", "rise", "fall"].map((choice) =>
							React.createElement("button", {
								key: choice,
								style: {
									...buttonStyle,
									color: searchMode === choice ? COLORS.markerB : COLORS.name,
								},
								onClick: () => setSearchMode(choice),
							}, choice)),
						React.createElement("button", {
							style: buttonStyle, title: "Previous edge of selected signal",
							onClick: () => jumpToEdge(-1),
						}, "◂"),
						React.createElement("button", {
							style: buttonStyle, title: "Next edge of selected signal",
							onClick: () => jumpToEdge(1),
						}, "▸"),
					),
					React.createElement("canvas", {
						ref: canvasRef,
						style: { width: "100%", display: "block", cursor: "crosshair" },
						onPointerDown: (event) => {
							dragRef.current = { x: event.clientX, view, moved: false };
							event.target.setPointerCapture(event.pointerId);
						},
						onPointerMove: (event) => {
							const drag = dragRef.current;
							if (!drag) return;
							const dx = event.clientX - drag.x;
							if (Math.abs(dx) > 3) drag.moved = true;
							const waveWidth = Math.max(1, width - nameWidth);
							const delta = (-dx / waveWidth) * spanOf(drag.view);
							setView(clampView(panView(drag.view, delta), bounds));
						},
						onPointerUp: (event) => {
							const drag = dragRef.current;
							dragRef.current = null;
							if (!drag) return;
							const rect = canvasRef.current.getBoundingClientRect();
							const x = event.clientX - rect.left;
							if (!drag.moved) {
								if (x < nameWidth) {
									// Name column click selects the lane.
									const index = Math.floor((event.clientY - rect.top - RULER_HEIGHT) / LANE_HEIGHT);
									if (index >= 0 && index < data.signals.length) {
										setSelected(index === selected ? null : index);
									}
									return;
								}
								const waveWidth = Math.max(1, rect.width - nameWidth);
								const time = xToTime(x - nameWidth, view, waveWidth);
								const signal = selected !== null ? data.signals[selected] : null;
								const snapped = signal ? nearestChange(signal.changes, time) : null;
								const target = snapped ?? Math.round(time);
								if (event.shiftKey) {
									setMarkerB((current) => current !== null && Math.abs(current - target) < spanOf(view) / 100
										? null : target);
								} else {
									setMarkerA((current) => current !== null && Math.abs(current - target) < spanOf(view) / 100
										? null : target);
								}
							}
						},
					}),
					React.createElement("div", {
						style: { color: COLORS.name, fontSize: "10px", fontFamily: "monospace" },
					},
						`${meta.waveform}  ticks ${Math.floor(view.start)}..${Math.ceil(view.end)}` +
						(markerA !== null && markerB !== null
							? `  Δ=${formatTime(Math.abs(markerB - markerA), fsPerTick)}`
							: "") +
						"  wheel=zoom drag=pan click=marker shift+click=markerB click-name=select"),
					truncatedNames.length > 0 && React.createElement("div", {
						style: { color: COLORS.warning, fontSize: "10px", fontFamily: "monospace" },
					}, `⚠ change data truncated for: ${truncatedNames.join(", ")} — narrow the window for the complete trace`),
				);
			}

			return {
				name: "svw-waveform-client",
				inject: ["slots"],
				apply(ctx) {
					ctx.effect(
						() =>
							ctx.slots.inject("tool.call.toolview", () =>
								ctx.slots.register(
									{ name: "tool.call.toolview", key: "svw_wave_render" },
									(owner) =>
										React.createElement(SvwWaveView, { block: owner.block }),
								)),
						"svw-waveform: tool view",
					);
				},
			};
		},
	});
})(typeof window !== "undefined" ? window : globalThis);
