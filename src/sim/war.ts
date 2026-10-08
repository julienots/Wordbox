import { clamp, finite } from '../core/math';
import { BIOMES, B } from '../data/biomes';
import { Army, Kingdom, Person, PS, Settlement, Units, War } from './entities';
import { ageOf, bio, killPerson, leadership } from './person';
import { defenseOf, destroySettlement, radiusOf, transferSettlement } from './settlement';
import { knows, techFx } from './tech';
import type { World } from './world';

export const UNIT_NAMES: Record<keyof Units, (k: Kingdom) => string> = {
  inf: (k) => (k.era >= 9 ? 'Fantassins' : k.era >= 6 ? 'Mousquetaires' : k.era >= 3 ? 'Lanciers' : 'Guerriers'),
  arch: (k) => (k.era >= 7 ? 'Tirailleurs' : 'Archers'),
  cav: (k) => (k.era >= 8 ? 'Blindés légers' : 'Cavalerie'),
  heavy: (k) => (k.era >= 8 ? 'Chars d’assaut' : k.era >= 5 ? 'Chevaliers' : 'Infanterie lourde'),
  siege: (k) => (k.era >= 6 ? 'Artillerie' : 'Ingénieurs de siège'),
  special: (k) => (k.era >= 11 ? 'Mécas' : k.era >= 9 ? 'Aviation' : 'Unités d’élite'),
};
const UNIT_POWER: Units = { inf: 1, arch: 1.1, cav: 1.6, heavy: 2.2, siege: 0.8, special: 5 };

export function unitCount(u: Units): number {
  return u.inf + u.arch + u.cav + u.heavy + u.siege + u.special;
}

export function warName(w: World, a: Kingdom, b: Kingdom, cause: string): string {
  const n = [...w.wars.values()].filter((x) => (x.attackers.includes(a.id) && x.defenders.includes(b.id)) || (x.attackers.includes(b.id) && x.defenders.includes(a.id))).length + 1;
  const ord = n === 1 ? 'Première' : n === 2 ? 'Deuxième' : n === 3 ? 'Troisième' : `${n}e`;
  const kind = cause === 'guerre civile' ? 'Guerre civile' : cause === 'religion' ? 'Guerre sainte' : cause === 'ressources' ? 'Guerre des ressources' : 'Guerre';
  return `${ord} ${kind} ${a.name}–${b.name}`;
}

export function declareWar(w: World, attacker: Kingdom, defender: Kingdom, cause: string): War | undefined {
  if (attacker.id === defender.id || attacker.fallen >= 0 || defender.fallen >= 0) return undefined;
  const rel = w.relation(attacker.id, defender.id);
  if (rel.war >= 0) return w.wars.get(rel.war);
  const war = new War();
  war.id = w.id();
  war.start = w.tick;
  war.cause = cause;
  war.attackers = [attacker.id];
  war.defenders = [defender.id];
  war.name = warName(w, attacker, defender, cause);
  w.wars.set(war.id, war);
  w.stats.warsTotal++;
  // breaking a pact or alliance is a betrayal
  if (rel.pact || rel.alliance) {
    attacker.reputation = Math.max(0, attacker.reputation - 30);
    w.addHistory('diplomacy', `Trahison ! ${attacker.name} rompt son traité avec ${defender.name}.`, 2);
    w.unlock('event:betrayal');
  }
  rel.war = war.id;
  rel.alliance = rel.pact = rel.trade = false;
  rel.opinion = Math.min(rel.opinion, -50);
  // allies join
  for (const [side, other, list] of [[defender, attacker, war.defenders], [attacker, defender, war.attackers]] as [Kingdom, Kingdom, number[]][]) {
    for (const r of w.relations.values()) {
      if (!r.alliance || (r.a !== side.id && r.b !== side.id)) continue;
      const allyId = r.a === side.id ? r.b : r.a;
      const ally = w.kingdoms.get(allyId);
      if (!ally || ally.fallen >= 0 || list.includes(allyId) || allyId === other.id) continue;
      const rr = w.relation(allyId, other.id);
      if (rr.alliance || rr.war >= 0) continue;
      list.push(allyId);
      rr.war = war.id;
      rr.trade = rr.pact = false;
    }
    // vassals follow their overlord
    for (const v of w.kingdoms.values()) {
      if (v.overlord === side.id && v.fallen < 0 && !list.includes(v.id) && v.id !== other.id) {
        list.push(v.id);
        w.relation(v.id, other.id).war = war.id;
      }
    }
  }
  // all cross pairs are at war
  for (const a of war.attackers) for (const d of war.defenders) w.relation(a, d).war = war.id;
  const cap = w.settlements.get(defender.capital);
  w.addHistory('war', `${war.name} : ${attacker.name} déclare la guerre à ${defender.name} (${cause}).`, war.attackers.length + war.defenders.length > 3 ? 3 : 2, cap?.x, cap?.y);
  w.sfx('war');
  w.unlock('event:war');
  for (const kid of [...war.attackers, ...war.defenders]) {
    const k = w.kingdoms.get(kid);
    if (k) raiseArmies(w, k, war);
  }
  return war;
}

