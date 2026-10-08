import { clamp, finite } from '../core/math';
import { B, BIOMES } from '../data/biomes';
import { BuildingDef, BUILDINGS, buildingById, SETTLEMENT_LEVELS } from '../data/buildings';
import { profById } from '../data/professions';
import { D, DEPOSITS, RES, Res } from '../data/resources';
import { speciesById } from '../data/species';
import { seasonOf } from '../data/time';
import { Building, Kingdom, Person, PS, Settlement } from './entities';
import { ageOf, bio, createPerson, cultureLang, fx, intellect, setResidence } from './person';
import { knows, styleOfEra, techFx } from './tech';
import type { World } from './world';

const SEASON_FOOD = [1.0, 1.25, 1.15, 0.4];
const HOUSING_BY_STYLE = [1, 1.6, 3.5, 7, 12];

export function foundSettlement(w: World, kingdomId: number, x: number, y: number, founders: Person[], name?: string): Settlement {
  const k = w.kingdoms.get(kingdomId);
  const s = new Settlement();
  s.id = w.id();
  s.kingdom = kingdomId;
  s.x = x;
  s.y = y;
  s.founded = w.tick;
  s.culture = k?.culture ?? -1;
  s.religion = k?.religion ?? -1;
  s.name = name ?? cultureLang(w, s.culture).placeName(w.rng);
  w.settlements.set(s.id, s);
  if (k) {
    k.settlements.push(s.id);
    if (k.capital < 0) k.capital = s.id;
    k.conquests = Math.max(k.conquests, k.settlements.length);
  }
  for (const p of founders) setResidence(w, p, s.id);
  claimTerritory(w, s);
  w.stats.foundings++;
  w.unlock('settlement:' + s.id);
  return s;
}

export function radiusOf(w: World, s: Settlement): number {
  const k = w.kingdoms.get(s.kingdom);
  return SETTLEMENT_LEVELS[s.level].radius + (k ? Math.min(3, Math.floor(k.era / 4)) : 0) + (s.id === k?.capital ? 1 : 0);
}

/** Claim free land around the settlement (BFS bounded by radius). */
export function claimTerritory(w: World, s: Settlement): void {
  const m = w.map;
  const r = radiusOf(w, s);
  const r2 = r * r;
  const start = m.idx(s.x, s.y);
  const seen = new Set<number>([start]);
  const q = [start];
  let claimed = 0;
  while (q.length) {
    const i = q.pop()!;
    const x = i % m.w, y = (i / m.w) | 0;
    if ((x - s.x) ** 2 + (y - s.y) ** 2 > r2) continue;
    if (m.owner[i] < 0 || m.owner[i] === s.id) {
      if (m.owner[i] !== s.id) {
        m.owner[i] = s.id;
        m.dirtyOwner(i);
      }
      claimed++;
    } else continue;
    const water = m.isWater(i) && m.biome[i] !== B.RIVER;
    if (water && (x - s.x) ** 2 + (y - s.y) ** 2 > 4) continue; // only a thin coastal band
    for (const n of [i - 1, i + 1, i - m.w, i + m.w]) {
      if (n < 0 || n >= m.size || seen.has(n)) continue;
      if (Math.abs((n % m.w) - x) > 1) continue;
      seen.add(n);
      q.push(n);
    }
  }
  s.tiles = claimed;
}

export function releaseTerritory(w: World, s: Settlement): void {
  const m = w.map;
  const r = radiusOf(w, s) + 2;
  m.disc(s.x, s.y, r, (i) => {
    if (m.owner[i] === s.id) {
      m.owner[i] = -1;
      m.dirtyOwner(i);
    }
  });
  s.tiles = 0;
}

/** Change owner of a settlement (conquest, rebellion, annexation). */
export function transferSettlement(w: World, s: Settlement, toKingdom: number): void {
  const from = w.kingdoms.get(s.kingdom);
  const to = w.kingdoms.get(toKingdom);
  if (!to || s.kingdom === toKingdom) return;
  if (from) {
    from.settlements = from.settlements.filter((id) => id !== s.id);
    if (from.capital === s.id) from.capital = pickCapital(w, from);
  }
  s.kingdom = toKingdom;
  to.settlements.push(s.id);
  to.conquests = Math.max(to.conquests, to.settlements.length);
  if (to.capital < 0) to.capital = s.id;
  for (const pid of s.residents) {
    const p = w.persons.get(pid);
    if (p) p.kingdom = toKingdom;
  }
  w.map.disc(s.x, s.y, radiusOf(w, s) + 2, (i) => {
    if (w.map.owner[i] === s.id) w.map.dirtyOwner(i);
  });
}

export function pickCapital(w: World, k: Kingdom): number {
  let best = -1, bp = -1;
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid);
    if (s && s.pop > bp) { bp = s.pop; best = sid; }
  }
  return best;
}

export function destroySettlement(w: World, s: Settlement, reason: string): void {
  if (s.ruined) return;
  s.ruined = true;
  releaseTerritory(w, s);
  for (const bid of s.buildings) removeBuilding(w, bid);
  s.buildings = [];
  for (const pid of [...s.residents]) {
    const p = w.persons.get(pid);
    if (p) p.settlement = -1;
  }
  s.residents = [];
  s.extraPop = 0;
  const k = w.kingdoms.get(s.kingdom);
  if (k) {
    k.settlements = k.settlements.filter((id) => id !== s.id);
    if (k.capital === s.id) k.capital = pickCapital(w, k);
  }
  w.settlements.delete(s.id);
  for (const [id, r] of w.routes) if (r.a === s.id || r.b === s.id) w.routes.delete(id);
  w.addHistory('settlement', `${s.name} a été abandonnée (${reason}).`, s.level >= 2 ? 2 : 1, s.x, s.y);
}

