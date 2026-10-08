/**
 * Uniform-grid spatial hash. Rebuilt each tick for moving entities; avoids
 * O(n^2) neighbour queries for hunting, battles, selection and power areas.
 */
export class SpatialHash<T extends { x: number; y: number }> {
  readonly cols: number;
  readonly rows: number;
  private cells: T[][];
  private used: number[] = [];
  constructor(worldW: number, worldH: number, readonly cell = 8) {
    this.cols = Math.ceil(worldW / cell);
    this.rows = Math.ceil(worldH / cell);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  clear(): void {
    for (const i of this.used) this.cells[i].length = 0;
    this.used.length = 0;
  }
  insert(o: T): void {
    const cx = Math.min(this.cols - 1, Math.max(0, (o.x / this.cell) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (o.y / this.cell) | 0));
    const i = cy * this.cols + cx;
    const c = this.cells[i];
    if (c.length === 0) this.used.push(i);
    c.push(o);
  }
  /** Calls fn for every entity within radius r of (x,y). Return true from fn to stop early. */
  query(x: number, y: number, r: number, fn: (o: T) => boolean | void): void {
    const r2 = r * r;
    const x0 = Math.max(0, ((x - r) / this.cell) | 0), x1 = Math.min(this.cols - 1, ((x + r) / this.cell) | 0);
    const y0 = Math.max(0, ((y - r) / this.cell) | 0), y1 = Math.min(this.rows - 1, ((y + r) / this.cell) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cells[cy * this.cols + cx];
        for (let k = 0; k < c.length; k++) {
          const o = c[k];
          const dx = o.x - x, dy = o.y - y;
          if (dx * dx + dy * dy <= r2 && fn(o)) return;
        }
      }
    }
  }
  nearest(x: number, y: number, r: number, filter: (o: T) => boolean): T | undefined {
    let best: T | undefined;
    let bd = Infinity;
    this.query(x, y, r, (o) => {
      if (!filter(o)) return;
      const d = (o.x - x) ** 2 + (o.y - y) ** 2;
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }
}