function composition(k: Kingdom, n: number, rng: World['rng']): Units {
  const u: Units = { inf: 0, arch: 0, cav: 0, heavy: 0, siege: 0, special: 0 };
  const share = {
    arch: knows(k, 'hunting') ? 0.2 : 0,
    cav: knows(k, 'husbandry') && knows(k, 'wheel') ? 0.15 : 0,
    heavy: knows(k, 'iron') ? 0.12 : 0,
    siege: knows(k, 'masonry') ? 0.07 : 0,
    special: knows(k, 'aviation') ? 0.06 : 0,
  };
  let left = n;
  for (const key of ['arch', 'cav', 'heavy', 'siege', 'special'] as const) {
    const c = Math.floor(n * share[key] * rng.range(0.7, 1.3));
    u[key] = Math.min(left, c);
    left -= u[key];
  }
  u.inf = left;
  return u;
}

/** Levy armies from settlements: individual soldiers join, the rest is aggregate. */
export function raiseArmies(w: World, k: Kingdom, war: War): void {
  if (k.armies.length >= 3) return;
  const sorted = k.settlements.map((id) => w.settlements.get(id)!).filter(Boolean).sort((a, b) => b.pop - a.pop);
  for (const s of sorted.slice(0, 3 - k.armies.length)) {
    let levy = Math.floor((s.jobs.soldier ?? 0) + s.pop * 0.08);
    if (levy < 4 && s.pop >= 10) levy = 4; // tribal war band
    if (levy < 3) continue;
    const a = new Army();
    a.id = w.id();
    a.kingdom = k.id;
    a.war = war.id;
    a.home = s.id;
    a.x = a.px = s.x + 0.5;
    a.y = a.py = s.y + 0.5;
    a.units = composition(k, levy, w.rng);
    a.equipment = 1 + techFx(k).military + Math.min(1, k.armory / 400);
    k.armory = Math.max(0, k.armory - levy);
    a.state = 'idle';
    // individuals
    let best: Person | undefined;
    for (const pid of s.residents) {
      const p = w.persons.get(pid);
      if (!p || p.army >= 0 || p.id === k.ruler || ageOf(w, p) < 16 || ageOf(w, p) > 55) continue;
      if (p.prof === 'soldier' && a.members.length < 20) {
        a.members.push(p.id);
        p.army = a.id;
        p.state = PS.ARMY;
      }
      if (!best || leadership(w, p) > leadership(w, best)) best = p;
    }
    const cmd = best ?? w.persons.get(a.members[0]);
    if (cmd) {
      a.commander = cmd.id;
      if (cmd.army !== a.id) { cmd.army = a.id; cmd.state = PS.ARMY; a.members.push(cmd.id); }
      cmd.title = cmd.title || `Général${cmd.female ? 'e' : ''} de ${k.name}`;
      bio(w, cmd, `Prend le commandement d’une armée (${war.name}).`);
    }
    a.name = `Armée de ${s.name}`;
    s.extraPop = Math.max(0, s.extraPop - levy * 0.6);
    w.armies.set(a.id, a);
    k.armies.push(a.id);
    w.unlock('army');
  }
}

function enemiesOf(w: World, war: War, kid: number): number[] {
  if (war.attackers.includes(kid)) return war.defenders;
  if (war.defenders.includes(kid)) return war.attackers;
  return [];
}

function armyPower(w: World, a: Army): number {
  const cmd = w.persons.get(a.commander);
  const lead = cmd ? 1 + leadership(w, cmd) * 0.15 : 1;
  let p = 0;
  for (const key of Object.keys(UNIT_POWER) as (keyof Units)[]) p += a.units[key] * UNIT_POWER[key];
  return finite(p * a.equipment * (0.4 + a.morale / 100) * (1 + a.xp * 0.02) * lead * (0.5 + a.supply / 200));
}

