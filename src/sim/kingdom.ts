import { clamp, finite } from '../core/math';
import { roman } from '../core/names';
import { speciesById } from '../data/species';
import { Kingdom, Person, Settlement } from './entities';
import { assimilate, createCulture, createReligion } from './culture';
import { declareWar } from './war';
import { ageOf, bio, charisma, cultureLang, fx, fullName, has, leadership, loyalty } from './person';
import { pickCapital, transferSettlement } from './settlement';
import { techFx, updateResearch } from './tech';
import type { World } from './world';

export const GOVERNMENTS: Record<string, { name: string; ruler: [string, string]; title: string }> = {
  tribe: { name: 'Tribu', ruler: ['Chef', 'Cheffe'], title: 'Tribu' },
  chiefdom: { name: 'Chefferie', ruler: ['Grand chef', 'Grande cheffe'], title: 'Chefferie' },
  kingdom: { name: 'Monarchie', ruler: ['Roi', 'Reine'], title: 'Royaume' },
  theocracy: { name: 'Théocratie', ruler: ['Grand prêtre', 'Grande prêtresse'], title: 'Saint-Royaume' },
  empire: { name: 'Empire', ruler: ['Empereur', 'Impératrice'], title: 'Empire' },
  republic: { name: 'République', ruler: ['Consul', 'Consule'], title: 'République' },
  democracy: { name: 'Démocratie', ruler: ['Président', 'Présidente'], title: 'Union' },
  technocracy: { name: 'Technocratie', ruler: ['Archonte', 'Archonte'], title: 'Hégémonie' },
};

export const FACTION_DEFS: [string, string][] = [
  ['nobles', 'Noblesse'], ['clergy', 'Clergé'], ['merchants', 'Marchands'], ['military', 'Armée'], ['people', 'Peuple'],
];

export function kingdomTitle(k: Kingdom): string {
  return `${GOVERNMENTS[k.government]?.title ?? 'Royaume'} ${k.name}`;
}
export function rulerTitle(k: Kingdom, p: Person): string {
  const g = GOVERNMENTS[k.government] ?? GOVERNMENTS.kingdom;
  return g.ruler[p.female ? 1 : 0];
}

export function createKingdom(w: World, species: string, name?: string, parentCulture?: number): Kingdom {
  const k = new Kingdom();
  k.id = w.id();
  k.species = species;
  k.founded = w.tick;
  const pc = w.cultures.get(parentCulture ?? -1);
  const c = createCulture(w, pc);
  k.culture = c.id;
  k.religion = createReligion(w, c).id;
  k.name = name ?? cultureLang(w, c.id).placeName(w.rng);
  k.hue = (c.hue * 7 + w.kingdoms.size * 67) % 360;
  k.factions = FACTION_DEFS.map(([id, n]) => ({ id, name: n, power: 20, approval: 60 }));
  k.succession = w.rng.pick(['primogeniture', 'primogeniture', 'elective', 'strongest'] as const);
  w.kingdoms.set(k.id, k);
  w.unlock('kingdom:' + k.id);
  w.unlock('species:' + species);
  return k;
}

export function setRuler(w: World, k: Kingdom, p: Person | undefined, reason: string): void {
  if (!p) { k.ruler = -1; return; }
  const prev = w.persons.get(k.ruler);
  if (prev && prev.id !== p.id) prev.title = '';
  k.ruler = p.id;
  k.reigns++;
  p.title = `${rulerTitle(k, p)} de ${k.name}`;
  p.renown += 40;
  if (p.dynasty !== k.dynasty) {
    k.dynasty = p.dynasty;
    const d = w.dynasties.get(p.dynasty);
    if (d) d.kingdom = k.id;
  }
  const d = w.dynasties.get(p.dynasty);
  if (d) d.prestige += 10;
  // regnal number
  let n = 1;
  for (const a of w.ancestors.values()) if (a.name === p.name && a.renown > 40) n++;
  const regnal = n > 1 ? ' ' + roman(n) : '';
  bio(w, p, `Devient ${rulerTitle(k, p).toLowerCase()} (${reason}).`);
  const cap = w.settlements.get(k.capital);
  w.addHistory('ruler', `${p.name}${regnal} ${w.dynasties.get(p.dynasty)?.name ?? ''} devient ${rulerTitle(k, p).toLowerCase()} de ${k.name} (${reason}).`, 2, cap?.x, cap?.y);
  chooseHeir(w, k);
  refreshCouncil(w, k);
}

