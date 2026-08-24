import assert from "node:assert/strict";
import test from "node:test";
import {
  apply,
  collectWaveData,
  definition,
  inject,
  normalizeWaveformPath,
  validateFrame,
  validateParams,
  visibleWidth,
} from "../index.js";

test("declares the expected Cordis services and tool", () => {
  assert.deepEqual(inject, ["tools"]);
  assert.equal(definition.name, "svw_wave_render");
  let registered;
  apply({ tools: { register(value) { registered = value; } } });
  assert.equal(registered, definition);
});

test("validates bounded render arguments", () => {
  const valid = { waveform: "@demo.vcd", start: 0, end: 10, hier: ["top.clk"], width: 80, height: 14 };
  assert.doesNotThrow(() => validateParams(valid));
  assert.equal(normalizeWaveformPath(valid.waveform), "demo.vcd");
  assert.throws(() => validateParams({ ...valid, end: 0 }), /greater than start/);
  assert.throws(() => validateParams({ ...valid, hier: [] }), /1 to 12/);
  assert.throws(() => validateParams({ ...valid, width: 241 }), /between 60 and 240/);
});

test("accepts safe ANSI frames and rejects controls or oversized rows", () => {
  const frame = "\u001b[31mclk\u001b[0m\nrow\nrow\nrow\nrow\n";
  assert.doesNotThrow(() => validateFrame(frame, 5, 8));
  assert.throws(() => validateFrame("a\u001b]0;bad\u0007\n", 1, 20), /unsupported terminal control/);
  assert.throws(() => validateFrame("too-wide\n", 1, 3), /column bound/);
  assert.equal(visibleWidth("A界"), 3);
});

test("projects the complete UI frame out of model text", () => {
  const value = {
    ansi: "UNIQUE_ANSI_PAYLOAD\n", waveform: "demo.vcd", start: 0, end: 10,
    width: 80, height: 5, signals: 1, hier: ["top.clk"], wave: [], timeContext: null,
  };
  const content = definition.output.render({}, value);
  assert.match(content[0].text, /intentionally not duplicated/);
  assert.doesNotMatch(content[0].text, /UNIQUE_ANSI_PAYLOAD/);
  const meta = definition.output.presentationMeta({}, value);
  assert.equal(meta.ansi, "UNIQUE_ANSI_PAYLOAD\n");
  assert.deepEqual(definition.presentResult({}, { isError: false, meta, content }), {
    card: "terminal", output: "UNIQUE_ANSI_PAYLOAD\n", exitCode: 0,
  });
});

test("collects exact signal pages and change sequences", async () => {
  const calls = [];
  const run = async (_binary, args) => {
    calls.push(args);
    if (args[2] === "signals") return JSON.stringify({
      signals: [{ id: "signal:1", name: "top.clk", width: 1 }],
      time_context: { available: true, femtoseconds_per_tick: "1000000" },
    });
    return JSON.stringify({
      changes: [{ time: 2, sequence: 1, value: { text: "1", kind: "bits" } }],
    });
  };
  const result = await collectWaveData(run, "svw", "demo.vcd", ["top.clk"], 0, 10, 20);
  assert.equal(result.wave[0].changes[0].sequence, 1);
  assert.equal(result.timeContext.femtoseconds_per_tick, "1000000");
  assert.equal(calls.length, 2);
});
