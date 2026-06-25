// main.ts — state machine, UI wiring, game loop.
// States: TITLE -> CUTSCENE -> GAME -> (dead/quit) -> TITLE
// A fresh random seed is generated every time the player starts a new game.

import * as THREE from 'three';
import { Renderer, RendererSettings } from './renderer';
import { Player } from './player';
import {
  initWorld, buildChunk, disposeChunk, initMaterials, getWorld,
  CHUNK_SIZE, CELL_SIZE, ChunkMeshes,
} from './world';
import { generateLevelTextures } from './textures';
import { AudioManager, AudioSettings } from './audio';

type State = 'TITLE' | 'CUTSCENE' | 'GAME';

interface GameSettings {
  audio: AudioSettings;
  render: RendererSettings;
}

const DEFAULT_SETTINGS: GameSettings = {
  audio: { master: 1, ambience: 0.8, music: 0.7, sfx: 0.9 },
  render: {
    renderScale: 0.85,
    fogDensity: 0.035,
    fov: 75,
    antialias: false,
  },
};

// ---------- DOM ----------
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const titleScreen = document.getElementById('title-screen')!;
const settingsPanel = document.getElementById('settings-panel')!;
const cutsceneOverlay = document.getElementById('cutscene-overlay')!;
const cutsceneText = document.getElementById('cutscene-text')!;
const hud = document.getElementById('hud')!;
const fpsCounter = document.getElementById('fps-counter')!;
const newGameBtn = document.getElementById('btn-new-game')!;
const settingsBtn = document.getElementById('btn-settings')!;
const quitBtn = document.getElementById('btn-quit')!;
const closeSettingsBtn = document.getElementById('btn-close-settings')!;

const sMaster = document.getElementById('s-master') as HTMLInputElement;
const sAmb = document.getElementById('s-amb') as HTMLInputElement;
const sMus = document.getElementById('s-mus') as HTMLInputElement;
const sSfx = document.getElementById('s-sfx') as HTMLInputElement;
const sScale = document.getElementById('s-scale') as HTMLInputElement;
const sFog = document.getElementById('s-fog') as HTMLInputElement;
const sFov = document.getElementById('s-fov') as HTMLInputElement;
const sAA = document.getElementById('s-aa') as HTMLInputElement;

// ---------- Globals ----------
let renderer: Renderer | null = null;
let player: Player | null = null;
let audio: AudioManager;
let settings: GameSettings = loadSettings();
let state: State = 'TITLE';

// Chunk streaming
const loadedChunks: Map<string, ChunkMeshes> = new Map();
const VIEW_RADIUS = 2; // chunks around player (5x5 = 25 chunks max)

// Per-run seed
let currentSeed = 0;

// Timing
let lastTime = performance.now();
let frameCount = 0;
let fpsAccum = 0;
let fpsTimer = 0;

// Horror stinger scheduler
let nextHorrorAt = 0;

// ---------- Settings persistence ----------
function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem('backrooms-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings() {
  try { localStorage.setItem('backrooms-settings', JSON.stringify(settings)); } catch {}
}

function applySettingsToUI() {
  sMaster.value = String(settings.audio.master);
  sAmb.value = String(settings.audio.ambience);
  sMus.value = String(settings.audio.music);
  sSfx.value = String(settings.audio.sfx);
  sScale.value = String(settings.render.renderScale);
  sFog.value = String(settings.render.fogDensity);
  sFov.value = String(settings.render.fov);
  sAA.checked = settings.render.antialias;
}

function readSettingsFromUI() {
  settings.audio.master = parseFloat(sMaster.value);
  settings.audio.ambience = parseFloat(sAmb.value);
  settings.audio.music = parseFloat(sMus.value);
  settings.audio.sfx = parseFloat(sSfx.value);
  settings.render.renderScale = parseFloat(sScale.value);
  settings.render.fogDensity = parseFloat(sFog.value);
  settings.render.fov = parseFloat(sFov.value);
  settings.render.antialias = sAA.checked;
  saveSettings();
  audio.setSettings(settings.audio);
  if (renderer) renderer.applySettings(settings.render);
}

[sMaster, sAmb, sMus, sSfx, sScale, sFog, sFov, sAA].forEach((el) => {
  el.addEventListener('input', readSettingsFromUI);
});

