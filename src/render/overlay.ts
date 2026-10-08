import { clamp, hslToRgb } from '../core/math';
import { BIOMES } from '../data/biomes';
import { DEPOSITS } from '../data/resources';
import { tempOffset } from '../sim/climate';
import type { World } from '../sim/world';
import { effTemp } from '../world/classify';

export type FilterId = 'none' | 'political' | 'population' | 'resources' | 'climate' | 'humidity' | 'religion' | 'culture' | 'war' | 'economy' | 'technology' | 'biodiversity' | 'elevation' | 'fertility';

export const FILTERS: { id: FilterId; name: string; icon: string }[] = [
  { id: 'none', name: 'Aucun', icon: '🗺️' },
  { id: 'political', name: 'Frontières', icon: '🏳️' },
  { id: 'population', name: 'Population', icon: '👥' },
  { id: 'resources', name: 'Ressources', icon: '💎' },
  { id: 'climate', name: 'Température', icon: '🌡️' },
  { id: 'humidity', name: 'Humidité', icon: '💧' },
  { id: 'religion', name: 'Religions', icon: '🙏' },
  { id: 'culture', name: 'Cultures', icon: '🎭' },
  { id: 'war', name: 'Guerres', icon: '⚔️' },
  { id: 'economy', name: 'Économie', icon: '💰' },
  { id: 'technology', name: 'Technologie', icon: '🔬' },
  { id: 'biodiversity', name: 'Biodiversité', icon: '🦌' },
  { id: 'elevation', name: 'Altitude', icon: '⛰️' },
  { id: 'fertility', name: 'Fertilité', icon: '🌾' },
];

const ramp = (t: number): [number, number, number] => {
  // blue -> green -> yellow -> red
  t = clamp(t, 0, 1);
  if (t < 0.33) return [40, 80 + t * 400, 220 - t * 300];
  if (t < 0.66) return [(t - 0.33) * 700, 210, 120 - (t - 0.33) * 300];
  return [235, 210 - (t - 0.66) * 500, 30];
};

/**
 * 1px-per-tile overlay (borders always; plus the active filter), recomputed
 * at a low frequency and drawn scaled over the terrain.
 */
