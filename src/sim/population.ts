import { clamp } from '../core/math';
import { buildingById } from '../data/buildings';
import { speciesById } from '../data/species';
import { DAYS_PER_MONTH } from '../data/time';
import { Person, PS } from './entities';
import { ageOf, bio, courage, createPerson, fx, has, killPerson, lifespan, setResidence, speed } from './person';
import { idleWorkTile } from './settlement';
import { techFx } from './tech';
import type { World } from './world';

const LOD_INTERVAL = [1, 3, 12];

/** Per-tick individual behaviour, with simulation level of detail. */
export function updatePersons(w: World): void {
  const m = w.map;
  for (const p of w.persons.values()) {
    if (p.state === PS.ARMY) continue;
    const lod = w.lod(p.x, p.y);
    const iv = LOD_INTERVAL[lod];
    if ((w.tick + p.id) % iv !== 0) {
      if (lod === 0) { p.px = p.x; p.py = p.y; }
      continue;
    }
    const dt = Math.min(24, w.tick - p.lastUpd) || 1;
    p.lastUpd = w.tick;
    p.px = p.x;
    p.py = p.y;
    p.energy = clamp(p.energy - 0.4 * dt, 0, 100);

    // threats: hostile creatures nearby make people flee (or fight if brave)
    if (lod < 2 && p.state !== PS.FLEE && (w.tick + p.id) % 4 === 0) {
      const threat = w.spatialAnimals.nearest(p.x, p.y, 4, (a) => a.faction < 0 || a.faction !== p.kingdom ? isHostile(a.sp) : false);
      if (threat) {
        if (courage(p) > 0.85 && (p.prof === 'soldier' || p.prof === 'hunter')) {
          threat.hp -= 2 + p.genome.str * 2;
          p.renown += 0.5;
        } else {
          p.state = PS.FLEE;
          p.tx = p.x + (p.x - threat.x) * 3;
          p.ty = p.y + (p.y - threat.y) * 3;
          p.timer = 6;
        }
      }
    }

    switch (p.state) {
      case PS.TRAVEL: {
        if (p.path) followPath(w, p, dt, lod);
        else if (moveTo(w, p, dt, lod)) p.state = PS.IDLE;
        break;
      }
      case PS.FLEE:
        moveTo(w, p, dt * 1.4, lod);
        p.timer -= dt;
        if (p.timer <= 0) p.state = PS.IDLE;
        break;
      case PS.TO_WORK:
        if (moveTo(w, p, dt, lod)) { p.state = PS.WORK; p.timer = w.rng.int(8, 20); }
        break;
      case PS.TO_HOME:
        if (moveTo(w, p, dt, lod)) { p.state = PS.REST; p.timer = w.rng.int(5, 12); }
        break;
      case PS.WANDER:
        if (moveTo(w, p, dt, lod)) p.state = PS.IDLE;
        break;
      case PS.WORK:
        p.timer -= dt;
        // small motion while working (visual liveliness)
        if (lod === 0 && w.rng.chance(0.2)) { p.x += w.rng.range(-0.15, 0.15); p.y += w.rng.range(-0.15, 0.15); }
        if (p.prof === 'woodcutter' && w.rng.chance(0.05)) {
          const i = m.idx(p.x | 0, p.y | 0);
          if (m.veg[i] > 30) { m.veg[i] -= 8; if (lod === 0) m.dirty(i); }
        }
        if (p.timer <= 0) p.state = PS.TO_HOME, setHome(w, p);
        break;
      case PS.REST:
        p.timer -= dt;
        p.energy = clamp(p.energy + 8 * dt, 0, 100);
        if (p.timer <= 0) p.state = PS.IDLE;
        break;
      default:
        decide(w, p);
    }
  }
}

function isHostile(sp: string): boolean {
  return sp === 'demon' || sp === 'alien' || sp === 'dragon' || sp === 'bear' || sp === 'serpent';
}

function decide(w: World, p: Person): void {
  const s = w.settlements.get(p.settlement);
  if (!s) {
    // homeless: join the closest settlement of the kingdom, else any
    let best = -1, bd = Infinity;
    for (const st of w.settlements.values()) {
      const d = (st.x - p.x) ** 2 + (st.y - p.y) ** 2 + (st.kingdom === p.kingdom ? 0 : 400);
      if (d < bd) { bd = d; best = st.id; }
    }
    const target = w.settlements.get(best);
    if (target && bd < 60 * 60) {
      setResidence(w, p, target.id);
      p.tx = target.x + 0.5; p.ty = target.y + 0.5;
      p.state = PS.TRAVEL;
      p.path = null;
    } else {
      p.tx = p.x + w.rng.range(-5, 5); p.ty = p.y + w.rng.range(-5, 5);
      p.state = PS.WANDER;
    }
    return;
  }
  const age = ageOf(w, p);
  if (age < 14 || p.prof === 'elder') {
    p.tx = s.x + 0.5 + w.rng.range(-3, 3);
    p.ty = s.y + 0.5 + w.rng.range(-3, 3);
    p.state = PS.WANDER;
    return;
  }
  if (p.energy < 25) {
    setHome(w, p);
    p.state = PS.TO_HOME;
    return;
  }
  const r = w.rng.next();
  const lazy = fx(p, 'work') < 0 ? 0.15 : 0;
  if (r < 0.75 - lazy) {
    const [x, y] = idleWorkTile(w, s, p);
    p.tx = x; p.ty = y;
    p.state = PS.TO_WORK;
  } else {
    const roam = has(p, 'wanderer') ? 10 : 4;
    p.tx = s.x + 0.5 + w.rng.range(-roam, roam);
    p.ty = s.y + 0.5 + w.rng.range(-roam, roam);
    p.state = PS.WANDER;
  }
}