// ---------- State transitions ----------
function setState(s: State) {
  state = s;
  titleScreen.style.display = s === 'TITLE' ? 'flex' : 'none';
  cutsceneOverlay.style.display = s === 'CUTSCENE' ? 'flex' : 'none';
  hud.style.display = s === 'GAME' ? 'flex' : 'none';
  canvas.style.display = s === 'GAME' ? 'block' : 'none';
}

// ---------- Title screen ----------
async function showTitle() {
  setState('TITLE');
  // Stop ambience, start menu music
  audio.stopAmbience();
  await audio.startMenuMusic();
}

// ---------- New game (fresh seed every time) ----------
async function startNewGame() {
  // Fresh 32-bit seed via crypto
  const seedBytes = new Uint32Array(1);
  crypto.getRandomValues(seedBytes);
  currentSeed = seedBytes[0];
  console.log('New Backrooms seed:', currentSeed);

  // Stop menu music
  audio.stopMenuMusic();

  // Show cutscene
  setState('CUTSCENE');
  await runCutscene();

  // Enter game — if this fails, show error instead of black screen
  try {
    await enterGame();
  } catch (err) {
    console.error('Failed to enter game:', err);
    showError(err instanceof Error ? err.message : String(err));
  }
}

// ---------- Error display ----------
function showError(msg: string) {
  const overlay = document.getElementById('cutscene-overlay')!;
  const text = document.getElementById('cutscene-text')!;
  overlay.style.background = '#1a0000';
  overlay.style.display = 'flex';
  text.innerHTML = `<div style="font-size:0.7em; color:#ff6a4a; margin-bottom:1em">ERROR</div>${msg}<br><br><span style="font-size:0.6em; opacity:0.6">Check the browser console (F12) for details.<br>Click to return to menu.</span>`;
  text.style.opacity = '1';
  const clickHandler = () => {
    overlay.style.display = 'none';
    overlay.removeEventListener('click', clickHandler);
    showTitle();
  };
  overlay.addEventListener('click', clickHandler);
}

// ---------- Cutscene: "falling into the backrooms" ----------
async function runCutscene() {
  cutsceneOverlay.style.background = 'radial-gradient(circle at center, #1a1500 0%, #000 100%)';
  cutsceneText.textContent = 'You feel weightless...';
  cutsceneText.style.opacity = '1';

  // Play falling wind sound
  audio.playSfx('falling_wind');

  // Fade to white at end of fall
  await wait(2000);
  cutsceneText.textContent = '...you fall through the floor.';
  await wait(1800);

  // Land thud + flash to Level 0 yellow
  audio.playSfx('landing_thud');
  cutsceneOverlay.style.background = '#b8a868';
  cutsceneText.style.opacity = '0';
  await wait(700);

  cutsceneOverlay.style.background = '#000';
  await wait(150);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Game entry ----------
async function enterGame() {
  // Initialize WASM world with new seed
  await initWorld(currentSeed);

  // Generate procedural textures with a per-seed variant
  const textures = generateLevelTextures(currentSeed);
  initMaterials(textures);

  // Create renderer (if not yet) — reused across runs
  if (!renderer) {
    renderer = new Renderer(canvas, settings.render);
    window.addEventListener('resize', () => renderer?.onResize());
  } else {
    renderer.applySettings(settings.render);
  }

  // Clear previous chunks (if any — from a prior run)
  for (const [, meshes] of loadedChunks) {
    renderer.scene.remove(meshes.group);
    disposeChunk(meshes);
  }
  loadedChunks.clear();

  // Create player if needed
  if (!player) {
    player = new Player(renderer.camera);
    player.attachInput(canvas);
  }

  // Find a guaranteed-open spawn cell near chunk (0,0)
  const world = getWorld();
  const spawn = world.find_spawn(0, 0);
  const spawnLx = spawn & 0xff;
  const spawnLy = (spawn >> 8) & 0xff;
  const spawnX = spawnLx * CELL_SIZE + CELL_SIZE / 2;
  const spawnZ = spawnLy * CELL_SIZE + CELL_SIZE / 2;
  player.setPosition(spawnX, spawnZ);

  // Stream initial chunks around spawn
  updateChunks();

  // Switch state
  setState('GAME');

  // Start ambience
  await audio.startAmbience();

  // Reset timers and stinger schedule
  lastTime = performance.now();
  frameCount = 0;
  fpsAccum = 0;
  fpsTimer = 0;
  nextHorrorAt = performance.now() + 30_000 + Math.random() * 60_000;

  // Auto-request pointer lock (will need user click on some browsers)
  canvas.requestPointerLock?.();
}

// ---------- Chunk streaming ----------
function chunkKey(cx: number, cy: number) { return `${cx},${cy}`; }

function updateChunks() {
  if (!renderer || !player) return;
  const pcx = Math.floor(player.position.x / (CHUNK_SIZE * CELL_SIZE));
  const pcy = Math.floor(player.position.z / (CHUNK_SIZE * CELL_SIZE));

  // Build needed set
  const needed: Array<[number, number]> = [];
  for (let dy = -VIEW_RADIUS; dy <= VIEW_RADIUS; dy++) {
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      needed.push([pcx + dx, pcy + dy]);
    }
  }

  // Load missing chunks (limit per frame to avoid hitches)
  let budget = 2;
  for (const [cx, cy] of needed) {
    if (budget <= 0) break;
    const key = chunkKey(cx, cy);
    if (!loadedChunks.has(key)) {
      const meshes = buildChunk(cx, cy);
      renderer.scene.add(meshes.group);
      loadedChunks.set(key, meshes);
      // Register cells for collision
      player.registerChunkCells(cx, cy, (meshes.group as any).userData.cells);
      budget--;
    }
  }

  // Unload chunks that fell out of view (slightly larger radius for hysteresis)
  const dropRadius = VIEW_RADIUS + 1;
  for (const [key, meshes] of loadedChunks) {
    const [cx, cy] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > dropRadius || Math.abs(cy - pcy) > dropRadius) {
      renderer.scene.remove(meshes.group);
      disposeChunk(meshes);
      loadedChunks.delete(key);
      player.unregisterChunkCells(cx, cy);
    }
  }
}

