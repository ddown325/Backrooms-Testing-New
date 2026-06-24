// player.ts — pointer lock controls, WASD movement, collision against chunk cells via WASM.

import * as THREE from 'three';
import { getWorld, CHUNK_SIZE, CELL_SIZE } from './world';

const PLAYER_RADIUS = 0.35;
const EYE_HEIGHT = 1.7;
const MOVE_SPEED = 3.2;       // m/s walk
const SPRINT_MULT = 1.7;
const ACCEL = 12;             // how fast we ramp velocity toward target
const BOB_AMP = 0.04;
const BOB_FREQ = 9;

export class Player {
  position = new THREE.Vector3(0, EYE_HEIGHT, 0);
  private yaw = 0;
  private pitch = 0;
  private vel = new THREE.Vector3();
  private bobPhase = 0;

  // Key state
  private keys: Record<string, boolean> = {};

  // Cached chunk cell buffers (chunkX, chunkY -> Uint8Array)
  private chunkCells: Map<string, Uint8Array> = new Map();

  constructor(private camera: THREE.PerspectiveCamera) {}

  attachInput(canvas: HTMLCanvasElement) {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      // ignore — UI handles unlock state
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0022;
        this.pitch -= e.movementY * 0.0022;
        this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
      }
    });
  }

  setPosition(x: number, z: number) {
    this.position.set(x, EYE_HEIGHT, z);
    this.vel.set(0, 0, 0);
  }

  // Cache chunk cells for collision lookups
  registerChunkCells(chunkX: number, chunkY: number, cells: Uint8Array) {
    this.chunkCells.set(`${chunkX},${chunkY}`, cells);
  }

  unregisterChunkCells(chunkX: number, chunkY: number) {
    this.chunkCells.delete(`${chunkX},${chunkY}`);
  }

  private collides(x: number, z: number): boolean {
    const world = getWorld();
    // Determine which chunks could contain the player's circle
    const cx0 = Math.floor((x - PLAYER_RADIUS) / (CHUNK_SIZE * CELL_SIZE));
    const cx1 = Math.floor((x + PLAYER_RADIUS) / (CHUNK_SIZE * CELL_SIZE));
    const cy0 = Math.floor((z - PLAYER_RADIUS) / (CHUNK_SIZE * CELL_SIZE));
    const cy1 = Math.floor((z + PLAYER_RADIUS) / (CHUNK_SIZE * CELL_SIZE));

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cy}`;
        let cells = this.chunkCells.get(key);
        if (!cells) continue; // chunk not loaded — skip (will resolve next frame)
        if (world.collides_in_chunk(x, z, PLAYER_RADIUS, cx, cy, cells)) {
          return true;
        }
      }
    }
    return false;
  }

  update(dt: number) {
    // Build desired velocity in world space
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp']) wish.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) wish.sub(forward);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) wish.add(right);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) wish.sub(right);

    const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? SPRINT_MULT : 1.0;
    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(MOVE_SPEED * sprint);
    }

    // Smoothly accelerate toward wish velocity
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, ACCEL * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, ACCEL * dt);

    // Attempt X movement
    const newX = this.position.x + this.vel.x * dt;
    if (!this.collides(newX, this.position.z)) {
      this.position.x = newX;
    } else {
      this.vel.x = 0;
    }
    // Attempt Z movement
    const newZ = this.position.z + this.vel.z * dt;
    if (!this.collides(this.position.x, newZ)) {
      this.position.z = newZ;
    } else {
      this.vel.z = 0;
    }

    // Head bob when moving
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.1) {
      this.bobPhase += BOB_FREQ * dt;
    } else {
      // settle bob toward 0
      this.bobPhase += BOB_FREQ * dt * 0.25;
    }
    const bob = Math.sin(this.bobPhase) * BOB_AMP * Math.min(1, speed / MOVE_SPEED);

    // Apply to camera
    this.camera.position.copy(this.position);
    this.camera.position.y += bob;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  get locked(): boolean {
    return !!document.pointerLockElement;
  }
}