export function removeBuilding(w: World, bid: number): void {
  const b = w.buildings.get(bid);
  if (!b) return;
  const i = w.map.idx(b.x, b.y);
  if (w.map.bld[i] === bid) w.map.bld[i] = -1;
  w.map.dirty(i);
  w.buildings.delete(bid);
  const s = w.settlements.get(b.settlement);
  if (s) s.buildings = s.buildings.filter((x) => x !== bid);
}

export function countBuildings(w: World, s: Settlement, type: string, includeSites = true): number {
  let n = 0;
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (b && b.type === type && (includeSites || b.progress >= 1)) n++;
  }
  return n;
}

/** One pass over a settlement's buildings: counts, job slots and site count. */
interface Tally { all: Record<string, number>; done: Record<string, number>; slots: Record<string, number>; sites: number }
function tally(w: World, s: Settlement): Tally {
  const t: Tally = { all: {}, done: {}, slots: {}, sites: 0 };
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (!b) continue;
    t.all[b.type] = (t.all[b.type] ?? 0) + 1;
    if (b.progress < 1) { t.sites++; continue; }
    t.done[b.type] = (t.done[b.type] ?? 0) + 1;
    const jobs = buildingById.get(b.type)?.jobs;
    if (jobs) for (const [prof, n] of Object.entries(jobs)) t.slots[prof] = (t.slots[prof] ?? 0) + n;
  }
  return t;
}

function housingOf(w: World, s: Settlement, k: Kingdom | undefined): number {
  const tf = techFx(k);
  let h = 12;
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (!b || b.progress < 1) continue;
    const d = buildingById.get(b.type);
    if (d?.housing) h += d.housing * HOUSING_BY_STYLE[styleOfEra(b.era)] * (1 + tf.housing);
  }
  return Math.round(h);
}

// ---------------------------------------------------------------- placement