function applyLosses(w: World, a: Army, fraction: number, war: War | undefined): number {
  let lost = 0;
  for (const key of Object.keys(a.units) as (keyof Units)[]) {
    const l = Math.min(a.units[key], Math.ceil(a.units[key] * fraction));
    a.units[key] -= l;
    lost += l;
  }
  // individual soldiers die proportionally
  const nInd = Math.round(a.members.length * fraction);
  for (let i = 0; i < nInd && a.members.length; i++) {
    const pid = a.members[w.rng.int(0, a.members.length - 1)];
    if (pid === a.commander && a.members.length > 1) continue;
    const p = w.persons.get(pid);
    if (p) killPerson(w, p, 'bataille');
    else a.members.splice(a.members.indexOf(pid), 1);
  }
  if (war) { war.deaths += lost; }
  w.stats.warDeaths += lost;
  return lost;
}

/** Per-tick army movement and combat. */
export function updateArmies(w: World): void {
  const m = w.map;
  for (const a of [...w.armies.values()]) {
    const k = w.kingdoms.get(a.kingdom);
    const war = w.wars.get(a.war);
    if (!k || k.fallen >= 0) { disband(w, a); continue; }
    if (unitCount(a.units) <= 0) { disband(w, a); continue; }
    a.px = a.x; a.py = a.y;
    // supply: replenished at home, drained in enemy land
    const owner = w.kingdomAt(m.idx(a.x | 0, a.y | 0));
    if (owner === a.kingdom) a.supply = Math.min(100, a.supply + 2);
    else a.supply = Math.max(0, a.supply - (knows(k, 'wheel') ? 0.25 : 0.4));
    if (a.supply <= 0 && w.tick % 10 === 0) applyLosses(w, a, 0.02, war);
    a.morale = clamp(a.morale + (a.supply > 50 ? 0.2 : -0.2), 0, 100);

    if (!war || war.end >= 0) {
      a.state = 'return';
      const home = w.settlements.get(a.home) ?? w.settlements.get(k.capital);
      if (!home) { disband(w, a); continue; }
      if (march(w, a, home.x + 0.5, home.y + 0.5, k)) disband(w, a);
      continue;
    }
    const enemies = enemiesOf(w, war, a.kingdom);
    // ---- engage nearby enemy armies
    let foe: Army | undefined;
    for (const o of w.armies.values()) {
      if (o.id === a.id || !enemies.includes(o.kingdom)) continue;
      if ((o.x - a.x) ** 2 + (o.y - a.y) ** 2 < 2.2 * 2.2) { foe = o; break; }
    }
    if (foe) { battle(w, a, foe, war); continue; }
    // ---- choose objective
    let target = w.settlements.get(a.targetSettlement);
    if (!target || !enemies.includes(target.kingdom)) {
      target = undefined;
      a.targetSettlement = -1;
      let bd = Infinity;
      const attacking = war.attackers.includes(a.kingdom) || a.morale > 60;
      if (attacking) {
        for (const eid of enemies) {
          const ek = w.kingdoms.get(eid);
          for (const sid of ek?.settlements ?? []) {
            const s = w.settlements.get(sid);
            if (!s) continue;
            const d = (s.x - a.x) ** 2 + (s.y - a.y) ** 2 + defenseOf(w, s) * 4;
            if (d < bd) { bd = d; target = s; }
          }
        }
      } else {
        // defend: intercept the closest enemy army inside our lands
        let ea: Army | undefined;
        for (const o of w.armies.values()) {
          if (!enemies.includes(o.kingdom)) continue;
          const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
          if (d < bd && w.kingdomAt(m.idx(o.x | 0, o.y | 0)) === a.kingdom) { bd = d; ea = o; }
        }
        if (ea) { march(w, a, ea.x, ea.y, k, true); continue; }
      }
      if (target) { a.targetSettlement = target.id; a.path = null; }
    }
    if (!target) { a.state = 'idle'; continue; }
    const d2 = (target.x + 0.5 - a.x) ** 2 + (target.y + 0.5 - a.y) ** 2;
    if (d2 < 2.5 * 2.5) siege(w, a, target, war, k);
    else { a.state = 'march'; march(w, a, target.x + 0.5, target.y + 0.5, k); }
  }
}