export class OverlayRenderer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private lastKey = '';
  private lastTime = 0;
  filter: FilterId = 'none';

  constructor(private w: World) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w.map.w;
    this.canvas.height = w.map.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(w.map.w, w.map.h);
  }

  /** Recompute if ownership changed or the filter needs refreshing. */
  update(now: number, strategic: boolean): void {
    const m = this.w.map;
    let ownerSum = 0;
    for (let k = 0; k < m.ownerVer.length; k++) ownerSum = (ownerSum + m.ownerVer[k] * (k + 1)) | 0;
    const key = `${this.filter}|${ownerSum}|${strategic}|${this.w.settlements.size}`;
    const dynamic = this.filter !== 'none' && this.filter !== 'political';
    if (key === this.lastKey && !(dynamic && now - this.lastTime > 1500)) return;
    if (key !== this.lastKey && now - this.lastTime < 250 && !dynamic) return; // throttle border updates
    this.lastKey = key;
    this.lastTime = now;
    this.compute(strategic);
  }

  private kingdomRGB(kid: number): [number, number, number] {
    const k = this.w.kingdoms.get(kid);
    return k ? hslToRgb(k.hue, 70, 50) : [128, 128, 128];
  }

  private compute(strategic: boolean): void {
    const w = this.w, m = w.map;
    const d = this.img.data;
    const f = this.filter;
    // per-settlement caches
    const sKing = new Map<number, number>();
    for (const s of w.settlements.values()) sKing.set(s.id, s.kingdom);
    let maxDensity = 1, maxWealth = 1;
    const density = new Map<number, number>();
    for (const s of w.settlements.values()) {
      const dd = s.pop / Math.max(1, s.tiles);
      density.set(s.id, dd);
      maxDensity = Math.max(maxDensity, dd);
      maxWealth = Math.max(maxWealth, s.stock.gold + (w.kingdoms.get(s.kingdom)?.treasury ?? 0) / Math.max(1, w.kingdoms.get(s.kingdom)?.settlements.length ?? 1));
    }
    const atWar = new Set<number>();
    for (const war of w.wars.values()) if (war.end < 0) for (const id of [...war.attackers, ...war.defenders]) atWar.add(id);
    let animalGrid: Uint16Array | null = null;
    if (f === 'biodiversity') {
      animalGrid = new Uint16Array(Math.ceil(m.w / 8) * Math.ceil(m.h / 8));
      for (const a of w.animals.values()) animalGrid[((a.y / 8) | 0) * Math.ceil(m.w / 8) + ((a.x / 8) | 0)]++;
    }
    const toff = tempOffset(w);
    const borderA = strategic ? 255 : 230;
    const fillA = strategic ? 70 : 38;
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        const o = i * 4;
        let r = 0, g = 0, b = 0, a = 0;
        const own = m.owner[i];
        const kid = own >= 0 ? sKing.get(own) ?? -1 : -1;
        switch (f) {
          case 'population': if (own >= 0) { [r, g, b] = ramp((density.get(own) ?? 0) / maxDensity); a = 150; } break;
          case 'resources': {
            const dp = m.deposit[i];
            if (dp) { const c = DEPOSITS[dp].color; r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16); a = 255; }
            else if (!m.isWater(i)) { r = 30; g = 30; b = 30; a = 120; }
            break;
          }
          case 'climate': [r, g, b] = ramp(effTemp(m.temp[i], m.height[i], toff)); a = 150; break;
          case 'humidity': { const h = clamp(m.humid[i] + w.climate.humidOffset - w.drought[m.chunkOf(i)], 0, 1); r = 200 - h * 180; g = 160 - h * 60; b = 60 + h * 190; a = 150; break; }
          case 'religion': case 'culture': if (own >= 0) {
            const s = w.settlements.get(own)!;
            const id = f === 'religion' ? s.religion : s.culture;
            const hue = f === 'religion' ? w.religions.get(id)?.hue ?? 0 : w.cultures.get(id)?.hue ?? 0;
            [r, g, b] = hslToRgb(hue, 75, 50); a = 170;
          } break;
          case 'war': if (kid >= 0) { if (atWar.has(kid)) { r = 220; g = 30; b = 30; a = 150; } else { r = 60; g = 160; b = 80; a = 90; } } break;
          case 'economy': if (own >= 0) {
            const s = w.settlements.get(own)!;
            const k = w.kingdoms.get(s.kingdom);
            [r, g, b] = ramp(Math.sqrt((s.stock.gold + (k ? k.treasury / Math.max(1, k.settlements.length) : 0)) / maxWealth)); a = 160;
          } break;
          case 'technology': if (kid >= 0) { [r, g, b] = ramp((w.kingdoms.get(kid)?.era ?? 0) / 13); a = 160; } break;
          case 'biodiversity': if (!m.isWater(i) || animalGrid) {
            const v = m.veg[i] / 255;
            const an = animalGrid ? animalGrid[((y / 8) | 0) * Math.ceil(m.w / 8) + ((x / 8) | 0)] / 12 : 0;
            [r, g, b] = ramp(clamp(v * 0.6 + an * 0.4, 0, 1)); a = 140;
          } break;
          case 'elevation': [r, g, b] = ramp(m.height[i]); a = 170; break;
          case 'fertility': if (!m.isWater(i)) { [r, g, b] = ramp(m.fert[i] / 255); a = 160; } break;
        }
        // political borders (always shown unless a full-coverage filter is active)
        if (kid >= 0 && (f === 'none' || f === 'political' || f === 'war')) {
          const x0 = x > 0 ? m.owner[i - 1] : -1, x1 = x < m.w - 1 ? m.owner[i + 1] : -1;
          const y0 = y > 0 ? m.owner[i - m.w] : -1, y1 = y < m.h - 1 ? m.owner[i + m.w] : -1;
          const kk = (o2: number) => (o2 >= 0 ? sKing.get(o2) ?? -1 : -1);
          const border = kk(x0) !== kid || kk(x1) !== kid || kk(y0) !== kid || kk(y1) !== kid;
          const [kr, kg, kb] = this.kingdomRGB(kid);
          if (border) { r = kr; g = kg; b = kb; a = borderA; }
          else if (f !== 'war') { r = kr; g = kg; b = kb; a = f === 'political' ? fillA * 2 : fillA; }
        }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
      }
    this.ctx.putImageData(this.img, 0, 0);
    void BIOMES;
  }
}
