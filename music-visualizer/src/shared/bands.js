/*
 * Converts AnalyserNode frequency bins into a fixed number of bar heights.
 * Pure module: usable from Node (CommonJS) and the renderer (global).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.WidgetBands = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Values below this after smoothing snap to zero so silence renders flat. */
  const SNAP_EPSILON = 0.002;

  /**
   * Builds log-spaced [startBin, endBin) ranges, one per band.
   * @param {{binCount:number, sampleRate:number, bands:number, minHz:number, maxHz:number}} opts
   * @returns {Array<[number, number]>}
   */
  function createBandMap({ binCount, sampleRate, bands, minHz = 30, maxHz = 16000 }) {
    if (!Number.isInteger(binCount) || binCount < 1) throw new RangeError('binCount must be a positive integer');
    if (!Number.isInteger(bands) || bands < 1) throw new RangeError('bands must be a positive integer');
    if (!(sampleRate > 0)) throw new RangeError('sampleRate must be positive');
    if (!(minHz > 0) || !(maxHz > minHz)) throw new RangeError('expected 0 < minHz < maxHz');

    const nyquist = sampleRate / 2;
    const binHz = nyquist / binCount;
    const top = Math.min(maxHz, nyquist);
    const bottom = Math.min(minHz, top / 2);
    const ratio = top / bottom;

    const map = [];
    for (let i = 0; i < bands; i++) {
      const loHz = bottom * Math.pow(ratio, i / bands);
      const hiHz = bottom * Math.pow(ratio, (i + 1) / bands);
      let start = Math.min(binCount - 1, Math.floor(loHz / binHz));
      let end = Math.min(binCount, Math.ceil(hiHz / binHz));
      if (end <= start) end = start + 1;
      map.push([start, end]);
    }
    return map;
  }

  /**
   * Averages bins per band, normalized to [0, 1], with an optional noise floor.
   * Uses the mean of the band blended with its peak so wide bands stay lively.
   * @param {Uint8Array} bins
   * @param {Array<[number, number]>} map
   * @param {{floor?: number}} [opts]
   * @returns {Float32Array}
   */
  function computeBands(bins, map, { floor = 0 } = {}) {
    const out = new Float32Array(map.length);
    const span = 1 - floor;
    for (let b = 0; b < map.length; b++) {
      const [start, end] = map[b];
      let sum = 0;
      let peak = 0;
      let count = 0;
      for (let i = start; i < end && i < bins.length; i++) {
        const v = bins[i];
        sum += v;
        if (v > peak) peak = v;
        count++;
      }
      if (count === 0) continue;
      const raw = ((sum / count) * 0.5 + peak * 0.5) / 255;
      const v = span > 0 ? (raw - floor) / span : 0;
      out[b] = v <= 0 ? 0 : v >= 1 ? 1 : v;
    }
    return out;
  }

  /**
   * Smooths a new frame against the previous one: fast attack, slow decay.
   * @param {Float32Array|null} prev
   * @param {Float32Array} next
   * @param {{attack?: number, decay?: number}} [opts] fractions in (0, 1]
   * @returns {Float32Array}
   */
  function smoothBands(prev, next, { attack = 0.6, decay = 0.15 } = {}) {
    const out = new Float32Array(next.length);
    if (!prev || prev.length !== next.length) {
      out.set(next);
      return out;
    }
    for (let i = 0; i < next.length; i++) {
      const p = prev[i];
      const n = next[i];
      const k = n > p ? attack : decay;
      const v = p + (n - p) * k;
      out[i] = v < SNAP_EPSILON ? 0 : v;
    }
    return out;
  }

  return { createBandMap, computeBands, smoothBands };
});
