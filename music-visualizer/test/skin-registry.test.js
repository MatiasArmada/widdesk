'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkinRegistry, DEFAULT_SKIN_KEY, TOKENS_FILE } = require('../src/main/skin-registry.js');

const silent = { warn() {}, info() {}, log() {} };

/** Builds a temporary skins tree: { bundled: {folder: files}, user: {folder: files} }. */
function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-test-'));
  const dirs = {};
  for (const [source, folders] of Object.entries(spec)) {
    dirs[source] = path.join(root, source);
    fs.mkdirSync(dirs[source], { recursive: true });
    for (const [folder, files] of Object.entries(folders)) {
      const dir = path.join(dirs[source], folder);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
      }
    }
  }
  return { root, dirs };
}

function registryFor(spec, log = silent) {
  const { root, dirs } = makeTree(spec);
  const roots = [
    { source: 'bundled', dir: dirs.bundled || path.join(root, 'none-bundled') },
    { source: 'user', dir: dirs.user || path.join(root, 'none-user') },
  ];
  const reg = new SkinRegistry({ roots, log });
  reg.reload();
  return { reg, root, dirs };
}

const m = (id, name, extra) => ({ schema: 1, id, name, ...extra });

test('discovers bundled and user skins with source-prefixed keys', () => {
  const { reg } = registryFor({
    bundled: { default: { 'manifest.json': m('default', 'Default') }, neon: { 'manifest.json': m('neon', 'Neon') } },
    user: { mine: { 'manifest.json': m('neon', 'My Neon') } },
  });
  const keys = reg.list().map((s) => s.key);
  assert.deepEqual(keys, [DEFAULT_SKIN_KEY, 'bundled-neon', 'user-neon']);
  assert.equal(reg.get('user-neon').skin.name, 'My Neon');
  assert.equal(reg.list()[2].source, 'user');
});

test('skips invalid manifests, broken json and duplicate ids without throwing', () => {
  const warnings = [];
  const { reg } = registryFor(
    {
      bundled: {
        default: { 'manifest.json': m('default', 'Default') },
        broken: { 'manifest.json': '{ nope' },
        bad: { 'manifest.json': m('Bad Id', 'Bad') },
        empty: {},
        dup: { 'manifest.json': m('default', 'Second default') },
      },
    },
    { warn: (msg) => warnings.push(msg), info() {}, log() {} }
  );
  assert.deepEqual(reg.list().map((s) => s.key), [DEFAULT_SKIN_KEY]);
  assert.equal(reg.get(DEFAULT_SKIN_KEY).skin.name, 'Default');
  assert.ok(warnings.length >= 4, warnings.join('\n'));
});

test('a missing user skins folder is not an error', () => {
  const { reg } = registryFor({ bundled: { default: { 'manifest.json': m('default', 'Default') } } });
  assert.equal(reg.list().length, 1);
});

test('resolveSelection falls back to the default skin, then to the first one', () => {
  const { reg } = registryFor({
    bundled: { default: { 'manifest.json': m('default', 'Default') }, neon: { 'manifest.json': m('neon', 'Neon') } },
  });
  assert.equal(reg.resolveSelection('bundled-neon'), 'bundled-neon');
  assert.equal(reg.resolveSelection('user-gone'), DEFAULT_SKIN_KEY);
  assert.equal(reg.resolveSelection(null), DEFAULT_SKIN_KEY);

  const only = registryFor({ bundled: { neon: { 'manifest.json': m('neon', 'Neon') } } }).reg;
  assert.equal(only.resolveSelection('nope'), 'bundled-neon');

  const none = registryFor({}).reg;
  assert.equal(none.resolveSelection('nope'), null);
});

test('describe returns stylesheet urls and the normalized visualizer', () => {
  const { reg } = registryFor({
    bundled: {
      neon: { 'manifest.json': m('neon', 'Neon', { visualizer: { mode: 'wave' } }), 'skin.css': '.title{}' },
      plain: { 'manifest.json': m('plain', 'Plain') },
    },
  });
  const neon = reg.describe('bundled-neon');
  assert.equal(neon.key, 'bundled-neon');
  assert.equal(neon.visualizer.mode, 'wave');
  assert.equal(neon.stylesheets.length, 2);
  assert.match(neon.stylesheets[0], /^skin:\/\/bundled-neon\/\.tokens\.css\?v=\d+$/);
  assert.match(neon.stylesheets[1], /^skin:\/\/bundled-neon\/skin\.css\?v=\d+$/);
  assert.equal(reg.describe('bundled-plain').stylesheets.length, 1);
  assert.equal(reg.describe('nope'), null);
});

