import { SPECIES, speciesById } from '../data/species';
import { generateMap } from '../world/generator';
import { populateAnimals } from './ecosystem';
import { Kingdom } from './entities';
import { createKingdom, setRuler } from './kingdom';
import { createPerson, newDynasty, setResidence } from './person';
import { findSettlementSite, foundSettlement, placeBuilding } from './settlement';
import { World, WorldOptions } from './world';

export interface Quality {
  persons: number;
  perSettlement: number;
  animals: number;
}
export const QUALITY_CAPS: Record<string, Quality> = {
  low: { persons: 2500, perSettlement: 35, animals: 800 },
  medium: { persons: 4500, perSettlement: 55, animals: 1400 },
  high: { persons: 7000, perSettlement: 80, animals: 2200 },
  ultra: { persons: 11000, perSettlement: 120, animals: 3200 },
};

export function applyCaps(w: World, q: Quality): void {
  const scale = w.map.size / (288 * 288);
  w.caps = {
    persons: Math.round(q.persons * Math.min(1.6, Math.max(0.6, scale))),
    perSettlement: q.perSettlement,
    animals: Math.round(q.animals * Math.min(1.8, Math.max(0.5, scale))),
  };
}

export function createWorld(opts: WorldOptions, quality: Quality = QUALITY_CAPS.medium): World {
  const map = generateMap({ seed: opts.seed, size: opts.size, shape: opts.shape, climate: opts.climate, moisture: opts.moisture });
  const w = new World(opts, map);
  applyCaps(w, quality);
  w.addHistory('world', `Création du monde « ${opts.name} » (graine ${opts.seed}).`, 3);
  const species = opts.species.length ? opts.species : SPECIES.map((s) => s.id);
  const placed: [number, number][] = [];
  for (let c = 0; c < opts.civs; c++) {
    const sp = species[c % species.length];
    const site = pickStart(w, sp, placed);
    if (site < 0) continue;
    const x = site % map.w, y = (site / map.w) | 0;
    placed.push([x, y]);
    const k = spawnTribe(w, x, y, sp);
    if (opts.mode === 'evolution' && k) k.techs = [];
  }
  populateAnimals(w, Math.round(w.caps.animals * 0.55 * opts.animals));
  return w;
}

function pickStart(w: World, sp: string, placed: [number, number][]): number {
  const m = w.map;
  let best = -1, bs = -Infinity;
  const minD = m.w / Math.max(2.2, Math.sqrt(w.opts.civs + 1) * 1.1);
  for (let t = 0; t < 400; t++) {
    const x = w.rng.int(8, m.w - 9), y = w.rng.int(8, m.h - 9);
    const i = m.idx(x, y);
    if (!m.buildable(i) || m.owner[i] >= 0) continue;
    let dmin = Infinity;
    for (const [px, py] of placed) dmin = Math.min(dmin, Math.hypot(px - x, py - y));
    let score = (speciesById(sp).likes.includes(m.biome[i]) ? 3 : 0) + m.fert[i] / 60 - m.waterDist[i] * 0.5;
    if (dmin < minD) score -= (minD - dmin) * 0.6;
    if (score > bs) { bs = score; best = i; }
  }
  if (best >= 0) {
    // refine locally for a good settlement spot
    const ref = findSettlementSite(w, best % m.w, (best / m.w) | 0, 0, 4, sp, 30);
    if (ref >= 0) best = ref;
  }
  return best;
}

/** Spawn a new tribe (kingdom + camp + founding families). Used at world creation and by the "create humans" power. */
export function spawnTribe(w: World, x: number, y: number, sp: string, size = 12): Kingdom | undefined {
  const m = w.map;
  if (!m.inside(x, y)) return undefined;
  const i = m.idx(x, y);
  if (!m.buildable(i) || m.owner[i] >= 0) return undefined;
  const k = createKingdom(w, sp);
  const founders = [];
  const lifeScale = speciesById(sp).life / 70;
  for (let n = 0; n < size; n++) {
    const p = createPerson(w, {
      x: x + 0.5 + w.rng.range(-1.5, 1.5), y: y + 0.5 + w.rng.range(-1.5, 1.5), species: sp, kingdom: k.id,
      culture: k.culture, religion: k.religion, ageYears: w.rng.range(16, 34) * lifeScale, female: n % 2 === 1,
      dynasty: n < 2 ? undefined : founders[n % 2]?.dynasty,
    });
    founders.push(p);
  }
  // couples
  for (let n = 0; n + 1 < founders.length; n += 2) {
    founders[n].partner = founders[n + 1].id;
    founders[n + 1].partner = founders[n].id;
    founders[n + 1].dynasty = founders[n].dynasty;
  }
  const s = foundSettlement(w, k.id, x, y, [], k.name);
  for (const p of founders) setResidence(w, p, s.id);
  placeBuilding(w, s, 'house', undefined, true);
  placeBuilding(w, s, 'house', undefined, true);
  s.stock.food = 120;
  s.stock.wood = 40;
  s.extraPop = size * 0.5;
  if (!founders[0].dynasty) founders[0].dynasty = newDynasty(w, founders[0], 'Ancêtres');
  setRuler(w, k, founders[0], 'fondation');
  w.addHistory('found', `Les ${speciesById(sp).plural} fondent la tribu de ${k.name}.`, 2, x, y);
  return k;
}
