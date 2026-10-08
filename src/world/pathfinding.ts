import { BIOMES } from '../data/biomes';
import { MinHeap } from './heap';
import { TileMap } from './map';

export const enum PathFlags { NONE = 0, NAVAL = 1 }

const ROAD_MULT = [1, 0.55, 0.38, 0.22];
const DIRS = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1];
const SQ2 = Math.SQRT2;

/**
 * Grid A* with typed arrays reused across searches (stamp trick avoids
 * clearing), a node budget per search, a request queue processed with a
 * per-tick budget, and an LRU path cache invalidated on terrain changes.
 * Entities never run A* every frame: they request once and follow the path.
 */
export class Pathfinder {
  private g: Float32Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private cur = 1;
  private heap = new MinHeap(8192);
  private cache = new Map<string, Int32Array | null>();
  private cacheVer = -1;
  private queue: { from: number; to: number; flags: number; cb: (p: Int32Array | null) => void }[] = [];
  requestsThisTick = 0;
  totalRequests = 0;

  constructor(private map: TileMap) {
    this.g = new Float32Array(map.size);
    this.came = new Int32Array(map.size);
    this.stamp = new Uint32Array(map.size);
    this.closed = new Uint32Array(map.size);
  }

  request(from: number, to: number, flags: number, cb: (p: Int32Array | null) => void): void {
    this.queue.push({ from, to, flags, cb });
  }
  get pending(): number {
    return this.queue.length;
  }

  /** Process queued requests within a budget (called once per sim tick). */
  process(maxRequests = 24): void {
    this.requestsThisTick = 0;
    while (this.queue.length && this.requestsThisTick < maxRequests) {
      const r = this.queue.shift()!;
      r.cb(this.find(r.from, r.to, r.flags));
      this.requestsThisTick++;
    }
  }

  cost(i: number, flags: number): number {
    const m = this.map;
    const b = BIOMES[m.biome[i]];
    if (m.road[i] > 0) return ROAD_MULT[m.road[i]] * (b.water ? 1.5 : 1);
    if (b.water) {
      if (flags & PathFlags.NAVAL) return m.biome[i] === 4 ? 2 : 0.6;
      return m.biome[i] === 4 ? b.cost : -1; // rivers fordable, seas not
    }
    if (!b.walk) return -1;
    return b.cost;
  }

  find(from: number, to: number, flags = 0, maxNodes = 60000): Int32Array | null {
    const m = this.map;
    if (this.cacheVer !== m.terrainVer) {
      this.cache.clear();
      this.cacheVer = m.terrainVer;
    }
    const key = from + ':' + to + ':' + flags;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    this.totalRequests++;
    const res = this.astar(from, to, flags, maxNodes);
    this.cache.set(key, res);
    if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value!);
    return res;
  }

  private astar(from: number, to: number, flags: number, maxNodes: number): Int32Array | null {
    const m = this.map, W = m.w, H = m.h;
    if (from === to) return Int32Array.of(to);
    if (this.cost(to, flags) < 0) return null;
    const s = ++this.cur;
    if (s === 0xffffffff) { this.stamp.fill(0); this.closed.fill(0); this.cur = 1; }
    const g = this.g, came = this.came, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();
    const tx = to % W, ty = (to / W) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % W) - tx), dy = Math.abs(((i / W) | 0) - ty);
      return 0.22 * (dx + dy + (SQ2 - 2) * Math.min(dx, dy));
    };
    g[from] = 0; stamp[from] = s; came[from] = -1;
    heap.push(from, h(from));
    let expanded = 0;
    while (heap.size > 0) {
      const c = heap.pop();
      if (closed[c] === s) continue;
      closed[c] = s;
      if (c === to) break;
      if (++expanded > maxNodes) return null;
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 16; k += 2) {
        const nx = cx + DIRS[k], ny = cy + DIRS[k + 1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (closed[n] === s) continue;
        const cst = this.cost(n, flags);
        if (cst < 0) continue;
        const diag = k >= 8;
        if (diag && (this.cost(cy * W + nx, flags) < 0 || this.cost(ny * W + cx, flags) < 0)) continue;
        const ng = g[c] + cst * (diag ? SQ2 : 1);
        if (stamp[n] !== s || ng < g[n]) {
          stamp[n] = s; g[n] = ng; came[n] = c;
          heap.push(n, ng + h(n));
        }
      }
    }
    if (closed[to] !== s) return null;
    let len = 0;
    for (let c = to; c !== -1; c = came[c]) len++;
    const path = new Int32Array(len);
    for (let c = to, k = len - 1; c !== -1; c = came[c]) path[k--] = c;
    return path;
  }
}