function findSite(w: World, s: Settlement, def: BuildingDef): number {
  const m = w.map;
  const r = radiusOf(w, s);
  let best = -1, bestScore = -Infinity;
  const tries = 40;
  for (let t = 0; t < tries; t++) {
    let ang = w.rng.range(0, Math.PI * 2);
    let dist: number;
    switch (def.place) {
      case 'center': dist = w.rng.range(0, Math.max(1.5, r * 0.35)); break;
      case 'edge': dist = w.rng.range(r * 0.5, r * 0.9); break;
      case 'fertile': dist = w.rng.range(r * 0.35, r); break;
      default: dist = w.rng.range(0.8, r * 0.8);
    }
    if (def.id === 'house') dist = w.rng.range(0.8, Math.max(2, r * (0.3 + Math.min(0.5, s.pop / 400))));
    const x = Math.round(s.x + Math.cos(ang) * dist), y = Math.round(s.y + Math.sin(ang) * dist);
    if (!m.inside(x, y)) continue;
    const i = m.idx(x, y);
    if (m.owner[i] !== s.id || !m.buildable(i) || (x === s.x && y === s.y)) continue;
    let score = -dist * 0.3 + w.rng.next();
    if (def.place === 'fertile') score += m.fert[i] / 40;
    if (def.place === 'forest') {
      let forest = 0;
      m.disc(x, y, 2.5, (j) => { if (m.veg[j] > 120) forest++; });
      if (forest < 3) continue;
      score += forest;
    }
    if (def.place === 'deposit') {
      const dp = m.deposit[i];
      if (dp === D.NONE || dp === D.FISH || dp === D.FERTILE) continue;
      if (dp === D.OIL && !knows(w.kingdoms.get(s.kingdom), 'combustion')) continue;
      if (dp === D.RARE && !knows(w.kingdoms.get(s.kingdom), 'iron')) continue;
      score += 5 + (dp === D.GOLD ? 3 : dp === D.IRON ? 2 : 0);
    }
    if (def.place === 'coast' && !m.isCoastalLand(i)) continue;
    if (m.road[i] > 0) score -= 2;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  // deposits are rare: scan the territory for a free deposit tile if sampling missed
  if (best < 0 && def.place === 'deposit') {
    m.disc(s.x, s.y, r, (i) => {
      if (best >= 0 || m.owner[i] !== s.id || !m.buildable(i)) return;
      const dp = m.deposit[i];
      if (dp !== D.NONE && dp !== D.FISH && dp !== D.FERTILE && dp !== D.OIL) best = i;
    });
  }
  // mines can sit on mountains (not normally buildable)
  if (best < 0 && def.place === 'deposit') {
    m.disc(s.x, s.y, r, (i) => {
      if (best >= 0 || m.owner[i] !== s.id || m.bld[i] >= 0) return;
      const dp = m.deposit[i];
      if ((m.biome[i] === B.MOUNTAIN || m.biome[i] === B.HILLS) && dp !== D.NONE && dp !== D.OIL) best = i;
    });
  }
  return best;
}

export function placeBuilding(w: World, s: Settlement, type: string, at?: number, instant = false): Building | null {
  const def = buildingById.get(type);
  if (!def) return null;
  const i = at ?? findSite(w, s, def);
  if (i < 0) return null;
  const k = w.kingdoms.get(s.kingdom);
  const b = new Building();
  b.id = w.id();
  b.type = type;
  b.x = i % w.map.w;
  b.y = (i / w.map.w) | 0;
  b.settlement = s.id;
  b.era = k?.era ?? 0;
  b.progress = instant ? 1 : 0;
  w.buildings.set(b.id, b);
  w.map.bld[i] = b.id;
  w.map.veg[i] = Math.min(w.map.veg[i], 20);
  w.map.dirty(i);
  s.buildings.push(b.id);
  layRoad(w, s, b.x, b.y);
  return b;
}

/** Straight-ish road from a building to the settlement centre. */
export function layRoad(w: World, s: Settlement, x: number, y: number): void {
  const m = w.map;
  const k = w.kingdoms.get(s.kingdom);
  const lvl = !k || k.era < 4 ? 1 : k.era < 8 ? 2 : 3;
  let cx = x, cy = y;
  for (let step = 0; step < 40 && (cx !== s.x || cy !== s.y); step++) {
    const dx = Math.sign(s.x - cx), dy = Math.sign(s.y - cy);
    if (Math.abs(s.x - cx) > Math.abs(s.y - cy)) cx += dx; else cy += dy;
    const i = m.idx(cx, cy);
    if (m.bld[i] >= 0) continue;
    const bi = BIOMES[m.biome[i]];
    if (bi.water && (m.biome[i] !== B.RIVER && m.biome[i] !== B.LAKE && m.biome[i] !== B.SHALLOW || !k || k.era < 3)) {
      if (m.biome[i] !== B.RIVER) return;
    }
    if (m.road[i] < lvl) {
      m.road[i] = lvl;
      m.dirty(i);
      if (bi.water) m.terrainVer++; // bridge changes walkability
    }
  }
}

// ---------------------------------------------------------------- economy

/** Assign professions according to needs: food first, then construction, defence, culture, industry. */
function allocateJobs(w: World, s: Settlement, k: Kingdom | undefined, adultsIndiv: Person[], t: Tally, forage: number): Record<string, number> {
  const pop = s.pop;
  const workforce = adultsIndiv.length + s.extraPop * 0.65;
  const jobs: Record<string, number> = {};
  let avail = workforce;
  const give = (prof: string, n: number) => {
    n = Math.max(0, Math.min(avail, Math.floor(n)));
    if (n <= 0) return;
    jobs[prof] = (jobs[prof] ?? 0) + n;
    avail -= n;
  };
  const slots = (prof: string) => t.slots[prof] ?? 0;
  const tf = techFx(k);
  const atWar = k ? k.armies.length > 0 : false;
  // leader & construction
  if (slots('leader')) give('leader', 1);
  const sites = t.sites > 0 || s.queue.length > 0;
  give('builder', sites ? Math.max(1, workforce * 0.08) : workforce * 0.02);
  // food
  const need = pop * 1.15 + (s.stock.food < pop ? pop * 0.3 : 0);
  const farmRate = 9 * (1 + tf.food);
  const farmers = Math.min(slots('farmer'), Math.ceil(need / farmRate));
  give('farmer', farmers);
  let remainingNeed = Math.max(0, need - farmers * farmRate);
  const fishers = Math.min(slots('fisher'), Math.ceil(remainingNeed / 6));
  give('fisher', fishers);
  remainingNeed = Math.max(0, remainingNeed - fishers * 6);
  if (remainingNeed > 0) {
    // wild food is limited by the territory's natural productivity
    give('hunter', Math.min(workforce * 0.15, remainingNeed / 10, forage * 0.3 / 5));
    give('gatherer', Math.min(remainingNeed, forage) / 5);
  }
  // military
  const milShare = (atWar ? 0.14 : 0.04) * (0.6 + (w.cultures.get(s.culture)?.values.martial ?? 0.5));
  give('soldier', Math.max(slots('soldier'), workforce * milShare));
  // building-provided jobs
  for (const prof of ['priest', 'scholar', 'merchant', 'smith', 'doctor', 'engineer', 'worker', 'miner', 'woodcutter']) {
    const pd = profById.get(prof);
    if (pd && !knows(k, pd.tech)) continue;
    give(prof, slots(prof));
  }
  if (!jobs.woodcutter) give('woodcutter', Math.max(1, workforce * 0.06));
  if (!jobs.priest && s.religion >= 0) give('priest', workforce * 0.02);
  if (!jobs.scholar && knows(k, 'writing')) give('scholar', workforce * 0.02);
  // surplus labour goes to food (stockpiling), wood & stone
  if (knows(k, 'agriculture')) give('farmer', Math.min(avail * 0.5, Math.max(0, slots('farmer') - (jobs.farmer ?? 0))));
  give('woodcutter', avail * 0.4);
  give(knows(k, 'stone_tools') ? 'miner' : 'woodcutter', avail);
  return jobs;
}

function assignIndividuals(w: World, s: Settlement, k: Kingdom | undefined, adults: Person[], jobs: Record<string, number>): void {
  const indivShare = adults.length / Math.max(1, adults.length + s.extraPop * 0.65);
  const quota: Record<string, number> = {};
  for (const [prof, n] of Object.entries(jobs)) quota[prof] = Math.round(n * indivShare);
  const unassigned: Person[] = [];
  for (const p of adults) {
    if (p.id === k?.ruler) { p.prof = 'leader'; continue; }
    if (p.army >= 0) { p.prof = 'soldier'; continue; }
    if ((quota[p.prof] ?? 0) > 0) quota[p.prof]--;
    else unassigned.push(p);
  }
  for (const p of unassigned) {
    let best = 'gatherer', bn = 0;
    for (const [prof, n] of Object.entries(quota)) if (n > bn) { bn = n; best = prof; }
    if (bn > 0) quota[best]--;
    if (p.prof !== best) {
      p.prof = best;
      p.skill = Math.max(0.2, p.skill * 0.6);
    }
  }
}

function prodMult(p: Person): number {
  return Math.max(0.2, (1 + fx(p, 'work')) * (0.6 + p.skill * 0.8) * (p.hunger < 20 ? 0.5 : 1));
}

/** Monthly economy & society update for one settlement. */
export function updateSettlement(w: World, s: Settlement): void {
  const k = w.kingdoms.get(s.kingdom);
  const m = w.map;
  const tf = techFx(k);
  const sp = speciesById(k?.species ?? 'human');
  const adults: Person[] = [];
  let skillSum = 0, intSum = 0, workSum = 0, nWork = 0;
  for (const pid of s.residents) {
    const p = w.persons.get(pid);
    if (!p) continue;
    const age = ageOf(w, p);
    if (age < 14) { p.prof = 'child'; continue; }
    if (age > lifeElder(p)) { p.prof = 'elder'; continue; }
    adults.push(p);
  }
  const t = tally(w, s);
  if (s.forage < 0 || (w.tick / 10 + s.id) % 12 < 1) {
    let f = 0;
    m.disc(s.x, s.y, radiusOf(w, s), (i) => { if (m.owner[i] === s.id) f += m.veg[i] / 255 + (m.deposit[i] === D.FISH ? 3 : 0); });
    s.forage = f;
  }
  const forage = s.forage * 1.1 * (1 + techFx(k).food * 0.3);
  s.jobs = allocateJobs(w, s, k, adults, t, forage);
  assignIndividuals(w, s, k, adults, s.jobs);
  for (const p of adults) {
    skillSum += p.skill;
    intSum += intellect(p);
    workSum += prodMult(p);
    nWork++;
    p.skill = Math.min(1.5, p.skill + 0.004 * (1 + intellect(p) * 0.3));
  }
  const avgMult = nWork ? workSum / nWork : 1;
  const avgInt = nWork ? intSum / nWork : 1;
  void skillSum;
  const J = (p: string) => s.jobs[p] ?? 0;

  // ---- production
  const out: Partial<Record<Res, number>> = {};
  const add = (r: Res, v: number) => { out[r] = (out[r] ?? 0) + finite(v); };
  const season = SEASON_FOOD[seasonOf(w.tick)];
  const drought = w.drought[m.chunkOf(m.idx(s.x, s.y))];
  const climateFood = clamp(1 - drought, 0.2, 1.2) * (s.famine > 0 ? 0.35 : 1);
  let fertSum = 0, farms = 0;
  if (t.done.farm) for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (b && b.type === 'farm' && b.progress >= 1) { fertSum += m.fert[m.idx(b.x, b.y)] / 255; farms++; }
  }
  const fert = farms ? 0.5 + fertSum / farms : 1;
  const prod = (1 + tf.prod) * avgMult;
  add('food', J('farmer') * 9 * fert * (1 + tf.food) * season * climateFood * avgMult);
  add('food', Math.min(forage, J('gatherer') * 5 * avgMult) * (0.7 + 0.3 * season) * climateFood);
  add('food', Math.min(forage * 0.3, J('hunter') * 5 * avgMult));
  add('food', J('fisher') * 6 * avgMult * (1 + tf.food * 0.3));
  add('wood', J('woodcutter') * 4 * prod);
  // miners spread across mines; each mine yields its deposit's resource
  const mines: Building[] = [];
  if (t.done.mine) for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (b && b.type === 'mine' && b.progress >= 1) mines.push(b);
  }
  const miners = J('miner');
  if (mines.length) {
    const per = miners / mines.length;
    for (const b of mines) {
      const i = m.idx(b.x, b.y);
      const dp = m.deposit[i];
      const res = DEPOSITS[dp]?.res ?? 'stone';
      const amt = per * 3 * prod * (res === 'gold' ? 0.3 : res === 'rare' ? 0.1 : 1);
      add(res === 'food' ? 'stone' : res, amt);
      if (dp !== D.NONE) {
        const left = m.depositAmt[i] - Math.ceil(amt);
        if (left <= 0) {
          m.deposit[i] = D.NONE;
          m.depositAmt[i] = 0;
          m.dirty(i);
        } else m.depositAmt[i] = left;
      }
      if (res !== 'stone') add('stone', per * 0.5 * prod);
    }
  } else add('stone', miners * 1.5 * prod);
  add('gold', J('merchant') * 1.5 * (1 + tf.trade));
  // energy
  let energy = J('engineer') * 1.5;
  let energyUse = s.pop * 0.004 * Math.max(0, (k?.era ?? 0) - 7);
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (!b || b.progress < 1) continue;
    const e = buildingById.get(b.type)?.energy ?? 0;
    if (e > 0) {
      const coalNeed = e * 0.1;
      if (s.stock.coal >= coalNeed || knows(k, 'fusion')) {
        if (!knows(k, 'fusion')) s.stock.coal -= coalNeed;
        w.climate.pollution += knows(k, 'fusion') ? 0 : 0.0004;
        energy += e;
      } else energy += e * 0.3;
    } else energyUse -= e;
  }
  s.energyBalance = energy - energyUse;
  const energyOk = energyUse <= 0 ? 1 : clamp(energy / energyUse, 0.2, 1);
  // industry
  if (J('worker') > 0) {
    const ind = J('worker') * 2 * prod * energyOk;
    add('gold', ind * 0.6);
    add('iron', ind * 0.2);
    add('wood', ind * 0.2);
    w.climate.pollution += J('worker') * 0.00002;
  }
  // smiths turn iron into equipment
  if (J('smith') > 0 && k) {
    const iron = Math.min(s.stock.iron, J('smith') * 0.5);
    s.stock.iron -= iron;
    k.armory += iron * 2 + J('smith') * 0.2;
  }
  // research & faith
  let research = J('scholar') * 0.3 * avgInt + Math.pow(s.pop, 0.5) * 0.04;
  let faith = J('priest') * 1 + J('elder') * 0.1;
  let healthBonus = J('doctor') * 0.5 / Math.max(10, s.pop) * 100;
  let happyBonus = 0;
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (!b || b.progress < 1) continue;
    const d = buildingById.get(b.type);
    if (!d) continue;
    research += (d.research ?? 0) * (d.energy && d.energy < 0 ? energyOk : 1);
    faith += d.faith ?? 0;
    healthBonus += (d.health ?? 0) * 100;
    happyBonus += (d.happy ?? 0) * 100;
  }
  research *= 1 + tf.research;
  faith *= 1 + tf.faith;
  s.research = research;
  s.faith = faith;
  if (k) {
    k.research += 0; // research is pooled by kingdom update
    const rel = w.religions.get(s.religion);
    if (rel?.playerGod) w.player.faith = Math.min(9999, w.player.faith + faith * 0.05);
  }

  // ---- consumption
  const pop = s.pop;
  const foodUse = pop * 1.0;
  add('food', -foodUse);
  if (seasonOf(w.tick) === 3) add('wood', -pop * 0.03);
  s.produced = out;
  s.foodBalance = out.food ?? 0;
  for (const r of RES) {
    const v = s.stock[r] + (out[r] ?? 0);
    s.stock[r] = finite(v);
  }
  // starvation
  if (s.stock.food < 0) {
    const deficit = -s.stock.food;
    s.stock.food = 0;
    s.happiness -= 6;
    const starving = clamp(deficit / Math.max(1, foodUse), 0, 1);
    s.extraPop = Math.max(0, s.extraPop * (1 - 0.03 * starving));
    for (const pid of [...s.residents]) {
      const p = w.persons.get(pid);
      if (p) p.hunger = Math.max(0, p.hunger - 25 * starving);
    }
  } else {
    for (const pid of s.residents) {
      const p = w.persons.get(pid);
      if (p) p.hunger = Math.min(100, p.hunger + 30);
    }
  }
  // storage limits & taxes
  let storage = 200;
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (b && b.progress >= 1) storage += buildingById.get(b.type)?.storage ?? 0;
  }
  s.storage = storage * (1 + tf.housing);
  for (const r of RES) {
    if (r === 'gold') continue;
    if (s.stock[r] > s.storage) s.stock[r] = s.storage;
    if (s.stock[r] < 0) s.stock[r] = 0;
  }
  if (k) {
    const tax = s.pop * 0.03 * (0.5 + k.stability / 100) + s.stock.gold * 0.3;
    s.stock.gold *= 0.7;
    k.treasury = finite(k.treasury + tax);
  }

  // ---- health, happiness
  const disease = s.infected;
  s.health = clamp(55 + tf.health * 40 + healthBonus - disease * 50 - (s.pop > s.housing ? 10 : 0) + (m.waterDist[m.idx(s.x, s.y)] < 3 ? 5 : 0), 5, 100);
  const foodOk = s.stock.food > pop * 0.4 ? 1 : 0;
  const housed = s.pop <= s.housing ? 1 : 0;
  const warPenalty = k ? Math.min(25, k.warExhaustion * 0.3) : 0;
  const target = 40 + foodOk * 15 + housed * 10 + happyBonus + Math.min(15, faith) + (k ? (k.stability - 50) * 0.2 : 0) - warPenalty - s.famine * 10 - disease * 30;
  s.happiness = clamp(s.happiness + (target - s.happiness) * 0.2, 0, 100);

  // ---- aggregate demography
  s.housing = housingOf(w, s, k);
  const room = s.pop < s.housing ? 1 : 0.15;
  const foodOkAgg = s.stock.food > pop * 0.3 ? 1 : s.foodBalance >= 0 ? 0.5 : 0.1;
  const birth = 0.0029 * sp.fert * foodOkAgg * room * (0.6 + s.happiness / 150);
  const death = 0.0016 * (1.6 - s.health / 100) + disease * 0.02 + (s.foodBalance < 0 && s.stock.food < pop * 0.2 ? 0.004 : 0);
  s.extraPop = Math.max(0, finite(s.extraPop + s.extraPop * (birth - death)));
  if (s.residents.length < w.caps.perSettlement && w.persons.size < w.caps.persons && s.extraPop >= 1) {
    // promote statistical population into simulated individuals
    const n = Math.min(3, Math.floor(s.extraPop), w.caps.perSettlement - s.residents.length);
    for (let i = 0; i < n; i++) {
      const p = createPerson(w, {
        x: s.x + w.rng.range(-2, 2), y: s.y + w.rng.range(-2, 2), species: k?.species ?? 'human', kingdom: s.kingdom, settlement: -1,
        culture: s.culture, religion: s.religion, ageYears: w.rng.range(14, 40),
      });
      setResidence(w, p, s.id);
      s.extraPop -= 1;
    }
  }
  w.stats.maxPop = Math.max(w.stats.maxPop, w.totalPop());

  // ---- level
  let lvl = 0;
  for (let i = SETTLEMENT_LEVELS.length - 1; i >= 0; i--) if (s.pop >= SETTLEMENT_LEVELS[i].pop) { lvl = i; break; }
  if (lvl !== s.level) {
    const up = lvl > s.level;
    s.level = lvl;
    s.forage = -1;
    s.coastal = -1;
    if (up) {
      claimTerritory(w, s);
      if (lvl >= 2) w.addHistory('settlement', `${s.name} devient ${SETTLEMENT_LEVELS[lvl].name.toLowerCase()}.`, lvl >= 4 ? 2 : 1, s.x, s.y);
      w.unlock('level:' + lvl);
    }
  } else if ((w.tick / 10 + s.id) % 24 < 1) claimTerritory(w, s);

  planConstruction(w, s, k, t);
  progressConstruction(w, s, k, J('builder'));
  updateWalls(w, s, k);
  if (s.famine > 0) s.famine--;
}

