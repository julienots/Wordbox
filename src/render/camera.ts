import { clamp, lerp } from '../core/math';

/** Zoom bands driving what is drawn. */
export const enum ZoomLevel { STRATEGIC, INTERMEDIATE, CLOSE }

export interface FollowTarget {
  label: string;
  /** Returns the current world position, or null when the target vanished. */
  pos: () => { x: number; y: number } | null;
}

/**
 * 2D camera in tile units. `zoom` = screen CSS pixels per tile.
 * Supports inertial panning, zoom around a focal point, smooth fly-to and follow.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 8;
  vw = 1;
  vh = 1;
  minZoom = 1;
  readonly maxZoom = 72;
  vx = 0;
  vy = 0;
  follow: FollowTarget | null = null;
  private anim: { x: number; y: number; zoom: number; t: number; dur: number; fx: number; fy: number; fz: number } | null = null;

  constructor(public worldW: number, public worldH: number) {
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  get level(): ZoomLevel {
    return this.zoom < 4.5 ? ZoomLevel.STRATEGIC : this.zoom < 14 ? ZoomLevel.INTERMEDIATE : ZoomLevel.CLOSE;
  }

  resize(w: number, h: number): void {
    this.vw = w;
    this.vh = h;
    this.minZoom = Math.max(0.5, Math.min(w / this.worldW, h / this.worldH) * 0.9);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.vw / 2, (wy - this.y) * this.zoom + this.vh / 2];
  }
  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.vw / 2) / this.zoom + this.x, (sy - this.vh / 2) / this.zoom + this.y];
  }
  /** Visible world rectangle (tiles). */
  view(margin = 0): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.vw / 2 / this.zoom + margin, hh = this.vh / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.follow = null;
    this.anim = null;
    this.clampPos();
  }
  fling(vxScreen: number, vyScreen: number): void {
    this.vx = -vxScreen / this.zoom;
    this.vy = -vyScreen / this.zoom;
  }
  /** Zoom by factor keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const [nx, ny] = this.toWorld(sx, sy);
    this.x += wx - nx;
    this.y += wy - ny;
    this.anim = null;
    this.clampPos();
  }
  flyTo(x: number, y: number, zoom = this.zoom, dur = 0.6): void {
    this.anim = { x, y, zoom: clamp(zoom, this.minZoom, this.maxZoom), t: 0, dur, fx: this.x, fy: this.y, fz: this.zoom };
    this.vx = this.vy = 0;
  }
  /** Keep the world filling the screen when possible (no empty void at the edges). */
  clampPos(): void {
    const hw = this.vw / 2 / this.zoom, hh = this.vh / 2 / this.zoom;
    this.x = hw * 2 >= this.worldW ? this.worldW / 2 : clamp(this.x, hw, this.worldW - hw);
    this.y = hh * 2 >= this.worldH ? this.worldH / 2 : clamp(this.y, hh, this.worldH - hh);
  }

  update(dt: number): void {
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.x = lerp(a.fx, a.x, e);
      this.y = lerp(a.fy, a.y, e);
      this.zoom = Math.exp(lerp(Math.log(a.fz), Math.log(a.zoom), e));
      if (k >= 1) this.anim = null;
      this.clampPos();
    } else if (this.follow) {
      const p = this.follow.pos();
      if (!p) this.follow = null;
      else {
        const k = 1 - Math.exp(-dt * 6);
        this.x += (p.x - this.x) * k;
        this.y += (p.y - this.y) * k;
        this.clampPos();
      }
    } else if (Math.abs(this.vx) + Math.abs(this.vy) > 0.01) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const f = Math.exp(-dt * 4);
      this.vx *= f;
      this.vy *= f;
      this.clampPos();
    }
  }
}
