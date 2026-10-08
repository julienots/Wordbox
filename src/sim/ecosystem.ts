import { clamp } from '../core/math';
import { AnimalDef, ANIMALS, animalById } from '../data/animals';
import { B, BIOMES } from '../data/biomes';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, seasonOf } from '../data/time';
import { classify, effTemp } from '../world/classify';
import { Animal, PS } from './entities';
import { ignite } from './disasters';
import { killPerson } from './person';
import type { World } from './world';

/** Population share of the global animal cap per species. */
const SHARE: Record<string, number> = { rabbit: 0.26, deer: 0.13, bison: 0.09, wolf: 0.06, bear: 0.035, fish: 0.22, shark: 0.025, bird: 0.12, dragon: 0.004, griffin: 0.006, serpent: 0.004, demon: 0.05, alien: 0.05 };
const SEASON_GROWTH = [1.2, 1, 0.7, 0.1];
const LOD_INTERVAL = [1, 3, 12];

export function habitatOk(w: World, def: AnimalDef, x: number, y: number): boolean {
  const m = w.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
  const i = m.idx(x | 0, y | 0);
  const b = m.biome[i];
  if (def.habitat === 'air') return true;
  if (def.habitat === 'water') return BIOMES[b].water;
  return BIOMES[b].walk && b !== B.RIVER || m.road[i] > 0;
}

export function spawnAnimal(w: World, sp: string, x: number, y: number, ageYears = 1): Animal | undefined {
  const def = animalById.get(sp);
  if (!def || !habitatOk(w, def, x, y)) return undefined;
  const a = new Animal();
  a.id = w.id();
  a.sp = sp;
  a.x = a.px = a.tx = x;
  a.y = a.py = a.ty = y;
  a.birth = w.tick - Math.round(ageYears * DAYS_PER_YEAR);
  a.hp = def.hp;
  a.hunger = 80;
  a.lastUpd = w.tick;
  w.animals.set(a.id, a);
  w.unlock('animal:' + sp);
  return a;
}

export function removeAnimal(w: World, a: Animal, decompose = true): void {
  if (!w.animals.delete(a.id)) return;
  if (decompose) {
    const i = w.map.idx(clamp(a.x | 0, 0, w.map.w - 1), clamp(a.y | 0, 0, w.map.h - 1));
    w.map.fert[i] = Math.min(255, w.map.fert[i] + 12);
  }
}

/** Initial fauna by biome suitability. */
export function populateAnimals(w: World, count: number): void {
  const m = w.map;
  const pick: Record<number, string[]> = {
    [B.PLAINS]: ['rabbit', 'rabbit', 'bison', 'deer', 'wolf', 'bird'],
    [B.FOREST]: ['deer', 'deer', 'rabbit', 'wolf', 'bear', 'bird'],
    [B.TAIGA]: ['deer', 'wolf', 'bear', 'rabbit'],
    [B.JUNGLE]: ['bird', 'deer', 'bear'],
    [B.SAVANNA]: ['bison', 'bison', 'rabbit', 'wolf'],
    [B.TUNDRA]: ['deer', 'wolf', 'rabbit'],
    [B.HILLS]: ['deer', 'rabbit', 'bird'],
    [B.SHALLOW]: ['fish', 'fish', 'fish', 'shark'],
    [B.OCEAN]: ['fish', 'shark'],
    [B.LAKE]: ['fish'],
    [B.SWAMP]: ['bird', 'rabbit'],
  };
  for (let n = 0, tries = 0; n < count && tries < count * 20; tries++) {
    const i = w.rng.int(0, m.size - 1);
    const list = pick[m.biome[i]];
    if (!list) continue;
    if (spawnAnimal(w, w.rng.pick(list), (i % m.w) + 0.5, ((i / m.w) | 0) + 0.5, w.rng.range(0, 3))) n++;
  }
  // a few legendary creatures
  for (const [sp, n, biomes] of [['dragon', 1, [B.MOUNTAIN, B.VOLCANO, B.BARREN]], ['griffin', 2, [B.MOUNTAIN, B.HILLS]], ['serpent', 1, [B.DEEP_OCEAN]]] as [string, number, number[]][]) {
    for (let k = 0, tries = 0; k < n && tries < 5000; tries++) {
      const i = w.rng.int(0, m.size - 1);
      if (!biomes.includes(m.biome[i])) continue;
      if (spawnAnimal(w, sp, (i % m.w) + 0.5, ((i / m.w) | 0) + 0.5, 50)) k++;
    }
  }
}