function lifeElder(p: Person): number {
  return speciesById(p.species).life * 0.85;
}

/** Decide what to build next based on real needs. */
function planConstruction(w: World, s: Settlement, k: Kingdom | undefined, t: Tally): void {
  const sites = t.sites;
  const maxSites = 1 + Math.floor(s.level / 2) + Math.floor((s.jobs.builder ?? 0) / 8);
  if (sites >= maxSites) return;
  const pop = s.pop;
  const want: string[] = [];
  const houseCap = 6 * HOUSING_BY_STYLE[styleOfEra(k?.era ?? 0)];
  if (s.housing < pop * 1.15 + 6) want.push('house');
  const farmJobs = (t.all.farm ?? 0) * 4;
  if (knows(k, 'agriculture') && (s.jobs.farmer ?? 0) >= farmJobs * 0.9 * (s.residents.length / Math.max(1, pop) + 0.1) || (s.foodBalance < 0 && knows(k, 'agriculture'))) want.push('farm');
  if (Object.values(s.stock).some((v) => v > s.storage * 0.85)) want.push('storage');
  for (const d of BUILDINGS) {
    if (d.id === 'house' || d.id === 'farm') continue;
    if (!knows(k, d.tech) || s.level < d.minLevel) continue;
    if (d.id === 'temple' && s.religion < 0) continue;
    if (d.id === 'castle' && k?.capital !== s.id) continue;
    if (d.id === 'spaceport' && (k?.capital !== s.id || countAll(w, k, 'spaceport') > 0)) continue;
    if (d.id === 'port') {
      if (s.coastal < 0) s.coastal = nearCoast(w, s) ? 1 : 0;
      if (!s.coastal) continue;
    }
    const desired = Math.min(d.max, Math.floor(d.base + (d.per * pop) / 100));
    if ((t.all[d.id] ?? 0) < desired) want.push(d.id);
  }
  void houseCap;
  for (const type of want) {
    const d = buildingById.get(type)!;
    if (!canAfford(s, k, d)) continue;
    if (placeBuilding(w, s, type)) {
      pay(s, k, d);
      return;
    }
  }
  // era upgrades of old buildings (huts -> houses -> apartments ...)
  if (k && w.rng.chance(0.3)) {
    const style = styleOfEra(k.era);
    for (const bid of s.buildings) {
      const b = w.buildings.get(bid);
      if (b && b.progress >= 1 && styleOfEra(b.era) < style && s.stock.stone >= 10) {
        s.stock.stone -= 10;
        b.era = k.era;
        w.map.dirty(w.map.idx(b.x, b.y));
        break;
      }
    }
  }
}

