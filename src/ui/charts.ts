import { fmtNum } from '../core/math';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Minimal multi-series line chart on a canvas (DPR aware). */
export function lineChart(canvas: HTMLCanvasElement, xs: number[], series: Series[], log = false): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, hgt = canvas.clientHeight || 160;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  if (!xs.length) {
    ctx.fillStyle = '#9aa8c4';
    ctx.font = '12px system-ui';
    ctx.fillText('Pas encore de données (1 point par an).', 10, 20);
    return;
  }
  const f = (v: number) => (log ? Math.log10(1 + Math.max(0, v)) : v);
  let max = 1;
  for (const s of series) for (const v of s.values) max = Math.max(max, f(v));
  const pad = 26;
  const x0 = xs[0], x1 = xs[xs.length - 1] || 1;
  const X = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (w - pad - 6);
  const Y = (v: number) => hgt - 16 - (f(v) / max) * (hgt - 26);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const y = 10 + (k * (hgt - 26)) / 4; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 4, y); ctx.stroke(); }
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.values.forEach((v, i) => (i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v))));
    ctx.stroke();
  }
  ctx.fillStyle = '#9aa8c4';
  ctx.font = '10px system-ui';
  ctx.fillText(fmtNum(log ? Math.pow(10, max) - 1 : max), 2, 12);
  ctx.fillText(`An ${x0}`, pad, hgt - 3);
  ctx.textAlign = 'right';
  ctx.fillText(`An ${x1}`, w - 4, hgt - 3);
  // legend
  ctx.textAlign = 'left';
  let lx = pad + 4;
  for (const s of series.slice(0, 6)) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 12, 8, 8);
    ctx.fillStyle = '#e8edf7';
    ctx.fillText(s.name.slice(0, 12), lx + 11, 20);
    lx += 14 + Math.min(12, s.name.length) * 5.5;
  }
}

export function barChart(canvas: HTMLCanvasElement, items: { label: string; value: number; color: string }[]): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const rowH = 20;
  const hgt = Math.max(40, items.length * rowH + 8);
  canvas.style.height = hgt + 'px';
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const max = Math.max(1, ...items.map((i) => i.value));
  ctx.font = '11px system-ui';
  items.forEach((it, k) => {
    const y = 4 + k * rowH;
    const bw = ((w - 150) * it.value) / max;
    ctx.fillStyle = it.color;
    ctx.fillRect(100, y + 3, Math.max(2, bw), rowH - 8);
    ctx.fillStyle = '#e8edf7';
    ctx.textAlign = 'right';
    ctx.fillText(it.label.slice(0, 15), 95, y + 13);
    ctx.textAlign = 'left';
    ctx.fillText(fmtNum(it.value), 104 + Math.max(2, bw), y + 13);
  });
}
