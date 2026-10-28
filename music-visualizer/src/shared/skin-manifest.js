/*
 * Skin manifest validation and normalization.
 * Pure module: usable from Node (CommonJS) and from the renderer (global).
 *
 * A skin is data, never code: this module turns an untrusted manifest.json into
 * a normalized object where every value is bounded, every CSS value passed a
 * conservative allow-list, and every asset path is relative to the skin folder.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.WidgetSkinManifest = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  /** Every CSS custom property a skin may set. The app's CSS consumes exactly these. */
  const TOKENS = Object.freeze([
    // Accent
    '--skin-accent',
    '--skin-accent-2',
    // Card surface
    '--skin-bg',
    '--skin-bg-image',
    '--skin-border',
    '--skin-radius',
    '--skin-shadow',
    '--skin-overlay',
    '--skin-overlay-opacity',
    '--skin-overlay-blend',
    // Text
    '--skin-fg',
    '--skin-fg-dim',
    '--skin-fg-faint',
    '--skin-font',
    '--skin-font-title',
    '--skin-font-mono',
    '--skin-title-color',
    '--skin-title-weight',
    '--skin-title-transform',
    '--skin-title-spacing',
    '--skin-text-shadow',
    // Title bar strip and the track info "display"
    '--skin-titlebar-bg',
    '--skin-titlebar-border',
    '--skin-display-bg',
    '--skin-display-border',
    '--skin-display-radius',
    '--skin-display-shadow',
    // Buttons
    '--skin-button-fg',
    '--skin-button-bg',
    '--skin-button-image',
    '--skin-button-border',
    '--skin-button-radius',
    '--skin-button-shadow',
    '--skin-button-hover-bg',
    '--skin-button-hover-fg',
    '--skin-control-fg',
    '--skin-control-radius',
    '--skin-close-hover-bg',
    '--skin-close-hover-fg',
    '--skin-pin-active',
    '--skin-chip-border',
    '--skin-focus',
    // Play button
    '--skin-play-bg',
    '--skin-play-fg',
    '--skin-play-hover-bg',
    '--skin-play-border',
    '--skin-play-radius',
    '--skin-play-shadow',
    // Album art
    '--skin-art-bg',
    '--skin-art-border',
    '--skin-art-radius',
    '--skin-art-shadow',
    '--skin-art-icon',
    // Seek bar
    '--skin-track-bg',
    '--skin-track-fill',
    '--skin-track-radius',
    '--skin-thumb-bg',
    '--skin-thumb-radius',
    '--skin-thumb-shadow',
    // Skin picker menu
    '--skin-menu-bg',
    '--skin-menu-fg',
    '--skin-menu-border',
    '--skin-menu-radius',
    '--skin-menu-shadow',
    '--skin-menu-hover-bg',
  ]);
  const TOKEN_SET = new Set(TOKENS);

  const VISUALIZER_DEFAULTS = Object.freeze({
    mode: 'bars',
    barCount: 48,
    colors: null, // null: follow the live accent colors
    peakColor: null, // null: no peak caps
    glow: 0,
    lineWidth: 1.6,
    barGap: 0.42,
    barRadius: 1,
    opacity: 0.34,
    reflection: true,
    gradient: 'horizontal',
  });
  const VISUALIZER_MODES = ['bars', 'wave'];
  const GRADIENTS = ['horizontal', 'vertical'];
  const MAX_VIS_COLORS = 8;

  const KNOWN_KEYS = new Set(['schema', 'id', 'name', 'author', 'description', 'vars', 'visualizer', 'fonts', 'adaptiveAccent', 'swatch']);
  const MAX_FONTS = 8;
  const MAX_SWATCH = 4;
  const MAX_VALUE_LENGTH = 4000;
  const MAX_PATH_LENGTH = 200;
  const MAX_PATH_SEGMENTS = 8;

  const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
  const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/;
  const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
  const CONTROL_TEST_RE = /[\u0000-\u001f\u007f]/;

  const EXTENSIONS = {
    image: { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' },
    font: { woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' },
    style: { css: 'text/css; charset=utf-8' },
  };
  const FONT_FORMATS = { woff: 'woff', woff2: 'woff2', ttf: 'truetype', otf: 'opentype' };
  const PATH_CHARS_RE = /^[A-Za-z0-9 ._/-]+$/;
  const RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

  const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const FUNC_COLOR_RE = /^(?:rgba?|hsla?)\([\d\s.,%/+-]*(?:deg|turn|rad)?[\d\s.,%/+-]*\)$/i;
  const NAMED_COLOR_RE = /^[a-z]{3,24}$/i;

  // Characters that could end a declaration, start a rule or at-rule, escape,
  // or smuggle markup. Newlines are rejected too (no multi-line values).
  const FORBIDDEN_VALUE_RE = /[\u0000-\u001f\u007f;{}<>\\@!`]/;
  const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]*))\s*\)/gi;
  const DATA_URL_RE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)(?:;base64)?,[A-Za-z0-9+/=%._~-]*$/i;
  const FUNCTION_RE = /([A-Za-z_-][\w-]*)\(/g;
  const ALLOWED_FUNCTIONS = new Set([
    'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix',
    'linear-gradient', 'radial-gradient', 'conic-gradient',
    'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
    'var', 'calc', 'min', 'max', 'clamp', 'cubic-bezier', 'steps',
  ]);

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function text(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(CONTROL_RE, '').trim().slice(0, max).trim();
  }

  function extensionOf(p) {
    const m = /\.([A-Za-z0-9]+)$/.exec(p);
    return m ? m[1].toLowerCase() : '';
  }

  // -------------------------------------------------------------------------
  // Ids, colors, asset paths
  // -------------------------------------------------------------------------
  function isValidSkinId(id) {
    return typeof id === 'string' && ID_RE.test(id);
  }

  /** True for a plain color (hex, rgb()/hsl() with numeric args, or a named color). */
  function isSafeColor(value) {
    if (typeof value !== 'string') return false;
    const v = value.trim();
    return HEX_COLOR_RE.test(v) || FUNC_COLOR_RE.test(v) || NAMED_COLOR_RE.test(v);
  }

  /** MIME type of a servable skin asset, or null when the extension is not allowed. */
  function mimeTypeFor(p) {
    const ext = extensionOf(String(p));
    return EXTENSIONS.image[ext] || EXTENSIONS.font[ext] || EXTENSIONS.style[ext] || null;
  }

  /**
   * Normalizes a path that must point inside the skin folder.
   * Returns a "/"-separated relative path, or null when the path is unsafe
   * (absolute, traversal, scheme, encoded, hidden, reserved) or has an
   * extension not allowed for `kind` ('image' | 'font' | 'style' | 'any').
   */
  function normalizeAssetPath(value, kind = 'any') {
    if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH) return null;
    const p = value.replace(/\\/g, '/');
    if (!PATH_CHARS_RE.test(p)) return null; // also rejects ":" (schemes, drives) and "%" (encoding)
    const segments = p.split('/').filter((s) => s !== '.');
    if (!segments.length || segments.length > MAX_PATH_SEGMENTS) return null;
    for (const s of segments) {
      if (!s || s === '..' || s.startsWith('.') || s.startsWith(' ') || s.endsWith(' ') || s.endsWith('.')) return null;
      if (RESERVED_NAME_RE.test(s)) return null;
    }
    const out = segments.join('/');
    const ext = extensionOf(out);
    const allowed = kind === 'any' ? mimeTypeFor(out) !== null : Boolean(EXTENSIONS[kind] && EXTENSIONS[kind][ext]);
    return allowed ? out : null;
  }

  // -------------------------------------------------------------------------
  // CSS values
  // -------------------------------------------------------------------------
  function canonicalUrl(inner) {
    if (/^data:/i.test(inner)) return DATA_URL_RE.test(inner) ? inner : null;
    return normalizeAssetPath(inner, 'image');
  }

  /** True when quotes are closed and parentheses balanced outside strings. */
  function isBalanced(v) {
    let depth = 0;
    let quote = '';
    for (const ch of v) {
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        if (--depth < 0) return false;
      }
    }
    return depth === 0 && !quote;
  }

  /**
   * Validates one custom property value against a conservative grammar.
   * Local url() references are rewritten to the canonical form url("rel/path");
   * small inline image data urls are kept. Returns the value or null.
   */
  function normalizeCssValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v || v.length > MAX_VALUE_LENGTH || CONTROL_TEST_RE.test(v)) return null;

    // url() contents are validated on their own (a data url legitimately holds ";"),
    // then the remaining text must pass the strict character and function checks.
    const urls = [];
    let badUrl = false;
    const rest = v.replace(URL_RE, (_m, dq, sq, bare) => {
      const canon = canonicalUrl((dq ?? sq ?? bare).trim());
      if (canon === null) badUrl = true;
      urls.push(canon);
      return `__URL${urls.length - 1}__`;
    });
    if (badUrl || FORBIDDEN_VALUE_RE.test(rest) || rest.includes('/*')) return null;
    if (/url\s*\(/i.test(rest) || rest.includes(':') || !isBalanced(rest)) return null;

    for (const [, name] of rest.matchAll(FUNCTION_RE)) {
      if (!ALLOWED_FUNCTIONS.has(name.toLowerCase())) return null;
    }
    return rest.replace(/__URL(\d+)__/g, (_m, i) => `url("${urls[Number(i)]}")`);
  }

  // -------------------------------------------------------------------------
  // Visualizer
  // -------------------------------------------------------------------------
  function num(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function normalizeVisualizer(raw) {
    const d = VISUALIZER_DEFAULTS;
    const v = isPlainObject(raw) ? raw : {};
    let colors = null;
    if (Array.isArray(v.colors)) {
      const safe = v.colors.filter(isSafeColor).map((c) => c.trim()).slice(0, MAX_VIS_COLORS);
      colors = safe.length ? safe : null;
    }
    return {
      mode: VISUALIZER_MODES.includes(v.mode) ? v.mode : d.mode,
      barCount: Math.round(num(v.barCount, 8, 96, d.barCount)),
      colors,
      peakColor: isSafeColor(v.peakColor) ? v.peakColor.trim() : d.peakColor,
      glow: num(v.glow, 0, 24, d.glow),
      lineWidth: num(v.lineWidth, 0.5, 6, d.lineWidth),
      barGap: num(v.barGap, 0, 0.9, d.barGap),
      barRadius: num(v.barRadius, 0, 1, d.barRadius),
      opacity: num(v.opacity, 0.05, 1, d.opacity),
      reflection: typeof v.reflection === 'boolean' ? v.reflection : d.reflection,
      gradient: GRADIENTS.includes(v.gradient) ? v.gradient : d.gradient,
    };
  }

  // -------------------------------------------------------------------------
  // Manifest
  // -------------------------------------------------------------------------
  function normalizeVars(raw, warnings) {
    const vars = {};
    if (raw === undefined) return vars;
    if (!isPlainObject(raw)) {
      warnings.push('"vars" must be an object; ignored');
      return vars;
    }
    for (const [name, value] of Object.entries(raw)) {
      if (!TOKEN_SET.has(name)) {
        warnings.push(`Unknown token "${String(name).slice(0, 60)}" ignored`);
        continue;
      }
      const css = normalizeCssValue(value);
      if (css === null) warnings.push(`Unsafe or invalid value for ${name} ignored`);
      else vars[name] = css;
    }
    return vars;
  }

  function normalizeFonts(raw, warnings) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      warnings.push('"fonts" must be an array; ignored');
      return [];
    }
    const fonts = [];
    for (const f of raw.slice(0, MAX_FONTS)) {
      const family = isPlainObject(f) && typeof f.family === 'string' ? f.family.trim() : '';
      const file = isPlainObject(f) ? normalizeAssetPath(f.file, 'font') : null;
      if (!FAMILY_RE.test(family) || !file) {
        warnings.push('Invalid font entry ignored (needs a simple "family" and a local woff/woff2/ttf/otf "file")');
        continue;
      }
      let weight = 'normal';
      if (Number.isInteger(f.weight) && f.weight >= 100 && f.weight <= 900) weight = String(f.weight);
      else if (f.weight === 'bold') weight = 'bold';
      const style = f.style === 'italic' ? 'italic' : 'normal';
      fonts.push({ family, file, weight, style, format: FONT_FORMATS[extensionOf(file)] });
    }
    return fonts;
  }

  function deriveSwatch(raw, vars, visualizer) {
    const source = Array.isArray(raw)
      ? raw
      : [vars['--skin-bg'], vars['--skin-accent'], vars['--skin-accent-2'], vars['--skin-fg'], ...(visualizer.colors || [])];
    const out = [];
    for (const c of source) {
      if (isSafeColor(c) && !out.includes(c.trim())) out.push(c.trim());
      if (out.length === MAX_SWATCH) break;
    }
    return out;
  }

  /**
   * Validates an untrusted manifest.
   * @returns {{ ok: true, skin: object, warnings: string[], errors: string[] }
   *         | { ok: false, errors: string[], warnings: string[] }}
   */
  function normalizeManifest(raw) {
    const errors = [];
    const warnings = [];
    if (!isPlainObject(raw)) return { ok: false, errors: ['Manifest must be a JSON object'], warnings };

    if (raw.schema !== SCHEMA_VERSION) errors.push(`Unsupported "schema" (expected ${SCHEMA_VERSION})`);
    if (!isValidSkinId(raw.id)) errors.push('"id" must be 1-40 lowercase letters, digits or inner dashes');
    const name = text(raw.name, 40);
    if (!name) errors.push('"name" is required');
    if (errors.length) return { ok: false, errors, warnings };

    for (const key of Object.keys(raw)) {
      if (!KNOWN_KEYS.has(key)) warnings.push(`Unknown manifest field "${key.slice(0, 60)}" ignored`);
    }

    const vars = normalizeVars(raw.vars, warnings);
    const visualizer = normalizeVisualizer(raw.visualizer);
    const skin = {
      schema: SCHEMA_VERSION,
      id: raw.id,
      name,
      author: text(raw.author, 60),
      description: text(raw.description, 200),
      vars,
      visualizer,
      fonts: normalizeFonts(raw.fonts, warnings),
      adaptiveAccent: raw.adaptiveAccent === true,
      swatch: deriveSwatch(raw.swatch, vars, visualizer),
    };
    return { ok: true, skin, warnings, errors };
  }

  return {
    SCHEMA_VERSION,
    TOKENS,
    VISUALIZER_DEFAULTS,
    isValidSkinId,
    isSafeColor,
    mimeTypeFor,
    normalizeAssetPath,
    normalizeCssValue,
    normalizeVisualizer,
    normalizeManifest,
  };
});
