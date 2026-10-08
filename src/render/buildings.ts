import { hsl } from '../core/math';
import { hash01 } from '../core/rng';
import { buildingById } from '../data/buildings';
import type { Building, Settlement } from '../sim/entities';
import { radiusOf } from '../sim/settlement';
import { styleOfEra } from '../sim/tech';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import type { GraphicsQuality } from './quality';

export interface Light {
  x: number;
  y: number;
  r: number;
  color: string;
}

interface Palette { wall: string; wallDark: string; roof: string; roofDark: string; accent: string }

function palette(w: World, s: Settlement, b: Building): Palette {
  const c = w.cultures.get(s.culture);
  const k = w.kingdoms.get(s.kingdom);
  const style = styleOfEra(b.era);
  const roofHue = c ? c.hue : 20;
  const wallHue = c ? c.wallHue : 30;
  if (style >= 3) return { wall: hsl(210, 12, 78), wallDark: hsl(210, 14, 58), roof: hsl(200, 25, 62), roofDark: hsl(200, 25, 48), accent: hsl(k?.hue ?? 190, 80, 60) };
  if (style === 2) return { wall: hsl(wallHue, 18, 58), wallDark: hsl(wallHue, 18, 42), roof: hsl(220, 8, 40), roofDark: hsl(220, 8, 30), accent: hsl(k?.hue ?? 0, 65, 50) };
  return {
    wall: hsl(wallHue, 30, style === 0 ? 58 : 72), wallDark: hsl(wallHue, 28, style === 0 ? 44 : 56),
    roof: style === 0 ? hsl(38, 45, 45) : hsl(roofHue, 50, 42), roofDark: style === 0 ? hsl(38, 45, 33) : hsl(roofHue, 50, 30), accent: hsl(k?.hue ?? 0, 70, 50),
  };
}

