'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assetUrl, buildSkinCss } = require('../src/shared/skin-css.js');
const { normalizeManifest } = require('../src/shared/skin-manifest.js');

const BASE = 'skin://bundled-neon/';

function skin(extra) {
  const r = normalizeManifest({ schema: 1, id: 'neon', name: 'Neon', ...extra });
  assert.equal(r.ok, true);
  return r.skin;
}

test('assetUrl encodes each path segment under the base url', () => {
  assert.equal(assetUrl(BASE, 'img/bg.svg'), 'skin://bundled-neon/img/bg.svg');
  assert.equal(assetUrl(BASE, 'fonts/My Font#1.woff2'), 'skin://bundled-neon/fonts/My%20Font%231.woff2');
});

test('buildSkinCss emits tokens scoped to the card', () => {
  const css = buildSkinCss(skin({ vars: { '--skin-bg': '#101010', '--skin-radius': '4px' } }), BASE);
  assert.match(css, /\.card \{\n {2}--skin-bg: #101010;\n {2}--skin-radius: 4px;\n\}/);
});

test('buildSkinCss rewrites local urls to absolute skin urls and keeps data urls', () => {
  const css = buildSkinCss(
    skin({ vars: { '--skin-bg-image': 'url("tex/brushed metal.svg")', '--skin-overlay': 'url(data:image/png;base64,AAAA)' } }),
    BASE
  );
  assert.ok(css.includes('--skin-bg-image: url("skin://bundled-neon/tex/brushed%20metal.svg");'));
  assert.ok(css.includes('--skin-overlay: url("data:image/png;base64,AAAA");'));
});

test('buildSkinCss registers fonts with @font-face', () => {
  const css = buildSkinCss(skin({ fonts: [{ family: 'Pixel Mono', file: 'fonts/pixel.woff2', weight: 700 }] }), BASE);
  assert.ok(css.includes('@font-face {'));
  assert.ok(css.includes('font-family: "Pixel Mono";'));
  assert.ok(css.includes('src: url("skin://bundled-neon/fonts/pixel.woff2") format("woff2");'));
  assert.ok(css.includes('font-weight: 700;'));
});

test('buildSkinCss with no tokens or fonts still yields a valid empty rule', () => {
  const css = buildSkinCss(skin(), BASE);
  assert.ok(css.includes('.card {\n}'));
  assert.ok(!css.includes('@font-face'));
});

test('buildSkinCss requires a base url ending in a slash', () => {
  assert.throws(() => buildSkinCss(skin(), 'skin://bundled-neon'));
});