function countAll(w: World, k: Kingdom, type: string): number {
  let n = 0;
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid);
    if (s) n += countBuildings(w, s, type);
  }
  return n;
}

function nearCoast(w: World, s: Settlement): boolean {
  let c = false;
  w.map.disc(s.x, s.y, radiusOf(w, s), (i) => { if (!c && w.map.owner[i] === s.id && w.map.isCoastalLand(i)) c = true; });
  return c;
}

function canAfford(s: Settlement, k: Kingdom | undefined, d: BuildingDef): boolean {
  for (const [r, v] of Object.entries(d.cost) as [Res, number][]) {
    if (r === 'gold') { if ((k?.treasury ?? 0) + s.stock.gold < v) return false; }
    else if (s.stock[r] < v) return false;
  }
  return true;
}
function pay(s: Settlement, k: Kingdom | undefined, d: BuildingDef): void {
  for (const [r, v] of Object.entries(d.cost) as [Res, number][]) {
    if (r === 'gold') {
      const fromStock = Math.min(s.stock.gold, v);
      s.stock.gold -= fromStock;
      if (k) k.treasury = Math.max(0, k.treasury - (v - fromStock));
    } else s.stock[r] = Math.max(0, s.stock[r] - v);
  }
}

function progressConstruction(w: World, s: Settlement, k: Kingdom | undefined, builders: number): void {
  let work = (3 + builders * 9) * (1 + techFx(k).prod);
  for (const bid of s.buildings) {
    if (work <= 0) break;
    const b = w.buildings.get(bid);
    if (!b || b.progress >= 1) continue;
    const d = buildingById.get(b.type)!;
    const need = (1 - b.progress) * d.work;
    const used = Math.min(need, work);
    work -= used;
    b.progress = Math.min(1, b.progress + used / d.work);
    if (b.progress >= 1) {
      w.map.dirty(w.map.idx(b.x, b.y));
      w.unlock('building:' + b.type);
      if (w.lod(b.x, b.y) === 0) { w.fx('build', b.x + 0.5, b.y + 0.5); w.sfx('build', b.x, b.y); }
      if (['castle', 'university', 'spaceport', 'lab'].includes(b.type))
        w.addHistory('build', `${s.name} achève la construction : ${d.name}.`, b.type === 'spaceport' ? 3 : 2, b.x, b.y);
    }
  }
}