/** Move along a requested path (pathfinding is asynchronous & budgeted). */
function march(w: World, a: Army, tx: number, ty: number, k: Kingdom, direct = false): boolean {
  const m = w.map;
  const d = Math.hypot(tx - a.x, ty - a.y);
  if (d < 1) return true;
  const spd = 0.18 * (1 + techFx(k).move) * (a.units.cav > a.units.inf ? 1.3 : 1);
  if (direct || d < 6) {
    const nx = a.x + ((tx - a.x) / d) * Math.min(spd, d), ny = a.y + ((ty - a.y) / d) * Math.min(spd, d);
    const i = m.idx(nx | 0, ny | 0);
    if (m.walkable(i) || (knows(k, 'sailing') && m.isWater(i))) { a.x = nx; a.y = ny; }
    else a.path = null;
    return false;
  }
  if (!a.path && !a.waitingPath) {
    a.waitingPath = true;
    const naval = knows(k, 'sailing');
    w.pathfinder.request(m.idx(a.x | 0, a.y | 0), m.idx(tx | 0, ty | 0), naval ? 1 : 0, (p) => {
      a.waitingPath = false;
      a.path = p;
      a.pathI = 0;
      if (!p) a.targetSettlement = -1;
    });
    return false;
  }
  if (!a.path) return false;
  let budget = spd * (m.road[m.idx(a.x | 0, a.y | 0)] ? 1.6 : 1);
  while (budget > 0 && a.pathI < a.path.length) {
    const i = a.path[a.pathI];
    const px = (i % m.w) + 0.5, py = ((i / m.w) | 0) + 0.5;
    const dd = Math.hypot(px - a.x, py - a.y);
    if (dd <= budget) { a.x = px; a.y = py; budget -= dd; a.pathI++; }
    else { a.x += ((px - a.x) / dd) * budget; a.y += ((py - a.y) / dd) * budget; budget = 0; }
  }
  if (a.pathI >= a.path.length) a.path = null;
  return false;
}

function terrainDefense(w: World, x: number, y: number): number {
  const b = w.map.biome[w.map.idx(x | 0, y | 0)];
  return b === B.HILLS || b === B.FOREST || b === B.JUNGLE ? 1.25 : b === B.MOUNTAIN ? 1.5 : BIOMES[b].water ? 0.8 : 1;
}

function battle(w: World, a: Army, b: Army, war: War): void {
  a.state = b.state = 'battle';
  const pa = armyPower(w, a) * terrainDefense(w, a.x, a.y);
  const pb = armyPower(w, b) * terrainDefense(w, b.x, b.y);
  const la = clamp((pb / Math.max(1, pa + pb)) * 0.12 * w.rng.range(0.7, 1.3), 0, 0.5);
  const lb = clamp((pa / Math.max(1, pa + pb)) * 0.12 * w.rng.range(0.7, 1.3), 0, 0.5);
  const lostA = applyLosses(w, a, la, war);
  const lostB = applyLosses(w, b, lb, war);
  a.kills += lostB; b.kills += lostA;
  a.morale -= la * 60; b.morale -= lb * 60;
  a.xp += 0.5; b.xp += 0.5;
  if (w.lod(a.x, a.y) === 0) { w.fx('battle', (a.x + b.x) / 2, (a.y + b.y) / 2); if (w.rng.chance(0.3)) w.sfx('battle', a.x, a.y); }
  const ended = (x: Army) => x.morale < 20 || unitCount(x.units) < 3;
  if (ended(a) || ended(b)) {
    const winner = ended(a) ? b : a;
    const loser = winner === a ? b : a;
    war.battles++;
    w.stats.battles++;
    const wk = w.kingdoms.get(winner.kingdom), lk = w.kingdoms.get(loser.kingdom);
    const sign = war.attackers.includes(winner.kingdom) ? 1 : -1;
    war.score = clamp(war.score + sign * 8, -100, 100);
    const cmd = w.persons.get(winner.commander);
    if (cmd) {
      cmd.renown += 20 + loser.kills * 0.1;
      bio(w, cmd, `Victoire à la bataille de ${placeName(w, winner.x, winner.y)}.`);
      if (cmd.renown > 120 && !cmd.traits.includes('hero')) cmd.traits.push('hero');
    }
    const total = lostA + lostB;
    if (total > 20 || war.battles <= 1)
      w.addHistory('battle', `Bataille de ${placeName(w, winner.x, winner.y)} : ${wk?.name} l’emporte sur ${lk?.name}${cmd ? ` sous ${cmd.name}` : ''}.`, total > 150 ? 2 : 1, winner.x, winner.y);
    if (lk) lk.warExhaustion += 6;
    loser.state = 'return';
    loser.morale = 15;
    loser.targetSettlement = -1;
    // retreat
    const home = w.settlements.get(loser.home);
    if (home) { loser.path = null; loser.x += Math.sign(home.x - loser.x) * 1.5; loser.y += Math.sign(home.y - loser.y) * 1.5; }
    winner.morale = Math.min(100, winner.morale + 15);
    w.unlock('event:battle');
  }
}