function candidates(w: World, k: Kingdom): Person[] {
  const out: Person[] = [];
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid);
    if (!s) continue;
    for (const pid of s.residents) {
      const p = w.persons.get(pid);
      if (p && ageOf(w, p) >= 16) out.push(p);
    }
  }
  return out;
}

export function chooseHeir(w: World, k: Kingdom): void {
  const ruler = w.persons.get(k.ruler);
  let heir: Person | undefined;
  if (ruler && k.succession === 'primogeniture') {
    const kids = ruler.children.map((id) => w.persons.get(id)).filter((c): c is Person => !!c && c.kingdom === k.id);
    kids.sort((a, b) => a.birth - b.birth);
    heir = kids[0];
  }
  if (!heir) {
    let best = -Infinity;
    for (const p of k.council.map((id) => w.persons.get(id))) {
      if (!p || p.id === k.ruler) continue;
      const sc = k.succession === 'strongest' ? p.genome.str * 2 + leadership(w, p) : leadership(w, p);
      if (sc > best) { best = sc; heir = p; }
    }
  }
  k.heir = heir?.id ?? -1;
}

export function refreshCouncil(w: World, k: Kingdom): void {
  const pool = candidates(w, k).filter((p) => p.id !== k.ruler);
  pool.sort((a, b) => leadership(w, b) - leadership(w, a));
  k.council = pool.slice(0, 5).map((p) => p.id);
  for (const p of pool.slice(0, 5)) if (!p.title) p.title = `Conseiller${p.female ? 'e' : ''} de ${k.name}`;
}

function succession(w: World, k: Kingdom): void {
  let heir = w.persons.get(k.heir);
  if (!heir || heir.kingdom !== k.id) {
    chooseHeir(w, k);
    heir = w.persons.get(k.heir);
  }
  if (!heir) {
    const pool = candidates(w, k);
    pool.sort((a, b) => leadership(w, b) - leadership(w, a));
    heir = pool[0];
  }
  if (!heir) return;
  // succession crisis: an ambitious council member may contest a weak heir
  const rival = k.council.map((id) => w.persons.get(id)).find((p) => p && p.id !== heir!.id && has(p, 'ambitious') && leadership(w, p) > leadership(w, heir!) * 1.2);
  if (rival && k.stability < 45 && k.settlements.length >= 2 && w.rng.chance(0.5)) {
    setRuler(w, k, heir, 'succession contestée');
    civilWar(w, k, rival, 'crise de succession');
    return;
  }
  setRuler(w, k, heir, k.succession === 'elective' ? 'élection' : 'succession');
}

