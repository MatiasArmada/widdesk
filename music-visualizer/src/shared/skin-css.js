/*
 * Builds the token stylesheet for a normalized skin (see skin-manifest.js).
 * Pure module: usable from Node (CommonJS) and from the renderer (global).
 *
 * Input values are already validated, so this only rewrites canonical local
 * url("rel/path") references into absolute asset urls and formats the CSS.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.WidgetSkinCss = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CANONICAL_URL_RE = /url\("([^"]*)"\)/g;

  /** Absolute url for a normalized relative asset path, e.g. skin://bundled-neon/img/a.svg. */
  function assetUrl(baseUrl, relPath) {
    return baseUrl + relPath.split('/').map(encodeURIComponent).join('/');
  }

  function rewriteUrls(value, baseUrl) {
    return value.replace(CANONICAL_URL_RE, (_m, inner) =>
      /^data:/i.test(inner) ? `url("${inner}")` : `url("${assetUrl(baseUrl, inner)}")`
    );
  }

  /**
   * @param {{ id: string, vars: Record<string, string>, fonts: Array<{family, file, weight, style, format}> }} skin
   * @param {string} baseUrl  must end with "/"
   * @returns {string}
   */
  function buildSkinCss(skin, baseUrl) {
    if (typeof baseUrl !== 'string' || !baseUrl.endsWith('/')) throw new Error('baseUrl must end with "/"');
    const out = [`/* Generated tokens for skin "${skin.id}" */`];

    for (const f of skin.fonts || []) {
      out.push(
        '@font-face {',
        `  font-family: "${f.family}";`,
        `  src: url("${assetUrl(baseUrl, f.file)}") format("${f.format}");`,
        `  font-weight: ${f.weight};`,
        `  font-style: ${f.style};`,
        '  font-display: swap;',
        '}'
      );
    }

    // Tokens live on .card (not :root) so var(--accent) inside a token value
    // resolves against the card, where the live accent colors are set.
    out.push('.card {');
    for (const [name, value] of Object.entries(skin.vars || {})) {
      out.push(`  ${name}: ${rewriteUrls(value, baseUrl)};`);
    }
    out.push('}');
    return `${out.join('\n')}\n`;
  }

  return { assetUrl, buildSkinCss };
});