/** Draws visible buildings sorted by depth. Returns night lights. */
export function drawBuildings(ctx: CanvasRenderingContext2D, cam: Camera, w: World, q: GraphicsQuality, time: number, night: number): Light[] {
  const lights: Light[] = [];
  const z = cam.zoom;
  const v = cam.view(3);
  const list: [Building, Settlement][] = [];
  for (const s of w.settlements.values()) {
    const r = radiusOf(w, s) + 2;
    if (s.x + r < v.x0 || s.x - r > v.x1 || s.y + r < v.y0 || s.y - r > v.y1) continue;
    if (s.wall > 0 && z >= 3) drawWalls(ctx, cam, w, s);
    for (const bid of s.buildings) {
      const b = w.buildings.get(bid);
      if (!b || b.type === 'farm') continue;
      if (b.x < v.x0 || b.x > v.x1 || b.y < v.y0 || b.y > v.y1) continue;
      list.push([b, s]);
    }
  }
  list.sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x);
  const simple = z < 6;
  for (const [b, s] of list) {
    const [sx, sy] = cam.toScreen(b.x + 0.5, b.y + 0.5);
    const p = palette(w, s, b);
    if (simple) {
      ctx.fillStyle = b.progress < 1 ? 'rgba(150,120,80,0.8)' : p.roof;
      const f = z * 0.7;
      ctx.fillRect(sx - f / 2, sy - f / 2, f, f);
      continue;
    }
    drawBuilding(ctx, b, p, sx, sy, z, q, time, night, lights);
  }
  return lights;
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, fw: number, fd: number, h: number, wall: string, wallDark: string, roof: string): void {
  // front wall
  ctx.fillStyle = wallDark;
  ctx.fillRect(x - fw / 2, y + fd / 2 - h, fw, h);
  // right side hint
  ctx.fillStyle = wall;
  ctx.fillRect(x - fw / 2, y + fd / 2 - h, fw * 0.12, h);
  // top
  ctx.fillStyle = roof;
  ctx.fillRect(x - fw / 2, y - fd / 2 - h, fw, fd);
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, p: Palette, sx: number, sy: number, z: number, q: GraphicsQuality, time: number, night: number, lights: Light[]): void {
  const def = buildingById.get(b.type);
  if (!def) return;
  const style = styleOfEra(b.era);
  const big = ['castle', 'spaceport', 'university', 'townhall', 'temple', 'powerplant', 'factory'].includes(b.type);
  let fw = z * (big ? 0.92 : b.type === 'well' ? 0.4 : 0.7);
  const fd = fw * 0.62;
  let h = def.height * z * 0.55;
  if (b.type === 'house') {
    h *= [0.8, 1, 1.6, 3.4, 4.6][style];
    fw *= style >= 3 ? 0.8 : 1;
  }
  const jitter = (hash01(b.x, b.y, 1) - 0.5) * z * 0.12;
  sx += jitter;
  // shadow
  if (q.shadows) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.moveTo(sx - fw / 2, sy + fd / 2);
    ctx.lineTo(sx + fw / 2, sy + fd / 2);
    ctx.lineTo(sx + fw / 2 + h * 0.55, sy + fd / 2 - h * 0.25);
    ctx.lineTo(sx + fw / 2 + h * 0.55, sy - fd / 2 - h * 0.25);
    ctx.lineTo(sx + fw / 2, sy - fd / 2);
    ctx.closePath();
    ctx.fill();
  }
  if (b.progress < 1) {
    // construction site: scaffolding growing with progress
    const hh = h * Math.max(0.15, b.progress);
    ctx.fillStyle = 'rgba(160,130,90,0.55)';
    ctx.fillRect(sx - fw / 2, sy + fd / 2 - hh, fw, hh);
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = Math.max(1, z / 24);
    ctx.strokeRect(sx - fw / 2, sy - fd / 2 - h, fw, fd + h);
    ctx.beginPath();
    for (let k = 1; k < 3; k++) { ctx.moveTo(sx - fw / 2, sy + fd / 2 - (h * k) / 3); ctx.lineTo(sx + fw / 2, sy + fd / 2 - (h * k) / 3); }
    ctx.moveTo(sx - fw / 2, sy + fd / 2); ctx.lineTo(sx + fw / 2, sy - fd / 2 - h);
    ctx.stroke();
    return;
  }
  switch (b.type) {
    case 'well':
      ctx.fillStyle = p.wallDark;
      ctx.beginPath(); ctx.ellipse(sx, sy, fw / 2, fd / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a6f9a';
      ctx.beginPath(); ctx.ellipse(sx, sy - 1, fw / 3, fd / 3, 0, 0, Math.PI * 2); ctx.fill();
      return;
    case 'mine':
      ctx.fillStyle = '#5a4a3c';
      ctx.beginPath(); ctx.moveTo(sx - fw / 2, sy + fd / 2); ctx.lineTo(sx, sy - fd / 2 - h); ctx.lineTo(sx + fw / 2, sy + fd / 2); ctx.fill();
      ctx.fillStyle = '#1a1410';
      ctx.beginPath(); ctx.arc(sx, sy + fd / 2, fw * 0.2, Math.PI, 0); ctx.fill();
      return;
    case 'lumber':
      box(ctx, sx - fw * 0.15, sy, fw * 0.6, fd, h, p.wall, p.wallDark, p.roof);
      ctx.fillStyle = '#7a5230';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(sx + fw * 0.3, sy + fd * 0.3 - k * z * 0.07, z * 0.06, 0, Math.PI * 2); ctx.fill(); }
      return;
    case 'port':
      ctx.fillStyle = '#7a5530';
      ctx.fillRect(sx - fw * 0.1, sy - fd, fw * 0.2, fd * 2);
      box(ctx, sx - fw * 0.2, sy, fw * 0.5, fd * 0.8, h, p.wall, p.wallDark, p.roof);
      return;
  }
  // generic body
  const bodyH = b.type === 'temple' ? h * 0.6 : b.type === 'castle' ? h * 0.55 : h;
  box(ctx, sx, sy, fw, fd, bodyH, p.wall, p.wallDark, p.roof);
  const topY = sy - fd / 2 - bodyH;
  // roofs by culture / era
  if (style <= 1 && ['house', 'storage', 'workshop', 'barracks', 'market', 'townhall', 'library', 'hospital'].includes(b.type)) {
    const roof = hash01(b.x, b.y, 2) > 0.2 ? cultureRoof(b, p) : 1;
    drawRoof(ctx, roof, sx, topY, fw, fd, z, p);
  }
  // windows
  if (z >= 18 && style >= 1) {
    const rows = Math.max(1, Math.floor(bodyH / (z * 0.18)));
    const cols = Math.max(1, Math.floor(fw / (z * 0.16)));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const lit = night > 0.3 && hash01(b.x * 31 + c, b.y * 17 + r, 4) < 0.6;
        ctx.fillStyle = lit ? 'rgba(255,220,130,0.95)' : style >= 3 ? 'rgba(120,180,220,0.9)' : 'rgba(40,40,60,0.7)';
        ctx.fillRect(sx - fw / 2 + (c + 0.3) * (fw / cols), sy + fd / 2 - bodyH + (r + 0.3) * (bodyH / rows), (fw / cols) * 0.4, (bodyH / rows) * 0.4);
      }
  }
  // building-specific features
  switch (b.type) {
    case 'temple':
      ctx.fillStyle = p.roof;
      if (style >= 1) { ctx.beginPath(); ctx.arc(sx, topY + fd / 2, fw * 0.35, Math.PI, 0); ctx.fill(); }
      ctx.fillStyle = '#f2d67a';
      ctx.fillRect(sx - z * 0.03, topY - fw * 0.45, z * 0.06, fw * 0.3);
      break;
    case 'castle': {
      const tw = fw * 0.22, th = h * 0.9;
      for (const dx of [-1, 1]) box(ctx, sx + dx * (fw / 2 - tw / 2), sy + fd * 0.2, tw, tw * 0.6, th, p.wall, p.wallDark, p.roof);
      box(ctx, sx, sy - fd * 0.2, tw * 1.3, tw * 0.8, h * 1.15, p.wall, p.wallDark, p.roofDark);
      flag(ctx, sx, sy - fd * 0.2 - h * 1.15, z, p.accent, time);
      break;
    }
    case 'barracks': flag(ctx, sx + fw * 0.3, topY, z, p.accent, time); break;
    case 'townhall':
      box(ctx, sx, sy - fd * 0.1, fw * 0.25, fd * 0.3, h * 1.5, p.wall, p.wallDark, p.roofDark);
      flag(ctx, sx, sy - fd * 0.1 - h * 1.5, z, p.accent, time);
      break;
    case 'factory': {
      ctx.fillStyle = '#5a5a60';
      ctx.fillRect(sx + fw * 0.2, topY - h * 0.9, fw * 0.12, h * 0.9 + fd / 2);
      if (q.particles > 200) {
        const t = (time * 0.6 + hash01(b.x, b.y)) % 1;
        ctx.fillStyle = `rgba(90,90,95,${0.5 * (1 - t)})`;
        ctx.beginPath(); ctx.arc(sx + fw * 0.26 + t * z * 0.3, topY - h * 0.9 - t * z * 0.6, z * (0.08 + t * 0.15), 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'powerplant':
      ctx.fillStyle = '#c8c8c8';
      ctx.beginPath();
      ctx.moveTo(sx - fw * 0.35, sy + fd / 2); ctx.quadraticCurveTo(sx - fw * 0.15, sy - h * 0.5, sx - fw * 0.28, topY - h * 0.4);
      ctx.lineTo(sx + fw * 0.08, topY - h * 0.4); ctx.quadraticCurveTo(sx - fw * 0.05, sy - h * 0.5, sx + fw * 0.15, sy + fd / 2);
      ctx.fill();
      lights.push({ x: b.x + 0.5, y: b.y + 0.5, r: 2.5, color: 'rgba(120,200,255,0.5)' });
      break;
    case 'lab':
      ctx.fillStyle = 'rgba(160,220,255,0.9)';
      ctx.beginPath(); ctx.arc(sx, topY + fd / 2, fw * 0.32, Math.PI, 0); ctx.fill();
      break;
    case 'university':
      ctx.fillStyle = p.wall;
      for (let c = 0; c < 4; c++) ctx.fillRect(sx - fw / 2 + fw * (0.1 + c * 0.24), sy + fd / 2 - bodyH, fw * 0.06, bodyH);
      ctx.fillStyle = p.roof;
      ctx.beginPath(); ctx.moveTo(sx - fw / 2, topY + fd * 0.2); ctx.lineTo(sx, topY - fd * 0.5); ctx.lineTo(sx + fw / 2, topY + fd * 0.2); ctx.fill();
      break;
    case 'spaceport': {
      ctx.fillStyle = '#9aa0a8';
      ctx.fillRect(sx - fw * 0.05, topY - h * 1.6, fw * 0.08, h * 1.6);
      ctx.fillStyle = '#eee';
      ctx.beginPath(); ctx.moveTo(sx + fw * 0.2, topY - h * 1.4); ctx.lineTo(sx + fw * 0.28, topY - h * 0.2); ctx.lineTo(sx + fw * 0.12, topY - h * 0.2); ctx.fill();
      lights.push({ x: b.x + 0.5, y: b.y + 0.2, r: 3, color: 'rgba(255,120,80,0.5)' });
      break;
    }
    case 'market': {
      const colors = ['#d94a3a', '#e8c040', '#3a8ad9'];
      for (let c = 0; c < 3; c++) { ctx.fillStyle = colors[c]; ctx.fillRect(sx - fw / 2 + c * fw / 3, topY - z * 0.05, fw / 3 - 1, fd * 0.5); }
      break;
    }
    case 'storage':
      ctx.strokeStyle = p.roofDark;
      ctx.lineWidth = Math.max(1, z / 30);
      ctx.strokeRect(sx - fw * 0.2, sy + fd / 2 - bodyH * 0.7, fw * 0.4, bodyH * 0.7);
      break;
  }
  if (style >= 3 && b.type === 'house') {
    ctx.fillStyle = p.accent;
    ctx.fillRect(sx - fw / 2, topY + fd - 1, fw, Math.max(1, z * 0.03));
  }
  if (night > 0.2 && (b.type === 'house' || def.jobs) && hash01(b.x, b.y, 5) < 0.75) {
    const era = styleOfEra(b.era);
    lights.push({ x: b.x + 0.5, y: b.y + 0.3, r: era >= 2 ? 1.6 : 1, color: era >= 2 ? 'rgba(255,230,160,0.55)' : 'rgba(255,170,80,0.5)' });
  }
}

function cultureRoof(b: Building, _p: Palette): number {
  return (Math.floor(hash01(b.settlement, 0, 3) * 5) + 5) % 5;
}

function drawRoof(ctx: CanvasRenderingContext2D, roof: number, sx: number, topY: number, fw: number, fd: number, z: number, p: Palette): void {
  switch (roof) {
    case 0: // thatch
      ctx.fillStyle = p.roof;
      ctx.beginPath(); ctx.ellipse(sx, topY + fd / 2, fw * 0.55, fd * 0.75, 0, Math.PI, 0); ctx.fill();
      break;
    case 1: // pitched
      ctx.fillStyle = p.roof;
      ctx.beginPath(); ctx.moveTo(sx - fw / 2 - 1, topY + fd); ctx.lineTo(sx, topY - fd * 0.35); ctx.lineTo(sx + fw / 2 + 1, topY + fd); ctx.fill();
      ctx.fillStyle = p.roofDark;
      ctx.beginPath(); ctx.moveTo(sx, topY - fd * 0.35); ctx.lineTo(sx + fw / 2 + 1, topY + fd); ctx.lineTo(sx + fw * 0.15, topY + fd); ctx.fill();
      break;
    case 2: // flat with parapet
      ctx.strokeStyle = p.roofDark;
      ctx.lineWidth = Math.max(1, z / 28);
      ctx.strokeRect(sx - fw / 2 + 1, topY + 1, fw - 2, fd - 2);
      break;
    case 3: // dome
      ctx.fillStyle = p.roof;
      ctx.beginPath(); ctx.arc(sx, topY + fd / 2, Math.min(fw, fd * 1.4) * 0.45, Math.PI, 0); ctx.fill();
      break;
    default: // pagoda
      ctx.fillStyle = p.roof;
      for (let k = 0; k < 2; k++) {
        const ww = fw * (1.15 - k * 0.35), yy = topY + fd * 0.6 - k * fd * 0.6;
        ctx.beginPath(); ctx.moveTo(sx - ww / 2, yy + fd * 0.3); ctx.quadraticCurveTo(sx, yy - fd * 0.5, sx + ww / 2, yy + fd * 0.3); ctx.fill();
      }
  }
}

function flag(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, color: string, time: number): void {
  if (z < 10) return;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = Math.max(1, z / 40);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - z * 0.45); ctx.stroke();
  const wave = Math.sin(time * 4 + x) * z * 0.03;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y - z * 0.45); ctx.lineTo(x + z * 0.25, y - z * 0.4 + wave); ctx.lineTo(x, y - z * 0.33); ctx.fill();
}

