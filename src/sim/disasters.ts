import { clamp } from '../core/math';
import { B, BIOMES } from '../data/biomes';
import { SEA_LEVEL } from '../world/classify';
import { startDrought } from './climate';
import { spawnAnimal } from './ecosystem';
import { Disaster, Epidemic, PS } from './entities';
import { killPerson } from './person';
import { destroySettlement, removeBuilding } from './settlement';
import { techFx } from './tech';
import type { World } from './world';

export const DISASTER_INFO: Record<string, { name: string; desc: string }> = {
  meteor: { name: 'Météore', desc: 'Un rocher céleste creuse un cratère et embrase la région.' },
  volcano: { name: 'Éruption volcanique', desc: 'La lave coule selon le relief, les cendres fertilisent ensuite le sol.' },
  earthquake: { name: 'Séisme', desc: 'Le sol se fracture et les bâtiments s’effondrent.' },
  tsunami: { name: 'Tsunami', desc: 'Une vague géante submerge les côtes basses.' },
  fire: { name: 'Incendie', desc: 'Le feu se propage par la végétation et les bâtiments ; la pluie l’éteint.' },
  tornado: { name: 'Tornade', desc: 'Un tourbillon dévastateur qui arrache arbres et maisons.' },
  hurricane: { name: 'Ouragan', desc: 'Tempête géante née sur l’océan, s’affaiblit sur terre.' },
  famine: { name: 'Famine', desc: 'Les récoltes s’effondrent pendant plusieurs mois.' },
  epidemic: { name: 'Épidémie', desc: 'Une maladie se propage le long des routes commerciales.' },
  drought: { name: 'Sécheresse', desc: 'La végétation dépérit, les incendies se multiplient.' },
  iceage: { name: 'Âge glaciaire', desc: 'Le climat mondial se refroidit pour des décennies.' },
};

export function ignite(w: World, i: number, intensity = 60): void {
  const m = w.map;
  if (i < 0 || i >= m.size || BIOMES[m.biome[i]].water) return;
  if (w.fires.size > 4000) return;
  m.fire[i] = Math.max(m.fire[i], intensity);
  w.fires.add(i);
  w.unlock('disaster:fire');
}

/** Generic area damage: people, aggregate population, buildings, animals. Returns casualties. */
export function damageArea(w: World, x: number, y: number, r: number, severity: number, cause: string): number {
  const m = w.map;
  let dead = 0;
  w.spatialPersons.query(x, y, r, (p) => {
    if (w.rng.chance(severity)) { killPerson(w, p, cause === 'divin' ? 'divin' : 'catastrophe'); dead++; }
  });
  for (const p of w.persons.values()) {
    if (p.state === PS.ARMY && (p.x - x) ** 2 + (p.y - y) ** 2 < r * r && w.rng.chance(severity)) { killPerson(w, p, 'catastrophe'); dead++; }
  }
  w.spatialAnimals.query(x, y, r, (a) => { if (w.rng.chance(severity)) a.hp = 0; });
  for (const s of [...w.settlements.values()]) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > r + 6) continue;
    const overlap = clamp(1 - d / (r + 6), 0, 1);
    const loss = s.extraPop * severity * overlap;
    s.extraPop -= loss;
    dead += loss;
    if (s.pop <= 0 && overlap > 0.5 && severity > 0.3) destroySettlement(w, s, cause);
  }
  m.disc(x, y, r, (i) => {
    const bid = m.bld[i];
    if (bid >= 0) {
      const b = w.buildings.get(bid);
      if (b) {
        b.hp -= severity * 120;
        if (b.hp <= 0) removeBuilding(w, bid);
      }
    }
    if (severity > 0.3 && m.road[i] && w.rng.chance(severity * 0.5)) { m.road[i] = 0; m.dirty(i); m.terrainVer++; }
  });
  w.stats.disasterDeaths += dead;
  return Math.round(dead);
}

function addDisaster(w: World, type: string, x: number, y: number, r: number, life: number, power = 1): Disaster {
  const ang = w.rng.range(0, Math.PI * 2);
  const d: Disaster = { id: w.id(), type, x, y, r, life, vx: Math.cos(ang) * 0.25, vy: Math.sin(ang) * 0.25, power };
  w.disasters.push(d);
  return d;
}

