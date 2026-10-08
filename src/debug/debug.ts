import { perf } from '../sim/simulation';
import type { World } from '../sim/world';
import type { Renderer } from '../render/renderer';

/**
 * Developer overlay. Compiled in only for debug builds (__DEBUG__), so it can
 * never appear in the release APK.
 */
export class DebugOverlay {
  private el: HTMLDivElement;
  private last = 0;
  visible = false;
  simMs = 0;
  ticksPerSec = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  toggle(on = !this.visible): void {
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
  }

  update(w: World, r: Renderer): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const top = Object.entries(perf).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
    let near = 0;
    for (const p of w.persons.values()) if (w.lod(p.x, p.y) === 0) near++;
    this.el.textContent = [
      `FPS ${r.stats.fps}  frame ${r.stats.frameMs.toFixed(1)}ms`,
      `CPU sim ${this.simMs.toFixed(1)}ms/frame  ${this.ticksPerSec.toFixed(0)} ticks/s`,
      `GPU draw: chunks ${r.stats.chunksVisible} vis / ${r.stats.chunksCached} cache  particles ${r.stats.particles}`,
      `MEMORY ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : 'n/a'}`,
      `ENTITIES persons ${w.persons.size} (near ${near}, drawn ${r.stats.persons})  animals ${w.animals.size} (drawn ${r.stats.animals})`,
      `POPULATION ${w.totalPop()}  settlements ${w.settlements.size}  buildings ${w.buildings.size}`,
      `ACTIVE CHUNKS ${r.stats.chunksVisible}  fires ${w.fires.size}  lava ${w.lava.size}`,
      `SIMULATION TICK ${w.tick} (an ${w.year})`,
      `PATHFINDING pending ${w.pathfinder.pending}  total ${w.pathfinder.totalRequests}`,
      `systems ms/tick: ${top}`,
    ].join('\n');
  }
}