function drawWalls(ctx: CanvasRenderingContext2D, cam: Camera, w: World, s: Settlement): void {
  const r = Math.max(2, radiusOf(w, s) * 0.55);
  const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
  const z = cam.zoom;
  const rr = r * z;
  ctx.strokeStyle = s.wall >= 3 ? '#6e6a62' : s.wall === 2 ? '#8d877b' : '#9c8a6a';
  ctx.lineWidth = Math.max(1.5, z * (0.12 + s.wall * 0.05));
  ctx.beginPath(); ctx.ellipse(sx, sy, rr, rr * 0.92, 0, 0, Math.PI * 2); ctx.stroke();
  if (z >= 8) {
    ctx.fillStyle = '#7a7468';
    const n = 6 + s.wall * 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const tx = sx + Math.cos(a) * rr, ty = sy + Math.sin(a) * rr * 0.92;
      ctx.fillRect(tx - z * 0.14, ty - z * 0.3, z * 0.28, z * 0.34);
    }
  }
}

/** Strategic / intermediate zoom: settlement markers and names. */
export function drawSettlementMarkers(ctx: CanvasRenderingContext2D, cam: Camera, w: World, labels: boolean): void {
  const v = cam.view(4);
  const z = cam.zoom;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const s of w.settlements.values()) {
    if (s.x < v.x0 || s.x > v.x1 || s.y < v.y0 || s.y > v.y1) continue;
    const k = w.kingdoms.get(s.kingdom);
    const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
    const capital = k?.capital === s.id;
    const r = Math.max(2.5, (1.5 + s.level * 0.9) * Math.min(1.6, z / 2.5));
    if (z < 6) {
      ctx.fillStyle = k ? hsl(k.hue, 70, 45) : '#888';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (capital) { ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2); ctx.fill(); }
      if (s.siege > 0) { ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, r + 3, -Math.PI / 2, -Math.PI / 2 + (s.siege / 100) * Math.PI * 2); ctx.stroke(); }
      if (s.infected > 0.05) { ctx.fillStyle = 'rgba(120,220,80,0.8)'; ctx.beginPath(); ctx.arc(sx + r, sy - r, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (labels && (s.level >= 2 || capital || z > 5)) {
      const fs = Math.round(Math.min(16, 9 + s.level * 1.2 + (capital ? 2 : 0)));
      ctx.font = `${capital ? 'bold ' : ''}${fs}px system-ui, sans-serif`;
      const text = (capital ? '★ ' : '') + s.name;
      const ty = sy - (z < 6 ? r + 2 : radiusOf(w, s) * 0.55 * z + 4);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(text, sx, ty);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, sx, ty);
    }
  }
}

/** Kingdom names at strategic zoom, at the centroid of their settlements. */
export function drawKingdomLabels(ctx: CanvasRenderingContext2D, cam: Camera, w: World): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const k of w.livingKingdoms()) {
    let x = 0, y = 0, n = 0;
    for (const sid of k.settlements) { const s = w.settlements.get(sid); if (s) { x += s.x * (s.pop + 1); y += s.y * (s.pop + 1); n += s.pop + 1; } }
    if (!n) continue;
    const [sx, sy] = cam.toScreen(x / n, y / n + 3);
    const size = Math.round(Math.min(28, 12 + Math.sqrt(k.settlements.length) * 3));
    ctx.font = `600 ${size}px Georgia, serif`;
    const text = k.name.toUpperCase();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(text, sx, sy);
    ctx.fillStyle = hsl(k.hue, 80, 82);
    ctx.fillText(text, sx, sy);
  }
}