function placeName(w: World, x: number, y: number): string {
  let best: Settlement | undefined, bd = Infinity;
  for (const s of w.settlements.values()) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best?.name ?? 'la plaine';
}

function siege(w: World, a: Army, s: Settlement, war: War, k: Kingdom): void {
  a.state = 'siege';
  const def = defenseOf(w, s);
  const atk = armyPower(w, a) * (1 + a.units.siege * 0.05 + (knows(k, 'gunpowder') ? 0.5 : 0));
  s.siege = clamp(s.siege + (atk / Math.max(1, def)) * 1.2 - 0.3, 0, 100);
  // garrison sallies out
  if (w.tick % 5 === 0) applyLosses(w, a, clamp(def / Math.max(1, atk) * 0.02, 0, 0.1), war);
  if (w.lod(s.x, s.y) === 0 && w.rng.chance(0.15)) w.fx('siege', s.x + w.rng.range(-1.5, 1.5), s.y + w.rng.range(-1.5, 1.5));
  if (s.siege < 100) return;
  // ---- capture
  s.siege = 0;
  const loserK = w.kingdoms.get(s.kingdom);
  const cmd = w.persons.get(a.commander);
  // pillage
  const loot = s.stock.gold + s.stock.food * 0.1;
  k.treasury += loot;
  s.stock.food *= 0.5;
  s.stock.gold = 0;
  s.wall = Math.max(0, s.wall - 1);
  const killed = Math.floor(s.extraPop * 0.1);
  s.extraPop -= killed;
  war.deaths += killed;
  war.captured++;
  const sign = war.attackers.includes(a.kingdom) ? 1 : -1;
  war.score = clamp(war.score + sign * (s.id === loserK?.capital ? 30 : 12), -100, 100);
  if (loserK) loserK.warExhaustion += 10;
  if (cmd) { cmd.renown += 25; bio(w, cmd, `Prend ${s.name}.`); }
  // brutal commanders raze small villages
  if (cmd && cmd.traits.includes('cruel') && s.level <= 1 && w.rng.chance(0.4)) {
    w.addHistory('war', `${s.name} est rasée par ${cmd.name}.`, 2, s.x, s.y);
    destroySettlement(w, s, 'rasée');
    return;
  }
  if (s.occupiedFrom < 0) s.occupiedFrom = s.kingdom;
  transferSettlement(w, s, a.kingdom);
  if (s.occupiedFrom === a.kingdom) s.occupiedFrom = -1; // liberated
  w.addHistory('war', `${k.name} s’empare de ${s.name}${loserK ? ` (${loserK.name})` : ''}.`, s.level >= 3 || loserK?.capital === s.id ? 2 : 1, s.x, s.y);
  w.fx('capture', s.x + 0.5, s.y + 0.5, radiusOf(w, s));
  a.targetSettlement = -1;
  a.xp += 3;
}

function disband(w: World, a: Army): void {
  const k = w.kingdoms.get(a.kingdom);
  const home = w.settlements.get(a.home) ?? (k ? w.settlements.get(k.capital) : undefined);
  for (const pid of a.members) {
    const p = w.persons.get(pid);
    if (!p) continue;
    p.army = -1;
    p.state = PS.IDLE;
    p.x = p.px = a.x;
    p.y = p.py = a.y;
    if (home && p.settlement !== home.id && !w.settlements.has(p.settlement)) p.settlement = -1;
  }
  if (home) home.extraPop += unitCount(a.units) * 0.6;
  if (k) k.armies = k.armies.filter((id) => id !== a.id);
  w.armies.delete(a.id);
}

