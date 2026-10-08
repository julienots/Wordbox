import { clamp } from '../core/math';
import { cap } from '../core/names';
import { Culture, Kingdom, Religion } from './entities';
import { language } from './person';
import type { World } from './world';

export const TRADITIONS = [
  'Fête des moissons', 'Culte des ancêtres', 'Duels d’honneur', 'Hospitalité sacrée', 'Chants de guerre',
  'Tatouages rituels', 'Conteurs itinérants', 'Jeux athlétiques', 'Marchés nocturnes', 'Pèlerinages',
  'Banquets royaux', 'Respect des forêts', 'Navigation stellaire', 'Écoles de scribes', 'Masques cérémoniels',
  'Mariages arrangés', 'Funérailles par le feu', 'Fêtes de la lune', 'Artisanat du verre', 'Courses de chars',
];
const DEITY_TYPES: [string, string][] = [
  ['gods', 'Panthéon divin'], ['spirits', 'Esprits de la nature'], ['ancestors', 'Ancêtres vénérés'],
  ['nature', 'Forces élémentaires'], ['concept', 'Concept abstrait'], ['sun', 'Astre solaire'], ['player', 'Le Créateur (vous)'],
];
const TENETS = [
  'Pacifisme', 'Guerre sainte', 'Ascétisme', 'Prosélytisme', 'Charité', 'Sacrifices', 'Monachisme',
  'Pèlerinage', 'Respect de la vie', 'Révélation par la science', 'Prophétie', 'Purification', 'Tolérance',
];
const RITES = ['Prière de l’aube', 'Offrandes de grain', 'Jeûne saisonnier', 'Danse des flammes', 'Bain sacré', 'Veillée des étoiles', 'Chant des morts'];
const ROOF_STYLES = ['Toit en chaume', 'Toit pentu', 'Toit plat', 'Dôme', 'Pagode'];
export const deityTypeName = (t: string) => DEITY_TYPES.find((d) => d[0] === t)?.[1] ?? t;
export const roofName = (i: number) => ROOF_STYLES[i % ROOF_STYLES.length];

export function createCulture(w: World, parent?: Culture): Culture {
  const r = w.rng;
  const c = new Culture();
  c.id = w.id();
  c.founded = w.tick;
  if (parent) {
    c.parent = parent.id;
    c.lang = parent.lang + r.int(1, 9999);
    c.values = { ...parent.values };
    for (const k of Object.keys(c.values) as (keyof Culture['values'])[]) c.values[k] = clamp(c.values[k] + r.normal() * 0.15, 0, 1);
    c.traditions = parent.traditions.filter(() => r.chance(0.7));
    c.roof = r.chance(0.7) ? parent.roof : r.int(0, 4);
    c.hue = (parent.hue + r.range(-30, 30) + 360) % 360;
  } else {
    c.lang = r.int(1, 1e9);
    for (const k of Object.keys(c.values) as (keyof Culture['values'])[]) c.values[k] = r.next();
    c.roof = r.int(0, 4);
    c.hue = r.range(0, 360);
  }
  while (c.traditions.length < 3) {
    const t = r.pick(TRADITIONS);
    if (!c.traditions.includes(t)) c.traditions.push(t);
  }
  c.wallHue = r.range(15, 50);
  c.clothesHue = r.range(0, 360);
  const lang = language(c.lang);
  c.name = cap(lang.word(r, 2, 3).toLowerCase().replace(/[aeiouy]*$/, '')) + r.pick(['ien', 'ois', 'ide', 'ain', 'ar', 'éen']);
  w.cultures.set(c.id, c);
  w.unlock('culture:' + c.id);
  return c;
}

