// world.ts — chunk manager + WASM bridge
// Builds Three.js meshes from WASM-generated cell data.
// Streams chunks in/out around the player. Uses InstancedMesh per chunk
// for walls and pillars (one draw call per type per chunk).

import * as THREE from 'three';
// esbuild bundles the wasm-bindgen JS glue and rewrites the .wasm import to a hashed URL.
import init, { World } from '../dist/wasm/backrooms_wasm.js';
import wasmUrl from '../dist/wasm/backrooms_wasm_bg.wasm?url';

// WASM module is loaded once and shared.
let wasmReady: Promise<void> | null = null;
let worldInstance: World | null = null;

export const CHUNK_SIZE = 16;
export const CELL_SIZE = 4.0;
export const WALL_HEIGHT = 3.2;

export async function initWorld(seed: number): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      // CRITICAL: resolve the wasm URL relative to THIS module, not the page.
      // import.meta.url is the URL of this module (dist/main.js after bundling).
      // wasmUrl is a relative path like "./backrooms_wasm_bg-HASH.wasm".
      // Without this, fetch() resolves against the page URL and 404s.
      const url = new URL(wasmUrl, import.meta.url);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load WASM module: ${res.status} ${url.href}`);
      }
      const buf = await res.arrayBuffer();
      await init(buf);
    })();
  }
  await wasmReady;
  // Create a fresh World per seed.
  if (worldInstance) {
    (worldInstance as any).free?.();
  }
  worldInstance = new World(seed);
}

export function getWorld(): World {
  if (!worldInstance) throw new Error('World not initialized — call initWorld first');
  return worldInstance;
}

export interface ChunkMeshes {
  group: THREE.Group;
  walls: THREE.InstancedMesh;
  pillars: THREE.InstancedMesh;
  floor: THREE.Mesh;
  ceiling: THREE.Mesh;
  lights: THREE.InstancedMesh;
}

// Reusable materials (shared across chunks for perf)
let materials: {
  wallpaper: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  light: THREE.MeshStandardMaterial;
  baseboard: THREE.MeshStandardMaterial;
} | null = null;

export function initMaterials(textures: {
  wallpaper: HTMLCanvasElement;
  carpet: HTMLCanvasElement;
  ceiling: HTMLCanvasElement;
  lightPanel: HTMLCanvasElement;
  baseboard: HTMLCanvasElement;
}): void {
  const makeTex = (canvas: HTMLCanvasElement, repeat = 1) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 1;
    return t;
  };

  materials = {
    wallpaper: new THREE.MeshStandardMaterial({
      map: makeTex(textures.wallpaper, 1),
      roughness: 0.92,
      metalness: 0.0,
    }),
    carpet: new THREE.MeshStandardMaterial({
      map: makeTex(textures.carpet, 1),
      roughness: 1.0,
      metalness: 0.0,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      map: makeTex(textures.ceiling, 1),
      roughness: 0.95,
      metalness: 0.0,
    }),
    light: new THREE.MeshStandardMaterial({
      map: makeTex(textures.lightPanel, 1),
      emissive: new THREE.Color(0xfff8d0),
      emissiveMap: makeTex(textures.lightPanel, 1),
      emissiveIntensity: 1.4,
      roughness: 0.5,
      metalness: 0.0,
    }),
    baseboard: new THREE.MeshStandardMaterial({
      map: makeTex(textures.baseboard, 4),
      roughness: 0.7,
      metalness: 0.0,
    }),
  };
}

// Cell value constants — must match wasm/src/lib.rs
const CELL_OPEN = 0;
const CELL_WALL = 1;
const CELL_PILLAR = 2;
const CELL_MEGA = 3;

const tmpObj = new THREE.Object3D();

export function buildChunk(chunkX: number, chunkY: number): ChunkMeshes {
  if (!materials) throw new Error('Materials not initialized');

  const world = getWorld();
  const cellCount = CHUNK_SIZE * CHUNK_SIZE;
  const cells = new Uint8Array(cellCount);
  world.gen_chunk(chunkX, chunkY, cells);

  // Count walls and pillars for instance allocation
  let wallCount = 0;
  let pillarCount = 0;
  for (let i = 0; i < cellCount; i++) {
    if (cells[i] === CELL_WALL) wallCount++;
    else if (cells[i] === CELL_PILLAR) pillarCount++;
  }

  const group = new THREE.Group();

  // ---- Floor + ceiling planes (cover whole chunk) ----
  const chunkWorldSize = CHUNK_SIZE * CELL_SIZE;
  const baseX = chunkX * chunkWorldSize;
  const baseY = chunkY * chunkWorldSize;

  // Floor
  const floorGeo = new THREE.PlaneGeometry(chunkWorldSize, chunkWorldSize);
  // Repeat carpet texture per-cell
  const floorMat = materials.carpet.clone();
  floorMat.map = materials.carpet.map!.clone();
  floorMat.map!.wrapS = floorMat.map!.wrapT = THREE.RepeatWrapping;
  floorMat.map!.repeat.set(CHUNK_SIZE, CHUNK_SIZE);
  floorMat.map!.needsUpdate = true;
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(baseX + chunkWorldSize / 2, 0, baseY + chunkWorldSize / 2);
  floor.receiveShadow = false;
  group.add(floor);

  // Ceiling
  const ceilGeo = new THREE.PlaneGeometry(chunkWorldSize, chunkWorldSize);
  const ceilMat = materials.ceiling.clone();
  ceilMat.map = materials.ceiling.map!.clone();
  ceilMat.map!.wrapS = ceilMat.map!.wrapT = THREE.RepeatWrapping;
  ceilMat.map!.repeat.set(CHUNK_SIZE, CHUNK_SIZE);
  ceilMat.map!.needsUpdate = true;
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(baseX + chunkWorldSize / 2, WALL_HEIGHT, baseY + chunkWorldSize / 2);
  group.add(ceiling);

  // ---- Walls (InstancedMesh) ----
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
  const walls = new THREE.InstancedMesh(wallGeo, materials.wallpaper, Math.max(1, wallCount));
  // Light every Nth wall cell with a fluorescent panel
  const LIGHT_EVERY = 16; // 1 in 16 wall-eligible slots becomes a light (roughly 1 per chunk)
  const lightGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.8, CELL_SIZE * 0.8);
  const lights = new THREE.InstancedMesh(lightGeo, materials.light, 4); // small fixed count
  let lightIdx = 0;

  let wi = 0;
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const cell = cells[ly * CHUNK_SIZE + lx];
      const wx = baseX + lx * CELL_SIZE + CELL_SIZE / 2;
      const wz = baseY + ly * CELL_SIZE + CELL_SIZE / 2;
      if (cell === CELL_WALL) {
        tmpObj.position.set(wx, WALL_HEIGHT / 2, wz);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.scale.set(1, 1, 1);
        tmpObj.updateMatrix();
        walls.setMatrixAt(wi++, tmpObj.matrix);
      }
    }
  }
  walls.count = wi;
  walls.instanceMatrix.needsUpdate = true;
  group.add(walls);

  // ---- Pillars (InstancedMesh) — thin square pillars in mega rooms ----
  const pillarGeo = new THREE.BoxGeometry(0.8, WALL_HEIGHT, 0.8);
  const pillars = new THREE.InstancedMesh(pillarGeo, materials.baseboard, Math.max(1, pillarCount));
  let pi = 0;
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const cell = cells[ly * CHUNK_SIZE + lx];
      if (cell === CELL_PILLAR) {
        const wx = baseX + lx * CELL_SIZE + CELL_SIZE / 2;
        const wz = baseY + ly * CELL_SIZE + CELL_SIZE / 2;
        tmpObj.position.set(wx, WALL_HEIGHT / 2, wz);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.scale.set(1, 1, 1);
        tmpObj.updateMatrix();
        pillars.setMatrixAt(pi++, tmpObj.matrix);
      }
    }
  }
  pillars.count = pi;
  pillars.instanceMatrix.needsUpdate = true;
  group.add(pillars);

  // ---- Lights: place 2-3 fluorescent panels in this chunk's open/mega cells ----
  // Cheap approach: pick a few open cells deterministically.
  let placedLights = 0;
  for (let i = 0; i < cellCount && placedLights < 4; i += 17) {
    const cell = cells[i];
    if (cell === CELL_OPEN || cell === CELL_MEGA) {
      const lx = i % CHUNK_SIZE;
      const ly = Math.floor(i / CHUNK_SIZE);
      const wx = baseX + lx * CELL_SIZE + CELL_SIZE / 2;
      const wz = baseY + ly * CELL_SIZE + CELL_SIZE / 2;
      tmpObj.position.set(wx, WALL_HEIGHT - 0.05, wz);
      tmpObj.rotation.set(Math.PI / 2, 0, 0);
      tmpObj.scale.set(1, 1, 1);
      tmpObj.updateMatrix();
      lights.setMatrixAt(placedLights, tmpObj.matrix);

      // Add a real point light at this position (cheap, distance-limited)
      const pl = new THREE.PointLight(0xfff4c0, 0.6, CELL_SIZE * 5, 2.0);
      pl.position.set(wx, WALL_HEIGHT - 0.1, wz);
      group.add(pl);

      placedLights++;
    }
  }
  lights.count = placedLights;
  lights.instanceMatrix.needsUpdate = true;
  group.add(lights);

  // Keep the cells buffer around for collision queries
  (group as any).userData = { cells, chunkX, chunkY };

  return { group, walls, pillars, floor, ceiling, lights };
}

export function disposeChunk(meshes: ChunkMeshes) {
  meshes.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      if (obj.material) {
        const m = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    }
    if (obj instanceof THREE.InstancedMesh) {
      obj.geometry?.dispose();
    }
  });
}
