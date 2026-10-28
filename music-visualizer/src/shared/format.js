/*
 * Small pure formatting helpers. Usable from Node (CommonJS) and the renderer (global).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.WidgetFormat = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
  }

  /**
   * Formats seconds as "m:ss", or "h:mm:ss" from one hour up. Invalid input -> "0:00".
   * @param {number} seconds
   */
  function formatTime(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }

  /** Clamps value into [min, max]. NaN -> min. */
  function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  /** position / duration in [0, 1]; 0 when duration is not a positive number. */
  function progressRatio(position, duration) {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
    return clamp(position / duration, 0, 1);
  }

  const KNOWN_APPS = {
    spotify: 'Spotify',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    opera: 'Opera',
    brave: 'Brave',
    vivaldi: 'Vivaldi',
    'microsoft.zunemusic': 'Media Player',
    'microsoft.media.player': 'Media Player',
  };

  /**
   * Turns an SMTC SourceAppUserModelId into a short display name.
   * Handles "Spotify.exe", "C:\\path\\app.exe" and packaged ids like "Vendor.App_hash!Entry".
   * @param {string} id
   */
  function prettyAppName(id) {
    if (typeof id !== 'string' || !id.trim()) return '';
    let name = id.trim();
    let packageName = '';
    const bang = name.indexOf('!');
    if (bang !== -1) {
      packageName = name.slice(0, bang).replace(/_[a-z0-9]+$/i, '');
      name = name.slice(bang + 1);
    }
    name = name.split(/[\\/]/).pop().replace(/\.exe$/i, '');

    const known = KNOWN_APPS[name.toLowerCase()] || KNOWN_APPS[packageName.toLowerCase()];
    if (known) return known;
    if (packageName && /^app$/i.test(name)) return packageName.replace(/\./g, ' ');
    return name;
  }

  return { formatTime, clamp, progressRatio, prettyAppName };
});