// ---------- Main loop ----------
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (state === 'GAME' && renderer && player) {
    player.update(dt);
    updateChunks();

    // Rare horror stingers
    if (now >= nextHorrorAt) {
      audio.playRandomHorror();
      nextHorrorAt = now + 60_000 + Math.random() * 120_000;
    }

    renderer.render();

    // FPS counter
    frameCount++;
    fpsAccum += dt;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      const fps = Math.round(frameCount / fpsAccum);
      if (fpsCounter) fpsCounter.textContent = `FPS: ${fps}`;
      frameCount = 0;
      fpsAccum = 0;
      fpsTimer = 0;
    }
  } else if (renderer && state !== 'GAME') {
    // Render scene under overlays (nice subtle background for title)
    // Skip — overlays cover the canvas anyway.
  }
}

// ---------- Button wiring ----------
newGameBtn.addEventListener('click', async () => {
  await audio.ensureContext();
  await startNewGame();
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = settingsPanel.style.display === 'flex' ? 'none' : 'flex';
});

closeSettingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = 'none';
});

quitBtn.addEventListener('click', async () => {
  // Stop game, return to title
  audio.stopAmbience();
  audio.fadeOut(200);
  setTimeout(() => audio.fadeIn(200), 250);
  if (document.pointerLockElement) document.exitPointerLock();
  // Clear chunks
  if (renderer) {
    for (const [, meshes] of loadedChunks) {
      renderer.scene.remove(meshes.group);
      disposeChunk(meshes);
    }
    loadedChunks.clear();
  }
  await showTitle();
});

// ESC quits pointer lock and shows pause overlay (browser default)
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'GAME') {
    // Optional: show "click to resume" — for now, just keep state.
  }
});

// ---------- Boot ----------
async function boot() {
  audio = new AudioManager();
  audio.setSettings(settings.audio);
  applySettingsToUI();

  // Start main loop (it'll no-op until state = GAME)
  requestAnimationFrame(loop);

  // Show title. Menu music starts on first user interaction (browser policy).
  setState('TITLE');
  // Bind a one-shot gesture to start menu music.
  const startMusicOnce = async () => {
    await audio.ensureContext();
    await audio.startMenuMusic();
    window.removeEventListener('click', startMusicOnce);
    window.removeEventListener('keydown', startMusicOnce);
  };
  window.addEventListener('click', startMusicOnce);
  window.addEventListener('keydown', startMusicOnce);
}

boot();
