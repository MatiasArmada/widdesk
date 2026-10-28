# widdesk

**widdesk is a growing collection of useful, customizable desktop widgets**: small, floating windows that sit on top of your work and stay out of the way.

Each widget is a self-contained project with its own dependencies, documentation and tests, so you only install what you use. New widgets will be added to this repository over time.

## Widgets

| Widget | Description | Platform | Status |
| --- | --- | --- | --- |
| [Music Visualizer](music-visualizer/) | Visualizes system audio in real time and shows the current track with playback controls, seek and album art. Supports live-switchable skins. | Windows | Available |
| More widgets | Additional widgets are planned. | — | Coming soon |

### Music Visualizer

The first widget in the collection.

![Music Visualizer demo](music-visualizer/docs/demo.gif)

## Requirements

- [Node.js](https://nodejs.org/) 22.12 or later (required by Electron).
- npm.
- Platform requirements vary per widget; see each widget's README.

## Getting started

```bash
git clone https://github.com/MatiasArmada/widdesk.git
cd widdesk/<widget-folder>
npm install
npm start
```

## Repository layout

```
widdesk/
├── LICENSE
├── README.md
└── music-visualizer/     one folder per widget
    ├── package.json      its own dependencies and scripts
    ├── README.md         usage and architecture
    ├── src/
    └── test/
```

Widgets do not share code or dependencies. To add a new widget, create a new top-level folder with its own `package.json` and `README.md`, and add a row to the table above.

## License

[MIT](LICENSE) © 2026 Mat Armada
