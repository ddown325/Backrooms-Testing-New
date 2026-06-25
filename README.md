# The Backrooms — Level 0

A realistic browser-based Backrooms game built for low-end PCs. Procedural infinite maze, rare mega rooms, fresh seed every playthrough, original cutscene, title screen with settings.

![Backrooms](https://img.shields.io/badge/level-0-yellow) ![WASM](https://img.shields.io/badge/maze%20gen-WASM-blue) ![Three.js](https://img.shields.io/badge/render-Three.js-black) ![TypeScript](https://img.shields.io/badge/app-TypeScript-blue)

## Features

- **Infinite procedural generation** — chunk-based streaming around the player, deterministic per seed
- **WASM-accelerated maze + collision** — Rust → `wasm32-unknown-unknown`, 46KB binary
- **Realistic Level 0 aesthetic** — procedural mono-yellow wallpaper with damp stains and cracks, mottled mustard carpet, yellowed drop-ceiling tiles, emissive fluorescent panels, yellowish exponential fog
- **Rare mega rooms** — 1-in-32 chunks becomes a mega-room center with a 6-cell-radius open interior
- **Fresh seed every run** — `crypto.getRandomValues` generates a new 32-bit seed on every "New Game"
- **Cutscene** — "falling into the backrooms" sequence with audio cues
- **Title screen + settings** — audio sliders (master/ambience/music/sfx) + graphics sliders (render scale, fog density, FOV, antialias), persisted to localStorage
- **Low-end PC friendly** — no shadows, no postprocessing, capped pixel ratio, fog hides chunk streaming, InstancedMesh (1 draw call per chunk per type), 2-chunk-per-frame load budget
- **Original audio integration** — menu music, ambience loop, falling wind, landing thud, random horror stingers while exploring

## Tech stack (fastest tool for each task)

| Task | Tool |
|---|---|
| Maze generation, mega rooms, collision math | Rust → WASM (`wasm-bindgen`) |
| Rendering | Three.js with `InstancedMesh` |
| App logic, state machine, player, audio | TypeScript (bundled by esbuild) |
| Textures | Procedural `<canvas>` (no network requests, instant) |

## Project layout

```
Backrooms-Testing-New/
├── index.html                 # entry point
├── css/style.css              # title/settings/cutscene/HUD styling
├── audio/                     # 6 audio files (menu music, ambience, SFX)
├── wasm/                      # Rust source for WASM module
│   ├── Cargo.toml
│   └── src/lib.rs             # maze gen, mega rooms, collision math
├── src/                       # TypeScript app modules
│   ├── main.ts                # state machine, fresh seed per run
│   ├── audio.ts               # menu/ambience/cutscene/horror
│   ├── textures.ts            # procedural realistic Level 0 textures
│   ├── renderer.ts            # Three.js + fog + perf settings
│   ├── world.ts               # chunk streaming + WASM bridge
│   └── player.ts              # pointer lock + WASD + collision
├── build.sh                   # rebuild script
├── package.json
└── README.md
```

## Run (no build needed — `dist/` is committed)

The compiled bundle (`dist/main.js` + WASM) is included in the repo, so you can clone and play immediately:

```bash
git clone https://github.com/ddown325/Backrooms-Testing-New.git
cd Backrooms-Testing-New

# Serve over HTTP (required — file:// won't work for WASM/fetch)
python3 -m http.server 8000
#   or:  npx serve .
#   or:  bun .
```

Open http://localhost:8000 in your browser. Click **New Game** → cutscene → you spawn in a fresh infinite Level 0 maze.

## Build (only needed if you edit Rust or TypeScript)

The `dist/` folder in the repo is prebuilt. You only need to rebuild if you change source code.

### Build requirements

- **Rust** (stable) with `wasm32-unknown-unknown` target
- **wasm-bindgen-cli** 0.2.95
- **Node.js** 18+ with npm

```bash
# One-time toolchain setup
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.95
npm install

# Rebuild after editing source
./build.sh
```

## Controls

| Action | Key |
|---|---|
| Move | W A S D / Arrow keys |
| Sprint | Shift |
| Look | Mouse (click canvas to lock pointer) |
| Release mouse | ESC |
| Quit to menu | Button in bottom-right HUD |

## How to tweak

| Want to change... | Edit... |
|---|---|
| Wall density | `wasm/src/lib.rs` — `if r < 28` (currently 28% walls) |
| Mega room rarity | `wasm/src/lib.rs` — `MEGA_RARITY` (currently 32 = ~1 per 32 chunks) |
| Mega room size | `wasm/src/lib.rs` — `MEGA_RADIUS` (currently 6 cells) |
| View distance | `src/main.ts` — `VIEW_RADIUS` (currently 2 = 5×5 chunks) |
| Render quality defaults | `src/main.ts` — `DEFAULT_SETTINGS` |
| Texture look | `src/textures.ts` — base colors and noise variance |
| Player speed | `src/player.ts` — `MOVE_SPEED`, `SPRINT_MULT` |

After editing Rust or TypeScript, run `./build.sh` to rebuild.

## Performance notes

Tested design targets 60 FPS on integrated GPUs. If you still get lag:

1. Open Settings → drop **Render Scale** to 0.5–0.7
2. Bump **Fog Density** to 0.05–0.06 (hides chunk streaming at closer range)
3. Turn off **Antialiasing**
4. Drop **FOV** to 60–70 (less pixel area to shade)

The FPS counter in the bottom-left HUD tells you where you stand.

## License

MIT — do whatever you want with it.

## Credits

Audio assets included in `audio/` are the original files supplied by the project owner.