/** Monthly politics for a kingdom. */
export function updateKingdom(w: World, k: Kingdom): void {
  // prune lost settlements, detect collapse
  k.settlements = k.settlements.filter((id) => w.settlements.has(id));
  if (k.settlements.length === 0) {
    fallKingdom(w, k);
    return;
  }
  if (!w.settlements.has(k.capital)) k.capital = pickCapital(w, k);
  const ruler = w.persons.get(k.ruler);
  if (!ruler || ruler.kingdom !== k.id) succession(w, k);
  if (w.tick % 120 === k.id % 120 || k.council.length < 3) refreshCouncil(w, k);

  // research pooled from settlements
  let research = 0, pop = 0, faith = 0, gold = 0;
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid)!;
    research += s.research;
    pop += s.pop;
    faith += s.faith;
    gold += s.stock.gold;
  }
  const r = w.persons.get(k.ruler);
  if (r && has(r, 'smart')) research *= 1.1;
  if (r && has(r, 'genius')) research *= 1.3;
  updateResearch(w, k, finite(research));
  // upkeep: administration, buildings & armies; idle wealth slowly erodes (corruption)
  let soldiers = 0, buildings = 0;
  for (const sid of k.settlements) { const s = w.settlements.get(sid)!; soldiers += s.jobs.soldier ?? 0; buildings += s.buildings.length; }
  k.treasury = Math.max(0, k.treasury - soldiers * 0.08 - buildings * 0.03 - k.armies.length * 2);
  // patronage: part of the treasury funds scholars; large hoards suffer corruption
  const patronage = k.treasury * 0.02;
  k.treasury -= patronage;
  k.research += patronage / 25;
  k.treasury *= 1 - Math.min(0.04, 0.004 + k.treasury / 2e6);
  k.wealth = k.treasury + gold;

  // ---- factions
  const atWar = k.armies.length > 0;
  const c = w.cultures.get(k.culture);
  const fset = (id: string, power: number, approvalTarget: number) => {
    const f = k.factions.find((x) => x.id === id);
    if (!f) return;
    f.power = f.power * 0.9 + power * 0.1;
    f.approval = clamp(f.approval + (approvalTarget - f.approval) * 0.15, 0, 100);
  };
  const avgHappy = k.settlements.reduce((a, sid) => a + (w.settlements.get(sid)?.happiness ?? 50), 0) / k.settlements.length;
  fset('nobles', 20 + k.settlements.length, 55 + (r ? (loyalty(r) - 0.6) * 30 : 0) - k.warExhaustion * 0.2);
  fset('clergy', 10 + faith * 0.5 + (c?.values.pious ?? 0.5) * 20, 50 + faith * 0.4 + (r && has(r, 'pious') ? 15 : 0) - (r && has(r, 'skeptic') ? 15 : 0));
  fset('merchants', 10 + k.era * 3 + (c?.values.mercantile ?? 0.5) * 20, 45 + Math.min(30, k.treasury / 50) - (atWar ? 10 : 0));
  fset('military', 15 + (c?.values.martial ?? 0.5) * 25 + k.armies.length * 5, 50 + (atWar ? 15 : -5) + (r && has(r, 'brave') ? 10 : 0) - (r && has(r, 'coward') ? 20 : 0));
  fset('people', 30 + pop / 200, avgHappy);

  // ---- stability
  const tf = techFx(k);
  const overextension = Math.max(0, k.settlements.length - (6 + k.era * 2)) * 3;
  const cultures = new Set(k.settlements.map((sid) => w.settlements.get(sid)?.culture));
  let weighted = 0, totalPower = 0;
  for (const f of k.factions) { weighted += f.approval * f.power; totalPower += f.power; }
  const factionMood = totalPower ? weighted / totalPower : 50;
  const target = 30 + factionMood * 0.5 + (r ? charisma(r) * 8 : -15) + tf.stability * 40 - overextension - (cultures.size - 1) * 4 - k.warExhaustion * 0.25 + (k.overlord >= 0 ? -5 : 0);
  k.stability = clamp(k.stability + (target - k.stability) * 0.1, 0, 100);
  k.warExhaustion = Math.max(0, k.warExhaustion - (atWar ? 0 : 1.5));
  k.reputation = clamp(k.reputation + (50 - k.reputation) * 0.01, 0, 100);

  updateGovernment(w, k);
  assimilate(w, k);

  // ---- internal unrest
  if (k.stability < 22 && k.settlements.length >= 3 && w.rng.chance(0.04)) rebellion(w, k);
  const mil = k.factions.find((f) => f.id === 'military');
  if (mil && mil.approval < 22 && mil.power > 25 && w.rng.chance(0.03)) coup(w, k);
  // ---- religious schism
  if (k.stability < 35 && k.era >= 4 && w.rng.chance(0.004)) {
    const parent = w.religions.get(k.religion);
    const rel = createReligion(w, w.cultures.get(k.culture), k.ruler, parent);
    k.religion = rel.id;
    w.addHistory('religion', `Schisme en ${k.name} : naissance de « ${rel.name} ».`, 2);
  }
}

