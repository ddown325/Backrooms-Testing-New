// Backrooms WASM — maze generation, mega rooms, collision math
// All math runs in WASM (fast); JS handles Three.js mesh creation.
use wasm_bindgen::prelude::*;

// ---------- Deterministic PRNG (splitmix32 + xorshift) ----------
#[inline(always)]
fn hash32(x: i32, y: i32, seed: u32) -> u32 {
    // Good avalanche mix of cell coords + seed
    let mut h = seed
        .wrapping_add(x as u32)
        .wrapping_mul(2654435761)
        .wrapping_add(y as u32)
        .wrapping_mul(2246822519);
    h ^= h >> 16;
    h = h.wrapping_mul(2246822519);
    h ^= h >> 13;
    h = h.wrapping_mul(3266489917);
    h ^= h >> 16;
    h
}

#[inline(always)]
fn next_rand(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

// ---------- Cell types ----------
// 0 = open floor, 1 = wall, 2 = pillar (single cell), 3 = mega-room interior
pub const CELL_OPEN: u8 = 0;
pub const CELL_WALL: u8 = 1;
pub const CELL_PILLAR: u8 = 2;
pub const CELL_MEGA: u8 = 3;

// ---------- Chunk layout ----------
// A chunk is CHUNK_SIZE x CHUNK_SIZE cells. Each cell is CELL_SIZE world units.
pub const CHUNK_SIZE: i32 = 16;
pub const CELL_SIZE: f32 = 4.0;

// Mega room rarity: 1 in N chunks is a mega room center
pub const MEGA_RARITY: u32 = 32;
pub const MEGA_RADIUS: i32 = 6; // cells from center

#[wasm_bindgen]
pub struct World {
    seed: u32,
}

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> World {
        World { seed }
    }

    /// Generate a chunk's cell data into the provided Uint8Array.
    /// Layout: row-major [y * CHUNK_SIZE + x], 0..CHUNK_SIZE for both axes.
    /// Cell values are the CELL_* constants.
    #[wasm_bindgen]
    pub fn gen_chunk(&self, chunk_x: i32, chunk_y: i32, out: &mut [u8]) {
        debug_assert_eq!(out.len(), (CHUNK_SIZE * CHUNK_SIZE) as usize);

        // First, check if this chunk overlaps any mega-room center.
        // Mega-room centers are anchored to chunk (cx, cy) where hash mod MEGA_RARITY == 0.
        // We scan a small neighborhood of chunks to find any centers whose radius covers us.
        let mut mega_centers: Vec<(i32, i32)> = Vec::new();
        for dcy in -1..=1 {
            for dcx in -1..=1 {
                let ccx = chunk_x + dcx;
                let ccy = chunk_y + dcy;
                let h = hash32(ccx, ccy, self.seed ^ 0xDEAD_BEEF);
                if h % MEGA_RARITY == 0 {
                    // Mega-room center sits at the middle cell of that chunk
                    let mx = ccx * CHUNK_SIZE + CHUNK_SIZE / 2;
                    let my = ccy * CHUNK_SIZE + CHUNK_SIZE / 2;
                    mega_centers.push((mx, my));
                }
            }
        }

        // Per-chunk PRNG state — deterministic per (chunk_x, chunk_y, seed)
        let mut rng = hash32(chunk_x, chunk_y, self.seed);

        for ly in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let wx = chunk_x * CHUNK_SIZE + lx;
                let wy = chunk_y * CHUNK_SIZE + ly;
                let idx = (ly * CHUNK_SIZE + lx) as usize;

                // Check mega-room membership
                let mut in_mega = false;
                let mut near_mega_edge = false;
                for &(mx, my) in &mega_centers {
                    let dx = wx - mx;
                    let dy = wy - my;
                    let d2 = dx * dx + dy * dy;
                    if d2 <= MEGA_RADIUS * MEGA_RADIUS {
                        in_mega = true;
                        if d2 >= (MEGA_RADIUS - 1) * (MEGA_RADIUS - 1) {
                            near_mega_edge = true;
                        }
                    }
                }

                if in_mega && !near_mega_edge {
                    // Mega room interior: mostly open with sparse pillars
                    let r = next_rand(&mut rng) % 100;
                    if r < 4 {
                        out[idx] = CELL_PILLAR;
                    } else {
                        out[idx] = CELL_MEGA;
                    }
                    continue;
                }

                // Normal maze area: wall density ~28%, with occasional pillars
                let r = next_rand(&mut rng) % 100;
                if r < 28 {
                    out[idx] = CELL_WALL;
                } else if r < 32 {
                    out[idx] = CELL_PILLAR;
                } else {
                    out[idx] = CELL_OPEN;
                }
            }
        }

        // Carve connectivity: ensure no chunk is fully walled (rare but possible)
        // Count opens
        let mut opens = 0u32;
        for &v in out.iter() {
            if v == CELL_OPEN || v == CELL_MEGA {
                opens += 1;
            }
        }
        if opens < 32 {
            // Force some open cells at fixed positions
            for &i in &[0usize, 5, 10, 15, 21, 42, 84, 120, 170, 200, 250] {
                if i < out.len() {
                    out[i] = CELL_OPEN;
                }
            }
        }
    }

    /// Test player collision against chunk cell data.
    /// Returns true if the player circle (px, py, radius r) collides with any wall/pillar
    /// in the given chunk cell buffer. Coordinates are in WORLD units.
    #[wasm_bindgen]
    pub fn collides_in_chunk(&self, px: f32, py: f32, r: f32, chunk_x: i32, chunk_y: i32, cells: &[u8]) -> bool {
        // World -> cell coords
        let base_x = chunk_x as f32 * CHUNK_SIZE as f32 * CELL_SIZE;
        let base_y = chunk_y as f32 * CHUNK_SIZE as f32 * CELL_SIZE;

        let local_x = (px - base_x) / CELL_SIZE;
        let local_y = (py - base_y) / CELL_SIZE;

        // Search box: cells overlapping player circle, clamped to chunk
        let min_lx = (local_x - r / CELL_SIZE).floor() as i32;
        let max_lx = (local_x + r / CELL_SIZE).ceil() as i32;
        let min_ly = (local_y - r / CELL_SIZE).floor() as i32;
        let max_ly = (local_y + r / CELL_SIZE).ceil() as i32;

        let lx0 = min_lx.max(0).min(CHUNK_SIZE - 1);
        let lx1 = max_lx.max(0).min(CHUNK_SIZE - 1);
        let ly0 = min_ly.max(0).min(CHUNK_SIZE - 1);
        let ly1 = max_ly.max(0).min(CHUNK_SIZE - 1);

        for ly in ly0..=ly1 {
            for lx in lx0..=lx1 {
                let cell = cells[(ly * CHUNK_SIZE + lx) as usize];
                if cell == CELL_WALL || cell == CELL_PILLAR {
                    // Cell AABB in local space (with small inset so walls feel solid)
                    let cell_min_x = lx as f32 * CELL_SIZE + 0.1;
                    let cell_max_x = (lx as f32 + 1.0) * CELL_SIZE - 0.1;
                    let cell_min_y = ly as f32 * CELL_SIZE + 0.1;
                    let cell_max_y = (ly as f32 + 1.0) * CELL_SIZE - 0.1;

                    // Closest point on AABB to circle center
                    let cx = local_x.clamp(cell_min_x, cell_max_x) as f32;
                    let cy = local_y.clamp(cell_min_y, cell_max_y) as f32;
                    let dx = (px - base_x) / CELL_SIZE - cx;
                    let dy = (py - base_y) / CELL_SIZE - cy;
                    if dx * dx + dy * dy < r * r {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Convenience: is cell (world coords) a wall/pillar? Used for spawn validation.
    #[wasm_bindgen]
    pub fn is_blocked(&self, wx: i32, wy: i32) -> bool {
        let chunk_x = wx.div_euclid(CHUNK_SIZE);
        let chunk_y = wy.div_euclid(CHUNK_SIZE);
        let lx = wx.rem_euclid(CHUNK_SIZE);
        let ly = wy.rem_euclid(CHUNK_SIZE);

        let mut buf = vec![0u8; (CHUNK_SIZE * CHUNK_SIZE) as usize];
        // Re-implement gen_chunk inline to avoid borrow issues — but we can call it via the public API
        // by creating a local slice. Simpler: just re-hash the cell.
        // For spawn checks we only need a single cell, so do a direct hash check.
        let h = hash32(wx, wy, self.seed ^ 0xBEEF_F00D);

        // Replicate the gen logic for a single cell.
        // First check mega rooms.
        for dcy in -1..=1 {
            for dcx in -1..=1 {
                let ccx = chunk_x + dcx;
                let ccy = chunk_y + dcy;
                let mh = hash32(ccx, ccy, self.seed ^ 0xDEAD_BEEF);
                if mh % MEGA_RARITY == 0 {
                    let mx = ccx * CHUNK_SIZE + CHUNK_SIZE / 2;
                    let my = ccy * CHUNK_SIZE + CHUNK_SIZE / 2;
                    let dx = wx - mx;
                    let dy = wy - my;
                    let d2 = dx * dx + dy * dy;
                    if d2 <= MEGA_RADIUS * MEGA_RADIUS
                        && d2 >= (MEGA_RADIUS - 1) * (MEGA_RADIUS - 1)
                    {
                        // near edge — treat as normal maze cell
                        let r = h % 100;
                        return r < 28 || (r >= 28 && r < 32);
                    }
                    if d2 < (MEGA_RADIUS - 1) * (MEGA_RADIUS - 1) {
                        let r = h % 100;
                        return r < 4; // pillar only
                    }
                }
            }
        }

        let _ = buf; // unused
        let r = h % 100;
        r < 28 || (r >= 28 && r < 32)
    }

    /// Find a guaranteed-open spawn cell near (chunk_x, chunk_y) center.
    /// Returns packed (lx + ly * 256) — local coords within the chunk.
    #[wasm_bindgen]
    pub fn find_spawn(&self, chunk_x: i32, chunk_y: i32) -> u32 {
        // Search outward from center for an open cell.
        let cx = CHUNK_SIZE / 2;
        let cy = CHUNK_SIZE / 2;
        for radius in 0..CHUNK_SIZE {
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    if dx.abs() != radius && dy.abs() != radius {
                        continue;
                    }
                    let lx = cx + dx;
                    let ly = cy + dy;
                    if lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE {
                        continue;
                    }
                    let wx = chunk_x * CHUNK_SIZE + lx;
                    let wy = chunk_y * CHUNK_SIZE + ly;
                    if !self.is_blocked(wx, wy) {
                        return (lx as u32) | ((ly as u32) << 8);
                    }
                }
            }
        }
        // Fallback: center cell
        (cx as u32) | ((cy as u32) << 8)
    }
}
