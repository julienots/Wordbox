import { clamp } from '../core/math';
import { hash01 } from '../core/rng';
import { B, BIOMES } from '../data/biomes';
import { DEPOSITS } from '../data/resources';
import type { World } from '../sim/world';
import { SEA_LEVEL } from '../world/classify';
import { CHUNK, TileMap } from '../world/map';
import type { GraphicsQuality } from './quality';

const TREE_BIOMES = new Set<number>([B.FOREST, B.JUNGLE, B.TAIGA, B.SWAMP, B.SAVANNA, B.PLAINS]);

function shade(map: TileMap, fx: number, fy: number): number {
  // hillshade from bilinear-interpolated heights (light from north-west)
  const h = (x: number, y: number) => {
    const xi = clamp(Math.floor(x), 0, map.w - 2), yi = clamp(Math.floor(y), 0, map.h - 2);
    const tx = clamp(x - xi, 0, 1), ty = clamp(y - yi, 0, 1);
    const i = yi * map.w + xi;
    const a = map.height[i], b = map.height[i + 1], c = map.height[i + map.w], d = map.height[i + map.w + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const dx = h(fx + 0.5, fy) - h(fx - 0.5, fy);
  const dy = h(fx, fy + 0.5) - h(fx, fy - 0.5);
  return clamp(1 - (dx + dy) * 9, 0.55, 1.35);
}

/** RGB of a terrain sample (shared by the detailed chunks and the 1px world map). */
function terrainColor(map: TileMap, i: number, fx: number, fy: number, out: number[]): void {
  const b = map.biome[i];
  const info = BIOMES[b];
  let [r, g, bl] = info.color;
  const h = map.height[i];
  if (info.water && b !== B.RIVER) {
    const depth = clamp((SEA_LEVEL - h) / 0.35, 0, 1);
    r = 70 - depth * 55; g = 150 - depth * 105; bl = 195 - depth * 95;
    if (b === B.LAKE) { r += 8; g += 10; }
  } else if (!info.water) {
    const sh = shade(map, fx, fy);
    // vegetation density darkens / greens the ground
    const v = map.veg[i] / 255;
    if (b === B.PLAINS || b === B.SAVANNA || b === B.HILLS) { r = r * (1.08 - v * 0.2); g = g * (0.95 + v * 0.1); }
    const e = clamp((h - SEA_LEVEL) / (1 - SEA_LEVEL), 0, 1);
    r = r * sh + e * 18; g = g * sh + e * 14; bl = bl * sh + e * 12;
    if (map.fire[i] > 0) { r = r * 0.5 + 120; g *= 0.4; bl *= 0.3; }
  }
  out[0] = r; out[1] = g; out[2] = bl;
}

/**
 * Terrain renderer: a 1px-per-tile world map (strategic zoom + minimap) and
 * an LRU cache of detailed chunk textures rebuilt only when their chunk version changes.
 */
export class TerrainRenderer {
  worldCanvas: HTMLCanvasElement;
  private worldCtx: CanvasRenderingContext2D;
  private worldImg: ImageData;
  private worldVer: Uint32Array;
  private chunks = new Map<number, { canvas: HTMLCanvasElement; ver: number; used: number }>();
  private pool: HTMLCanvasElement[] = [];
  private frame = 0;
  builtThisFrame = 0;

  constructor(private w: World, public q: GraphicsQuality) {
    const m = w.map;
    this.worldCanvas = document.createElement('canvas');
    this.worldCanvas.width = m.w;
    this.worldCanvas.height = m.h;
    this.worldCtx = this.worldCanvas.getContext('2d')!;
    this.worldImg = this.worldCtx.createImageData(m.w, m.h);
    this.worldVer = new Uint32Array(m.cw * m.ch).fill(0xffffffff);
    this.refreshWorld(true);
  }

  setQuality(q: GraphicsQuality): void {
    this.q = q;
    this.chunks.clear();
    this.pool = [];
  }
  get cachedChunks(): number {
    return this.chunks.size;
  }

  /** Update the 1px world map for chunks whose version changed. */
  refreshWorld(all = false): void {
    const m = this.w.map;
    const data = this.worldImg.data;
    const c = [0, 0, 0];
    let dirty = false;
    for (let cy = 0; cy < m.ch; cy++)
      for (let cx = 0; cx < m.cw; cx++) {
        const k = cy * m.cw + cx;
        if (!all && this.worldVer[k] === m.chunkVer[k]) continue;
        this.worldVer[k] = m.chunkVer[k];
        dirty = true;
        const x1 = Math.min(m.w, (cx + 1) * CHUNK), y1 = Math.min(m.h, (cy + 1) * CHUNK);
        for (let y = cy * CHUNK; y < y1; y++)
          for (let x = cx * CHUNK; x < x1; x++) {
            const i = y * m.w + x;
            terrainColor(m, i, x + 0.5, y + 0.5, c);
            if (m.road[i]) { c[0] = c[0] * 0.5 + 70; c[1] = c[1] * 0.5 + 60; c[2] = c[2] * 0.5 + 50; }
            if (m.bld[i] >= 0) { c[0] = 200; c[1] = 180; c[2] = 150; }
            const o = i * 4;
            data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
          }
      }
    if (dirty) this.worldCtx.putImageData(this.worldImg, 0, 0);
  }

  /** Get (building if needed and budget allows) the detailed texture of a chunk. */
  chunk(k: number, allowBuild: boolean): HTMLCanvasElement | null {
    const m = this.w.map;
    const e = this.chunks.get(k);
    if (e) {
      e.used = this.frame;
      if (e.ver === m.chunkVer[k] || !allowBuild || this.builtThisFrame >= this.q.chunkBudget) return e.canvas;
      this.build(k, e.canvas);
      e.ver = m.chunkVer[k];
      this.builtThisFrame++;
      return e.canvas;
    }
    if (!allowBuild || this.builtThisFrame >= this.q.chunkBudget) return null;
    if (this.chunks.size >= this.q.chunkCache) this.evict();
    const px = CHUNK * this.q.tilePx;
    const canvas = this.pool.pop() ?? Object.assign(document.createElement('canvas'), { width: px, height: px });
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    this.build(k, canvas);
    this.builtThisFrame++;
    this.chunks.set(k, { canvas, ver: m.chunkVer[k], used: this.frame });
    return canvas;
  }

  beginFrame(): void {
    this.frame++;
    this.builtThisFrame = 0;
  }

  private evict(): void {
    // unload the least recently used chunk (dynamic unloading)
    let oldest = -1, ou = Infinity;
    for (const [k, e] of this.chunks) if (e.used < ou) { ou = e.used; oldest = k; }
    const e = this.chunks.get(oldest);
    if (e) { this.pool.push(e.canvas); this.chunks.delete(oldest); }
  }

  private build(k: number, canvas: HTMLCanvasElement): void {
    const m = this.w.map;
    const T = this.q.tilePx;
    const cx0 = (k % m.cw) * CHUNK, cy0 = Math.floor(k / m.cw) * CHUNK;
    const ctx = canvas.getContext('2d')!;
    const px = CHUNK * T;
    const img = ctx.createImageData(px, px);
    const d = img.data;
    const c = [0, 0, 0];
    for (let py = 0; py < px; py++) {
      for (let pxx = 0; pxx < px; pxx++) {
        // jittered sampling gives organic biome borders instead of square tiles
        const fx = cx0 + (pxx + 0.5) / T, fy = cy0 + (py + 0.5) / T;
        const jx = (hash01(pxx + cx0 * T, py + cy0 * T, 7) - 0.5) * 0.7;
        const jy = (hash01(pxx + cx0 * T, py + cy0 * T, 8) - 0.5) * 0.7;
        const sx = clamp(Math.floor(fx + jx), 0, m.w - 1), sy = clamp(Math.floor(fy + jy), 0, m.h - 1);
        const i = sy * m.w + sx;
        terrainColor(m, i, fx, fy, c);
        const n = 0.94 + hash01(pxx + cx0 * T, py + cy0 * T, 3) * 0.12;
        let r = c[0] * n, g = c[1] * n, b = c[2] * n;
        // foam on coasts
        if (m.isWater(i) && m.biome[i] !== B.RIVER) {
          const ni = clamp(Math.floor(fx + jx * 1.6), 0, m.w - 1) + clamp(Math.floor(fy + jy * 1.6), 0, m.h - 1) * m.w;
          if (!m.isWater(ni)) { r = r * 0.4 + 150; g = g * 0.4 + 160; b = b * 0.4 + 160; }
        }
        const o = (py * px + pxx) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.decorate(ctx, cx0, cy0, T);
  }

  /** Vector details baked into the chunk: fields, roads, bridges, deposits, trees. */
  private decorate(ctx: CanvasRenderingContext2D, cx0: number, cy0: number, T: number): void {
    const w = this.w, m = w.map;
    const x1 = Math.min(m.w, cx0 + CHUNK), y1 = Math.min(m.h, cy0 + CHUNK);
    // farm fields
    for (let y = cy0; y < y1; y++)
      for (let x = cx0; x < x1; x++) {
        const i = y * m.w + x;
        const bid = m.bld[i];
        if (bid < 0) continue;
        const b = w.buildings.get(bid);
        if (!b || b.type !== 'farm') continue;
        const ox = (x - cx0) * T, oy = (y - cy0) * T;
        ctx.fillStyle = b.progress < 1 ? '#8a7448' : '#a88a3c';
        ctx.fillRect(ox + 0.5, oy + 0.5, T - 1, T - 1);
        ctx.strokeStyle = b.progress < 1 ? '#6d5a35' : '#7d9a3a';
        ctx.lineWidth = Math.max(1, T / 8);
        const vert = hash01(x, y, 9) > 0.5;
        for (let s = 1; s < 4; s++) {
          ctx.beginPath();
          if (vert) { ctx.moveTo(ox + (s * T) / 4, oy + 1); ctx.lineTo(ox + (s * T) / 4, oy + T - 1); }
          else { ctx.moveTo(ox + 1, oy + (s * T) / 4); ctx.lineTo(ox + T - 1, oy + (s * T) / 4); }
          ctx.stroke();
        }
      }
    // roads & bridges
    ctx.lineCap = 'round';
    for (let y = cy0 - 1; y <= y1; y++)
      for (let x = cx0 - 1; x <= x1; x++) {
        if (!m.inside(x, y)) continue;
        const i = y * m.w + x;
        const lvl = m.road[i];
        if (!lvl) continue;
        const water = m.isWater(i);
        ctx.strokeStyle = water ? (lvl >= 2 ? '#8d8d92' : '#7a5530') : lvl === 1 ? '#9c7b4c' : lvl === 2 ? '#a9a49a' : '#4c4f55';
        ctx.lineWidth = T * (lvl === 3 ? 0.42 : lvl === 2 ? 0.32 : 0.24) * (water ? 1.3 : 1);
        const ax = (x - cx0 + 0.5) * T, ay = (y - cy0 + 0.5) * T;
        let solo = true;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!m.inside(nx, ny) || !m.road[ny * m.w + nx]) continue;
          if ((dx && dy) && (m.road[y * m.w + nx] || m.road[ny * m.w + x])) continue; // avoid zig-zag doubles
          solo = false;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax + dx * T, ay + dy * T);
          ctx.stroke();
        }
        if (solo) { ctx.beginPath(); ctx.arc(ax, ay, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
        if (lvl === 3 && !water) {
          ctx.strokeStyle = '#d9c46a';
          ctx.lineWidth = Math.max(0.5, T * 0.04);
        }
      }
    // deposits
    for (let y = cy0; y < y1; y++)
      for (let x = cx0; x < x1; x++) {
        const i = y * m.w + x;
        const dp = m.deposit[i];
        if (!dp || dp === 6 || dp === 7 || m.bld[i] >= 0) continue;
        const ox = (x - cx0 + 0.5) * T, oy = (y - cy0 + 0.5) * T;
        ctx.fillStyle = DEPOSITS[dp].color;
        for (let s = 0; s < 3; s++) {
          const a = hash01(x, y, s) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(ox + Math.cos(a) * T * 0.22, oy + Math.sin(a) * T * 0.22, T * 0.11, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    // trees (top view with soft shadow)
    for (let y = cy0; y < y1; y++)
      for (let x = cx0; x < x1; x++) {
        const i = y * m.w + x;
        const b = m.biome[i];
        if (!TREE_BIOMES.has(b) || m.bld[i] >= 0 || m.road[i]) continue;
        const v = m.veg[i];
        const thr = b === B.PLAINS || b === B.SAVANNA ? 235 : 90;
        if (v < thr) continue;
        const n = b === B.PLAINS || b === B.SAVANNA ? 1 : v > 200 ? 3 : 2;
        for (let t = 0; t < n; t++) {
          if (b === B.PLAINS && hash01(x, y, 40 + t) > 0.35) continue;
          const tx = (x - cx0 + 0.2 + hash01(x, y, 20 + t) * 0.6) * T;
          const ty = (y - cy0 + 0.2 + hash01(x, y, 30 + t) * 0.6) * T;
          const r = T * (0.2 + hash01(x, y, 50 + t) * 0.14) * (b === B.JUNGLE ? 1.25 : 1);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath(); ctx.ellipse(tx + r * 0.5, ty + r * 0.5, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
          if (b === B.TAIGA) {
            ctx.fillStyle = '#1f4a38';
            ctx.beginPath(); ctx.moveTo(tx, ty - r * 1.3); ctx.lineTo(tx + r, ty + r * 0.8); ctx.lineTo(tx - r, ty + r * 0.8); ctx.fill();
          } else {
            const base = b === B.JUNGLE ? [28, 96, 40] : b === B.SAVANNA ? [110, 120, 50] : b === B.SWAMP ? [60, 90, 55] : [40, 108, 46];
            const k = 0.85 + hash01(x, y, 60 + t) * 0.3;
            ctx.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
            ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgba(255,255,200,0.18)`;
            ctx.beginPath(); ctx.arc(tx - r * 0.3, ty - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
  }
}
