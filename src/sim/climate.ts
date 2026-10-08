import { clamp } from '../core/math';
import { BIOMES } from '../data/biomes';
import { seasonOf } from '../data/time';
import { CLIMATE_BIOMES, classify, effTemp } from '../world/classify';
import { CHUNK } from '../world/map';
import type { Weather } from './entities';
import { damageArea, ignite } from './disasters';
import type { World } from './world';

export const SEASON_TEMP = [0, 0.08, 0, -0.12];

/** Current seasonal + global temperature offset. */
export function tempOffset(w: World): number {
  return w.climate.tempOffset + SEASON_TEMP[seasonOf(w.tick)];
}

export function spawnWeather(w: World, type: Weather['type'], x: number, y: number, power = 1): Weather {
  const ang = w.rng.range(0, Math.PI * 2);
  const wx: Weather = {
    id: w.id(), type, x, y, r: type === 'hurricane' ? 14 : w.rng.range(6, 14),
    vx: Math.cos(ang) * 0.06 + 0.04, vy: Math.sin(ang) * 0.04, life: w.rng.int(150, 500), power,
  };
  w.weather.push(wx);
  w.unlock('weather:' + type);
  return wx;
}

/** Monthly climate: weather generation, droughts, ice ages, pollution-driven warming. */
export function updateClimate(w: World): void {
  const m = w.map;
  const c = w.climate;
  // weather cells
  if (w.weather.length < 4 + m.w / 64 && w.rng.chance(0.6)) {
    const i = w.rng.int(0, m.size - 1);
    const t = effTemp(m.temp[i], m.height[i], tempOffset(w));
    const humid = m.humid[i] + c.humidOffset;
    if (humid > 0.45) {
      const type = t < 0.3 ? 'snow' : w.rng.chance(0.15) ? 'storm' : 'rain';
      spawnWeather(w, type, i % m.w, (i / m.w) | 0);
    }
  }
  // droughts: regional humidity deficit that slowly recovers
  for (let k = 0; k < w.drought.length; k++) w.drought[k] = Math.max(0, w.drought[k] - 0.02);
  if (w.rng.chance(w.opts.mode === 'apocalypse' ? 0.03 : 0.008)) startDrought(w, w.rng.int(0, m.w - 1), w.rng.int(0, m.h - 1), 0.6);
  // ice age cycle
  if (c.iceAge > 0) {
    c.iceAgeTimer--;
    if (c.iceAgeTimer <= 0) {
      c.iceAge = 0;
      w.addHistory('climate', 'Fin de l’âge glaciaire : les glaces reculent.', 3);
    }
  }
  const targetOffset = (c.iceAge > 0 ? -0.28 : 0) + Math.min(0.25, c.pollution * 0.02);
  c.tempOffset += (targetOffset - c.tempOffset) * 0.01;
  c.pollution = Math.max(0, c.pollution * 0.999);
  if (c.pollution > 6 && !w.codex.has('event:warming')) {
    w.unlock('event:warming');
    w.addHistory('climate', 'Les savants alertent : l’industrie réchauffe le climat mondial.', 2);
  }
  reclassify(w);
}

export function startDrought(w: World, x: number, y: number, power: number): void {
  const m = w.map;
  const cx = (x / CHUNK) | 0, cy = (y / CHUNK) | 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= m.cw || ny >= m.ch) continue;
      const k = ny * m.cw + nx;
      w.drought[k] = clamp(w.drought[k] + power * (dx || dy ? 0.6 : 1), 0, 0.9);
    }
  w.addHistory('climate', 'Une grande sécheresse frappe la région.', 1, x, y);
  w.unlock('disaster:drought');
}

export function startIceAge(w: World, years = 60): void {
  w.climate.iceAge = 1;
  w.climate.iceAgeTimer = years * 12;
  w.addHistory('climate', 'Un âge glaciaire commence : le monde se refroidit.', 3);
  w.unlock('disaster:iceage');
}

/** Re-derive natural biomes when the global climate drifted noticeably (progressive, by slices). */
function reclassify(w: World): void {
  const c = w.climate;
  const m = w.map;
  if (Math.abs(c.tempOffset - c.lastClassOffset) < 0.015 && w.cursors.reclass === 0) return;
  const n = Math.ceil(m.size / 6);
  for (let k = 0; k < n; k++) {
    const i = w.cursors.reclass % m.size;
    w.cursors.reclass = (i + 1) % m.size;
    const b = m.biome[i];
    if (!CLIMATE_BIOMES.has(b)) continue;
    const nb = classify(m.height[i], effTemp(m.temp[i], m.height[i], c.tempOffset), clamp(m.humid[i] + c.humidOffset, 0, 1));
    if (nb !== b && !BIOMES[nb].water) m.setBiome(i, nb);
    if (w.cursors.reclass === 0) break;
  }
  if (w.cursors.reclass === 0) c.lastClassOffset = c.tempOffset;
}

/** Per-tick weather motion and effects. */
export function updateWeather(w: World): void {
  const m = w.map;
  for (let k = w.weather.length - 1; k >= 0; k--) {
    const c = w.weather[k];
    c.x += c.vx;
    c.y += c.vy;
    c.life--;
    if (c.life <= 0 || c.x < -20 || c.y < -20 || c.x > m.w + 20 || c.y > m.h + 20) { w.weather.splice(k, 1); continue; }
    if (w.tick % 5 !== 0) continue;
    // rain puts out fires
    if (c.type !== 'snow') {
      m.disc(c.x, c.y, c.r * 0.7, (i) => { if (m.fire[i] > 0) m.fire[i] = Math.max(0, m.fire[i] - 20); });
    }
    if ((c.type === 'storm' || c.type === 'hurricane') && w.rng.chance(c.type === 'hurricane' ? 0.6 : 0.25)) {
      const x = c.x + w.rng.range(-c.r, c.r), y = c.y + w.rng.range(-c.r, c.r);
      if (m.inside(x | 0, y | 0)) {
        w.fx('lightning', x, y);
        const i = m.idx(x | 0, y | 0);
        if (m.veg[i] > 60 && w.rng.chance(0.3)) ignite(w, i, 50);
        if (w.lod(x, y) === 0) w.sfx('thunder', x, y);
      }
    }
    if (c.type === 'hurricane') {
      const i = m.idx(clamp(c.x | 0, 0, m.w - 1), clamp(c.y | 0, 0, m.h - 1));
      if (!m.isWater(i)) {
        c.power *= 0.97; // weakens over land
        damageArea(w, c.x, c.y, c.r * 0.5, 0.05 * c.power, 'ouragan');
      }
    }
  }
}
