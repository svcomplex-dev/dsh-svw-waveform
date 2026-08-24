import assert from "node:assert/strict";
import test from "node:test";
import client from "../client.cjs";

test("browser bundle exposes deterministic waveform helpers in Node", () => {
  assert.equal(client.formatRadix("1111", "hex"), "0xf");
  assert.equal(client.formatRadix("1111", "signed"), "-1");
  assert.equal(client.valueAtTime([{ time: 1, text: "0" }, { time: 3, text: "1" }], 2).text, "0");
  assert.deepEqual(client.clampView({ start: -5, end: 5 }, { start: 0, end: 20 }), { start: 0, end: 10 });
});
