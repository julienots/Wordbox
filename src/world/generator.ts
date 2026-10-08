import { B, BIOMES } from '../data/biomes';
import { D } from '../data/resources';
import { clamp, smoothstep } from '../core/math';
import { Simplex } from '../core/noise';
import { RNG } from '../core/rng';
import { classify, effTemp, SEA_LEVEL } from './classify';
import { MinHeap } from './heap';
import { TileMap } from './map';

export type WorldShape = 'continents' | 'pangea' | 'archipelago' | 'islands' | 'inland';

export interface GenOptions {
  seed: number;
  size: number;
  shape: WorldShape;
  /** -1 cold .. +1 hot */
  climate?: number;
  /** -1 dry .. +1 wet */
  moisture?: number;
}

const LAND_FRACTION: Record<WorldShape, number> = {
  continents: 0.42, pangea: 0.55, archipelago: 0.3, islands: 0.22, inland: 0.68,
};

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * Deterministic world generation: the same options always produce the same map.
 * Pipeline: heightmap -> land ratio normalisation -> climate -> hydrology
 * (priority-flood lakes + flow accumulation rivers) -> biomes -> volcanoes ->
 * deposits -> vegetation/fertility -> water distance.
 */
export function generateMap(o: GenOptions): TileMap {
  const W = o.size, H = o.size;
  const map = new TileMap(W, H);
  const rng = new RNG(o.seed);
  const nh = new Simplex(rng.fork(1));
  const nw = new Simplex(rng.fork(2));
  const nt = new Simplex(rng.fork(3));
  const nm = new Simplex(rng.fork(4));
  const nr = new Simplex(rng.fork(5));
  const scale = 3.2 / W;

  // ---- 1. Heightmap with domain warping and shape masks
  const centers: [number, number, number][] = [];
  const nCenters = o.shape === 'continents' ? rng.int(2, 4) : o.shape === 'archipelago' ? rng.int(8, 14) : o.shape === 'islands' ? rng.int(14, 22) : 1;
  for (let i = 0; i < nCenters; i++) {
    const r = o.shape === 'pangea' || o.shape === 'inland' ? 0.55 : o.shape === 'continents' ? rng.range(0.22, 0.34) : rng.range(0.07, 0.14);
    centers.push([rng.range(0.2, 0.8), rng.range(0.2, 0.8), r]);
  }
  if (o.shape === 'pangea' || o.shape === 'inland') centers[0] = [0.5, 0.5, 0.6];
  const raw = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x + 18 * nw.fbm(x * scale * 1.3, y * scale * 1.3, 3) * (W / 128);
      const wy = y + 18 * nw.fbm(x * scale * 1.3 + 50, y * scale * 1.3 + 50, 3) * (W / 128);
      const fx = wx / W, fy = wy / H;
      let mask = 0;
      for (const [cx, cy, r] of centers) {
        const d = Math.hypot(fx - cx, fy - cy) / r;
        mask = Math.max(mask, 1 - smoothstep(0.5, 1.15, d));
      }
      // keep borders oceanic so the world reads as a planet face
      const edge = Math.min(fx, fy, 1 - fx, 1 - fy);
      mask *= smoothstep(0.0, 0.12, edge);
      let h = 0.55 * nh.fbm(wx * scale, wy * scale, 6) + 0.5 * mask;
      if (o.shape === 'inland') {
        const d = Math.hypot(fx - 0.5, fy - 0.5);
        h -= 0.35 * (1 - smoothstep(0.08, 0.22, d));
      }
      const ridge = nr.ridged(wx * scale * 1.6, wy * scale * 1.6, 5);
      h += 0.32 * ridge * smoothstep(0.35, 0.8, mask + 0.2 * nh.noise(wx * scale * 0.5, wy * scale * 0.5));
      raw[y * W + x] = h;
    }
  }
  // ---- 2. normalise so that the requested land fraction sits above SEA_LEVEL
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const thr = sorted[Math.floor(sorted.length * (1 - LAND_FRACTION[o.shape]))];
  for (let i = 0; i < map.size; i++) {
    const v = raw[i];
    raw[i] = v < thr ? (SEA_LEVEL * (v - lo)) / (thr - lo + 1e-6) : SEA_LEVEL + ((1 - SEA_LEVEL) * Math.pow((v - thr) / (hi - thr + 1e-6), 1.35));
  }

  // ---- 3. distance to ocean (for humidity)
  const oceanDist = bfsDistance(map, (i) => raw[i] < SEA_LEVEL, 60);

  // ---- 4. temperature & humidity
  const climate = o.climate ?? 0, moisture = o.moisture ?? 0;
  for (let y = 0; y < H; y++) {
    const lat = 1 - Math.abs(y / (H - 1) - 0.5) * 2; // 1 at equator
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      map.temp[i] = clamp(0.14 + lat * 0.9 + 0.14 * nt.fbm(x * scale * 2, y * scale * 2, 3) + climate * 0.15, 0, 1);
      const coast = 1 - Math.min(1, oceanDist[i] / 40);
      map.humid[i] = clamp(0.36 + 0.55 * nm.fbm(x * scale * 1.7, y * scale * 1.7, 4) + 0.28 * coast - 0.12 + moisture * 0.2, 0, 1);
    }
  }

  // ---- 5. hydrology: priority-flood depression filling + drainage directions
  const filled = new Float32Array(raw);
  const recv = new Int32Array(map.size).fill(-1);
  const order = new Int32Array(map.size);
  const seen = new Uint8Array(map.size);
  const heap = new MinHeap(4096);
  for (let i = 0; i < map.size; i++) {
    const x = i % W, y = (i / W) | 0;
    if (raw[i] < SEA_LEVEL || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
      seen[i] = 1;
      heap.push(i, raw[i]);
    }
  }
  let oc = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    order[oc++] = c;
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of N8) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n]) continue;
      seen[n] = 1;
      filled[n] = Math.max(raw[n], filled[c] + 1e-5);
      recv[n] = c;
      heap.push(n, filled[n]);
    }
  }
  const acc = new Float32Array(map.size);
  for (let k = oc - 1; k >= 0; k--) {
    const i = order[k];
    if (raw[i] < SEA_LEVEL) continue;
    acc[i] += 0.3 + map.humid[i];
    if (recv[i] >= 0) acc[recv[i]] += acc[i];
  }

  // ---- 6. biomes
  for (let i = 0; i < map.size; i++) {
    map.biome[i] = classify(raw[i], effTemp(map.temp[i], raw[i], 0), map.humid[i]);
  }
  // lakes: filled depressions that are deep enough
  for (let i = 0; i < map.size; i++) {
    if (raw[i] >= SEA_LEVEL && filled[i] - raw[i] > 0.026) {
      map.biome[i] = B.LAKE;
      map.humid[i] = Math.min(1, map.humid[i] + 0.1);
    }
  }
  // rivers: high accumulation channels
  const riverThr = W * 0.2;
  for (let i = 0; i < map.size; i++) {
    if (raw[i] < SEA_LEVEL || map.biome[i] === B.LAKE) continue;
    if (acc[i] > riverThr && map.biome[i] !== B.SNOW_PEAK) map.biome[i] = B.RIVER;
  }
  // beaches
  for (let i = 0; i < map.size; i++) {
    const b = map.biome[i];
    if (BIOMES[b].water || b === B.MOUNTAIN || b === B.SNOW_PEAK || b === B.GLACIER) continue;
    const e = (raw[i] - SEA_LEVEL) / (1 - SEA_LEVEL);
    if (e < 0.035 && touchesSea(map, i)) map.biome[i] = map.temp[i] < 0.2 ? B.SNOW : B.BEACH;
  }

  // ---- 7. volcanoes
  const nVolc = Math.max(1, Math.round((W * H) / 60000) + rng.int(0, 2));
  for (let v = 0, tries = 0; v < nVolc && tries < 4000; tries++) {
    const i = rng.int(0, map.size - 1);
    if (map.biome[i] !== B.MOUNTAIN && map.biome[i] !== B.HILLS) continue;
    map.biome[i] = B.VOLCANO;
    raw[i] = Math.min(1, raw[i] + 0.05);
    const x = i % W, y = (i / W) | 0;
    map.disc(x, y, 2.5, (j, _x, _y, d) => {
      if (j !== i && d > 0 && !map.isWater(j) && map.biome[j] !== B.VOLCANO) map.biome[j] = d < 1.6 ? B.BARREN : B.ASH;
    });
    v++;
  }

  // ---- 8. deposits (veins via noise clustering)
  const nd = new Simplex(rng.fork(6));
  for (let i = 0; i < map.size; i++) {
    const b = map.biome[i];
    const x = i % W, y = (i / W) | 0;
    const vein = nd.noise(x * 0.09, y * 0.09) > 0.25 ? 3 : 0.5;
    let dep: number = D.NONE;
    const r = rng.next() / vein;
    if (b === B.MOUNTAIN) {
      if (r < 0.03) dep = D.IRON; else if (r < 0.05) dep = D.COAL; else if (r < 0.06) dep = D.GOLD; else if (r < 0.064) dep = D.RARE; else if (r < 0.1) dep = D.STONE;
    } else if (b === B.HILLS) {
      if (r < 0.05) dep = D.STONE; else if (r < 0.07) dep = D.IRON; else if (r < 0.09) dep = D.COAL; else if (r < 0.095) dep = D.GOLD;
    } else if (b === B.DESERT) {
      if (r < 0.012) dep = D.OIL; else if (r < 0.016) dep = D.GOLD; else if (r < 0.03) dep = D.STONE;
    } else if (b === B.SHALLOW) {
      if (r < 0.05) dep = D.FISH;
    } else if (b === B.SWAMP || b === B.TUNDRA) {
      if (r < 0.01) dep = D.OIL; else if (r < 0.02) dep = D.COAL;
    } else if (b === B.PLAINS || b === B.SAVANNA) {
      if (r < 0.015) dep = D.FERTILE; else if (r < 0.02) dep = D.STONE;
    } else if (b === B.BARREN || b === B.ASH) {
      if (r < 0.03) dep = rng.chance(0.15) ? D.RARE : D.STONE;
    }
    if (dep !== D.NONE) {
      map.deposit[i] = dep;
      map.depositAmt[i] = rng.int(300, 2400);
    }
  }

  // ---- 9. vegetation, fertility, water distance
  const fresh = bfsDistance(map, (i) => {
    const b = map.biome[i];
    return b === B.RIVER || b === B.LAKE || b === B.SHALLOW;
  }, 255);
  for (let i = 0; i < map.size; i++) {
    const info = BIOMES[map.biome[i]];
    map.veg[i] = Math.round(info.veg * rng.range(0.6, 1));
    const riverBonus = fresh[i] < 4 ? 0.25 : 0;
    map.fert[i] = Math.round(clamp(info.fert + riverBonus * (info.fert > 0.1 ? 1 : 0), 0, 1) * 255);
    map.waterDist[i] = Math.min(255, fresh[i]);
  }
  map.height.set(raw);
  return map;
}

function touchesSea(map: TileMap, i: number): boolean {
  const x = i % map.w, y = (i / map.w) | 0;
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (!map.inside(nx, ny)) continue;
    const b = map.biome[ny * map.w + nx];
    if (b === B.SHALLOW || b === B.OCEAN || b === B.DEEP_OCEAN) return true;
  }
  return false;
}

/** Multi-source BFS distance (4-neighbourhood), capped. */
export function bfsDistance(map: TileMap, isSource: (i: number) => boolean, cap: number): Uint16Array {
  const W = map.w, n = map.size;
  const dist = new Uint16Array(n).fill(cap);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (isSource(i)) { dist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const c = q[qh++];
    const d = dist[c] + 1;
    if (d >= cap) continue;
    const x = c % W;
    if (x > 0 && dist[c - 1] > d) { dist[c - 1] = d; q[qt++] = c - 1; }
    if (x < W - 1 && dist[c + 1] > d) { dist[c + 1] = d; q[qt++] = c + 1; }
    if (c >= W && dist[c - W] > d) { dist[c - W] = d; q[qt++] = c - W; }
    if (c + W < n && dist[c + W] > d) { dist[c + W] = d; q[qt++] = c + W; }
  }
  return dist;
}
