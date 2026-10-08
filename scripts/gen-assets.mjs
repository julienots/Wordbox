// Procedural app icon & splash screen (original artwork, no external assets).
// Writes public/icon.png and, if the Android project exists, all launcher
// mipmaps, adaptive-icon foregrounds and splash drawables.
import { writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodePNG } from './png.mjs';

function hash(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const sm = (t) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return (a * (1 - sm(tx)) + b * sm(tx)) * (1 - sm(ty)) + (c * (1 - sm(tx)) + d * sm(tx)) * sm(ty);
}
const fbm = (x, y) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += a * vnoise(x * f, y * f, o); a *= 0.5; f *= 2; } return v; };

/** Draw the emblem: starfield, planet with continents & shading, golden ring. */
function render(size, { background = true, scale = 1 } = {}) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2, R = size * 0.3 * scale;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    let r = 0, g = 0, b = 0, a = background ? 255 : 0;
    if (background) {
      const d = Math.hypot(x - c, y - c) / size;
      r = 14 + 20 * (1 - d); g = 18 + 22 * (1 - d); b = 40 + 50 * (1 - d);
      if (hash(x, y, 9) > 0.996) { const s = 150 + hash(x, y, 3) * 105; r = g = b = s; }
    }
    const dx = (x - c) / R, dy = (y - c) / R, d2 = dx * dx + dy * dy;
    // ring behind (upper half) and in front (lower half)
    const ringR = Math.hypot(dx, dy * 3.2 + dx * 0.9);
    const onRing = ringR > 1.35 && ringR < 1.6;
    if (onRing && dy * 3.2 + dx * 0.9 < 0 && d2 > 1) { r = 230; g = 180; b = 80; a = 255; }
    if (d2 <= 1) {
      const nz = Math.sqrt(1 - d2);
      const land = fbm(dx * 2.2 + 3, dy * 2.2 + 7) > 0.52;
      const light = Math.max(0.15, -dx * 0.5 - dy * 0.6 + nz * 0.6);
      let cr, cg, cb;
      if (land) { const m = fbm(dx * 6, dy * 6); cr = 70 + m * 60; cg = 150 + m * 40; cb = 70; if (Math.abs(dy) > 0.8) { cr = cg = cb = 235; } }
      else { cr = 30; cg = 90; cb = 170; }
      r = cr * light + 10; g = cg * light + 12; b = cb * light + 25;
      const rim = Math.pow(1 - nz, 3);
      r += rim * 60; g += rim * 120; b += rim * 200;
      a = 255;
    }
    if (onRing && dy * 3.2 + dx * 0.9 >= 0) { r = 245; g = 200; b = 100; a = 255; }
    // soft glow around the planet
    if (d2 > 1 && d2 < 1.5 && a === 255) { const k = (1.5 - d2) * 0.6; r += 40 * k; g += 90 * k; b += 160 * k; }
    px[o] = Math.min(255, r); px[o + 1] = Math.min(255, g); px[o + 2] = Math.min(255, b); px[o + 3] = a;
  }
  return encodePNG(size, size, px);
}


mkdirSync('public', { recursive: true });
writeFileSync('public/icon.png', render(512));
console.log('public/icon.png');
const res = 'android/app/src/main/res';
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = join(res, `mipmap-${d}`);
    mkdirSync(dir, { recursive: true });
    const s = Math.round(48 * k);
    writeFileSync(join(dir, 'ic_launcher.png'), render(s));
    writeFileSync(join(dir, 'ic_launcher_round.png'), render(s));
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), render(Math.round(108 * k), { background: false, scale: 0.72 }));
  }
  // splash drawables (every splash.png the template provides)
  for (const dir of readdirSync(res).filter((n) => n.startsWith('drawable'))) {
    const f = join(res, dir, 'splash.png');
    if (existsSync(f)) writeFileSync(f, render(dir.includes('xxxhdpi') ? 1280 : dir.includes('xxhdpi') ? 960 : 640, { scale: 0.6 }));
  }
  const bg = join(res, 'values', 'ic_launcher_background.xml');
  writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0D1424</color>\n</resources>\n');
  console.log('android resources updated');
}