function updateWalls(w: World, s: Settlement, k: Kingdom | undefined): void {
  if (!k || s.level < 2) return;
  const target = knows(k, 'gunpowder') ? 3 : knows(k, 'fortification') ? 2 : knows(k, 'masonry') ? 1 : 0;
  if (s.wall < target) {
    const cost = 40 * (s.wall + 1);
    if (s.stock.stone >= cost) {
      s.stock.stone -= cost;
      s.wall++;
      w.map.disc(s.x, s.y, radiusOf(w, s), (i) => { if (w.map.owner[i] === s.id) w.map.dirty(i); });
      w.unlock('walls');
    }
  }
}

/** Defensive strength of a settlement (garrison + walls). */
export function defenseOf(w: World, s: Settlement): number {
  const k = w.kingdoms.get(s.kingdom);
  let def = 0;
  for (const bid of s.buildings) {
    const b = w.buildings.get(bid);
    if (b && b.progress >= 1) def += buildingById.get(b.type)?.defense ?? 0;
  }
  return ((s.jobs.soldier ?? 0) * 1.2 + s.pop * 0.05 + def * 5) * (1 + s.wall * 0.6) * (1 + techFx(k).military);
}

// ---------------------------------------------------------------- expansion

function siteScore(w: World, x: number, y: number, species: string): number {
  const m = w.map;
  if (!m.inside(x, y)) return -1;
  const i = m.idx(x, y);
  if (!m.buildable(i) || m.owner[i] >= 0) return -1;
  let score = 0, free = 0;
  const sp = speciesById(species);
  m.disc(x, y, 5, (j) => {
    if (m.owner[j] >= 0) { score -= 3; return; }
    if (m.isWater(j)) { score += m.biome[j] === B.RIVER || m.biome[j] === B.LAKE ? 0.6 : 0.2; return; }
    free++;
    score += m.fert[j] / 255;
    if (sp.likes.includes(m.biome[j])) score += 0.4;
    if (m.deposit[j] !== D.NONE) score += 1;
  });
  if (free < 30) return -1;
  score -= m.waterDist[i] * 0.4;
  return score;
}

