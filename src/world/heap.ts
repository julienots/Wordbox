/** Binary min-heap of int ids keyed by float priority (no allocations once grown). */
export class MinHeap {
  ids: Int32Array;
  keys: Float32Array;
  size = 0;
  constructor(cap = 1024) {
    this.ids = new Int32Array(cap);
    this.keys = new Float32Array(cap);
  }
  clear(): void {
    this.size = 0;
  }
  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ni = new Int32Array(this.size * 2); ni.set(this.ids); this.ids = ni;
      const nk = new Float32Array(this.size * 2); nk.set(this.keys); this.keys = nk;
    }
    let i = this.size++;
    const ids = this.ids, keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  peekKey(): number {
    return this.keys[0];
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n], key = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c]; keys[i] = keys[c]; i = c;
      }
      ids[i] = id; keys[i] = key;
    }
    return top;
  }
}