function setHome(w: World, p: Person): void {
  const s = w.settlements.get(p.settlement);
  if (!s) return;
  const houses = s.buildings.filter((id) => w.buildings.get(id)?.type === 'house');
  const b = houses.length ? w.buildings.get(houses[p.id % houses.length]) : undefined;
  if (b) { p.tx = b.x + 0.5; p.ty = b.y + 0.5; } else { p.tx = s.x + 0.5; p.ty = s.y + 0.5; }
}

/** Straight-line steering with simple obstacle sliding. Returns true when arrived. */
function moveTo(w: World, p: Person, dt: number, lod: number): boolean {
  const dx = p.tx - p.x, dy = p.ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.3) return true;
  const m = w.map;
  const tf = techFx(w.kingdoms.get(p.kingdom));
  const ri = m.idx(clamp(p.x | 0, 0, m.w - 1), clamp(p.y | 0, 0, m.h - 1));
  const roadBonus = m.road[ri] ? 1.6 : 1;
  const step = Math.min(d, 0.22 * speed(p) * dt * roadBonus * (1 + tf.move * 0.5));
  if (lod === 2) {
    // far away: no fine movement, jump to destination when reachable
    if (m.inside(p.tx | 0, p.ty | 0) && m.walkable(m.idx(p.tx | 0, p.ty | 0))) { p.x = p.tx; p.y = p.ty; return true; }
    p.tx = p.x; p.ty = p.y;
    return true;
  }
  const nx = p.x + (dx / d) * step, ny = p.y + (dy / d) * step;
  if (tryStep(w, p, nx, ny)) return false;
  // slide along obstacles
  if (tryStep(w, p, p.x + Math.sign(dx) * step, p.y) || tryStep(w, p, p.x, p.y + Math.sign(dy) * step)) return false;
  // stuck: give up this target
  p.tx = p.x; p.ty = p.y;
  return true;
}

function tryStep(w: World, p: Person, x: number, y: number): boolean {
  const m = w.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
  if (!m.walkable(m.idx(x | 0, y | 0))) return false;
  p.x = x; p.y = y;
  return true;
}

function followPath(w: World, p: Person, dt: number, lod: number): void {
  const path = p.path!;
  const m = w.map;
  let budget = 0.25 * speed(p) * dt * (1 + techFx(w.kingdoms.get(p.kingdom)).move);
  if (lod === 2) budget *= 1; // same pace, no interpolation needed
  while (budget > 0 && p.pathI < path.length) {
    const i = path[p.pathI];
    const tx = (i % m.w) + 0.5, ty = ((i / m.w) | 0) + 0.5;
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      p.x = tx; p.y = ty; budget -= d; p.pathI++;
    } else {
      p.x += (dx / d) * budget; p.y += (dy / d) * budget; budget = 0;
    }
  }
  if (p.pathI >= path.length) {
    p.path = null;
    p.state = PS.IDLE;
  }
}

/** Monthly life cycle: ageing, death, marriage, births, mood, migration. Staggered by id. */
export function updateLives(w: World): void {
  const day = w.tick % DAYS_PER_MONTH;
  const due: Person[] = [];
  for (const p of w.persons.values()) if (p.id % DAYS_PER_MONTH === day) due.push(p);
  for (const p of due) if (w.persons.has(p.id)) lifeMonth(w, p);
}

