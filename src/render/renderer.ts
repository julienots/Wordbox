import { clamp } from '../core/math';
import { hash01 } from '../core/rng';
import { B } from '../data/biomes';
import { seasonOf } from '../data/time';
import { tempOffset } from '../sim/climate';
import type { World } from '../sim/world';
import { effTemp } from '../world/classify';
import { CHUNK } from '../world/map';
import { drawBuildings, drawKingdomLabels, drawSettlementMarkers, Light } from './buildings';
import { Camera, ZoomLevel } from './camera';
import { Effects, WeatherFx } from './effects';
import { drawAnimals, drawArmies, drawCaravans, drawDisasterEntities, drawPersons } from './entities';
import { OverlayRenderer } from './overlay';
import type { GraphicsQuality } from './quality';
import { TerrainRenderer } from './terrain';

export interface RenderStats {
  fps: number;
  frameMs: number;
  chunksVisible: number;
  chunksCached: number;
  persons: number;
  animals: number;
  particles: number;
}

export interface Brush {
  x: number;
  y: number;
  r: number;
  color: string;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain: TerrainRenderer;
  readonly overlay: OverlayRenderer;
  readonly effects: Effects;
  private weatherFx = new WeatherFx();
  private snow: HTMLCanvasElement;
  private snowKey = '';
  dpr = 1;
  dayNight = true;
  brush: Brush | null = null;
  selectedPerson = -1;
  stats: RenderStats = { fps: 0, frameMs: 0, chunksVisible: 0, chunksCached: 0, persons: 0, animals: 0, particles: 0 };
  private fpsAcc = 0;
  private fpsFrames = 0;
  private unsub: () => void;

