/*
 * Line protocol between the Electron main process and media-bridge.ps1.
 * Pure module: usable from Node (CommonJS) and from the renderer (global).
 *
 * Bridge -> app: one JSON object per line, { type, payload }.
 * App -> bridge: one plain-text command per line, e.g. "toggle" or "seek 12.5".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.WidgetProtocol = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMMANDS = Object.freeze(['toggle', 'play', 'pause', 'next', 'prev', 'seek']);
  const MESSAGE_TYPES = Object.freeze(['ready', 'state', 'art', 'error']);
  const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
  const IMAGE_MIME_RE = /^image\/(png|jpeg|jpg|gif|bmp|webp)$/;

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function str(value) {
    return typeof value === 'string' ? value : '';
  }

  function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function normalizeState(raw) {
    const p = isPlainObject(raw) ? raw : {};
    const status = typeof p.status === 'string' && p.status ? p.status.toLowerCase() : 'unknown';
    return {
      hasSession: p.hasSession === true,
      app: str(p.app),
      title: str(p.title),
      artist: str(p.artist),
      album: str(p.album),
      status,
      position: nonNegative(p.position),
      duration: nonNegative(p.duration),
    };
  }

  function normalizeArt(raw) {
    const p = isPlainObject(raw) ? raw : {};
    const mime = typeof p.mime === 'string' && IMAGE_MIME_RE.test(p.mime) ? p.mime : 'image/png';
    const data =
      typeof p.data === 'string' && p.data.length % 4 === 0 && BASE64_RE.test(p.data) ? p.data : null;
    return { mime, data };
  }

  function normalizeError(raw) {
    const p = isPlainObject(raw) ? raw : {};
    return { message: typeof p.message === 'string' && p.message ? p.message : 'Unknown error' };
  }

  /**
   * Parses one line of bridge output.
   * @param {string} line
   * @returns {{type: string, payload: object|null} | null} null when the line is not a valid message.
   */
  function parseBridgeLine(line) {
    if (typeof line !== 'string') return null;
    const trimmed = line.replace(/^﻿/, '').trim();
    if (!trimmed || trimmed[0] !== '{') return null;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!isPlainObject(msg) || !MESSAGE_TYPES.includes(msg.type)) return null;

    switch (msg.type) {
      case 'ready':
        return { type: 'ready', payload: null };
      case 'state':
        return { type: 'state', payload: normalizeState(msg.payload) };
      case 'art':
        return { type: 'art', payload: normalizeArt(msg.payload) };
      case 'error':
        return { type: 'error', payload: normalizeError(msg.payload) };
      default:
        return null;
    }
  }

  function isValidSeek(arg) {
    return typeof arg === 'number' && Number.isFinite(arg) && arg >= 0;
  }

  /**
   * @param {string} name
   * @param {unknown} [arg]
   * @returns {boolean}
   */
  function isValidCommand(name, arg) {
    if (!COMMANDS.includes(name)) return false;
    if (name === 'seek') return isValidSeek(arg);
    return true;
  }

  /**
   * Builds a bridge command line (without trailing newline).
   * @throws {TypeError} for unknown commands or invalid arguments.
   */
  function buildCommand(name, arg) {
    if (!COMMANDS.includes(name)) {
      throw new TypeError(`Unknown command: ${String(name)}`);
    }
    if (name === 'seek') {
      if (!isValidSeek(arg)) {
        throw new TypeError('seek requires a finite, non-negative number of seconds');
      }
      return `seek ${Number(arg.toFixed(3))}`;
    }
    return name;
  }

  return { COMMANDS, MESSAGE_TYPES, parseBridgeLine, buildCommand, isValidCommand };
});