function lifeMonth(w: World, p: Person): void {
  const r = w.rng;
  const age = ageOf(w, p);
  const life = lifespan(p);
  const s = w.settlements.get(p.settlement);
  // ---- death
  if (!has(p, 'immortal')) {
    const med = techFx(w.kingdoms.get(p.kingdom)).health;
    let annual = age < 5 ? 0.06 / (1 + med * 3) : 0.004 / (1 + med);
    const old = (age - 0.6 * life) / (0.4 * life);
    if (old > 0) annual += old * old * 0.6;
    if (s) annual *= 1.6 - s.health / 100;
    annual *= 1 - fx(p, 'health') * 0.5;
    let cause = 'vieillesse';
    let q = annual / 12;
    if (p.hunger < 10) { q += 0.04; cause = 'famine'; }
    if (p.sick > 0) { q += 0.02 * p.sick; cause = 'maladie'; p.sick = Math.max(0, p.sick - 0.5); }
    if (age > life * 1.3) q = 1;
    if (r.chance(q)) {
      if (p.renown > 30) w.addHistory('death', `Mort de ${p.name}${p.title ? ', ' + p.title : ''}, à ${Math.floor(age)} ans (${cause}).`, p.renown > 80 ? 2 : 1, p.x, p.y);
      killPerson(w, p, cause);
      return;
    }
  }
  // ---- mood
  if (s) p.happy = clamp(p.happy + (s.happiness + fx(p, 'happy') * 100 - p.happy) * 0.3, 0, 100);
  if (p.renown > 0) p.renown *= 0.995;
  if (!s) return;
  const sp = speciesById(p.species);
  const adultAge = Math.max(14, sp.life * 0.2);
  // ---- marriage
  if (p.partner < 0 && age >= adultAge && age < sp.life * 0.7 && r.chance(0.15 + fx(p, 'social') * 0.1)) {
    const match = findSpouse(w, p, s.residents, age, adultAge);
    if (match) wed(w, p, match);
    else if (!p.female && r.chance(0.3)) {
      // look for a spouse in a nearby settlement of the same kingdom; the spouse moves in
      const k = w.kingdoms.get(p.kingdom);
      const list = k?.settlements ?? [];
      for (let t = 0; t < Math.min(3, list.length); t++) {
        const o = w.settlements.get(list[r.int(0, list.length - 1)]);
        if (!o || o === s || (o.x - s.x) ** 2 + (o.y - s.y) ** 2 > 40 * 40) continue;
        const m2 = findSpouse(w, p, o.residents, age, adultAge);
        if (m2) {
          wed(w, p, m2);
          setResidence(w, m2, s.id);
          m2.tx = s.x + 0.5; m2.ty = s.y + 0.5; m2.state = PS.TRAVEL; m2.path = null;
          break;
        }
      }
    }
  }
  // ---- births
  if (p.female && p.partner >= 0 && age >= adultAge && age < sp.life * 0.6) {
    const father = w.persons.get(p.partner);
    if (father && father.settlement === p.settlement) {
      const fert = p.genome.fert * sp.fert * Math.max(0, 1 + fx(p, 'fert')) * Math.max(0, 1 + fx(father, 'fert') * 0.5);
      const room = s.pop < s.housing ? 1 : 0.2;
      const food = s.stock.food > s.pop * 0.3 ? 1 : 0.3;
      const chance = 0.032 * fert * room * food * (p.children.length > 6 ? 0.3 : 1);
      if (r.chance(chance)) {
        if (s.residents.length < w.caps.perSettlement && w.persons.size < w.caps.persons) {
          const c = createPerson(w, { x: p.x, y: p.y, species: p.species, kingdom: p.kingdom, settlement: -1, culture: s.culture, religion: s.religion, father, mother: p });
          setResidence(w, c, s.id);
          bio(w, c, `Naît à ${s.name}, enfant de ${father.name} et ${p.name}.`);
          w.stats.births++;
          if (w.lod(p.x, p.y) === 0) w.fx('birth', p.x, p.y);
        } else {
          s.extraPop += 1;
          w.stats.births++;
        }
      }
    }
  }
  // ---- migration from miserable settlements
  if (s.happiness < 22 && age > 16 && r.chance(has(p, 'wanderer') ? 0.15 : 0.04)) {
    const k = w.kingdoms.get(p.kingdom);
    let best = -1, bh = s.happiness + 15;
    for (const sid of k?.settlements ?? []) {
      const o = w.settlements.get(sid);
      if (o && o.id !== s.id && o.happiness > bh && o.residents.length < w.caps.perSettlement) { bh = o.happiness; best = o.id; }
    }
    const dest = w.settlements.get(best);
    if (dest) {
      setResidence(w, p, dest.id);
      p.tx = dest.x + 0.5; p.ty = dest.y + 0.5;
      p.state = PS.TRAVEL;
      p.path = null;
    }
  }
}

function findSpouse(w: World, p: Person, pool: number[], age: number, adultAge: number): Person | undefined {
  for (const oid of pool) {
    const o = w.persons.get(oid);
    if (!o || o.id === p.id || o.partner >= 0 || o.female === p.female || o.species !== p.species || o.army >= 0) continue;
    const oa = ageOf(w, o);
    if (oa < adultAge || Math.abs(oa - age) > 15) continue;
    if (o.father >= 0 && (o.father === p.father || o.mother === p.mother)) continue; // siblings
    if (o.id === p.father || o.id === p.mother || p.children.includes(o.id)) continue;
    return o;
  }
  return undefined;
}

function wed(w: World, p: Person, o: Person): void {
  p.partner = o.id;
  o.partner = p.id;
  if (p.renown > 20 || o.renown > 20) {
    bio(w, p, `Épouse ${o.name}.`);
    bio(w, o, `Épouse ${p.name}.`);
  }
}

/** Housing helper exposed for UI. */
export function houseCapacity(type: string): number {
  return buildingById.get(type)?.housing ?? 0;
}
