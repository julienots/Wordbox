import { B, BIOMES } from '../data/biomes';

export const CHUNK = 32;

/**
 * Tile grid stored as struct-of-arrays (typed arrays): compact, cache friendly,
 * trivially serializable. Chunks carry version counters so the renderer only
 * redraws what changed (dynamic chunk loading / invalidation).
 */
export class TileMap {
  readonly size: number;
  readonly cw: number;
  readonly ch: number;
  height: Float32Array;
  /** Base temperature 0..1 (before global climate offset). */
  temp: Float32Array;
  humid: Float32Array;
  biome: Uint8Array;
  deposit: Uint8Array;
  depositAmt: Uint16Array;
  veg: Uint8Array;
  fert: Uint8Array;
  /** Owning settlement id, -1 = none. */
  owner: Int32Array;
  /** 0 none, 1 path, 2 stone road, 3 highway. */
  road: Uint8Array;
  /** Building id on tile, -1 = none. */
  bld: Int32Array;
  fire: Uint8Array;
  /** Generic countdown (lava cooling, ash regrowth, corruption). */
  timer: Uint16Array;
  /** Distance to fresh water / coast (capped 255). */
  waterDist: Uint8Array;
  /** Per-chunk render version (terrain, roads, buildings). */
  chunkVer: Uint32Array;
  /** Per-chunk ownership version (borders overlay). */
  ownerVer: Uint32Array;
  /** Bumped on any walkability change; invalidates cached paths. */
  terrainVer = 0;

  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.size = n;
    this.cw = Math.ceil(w / CHUNK);
    this.ch = Math.ceil(h / CHUNK);
    this.height = new Float32Array(n);
    this.temp = new Float32Array(n);
    this.humid = new Float32Array(n);
    this.biome = new Uint8Array(n);
    this.deposit = new Uint8Array(n);
    this.depositAmt = new Uint16Array(n);
    this.veg = new Uint8Array(n);
    this.fert = new Uint8Array(n);
    this.owner = new Int32Array(n).fill(-1);
    this.road = new Uint8Array(n);
    this.bld = new Int32Array(n).fill(-1);
    this.fire = new Uint8Array(n);
    this.timer = new Uint16Array(n);
    this.waterDist = new Uint8Array(n);
    this.chunkVer = new Uint32Array(this.cw * this.ch);
    this.ownerVer = new Uint32Array(this.cw * this.ch);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  chunkOf(i: number): number {
    const x = i % this.w, y = (i / this.w) | 0;
    return ((y / CHUNK) | 0) * this.cw + ((x / CHUNK) | 0);
  }
  dirty(i: number): void {
    this.chunkVer[this.chunkOf(i)]++;
  }
  dirtyOwner(i: number): void {
    this.ownerVer[this.chunkOf(i)]++;
  }
  setBiome(i: number, b: number): void {
    if (this.biome[i] === b) return;
    const wasWalk = BIOMES[this.biome[i]].walk;
    this.biome[i] = b;
    if (BIOMES[b].walk !== wasWalk) this.terrainVer++;
    if (this.veg[i] > BIOMES[b].veg) this.veg[i] = BIOMES[b].veg;
    this.dirty(i);
  }
  isWater(i: number): boolean {
    return BIOMES[this.biome[i]].water;
  }
  isLand(i: number): boolean {
    return !BIOMES[this.biome[i]].water;
  }
  walkable(i: number): boolean {
    return BIOMES[this.biome[i]].walk || this.road[i] > 0;
  }
  buildable(i: number): boolean {
    return BIOMES[this.biome[i]].build && this.bld[i] < 0 && this.fire[i] === 0;
  }
  isCoastalLand(i: number): boolean {
    if (this.isWater(i)) return false;
    const x = i % this.w, y = (i / this.w) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!this.inside(nx, ny)) continue;
        const b = this.biome[this.idx(nx, ny)];
        if (b === B.OCEAN || b === B.SHALLOW || b === B.DEEP_OCEAN || b === B.LAKE) return true;
      }
    return false;
  }
  /** Iterate tiles in a disc. */
  disc(cx: number, cy: number, r: number, fn: (i: number, x: number, y: number, d: number) => void): void {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 <= r2) fn(y * this.w + x, x, y, Math.sqrt(d2));
      }
  }
}