function nearestName(w: World, x: number, y: number): string {
  let best = '', bd = 30 * 30;
  for (const s of w.settlements.values()) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) { bd = d; best = s.name; }
  }
  return best ? ` près de ${best}` : '';
}

export function meteor(w: World, x: number, y: number, r = 5, silent = false): void {
  const m = w.map;
  w.fx('meteor', x, y, r);
  w.sfx('explosion', x, y);
  const dead = damageArea(w, x, y, r * 1.6, 0.85, 'météore');
  m.disc(x, y, r, (i, _x, _y, d) => {
    const depth = (1 - d / r) * 0.12;
    m.height[i] = Math.max(0.05, m.height[i] - depth);
    if (m.height[i] < SEA_LEVEL - 0.02 && d < r * 0.4) m.setBiome(i, B.LAKE);
    else if (!m.isWater(i)) { m.setBiome(i, d < r * 0.6 ? B.BARREN : B.ASH); m.timer[i] = 400; }
    m.veg[i] = 0;
    if (w.rng.chance(0.05)) { m.deposit[i] = w.rng.chance(0.3) ? 5 : 2; m.depositAmt[i] = 800; }
  });
  m.terrainVer++;
  m.disc(x, y, r * 2, (i, _x, _y, d) => { if (d > r && w.rng.chance(0.25)) ignite(w, i, 70); });
  w.unlock('disaster:meteor');
  if (!silent) w.addHistory('disaster', `Un météore s’écrase${nearestName(w, x, y)} (${dead} victimes).`, dead > 50 ? 3 : 2, x, y);
}

export function eruption(w: World, x: number, y: number): void {
  const m = w.map;
  const i = m.idx(x | 0, y | 0);
  if (m.biome[i] !== B.VOLCANO) {
    m.height[i] = Math.min(1, m.height[i] + 0.1);
    m.setBiome(i, B.VOLCANO);
  }
  addDisaster(w, 'eruption', (x | 0) + 0.5, (y | 0) + 0.5, 3, 90);
  m.disc(x, y, 8, (j, _x, _y, d) => {
    if (m.isWater(j) || j === i) return;
    m.veg[j] = Math.floor(m.veg[j] * (d / 8));
    if (d < 6 && w.rng.chance(0.2)) ignite(w, j, 60);
    m.dirty(j);
  });
  w.fx('eruption', x, y, 8);
  w.sfx('explosion', x, y);
  w.addHistory('disaster', `Éruption volcanique${nearestName(w, x, y)} !`, 2, x, y);
  w.unlock('disaster:volcano');
}

export function earthquake(w: World, x: number, y: number, r = 12): void {
  const m = w.map;
  w.fx('quake', x, y, r);
  w.sfx('quake', x, y);
  const dead = damageArea(w, x, y, r, 0.15, 'séisme');
  // fissure
  let fx = x, fy = y;
  const ang = w.rng.range(0, Math.PI * 2);
  for (let k = 0; k < r * 1.5; k++) {
    fx += Math.cos(ang) + w.rng.range(-0.6, 0.6);
    fy += Math.sin(ang) + w.rng.range(-0.6, 0.6);
    if (!m.inside(fx | 0, fy | 0)) break;
    const i = m.idx(fx | 0, fy | 0);
    if (!m.isWater(i)) { m.setBiome(i, B.BARREN); m.timer[i] = 300; m.road[i] = 0; }
  }
  m.terrainVer++;
  w.unlock('disaster:earthquake');
  w.addHistory('disaster', `Séisme${nearestName(w, x, y)} (${dead} victimes).`, dead > 30 ? 2 : 1, x, y);
}

export function tsunami(w: World, x: number, y: number): void {
  addDisaster(w, 'tsunami', x, y, 1, 60, 1);
  w.fx('tsunami', x, y, 30);
  w.sfx('wave', x, y);
  w.unlock('disaster:tsunami');
  w.addHistory('disaster', `Un tsunami déferle sur les côtes${nearestName(w, x, y)}.`, 2, x, y);
}

export function tornado(w: World, x: number, y: number): void {
  addDisaster(w, 'tornado', x, y, 2.2, 160, 1);
  w.unlock('disaster:tornado');
  w.addHistory('disaster', `Une tornade se forme${nearestName(w, x, y)}.`, 1, x, y);
}

