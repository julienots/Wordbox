import { Language } from '../core/names';
import { clamp } from '../core/math';
import { speciesById } from '../data/species';
import { DAYS_PER_YEAR } from '../data/time';
import { TraitFx, TRAITS, traitById } from '../data/traits';
import { Genome, Person, PS } from './entities';
import type { World } from './world';

/** Sum of a trait effect over a person's traits. */
export function fx(p: Person, key: keyof TraitFx): number {
  let s = 0;
  for (const t of p.traits) s += traitById.get(t)?.fx[key] ?? 0;
  return s;
}
export const has = (p: Person, t: string) => p.traits.includes(t);

export function ageOf(w: World, p: Person): number {
  return (w.tick - p.birth) / DAYS_PER_YEAR;
}
export const isAdult = (w: World, p: Person) => ageOf(w, p) >= 16;

export function strength(p: Person): number {
  return Math.max(0.1, p.genome.str * speciesById(p.species).str * (1 + fx(p, 'str')) * p.scale);
}
export function intellect(p: Person): number {
  return Math.max(0.1, p.genome.int * speciesById(p.species).int * (1 + fx(p, 'int')));
}
export function speed(p: Person): number {
  return Math.max(0.05, p.genome.spd * speciesById(p.species).spd * (1 + fx(p, 'spd')));
}
export function lifespan(p: Person): number {
  return speciesById(p.species).life * p.genome.life * (1 + fx(p, 'life'));
}
export function courage(p: Person): number {
  return clamp(0.5 + fx(p, 'courage'), 0, 1.5);
}
export function loyalty(p: Person): number {
  return clamp(0.6 + fx(p, 'loyalty'), 0, 1.2);
}
export function charisma(p: Person): number {
  return Math.max(0, p.genome.cha * (1 + fx(p, 'charisma')));
}
/** Leadership / command score. */
export function leadership(w: World, p: Person): number {
  return charisma(p) + intellect(p) * 0.6 + courage(p) * 0.5 + p.renown / 200 + (has(p, 'strategist') ? 0.6 : 0) + Math.min(ageOf(w, p), 50) / 100;
}

const langCache = new Map<number, Language>();
export function language(seed: number): Language {
  let l = langCache.get(seed);
  if (!l) {
    l = new Language(seed);
    langCache.set(seed, l);
  }
  return l;
}
export function cultureLang(w: World, cultureId: number): Language {
  const c = w.cultures.get(cultureId);
  return language(c ? c.lang : w.opts.seed);
}

function randomGenome(w: World): Genome {
  const r = w.rng;
  const g = () => clamp(1 + r.normal() * 0.12, 0.6, 1.5);
  return { str: g(), int: g(), spd: g(), life: g(), fert: g(), cha: g(), hue: r.range(-12, 12), hair: r.range(0, 360) };
}

/** Child genome: per-gene average of parents + mutation (Evolution mode mutates faster). */
export function inheritGenome(w: World, a: Genome, b: Genome): Genome {
  const r = w.rng;
  const mut = w.opts.mode === 'evolution' ? 0.09 : 0.04;
  const mix = (x: number, y: number) => clamp((r.chance(0.5) ? x : y) * 0.5 + (x + y) * 0.25 + r.normal() * mut, 0.4, 3);
  return {
    str: mix(a.str, b.str), int: mix(a.int, b.int), spd: mix(a.spd, b.spd), life: mix(a.life, b.life),
    fert: mix(a.fert, b.fert), cha: mix(a.cha, b.cha), hue: (a.hue + b.hue) / 2 + r.normal() * 2, hair: r.chance(0.5) ? a.hair : b.hair,
  };
}

export function addTrait(p: Person, id: string): boolean {
  const def = traitById.get(id);
  if (!def || p.traits.includes(id)) return false;
  if (def.opposite) {
    const k = p.traits.indexOf(def.opposite);
    if (k >= 0) p.traits.splice(k, 1);
  }
  p.traits.push(id);
  return true;
}

function rollTraits(w: World, p: Person, parents: Person[]): void {
  const r = w.rng;
  for (const par of parents)
    for (const t of par.traits) {
      const d = traitById.get(t);
      if (d && d.inherit > 0 && r.chance(d.inherit)) addTrait(p, t);
    }
  const want = r.int(1, 3) - Math.min(1, p.traits.length);
  for (let k = 0; k < want; k++) {
    const t = r.weighted(TRAITS, (x) => x.weight);
    if (t) addTrait(p, t.id);
  }
}

export interface NewPerson {
  x: number;
  y: number;
  species: string;
  kingdom?: number;
  settlement?: number;
  culture?: number;
  religion?: number;
  ageYears?: number;
  female?: boolean;
  father?: Person;
  mother?: Person;
  dynasty?: number;
}