/** Per-tick animal behaviour: grazing, hunting, fleeing, migration. */
export function updateAnimals(w: World): void {
  const m = w.map;
  for (const a of w.animals.values()) {
    const def = animalById.get(a.sp);
    if (!def) { w.animals.delete(a.id); continue; }
    const lod = w.lod(a.x, a.y);
    const iv = LOD_INTERVAL[lod];
    if ((w.tick + a.id) % iv !== 0) { if (lod === 0) { a.px = a.x; a.py = a.y; } continue; }
    const dt = Math.min(24, w.tick - a.lastUpd) || 1;
    a.lastUpd = w.tick;
    a.px = a.x; a.py = a.y;
    a.hunger -= (def.diet === 'carn' ? 0.45 : 0.3) * dt * (def.fantastic ? 0.2 : 1);
    if (a.hp <= 0 || a.hunger <= 0) { removeAnimal(w, a); continue; }
    const i = m.idx(clamp(a.x | 0, 0, m.w - 1), clamp(a.y | 0, 0, m.h - 1));

    if (def.diet !== 'carn' && def.habitat !== 'water') {
      if (m.veg[i] > 25 && a.hunger < 85) {
        const bite = Math.min(m.veg[i], Math.ceil(def.size * 8));
        m.veg[i] -= bite;
        a.hunger += bite * 1.5 * dt;
      }
    } else if (def.habitat === 'water' && def.diet === 'herb') {
      a.hunger += 1.5 * dt; // plankton
    }
    // predators
    if (def.prey.length && a.hunger < 65) {
      const prey = w.spatialAnimals.nearest(a.x, a.y, 9, (o) => o.id !== a.id && def.prey.includes(o.sp));
      if (prey) {
        a.tx = prey.x; a.ty = prey.y;
        if ((prey.x - a.x) ** 2 + (prey.y - a.y) ** 2 < 0.8) {
          prey.hp -= def.atk;
          if (prey.hp <= 0) {
            const pd = animalById.get(prey.sp);
            a.hunger = Math.min(100, a.hunger + (pd?.food ?? 5) * 3);
            removeAnimal(w, prey, false);
          }
        }
      }
    }
    // hostile creatures attack people & set fires
    if (def.hostile && lod < 2 && (w.tick + a.id) % 3 === 0) {
      const victim = w.spatialPersons.nearest(a.x, a.y, def.fantastic ? 6 : 2.5, (p) => p.state !== PS.ARMY && (a.faction < 0 || p.kingdom !== a.faction));
      if (victim && (def.fantastic || a.hunger < 40)) {
        a.tx = victim.x; a.ty = victim.y;
        if ((victim.x - a.x) ** 2 + (victim.y - a.y) ** 2 < 1.5) {
          victim.health -= def.atk * 3;
          if (victim.health <= 0) { killPerson(w, victim, 'créature'); a.hunger = Math.min(100, a.hunger + 20); }
          else a.hp -= 1 + victim.genome.str * 2;
        }
      }
      if (a.sp === 'dragon' && w.rng.chance(0.02)) {
        const fi = m.idx(clamp(a.tx | 0, 0, m.w - 1), clamp(a.ty | 0, 0, m.h - 1));
        if (m.veg[fi] > 20 || m.bld[fi] >= 0) ignite(w, fi, 60);
        if (lod === 0) w.fx('fire', a.tx, a.ty);
      }
      // creatures raid settlements: aggregate casualties
      if (def.fantastic && m.owner[i] >= 0 && w.rng.chance(0.1)) {
        const s = w.settlements.get(m.owner[i]);
        if (s) {
          const defense = (s.jobs.soldier ?? 0) + (s.jobs.hunter ?? 0) * 0.5;
          a.hp -= defense * 0.5;
          s.extraPop = Math.max(0, s.extraPop - def.atk * 0.05);
        }
      }
    }
    // fleeing herbivores
    if (def.diet === 'herb' && lod < 2 && (w.tick + a.id) % 2 === 0) {
      const threat = w.spatialAnimals.nearest(a.x, a.y, 3.5, (o) => (animalById.get(o.sp)?.prey ?? []).includes(a.sp));
      if (threat) { a.tx = a.x + (a.x - threat.x) * 2; a.ty = a.y + (a.y - threat.y) * 2; }
    }
    // wander / migrate towards food
    const d2 = (a.tx - a.x) ** 2 + (a.ty - a.y) ** 2;
    if (d2 < 0.2) {
      const range = m.veg[i] < 30 && def.diet !== 'carn' ? 10 : 4;
      let bx = a.x, by = a.y, bv = -1;
      for (let t = 0; t < 3; t++) {
        const x = a.x + w.rng.range(-range, range), y = a.y + w.rng.range(-range, range);
        if (!habitatOk(w, def, x, y)) continue;
        const v = def.diet === 'carn' ? w.rng.next() : m.veg[m.idx(x | 0, y | 0)];
        if (v > bv) { bv = v; bx = x; by = y; }
      }
      a.tx = bx; a.ty = by;
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.05) {
      if (lod === 2) {
        if (habitatOk(w, def, a.tx, a.ty)) { a.x = a.tx; a.y = a.ty; }
      } else {
        const step = Math.min(d, def.speed * 0.3 * dt);
        const nx = a.x + (dx / d) * step, ny = a.y + (dy / d) * step;
        if (habitatOk(w, def, nx, ny)) { a.x = nx; a.y = ny; } else { a.tx = a.x; a.ty = a.y; }
      }
    }
  }
}