  constructor(private canvas: HTMLCanvasElement, private w: World, public cam: Camera, public q: GraphicsQuality) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = new TerrainRenderer(w, q);
    this.overlay = new OverlayRenderer(w);
    this.effects = new Effects(q);
    this.snow = document.createElement('canvas');
    this.snow.width = w.map.w;
    this.snow.height = w.map.h;
    this.unsub = w.bus.on('fx', (e) => this.effects.onFx(e));
  }

  dispose(): void {
    this.unsub();
  }

  setQuality(q: GraphicsQuality): void {
    this.q = q;
    this.terrain.setQuality(q);
    this.effects.q = q;
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.max(0.5, (window.devicePixelRatio || 1) * this.q.resolution);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.cam.resize(r.width, r.height);
  }

  /** Night amount 0..0.75 from a cosmetic real-time cycle (2 min). */
  night(time: number): number {
    if (!this.dayNight) return 0;
    const phase = (time / 120) % 1;
    return clamp((-Math.cos(phase * Math.PI * 2) - 0.25) * 1.1, 0, 0.72);
  }

  private updateSnow(): void {
    const w = this.w, m = w.map;
    const off = tempOffset(w);
    const key = `${seasonOf(w.tick)}|${off.toFixed(2)}|${m.terrainVer >> 4}`;
    if (key === this.snowKey) return;
    this.snowKey = key;
    const ctx = this.snow.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    const d = img.data;
    for (let i = 0; i < m.size; i++) {
      if (m.isWater(i) && m.biome[i] !== B.LAKE && m.biome[i] !== B.RIVER) continue;
      const t = effTemp(m.temp[i], m.height[i], off);
      if (t < 0.3) {
        const a = clamp((0.3 - t) / 0.12, 0, 1) * 200;
        const o = i * 4;
        d[o] = 240; d[o + 1] = 245; d[o + 2] = 255; d[o + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  render(dtReal: number, time: number, alpha: number): void {
    const t0 = performance.now();
    const ctx = this.ctx, cam = this.cam, w = this.w, q = this.q;
    const z = cam.zoom;
    this.terrain.beginFrame();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // screen shake
    if (this.effects.shake > 0) ctx.translate((Math.random() - 0.5) * this.effects.shake * 8, (Math.random() - 0.5) * this.effects.shake * 8);
    ctx.fillStyle = '#0b1f3a';
    ctx.fillRect(-20, -20, cam.vw + 40, cam.vh + 40);
    const [ox, oy] = cam.toScreen(0, 0);
    const level = cam.level;

    // ---- terrain
    if (z < 3.2) {
      this.terrain.refreshWorld();
      ctx.imageSmoothingEnabled = z < 1.5;
      ctx.drawImage(this.terrain.worldCanvas, ox, oy, w.map.w * z, w.map.h * z);
      this.stats.chunksVisible = 0;
    } else {
      if ((performance.now() | 0) % 4 === 0) this.terrain.refreshWorld();
      ctx.imageSmoothingEnabled = false;
      const v = cam.view(0);
      const cx0 = Math.max(0, Math.floor(v.x0 / CHUNK)), cx1 = Math.min(w.map.cw - 1, Math.floor(v.x1 / CHUNK));
      const cy0 = Math.max(0, Math.floor(v.y0 / CHUNK)), cy1 = Math.min(w.map.ch - 1, Math.floor(v.y1 / CHUNK));
      let visible = 0;
      // build the chunks nearest to the centre first
      const order: number[] = [];
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) order.push(cy * w.map.cw + cx);
      const ccx = cam.x / CHUNK, ccy = cam.y / CHUNK;
      order.sort((a, b) => ((a % w.map.cw) - ccx) ** 2 + (Math.floor(a / w.map.cw) - ccy) ** 2 - (((b % w.map.cw) - ccx) ** 2 + (Math.floor(b / w.map.cw) - ccy) ** 2));
      for (const k of order) {
        const cx = k % w.map.cw, cy = Math.floor(k / w.map.cw);
        const [sx, sy] = cam.toScreen(cx * CHUNK, cy * CHUNK);
        const size = CHUNK * z;
        const tex = this.terrain.chunk(k, true);
        if (tex) ctx.drawImage(tex, sx, sy, size + 0.5, size + 0.5);
        else ctx.drawImage(this.terrain.worldCanvas, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, sx, sy, size + 0.5, size + 0.5);
        visible++;
      }
      this.stats.chunksVisible = visible;
    }
    this.stats.chunksCached = this.terrain.cachedChunks;

    // ---- seasonal snow cover
    this.updateSnow();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.snow, ox, oy, w.map.w * z, w.map.h * z);
    ctx.globalAlpha = 1;

    // ---- animated water & lava
    if (q.water > 0 && z >= 4) this.drawWater(ctx, time);
    if (w.lava.size) this.drawLava(ctx, time);

    // ---- borders / filters
    this.overlay.update(performance.now(), level === ZoomLevel.STRATEGIC);
    ctx.imageSmoothingEnabled = z < 2 || z > 5;
    ctx.globalAlpha = this.overlay.filter !== 'none' ? 0.9 : level === ZoomLevel.CLOSE ? 0.4 : level === ZoomLevel.INTERMEDIATE ? 0.75 : 1;
    ctx.drawImage(this.overlay.canvas, ox, oy, w.map.w * z, w.map.h * z);
    ctx.globalAlpha = 1;

    // ---- world content
    let lights: Light[] = [];
    if (z >= 3) lights = drawBuildings(ctx, cam, w, q, time, this.night(time));
    drawCaravans(ctx, cam, w, time);
    this.stats.animals = drawAnimals(ctx, cam, w, q, alpha, time);
    this.stats.persons = drawPersons(ctx, cam, w, q, alpha, time, this.selectedPerson);
    drawArmies(ctx, cam, w, alpha, time);
    drawDisasterEntities(ctx, cam, w, time);
    this.effects.ambient(w, cam, dtReal);
    this.effects.update(dtReal);
    this.effects.draw(ctx, cam, time);
    this.stats.particles = this.effects.count;
    this.weatherFx.draw(ctx, cam, w, dtReal, q, time);

    // ---- lighting
    const night = this.night(time) + (w.player.timeStopped ? 0 : 0);
    if (night > 0.01) {
      ctx.fillStyle = `rgba(8,14,45,${night})`;
      ctx.fillRect(-20, -20, cam.vw + 40, cam.vh + 40);
      if (q.lights) {
        ctx.globalCompositeOperation = 'lighter';
        for (const l of lights) {
          const [lx, ly] = cam.toScreen(l.x, l.y);
          const r = l.r * z;
          if (lx < -r || ly < -r || lx > cam.vw + r || ly > cam.vh + r) continue;
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
          g.addColorStop(0, l.color.replace(/[\d.]+\)$/, `${night * 0.9})`));
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
        }
        // fires glow at night
        for (const i of w.fires) {
          const [lx, ly] = cam.toScreen((i % w.map.w) + 0.5, Math.floor(i / w.map.w) + 0.5);
          if (lx < -50 || ly < -50 || lx > cam.vw + 50 || ly > cam.vh + 50) continue;
          ctx.fillStyle = `rgba(255,120,30,${night * 0.35})`;
          ctx.beginPath(); ctx.arc(lx, ly, z * 1.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // time stop desaturation
    if (w.player.timeStopped) {
      ctx.fillStyle = 'rgba(120,140,170,0.25)';
      ctx.fillRect(-20, -20, cam.vw + 40, cam.vh + 40);
    }

    // ---- labels
    if (level !== ZoomLevel.CLOSE || z < 20) drawSettlementMarkers(ctx, cam, w, true);
    if (level === ZoomLevel.STRATEGIC) drawKingdomLabels(ctx, cam, w);

    // ---- brush cursor
    if (this.brush) {
      const [bx, by] = cam.toScreen(this.brush.x, this.brush.y);
      ctx.strokeStyle = this.brush.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(bx, by, Math.max(6, this.brush.r * z), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    this.effects.drawFlash(ctx, cam.vw + 40, cam.vh + 40);

    // ---- stats
    const ms = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.9 + ms * 0.1;
    this.fpsAcc += dtReal;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.stats.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D, time: number): void {
    const cam = this.cam, m = this.w.map, z = cam.zoom;
    const v = cam.view(0);
    const step = z < 8 ? 3 : z < 16 ? 2 : 1;
    const x0 = Math.max(0, Math.floor(v.x0)), x1 = Math.min(m.w - 1, Math.ceil(v.x1));
    const y0 = Math.max(0, Math.floor(v.y0)), y1 = Math.min(m.h - 1, Math.ceil(v.y1));
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.beginPath();
    let n = 0;
    for (let y = y0; y <= y1; y += step)
      for (let x = x0; x <= x1; x += step) {
        const i = y * m.w + x;
        if (!m.isWater(i)) continue;
        const h = hash01(x, y, 77);
        const phase = (time * (0.25 + h * 0.3) + h * 10) % 1;
        if (phase > 0.35) continue;
        const a = Math.sin((phase / 0.35) * Math.PI);
        const [sx, sy] = cam.toScreen(x + h, y + hash01(x, y, 78));
        const len = z * 0.35 * a;
        ctx.moveTo(sx - len, sy);
        ctx.quadraticCurveTo(sx, sy - z * 0.08, sx + len, sy);
        if (++n > 1600) break;
      }
    ctx.stroke();
  }

  private drawLava(ctx: CanvasRenderingContext2D, time: number): void {
    const cam = this.cam, m = this.w.map, z = cam.zoom;
    const v = cam.view(1);
    for (const [i, heat] of this.w.lava) {
      const x = i % m.w, y = (i / m.w) | 0;
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      const [sx, sy] = cam.toScreen(x, y);
      const pulse = 0.75 + Math.sin(time * 3 + x * 1.3 + y) * 0.25;
      const k = clamp(heat / 200, 0.2, 1);
      ctx.fillStyle = `rgba(255,${Math.round(90 + 120 * k * pulse)},20,${0.85})`;
      ctx.fillRect(sx, sy, z + 0.5, z + 0.5);
    }
  }
}