/** Monthly war diplomacy: exhaustion, capitulation, peace treaties. */
export function updateWars(w: World): void {
  for (const war of w.wars.values()) {
    if (war.end >= 0) continue;
    war.attackers = war.attackers.filter((id) => w.kingdoms.get(id)?.fallen === -1);
    war.defenders = war.defenders.filter((id) => w.kingdoms.get(id)?.fallen === -1);
    if (!war.attackers.length || !war.defenders.length) { endWar(w, war, war.attackers.length ? 'att' : 'def'); continue; }
    const months = (w.tick - war.start) / 10;
    for (const kid of [...war.attackers, ...war.defenders]) {
      const k = w.kingdoms.get(kid)!;
      k.warExhaustion = Math.min(100, k.warExhaustion + 0.4);
      if (k.armies.length === 0 && months % 12 === 0) raiseArmies(w, k, war);
    }
    const leadAtt = w.kingdoms.get(war.attackers[0])!, leadDef = w.kingdoms.get(war.defenders[0])!;
    const capitalLost = !leadDef.settlements.includes(leadDef.capital) || leadDef.settlements.length === 0;
    if (war.score >= 70 || capitalLost && war.score > 40) endWar(w, war, 'att');
    else if (war.score <= -60) endWar(w, war, 'def');
    else if (months > 18 && (leadAtt.warExhaustion > 70 || leadDef.warExhaustion > 80) && w.rng.chance(0.15)) endWar(w, war, 'white');
    else if (months > 120) endWar(w, war, 'white');
  }
}

export function endWar(w: World, war: War, outcome: 'att' | 'def' | 'white'): void {
  war.end = w.tick;
  const winners = outcome === 'att' ? war.attackers : outcome === 'def' ? war.defenders : [];
  const losers = outcome === 'att' ? war.defenders : outcome === 'def' ? war.attackers : [];
  for (const a of war.attackers) for (const d of war.defenders) {
    const r = w.relation(a, d);
    r.war = -1;
    r.truceUntil = w.tick + 120 * 10;
    r.grievance += 15;
  }
  const lw = w.kingdoms.get(winners[0]), ll = w.kingdoms.get(losers[0]);
  // occupied settlements: winners keep conquests, otherwise they are returned
  for (const s of w.settlements.values()) {
    if (s.occupiedFrom < 0) continue;
    const occupier = s.kingdom;
    const involved = war.attackers.includes(occupier) || war.defenders.includes(occupier);
    if (!involved) continue;
    if (winners.includes(occupier)) s.occupiedFrom = -1;
    else {
      const orig = w.kingdoms.get(s.occupiedFrom);
      if (orig && orig.fallen < 0) transferSettlement(w, s, orig.id);
      s.occupiedFrom = -1;
    }
  }
  if (lw && ll && ll.fallen < 0) {
    const ratio = w.kingdomPop(lw) / Math.max(1, w.kingdomPop(ll));
    if (ll.settlements.length <= 1 && ratio > 3 && !war.civil) {
      // full annexation
      for (const sid of [...ll.settlements]) {
        const s = w.settlements.get(sid);
        if (s) transferSettlement(w, s, lw.id);
      }
      w.addHistory('war', `${lw.name} annexe entièrement ${ll.name}.`, 3);
    } else if (ratio > 2 && w.rng.chance(0.5) && !war.civil) {
      ll.overlord = lw.id;
      w.addHistory('diplomacy', `${ll.name} devient vassal de ${lw.name}.`, 2);
      w.unlock('diplo:vassal');
    } else {
      w.relation(lw.id, ll.id).tributeFrom = ll.id;
      w.unlock('diplo:tribute');
    }
    if (war.civil && outcome === 'def') {
      // rebels crushed: reintegrate
      for (const sid of [...ll.settlements]) {
        const s = w.settlements.get(sid);
        if (s) transferSettlement(w, s, lw.id);
      }
    }
  }
  const text = outcome === 'white'
    ? `Fin de la ${war.name} : paix blanche après ${war.deaths} morts.`
    : `Fin de la ${war.name} : victoire de ${lw?.name ?? '?'} (${war.deaths} morts).`;
  w.addHistory('peace', text, 2);
  w.unlock('event:peace');
}

export function isAtWar(w: World, k: Kingdom): boolean {
  for (const war of w.wars.values()) if (war.end < 0 && (war.attackers.includes(k.id) || war.defenders.includes(k.id))) return true;
  return false;
}