/** Monthly fauna demography (staggered), hunting pressure and extinctions. */
export function updateFauna(w: World): void {
  const counts = new Map<string, number>();
  for (const a of w.animals.values()) counts.set(a.sp, (counts.get(a.sp) ?? 0) + 1);
  const day = w.tick % DAYS_PER_MONTH;
  const born: Animal[] = [];
  for (const a of w.animals.values()) {
    if (a.id % DAYS_PER_MONTH !== day) continue;
    const def = animalById.get(a.sp)!;
    const age = (w.tick - a.birth) / DAYS_PER_YEAR;
    if (age > def.maxAge && w.rng.chance(0.3)) { a.hp = 0; continue; }
    const cap = Math.max(2, w.caps.animals * (SHARE[a.sp] ?? 0.01));
    const n = counts.get(a.sp) ?? 0;
    if (def.repro > 0 && a.hunger > 45 && age > Math.min(1, def.maxAge * 0.1) && n < cap && w.rng.chance(def.repro * (1 - n / cap))) {
      const b = spawnAnimal(w, a.sp, a.x + w.rng.range(-1, 1), a.y + w.rng.range(-1, 1), 0);
      if (b) { born.push(b); counts.set(a.sp, n + 1); a.hunger -= 20; }
    }
  }
  // hunting by settlements
  for (const s of w.settlements.values()) {
    if (s.id % DAYS_PER_MONTH !== day) continue;
    let quota = Math.floor((s.jobs.hunter ?? 0) * 0.3 + (s.jobs.fisher ?? 0) * 0.15);
    if (quota <= 0) continue;
    w.spatialAnimals.query(s.x, s.y, 12, (a) => {
      const def = animalById.get(a.sp);
      if (!def || def.fantastic || def.diet === 'carn' || quota <= 0) return;
      a.hp = 0;
      quota--;
      return quota <= 0;
    });
  }
  if (day === 0) {
    for (const def of ANIMALS) {
      if (def.fantastic) continue;
      const prev = w.questState['animal:' + def.id] ?? 0;
      const now = counts.get(def.id) ?? 0;
      if (prev > 0 && now === 0 && !w.extinctSpecies.includes(def.id)) {
        w.extinctSpecies.push(def.id);
        w.stats.extinctions++;
        w.addHistory('ecology', `Extinction : il n’existe plus aucun ${def.name.toLowerCase()} dans le monde.`, 2);
        w.unlock('event:extinction');
      }
      w.questState['animal:' + def.id] = now;
    }
  }
}

/** Rolling vegetation / soil update over a slice of the map each tick. */
export function updateVegetation(w: World): void {
  const m = w.map;
  const n = Math.ceil(m.size / 30);
  const season = SEASON_GROWTH[seasonOf(w.tick)];
  const offset = w.climate.tempOffset;
  for (let k = 0; k < n; k++) {
    const i = w.cursors.veg % m.size;
    w.cursors.veg = (i + 1) % m.size;
    const b = m.biome[i];
    const info = BIOMES[b];
    if (info.water) continue;
    // burnt land, ash and cooled lava slowly recover
    if (b === B.ASH || b === B.BARREN || b === B.CORRUPT) {
      if (m.timer[i] > 0) m.timer[i]--;
      else if (b === B.ASH || (b === B.BARREN && m.timer[i] === 0 && w.rng.chance(0.02))) {
        const nb = classify(m.height[i], effTemp(m.temp[i], m.height[i], offset), m.humid[i] + w.climate.humidOffset);
        if (nb !== B.MOUNTAIN && !BIOMES[nb].water) { m.setBiome(i, nb); m.fert[i] = Math.min(255, m.fert[i] + 40); }
      }
      if (b === B.CORRUPT) continue;
    }
    const drought = w.drought[m.chunkOf(i)];
    const max = info.veg * clamp(0.5 + m.humid[i] + w.climate.humidOffset - drought, 0.2, 1.2);
    const old = m.veg[i];
    let v = old;
    if (v < max) v = Math.min(max, v + (3 + m.fert[i] / 50) * season * (1 - drought));
    else if (v > max) v = Math.max(max, v - 2);
    // forest succession & deforestation
    if ((b === B.PLAINS || b === B.SAVANNA) && v >= info.veg * 0.95 && m.owner[i] < 0 && w.rng.chance(0.004)) {
      const x = i % m.w;
      const nb = [i - 1, i + 1, i - m.w, i + m.w].find((j) => j >= 0 && j < m.size && Math.abs((j % m.w) - x) <= 1 && (m.biome[j] === B.FOREST || m.biome[j] === B.JUNGLE));
      if (nb !== undefined) { m.setBiome(i, m.biome[nb]); v = 150; }
    } else if ((b === B.FOREST || b === B.JUNGLE || b === B.TAIGA) && v < 35) {
      m.setBiome(i, b === B.TAIGA ? B.TUNDRA : B.PLAINS);
      w.unlock('event:deforestation');
    }
    // soil fertility relaxes toward its natural level
    const base = info.fert * 255;
    if (m.fert[i] > base + 30) m.fert[i]--;
    else if (m.fert[i] < base) m.fert[i]++;
    m.veg[i] = v;
    if (old >> 5 !== (v | 0) >> 5) m.dirty(i);
  }
}