export function famine(w: World, x: number, y: number, r = 30): void {
  let n = 0;
  for (const s of w.settlements.values()) {
    if ((s.x - x) ** 2 + (s.y - y) ** 2 < r * r) { s.famine = 8; n++; }
  }
  w.unlock('disaster:famine');
  if (n) w.addHistory('disaster', `Grande famine : ${n} localité(s) voient leurs récoltes s’effondrer.`, 2, x, y);
}

export function startEpidemic(w: World, x: number, y: number, name?: string): Epidemic | undefined {
  let best, bd = Infinity;
  for (const s of w.settlements.values()) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || w.epidemics.some((x) => x.active)) return undefined;
  const e: Epidemic = {
    id: w.id(), name: name ?? w.rng.pick(['Peste', 'Fièvre', 'Variole', 'Grippe', 'Mal'] as const) + ' ' + w.rng.pick(['noire', 'grise', 'des marais', 'rouge', 'du désert', 'des ports']),
    virulence: w.rng.range(0.25, 0.6), lethality: w.rng.range(0.15, 0.5), start: w.tick, deaths: 0, active: true,
  };
  w.epidemics.push(e);
  best.infected = Math.max(best.infected, 0.1);
  if (w.epidemics.length > 50) w.epidemics.splice(0, w.epidemics.length - 50);
  w.unlock('disaster:epidemic');
  w.addHistory('disaster', `Une épidémie (${e.name}) éclate à ${best.name}.`, 2, best.x, best.y);
  return e;
}

/** Monthly epidemic spread through trade routes and proximity; immunity makes outbreaks burn out. */
export function updateEpidemics(w: World): void {
  const active = w.epidemics.find((e) => e.active);
  let any = false;
  for (const s of w.settlements.values()) {
    if (s.infected <= 0) { s.immune = Math.max(0, s.immune - 0.01); continue; }
    if (!active) { s.infected = Math.max(0, s.infected - 0.2); continue; }
    any = true;
    const k = w.kingdoms.get(s.kingdom);
    const resist = techFx(k).health + (s.jobs.doctor ?? 0) * 0.03 + s.health / 300;
    const growth = active.virulence * 0.6 * s.infected * Math.max(0, 1 - s.infected - s.immune);
    const recovery = s.infected * (0.25 + resist * 0.3);
    s.immune = clamp(s.immune + recovery * 0.8, 0, 0.95);
    s.infected = clamp(s.infected + growth - recovery, 0, 0.9);
    const deaths = s.extraPop * s.infected * active.lethality * 0.05;
    s.extraPop = Math.max(0, s.extraPop - deaths);
    active.deaths += deaths;
    for (const pid of s.residents) {
      const p = w.persons.get(pid);
      if (p && w.rng.chance(s.infected * 0.25)) {
        p.sick = Math.min(2, p.sick + active.lethality);
        if (w.rng.chance(active.lethality * 0.15)) { killPerson(w, p, 'maladie'); active.deaths++; }
      }
    }
    if (s.infected > 0.08) {
      for (const r of w.routes.values()) {
        const other = r.a === s.id ? r.b : r.b === s.id ? r.a : -1;
        const o = w.settlements.get(other);
        if (o && o.infected === 0 && o.immune < 0.5 && w.rng.chance(active.virulence * 0.4)) o.infected = 0.05;
      }
      for (const o of w.settlements.values()) {
        if (o.infected === 0 && o.immune < 0.5 && (o.x - s.x) ** 2 + (o.y - s.y) ** 2 < 400 && w.rng.chance(active.virulence * 0.15)) o.infected = 0.05;
      }
    }
    if (s.infected < 0.01) s.infected = 0;
  }
  if (active && !any) {
    active.active = false;
    w.addHistory('disaster', `L’épidémie (${active.name}) prend fin après ${Math.round(active.deaths)} morts.`, 2);
  }
}