export function findSettlementSite(w: World, cx: number, cy: number, minD: number, maxD: number, species: string, samples = 60): number {
  let best = -1, bs = 0;
  for (let t = 0; t < samples; t++) {
    const a = w.rng.range(0, Math.PI * 2), d = w.rng.range(minD, maxD);
    const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
    const sc = siteScore(w, x, y, species);
    if (sc > bs) { bs = sc; best = w.map.idx(x, y); }
  }
  return best;
}

export function maxSettlements(k: Kingdom): number {
  return [3, 4, 6, 9, 12, 16, 20, 26, 32, 40, 50, 60, 70, 80][Math.min(13, k.era)];
}

/** Monthly chance to send settlers to found a new village. */
export function trySettlers(w: World, s: Settlement): void {
  const k = w.kingdoms.get(s.kingdom);
  if (!k || s.level < 1 || s.residents.length < 24 || s.pop < 45) return;
  if (s.stock.food < s.pop * 0.8 || k.settlements.length >= maxSettlements(k)) return;
  if (w.settlements.size >= Math.floor(w.map.size / 450)) return;
  if (w.expeditions.some((e) => e.from === s.id)) return;
  const pressure = s.pop / Math.max(10, s.housing);
  if (!w.rng.chance(0.04 + 0.08 * Math.min(1, pressure))) return;
  const naval = knows(k, 'sailing');
  const reach = 14 + k.era * 3 + (naval ? 12 : 0);
  const site = findSettlementSite(w, s.x, s.y, 9, reach, k.species);
  if (site < 0) return;
  const from = w.map.idx(s.x, s.y);
  w.pathfinder.request(from, site, naval ? 1 : 0, (path) => {
    if (!path || !w.settlements.has(s.id) || w.map.owner[site] >= 0) return;
    const movers: Person[] = [];
    for (const pid of s.residents) {
      const p = w.persons.get(pid);
      if (!p || p.army >= 0 || p.id === k.ruler) continue;
      const age = ageOf(w, p);
      if (age >= 15 && age < 45 && movers.length < 6) movers.push(p);
    }
    if (movers.length < 4) return;
    // families follow (bounded so that the mother settlement survives)
    for (const p of [...movers]) {
      if (movers.length >= s.residents.length * 0.35) break;
      const partner = w.persons.get(p.partner);
      if (partner && !movers.includes(partner) && partner.settlement === s.id && partner.army < 0) movers.push(partner);
      for (const cid of p.children) {
        const c = w.persons.get(cid);
        if (c && c.settlement === s.id && ageOf(w, c) < 14 && !movers.includes(c)) movers.push(c);
      }
    }
    const extra = Math.floor(s.extraPop * 0.15);
    s.extraPop -= extra;
    for (const p of movers) {
      setResidence(w, p, -1);
      p.kingdom = k.id;
      p.state = PS.TRAVEL;
      p.path = path;
      p.pathI = 0;
    }
    let sea = 0;
    for (let j = 0; j < path.length; j++) if (w.map.isWater(path[j]) && w.map.biome[path[j]] !== B.RIVER) sea++;
    const spd = 0.35 * (1 + techFx(k).move);
    w.expeditions.push({
      id: w.id(), kingdom: k.id, from: s.id, x: site % w.map.w, y: (site / w.map.w) | 0, members: movers.map((p) => p.id),
      extra, eta: w.tick + Math.ceil(path.length / spd) + 2, path, naval: naval && sea > 4,
    });
    const leader = movers[0];
    bio(w, leader, `Mène une expédition de colons depuis ${s.name}.`);
  });
}

