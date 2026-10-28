/*
 * UI wiring for the music widget.
 * Depends on globals: WidgetFormat, Visualizer, WidgetSkinManifest, and window.widget (preload bridge).
 */
(function () {
  'use strict';

  const { formatTime, clamp, progressRatio, prettyAppName } = globalThis.WidgetFormat;
  const api = window.widget;

  const DEFAULT_ACCENT = '#8b5cf6';
  const DEFAULT_ACCENT_2 = '#22d3ee';
  const MODE_KEY_PREFIX = 'music-visualizer.mode.'; // + skin key: the mode is remembered per skin
  const SEEK_STEP_S = 5;
  const SKIN_LOADING_TIMEOUT_MS = 1500;

  const $ = (id) => document.getElementById(id);
  const el = {
    card: $('card'),
    viz: $('viz'),
    btnMode: $('btn-mode'),
    captureStatus: $('capture-status'),
    btnRetry: $('btn-retry'),
    btnPin: $('btn-pin'),
    btnMin: $('btn-min'),
    btnClose: $('btn-close'),
    btnSkin: $('btn-skin'),
    skinMenu: $('skin-menu'),
    skinList: $('skin-list'),
    btnSkinsReload: $('btn-skins-reload'),
    btnSkinsFolder: $('btn-skins-folder'),
    art: $('art'),
    artImg: $('art-img'),
    titleWrap: $('title-wrap'),
    title: $('title'),
    artist: $('artist'),
    app: $('app'),
    elapsed: $('elapsed'),
    total: $('total'),
    seekbar: $('seekbar'),
    seekFill: $('seek-fill'),
    seekThumb: $('seek-thumb'),
    btnPrev: $('btn-prev'),
    btnPlay: $('btn-play'),
    btnNext: $('btn-next'),
  };

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const media = {
    hasSession: false,
    app: '',
    title: '',
    artist: '',
    album: '',
    status: 'stopped',
    position: 0,
    duration: 0,
    receivedAt: performance.now(),
  };
  const colors = { accent: DEFAULT_ACCENT, accent2: DEFAULT_ACCENT_2 };
  let artAccent = null; // [accent, accent2] picked from the album art, or null
  let activeSkin = null; // descriptor from the main process, or null for the built-in look
  let skinList = [];
  let trackKey = '';
  let dragRatio = null; // non-null while the user is dragging the seek bar

  // -------------------------------------------------------------------------
  // Storage (best-effort)
  // -------------------------------------------------------------------------
  function skinDefaultMode() {
    return activeSkin ? activeSkin.visualizer.mode : 'bars';
  }

  function modeKey() {
    return MODE_KEY_PREFIX + (activeSkin ? activeSkin.key : 'builtin');
  }

  function loadMode() {
    try {
      return localStorage.getItem(modeKey()) || skinDefaultMode();
    } catch {
      return skinDefaultMode();
    }
  }

  function saveMode(mode) {
    try {
      localStorage.setItem(modeKey(), mode);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  }

  // -------------------------------------------------------------------------
  // Visualizer + audio capture
  // -------------------------------------------------------------------------
  const visualizer = new globalThis.Visualizer(el.viz, { getColors: () => colors });
  let audio = null; // { stream, ctx }

  function applyMode(mode) {
    const modes = globalThis.Visualizer.MODES;
    const m = modes.includes(mode) ? mode : modes[0];
    visualizer.setMode(m);
    el.btnMode.dataset.mode = m;
    el.btnMode.title = `Visualizer: ${m}`;
    el.btnMode.setAttribute('aria-label', `Switch visualizer mode (current: ${m})`);
    return m;
  }

  function stopCapture() {
    if (!audio) return;
    audio.stream.getTracks().forEach((t) => t.stop());
    audio.ctx.close().catch(() => {});
    audio = null;
    visualizer.setAnalyser(null);
  }

  function setCaptureFailed(failed) {
    el.captureStatus.hidden = !failed;
  }

  async function startCapture() {
    stopCapture();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      const tracks = stream.getAudioTracks();
      if (!tracks.length) throw new Error('No loopback audio track');

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream(tracks));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -20;
      // Intentionally NOT connected to ctx.destination: that would echo system audio.
      source.connect(analyser);
      if (ctx.state === 'suspended') await ctx.resume();

      audio = { stream, ctx };
      visualizer.setAnalyser(analyser);
      setCaptureFailed(false);
      console.info(`Audio capture started (${ctx.sampleRate} Hz)`);

      tracks[0].addEventListener('ended', () => {
        if (audio && audio.stream === stream) {
          stopCapture();
          setCaptureFailed(true);
        }
      });
    } catch (err) {
      console.warn('Audio capture failed:', err && err.message);
      stopCapture();
      setCaptureFailed(true);
    }
  }

  // -------------------------------------------------------------------------
  // Accent color from album art
  // -------------------------------------------------------------------------
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hsl(h, s, l) {
    return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  /**
   * Album-art colors win only on adaptive skins; otherwise the skin's own
   * --skin-accent pair (resolved by CSS into --accent) is used everywhere.
   */
  function refreshAccent() {
    const adaptive = !activeSkin || activeSkin.adaptiveAccent;
    if (adaptive && artAccent) {
      el.card.style.setProperty('--accent', artAccent[0]);
      el.card.style.setProperty('--accent-2', artAccent[1]);
    } else {
      el.card.style.removeProperty('--accent');
      el.card.style.removeProperty('--accent-2');
    }
    const cs = getComputedStyle(el.card);
    colors.accent = cs.getPropertyValue('--accent').trim() || DEFAULT_ACCENT;
    colors.accent2 = cs.getPropertyValue('--accent-2').trim() || DEFAULT_ACCENT_2;
  }

  function setArtAccent(pair) {
    artAccent = pair;
    refreshAccent();
  }

  /** Saturation-weighted average color of the image, nudged to stay vivid and readable. */
  function accentFromImage(img) {
    const size = 24;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let r = 0;
    let g = 0;
    let b = 0;
    let wsum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const w = 0.05 + s * (1 - Math.abs(l - 0.5) * 2);
      r += data[i] * w;
      g += data[i + 1] * w;
      b += data[i + 2] * w;
      wsum += w;
    }
    if (wsum <= 0) return null;
    const [h, s] = rgbToHsl(r / wsum, g / wsum, b / wsum);
    if (s < 0.08) return null; // grayscale art: keep the default palette
    const sat = clamp(s * 1.3, 0.55, 0.9);
    return [hsl(h, sat, 0.62), hsl(h + 40, sat, 0.6)];
  }

  // -------------------------------------------------------------------------
  // Rendering media state
  // -------------------------------------------------------------------------
  function currentPosition() {
    let pos = media.position;
    if (media.status === 'playing') pos += (performance.now() - media.receivedAt) / 1000;
    return media.duration > 0 ? clamp(pos, 0, media.duration) : Math.max(0, pos);
  }

  function renderProgress() {
    const duration = media.duration;
    const canSeek = media.hasSession && duration > 0;
    const pos = dragRatio !== null ? dragRatio * duration : currentPosition();
    const ratio = progressRatio(pos, duration);

    el.seekFill.style.width = `${ratio * 100}%`;
    el.seekThumb.style.left = `${ratio * 100}%`;
    el.elapsed.textContent = formatTime(pos);
    el.total.textContent = formatTime(duration);

    el.seekbar.setAttribute('aria-disabled', String(!canSeek));
    el.seekbar.tabIndex = canSeek ? 0 : -1;
    el.seekbar.setAttribute('aria-valuemax', String(Math.round(duration)));
    el.seekbar.setAttribute('aria-valuenow', String(Math.round(pos)));
    el.seekbar.setAttribute('aria-valuetext', `${formatTime(pos)} of ${formatTime(duration)}`);
  }

  function updateMarqueeFit() {
    el.titleWrap.classList.remove('marquee');
    const overflow = el.title.scrollWidth - el.titleWrap.clientWidth;
    el.titleWrap.classList.toggle('overflowing', overflow > 1);
  }

  function renderMeta() {
    const has = media.hasSession;
    el.card.dataset.session = String(has);
    el.card.dataset.status = media.status;

    el.title.textContent = has ? media.title || 'Unknown title' : 'Nothing playing';
    el.artist.textContent = has ? media.artist || media.album || '' : 'Play something to get started';
    el.app.textContent = has ? prettyAppName(media.app) : '';
    el.title.title = el.title.textContent;
    updateMarqueeFit();

    const playing = media.status === 'playing';
    el.btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    renderProgress();
  }

  function clearArt() {
    el.artImg.hidden = true;
    el.artImg.removeAttribute('src');
    el.art.classList.remove('has-art');
    setArtAccent(null);
  }

  function onMediaState(state) {
    if (!state || typeof state !== 'object') return;
    Object.assign(media, state, { receivedAt: performance.now() });
    const key = `${media.app}|${media.title}|${media.artist}`;
    if (key !== trackKey) {
      trackKey = key;
      clearArt();
    }
    renderMeta();
  }

  function onMediaArt(art) {
    if (!art || !art.data) {
      clearArt();
      return;
    }
    const src = `data:${art.mime || 'image/png'};base64,${art.data}`;
    el.artImg.onload = () => {
      el.artImg.hidden = false;
      el.art.classList.add('has-art');
      try {
        setArtAccent(accentFromImage(el.artImg));
      } catch {
        setArtAccent(null);
      }
    };
    el.artImg.onerror = clearArt;
    el.artImg.src = src;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  function command(name, arg) {
    api.sendCommand(name, arg);
  }

  function togglePlay() {
    // Optimistic UI: flip immediately, the next bridge state confirms it.
    if (media.hasSession) {
      const pos = currentPosition();
      media.status = media.status === 'playing' ? 'paused' : 'playing';
      media.position = pos;
      media.receivedAt = performance.now();
      renderMeta();
    }
    command('toggle');
  }

  function seekTo(seconds) {
    if (!media.hasSession || media.duration <= 0) return;
    const target = clamp(seconds, 0, media.duration);
    media.position = target;
    media.receivedAt = performance.now();
    command('seek', target);
    renderProgress();
  }

  // -------------------------------------------------------------------------
  // Seek bar interaction
  // -------------------------------------------------------------------------
  function ratioFromEvent(e) {
    const rect = el.seekbar.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
  }

  el.seekbar.addEventListener('pointerdown', (e) => {
    if (el.seekbar.getAttribute('aria-disabled') === 'true' || e.button !== 0) return;
    el.seekbar.setPointerCapture(e.pointerId);
    el.seekbar.classList.add('dragging');
    dragRatio = ratioFromEvent(e);
    renderProgress();
  });

  el.seekbar.addEventListener('pointermove', (e) => {
    if (dragRatio === null) return;
    dragRatio = ratioFromEvent(e);
    renderProgress();
  });

  function endDrag(e, commit) {
    if (dragRatio === null) return;
    const ratio = e && e.type !== 'lostpointercapture' ? ratioFromEvent(e) : dragRatio;
    dragRatio = null;
    el.seekbar.classList.remove('dragging');
    if (commit) seekTo(ratio * media.duration);
    else renderProgress();
  }

  el.seekbar.addEventListener('pointerup', (e) => endDrag(e, true));
  el.seekbar.addEventListener('pointercancel', (e) => endDrag(e, false));
  el.seekbar.addEventListener('lostpointercapture', (e) => endDrag(e, false));

  el.seekbar.addEventListener('keydown', (e) => {
    if (el.seekbar.getAttribute('aria-disabled') === 'true') return;
    let target = null;
    const pos = currentPosition();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = pos - SEEK_STEP_S;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = pos + SEEK_STEP_S;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = media.duration - 1;
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    seekTo(target);
  });

  // -------------------------------------------------------------------------
  // Buttons & keyboard
  // -------------------------------------------------------------------------
  el.btnPlay.addEventListener('click', togglePlay);
  el.btnPrev.addEventListener('click', () => command('prev'));
  el.btnNext.addEventListener('click', () => command('next'));
  el.btnClose.addEventListener('click', () => api.close());
  el.btnMin.addEventListener('click', () => api.minimize());
  el.btnRetry.addEventListener('click', startCapture);

  function renderPin(pinned) {
    el.btnPin.setAttribute('aria-pressed', String(Boolean(pinned)));
    el.btnPin.title = pinned ? 'Pinned on top (click to unpin)' : 'Not on top (click to pin)';
  }

  el.btnPin.addEventListener('click', async () => {
    try {
      renderPin(await api.togglePin());
    } catch {
      /* ignore */
    }
  });

  el.btnMode.addEventListener('click', () => {
    const modes = globalThis.Visualizer.MODES;
    const next = modes[(modes.indexOf(visualizer.mode) + 1) % modes.length];
    saveMode(applyMode(next));
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || isMenuOpen()) return;
    const onButton = e.target instanceof HTMLButtonElement;
    if (e.code === 'Space') {
      if (onButton) return; // native button activation handles it
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      command('prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      command('next');
    }
  });

  el.titleWrap.addEventListener('mouseenter', () => {
    const overflow = el.title.scrollWidth - el.titleWrap.clientWidth;
    if (overflow <= 1) return;
    el.titleWrap.style.setProperty('--marquee-shift', `-${overflow + 16}px`);
    el.titleWrap.style.setProperty('--marquee-duration', `${Math.max(3, overflow / 30)}s`);
    el.titleWrap.classList.add('marquee');
  });
  el.titleWrap.addEventListener('mouseleave', () => el.titleWrap.classList.remove('marquee'));

  // -------------------------------------------------------------------------
  // Skins
  // -------------------------------------------------------------------------
  let skinLinks = []; // <link> elements of the active skin
  let skinRequest = 0;

  function loadStylesheet(href) {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve(link);
      link.onerror = () => {
        console.warn(`Skin stylesheet failed to load: ${href}`);
        resolve(link);
      };
      document.head.appendChild(link);
    });
  }

  function isSkinDescriptor(d) {
    return (
      d !== null &&
      typeof d === 'object' &&
      typeof d.key === 'string' &&
      Array.isArray(d.stylesheets) &&
      d.stylesheets.every((href) => typeof href === 'string' && href.startsWith('skin://'))
    );
  }

  /** Swaps the skin stylesheets live. New sheets load before the old ones go, so nothing flashes. */
  async function applySkin(desc) {
    const request = ++skinRequest;
    const next = isSkinDescriptor(desc) ? desc : null;
    const links = next ? await Promise.all(next.stylesheets.map(loadStylesheet)) : [];
    if (request !== skinRequest) {
      links.forEach((l) => l.remove()); // a newer request superseded this one
      return;
    }
    skinLinks.forEach((l) => l.remove());
    skinLinks = links;
    activeSkin = next && { ...next, visualizer: globalThis.WidgetSkinManifest.normalizeVisualizer(next.visualizer) };

    el.card.dataset.skin = activeSkin ? activeSkin.key : '';
    visualizer.setStyle(activeSkin && activeSkin.visualizer);
    applyMode(loadMode());
    refreshAccent();
    updateMarqueeFit(); // fonts and letter spacing change the title width
    renderSkinChecks();
    el.card.removeAttribute('data-skin-loading');
  }

  function swatchFor(skin) {
    const box = document.createElement('span');
    box.className = 'skin-swatch';
    box.setAttribute('aria-hidden', 'true');
    const { isSafeColor } = globalThis.WidgetSkinManifest;
    const safe = Array.isArray(skin.swatch) ? skin.swatch.filter(isSafeColor) : [];
    for (const color of safe.length ? safe : ['#777']) {
      const part = document.createElement('span');
      part.style.background = color;
      box.appendChild(part);
    }
    return box;
  }

  function renderSkinList() {
    const items = skinList.map((skin) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'skin-item';
      item.setAttribute('role', 'menuitemradio');
      item.dataset.key = skin.key;
      item.title = skin.author ? `${skin.description || skin.name} (by ${skin.author})` : skin.description || skin.name;

      const name = document.createElement('span');
      name.className = 'skin-name';
      name.textContent = skin.name;
      item.append(swatchFor(skin), name);
      if (skin.source === 'user') {
        const tag = document.createElement('span');
        tag.className = 'skin-tag';
        tag.textContent = 'user';
        item.appendChild(tag);
      }
      return item;
    });
    el.skinList.replaceChildren(...items);
    renderSkinChecks();
  }

  function renderSkinChecks() {
    for (const item of el.skinList.querySelectorAll('.skin-item')) {
      item.setAttribute('aria-checked', String(Boolean(activeSkin) && item.dataset.key === activeSkin.key));
    }
  }

  function menuItems() {
    return [...el.skinMenu.querySelectorAll('button')];
  }

  function isMenuOpen() {
    return !el.skinMenu.hidden;
  }

  function openMenu() {
    el.skinMenu.hidden = false;
    el.btnSkin.setAttribute('aria-expanded', 'true');
    const current = el.skinList.querySelector('.skin-item[aria-checked="true"]');
    (current || menuItems()[0]).focus();
  }

  function closeMenu({ restoreFocus = true } = {}) {
    if (!isMenuOpen()) return;
    el.skinMenu.hidden = true;
    el.btnSkin.setAttribute('aria-expanded', 'false');
    if (restoreFocus) el.btnSkin.focus();
  }

  async function chooseSkin(key) {
    closeMenu();
    if (activeSkin && activeSkin.key === key) return;
    try {
      const desc = await api.setSkin(key);
      if (desc) await applySkin(desc);
    } catch (err) {
      console.warn('Could not switch skin:', err && err.message);
    }
  }

  async function reloadSkins() {
    try {
      const { skins, active } = await api.reloadSkins();
      skinList = Array.isArray(skins) ? skins : [];
      renderSkinList();
      await applySkin(active);
    } catch (err) {
      console.warn('Could not reload skins:', err && err.message);
    }
  }

  el.btnSkin.addEventListener('click', () => (isMenuOpen() ? closeMenu() : openMenu()));
  el.skinList.addEventListener('click', (e) => {
    const item = e.target.closest('.skin-item');
    if (item) chooseSkin(item.dataset.key);
  });
  el.btnSkinsReload.addEventListener('click', () => {
    closeMenu();
    reloadSkins();
  });
  el.btnSkinsFolder.addEventListener('click', () => {
    closeMenu();
    api.openSkinsFolder();
  });

  el.skinMenu.addEventListener('keydown', (e) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    let target = null;
    if (e.key === 'ArrowDown') target = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') target = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') target = items[0];
    else if (e.key === 'End') target = items[items.length - 1];
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (target) {
      e.preventDefault();
      target.focus();
    }
  });

  // Clicks on the card's drag region never reach the DOM, so losing focus closes the menu too.
  document.addEventListener('pointerdown', (e) => {
    if (isMenuOpen() && !el.skinMenu.contains(e.target) && !el.btnSkin.contains(e.target)) {
      closeMenu({ restoreFocus: false });
    }
  });
  window.addEventListener('blur', () => closeMenu({ restoreFocus: false }));

  async function bootSkin() {
    // Never stay invisible if the main process is slow or the skin is broken.
    const reveal = setTimeout(() => el.card.removeAttribute('data-skin-loading'), SKIN_LOADING_TIMEOUT_MS);
    try {
      const [desc, list] = await Promise.all([api.getSkin(), api.listSkins()]);
      skinList = Array.isArray(list) ? list : [];
      renderSkinList();
      await applySkin(desc);
    } catch (err) {
      console.warn('Could not load skin:', err && err.message);
      await applySkin(null);
    } finally {
      clearTimeout(reveal);
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  applyMode(loadMode());
  bootSkin();
  renderMeta();
  visualizer.start();
  startCapture();

  setInterval(() => {
    if (!document.hidden && media.status === 'playing') renderProgress();
  }, 250);

  api.onMediaState(onMediaState);
  api.onMediaArt(onMediaArt);
  api.onMediaError((err) => console.warn('Media bridge:', err && err.message));
  api.onPinChanged(renderPin);
  api.getPinned().then(renderPin, () => {});
})();
