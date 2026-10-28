# Music Visualizer

A floating desktop widget for Windows that visualizes whatever your PC is playing and controls the current media session.

![Music Visualizer demo](docs/demo.gif)

Works with any app that reports to Windows media controls: Spotify, browsers (YouTube and others), Media Player and more.

## Features

- **Real-time visualizer** of the system audio output, in two modes: bars and wave.
- **Now playing**: track title, artist, source app and album art.
- **Playback controls**: play/pause, previous, next and a seek bar.
- **Skins**: six bundled skins, live switching, and support for your own skins without writing code.
- **Unobtrusive window**: frameless, transparent, optionally pinned on top. Position, pin state and skin are remembered.
- **Keyboard**: `Space` play/pause, `Left`/`Right` previous/next. With the seek bar focused, the arrow keys seek 5 s.

## Requirements

- Windows 10 or 11 (Windows PowerShell 5.1 is included).
- [Node.js](https://nodejs.org/) 22.12 or later and npm.

## Install and run

```bash
npm install   # also downloads the Electron binary (postinstall)
npm start     # launch the widget
npm test      # run the unit tests (node --test)
```

Set `WIDGET_DEBUG=1` to log media bridge messages to the terminal.

## Controls

- Drag the card to move it.
- Top-left: switch the visualizer mode (bars / wave).
- Top-right: skins, pin on top, minimize, close.

## How it works

```
 Windows SMTC                          system audio output
      │                                        │
      ▼                                        │ WASAPI loopback
 media-bridge.ps1  ── JSON lines ──►  main process (Electron)
 (PowerShell 5.1)  ◄── commands ───   ├─ media-bridge.js   supervises the bridge
                                      ├─ skin-registry.js  loads skins, serves skin://
                                      └─ getDisplayMedia handler (audio: 'loopback')
                                               │ IPC (preload)
                                               ▼
                                      renderer
                                      ├─ renderer.js    track info, controls, skin picker
                                      └─ visualizer.js  AnalyserNode → canvas
```

| Part | What it does |
| --- | --- |
| Audio | The main process answers `getDisplayMedia` with `audio: 'loopback'` (WASAPI loopback). The renderer drops the video track and feeds the audio into an `AnalyserNode`. It is never routed back to the speakers. |
| Media info and control | `src/main/media-bridge.ps1` is a long-lived Windows PowerShell 5.1 process that reads the System Media Transport Controls (SMTC) session through WinRT. It prints one JSON line per update and reads commands (`toggle`, `play`, `pause`, `next`, `prev`, `seek`) from stdin. `media-bridge.js` supervises it and restarts it with backoff if it exits. |
| Skins | `src/main/skin-registry.js` discovers bundled and user skins, validates them with `src/shared/skin-manifest.js` and serves their files through a private `skin://` protocol. |
| Shared logic | `src/shared/` holds pure modules (protocol, formatting, band mapping, skin validation) used by both Node and the renderer, with unit tests in `test/`. |

## Skins

A skin is data, never code: a folder with a `manifest.json` (schema 1), an optional `skin.css` and optional images or fonts. Skins set `--skin-*` CSS tokens and their own visualizer style. Click the palette button in the title bar to switch skins live.

### Bundled skins

| Skin | Style |
| --- | --- |
| Midnight Glass (default) | Frosted dark glass; accent colors follow the album art. |
| Chrome Amp | Late-90s desktop amp: brushed aluminium and a green LCD. |
| Neon Drive | Synthwave: sunset horizon, magenta grid, cyan type. |
| Phosphor 83 | Amber monochrome CRT with scanlines and an oscilloscope trace. |
| Walnut & Brass | 70s hi-fi receiver: walnut veneer, brass and a glowing dial. |
| Bubblegum 2K | Translucent candy plastic, glossy and bubbly. |

They live in [`skins/`](skins/) and are the best starting point for your own.

### Create your own skin

1. Open the skin menu and click **Open skins folder**. This opens `%APPDATA%\music-visualizer\skins\`.
2. Create a folder inside it, for example `my-skin\`.
3. Add a `manifest.json`:

   ```json
   {
     "schema": 1,
     "id": "my-skin",
     "name": "My Skin",
     "author": "You",
     "vars": {
       "--skin-accent": "#ff6a00",
       "--skin-bg": "linear-gradient(180deg, #1b1b1b, #000)"
     },
     "visualizer": { "mode": "bars", "colors": ["#ff6a00", "#ffd000"] }
   }
   ```

4. Open the skin menu, click **Reload skins** and pick **My Skin**. User skins are tagged "user" in the menu.

Only `schema`, `id` and `name` are required. Invalid skins are skipped and the reason is logged to the terminal. See [SKINS.md](SKINS.md) for the full manifest format, every token, fonts, `skin.css` and the safety rules.

## Limitations

- Windows only (SMTC and WASAPI loopback).
- The visualizer shows the mixed system output, not one specific app.
- SMTC has no like/dislike or rating actions, so the widget cannot offer them.
- For browser players, the reported source app is the browser, not the website.
- Seeking and some commands depend on the media app; browsers often ignore seek requests.
- With no media session, play/pause/next/previous fall back to media keys, and seek is unavailable.
- Album art is shown only when the app provides a thumbnail of 512 KB or less.

## Roadmap

- **Player providers**: a provider architecture for player-specific actions that SMTC does not expose, such as like/dislike for YouTube Music.

## License

[MIT](../LICENSE) © 2026 Mat Armada