/** Per-tick dynamic hazards: fire, lava, tornadoes, tsunamis, black holes, rifts. */
export function updateDisasters(w: World): void {
  const m = w.map;
  // ---- fire spread (every other tick)
  if (w.tick % 2 === 0 && w.fires.size) {
    for (const i of [...w.fires]) {
      let f = m.fire[i];
      if (f <= 0) { w.fires.delete(i); continue; }
      m.veg[i] = Math.max(0, m.veg[i] - 25);
      const bid = m.bld[i];
      if (bid >= 0) {
        const b = w.buildings.get(bid);
        if (b) { b.hp -= 12; if (b.hp <= 0) removeBuilding(w, bid); }
      }
      const fuel = m.veg[i] + (bid >= 0 ? 80 : 0);
      f = fuel > 0 ? f - 4 : f - 15;
      const x = i % m.w;
      const drought = w.drought[m.chunkOf(i)];
      for (const n of [i - 1, i + 1, i - m.w, i + m.w]) {
        if (n < 0 || n >= m.size || Math.abs((n % m.w) - x) > 1 || m.fire[n] > 0) continue;
        const nf = m.veg[n] + (m.bld[n] >= 0 ? 90 : 0);
        if (nf > 50 && w.rng.chance((nf / 255) * (0.18 + drought * 0.3))) ignite(w, n, 50);
      }
      if (f <= 0) {
        m.fire[i] = 0;
        w.fires.delete(i);
        const b = m.biome[i];
        if (b === B.FOREST || b === B.JUNGLE || b === B.TAIGA || b === B.PLAINS || b === B.SAVANNA) {
          m.setBiome(i, B.ASH);
          m.timer[i] = 60 + w.rng.int(0, 120);
          m.fert[i] = Math.min(255, m.fert[i] + 30);
        }
      } else m.fire[i] = f;
      if ((w.tick + i) % 20 === 0) m.dirty(i);
    }
    // people caught in fire
    for (const i of w.fires) {
      w.spatialPersons.query((i % m.w) + 0.5, ((i / m.w) | 0) + 0.5, 0.75, (p) => {
        if (w.rng.chance(0.1)) killPerson(w, p, 'catastrophe');
      });
    }
  }
  // ---- lava flows
  if (w.tick % 3 === 0 && w.lava.size) {
    for (const [i, heat] of [...w.lava]) {
      if (heat <= 0) {
        w.lava.delete(i);
        m.setBiome(i, B.BARREN);
        m.timer[i] = 1500;
        m.fert[i] = 200;
        m.terrainVer++;
        continue;
      }
      w.lava.set(i, heat - 3);
      if (heat > 40) {
        const x = i % m.w;
        let low = -1, lh = m.height[i] + 0.01;
        for (const n of [i - 1, i + 1, i - m.w, i + m.w, i - m.w - 1, i - m.w + 1, i + m.w - 1, i + m.w + 1]) {
          if (n < 0 || n >= m.size || Math.abs((n % m.w) - x) > 1 || w.lava.has(n)) continue;
          if (m.height[n] < lh && !(m.isWater(n) && m.biome[n] !== B.RIVER && w.rng.chance(0.7))) { lh = m.height[n]; low = n; }
        }
        if (low >= 0 && w.rng.chance(0.6)) spawnLava(w, low, heat - 15);
      }
    }
  }
  // ---- moving / expanding disasters
  for (let k = w.disasters.length - 1; k >= 0; k--) {
    const d = w.disasters[k];
    d.life--;
    switch (d.type) {
      case 'eruption':
        if (w.tick % 3 === 0) {
          const i = m.idx(d.x | 0, d.y | 0);
          for (const n of [i - 1, i + 1, i - m.w, i + m.w]) if (n >= 0 && n < m.size && !w.lava.has(n)) spawnLava(w, n, 200);
          if (w.rng.chance(0.3)) w.fx('eruption', d.x, d.y, 3);
        }
        break;
      case 'tornado': {
        d.x += d.vx + w.rng.range(-0.15, 0.15);
        d.y += d.vy + w.rng.range(-0.15, 0.15);
        if (w.rng.chance(0.03)) { const a = w.rng.range(0, Math.PI * 2); d.vx = Math.cos(a) * 0.25; d.vy = Math.sin(a) * 0.25; }
        if (!m.inside(d.x | 0, d.y | 0)) { d.life = 0; break; }
        if (w.tick % 2 === 0) {
          damageArea(w, d.x, d.y, d.r, 0.06, 'tornade');
          m.disc(d.x, d.y, d.r, (i) => { if (m.veg[i] > 30) { m.veg[i] = 10; m.dirty(i); } });
          w.spatialAnimals.query(d.x, d.y, d.r + 1, (a) => { a.x += w.rng.range(-3, 3); a.y += w.rng.range(-3, 3); a.x = clamp(a.x, 0, m.w - 1); a.y = clamp(a.y, 0, m.h - 1); });
        }
        break;
      }
      case 'tsunami': {
        d.r += 0.7;
        if (w.tick % 2 === 0) {
          m.disc(d.x, d.y, d.r, (i, _x, _y, dist) => {
            if (dist < d.r - 1.2 || m.isWater(i)) return;
            if (m.height[i] > SEA_LEVEL + 0.06) return;
            const bid = m.bld[i];
            if (bid >= 0) removeBuilding(w, bid);
            m.veg[i] = Math.floor(m.veg[i] * 0.3);
            if (m.biome[i] === B.BEACH && w.rng.chance(0.3)) m.setBiome(i, B.SHALLOW);
            m.dirty(i);
          });
          w.spatialPersons.query(d.x, d.y, d.r, (p) => {
            const i = m.idx(p.x | 0, p.y | 0);
            if (m.height[i] < SEA_LEVEL + 0.06 && Math.hypot(p.x - d.x, p.y - d.y) > d.r - 2 && w.rng.chance(0.5)) killPerson(w, p, 'catastrophe');
          });
          for (const s of w.settlements.values()) {
            const dist = Math.hypot(s.x - d.x, s.y - d.y);
            if (Math.abs(dist - d.r) < 1 && m.height[m.idx(s.x, s.y)] < SEA_LEVEL + 0.06) s.extraPop *= 0.7;
          }
        }
        if (d.r > 40) d.life = 0;
        break;
      }
      case 'blackhole': {
        d.r = Math.min(14, d.r + 0.05);
        const pull = (o: { x: number; y: number }) => {
          const dx = d.x - o.x, dy = d.y - o.y, dist = Math.hypot(dx, dy) || 1;
          o.x += (dx / dist) * Math.min(dist, 0.6);
          o.y += (dy / dist) * Math.min(dist, 0.6);
          return dist < 1.2;
        };
        w.spatialPersons.query(d.x, d.y, d.r * 1.8, (p) => { if (pull(p)) killPerson(w, p, 'divin'); });
        w.spatialAnimals.query(d.x, d.y, d.r * 1.8, (a) => { if (pull(a)) a.hp = 0; });
        if (w.tick % 4 === 0) {
          m.disc(d.x, d.y, d.r * 0.5, (i) => {
            if (m.bld[i] >= 0) removeBuilding(w, m.bld[i]);
            if (m.biome[i] !== B.DEEP_OCEAN) { m.height[i] = Math.max(0.05, m.height[i] - 0.02); m.setBiome(i, m.height[i] < SEA_LEVEL ? B.DEEP_OCEAN : B.BARREN); m.veg[i] = 0; }
          });
          damageArea(w, d.x, d.y, d.r * 0.6, 0.3, 'divin');
          m.terrainVer++;
        }
        if (d.life <= 0) w.fx('flash', d.x, d.y, 20);
        break;
      }
      case 'rift': {
        if (w.tick % 25 === 0 && w.animals.size < w.caps.animals * 1.2) {
          w.bus.emit('fx', { kind: 'rift', x: d.x, y: d.y, r: 3 });
          const ang = w.rng.range(0, Math.PI * 2);
          spawnCreature(w, 'demon', d.x + Math.cos(ang) * 2, d.y + Math.sin(ang) * 2);
        }
        if (w.tick % 10 === 0) m.disc(d.x, d.y, Math.min(9, 2 + (300 - d.life) / 30), (i) => { if (!m.isWater(i) && m.biome[i] !== B.CORRUPT) { m.setBiome(i, B.CORRUPT); m.timer[i] = 2000; } });
        break;
      }
      case 'meteorshower':
        if (w.tick % 8 === 0) meteor(w, d.x + w.rng.range(-d.r, d.r), d.y + w.rng.range(-d.r, d.r), w.rng.range(2, 4), true);
        break;
      case 'ufo':
        d.x += d.vx * 0.5; d.y += d.vy * 0.5;
        if (!m.inside(d.x | 0, d.y | 0)) { d.vx = -d.vx; d.vy = -d.vy; d.x = clamp(d.x, 1, m.w - 2); d.y = clamp(d.y, 1, m.h - 2); }
        if (w.tick % 30 === 0) spawnCreature(w, 'alien', d.x, d.y);
        if (w.tick % 6 === 0) { w.fx('laser', d.x, d.y, 3); damageArea(w, d.x, d.y, 2.5, 0.2, 'invasion'); }
        break;
    }
    if (d.life <= 0) w.disasters.splice(k, 1);
  }
}

