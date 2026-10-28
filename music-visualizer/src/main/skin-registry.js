'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeManifest, normalizeAssetPath, mimeTypeFor } = require('../shared/skin-manifest.js');
const { buildSkinCss } = require('../shared/skin-css.js');

const SCHEME = 'skin';
const DEFAULT_SKIN_KEY = 'bundled-default';
/** Virtual file holding the generated token CSS. Hidden names are never served from disk, so it cannot collide. */
const TOKENS_FILE = '.tokens.css';
const STYLESHEET = 'skin.css';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

const BASE_HEADERS = {
  // Fonts are fetched in CORS mode from the file:// page (origin "null").
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src data: skin:; style-src 'unsafe-inline'",
  'Cache-Control': 'no-cache',
};

function notFound() {
  return new Response('Not found', { status: 404, headers: BASE_HEADERS });
}

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Discovers skins and serves their assets.
 *
 * Skins come from several roots (bundled, then user). Each skin is keyed as
 * "<source>-<id>" (e.g. "bundled-default", "user-neon"), so a user skin never
 * replaces a bundled one: both are listed. Within one root, the first folder
 * (alphabetically) that claims an id wins; later duplicates are skipped.
 */
class SkinRegistry {
  /**
   * @param {{ roots: Array<{source: 'bundled' | 'user', dir: string}>, log?: Console }} opts
   */
  constructor({ roots, log = console }) {
    this.roots = roots;
    this.log = log;
    this.skins = new Map(); // key -> { key, source, dir, skin, hasStylesheet, css }
    this.generation = 0;
  }

  reload() {
    this.generation++;
    this.skins = new Map();
    for (const { source, dir } of this.roots) this.loadRoot(source, dir);
    return this.list();
  }

  loadRoot(source, root) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`[skins] cannot read ${root}: ${err.message}`);
      return;
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const folder of folders) {
      const dir = path.join(root, folder);
      const entry = this.loadSkin(source, dir);
      if (!entry) continue;
      if (this.skins.has(entry.key)) {
        this.log.warn(`[skins] ${dir}: id "${entry.skin.id}" already used by another ${source} skin; skipped`);
        continue;
      }
      this.skins.set(entry.key, entry);
    }
  }

  loadSkin(source, dir) {
    const file = path.join(dir, 'manifest.json');
    let raw;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_MANIFEST_BYTES) throw new Error('manifest.json is too large');
      raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      this.log.warn(`[skins] ${dir}: invalid skin (${err.code === 'ENOENT' ? 'no manifest.json' : err.message})`);
      return null;
    }
    const result = normalizeManifest(raw);
    if (!result.ok) {
      this.log.warn(`[skins] ${dir}: invalid manifest: ${result.errors.join('; ')}`);
      return null;
    }
    for (const w of result.warnings) this.log.warn(`[skins] ${dir}: ${w}`);

    const key = `${source}-${result.skin.id}`;
    let hasStylesheet = false;
    try {
      hasStylesheet = fs.statSync(path.join(dir, STYLESHEET)).isFile();
    } catch {
      /* optional */
    }
    return {
      key,
      source,
      dir,
      skin: result.skin,
      hasStylesheet,
      css: buildSkinCss(result.skin, `${SCHEME}://${key}/`),
    };
  }

  /** Summaries for the picker, default skin first, then bundled, then user, by name. */
  list() {
    const order = (e) => (e.key === DEFAULT_SKIN_KEY ? 0 : e.source === 'bundled' ? 1 : 2);
    return [...this.skins.values()]
      .sort((a, b) => order(a) - order(b) || a.skin.name.localeCompare(b.skin.name))
      .map(({ key, source, skin }) => ({
        key,
        source,
        id: skin.id,
        name: skin.name,
        author: skin.author,
        description: skin.description,
        swatch: skin.swatch,
      }));
  }

  get(key) {
    return this.skins.get(key) || null;
  }

  /** The requested key when it exists, else the default skin, else the first skin, else null. */
  resolveSelection(key) {
    if (typeof key === 'string' && this.skins.has(key)) return key;
    if (this.skins.has(DEFAULT_SKIN_KEY)) return DEFAULT_SKIN_KEY;
    const first = this.list()[0];
    return first ? first.key : null;
  }

  /** What the renderer needs to apply a skin, or null for an unknown key. */
  describe(key) {
    const e = this.get(key);
    if (!e) return null;
    const v = `?v=${this.generation}`;
    const stylesheets = [`${SCHEME}://${key}/${TOKENS_FILE}${v}`];
    if (e.hasStylesheet) stylesheets.push(`${SCHEME}://${key}/${STYLESHEET}${v}`);
    return {
      key,
      source: e.source,
      id: e.skin.id,
      name: e.skin.name,
      adaptiveAccent: e.skin.adaptiveAccent,
      visualizer: e.skin.visualizer,
      stylesheets,
    };
  }

  /**
   * Protocol handler for skin://<key>/<path>. Only known skins, only allowed
   * asset types, and only files whose real path stays inside the skin folder.
   * @param {{ url: string, method?: string }} request
   * @returns {Promise<Response>}
   */
  async handleRequest(request) {
    if (request.method && request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS });
    }
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    if (url.protocol !== `${SCHEME}:`) return notFound();
    const entry = this.get(url.hostname.toLowerCase());
    if (!entry) return notFound();

    let rel;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return notFound();
    }
    if (rel === TOKENS_FILE) {
      return new Response(entry.css, { status: 200, headers: { ...BASE_HEADERS, 'Content-Type': 'text/css; charset=utf-8' } });
    }

    const safe = normalizeAssetPath(rel, 'any');
    if (!safe) return notFound();
    try {
      const base = await fs.promises.realpath(entry.dir);
      const real = await fs.promises.realpath(path.join(entry.dir, ...safe.split('/')));
      if (!isInside(base, real)) return notFound();
      const stat = await fs.promises.stat(real);
      if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return notFound();
      const body = await fs.promises.readFile(real);
      return new Response(body, { status: 200, headers: { ...BASE_HEADERS, 'Content-Type': mimeTypeFor(safe) } });
    } catch {
      return notFound();
    }
  }
}

module.exports = { SkinRegistry, SCHEME, DEFAULT_SKIN_KEY, TOKENS_FILE };