/** Resolve expeditions whose travel time elapsed: found the new settlement. */
export function updateExpeditions(w: World): void {
  for (let i = w.expeditions.length - 1; i >= 0; i--) {
    const e = w.expeditions[i];
    if (w.tick < e.eta) continue;
    w.expeditions.splice(i, 1);
    const k = w.kingdoms.get(e.kingdom);
    const members = e.members.map((id) => w.persons.get(id)).filter((p): p is Person => !!p);
    const site = w.map.idx(e.x, e.y);
    if (!k || k.fallen >= 0 || members.length === 0) continue;
    if (w.map.owner[site] >= 0 || !w.map.buildable(site)) {
      // site taken meanwhile: rejoin origin or capital
      const back = w.settlements.get(e.from) ?? w.settlements.get(k.capital);
      for (const p of members) {
        p.state = PS.IDLE;
        p.path = null;
        if (back) { setResidence(w, p, back.id); p.x = back.x; p.y = back.y; }
      }
      if (back) back.extraPop += e.extra;
      continue;
    }
    const s = foundSettlement(w, k.id, e.x, e.y, members);
    s.extraPop = e.extra;
    s.stock.food = 40 + members.length * 4;
    s.stock.wood = 30;
    for (const p of members) {
      p.state = PS.IDLE;
      p.path = null;
      p.x = p.px = e.x + w.rng.range(-1, 1);
      p.y = p.py = e.y + w.rng.range(-1, 1);
    }
    placeBuilding(w, s, 'house', undefined, true);
    const leader = members[0];
    leader.renown += 15;
    bio(w, leader, `Fonde ${s.name}.`);
    const origin = w.settlements.get(e.from);
    w.addHistory('found', `Fondation de ${s.name} par ${leader.name}${origin ? `, venu${leader.female ? 'e' : ''} de ${origin.name}` : ''} (${k.name}).`, 1, e.x, e.y);
    if (e.naval && !w.history.some((h) => h.type === 'explore' && h.text.includes(k.name))) w.addHistory('explore', `${leader.name} traverse les mers et fonde une colonie outre-mer pour ${k.name} : ${s.name}.`, 2, e.x, e.y);
  }
}

export function idleWorkTile(w: World, s: Settlement, p: Person): [number, number] {
  // where a worker goes during the day, by profession
  const want: Record<string, string> = {
    farmer: 'farm', woodcutter: 'lumber', miner: 'mine', merchant: 'market', soldier: 'barracks', priest: 'temple',
    scholar: 'library', smith: 'workshop', doctor: 'hospital', engineer: 'powerplant', worker: 'factory', fisher: 'port', leader: 'townhall',
  };
  const type = want[p.prof];
  if (type && s.buildings.length) {
    const start = p.id % s.buildings.length;
    for (let k = 0; k < s.buildings.length; k++) {
      const b = w.buildings.get(s.buildings[(start + k) % s.buildings.length]);
      if (b && (b.type === type || (type === 'library' && b.type === 'university') || (type === 'library' && b.type === 'lab'))) return [b.x + 0.5, b.y + 0.5];
    }
  }
  if (p.prof === 'builder') {
    for (const bid of s.buildings) {
      const b = w.buildings.get(bid);
      if (b && b.progress < 1) return [b.x + 0.5, b.y + 0.5];
    }
  }
  const r = radiusOf(w, s) * 0.8;
  for (let t = 0; t < 6; t++) {
    const x = s.x + w.rng.range(-r, r), y = s.y + w.rng.range(-r, r);
    if (w.map.inside(x | 0, y | 0) && w.map.walkable(w.map.idx(x | 0, y | 0))) return [x, y];
  }
  return [s.x + 0.5, s.y + 0.5];
}