export function spawnLava(w: World, i: number, heat: number): void {
  const m = w.map;
  if (i < 0 || i >= m.size) return;
  if (m.isWater(i) && m.biome[i] !== B.RIVER) {
    // lava meeting the sea builds new land
    m.height[i] = Math.max(m.height[i], SEA_LEVEL + 0.01);
    m.setBiome(i, B.BARREN);
    m.timer[i] = 2000;
    m.terrainVer++;
    w.fx('steam', (i % m.w) + 0.5, ((i / m.w) | 0) + 0.5);
    return;
  }
  if (m.bld[i] >= 0) removeBuilding(w, m.bld[i]);
  m.setBiome(i, B.LAVA);
  m.veg[i] = 0;
  w.lava.set(i, heat);
  m.terrainVer++;
  const x = i % m.w;
  for (const n of [i - 1, i + 1, i - m.w, i + m.w]) if (n >= 0 && n < m.size && Math.abs((n % m.w) - x) <= 1 && m.veg[n] > 30) ignite(w, n, 50);
  w.spatialPersons.query(x + 0.5, ((i / m.w) | 0) + 0.5, 1, (p) => { killPerson(w, p, 'catastrophe'); });
}

function spawnCreature(w: World, sp: string, x: number, y: number): void {
  spawnAnimal(w, sp, x, y, 1);
}