async function get(reg, url) {
  const res = await reg.handleRequest({ url, method: 'GET' });
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text(), headers: res.headers };
}

test('handleRequest serves generated tokens and skin assets', async () => {
  const { reg } = registryFor({
    bundled: {
      neon: {
        'manifest.json': m('neon', 'Neon', { vars: { '--skin-bg-image': 'url(img/grid.svg)' } }),
        'skin.css': '.title{color:red}',
        'img/grid.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      },
    },
  });
  const tokens = await get(reg, `skin://bundled-neon/${TOKENS_FILE}?v=3`);
  assert.equal(tokens.status, 200);
  assert.match(tokens.type, /^text\/css/);
  assert.ok(tokens.body.includes('url("skin://bundled-neon/img/grid.svg")'));

  const css = await get(reg, 'skin://bundled-neon/skin.css');
  assert.equal(css.body, '.title{color:red}');

  const svg = await get(reg, 'skin://BUNDLED-NEON/img/grid.svg');
  assert.equal(svg.status, 200);
  assert.equal(svg.type, 'image/svg+xml');
  assert.equal(svg.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(svg.headers.get('access-control-allow-origin'), '*');
});

test('handleRequest refuses traversal, unknown skins, non-assets and other methods', async () => {
  const { reg, dirs } = registryFor({
    bundled: { neon: { 'manifest.json': m('neon', 'Neon'), 'a.svg': '<svg/>', 'evil.js': 'alert(1)' } },
  });
  fs.writeFileSync(path.join(dirs.bundled, 'outside.svg'), '<svg/>');
  const urls = [
    'skin://bundled-neon/..%2foutside.svg',
    'skin://bundled-neon/%2e%2e/outside.svg',
    'skin://bundled-neon/..%5Coutside.svg',
    'skin://bundled-neon/evil.js',
    'skin://bundled-neon/manifest.json',
    'skin://bundled-neon/missing.svg',
    'skin://bundled-other/a.svg',
    'skin://bundled-neon/',
    'not a url',
  ];
  for (const url of urls) {
    const res = await get(reg, url);
    assert.equal(res.status, 404, url);
  }
  const post = await reg.handleRequest({ url: 'skin://bundled-neon/a.svg', method: 'POST' });
  assert.equal(post.status, 405);
});

test('handleRequest refuses files that escape the skin folder through a link', async (t) => {
  const { reg, dirs } = registryFor({ bundled: { neon: { 'manifest.json': m('neon', 'Neon') } } });
  const outside = path.join(dirs.bundled, 'secret');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'x.svg'), '<svg/>');
  try {
    fs.symlinkSync(outside, path.join(dirs.bundled, 'neon', 'link'), 'junction');
  } catch {
    t.skip('cannot create links here');
    return;
  }
  const res = await get(reg, 'skin://bundled-neon/link/x.svg');
  assert.equal(res.status, 404);
});

test('reload bumps the generation so stylesheet urls change', () => {
  const { reg } = registryFor({ bundled: { neon: { 'manifest.json': m('neon', 'Neon') } } });
  const before = reg.describe('bundled-neon').stylesheets[0];
  reg.reload();
  assert.notEqual(reg.describe('bundled-neon').stylesheets[0], before);
});

test('every bundled skin loads without warnings and the default skin exists', () => {
  const warnings = [];
  const reg = new SkinRegistry({
    roots: [{ source: 'bundled', dir: path.join(__dirname, '..', 'skins') }],
    log: { warn: (msg) => warnings.push(msg), info() {}, log() {} },
  });
  reg.reload();
  assert.deepEqual(warnings, []);
  const keys = reg.list().map((s) => s.key);
  assert.equal(keys[0], DEFAULT_SKIN_KEY);
  assert.ok(keys.length >= 5, keys.join(', '));
  for (const s of reg.list()) assert.ok(s.swatch.length > 0, `${s.key} has a swatch`);
});