function updateGovernment(w: World, k: Kingdom): void {
  const c = w.cultures.get(k.culture);
  const before = k.government;
  let g = k.government;
  if (k.era <= 1) g = k.settlements.length >= 2 ? 'chiefdom' : 'tribe';
  else if (k.era <= 5) {
    if (g === 'tribe' || g === 'chiefdom') g = (c?.values.pious ?? 0) > 0.75 && k.era >= 3 ? 'theocracy' : k.era >= 3 || k.settlements.length >= 3 ? 'kingdom' : 'chiefdom';
  } else if (k.era <= 8) {
    if ((g === 'kingdom' || g === 'theocracy') && (c ? c.values.mercantile + c.values.scholarly : 1) > 1.1 && k.stability < 50 && w.rng.chance(0.01)) g = 'republic';
  } else if (k.era <= 10) {
    if (g !== 'democracy' && g !== 'empire' && w.rng.chance(0.01)) g = 'democracy';
  } else if (g !== 'technocracy' && w.rng.chance(0.01)) g = 'technocracy';
  if ((g === 'kingdom' || g === 'theocracy') && (k.settlements.length >= 10 || k.conquests >= 12)) g = 'empire';
  if (g !== before) {
    k.government = g;
    const cap = w.settlements.get(k.capital);
    const ruler = w.persons.get(k.ruler);
    const text = g === 'empire' ? `Proclamation de l’Empire ${k.name} !` : g === 'republic' ? `Révolution : ${k.name} devient une république.` : `${k.name} adopte un nouveau régime : ${GOVERNMENTS[g].name}.`;
    w.addHistory('politics', text, g === 'empire' || g === 'republic' ? 3 : 2, cap?.x, cap?.y);
    if (ruler) ruler.title = `${rulerTitle(k, ruler)} de ${k.name}`;
    w.unlock('gov:' + g);
    if (g === 'republic' || g === 'democracy') k.succession = 'elective';
  }
}

/** A distant province rises and forms its own kingdom: civil war. */
export function rebellion(w: World, k: Kingdom): void {
  const capital = w.settlements.get(k.capital);
  if (!capital) return;
  const provinces = k.settlements.map((id) => w.settlements.get(id)!).filter((s) => s && s.id !== k.capital);
  provinces.sort((a, b) => ((b.x - capital.x) ** 2 + (b.y - capital.y) ** 2) * (1 + (b.culture !== k.culture ? 1 : 0)) - ((a.x - capital.x) ** 2 + (a.y - capital.y) ** 2) * (1 + (a.culture !== k.culture ? 1 : 0)));
  const core = provinces[0];
  if (!core) return;
  let leader: Person | undefined;
  for (const pid of core.residents) {
    const p = w.persons.get(pid);
    if (p && ageOf(w, p) > 18 && (!leader || leadership(w, p) + fx(p, 'ambition') > leadership(w, leader) + fx(leader, 'ambition'))) leader = p;
  }
  if (!leader) return;
  civilWar(w, k, leader, 'révolte', core);
}

/** Split a kingdom: the rebel leader takes nearby provinces and declares war. */
export function civilWar(w: World, k: Kingdom, leader: Person, cause: string, core?: Settlement): Kingdom | undefined {
  const base = core ?? w.settlements.get(leader.settlement);
  if (!base || base.kingdom !== k.id || base.id === k.capital) return undefined;
  const rebels = createKingdom(w, k.species, undefined, k.culture);
  rebels.techs = [...k.techs];
  rebels.era = k.era;
  rebels.government = k.government === 'empire' ? 'kingdom' : k.government;
  if (w.rng.chance(0.5)) rebels.religion = k.religion;
  const taken: Settlement[] = [base];
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid);
    if (!s || s.id === k.capital || s === base) continue;
    if ((s.x - base.x) ** 2 + (s.y - base.y) ** 2 < 30 ** 2 && w.rng.chance(0.6)) taken.push(s);
    if (taken.length >= Math.max(1, Math.floor(k.settlements.length / 2))) break;
  }
  for (const s of taken) transferSettlement(w, s, rebels.id);
  rebels.capital = base.id;
  rebels.treasury = k.treasury * 0.3;
  k.treasury *= 0.7;
  setRuler(w, rebels, leader, cause);
  w.addHistory('politics', `Guerre civile en ${k.name} : ${leader.name} mène la ${cause} et fonde ${rebels.name}.`, 3, base.x, base.y);
  const war = declareWar(w, rebels, k, 'guerre civile');
  if (war) war.civil = true;
  w.unlock('event:civilwar');
  return rebels;
}

