import { hsl } from '../core/math';
import { animalById } from '../data/animals';
import { speciesById } from '../data/species';
import { DAYS_PER_YEAR } from '../data/time';
import { Person, PS } from '../sim/entities';
import { unitCount } from '../sim/war';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import type { GraphicsQuality } from './quality';

const TOOL: Record<string, string> = {
  farmer: '#c9a24a', woodcutter: '#8a8a8a', miner: '#9a9a9a', soldier: '#c0c0c0', hunter: '#7a5230', smith: '#555',
  scholar: '#f0f0e0', priest: '#f2d67a', merchant: '#e0b030', builder: '#b07030', doctor: '#ffffff', engineer: '#40a0ff',
};

/** Persons: interpolated between ticks, animated at close zoom. */
export function drawPersons(ctx: CanvasRenderingContext2D, cam: Camera, w: World, q: GraphicsQuality, alpha: number, time: number, selected: number): number {
  const z = cam.zoom;
  if (z < 8) return 0;
  const v = cam.view(1);
  const s = z * 0.42;
  let drawn = 0;
  const list: Person[] = [];
  for (const p of w.persons.values()) {
    if (p.state === PS.ARMY) continue;
    if (p.x < v.x0 || p.x > v.x1 || p.y < v.y0 || p.y > v.y1) continue;
    list.push(p);
    if (list.length >= q.maxPersons) break;
  }
  list.sort((a, b) => a.y - b.y);
  for (const p of list) {
    const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha;
    const [sx, sy] = cam.toScreen(x, y);
    const age = (w.tick - p.birth) / DAYS_PER_YEAR;
    const child = age < 14;
    const sc = s * p.scale * (child ? 0.65 : 1);
    const moving = Math.abs(p.x - p.px) + Math.abs(p.y - p.py) > 0.001;
    const bob = moving ? Math.sin(time * 14 + p.id) * sc * 0.08 : 0;
    const c = w.cultures.get(p.culture);
    const clothes = hsl(c ? c.clothesHue + (p.female ? 30 : 0) : 200, 50, p.female ? 55 : 42);
    const sp = speciesById(p.species);
    const skin = hsl(sp.skinHue + p.genome.hue, p.species === 'human' ? 40 : 35, p.species === 'stonekin' ? 55 : 62);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy, sc * 0.35, sc * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    // legs
    if (z >= 20) {
      const step = moving ? Math.sin(time * 14 + p.id) * sc * 0.15 : 0;
      ctx.strokeStyle = '#3a2a20';
      ctx.lineWidth = Math.max(1, sc * 0.1);
      ctx.beginPath();
      ctx.moveTo(sx - sc * 0.08, sy - sc * 0.35); ctx.lineTo(sx - sc * 0.1 + step, sy);
      ctx.moveTo(sx + sc * 0.08, sy - sc * 0.35); ctx.lineTo(sx + sc * 0.1 - step, sy);
      ctx.stroke();
    }
    // body
    ctx.fillStyle = p.sick > 0 ? '#7aa060' : clothes;
    const bw = sc * (p.female ? 0.42 : 0.36);
    ctx.beginPath();
    ctx.moveTo(sx - bw / 2, sy - sc * 0.3 + bob);
    ctx.lineTo(sx + bw / 2, sy - sc * 0.3 + bob);
    ctx.lineTo(sx + bw * 0.35, sy - sc * 0.78 + bob);
    ctx.lineTo(sx - bw * 0.35, sy - sc * 0.78 + bob);
    ctx.fill();
    // head
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(sx, sy - sc * 0.92 + bob, sc * 0.17, 0, Math.PI * 2); ctx.fill();
    if (z >= 16) {
      ctx.fillStyle = hsl(p.genome.hair, 35, 25);
      ctx.beginPath(); ctx.arc(sx, sy - sc * 0.97 + bob, sc * 0.15, Math.PI, 0); ctx.fill();
    }
    // tool
    const tool = TOOL[p.prof];
    if (tool && z >= 22 && !child) {
      ctx.strokeStyle = tool;
      ctx.lineWidth = Math.max(1, sc * 0.07);
      ctx.beginPath(); ctx.moveTo(sx + bw * 0.5, sy - sc * 0.55 + bob); ctx.lineTo(sx + bw * 0.9, sy - sc * 1.05 + bob); ctx.stroke();
    }
    // crown / hero star
    if (p.title && (p.title.includes('Roi') || p.title.includes('Reine') || p.title.includes('Emp') || p.title.includes('Chef') || p.title.includes('Prés') || p.title.includes('Consul') || p.title.includes('Archonte') || p.title.includes('prêtre'))) {
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      const cy = sy - sc * 1.12 + bob;
      ctx.moveTo(sx - sc * 0.15, cy); ctx.lineTo(sx - sc * 0.15, cy - sc * 0.15); ctx.lineTo(sx - sc * 0.05, cy - sc * 0.07);
      ctx.lineTo(sx, cy - sc * 0.18); ctx.lineTo(sx + sc * 0.05, cy - sc * 0.07); ctx.lineTo(sx + sc * 0.15, cy - sc * 0.15); ctx.lineTo(sx + sc * 0.15, cy);
      ctx.fill();
    } else if (p.renown > 90) {
      ctx.fillStyle = '#ffe680';
      ctx.font = `${Math.round(sc * 0.4)}px sans-serif`;
      ctx.fillText('★', sx, sy - sc * 1.15);
    }
    if (p.id === selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, sc * 0.55, sc * 0.25, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawn++;
  }
  return drawn;
}

export function drawAnimals(ctx: CanvasRenderingContext2D, cam: Camera, w: World, q: GraphicsQuality, alpha: number, time: number): number {
  const z = cam.zoom;
  const v = cam.view(2);
  let drawn = 0;
  for (const a of w.animals.values()) {
    if (a.x < v.x0 || a.x > v.x1 || a.y < v.y0 || a.y > v.y1) continue;
    const def = animalById.get(a.sp);
    if (!def) continue;
    if (z < 7 && !def.fantastic) continue;
    if (drawn >= q.maxAnimals) break;
    drawn++;
    const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
    const [sx, sy] = cam.toScreen(x, y);
    const sz = z * def.size * 0.55 * (def.fantastic && z < 7 ? 3 : 1);
    const dir = a.x >= a.px ? 1 : -1;
    const moving = Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.001;
    if (def.habitat === 'water') {
      ctx.fillStyle = def.color;
      const wig = Math.sin(time * 6 + a.id) * sz * 0.1;
      ctx.beginPath(); ctx.ellipse(sx, sy + wig, sz * 0.5, sz * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - dir * sz * 0.45, sy); ctx.lineTo(sx - dir * sz * 0.8, sy - sz * 0.2); ctx.lineTo(sx - dir * sz * 0.8, sy + sz * 0.2); ctx.fill();
      if (a.sp === 'serpent') {
        ctx.strokeStyle = def.color; ctx.lineWidth = sz * 0.25;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) ctx.lineTo(sx - dir * k * sz * 0.4, sy + Math.sin(time * 3 + k) * sz * 0.2);
        ctx.stroke();
      }
      continue;
    }
    if (def.habitat === 'air') {
      const fly = sz * 1.6;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(sx, sy, sz * 0.4, sz * 0.15, 0, 0, Math.PI * 2); ctx.fill();
      const flap = Math.sin(time * (a.sp === 'bird' ? 16 : 6) + a.id) * sz * 0.5;
      ctx.strokeStyle = def.color; ctx.fillStyle = def.color;
      ctx.lineWidth = Math.max(1, sz * 0.15);
      ctx.beginPath();
      ctx.moveTo(sx - sz, sy - fly - flap); ctx.quadraticCurveTo(sx - sz * 0.4, sy - fly, sx, sy - fly);
      ctx.quadraticCurveTo(sx + sz * 0.4, sy - fly, sx + sz, sy - fly - flap);
      ctx.stroke();
      if (a.sp !== 'bird') {
        ctx.beginPath(); ctx.ellipse(sx, sy - fly, sz * 0.45, sz * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        if (a.sp === 'dragon' && Math.sin(time * 2 + a.id) > 0.7) {
          ctx.fillStyle = 'rgba(255,140,40,0.8)';
          ctx.beginPath(); ctx.moveTo(sx + dir * sz * 0.45, sy - fly); ctx.lineTo(sx + dir * sz * 1.6, sy - fly + sz * 0.6); ctx.lineTo(sx + dir * sz * 1.4, sy - fly + sz * 0.9); ctx.fill();
        }
      }
      continue;
    }
    // land quadruped
    const legs = moving ? Math.sin(time * 12 + a.id) * sz * 0.12 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(sx, sy, sz * 0.5, sz * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = Math.max(1, sz * 0.1);
    if (z >= 14) {
      ctx.beginPath();
      ctx.moveTo(sx - sz * 0.25, sy - sz * 0.3); ctx.lineTo(sx - sz * 0.25 + legs, sy);
      ctx.moveTo(sx + sz * 0.25, sy - sz * 0.3); ctx.lineTo(sx + sz * 0.25 - legs, sy);
      ctx.stroke();
    }
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.ellipse(sx, sy - sz * 0.4, sz * 0.42, sz * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + dir * sz * 0.42, sy - sz * 0.55, sz * 0.15, 0, Math.PI * 2); ctx.fill();
    if (a.sp === 'deer' && z >= 14) {
      ctx.strokeStyle = '#d8c8a0';
      ctx.beginPath(); ctx.moveTo(sx + dir * sz * 0.45, sy - sz * 0.68); ctx.lineTo(sx + dir * sz * 0.35, sy - sz * 0.95); ctx.moveTo(sx + dir * sz * 0.5, sy - sz * 0.68); ctx.lineTo(sx + dir * sz * 0.65, sy - sz * 0.92); ctx.stroke();
    } else if (a.sp === 'rabbit' && z >= 14) {
      ctx.beginPath(); ctx.ellipse(sx + dir * sz * 0.4, sy - sz * 0.8, sz * 0.05, sz * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    } else if (a.sp === 'demon' || a.sp === 'alien') {
      ctx.fillStyle = a.sp === 'demon' ? '#ffcc00' : '#000';
      ctx.beginPath(); ctx.arc(sx + dir * sz * 0.46, sy - sz * 0.58, sz * 0.05, 0, Math.PI * 2); ctx.fill();
    }
  }
  return drawn;
}

/** Armies: formation of soldiers + banner (close/mid zoom) or shield icon (strategic). */
export function drawArmies(ctx: CanvasRenderingContext2D, cam: Camera, w: World, alpha: number, time: number): void {
  const z = cam.zoom;
  const v = cam.view(3);
  for (const a of w.armies.values()) {
    const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
    if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
    const k = w.kingdoms.get(a.kingdom);
    const color = k ? hsl(k.hue, 75, 48) : '#888';
    const [sx, sy] = cam.toScreen(x, y);
    const n = unitCount(a.units);
    if (z < 7) {
      const r = Math.max(5, Math.min(12, 4 + Math.sqrt(n) * 0.6));
      ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy - r); ctx.lineTo(sx + r, sy); ctx.quadraticCurveTo(sx, sy + r * 1.6, sx - r, sy); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n > 999 ? Math.round(n / 1000) + 'k' : String(n), sx, sy - r * 0.3);
      if (a.state === 'battle') { ctx.font = '14px sans-serif'; ctx.fillText('⚔️', sx + r + 6, sy - r); }
      continue;
    }
    const figures = Math.min(16, Math.max(3, Math.ceil(n / 10)));
    const s = z * 0.36;
    const cols = Math.ceil(Math.sqrt(figures));
    for (let f = 0; f < figures; f++) {
      const fx = sx + ((f % cols) - cols / 2) * s * 0.7;
      const fy = sy + (Math.floor(f / cols) - cols / 2) * s * 0.5;
      const bob = Math.sin(time * 10 + f) * s * 0.05;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(fx, fy, s * 0.3, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(fx - s * 0.16, fy - s * 0.75 + bob, s * 0.32, s * 0.45);
      ctx.fillStyle = '#ccc';
      ctx.beginPath(); ctx.arc(fx, fy - s * 0.88 + bob, s * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#999'; ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath(); ctx.moveTo(fx + s * 0.22, fy - s * 0.2); ctx.lineTo(fx + s * 0.3, fy - s * 1.25 + bob); ctx.stroke();
    }
    // banner
    const bx = sx - cols * s * 0.45, by = sy - cols * s * 0.3;
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = Math.max(1, z / 30);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - z * 1.1); ctx.stroke();
    ctx.fillStyle = color;
    const wave = Math.sin(time * 5) * z * 0.05;
    ctx.beginPath(); ctx.moveTo(bx, by - z * 1.1); ctx.lineTo(bx + z * 0.6, by - z * 1.0 + wave); ctx.lineTo(bx, by - z * 0.75); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(Math.max(9, z * 0.3))}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${n}`, bx + z * 0.1, by - z * 1.12);
  }
}

/** Caravans and ships moving along trade routes. */
export function drawCaravans(ctx: CanvasRenderingContext2D, cam: Camera, w: World, time: number): void {
  const z = cam.zoom;
  if (z < 5) return;
  const v = cam.view(2);
  const m = w.map;
  for (const r of w.routes.values()) {
    if (r.volume <= 0 || r.path.length < 3) continue;
    const n = Math.min(3, 1 + Math.floor(r.volume / 40));
    for (let c = 0; c < n; c++) {
      const phase = ((time * 2.5) / r.path.length + c / n + r.id * 0.137) % 1;
      const pingpong = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const fi = pingpong * (r.path.length - 1);
      const i0 = r.path[Math.floor(fi)], i1 = r.path[Math.min(r.path.length - 1, Math.floor(fi) + 1)];
      const t = fi - Math.floor(fi);
      const x = (i0 % m.w) * (1 - t) + (i1 % m.w) * t + 0.5, y = Math.floor(i0 / m.w) * (1 - t) + Math.floor(i1 / m.w) * t + 0.5;
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      const [sx, sy] = cam.toScreen(x, y);
      const water = m.isWater(i0) && m.biome[i0] !== 4;
      const s = z * 0.35;
      if (water) {
        ctx.fillStyle = '#6b4a2a';
        ctx.beginPath(); ctx.moveTo(sx - s, sy); ctx.lineTo(sx + s, sy); ctx.lineTo(sx + s * 0.6, sy + s * 0.4); ctx.lineTo(sx - s * 0.6, sy + s * 0.4); ctx.fill();
        ctx.fillStyle = '#f4efe0';
        ctx.beginPath(); ctx.moveTo(sx, sy - s * 1.2); ctx.lineTo(sx + s * 0.6, sy - s * 0.1); ctx.lineTo(sx, sy - s * 0.1); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(sx, sy, s * 0.6, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a0784a';
        ctx.fillRect(sx - s * 0.5, sy - s * 0.6, s, s * 0.5);
        ctx.fillStyle = '#e8dcc0';
        ctx.beginPath(); ctx.arc(sx, sy - s * 0.6, s * 0.45, Math.PI, 0); ctx.fill();
      }
    }
  }
}

/** Moving disasters with a body: tornadoes, UFOs, black holes, rifts, tsunamis. */
export function drawDisasterEntities(ctx: CanvasRenderingContext2D, cam: Camera, w: World, time: number): void {
  const z = cam.zoom;
  for (const d of w.disasters) {
    const [sx, sy] = cam.toScreen(d.x, d.y);
    switch (d.type) {
      case 'tornado': {
        const h = Math.max(30, z * 4);
        for (let k = 0; k < 14; k++) {
          const t = k / 14;
          const r = (0.15 + t * 0.9) * Math.max(6, z * 1.2);
          const off = Math.sin(time * 9 + k) * r * 0.25;
          ctx.fillStyle = `rgba(110,105,100,${0.18 + t * 0.1})`;
          ctx.beginPath(); ctx.ellipse(sx + off, sy - t * h, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'ufo': {
        const s = Math.max(10, z * 1.2);
        const hy = sy - s * 2 + Math.sin(time * 3 + d.id) * s * 0.2;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(sx, sy, s, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(120,255,160,0.18)';
        ctx.beginPath(); ctx.moveTo(sx - s * 0.4, hy); ctx.lineTo(sx + s * 0.4, hy); ctx.lineTo(sx + s, sy); ctx.lineTo(sx - s, sy); ctx.fill();
        ctx.fillStyle = '#9aa8b8';
        ctx.beginPath(); ctx.ellipse(sx, hy, s, s * 0.32, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(140,255,200,0.9)';
        ctx.beginPath(); ctx.arc(sx, hy - s * 0.15, s * 0.4, Math.PI, 0); ctx.fill();
        for (let k = 0; k < 5; k++) { ctx.fillStyle = (k + Math.floor(time * 6)) % 2 ? '#ff4' : '#f44'; ctx.beginPath(); ctx.arc(sx - s * 0.7 + k * s * 0.35, hy + s * 0.05, s * 0.06, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'blackhole': {
        const r = d.r * z;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.2);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(10,0,25,0.95)'); g.addColorStop(0.5, 'rgba(200,120,255,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,120,0.6)';
        ctx.lineWidth = Math.max(1, r * 0.08);
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(sx, sy, r * (0.8 + k * 0.25), r * (0.25 + k * 0.08), time * (1.5 - k * 0.2) + k, 0, Math.PI * 1.4);
          ctx.stroke();
        }
        break;
      }
      case 'rift': {
        const r = Math.max(8, z * 2.2);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(time * 0.8);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(180,40,255,0.8)'); g.addColorStop(1, 'rgba(60,0,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.5, r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'tsunami': {
        ctx.strokeStyle = 'rgba(220,240,255,0.75)';
        ctx.lineWidth = Math.max(2, z * 0.6);
        ctx.beginPath(); ctx.arc(sx, sy, d.r * z, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(80,140,200,0.5)';
        ctx.lineWidth = Math.max(3, z * 1.2);
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, d.r - 1) * z, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'eruption': {
        const r = Math.max(6, z * 1.5);
        for (let k = 0; k < 6; k++) {
          const t = ((time * 0.5 + k / 6) % 1);
          ctx.fillStyle = `rgba(60,55,55,${0.45 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(sx + Math.sin(k * 7) * r * t, sy - r * 4 * t, r * (0.6 + t * 1.5), 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
    }
  }
}
