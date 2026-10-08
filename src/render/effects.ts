import type { Fx, World } from '../sim/world';
import type { Camera } from './camera';
import type { GraphicsQuality } from './quality';

/**
 * Pooled particle system (struct-of-arrays, no per-particle allocation) plus
 * timed "transient" effects (lightning, shockwaves, flashes, meteors, rockets).
 * Particles live in world coordinates so they stay attached while panning.
 */
export class Effects {
  private n = 0;
  private cap: number;
  private x: Float32Array; private y: Float32Array; private z: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private max: Float32Array; private size: Float32Array;
  private color: Uint32Array; private kind: Uint8Array;
  private transients: { kind: string; x: number; y: number; r: number; t: number; dur: number; seed: number; x2?: number; y2?: number; color?: string }[] = [];
  /** Screen flash intensity 0..1 (supernova, lightning). */
  flash = 0;
  flashColor = '255,255,255';
  shake = 0;

  constructor(public q: GraphicsQuality) {
    this.cap = 3000;
    const F = () => new Float32Array(this.cap);
    this.x = F(); this.y = F(); this.z = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.max = F(); this.size = F();
    this.color = new Uint32Array(this.cap); this.kind = new Uint8Array(this.cap);
  }

  get count(): number { return this.n; }

  /** kind: 0 = solid dot, 1 = additive glow, 2 = smoke (grows, fades) */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, rgb: number, kind = 0): void {
    if (this.n >= Math.min(this.cap, this.q.particles)) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.color[i] = rgb; this.kind[i] = kind;
  }

  private burst(x: number, y: number, n: number, speed: number, rgb: number[], life: number, size: number, kind = 1, up = 1): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.emit(x, y, 0.2, Math.cos(a) * s, Math.sin(a) * s * 0.6, up * (1 + Math.random() * 2), life * (0.6 + Math.random() * 0.6), size, rgb[k % rgb.length], kind);
    }
  }

  /** React to simulation fx events. */
  onFx(e: Fx): void {
    const r = e.r ?? 2;
    switch (e.kind) {
      case 'explosion':
        this.burst(e.x, e.y, 60, r * 1.5, [0xffd060, 0xff7020, 0xffffff], 0.9, 0.35);
        this.burst(e.x, e.y, 25, r * 0.5, [0x555555, 0x333333], 2.5, 0.8, 2, 0.6);
        this.transients.push({ kind: 'shock', x: e.x, y: e.y, r: r * 2.2, t: 0, dur: 0.7, seed: Math.random() });
        this.shake = Math.max(this.shake, 0.6);
        break;
      case 'meteor':
        this.transients.push({ kind: 'meteor', x: e.x, y: e.y, r, t: 0, dur: 0.6, seed: Math.random() });
        setTimeout(() => {
          this.burst(e.x, e.y, 90, r * 2, [0xffe080, 0xff6010, 0xffffff], 1.2, 0.45);
          this.burst(e.x, e.y, 40, r, [0x4a3a30, 0x2a2420], 3, 1, 2, 1);
          this.transients.push({ kind: 'shock', x: e.x, y: e.y, r: r * 3.5, t: 0, dur: 1, seed: 0 });
          this.flash = Math.max(this.flash, 0.5); this.flashColor = '255,220,160';
          this.shake = 1.2;
        }, 600);
        break;
      case 'lightning':
        this.transients.push({ kind: 'bolt', x: e.x, y: e.y, r: 1, t: 0, dur: 0.35, seed: Math.random() });
        this.flash = Math.max(this.flash, 0.35); this.flashColor = '220,230,255';
        break;
      case 'fire':
        this.burst(e.x, e.y, 14, 0.6, [0xffa020, 0xff5010], 0.8, 0.25, 1, 2);
        break;
      case 'eruption':
        this.burst(e.x, e.y, 30, 1.5, [0xff7010, 0xffc040, 0xd02000], 1.4, 0.3, 1, 5);
        this.burst(e.x, e.y, 20, 0.8, [0x3a3434, 0x555050], 4, 1.2, 2, 3);
        this.shake = Math.max(this.shake, 0.5);
        break;
      case 'quake':
        this.shake = 1.5;
        this.burst(e.x, e.y, 40, r * 0.6, [0x8a7a60, 0x6a5a48], 1.5, 0.5, 2, 0.4);
        break;
      case 'tsunami':
        this.transients.push({ kind: 'ring', x: e.x, y: e.y, r: r, t: 0, dur: 4, seed: 0, color: '200,230,255' });
        break;
      case 'magic': case 'heal': case 'curse':
        this.burst(e.x, e.y, 40, r * 0.6, e.kind === 'curse' ? [0x9020c0, 0x400060] : e.kind === 'heal' ? [0x60ff90, 0xc0ffd0] : [0xfff2a0, 0xa0e0ff, 0xffffff], 1.4, 0.22, 1, 1.5);
        this.transients.push({ kind: 'ring', x: e.x, y: e.y, r: r, t: 0, dur: 0.8, seed: 0, color: e.kind === 'curse' ? '160,40,200' : '255,240,180' });
        break;
      case 'build':
        this.burst(e.x, e.y, 10, 0.5, [0xc8b090, 0xa08060], 0.8, 0.2, 2, 0.5);
        break;
      case 'birth':
        this.emit(e.x, e.y, 1, 0, 0, 1.2, 1.2, 0.25, 0xff70a0, 1);
        break;
      case 'battle': case 'siege':
        this.burst(e.x, e.y, 6, 0.8, [0xffffff, 0xffd080, 0xff4040], 0.4, 0.15, 1, 1);
        if (e.kind === 'siege') this.burst(e.x, e.y, 4, 0.3, [0x666666], 2, 0.6, 2, 1);
        break;
      case 'capture':
        this.transients.push({ kind: 'ring', x: e.x, y: e.y, r: r, t: 0, dur: 1.2, seed: 0, color: '255,80,60' });
        break;
      case 'rocket':
        this.transients.push({ kind: 'rocket', x: e.x, y: e.y, r: 1, t: 0, dur: 5, seed: Math.random() });
        break;
      case 'supernova':
        this.flash = 1; this.flashColor = '255,255,240';
        this.transients.push({ kind: 'nova', x: e.x, y: e.y, r: r, t: 0, dur: 3.5, seed: 0 });
        this.shake = 2;
        break;
      case 'flash':
        this.flash = Math.max(this.flash, 0.8); this.flashColor = '230,200,255';
        break;
      case 'apocalypse':
        this.flash = 0.6; this.flashColor = '255,60,30';
        this.shake = 2;
        break;
      case 'rift':
        this.burst(e.x, e.y, 20, 1, [0xb040ff, 0x6000a0, 0xffffff], 1.2, 0.25);
        break;
      case 'laser':
        this.transients.push({ kind: 'laser', x: e.x, y: e.y, r: e.r ?? 2, t: 0, dur: 0.3, seed: Math.random() });
        break;
      case 'steam':
        this.burst(e.x, e.y, 6, 0.3, [0xe8e8f0], 2, 0.5, 2, 1.5);
        break;
    }
  }

  /** Ambient emitters for visible fire & lava tiles. */
  ambient(w: World, cam: Camera, dt: number): void {
    const v = cam.view(1);
    const m = w.map;
    const rate = Math.min(1, this.q.particles / 900);
    let budget = 40;
    for (const i of w.fires) {
      const x = i % m.w, y = (i / m.w) | 0;
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      if (Math.random() < dt * 14 * rate) this.emit(x + Math.random(), y + Math.random(), 0.1, (Math.random() - 0.5) * 0.3, 0, 1.2 + Math.random(), 0.6, 0.22, Math.random() < 0.5 ? 0xff9020 : 0xffd040, 1);
      if (Math.random() < dt * 4 * rate) this.emit(x + Math.random(), y + Math.random(), 0.6, 0.2, 0, 1, 2.5, 0.4, 0x404040, 2);
      if (--budget <= 0) break;
    }
    budget = 30;
    for (const [i] of w.lava) {
      const x = i % m.w, y = (i / m.w) | 0;
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      if (Math.random() < dt * 3 * rate) this.emit(x + Math.random(), y + Math.random(), 0, 0, 0, 0.8, 0.8, 0.15, 0xffb030, 1);
      if (--budget <= 0) break;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.z[i] = this.z[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
        this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j]; this.color[i] = this.color[j]; this.kind[i] = this.kind[j];
        i--;
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.kind[i] !== 2) this.vz[i] -= 3 * dt; // gravity (smoke rises)
      if (this.z[i] < 0) { this.z[i] = 0; this.vz[i] *= -0.3; this.vx[i] *= 0.6; this.vy[i] *= 0.6; }
    }
    for (let k = this.transients.length - 1; k >= 0; k--) {
      const t = this.transients[k];
      t.t += dt;
      if (t.t >= t.dur) this.transients.splice(k, 1);
    }
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 2);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const z = cam.zoom;
    // transients (under particles)
    for (const t of this.transients) {
      const [sx, sy] = cam.toScreen(t.x, t.y);
      const k = t.t / t.dur;
      switch (t.kind) {
        case 'shock': case 'ring': {
          ctx.strokeStyle = `rgba(${t.color ?? '255,240,200'},${1 - k})`;
          ctx.lineWidth = Math.max(2, z * 0.4 * (1 - k));
          ctx.beginPath(); ctx.ellipse(sx, sy, t.r * z * k + 2, t.r * z * k * 0.8 + 2, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'meteor': {
          const hx = sx - (1 - k) * 400, hy = sy - (1 - k) * 600;
          const g = ctx.createLinearGradient(hx - 120, hy - 180, hx, hy);
          g.addColorStop(0, 'rgba(255,120,30,0)'); g.addColorStop(1, 'rgba(255,240,180,1)');
          ctx.strokeStyle = g; ctx.lineWidth = Math.max(4, t.r * z * 0.3);
          ctx.beginPath(); ctx.moveTo(hx - 120, hy - 180); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.fillStyle = '#fff6d0';
          ctx.beginPath(); ctx.arc(hx, hy, Math.max(4, t.r * z * 0.2), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'bolt': {
          ctx.strokeStyle = `rgba(230,240,255,${1 - k})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          let bx = sx + (t.seed - 0.5) * 60, by = sy - 500;
          ctx.moveTo(bx, by);
          let s = t.seed * 1000;
          while (by < sy) {
            s = (s * 9301 + 49297) % 233280;
            bx += ((s / 233280) - 0.5) * 40 + (sx - bx) * 0.15;
            by += 40;
            ctx.lineTo(bx, Math.min(by, sy));
          }
          ctx.stroke();
          ctx.lineWidth = 1; ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.stroke();
          break;
        }
        case 'rocket': {
          const alt = k * k * 900;
          const rx = sx + Math.sin(t.seed * 6) * k * 60, ry = sy - alt;
          ctx.fillStyle = '#eee';
          ctx.fillRect(rx - 3, ry - 14, 6, 14);
          ctx.fillStyle = '#d33';
          ctx.beginPath(); ctx.moveTo(rx - 3, ry - 14); ctx.lineTo(rx, ry - 20); ctx.lineTo(rx + 3, ry - 14); ctx.fill();
          const g = ctx.createRadialGradient(rx, ry + 6, 0, rx, ry + 6, 14);
          g.addColorStop(0, 'rgba(255,240,160,1)'); g.addColorStop(1, 'rgba(255,120,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rx, ry + 6, 14, 0, Math.PI * 2); ctx.fill();
          if (Math.random() < 0.6) this.emit(t.x + (rx - sx) / z, t.y - alt / z * 0, alt / z, (Math.random() - 0.5) * 0.3, 0, -0.2, 2.5, 0.5, 0xdddddd, 2);
          break;
        }
        case 'nova': {
          const R = t.r * z * Math.min(1, k * 1.5);
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, R));
          g.addColorStop(0, `rgba(255,255,255,${1 - k})`); g.addColorStop(0.4, `rgba(255,220,120,${0.8 * (1 - k)})`); g.addColorStop(1, 'rgba(255,80,20,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, R), 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(sx, sy, R * 1.2 + 4, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'laser': {
          ctx.strokeStyle = `rgba(120,255,160,${1 - k})`;
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(sx, sy - z * 2.4); ctx.lineTo(sx + (t.seed - 0.5) * t.r * z * 2, sy); ctx.stroke();
          break;
        }
      }
    }
    // particles
    const scaleZ = Math.max(1, z * 0.35);
    for (let i = 0; i < this.n; i++) {
      const [sx, sy] = cam.toScreen(this.x[i], this.y[i]);
      if (sx < -40 || sy < -40 || sx > cam.vw + 40 || sy > cam.vh + 40) continue;
      const life = this.life[i] / this.max[i];
      const c = this.color[i];
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      const kind = this.kind[i];
      const size = this.size[i] * z * (kind === 2 ? 1 + (1 - life) * 2 : 1) + 0.8;
      const yy = sy - this.z[i] * scaleZ * 3;
      if (kind === 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${r},${g},${b},${life})`;
      } else ctx.fillStyle = `rgba(${r},${g},${b},${kind === 2 ? life * 0.45 : life})`;
      ctx.beginPath(); ctx.arc(sx, yy, size, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    void time;
  }

  drawFlash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flash <= 0.01) return;
    ctx.fillStyle = `rgba(${this.flashColor},${Math.min(0.9, this.flash)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Screen-space precipitation + world-space clouds. */
export class WeatherFx {
  private drops: { x: number; y: number; v: number }[] = [];

  draw(ctx: CanvasRenderingContext2D, cam: Camera, w: World, dt: number, q: GraphicsQuality, time: number): void {
    if (!q.weather) return;
    const z = cam.zoom;
    // clouds over weather cells
    for (const c of w.weather) {
      const [sx, sy] = cam.toScreen(c.x, c.y);
      const R = c.r * z;
      if (sx + R < 0 || sy + R < 0 || sx - R > cam.vw || sy - R > cam.vh) continue;
      const dark = c.type === 'storm' || c.type === 'hurricane';
      const alpha = z < 6 ? 0.45 : z < 14 ? 0.15 : 0.07;
      for (let k = 0; k < (c.type === 'hurricane' ? 8 : 4); k++) {
        const a = k * 1.7 + (c.type === 'hurricane' ? time * 0.6 : 0);
        const ox = Math.cos(a) * R * 0.45, oy = Math.sin(a) * R * 0.35;
        const g = ctx.createRadialGradient(sx + ox, sy + oy, 0, sx + ox, sy + oy, R * 0.6);
        g.addColorStop(0, dark ? `rgba(70,75,90,${alpha})` : c.type === 'snow' ? `rgba(245,248,255,${alpha})` : `rgba(225,230,240,${alpha})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx + ox, sy + oy, R * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // precipitation when the view centre is inside a cell
    let intensity = 0, snow = false;
    for (const c of w.weather) {
      const d = Math.hypot(c.x - cam.x, c.y - cam.y);
      if (d < c.r) {
        const k = (1 - d / c.r) * (c.type === 'storm' || c.type === 'hurricane' ? 1.5 : 1);
        if (k > intensity) { intensity = k; snow = c.type === 'snow'; }
      }
    }
    const target = Math.floor(Math.min(1, intensity) * (q.particles / 4) * (z > 4 ? 1 : 0.4));
    while (this.drops.length < target) this.drops.push({ x: Math.random() * cam.vw, y: Math.random() * cam.vh, v: 0.6 + Math.random() * 0.6 });
    if (this.drops.length > target) this.drops.length = target;
    if (!this.drops.length) return;
    ctx.strokeStyle = snow ? 'rgba(255,255,255,0.85)' : 'rgba(180,200,230,0.55)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.drops) {
      if (snow) {
        d.y += 60 * d.v * dt; d.x += Math.sin(time + d.v * 10) * 20 * dt;
        ctx.moveTo(d.x + 1.5, d.y); ctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2);
      } else {
        d.y += 700 * d.v * dt; d.x -= 120 * d.v * dt;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 4, d.y - 14);
      }
      if (d.y > cam.vh) { d.y -= cam.vh + 10; d.x = Math.random() * cam.vw; }
      if (d.x < 0) d.x += cam.vw;
    }
    if (snow) ctx.fill(); else ctx.stroke();
  }
}