export function createPerson(w: World, o: NewPerson): Person {
  const r = w.rng;
  const p = new Person();
  p.id = w.id();
  p.species = o.species;
  p.female = o.female ?? r.chance(0.5);
  p.kingdom = o.kingdom ?? -1;
  p.settlement = o.settlement ?? -1;
  p.culture = o.culture ?? o.mother?.culture ?? -1;
  p.religion = o.religion ?? o.mother?.religion ?? -1;
  p.birth = w.tick - Math.round((o.ageYears ?? 0) * DAYS_PER_YEAR);
  p.x = p.px = p.tx = o.x;
  p.y = p.py = p.ty = o.y;
  const parents: Person[] = [];
  if (o.father) parents.push(o.father);
  if (o.mother) parents.push(o.mother);
  if (o.father && o.mother) {
    p.father = o.father.id;
    p.mother = o.mother.id;
    p.genome = inheritGenome(w, o.father.genome, o.mother.genome);
    p.dynasty = o.father.dynasty || o.mother.dynasty;
    p.scale = (o.father.scale + o.mother.scale) / 2;
    o.father.children.push(p.id);
    o.mother.children.push(p.id);
  } else {
    p.genome = randomGenome(w);
    p.dynasty = o.dynasty ?? 0;
  }
  rollTraits(w, p, parents);
  const lang = cultureLang(w, p.culture);
  p.name = lang.personName(r, p.female);
  if (!p.dynasty) p.dynasty = newDynasty(w, p, lang.familyName(r));
  const dyn = w.dynasties.get(p.dynasty);
  if (dyn) dyn.members++;
  p.prof = (o.ageYears ?? 0) >= 16 ? 'gatherer' : 'child';
  p.skill = r.range(0.3, 0.7);
  p.hunger = r.range(60, 90);
  p.state = PS.IDLE;
  p.lastUpd = w.tick;
  w.persons.set(p.id, p);
  return p;
}

export function newDynasty(w: World, founder: Person, name: string): number {
  const id = w.id();
  w.dynasties.set(id, { id, name, founder: founder.id, founded: w.tick, members: 0, prestige: 0, kingdom: founder.kingdom });
  return id;
}

export function fullName(w: World, p: Person): string {
  const d = w.dynasties.get(p.dynasty);
  return d ? `${p.name} ${d.name}` : p.name;
}

export function bio(w: World, p: Person, text: string): void {
  p.log.push([w.year, text]);
  if (p.log.length > 14) p.log.splice(1, 1); // keep birth line
}

/** Remove a person from the world, archiving a compact genealogy record. */
export function killPerson(w: World, p: Person, cause: string): void {
  if (!w.persons.has(p.id)) return;
  if (has(p, 'immortal') && cause !== 'divin') return;
  w.persons.delete(p.id);
  w.stats.deaths++;
  const age = ageOf(w, p);
  if (cause === 'vieillesse' || cause === 'maladie' || cause === 'famine') {
    w.stats.lifeSum += age;
    w.stats.lifeCount++;
  }
  if (cause === 'guerre' || cause === 'bataille') w.stats.warDeaths++;
  if (cause === 'catastrophe' || cause === 'divin') w.stats.disasterDeaths++;
  const partner = w.persons.get(p.partner);
  if (partner && partner.partner === p.id) partner.partner = -1;
  const s = w.settlements.get(p.settlement);
  if (s) {
    const k = s.residents.indexOf(p.id);
    if (k >= 0) s.residents.splice(k, 1);
  }
  const army = w.armies.get(p.army);
  if (army) {
    const k = army.members.indexOf(p.id);
    if (k >= 0) army.members.splice(k, 1);
  }
  const dyn = w.dynasties.get(p.dynasty);
  if (dyn) dyn.members = Math.max(0, dyn.members - 1);
  w.ancestors.set(p.id, {
    id: p.id, name: p.name, dynasty: p.dynasty, birth: p.birth, death: w.tick, father: p.father,
    mother: p.mother, female: p.female, renown: p.renown, cause,
  });
  w.graveyard.push({ p, tick: w.tick });
  if (w.graveyard.length > 200) w.graveyard.shift();
  const fam = w.famous.find((f) => f.id === p.id);
  if (fam) fam.death = w.tick;
  // Prune the genealogy archive: keep it bounded, keep renowned ancestors.
  if (w.ancestors.size > 20000) {
    const limit = w.tick - 250 * DAYS_PER_YEAR;
    for (const [id, a] of w.ancestors) if (a.death < limit && a.renown < 50) w.ancestors.delete(id);
  }
}

/** Move a person into a settlement (or out with -1). */
export function setResidence(w: World, p: Person, sid: number): void {
  const old = w.settlements.get(p.settlement);
  if (old) {
    const k = old.residents.indexOf(p.id);
    if (k >= 0) old.residents.splice(k, 1);
  }
  p.settlement = sid;
  const s = w.settlements.get(sid);
  if (s) {
    s.residents.push(p.id);
    p.kingdom = s.kingdom;
  }
}