function coup(w: World, k: Kingdom): void {
  let general: Person | undefined;
  for (const aid of k.armies) {
    const a = w.armies.get(aid);
    const c = a ? w.persons.get(a.commander) : undefined;
    if (c && (!general || leadership(w, c) > leadership(w, general))) general = c;
  }
  if (!general) general = k.council.map((id) => w.persons.get(id)).find((p) => p && (p.prof === 'soldier' || has(p, 'ambitious')));
  if (!general || general.id === k.ruler) return;
  const old = w.persons.get(k.ruler);
  const cap = w.settlements.get(k.capital);
  w.addHistory('politics', `Coup d’État en ${k.name} : ${fullName(w, general)} renverse ${old ? old.name : 'le pouvoir'}.`, 3, cap?.x, cap?.y);
  if (old) { old.title = 'Souverain déchu'; bio(w, old, 'Renversé par un coup d’État.'); }
  setRuler(w, k, general, 'coup d’État');
  k.stability = 40;
  for (const f of k.factions) f.approval = f.id === 'military' ? 75 : f.approval * 0.8;
  general.renown += 30;
  w.unlock('event:coup');
}

export function fallKingdom(w: World, k: Kingdom): void {
  if (k.fallen >= 0) return;
  k.fallen = w.tick;
  for (const aid of k.armies) w.armies.delete(aid);
  k.armies = [];
  for (const war of w.wars.values()) {
    if (war.end >= 0) continue;
    war.attackers = war.attackers.filter((id) => id !== k.id);
    war.defenders = war.defenders.filter((id) => id !== k.id);
  }
  for (const r of w.relations.values()) if (r.a === k.id || r.b === k.id) { r.war = -1; r.alliance = false; r.trade = false; }
  for (const o of w.kingdoms.values()) if (o.overlord === k.id) o.overlord = -1;
  const years = Math.floor((w.tick - k.founded) / 120);
  w.addHistory('fall', `Chute de ${k.name} après ${years} ans d’existence.`, 3);
  w.unlock('event:fall');
}

/** Ruler persona drives AI aggressiveness in diplomacy & war. */
export function aggression(w: World, k: Kingdom): number {
  const r = w.persons.get(k.ruler);
  const c = w.cultures.get(k.culture);
  let a = 0.3 + (c?.values.martial ?? 0.5) * 0.4;
  if (r) a += fx(r, 'aggression') + fx(r, 'ambition') * 0.5 - (has(r, 'peaceful') ? 0.3 : 0);
  if (k.government === 'empire') a += 0.15;
  if (k.government === 'democracy') a -= 0.15;
  return clamp(a, 0, 1.5);
}

export function militaryPower(w: World, k: Kingdom): number {
  let p = 0;
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid);
    if (s) p += (s.jobs.soldier ?? 0) + s.pop * 0.03;
  }
  for (const aid of k.armies) {
    const a = w.armies.get(aid);
    if (a) p += a.units.inf + a.units.arch + a.units.cav * 1.5 + a.units.heavy * 2 + a.units.siege + a.units.special * 4;
  }
  return p * (1 + techFx(k).military) * (1 + Math.min(1, k.armory / 500));
}

export function speciesName(k: Kingdom): string {
  return speciesById(k.species).plural;
}
