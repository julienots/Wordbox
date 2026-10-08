import type { Camera } from '../render/camera';

export interface InputHandlers {
  /** Single tap (world coords). */
  tap(wx: number, wy: number): void;
  doubleTap(wx: number, wy: number): void;
  longPress(wx: number, wy: number): void;
  /** True when one-finger drags should paint (a brush power is active). */
  painting(): boolean;
  paint(wx: number, wy: number, first: boolean): void;
  paintEnd(): void;
  hover(wx: number, wy: number): void;
  key(key: string): void;
}

interface Ptr { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }

/**
 * Touch-first gesture recogniser built on Pointer Events (works with fingers,
 * stylus and mouse). One finger pans (or paints), two fingers pinch-zoom and
 * pan, double tap zooms in, long press inspects.
 */
export class Input {
  private ptrs = new Map<number, Ptr>();
  private lastTap = 0;
  private lastTapPos = { x: 0, y: 0 };
  private longTimer = 0;
  private pinch: { d: number; mx: number; my: number } | null = null;
  private vel = { x: 0, y: 0, t: 0 };
  private paintingNow = false;
  private lastPaint = 0;
  private gestureMoved = false;
  private disposers: (() => void)[] = [];

  constructor(private el: HTMLElement, private cam: Camera, private h: InputHandlers) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(t, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e, true));
    on('wheel', (e) => {
      e.preventDefault();
      this.cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
    }, { passive: false });
    on('contextmenu', (e) => e.preventDefault());
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const step = 120;
      if (e.key === 'ArrowLeft') this.cam.pan(step, 0);
      else if (e.key === 'ArrowRight') this.cam.pan(-step, 0);
      else if (e.key === 'ArrowUp') this.cam.pan(0, step);
      else if (e.key === 'ArrowDown') this.cam.pan(0, -step);
      else if (e.key === '+' || e.key === '=') this.cam.zoomAt(1.25, this.cam.vw / 2, this.cam.vh / 2);
      else if (e.key === '-') this.cam.zoomAt(0.8, this.cam.vw / 2, this.cam.vh / 2);
      else this.h.key(e.key);
    };
    window.addEventListener('keydown', key);
    this.disposers.push(() => window.removeEventListener('keydown', key));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    clearTimeout(this.longTimer);
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent): void {
    this.el.setPointerCapture?.(e.pointerId);
    const [x, y] = this.local(e);
    this.ptrs.set(e.pointerId, { x, y, sx: x, sy: y, t: performance.now(), moved: false });
    this.cam.vx = this.cam.vy = 0;
    if (this.ptrs.size === 1) {
      this.gestureMoved = false;
      this.vel = { x: 0, y: 0, t: performance.now() };
      clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => {
        const p = this.ptrs.get(e.pointerId);
        if (p && !p.moved && this.ptrs.size === 1 && !this.paintingNow) {
          const [wx, wy] = this.cam.toWorld(p.x, p.y);
          this.h.longPress(wx, wy);
          this.ptrs.clear();
        }
      }, 520);
      if (this.h.painting()) {
        this.paintingNow = true;
        const [wx, wy] = this.cam.toWorld(x, y);
        this.h.paint(wx, wy, true);
        this.lastPaint = performance.now();
      }
    } else if (this.ptrs.size === 2) {
      clearTimeout(this.longTimer);
      if (this.paintingNow) { this.paintingNow = false; this.h.paintEnd(); }
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      const [wx, wy] = this.cam.toWorld(x, y);
      this.h.hover(wx, wy);
      return;
    }
    const dx = x - p.x, dy = y - p.y;
    if (Math.hypot(x - p.sx, y - p.sy) > 9) { p.moved = true; this.gestureMoved = true; }
    p.x = x; p.y = y;
    if (this.ptrs.size === 1) {
      if (this.paintingNow) {
        const [wx, wy] = this.cam.toWorld(x, y);
        this.h.hover(wx, wy);
        if (performance.now() - this.lastPaint > 45) { this.h.paint(wx, wy, false); this.lastPaint = performance.now(); }
        return;
      }
      if (p.moved) {
        this.cam.pan(dx, dy);
        const now = performance.now();
        const dt = Math.max(1, now - this.vel.t) / 1000;
        this.vel = { x: this.vel.x * 0.6 + (dx / dt) * 0.4, y: this.vel.y * 0.6 + (dy / dt) * 0.4, t: now };
      }
    } else if (this.ptrs.size === 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.cam.pan(mx - this.pinch.mx, my - this.pinch.my);
      if (this.pinch.d > 10) this.cam.zoomAt(d / this.pinch.d, mx, my);
      this.pinch = { d, mx, my };
    }
  }

  private up(e: PointerEvent, cancel = false): void {
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.ptrs.size < 2) this.pinch = null;
    if (!p) return;
    if (this.paintingNow && this.ptrs.size === 0) {
      this.paintingNow = false;
      this.h.paintEnd();
      return;
    }
    if (cancel) return;
    if (this.ptrs.size === 0 && !this.gestureMoved) {
      const now = performance.now();
      const [wx, wy] = this.cam.toWorld(p.x, p.y);
      if (now - p.t < 450) {
        if (now - this.lastTap < 320 && Math.hypot(p.x - this.lastTapPos.x, p.y - this.lastTapPos.y) < 30) {
          this.lastTap = 0;
          this.h.doubleTap(wx, wy);
        } else {
          this.lastTap = now;
          this.lastTapPos = { x: p.x, y: p.y };
          this.h.tap(wx, wy);
        }
      }
    } else if (this.ptrs.size === 0 && this.gestureMoved && performance.now() - this.vel.t < 80) {
      this.cam.fling(this.vel.x, this.vel.y);
    }
  }
}