export function startDisaster(w: World, type: string, x: number, y: number, r: number, life: number): Disaster {
  return addDisaster(w, type, x, y, r, life);
}

/** Natural disaster director (monthly). */
export function randomDisasters(w: World): void {
  const mult = w.opts.mode === 'apocalypse' ? 6 + w.year / 40 : w.opts.mode === 'chaos' ? 3 : w.opts.mode === 'sandbox' || w.opts.mode === 'editor' ? 0.6 : 1;
  if (!w.rng.chance(0.012 * mult)) return;
  const m = w.map;
  const type = w.rng.weighted(['meteor', 'volcano', 'earthquake', 'tsunami', 'fire', 'tornado', 'hurricane', 'famine', 'epidemic', 'drought'], (t) =>
    t === 'meteor' ? 0.4 : t === 'fire' || t === 'drought' || t === 'famine' ? 2 : t === 'epidemic' ? (w.epidemics.some((e) => e.active) ? 0 : 1.2) : 1)!;
  const x = w.rng.int(5, m.w - 6), y = w.rng.int(5, m.h - 6);
  const i = m.idx(x, y);
  switch (type) {
    case 'meteor': meteor(w, x, y, w.rng.range(3, 6)); break;
    case 'volcano': {
      let v = -1;
      for (let t = 0; t < 3000 && v < 0; t++) { const j = w.rng.int(0, m.size - 1); if (m.biome[j] === B.VOLCANO) v = j; }
      if (v >= 0) eruption(w, v % m.w, (v / m.w) | 0);
      break;
    }
    case 'earthquake': if (!m.isWater(i)) earthquake(w, x, y); break;
    case 'tsunami': if (m.isWater(i)) tsunami(w, x, y); break;
    case 'fire':
      if (m.veg[i] > 80) { ignite(w, i, 80); w.addHistory('disaster', `Un grand incendie se déclare${nearestName(w, x, y)}.`, 1, x, y); }
      break;
    case 'tornado': if (!m.isWater(i)) tornado(w, x, y); break;
    case 'hurricane':
      if (m.isWater(i)) {
        w.weather.push({ id: w.id(), type: 'hurricane', x, y, r: 14, vx: w.rng.range(-0.15, 0.15), vy: w.rng.range(-0.15, 0.15), life: 300, power: 1 });
        w.addHistory('disaster', 'Un ouragan se forme sur l’océan.', 1, x, y);
        w.unlock('disaster:hurricane');
      }
      break;
    case 'famine': famine(w, x, y); break;
    case 'epidemic': startEpidemic(w, x, y); break;
    case 'drought': {
      const c = w.drought[m.chunkOf(i)];
      if (c < 0.3) startDrought(w, x, y, 0.6);
      break;
    }
  }
}