export function createReligion(w: World, culture: Culture | undefined, founder = -1, parent?: Religion, forcePlayer = false): Religion {
  const r = w.rng;
  const rel = new Religion();
  rel.id = w.id();
  rel.founded = w.tick;
  rel.founder = founder;
  const lang = language(culture ? culture.lang : r.int(1, 1e9));
  if (forcePlayer) rel.deityType = 'player';
  else if (parent) rel.deityType = r.chance(0.6) ? parent.deityType : r.pick(DEITY_TYPES)[0];
  else rel.deityType = r.weighted(DEITY_TYPES, (d) => (d[0] === 'player' ? 0.4 : 1))![0];
  rel.playerGod = rel.deityType === 'player';
  rel.deity = rel.playerGod ? 'le Créateur' : lang.word(r, 2, 3);
  rel.parent = parent?.id ?? -1;
  rel.tenets = parent ? parent.tenets.filter(() => r.chance(0.5)) : [];
  while (rel.tenets.length < 2) {
    const t = r.pick(TENETS);
    if (!rel.tenets.includes(t)) rel.tenets.push(t);
  }
  rel.rites = [r.pick(RITES), r.pick(RITES)].filter((v, i, a) => a.indexOf(v) === i);
  rel.festival = 'Fête de ' + lang.word(r, 2, 2);
  rel.hue = r.range(0, 360);
  const base = rel.playerGod ? 'Créationnisme' : lang.word(r, 2, 2);
  rel.name = parent ? `${base} réformé` : r.pick([`Culte de ${rel.deity}`, `${base}isme`, `Voie de ${rel.deity}`, `Foi ${base}ne`]);
  if (rel.playerGod) rel.name = r.pick(['Église du Créateur', 'Culte de la Main Céleste', 'Témoins du Créateur']);
  w.religions.set(rel.id, rel);
  w.unlock('religion:' + rel.id);
  return rel;
}

/**
 * Yearly culture dynamics: drift of values driven by the kingdom's situation,
 * influence through trade/borders, extinction when no member remains.
 */
export function updateCultures(w: World): void {
  const members = new Map<number, number>();
  const followers = new Map<number, number>();
  for (const s of w.settlements.values()) {
    members.set(s.culture, (members.get(s.culture) ?? 0) + s.pop);
    followers.set(s.religion, (followers.get(s.religion) ?? 0) + s.pop);
  }
  for (const c of w.cultures.values()) {
    c.members = members.get(c.id) ?? 0;
    if (c.members === 0 && c.extinct < 0) {
      c.extinct = w.tick;
      w.addHistory('culture', `La culture ${c.name} a disparu.`, 1);
    }
  }
  for (const rel of w.religions.values()) {
    rel.followers = followers.get(rel.id) ?? 0;
    if (rel.followers === 0 && rel.extinct < 0 && w.tick - rel.founded > 1200) {
      rel.extinct = w.tick;
      w.addHistory('religion', `La religion « ${rel.name} » s’est éteinte.`, 1);
    }
  }
  for (const k of w.livingKingdoms()) {
    const c = w.cultures.get(k.culture);
    if (!c) continue;
    // situation-driven drift
    const atWar = [...w.wars.values()].some((war) => war.end < 0 && (war.attackers.includes(k.id) || war.defenders.includes(k.id)));
    c.values.martial = clamp(c.values.martial + (atWar ? 0.01 : -0.004), 0, 1);
    c.values.mercantile = clamp(c.values.mercantile + (k.treasury > 500 ? 0.006 : -0.002), 0, 1);
    c.values.scholarly = clamp(c.values.scholarly + (k.era >= 3 ? 0.004 : 0), 0, 1);
    if (w.rng.chance(0.03)) {
      const t = w.rng.pick(TRADITIONS);
      if (!c.traditions.includes(t)) {
        c.traditions.push(t);
        if (c.traditions.length > 6) c.traditions.shift();
        w.addHistory('culture', `Les ${c.name}s adoptent une nouvelle tradition : ${t}.`, 1);
      }
    }
  }
}

/** Cultural influence: settlements slowly adopt the culture/religion of their kingdom (assimilation). */
export function assimilate(w: World, k: Kingdom): void {
  for (const sid of k.settlements) {
    const s = w.settlements.get(sid);
    if (!s) continue;
    if (s.culture !== k.culture && w.rng.chance(0.02)) {
      const from = w.cultures.get(s.culture), to = w.cultures.get(k.culture);
      if (from && to) {
        // fusion: the dominant culture absorbs some values of the assimilated one
        for (const key of Object.keys(to.values) as (keyof Culture['values'])[]) to.values[key] = to.values[key] * 0.95 + from.values[key] * 0.05;
      }
      s.culture = k.culture;
    }
    if (s.religion !== k.religion && w.rng.chance(0.015)) s.religion = k.religion;
  }
}
