'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBandMap, computeBands, smoothBands } = require('../src/shared/bands.js');

const OPTS = { binCount: 1024, sampleRate: 48000, bands: 48, minHz: 30, maxHz: 16000 };

test('createBandMap returns one [start, end) range per band', () => {
  const map = createBandMap(OPTS);
  assert.equal(map.length, 48);
  for (const [start, end] of map) {
    assert.ok(Number.isInteger(start) && Number.isInteger(end));
    assert.ok(end > start, 'every band covers at least one bin');
    assert.ok(start >= 0 && end <= OPTS.binCount);
  }
});

test('createBandMap is monotonic and log-spaced (higher bands are wider)', () => {
  const map = createBandMap(OPTS);
  for (let i = 1; i < map.length; i++) {
    assert.ok(map[i][0] >= map[i - 1][0], 'starts never go backwards');
  }
  const firstWidth = map[0][1] - map[0][0];
  const lastWidth = map[map.length - 1][1] - map[map.length - 1][0];
  assert.ok(lastWidth > firstWidth * 4, 'top band is much wider than bottom band');
});

test('createBandMap respects the frequency range', () => {
  const map = createBandMap(OPTS);
  const binHz = OPTS.sampleRate / 2 / OPTS.binCount;
  assert.ok(map[0][0] * binHz <= 30 + binHz);
  assert.ok(map[map.length - 1][1] * binHz <= 16000 + binHz);
  assert.ok(map[map.length - 1][1] * binHz >= 15000);
});

test('createBandMap clamps maxHz above Nyquist to binCount', () => {
  const map = createBandMap({ ...OPTS, sampleRate: 22050, maxHz: 20000 });
  assert.ok(map[map.length - 1][1] <= OPTS.binCount);
  for (const [start, end] of map) assert.ok(end > start);
});

test('createBandMap rejects invalid options', () => {
  assert.throws(() => createBandMap({ ...OPTS, bands: 0 }), RangeError);
  assert.throws(() => createBandMap({ ...OPTS, binCount: 0 }), RangeError);
  assert.throws(() => createBandMap({ ...OPTS, minHz: 500, maxHz: 100 }), RangeError);
});

test('computeBands returns zeros for silence', () => {
  const map = createBandMap(OPTS);
  const out = computeBands(new Uint8Array(OPTS.binCount), map);
  assert.equal(out.length, 48);
  assert.ok(out.every((v) => v === 0));
});

test('computeBands returns 1 for a full-scale spectrum', () => {
  const map = createBandMap(OPTS);
  const out = computeBands(new Uint8Array(OPTS.binCount).fill(255), map);
  assert.ok(out.every((v) => Math.abs(v - 1) < 1e-9));
});

test('computeBands output is always within [0, 1]', () => {
  const map = createBandMap(OPTS);
  const bins = new Uint8Array(OPTS.binCount);
  for (let i = 0; i < bins.length; i++) bins[i] = (i * 37) % 256;
  const out = computeBands(bins, map);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
});

test('computeBands applies a noise floor so low-level noise reads as zero', () => {
  const map = createBandMap(OPTS);
  const out = computeBands(new Uint8Array(OPTS.binCount).fill(10), map, { floor: 0.1 });
  assert.ok(out.every((v) => v === 0));
});

test('computeBands places energy in the matching band', () => {
  const map = createBandMap(OPTS);
  const bins = new Uint8Array(OPTS.binCount);
  const target = 30;
  const [start, end] = map[target];
  for (let i = start; i < end; i++) bins[i] = 255;
  const out = computeBands(bins, map);
  assert.ok(out[target] > 0.9);
  assert.equal(out[0], 0);
  assert.equal(out[47], 0);
});

test('smoothBands returns a copy of next when there is no previous frame', () => {
  const next = new Float32Array([0.5, 1]);
  const out = smoothBands(null, next);
  assert.deepEqual(Array.from(out), [0.5, 1]);
  assert.notEqual(out, next);
});

test('smoothBands rises with attack and falls with decay', () => {
  const prev = new Float32Array([0, 1]);
  const next = new Float32Array([1, 0]);
  const out = smoothBands(prev, next, { attack: 0.5, decay: 0.1 });
  assert.ok(Math.abs(out[0] - 0.5) < 1e-6, 'rises halfway with attack 0.5');
  assert.ok(Math.abs(out[1] - 0.9) < 1e-6, 'falls 10% with decay 0.1');
});

test('smoothBands with attack 1 tracks peaks instantly', () => {
  const out = smoothBands(new Float32Array([0.2]), new Float32Array([0.8]), { attack: 1, decay: 0.2 });
  assert.ok(Math.abs(out[0] - 0.8) < 1e-6);
});

test('smoothBands converges to silence and snaps tiny values to zero', () => {
  let cur = new Float32Array([1, 1, 1]);
  const silence = new Float32Array(3);
  for (let i = 0; i < 200; i++) cur = smoothBands(cur, silence, { attack: 0.6, decay: 0.15 });
  assert.ok(cur.every((v) => v === 0));
});

test('smoothBands falls back to next when lengths differ', () => {
  const out = smoothBands(new Float32Array(3), new Float32Array([0.4, 0.6]));
  assert.deepEqual(Array.from(out).map((v) => Math.round(v * 10) / 10), [0.4, 0.6]);
});
