'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA_VERSION,
  TOKENS,
  VISUALIZER_DEFAULTS,
  isValidSkinId,
  isSafeColor,
  normalizeAssetPath,
  normalizeCssValue,
  normalizeVisualizer,
  normalizeManifest,
  mimeTypeFor,
} = require('../src/shared/skin-manifest.js');

function manifest(extra) {
  return { schema: 1, id: 'neon', name: 'Neon', ...extra };
}

// ---------------------------------------------------------------------------
// ids, colors, paths
// ---------------------------------------------------------------------------
test('isValidSkinId accepts short lowercase slugs only', () => {
  assert.equal(isValidSkinId('default'), true);
  assert.equal(isValidSkinId('chrome-amp'), true);
  assert.equal(isValidSkinId('y2k'), true);
  assert.equal(isValidSkinId('Neon'), false);
  assert.equal(isValidSkinId('-neon'), false);
  assert.equal(isValidSkinId('neon-'), false);
  assert.equal(isValidSkinId('neon_drive'), false);
  assert.equal(isValidSkinId('a.b'), false);
  assert.equal(isValidSkinId(''), false);
  assert.equal(isValidSkinId('x'.repeat(41)), false);
  assert.equal(isValidSkinId(42), false);
});

test('isSafeColor accepts hex, rgb/hsl functions and named colors', () => {
  for (const c of ['#fff', '#ffff', '#a1b2c3', '#a1b2c3d4', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(200 80% 50%)', 'hsl(200deg 80% 50% / 0.4)', 'transparent', 'white']) {
    assert.equal(isSafeColor(c), true, c);
  }
});

test('isSafeColor rejects anything that is not a plain color', () => {
  for (const c of ['#ggg', '#12345', 'url(x.png)', 'rgb(1,2,3);color:red', 'var(--x)', 'linear-gradient(red, blue)', '', null, 7]) {
    assert.equal(isSafeColor(c), false, String(c));
  }
});

test('normalizeAssetPath keeps safe relative paths inside the skin folder', () => {
  assert.equal(normalizeAssetPath('bg.svg'), 'bg.svg');
  assert.equal(normalizeAssetPath('./img/bg.svg'), 'img/bg.svg');
  assert.equal(normalizeAssetPath('img\\noise.png'), 'img/noise.png');
  assert.equal(normalizeAssetPath('fonts/My Font.woff2', 'font'), 'fonts/My Font.woff2');
});

test('normalizeAssetPath rejects traversal, absolute paths and remote urls', () => {
  const bad = [
    '../secret.png',
    'img/../../x.png',
    'img/..',
    '/etc/passwd.png',
    '\\\\server\\share\\x.png',
    'C:/Windows/x.png',
    'C:x.png',
    'http://evil.example/x.png',
    'https://evil.example/x.png',
    '//evil.example/x.png',
    'file:///C:/x.png',
    'data:image/png;base64,AAAA',
    '%2e%2e/x.png',
    '.hidden/x.png',
    'img//x.png',
    'x.png\u0000',
    '',
    null,
  ];
  for (const p of bad) assert.equal(normalizeAssetPath(p), null, String(p));
});

test('normalizeAssetPath filters by asset kind', () => {
  assert.equal(normalizeAssetPath('bg.svg', 'image'), 'bg.svg');
  assert.equal(normalizeAssetPath('font.woff2', 'image'), null);
  assert.equal(normalizeAssetPath('font.ttf', 'font'), 'font.ttf');
  assert.equal(normalizeAssetPath('bg.png', 'font'), null);
  assert.equal(normalizeAssetPath('evil.js'), null);
  assert.equal(normalizeAssetPath('page.html'), null);
  assert.equal(normalizeAssetPath('manifest.json'), null);
});

test('mimeTypeFor maps servable extensions and nothing else', () => {
  assert.equal(mimeTypeFor('a/b.svg'), 'image/svg+xml');
  assert.equal(mimeTypeFor('skin.css'), 'text/css; charset=utf-8');
  assert.equal(mimeTypeFor('f.WOFF2'), 'font/woff2');
  assert.equal(mimeTypeFor('x.js'), null);
  assert.equal(mimeTypeFor('x'), null);
});

// ---------------------------------------------------------------------------
// CSS values
// ---------------------------------------------------------------------------
test('normalizeCssValue accepts colors, gradients, fonts, lengths and var()', () => {
  assert.equal(normalizeCssValue('#123456'), '#123456');
  assert.equal(normalizeCssValue('  12px  '), '12px');
  assert.equal(normalizeCssValue("'Lucida Console', 'Courier New', monospace"), "'Lucida Console', 'Courier New', monospace");
  assert.equal(
    normalizeCssValue('linear-gradient(180deg, color-mix(in srgb, var(--accent) 40%, #000), #111)'),
    'linear-gradient(180deg, color-mix(in srgb, var(--accent) 40%, #000), #111)'
  );
  assert.equal(normalizeCssValue('inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 calc(2px * 3) #000'), 'inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 calc(2px * 3) #000');
  assert.equal(normalizeCssValue(0.5), '0.5');
});

test('normalizeCssValue canonicalizes local url() references', () => {
  assert.equal(normalizeCssValue('url(img/bg.svg)'), 'url("img/bg.svg")');
  assert.equal(normalizeCssValue("url( './bg.svg' ) repeat"), 'url("bg.svg") repeat');
  assert.equal(normalizeCssValue('url("a.png"), linear-gradient(#000, #111)'), 'url("a.png"), linear-gradient(#000, #111)');
});

test('normalizeCssValue keeps small inline image data urls', () => {
  const svg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E';
  assert.equal(normalizeCssValue(`url("${svg}")`), null, 'whitespace and quotes are not allowed inside data urls');
  const ok = 'data:image/svg+xml;base64,PHN2Zy8+';
  assert.equal(normalizeCssValue(`url(${ok})`), `url("${ok}")`);
  assert.equal(normalizeCssValue('url(data:text/html;base64,PHNjcmlwdD4=)'), null);
});

test('normalizeCssValue rejects unsafe or malformed values', () => {
  const bad = [
    'red; color: blue',
    'red } body { display: none',
    '@import "x.css"',
    'red !important',
    'url(../x.png)',
    'url(https://evil.example/x.png)',
    'url(//evil.example/x.png)',
    'url(x.js)',
    'url(a.png',
    'u\\72l(x.png)',
    'image-set("x.png" 1x)',
    'expression(alert(1))',
    'javascript:alert(1)',
    "'unterminated",
    'rgb(1, 2, 3',
    'calc(1px))',
    'red /* comment */',
    '<b>',
    'line\nbreak',
    '',
    '   ',
    null,
    {},
    'x'.repeat(5000),
  ];
  for (const v of bad) assert.equal(normalizeCssValue(v), null, String(v));
});

// ---------------------------------------------------------------------------
// Visualizer
// ---------------------------------------------------------------------------
test('normalizeVisualizer returns defaults for missing or invalid input', () => {
  assert.deepEqual(normalizeVisualizer(undefined), VISUALIZER_DEFAULTS);
  assert.deepEqual(normalizeVisualizer('bars'), VISUALIZER_DEFAULTS);
  assert.deepEqual(
    normalizeVisualizer({ mode: 'spiral', barCount: 'many', colors: 'red', glow: NaN, reflection: 'yes', gradient: 'diagonal' }),
    VISUALIZER_DEFAULTS
  );
});

test('normalizeVisualizer clamps numbers into their ranges', () => {
  const v = normalizeVisualizer({ barCount: 1000, glow: -4, lineWidth: 99, barGap: 2, barRadius: -1, opacity: 0 });
  assert.equal(v.barCount, 96);
  assert.equal(v.glow, 0);
  assert.equal(v.lineWidth, 6);
  assert.equal(v.barGap, 0.9);
  assert.equal(v.barRadius, 0);
  assert.equal(v.opacity, 0.05);
  assert.equal(normalizeVisualizer({ barCount: 2 }).barCount, 8);
  assert.equal(normalizeVisualizer({ barCount: 31.6 }).barCount, 32);
});

test('normalizeVisualizer keeps valid settings and only safe colors', () => {
  const v = normalizeVisualizer({
    mode: 'wave',
    colors: ['#f0f', 'url(x.png)', 'hsl(180 100% 50%)', 12],
    peakColor: '#fff',
    reflection: false,
    gradient: 'vertical',
  });
  assert.equal(v.mode, 'wave');
  assert.deepEqual(v.colors, ['#f0f', 'hsl(180 100% 50%)']);
  assert.equal(v.peakColor, '#fff');
  assert.equal(v.reflection, false);
  assert.equal(v.gradient, 'vertical');
  assert.equal(normalizeVisualizer({ colors: ['nope('] }).colors, null);
  assert.equal(normalizeVisualizer({ peakColor: 'var(--x)' }).peakColor, null);
  assert.equal(normalizeVisualizer({ colors: Array(20).fill('#000') }).colors.length, 8);
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
test('TOKENS is a finite list of --skin-* custom properties', () => {
  assert.ok(TOKENS.length > 20);
  for (const t of TOKENS) assert.match(t, /^--skin-[a-z0-9-]+$/);
  assert.equal(new Set(TOKENS).size, TOKENS.length);
  for (const t of ['--skin-bg', '--skin-bg-image', '--skin-fg', '--skin-accent', '--skin-font', '--skin-font-title', '--skin-border', '--skin-radius', '--skin-button-bg', '--skin-button-image']) {
    assert.ok(TOKENS.includes(t), t);
  }
});

test('normalizeManifest accepts a minimal manifest and fills defaults', () => {
  const r = normalizeManifest(manifest());
  assert.equal(r.ok, true);
  assert.equal(r.skin.schema, SCHEMA_VERSION);
  assert.equal(r.skin.id, 'neon');
  assert.equal(r.skin.name, 'Neon');
  assert.equal(r.skin.author, '');
  assert.equal(r.skin.description, '');
  assert.deepEqual(r.skin.vars, {});
  assert.deepEqual(r.skin.fonts, []);
  assert.deepEqual(r.skin.visualizer, VISUALIZER_DEFAULTS);
  assert.equal(r.skin.adaptiveAccent, false);
  assert.deepEqual(r.warnings, []);
});

test('normalizeManifest rejects bad structure, schema, id or name', () => {
  assert.equal(normalizeManifest(null).ok, false);
  assert.equal(normalizeManifest([]).ok, false);
  assert.equal(normalizeManifest(manifest({ schema: 2 })).ok, false);
  assert.equal(normalizeManifest(manifest({ schema: undefined })).ok, false);
  assert.equal(normalizeManifest(manifest({ id: '../x' })).ok, false);
  assert.equal(normalizeManifest(manifest({ name: '   ' })).ok, false);
  const r = normalizeManifest(manifest({ id: 'Bad Id' }));
  assert.ok(r.errors.length > 0);
});

test('normalizeManifest trims and bounds text fields', () => {
  const r = normalizeManifest(manifest({ name: `  ${'N'.repeat(100)}  `, author: 'Me\u0007', description: 'd'.repeat(500) }));
  assert.equal(r.ok, true);
  assert.equal(r.skin.name.length, 40);
  assert.equal(r.skin.author, 'Me');
  assert.equal(r.skin.description.length, 200);
});

test('normalizeManifest keeps known tokens and drops unknown or unsafe ones with warnings', () => {
  const r = normalizeManifest(
    manifest({
      vars: {
        '--skin-bg': '#101010',
        '--skin-bg-image': 'url(tex/brushed.svg)',
        '--skin-fg': 'red; background: url(http://x)',
        '--skin-made-up': '#fff',
        color: 'red',
      },
    })
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.skin.vars, { '--skin-bg': '#101010', '--skin-bg-image': 'url("tex/brushed.svg")' });
  assert.equal(r.warnings.length, 3);
});

test('normalizeManifest validates fonts', () => {
  const r = normalizeManifest(
    manifest({
      fonts: [
        { family: 'Pixel Mono', file: 'fonts/pixel.woff2' },
        { family: 'Bold One', file: 'b.ttf', weight: 700, style: 'italic' },
        { family: 'Evil"; } body {', file: 'x.woff' },
        { family: 'Remote', file: 'https://x/y.woff' },
        { family: 'Wrong', file: 'pic.png' },
      ],
    })
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.skin.fonts, [
    { family: 'Pixel Mono', file: 'fonts/pixel.woff2', weight: 'normal', style: 'normal', format: 'woff2' },
    { family: 'Bold One', file: 'b.ttf', weight: '700', style: 'italic', format: 'truetype' },
  ]);
  assert.equal(r.warnings.length, 3);
});

test('normalizeManifest reads adaptiveAccent and a safe swatch', () => {
  const r = normalizeManifest(manifest({ adaptiveAccent: true, swatch: ['#000', 'url(x.png)', '#f0f'] }));
  assert.equal(r.skin.adaptiveAccent, true);
  assert.deepEqual(r.skin.swatch, ['#000', '#f0f']);
});

test('normalizeManifest derives a swatch from tokens when none is given', () => {
  const r = normalizeManifest(manifest({ vars: { '--skin-accent': '#ff00aa', '--skin-fg': 'var(--x)' }, visualizer: { colors: ['#00ffee'] } }));
  assert.deepEqual(r.skin.swatch, ['#ff00aa', '#00ffee']);
});
