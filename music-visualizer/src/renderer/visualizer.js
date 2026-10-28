/*
 * Canvas visualizer driven by an AnalyserNode.
 * Modes: "bars" (mirrored, log-spaced rounded bars) and "wave" (oscilloscope).
 * Look (bar count, colors, glow, peaks...) comes from the active skin via setStyle().
 * Depends on globalThis.WidgetBands and globalThis.WidgetSkinManifest (src/shared/).
 */
(function () {
  'use strict';

  const { createBandMap, computeBands, smoothBands } = globalThis.WidgetBands;
  const { normalizeVisualizer } = globalThis.WidgetSkinManifest;

  const MODES = ['bars', 'wave'];
  const MIN_HZ = 30;
  const MAX_HZ = 16000;
  const BASELINE_FROM_BOTTOM = 32; // px: centered on the transport controls row
  const IDLE_BAR = 0.025; // resting height so silence reads as calm flat bars
  const PEAK_FALL = 0.006; // per frame
  const PEAK_HEIGHT = 2;

  class Visualizer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{ getColors: () => {accent: string, accent2: string} }} opts
     */
    constructor(canvas, { getColors }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getColors = getColors;
      this.mode = 'bars';
      this.analyser = null;
      this.freq = null;
      this.time = null;
      this.bandMap = null;
      this.levels = null;
      this.peaks = null;
      this.style = normalizeVisualizer(null);
      this.raf = 0;
      this.running = false;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.gradientKey = '';
      this.gradient = null;
      this.frame = this.frame.bind(this);

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.pause();
        else if (this.running) this.resume();
      });
      this.resize();
    }

    static get MODES() {
      return MODES.slice();
    }

    setMode(mode) {
      if (MODES.includes(mode)) this.mode = mode;
    }

    /**
     * Applies a skin's visualizer settings. Input is re-normalized, so a
     * missing or malformed object simply yields the defaults.
     */
    setStyle(style) {
      const prevCount = this.style.barCount;
      this.style = normalizeVisualizer(style);
      this.gradientKey = '';
      if (this.style.barCount !== prevCount) {
        this.levels = null;
        this.peaks = null;
        this.buildBandMap();
      }
    }

    /** @param {AnalyserNode | null} analyser */
    setAnalyser(analyser) {
      this.analyser = analyser;
      if (analyser) {
        this.freq = new Uint8Array(analyser.frequencyBinCount);
        this.time = new Uint8Array(analyser.fftSize);
        this.buildBandMap();
      } else {
        this.freq = null;
        this.time = null;
        this.bandMap = null;
      }
    }

    buildBandMap() {
      if (!this.analyser) return;
      this.bandMap = createBandMap({
        binCount: this.analyser.frequencyBinCount,
        sampleRate: this.analyser.context.sampleRate,
        bands: this.style.barCount,
        minHz: MIN_HZ,
        maxHz: MAX_HZ,
      });
    }

    start() {
      this.running = true;
      this.resume();
    }

    stop() {
      this.running = false;
      this.pause();
    }

    pause() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    resume() {
      if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(this.frame);
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (w !== this.canvas.width || h !== this.canvas.height) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.dpr = dpr;
      this.width = rect.width;
      this.height = rect.height;
      this.gradientKey = '';
    }

    frame() {
      this.raf = 0;
      if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();

      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

      if (this.mode === 'wave') this.drawWave(ctx);
      else this.drawBars(ctx);

      if (this.running) this.raf = requestAnimationFrame(this.frame);
    }

    palette() {
      if (this.style.colors) return this.style.colors;
      const { accent, accent2 } = this.getColors();
      return [accent, accent2];
    }

    /** Fill/stroke style: a solid color or a cached multi-stop gradient across the drawing area. */
    paint() {
      const colors = this.palette();
      if (colors.length === 1) return colors[0];
      const vertical = this.style.gradient === 'vertical';
      const key = `${colors.join('|')}|${vertical}|${this.width}|${this.height}`;
      if (key !== this.gradientKey) {
        const centerY = this.height - BASELINE_FROM_BOTTOM;
        const g = vertical
          ? this.ctx.createLinearGradient(0, centerY, 0, centerY - this.height * 0.38)
          : this.ctx.createLinearGradient(0, 0, this.width, 0);
        colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
        this.gradient = g;
        this.gradientKey = key;
      }
      return this.gradient;
    }

    applyGlow(ctx) {
      if (this.style.glow <= 0) return;
      const colors = this.palette();
      ctx.shadowBlur = this.style.glow;
      ctx.shadowColor = colors[colors.length - 1];
    }

    clearGlow(ctx) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    nextLevels() {
      let target;
      if (this.analyser) {
        this.analyser.getByteFrequencyData(this.freq);
        target = computeBands(this.freq, this.bandMap, { floor: 0.12 });
      } else {
        target = new Float32Array(this.style.barCount);
      }
      this.levels = smoothBands(this.levels, target, { attack: 0.55, decay: 0.12 });
      return this.levels;
    }

    drawBars(ctx) {
      const s = this.style;
      const levels = this.nextLevels();
      const w = this.width;
      const h = this.height;
      const padX = 10;
      const slot = (w - padX * 2) / levels.length;
      const barW = Math.max(1, slot * (1 - s.barGap));
      const centerY = h - BASELINE_FROM_BOTTOM;
      const maxHalf = h * 0.38;
      const radius = (barW / 2) * s.barRadius;
      const minLen = Math.max(PEAK_HEIGHT, barW * s.barRadius);

      ctx.fillStyle = this.paint();

      // Upper bars (main) then the softer reflection below the center line.
      const passes = s.reflection ? 2 : 1;
      for (let pass = 0; pass < passes; pass++) {
        ctx.globalAlpha = pass === 0 ? s.opacity : s.opacity * 0.47;
        if (pass === 0) this.applyGlow(ctx);
        ctx.beginPath();
        for (let i = 0; i < levels.length; i++) {
          // Ease the curve a little so quiet passages still move.
          const v = Math.max(IDLE_BAR, Math.pow(levels[i], 0.85));
          const len = Math.max(minLen, v * maxHalf * (pass === 0 ? 1 : 0.4));
          const x = padX + i * slot + (slot - barW) / 2;
          const y = pass === 0 ? centerY - len : centerY + 2;
          if (radius > 0) ctx.roundRect(x, y, barW, len, radius);
          else ctx.rect(x, y, barW, len);
        }
        ctx.fill();
        this.clearGlow(ctx);
      }

      if (s.peakColor) this.drawPeaks(ctx, levels, { padX, slot, barW, centerY, maxHalf, minLen });
      ctx.globalAlpha = 1;
    }

    /** Small caps that jump to each bar's top and fall back slowly. */
    drawPeaks(ctx, levels, { padX, slot, barW, centerY, maxHalf, minLen }) {
      if (!this.peaks || this.peaks.length !== levels.length) this.peaks = new Float32Array(levels.length);
      ctx.globalAlpha = Math.min(1, this.style.opacity * 2);
      ctx.fillStyle = this.style.peakColor;
      ctx.beginPath();
      for (let i = 0; i < levels.length; i++) {
        const len = Math.max(minLen, Math.max(IDLE_BAR, Math.pow(levels[i], 0.85)) * maxHalf);
        this.peaks[i] = Math.max(len, this.peaks[i] - PEAK_FALL * maxHalf);
        const x = padX + i * slot + (slot - barW) / 2;
        ctx.rect(x, centerY - this.peaks[i] - PEAK_HEIGHT - 2, barW, PEAK_HEIGHT);
      }
      ctx.fill();
    }

    drawWave(ctx) {
      const w = this.width;
      const h = this.height;
      const centerY = h - BASELINE_FROM_BOTTOM;
      const amp = h * 0.28;

      const s = this.style;
      ctx.strokeStyle = this.paint();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.beginPath();
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(this.time);
        const data = this.time;
        const step = Math.max(1, Math.floor(data.length / Math.max(64, Math.floor(w))));
        const points = Math.floor(data.length / step);
        for (let p = 0; p < points; p++) {
          const v = (data[p * step] - 128) / 128;
          const x = (p / (points - 1)) * w;
          const y = centerY - v * amp;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
      }
      // Soft halo, then the crisp line (defaults: alpha 0.18 / 0.6, width 6 / 1.6).
      ctx.globalAlpha = s.opacity * 0.53;
      ctx.lineWidth = s.lineWidth * 3.75;
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, s.opacity * 1.76);
      ctx.lineWidth = s.lineWidth;
      this.applyGlow(ctx);
      ctx.stroke();
      this.clearGlow(ctx);
      ctx.globalAlpha = 1;
    }
  }

  globalThis.Visualizer = Visualizer;
})();
