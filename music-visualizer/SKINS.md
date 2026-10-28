# Skins

A skin changes how the widget looks: colors, fonts, borders, textures and the visualizer style. **A skin is data, not code.** It is a folder with a `manifest.json`, an optional `skin.css` and some images or fonts. No JavaScript from a skin is ever run.

The layout is fixed. Skins can restyle everything, but they cannot move, add or remove parts of the widget.

## Quick path

1. Click the palette button in the title bar, then **Open skins folder**.
2. Make a new folder inside it (any name), for example `my-skin/`.
3. Add a `manifest.json`:

   ```json
   {
     "schema": 1,
     "id": "my-skin",
     "name": "My Skin",
     "author": "You",
     "vars": {
       "--skin-accent": "#ff6a00",
       "--skin-bg": "linear-gradient(180deg, #1b1b1b, #000)",
       "--skin-font": "'Trebuchet MS', sans-serif"
     },
     "visualizer": { "mode": "bars", "colors": ["#ff6a00", "#ffd000"] }
   }
   ```

4. Open the skin menu again, click **Reload skins**, then pick **My Skin**. It applies right away. Edit and reload as often as you like.

The bundled skins in `music-visualizer/skins/` are full examples. Copying one is the fastest way to start.

## Where skins come from

| Source | Folder | Key shown internally |
| --- | --- | --- |
| Bundled | `music-visualizer/skins/<folder>/` | `bundled-<id>` |
| User | `%APPDATA%/music-visualizer/skins/<folder>/` (the app's `userData`) | `user-<id>` |

- A user skin **never replaces** a bundled one. If both use the same `id`, both are listed; the user one is tagged "user".
- Inside one source, if two folders use the same `id`, the first folder alphabetically wins and the other is skipped.
- Invalid skins are skipped and the reason is logged to the terminal (`[skins] ...`). The app never crashes because of a skin.
- The selected skin is saved with the window position. If it disappears, the app falls back to the default skin (`bundled-default`); if that is gone too, to the first available skin, and with no skins at all to the built-in look.

## manifest.json

| Field | Type | Rules |
| --- | --- | --- |
| `schema` | number | Required. Must be `1`. |
| `id` | string | Required. 1-40 chars: lowercase letters, digits and inner dashes (`neon-drive`). |
| `name` | string | Required. Shown in the menu. Trimmed to 40 chars. |
| `author` | string | Optional. Up to 60 chars. |
| `description` | string | Optional. Up to 200 chars. Shown as the menu tooltip. |
| `vars` | object | Optional. Token name -> CSS value. See [Tokens](#tokens). |
| `visualizer` | object | Optional. See [Visualizer](#visualizer). |
| `fonts` | array | Optional. Up to 8 local font files. See [Fonts](#fonts). |
| `adaptiveAccent` | boolean | Optional, default `false`. When `true`, the accent colors follow the album art. |
| `swatch` | array | Optional. Up to 4 plain colors for the menu preview. Derived from the tokens when missing. |

Unknown fields are ignored with a warning.

### Values are checked

Every token value must pass a conservative check, or it is dropped with a warning (the default is used instead):

- One line, no `;` `{` `}` `<` `>` `\` `@` `!` `` ` `` and no `/* comments */`.
- No `:` outside `url()` (so no `javascript:` or remote schemes).
- Only these functions: `rgb` `rgba` `hsl` `hsla` `hwb` `lab` `lch` `oklab` `oklch` `color` `color-mix` `linear-gradient` `radial-gradient` `conic-gradient` and their `repeating-` forms, `var` `calc` `min` `max` `clamp` `cubic-bezier` `steps`, plus `url()`.
- `url()` must be either:
  - a **relative image path inside the skin folder** (`url(tex/grain.svg)`; quote it if it contains spaces). No `..`, no absolute paths, no drive letters, no `%`-encoding, no hidden files. Allowed: `.svg .png .jpg .jpeg .gif .webp`.
  - a small inline image: `data:image/(png|jpeg|gif|webp|svg+xml)[;base64],...` with no spaces or quotes (base64 is easiest).

## Tokens

The app's stylesheet reads **only** these custom properties. Each one has a default (the "Midnight Glass" look), so a skin can set as few as it wants. Values are normal CSS for the property named in the "Used as" column.

Two extra properties are available to reference with `var()` but cannot be set: `--accent` and `--accent-2`. They hold the live accent: the skin's `--skin-accent` pair, or the album-art colors when `adaptiveAccent` is `true`. Do not set `--skin-accent` to `var(--accent)`; that is a loop and both become invalid.

### Card

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-accent`, `--skin-accent-2` | accent colors | `#8b5cf6`, `#22d3ee` |
| `--skin-bg` | card `background` layers (last layer may be a color) | two soft accent glows over `rgba(18,18,24,0.78)` |
| `--skin-bg-image` | extra `background` layer(s) drawn above `--skin-bg` | `none` |
| `--skin-border` | card `border` shorthand | `1px solid rgba(255,255,255,0.09)` |
| `--skin-radius` | card `border-radius` | `18px` |
| `--skin-shadow` | card `box-shadow` (use `inset`; outer shadows are clipped by the window) | subtle inner glow |
| `--skin-overlay` | `background` of a layer above everything (scanlines, gloss) | `none` |
| `--skin-overlay-opacity` | that layer's `opacity` | `1` |
| `--skin-overlay-blend` | that layer's `mix-blend-mode` | `normal` |

### Text

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-fg` | main text color | `#f4f4f8` |
| `--skin-fg-dim` | artist line | 66% white |
| `--skin-fg-faint` | app name, times, small labels | 42% white |
| `--skin-font` | base `font-family` | Segoe UI stack |
| `--skin-font-title` | track title `font-family` | `var(--skin-font)` |
| `--skin-font-mono` | time readouts `font-family` | `var(--skin-font)` |
| `--skin-title-color` | track title color | `var(--skin-fg)` |
| `--skin-title-weight` | track title `font-weight` | `600` |
| `--skin-title-transform` | track title `text-transform` | `none` |
| `--skin-title-spacing` | track title `letter-spacing` | `0.1px` |
| `--skin-text-shadow` | `text-shadow` of the track info | soft dark shadow |

### Title bar and display

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-titlebar-bg` | `background` of the top strip (full width) | `transparent` |
| `--skin-titlebar-border` | its `border-bottom` shorthand | none |
| `--skin-display-bg` | `background` of the panel behind title/artist/app (an LCD or dial) | `transparent` |
| `--skin-display-border` | its `border` shorthand | none |
| `--skin-display-radius` | its `border-radius` | `0` |
| `--skin-display-shadow` | its `box-shadow` | `none` |

### Buttons

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-button-fg` | icon color of title bar buttons | `var(--skin-fg-dim)` |
| `--skin-button-bg` | `background-color` of all buttons | `transparent` |
| `--skin-button-image` | `background-image` of all buttons (drawn over the color) | `none` |
| `--skin-button-border` | `border` shorthand of all buttons | none |
| `--skin-button-radius` | `border-radius` of title bar buttons | `8px` |
| `--skin-button-shadow` | `box-shadow` of all buttons | `none` |
| `--skin-button-hover-bg` | hover `background-color` | 10% white |
| `--skin-button-hover-fg` | hover icon color | `var(--skin-fg)` |
| `--skin-control-fg` | icon color of previous / next | `var(--skin-fg)` |
| `--skin-control-radius` | `border-radius` of previous / next | `50%` |
| `--skin-close-hover-bg`, `--skin-close-hover-fg` | close button on hover | red / white |
| `--skin-pin-active` | icon color of pin (on) and the open skin menu button | `var(--accent-2)` |
| `--skin-chip-border` | border of the small "Retry" pill | 9% white line |
| `--skin-focus` | keyboard focus outline color | `var(--accent-2)` |

### Play button

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-play-bg` | `background` | white gradient |
| `--skin-play-fg` | icon color | `#101014` |
| `--skin-play-hover-bg` | hover `background` | `#ffffff` |
| `--skin-play-border` | `border` shorthand | none |
| `--skin-play-radius` | `border-radius` | `50%` |
| `--skin-play-shadow` | `box-shadow` | accent glow |

### Album art

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-art-bg` | placeholder `background` (no art) | accent gradient |
| `--skin-art-border` | `border` shorthand | none |
| `--skin-art-radius` | `border-radius` (`50%` gives a round record) | `12px` |
| `--skin-art-shadow` | `box-shadow` | soft drop shadow |
| `--skin-art-icon` | placeholder note icon color | 75% white |

### Seek bar

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-track-bg` | track `background` | 14% white |
| `--skin-track-fill` | progress `background` | accent gradient |
| `--skin-track-radius` | track `border-radius` | `999px` |
| `--skin-thumb-bg` | thumb `background` | `#fff` |
| `--skin-thumb-radius` | thumb `border-radius` | `50%` |
| `--skin-thumb-shadow` | thumb `box-shadow` | accent ring |

### Skin menu

| Token | Used as | Default |
| --- | --- | --- |
| `--skin-menu-bg` | `background` | near-black |
| `--skin-menu-fg` | text color | `var(--skin-fg)` |
| `--skin-menu-border` | `border` shorthand | 12% white line |
| `--skin-menu-radius` | `border-radius` | `10px` |
| `--skin-menu-shadow` | `box-shadow` | dark drop shadow |
| `--skin-menu-hover-bg` | hovered / focused item `background` | 8% white |

## Visualizer

All fields are optional. Invalid values fall back to the default; numbers are clamped to their range.

| Field | Type | Range | Default | Meaning |
| --- | --- | --- | --- | --- |
| `mode` | string | `bars`, `wave` | `bars` | Starting mode. The user can still switch; the choice is remembered per skin. |
| `barCount` | integer | 8-96 | `48` | Number of bars. |
| `colors` | array of colors | 1-8 | `null` | Gradient stops. `null` uses the live accent pair. Only plain colors (hex, `rgb()`, `hsl()`, names). |
| `gradient` | string | `horizontal`, `vertical` | `horizontal` | Across the width, or from the baseline up. |
| `peakColor` | color | | `null` | Color of falling peak caps on bars. `null` turns them off. |
| `glow` | number | 0-24 | `0` | Glow blur in px. |
| `lineWidth` | number | 0.5-6 | `1.6` | Wave line width. |
| `barGap` | number | 0-0.9 | `0.42` | Gap as a fraction of each bar slot. |
| `barRadius` | number | 0-1 | `1` | `0` square, `1` fully rounded. |
| `opacity` | number | 0.05-1 | `0.34` | Strength of the visualizer behind the UI. |
| `reflection` | boolean | | `true` | Draw the faint mirrored bars under the baseline. |

## Fonts

Fonts cannot be downloaded at runtime. Ship font files in the skin folder and register them:

```json
"fonts": [
  { "family": "Pixel Mono", "file": "fonts/pixel.woff2" },
  { "family": "Pixel Mono", "file": "fonts/pixel-bold.woff2", "weight": 700 }
]
```

- `family`: letters, digits, spaces, `_` and `-` (up to 48 chars).
- `file`: a relative `.woff2`, `.woff`, `.ttf` or `.otf` path inside the skin folder.
- `weight`: `100`-`900` or `"bold"` (default `normal`). `style`: `"normal"` or `"italic"`.

Then use it in a token: `"--skin-font-title": "'Pixel Mono', monospace"`. Installed system fonts work without registering anything.

## skin.css (optional)

If the skin folder has a `skin.css`, it loads after the tokens. Use it for details that tokens do not cover: animations, `::after` decorations, per-element colors. `url()` inside it resolves relative to the skin folder.

Do not add large pseudo-elements or positioned layers that cover the buttons or the seek bar. The card is the window's drag area and drag regions are resolved in document order, ignoring `z-index` and `pointer-events`, so such a layer turns clicks into window drags. Use the `--skin-overlay` tokens for full-card effects instead.

Rules and limits:

- It is plain CSS. It can only load files from skin folders; remote URLs and `@import` from the web are blocked by the page's Content Security Policy.
- Selectors you can rely on: `.card` (with `data-status`, `data-session`, `data-skin`), `.topbar`, `.window-btns`, `.icon-btn`, `#btn-mode`, `#btn-skin`, `#btn-pin`, `#btn-min`, `#btn-close`, `.info`, `.art` (`.has-art`), `.art img`, `.meta`, `.title`, `.artist`, `.app`, `.seek`, `.time`, `.seekbar`, `.seek-track`, `.seek-fill`, `.seek-thumb`, `.controls`, `.ctl-btn`, `.ctl-btn.play`, `.skin-menu`, `.skin-item`. Other markup may change between versions.
- Layout is fixed: changing sizes, positions or `display` may break the widget. Keep to colors, backgrounds, borders, shadows, fonts, filters and animations.
- Respect `@media (prefers-reduced-motion: reduce)` for anything that moves.

## Assets and safety

Skin files are served to the window through a private `skin://<key>/<path>` protocol:

- Only skins that were discovered and validated are reachable.
- Paths are checked twice: by the same rules as `url()` above, and after resolving links, the real file must still be inside the skin folder.
- Only `.svg .png .jpg .jpeg .gif .webp .woff .woff2 .ttf .otf .css` are served (up to 4 MB each). `manifest.json`, scripts and HTML are never served.

## Checklist for a new skin

- [ ] `schema` is `1`, `id` is unique and lowercase, `name` is set.
- [ ] **Reload skins** shows no `[skins]` warnings in the terminal for your folder.
- [ ] Text is readable on your background with and without album art.
- [ ] Hover and keyboard focus are visible on every button.
- [ ] Animations stop under reduced motion.
