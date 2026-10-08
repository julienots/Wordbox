import { clamp } from '../core/math';
import { ANIMALS } from '../data/animals';
import { B, BIOMES } from '../data/biomes';
import { D } from '../data/resources';
import { SPECIES } from '../data/species';
import { DAYS_PER_YEAR } from '../data/time';
import { TRAITS } from '../data/traits';
import { CLIMATE_BIOMES, classify, effTemp, SEA_LEVEL } from '../world/classify';
import { spawnWeather, startIceAge } from './climate';
import { createReligion } from './culture';
import { damageArea, earthquake, eruption, famine, ignite, meteor, startDisaster, startEpidemic, tornado, tsunami } from './disasters';
import { removeAnimal, spawnAnimal } from './ecosystem';
import { PS } from './entities';
import { addTrait, bio, killPerson } from './person';
import { spawnTribe } from './setup';
import { declareWar, endWar } from './war';
import type { World } from './world';

export type PowerCat = 'nature' | 'life' | 'destruction' | 'manipulation' | 'ultimate' | 'editor';

export interface PowerCtx {
  /** Entities picked up by the teleport power. */
  held: { persons: number[]; animals: number[] };
  /** Species / parameter chosen in the UI (spawn powers, editor). */
  param?: string;
}

export interface PowerResult {
  special?: 'rewind' | 'timestop';
  msg?: string;
}

export interface PowerDef {
  id: string;
  name: string;
  cat: PowerCat;
  icon: string;
  /** Default brush radius in tiles. */
  r: number;
  /** Painted continuously while dragging. */
  paint?: boolean;
  /** Faith cost in modes where powers are limited. */
  cost: number;
  /** Cooldown in ticks (limited modes). */
  cd?: number;
  ultimate?: boolean;
  desc: string;
  apply: (w: World, x: number, y: number, r: number, ctx: PowerCtx) => PowerResult | void;
}

export const CAT_NAMES: Record<PowerCat, string> = {
  nature: 'Nature', life: 'Vie', destruction: 'Destruction', manipulation: 'Manipulation', ultimate: 'Ultimes', editor: 'Éditeur',
};

// ------------------------------------------------------------------ helpers

function paintBiome(w: World, x: number, y: number, r: number, biome: number, heightTo?: number): void {
  const m = w.map;
  m.disc(x, y, r, (i) => {
    if (heightTo !== undefined) m.height[i] = heightTo;
    if (m.bld[i] >= 0 && BIOMES[biome].water) return;
    m.setBiome(i, biome);
    m.veg[i] = Math.round(BIOMES[biome].veg * 0.8);
    m.fert[i] = Math.max(m.fert[i], Math.round(BIOMES[biome].fert * 255));
    m.timer[i] = 0;
    if (BIOMES[biome].water) { m.road[i] = 0; m.owner[i] >= 0 && m.dirtyOwner(i); }
  });
  m.terrainVer++;
}

function reclassArea(w: World, x: number, y: number, r: number): void {
  const m = w.map;
  m.disc(x, y, r, (i) => {
    const b = m.biome[i];
    if (b === B.VOLCANO || b === B.LAVA || b === B.RIVER) return;
    const nb = classify(m.height[i], effTemp(m.temp[i], m.height[i], w.climate.tempOffset), clamp(m.humid[i] + w.climate.humidOffset, 0, 1));
    if (BIOMES[nb].water && m.bld[i] >= 0) return;
    if (nb !== b && (CLIMATE_BIOMES.has(b) || BIOMES[b].water || b === B.BEACH || b === B.LAKE || BIOMES[nb].water || b === B.ASH || b === B.BARREN)) {
      m.setBiome(i, nb);
      if (BIOMES[nb].water) m.road[i] = 0;
    }
  });
  m.terrainVer++;
}

function raise(w: World, x: number, y: number, r: number, amount: number): void {
  const m = w.map;
  m.disc(x, y, r, (i, _x, _y, d) => {
    m.height[i] = clamp(m.height[i] + amount * (1 - d / (r + 0.01)), 0.02, 1);
  });
  reclassArea(w, x, y, r);
}

function personsIn(w: World, x: number, y: number, r: number) {
  const out: import('./entities').Person[] = [];
  w.spatialPersons.query(x, y, Math.max(1.2, r), (p) => { out.push(p); });
  return out;
}

function settlementsIn(w: World, x: number, y: number, r: number) {
  return [...w.settlements.values()].filter((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= (r + 4) ** 2);
}

function kingdomAtPoint(w: World, x: number, y: number) {
  const m = w.map;
  if (!m.inside(x | 0, y | 0)) return undefined;
  return w.kingdoms.get(w.kingdomAt(m.idx(x | 0, y | 0)));
}

const P = (d: PowerDef) => d;

// ------------------------------------------------------------------ catalogue

export const POWERS: PowerDef[] = [
  // ---- Nature
  P({ id: 'tree', name: 'Arbres', cat: 'nature', icon: '🌳', r: 2, paint: true, cost: 1, desc: 'Fait pousser des arbres.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => {
      const b = m.biome[i];
      if (b === B.PLAINS || b === B.SAVANNA || b === B.ASH || b === B.BARREN || b === B.HILLS) m.setBiome(i, m.temp[i] > 0.7 ? B.JUNGLE : m.temp[i] < 0.34 ? B.TAIGA : B.FOREST);
      if (!m.isWater(i)) { m.veg[i] = Math.max(m.veg[i], BIOMES[m.biome[i]].veg); m.dirty(i); }
    });
  } }),
  P({ id: 'forest', name: 'Forêt', cat: 'nature', icon: '🌲', r: 6, paint: true, cost: 4, desc: 'Fait surgir une forêt entière.', apply: (w, x, y, r, c) => POWERS[0].apply(w, x, y, r, c) }),
  P({ id: 'grass', name: 'Prairie', cat: 'nature', icon: '🌱', r: 3, paint: true, cost: 1, desc: 'Transforme la terre en plaine fertile.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => { if (!m.isWater(i) && m.biome[i] !== B.VOLCANO) { m.setBiome(i, B.PLAINS); m.fert[i] = Math.max(m.fert[i], 220); m.veg[i] = 100; } });
  } }),
  P({ id: 'water', name: 'Eau', cat: 'nature', icon: '💧', r: 3, paint: true, cost: 2, desc: 'Creuse la terre pour créer mers et lacs.', apply: (w, x, y, r) => paintBiome(w, x, y, r, B.SHALLOW, SEA_LEVEL - 0.03) }),
  P({ id: 'mountain', name: 'Montagne', cat: 'nature', icon: '⛰️', r: 4, paint: true, cost: 3, desc: 'Soulève le relief.', apply: (w, x, y, r) => raise(w, x, y, r, 0.06) }),
  P({ id: 'river', name: 'Rivière', cat: 'nature', icon: '🏞️', r: 0.8, paint: true, cost: 1, desc: 'Trace une rivière qui fertilise les berges.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => { if (!m.isWater(i) && m.bld[i] < 0) { m.setBiome(i, B.RIVER); m.waterDist[i] = 0; } });
    m.disc(x, y, r + 3, (i) => { m.fert[i] = Math.min(255, m.fert[i] + 15); m.waterDist[i] = Math.min(m.waterDist[i], 2); });
    m.terrainVer++;
  } }),
  P({ id: 'snow', name: 'Neige', cat: 'nature', icon: '❄️', r: 4, paint: true, cost: 2, desc: 'Recouvre la région de neige et de glace.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => {
      if (m.isWater(i) && m.biome[i] !== B.DEEP_OCEAN) m.setBiome(i, B.GLACIER);
      else if (!m.isWater(i) && m.biome[i] !== B.VOLCANO && m.biome[i] !== B.LAVA) m.setBiome(i, B.SNOW);
      if (m.fire[i]) m.fire[i] = 0;
      m.temp[i] = Math.max(0, m.temp[i] - 0.05);
    });
    m.terrainVer++;
  } }),
  P({ id: 'sand', name: 'Désert', cat: 'nature', icon: '🏜️', r: 4, paint: true, cost: 2, desc: 'Assèche la terre en désert.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => { if (!m.isWater(i) || m.biome[i] === B.RIVER) { m.setBiome(i, B.DESERT); m.humid[i] = Math.max(0, m.humid[i] - 0.05); } });
    m.terrainVer++;
  } }),
  P({ id: 'rain', name: 'Pluie', cat: 'nature', icon: '🌧️', r: 10, cost: 2, desc: 'Fait venir la pluie, éteint les incendies, fait reverdir.', apply: (w, x, y) => {
    spawnWeather(w, 'rain', x, y);
    const m = w.map;
    const k = m.chunkOf(m.idx(clamp(x | 0, 0, m.w - 1), clamp(y | 0, 0, m.h - 1)));
    w.drought[k] = 0;
  } }),
  P({ id: 'fertile', name: 'Fertilité', cat: 'nature', icon: '🌾', r: 5, paint: true, cost: 2, desc: 'Enrichit le sol.', apply: (w, x, y, r) => {
    w.map.disc(x, y, r, (i) => { w.map.fert[i] = 255; w.map.veg[i] = Math.max(w.map.veg[i], BIOMES[w.map.biome[i]].veg); w.map.dirty(i); });
  } }),

  // ---- Life
  P({ id: 'humans', name: 'Créer un peuple', cat: 'life', icon: '👥', r: 1, cost: 25, desc: 'Fait naître une tribu (espèce au choix).', apply: (w, x, y, _r, c) => {
    const sp = c.param && SPECIES.some((s) => s.id === c.param) ? c.param : 'human';
    const k = spawnTribe(w, x | 0, y | 0, sp);
    if (!k) return { msg: 'Terrain inadapté ou déjà occupé.' };
    w.fx('magic', x, y, 3);
    w.addHistory('divine', `Le Créateur fait naître la tribu de ${k.name}.`, 2, x, y);
  } }),
  P({ id: 'animal', name: 'Créer des animaux', cat: 'life', icon: '🐇', r: 2, paint: true, cost: 3, desc: 'Fait apparaître des animaux (espèce au choix).', apply: (w, x, y, r, c) => {
    const sp = c.param && ANIMALS.some((a) => a.id === c.param) ? c.param : 'rabbit';
    const n = ['dragon', 'griffin', 'serpent', 'demon'].includes(sp) ? 1 : 3;
    for (let k = 0; k < n; k++) spawnAnimal(w, sp, x + w.rng.range(-r, r), y + w.rng.range(-r, r), 1);
  } }),
  P({ id: 'heal', name: 'Guérison', cat: 'life', icon: '💚', r: 5, cost: 4, desc: 'Soigne les habitants et met fin aux maladies.', apply: (w, x, y, r) => {
    for (const p of personsIn(w, x, y, r)) { p.health = 100; p.sick = 0; p.hunger = Math.max(p.hunger, 70); }
    for (const s of settlementsIn(w, x, y, r)) { s.infected = 0; s.health = Math.min(100, s.health + 30); }
    w.fx('heal', x, y, r);
  } }),
  P({ id: 'resurrect', name: 'Résurrection', cat: 'life', icon: '✨', r: 8, cost: 30, cd: 300, desc: 'Ramène à la vie les morts récents de la zone.', apply: (w, x, y, r) => {
    let n = 0;
    for (let k = w.graveyard.length - 1; k >= 0; k--) {
      const g = w.graveyard[k];
      if ((g.p.x - x) ** 2 + (g.p.y - y) ** 2 > r * r || w.tick - g.tick > DAYS_PER_YEAR * 5) continue;
      w.graveyard.splice(k, 1);
      const p = g.p;
      p.health = 100; p.sick = 0; p.hunger = 80; p.state = PS.IDLE; p.army = -1;
      w.persons.set(p.id, p);
      w.ancestors.delete(p.id);
      const s = w.settlements.get(p.settlement);
      if (s && !s.residents.includes(p.id)) s.residents.push(p.id); else if (!s) p.settlement = -1;
      bio(w, p, 'Ressuscité par le Créateur.');
      p.renown += 30;
      n++;
    }
    w.fx('magic', x, y, r);
    if (n) w.addHistory('divine', `Miracle : ${n} défunt(s) reviennent à la vie.`, 2, x, y);
    else return { msg: 'Aucun mort récent ici.' };
  } }),
  P({ id: 'growth', name: 'Bénédiction', cat: 'life', icon: '🌟', r: 6, cost: 8, desc: 'Accélère croissance, naissances et récoltes.', apply: (w, x, y, r) => {
    w.map.disc(x, y, r, (i) => { w.map.veg[i] = BIOMES[w.map.biome[i]].veg; w.map.fert[i] = Math.min(255, w.map.fert[i] + 40); });
    for (const s of settlementsIn(w, x, y, r)) { s.happiness = Math.min(100, s.happiness + 25); s.stock.food += s.pop * 3; s.extraPop *= 1.08; }
    for (const p of personsIn(w, x, y, r)) { addTrait(p, 'blessed'); p.renown += 2; }
    w.fx('magic', x, y, r);
  } }),
  P({ id: 'convert', name: 'Révélation', cat: 'life', icon: '🙏', r: 8, cost: 15, desc: 'Les habitants se convertissent à votre culte : vous devenez leur dieu.', apply: (w, x, y, r) => {
    const ss = settlementsIn(w, x, y, r);
    if (!ss.length) return { msg: 'Aucune ville ici.' };
    let rel = [...w.religions.values()].find((x) => x.playerGod && x.extinct < 0);
    if (!rel) rel = createReligion(w, w.cultures.get(ss[0].culture), -1, undefined, true);
    for (const s of ss) {
      s.religion = rel.id;
      for (const pid of s.residents) { const p = w.persons.get(pid); if (p) p.religion = rel.id; }
      const k = w.kingdoms.get(s.kingdom);
      if (k && k.capital === s.id) k.religion = rel.id;
    }
    w.fx('magic', x, y, r);
    w.addHistory('divine', `Révélation divine : ${ss.map((s) => s.name).join(', ')} adoptent « ${rel.name} ».`, 2, x, y);
  } }),

  // ---- Destruction
  P({ id: 'fire', name: 'Feu', cat: 'destruction', icon: '🔥', r: 1.5, paint: true, cost: 2, desc: 'Embrase la végétation et les bâtiments.', apply: (w, x, y, r) => {
    w.map.disc(x, y, r, (i) => ignite(w, i, 90));
    w.fx('fire', x, y, r);
  } }),
  P({ id: 'lightning', name: 'Foudre', cat: 'destruction', icon: '⚡', r: 1.5, cost: 3, desc: 'Frappe un point avec la colère céleste.', apply: (w, x, y, r) => {
    w.fx('lightning', x, y);
    w.sfx('thunder', x, y);
    damageArea(w, x, y, r, 0.9, 'divin');
    ignite(w, w.map.idx(clamp(x | 0, 0, w.map.w - 1), clamp(y | 0, 0, w.map.h - 1)), 70);
  } }),
  P({ id: 'meteor', name: 'Météore', cat: 'destruction', icon: '☄️', r: 5, cost: 20, cd: 60, desc: 'Fait s’écraser un météore.', apply: (w, x, y, r) => meteor(w, x, y, r) }),
  P({ id: 'volcano', name: 'Volcan', cat: 'destruction', icon: '🌋', r: 3, cost: 25, cd: 120, desc: 'Fait naître ou réveille un volcan.', apply: (w, x, y) => {
    if (w.map.isWater(w.map.idx(x | 0, y | 0))) return { msg: 'Impossible sur l’eau.' };
    raise(w, x, y, 3, 0.15);
    eruption(w, x, y);
  } }),
  P({ id: 'bomb', name: 'Explosion', cat: 'destruction', icon: '💣', r: 4, cost: 10, desc: 'Une détonation qui rase tout.', apply: (w, x, y, r) => {
    w.fx('explosion', x, y, r);
    w.sfx('explosion', x, y);
    damageArea(w, x, y, r, 0.95, 'divin');
    w.map.disc(x, y, r, (i) => { if (!w.map.isWater(i)) { w.map.setBiome(i, B.ASH); w.map.timer[i] = 200; w.map.veg[i] = 0; } });
  } }),
  P({ id: 'quake', name: 'Séisme', cat: 'destruction', icon: '〰️', r: 12, cost: 15, cd: 60, desc: 'Fait trembler la terre.', apply: (w, x, y, r) => earthquake(w, x, y, r) }),
  P({ id: 'tsunami', name: 'Tsunami', cat: 'destruction', icon: '🌊', r: 1, cost: 20, cd: 120, desc: 'Lance une vague géante depuis la mer.', apply: (w, x, y) => {
    if (!w.map.isWater(w.map.idx(x | 0, y | 0))) return { msg: 'Choisissez un point en mer.' };
    tsunami(w, x, y);
  } }),
  P({ id: 'tornado', name: 'Tornade', cat: 'destruction', icon: '🌪️', r: 1, cost: 12, cd: 40, desc: 'Déclenche une tornade.', apply: (w, x, y) => tornado(w, x, y) }),
  P({ id: 'hurricane', name: 'Ouragan', cat: 'destruction', icon: '🌀', r: 1, cost: 18, cd: 80, desc: 'Fait naître un ouragan.', apply: (w, x, y) => {
    const h = spawnWeather(w, 'hurricane', x, y);
    h.life = 260;
    w.addHistory('divine', 'Le Créateur déchaîne un ouragan.', 1, x, y);
  } }),
  P({ id: 'plague', name: 'Épidémie', cat: 'destruction', icon: '🦠', r: 1, cost: 15, cd: 200, desc: 'Répand une maladie.', apply: (w, x, y) => { if (!startEpidemic(w, x, y)) return { msg: 'Aucune ville.' }; } }),
  P({ id: 'famine', name: 'Famine', cat: 'destruction', icon: '🥀', r: 25, cost: 12, cd: 120, desc: 'Ruine les récoltes de la région.', apply: (w, x, y, r) => famine(w, x, y, r) }),
  P({ id: 'curse', name: 'Malédiction', cat: 'destruction', icon: '💀', r: 4, cost: 6, desc: 'Maudit les habitants.', apply: (w, x, y, r) => {
    for (const p of personsIn(w, x, y, r)) { addTrait(p, 'cursed'); p.health -= 30; if (p.health <= 0) killPerson(w, p, 'divin'); }
    w.fx('curse', x, y, r);
  } }),

  // ---- Manipulation
  P({ id: 'teleport', name: 'Téléportation', cat: 'manipulation', icon: '🌀', r: 3, cost: 5, desc: '1er appui : saisir les êtres. 2e appui : les déposer.', apply: (w, x, y, r, c) => {
    if (!c.held.persons.length && !c.held.animals.length) {
      for (const p of personsIn(w, x, y, r)) c.held.persons.push(p.id);
      w.spatialAnimals.query(x, y, r, (a) => { c.held.animals.push(a.id); });
      w.fx('magic', x, y, r);
      return { msg: `${c.held.persons.length + c.held.animals.length} être(s) saisi(s). Touchez la destination.` };
    }
    for (const id of c.held.persons) {
      const p = w.persons.get(id);
      if (!p) continue;
      p.x = p.px = p.tx = x + w.rng.range(-1, 1); p.y = p.py = p.ty = y + w.rng.range(-1, 1); p.path = null; p.state = PS.IDLE;
    }
    for (const id of c.held.animals) {
      const a = w.animals.get(id);
      if (a) { a.x = a.px = a.tx = x + w.rng.range(-1, 1); a.y = a.py = a.ty = y + w.rng.range(-1, 1); }
    }
    c.held = { persons: [], animals: [] };
    w.fx('magic', x, y, 2);
  } }),
  P({ id: 'giant', name: 'Gigantisme', cat: 'manipulation', icon: '🔺', r: 2, cost: 5, desc: 'Agrandit les êtres (plus forts).', apply: (w, x, y, r) => { for (const p of personsIn(w, x, y, r)) { p.scale = Math.min(3, p.scale * 1.5); addTrait(p, 'giant'); } } }),
  P({ id: 'tiny', name: 'Rapetissement', cat: 'manipulation', icon: '🔻', r: 2, cost: 5, desc: 'Rapetisse les êtres (plus rapides).', apply: (w, x, y, r) => { for (const p of personsIn(w, x, y, r)) { p.scale = Math.max(0.4, p.scale / 1.5); addTrait(p, 'tiny'); } } }),
  P({ id: 'mutate', name: 'Mutation', cat: 'manipulation', icon: '🧬', r: 2, cost: 6, desc: 'Modifie le génome (transmissible).', apply: (w, x, y, r) => {
    for (const p of personsIn(w, x, y, r)) {
      addTrait(p, 'mutant');
      const g = p.genome;
      g.str *= w.rng.range(0.9, 1.4); g.int *= w.rng.range(0.9, 1.4); g.spd *= w.rng.range(0.9, 1.3); g.hue += w.rng.range(-40, 40);
      const t = w.rng.pick(TRAITS.filter((t) => t.weight > 0));
      addTrait(p, t.id);
    }
    w.fx('magic', x, y, r);
  } }),
  P({ id: 'immortal', name: 'Immortalité', cat: 'manipulation', icon: '♾️', r: 1.5, cost: 20, desc: 'Rend les êtres immortels.', apply: (w, x, y, r) => { for (const p of personsIn(w, x, y, r)) { addTrait(p, 'immortal'); bio(w, p, 'Reçoit l’immortalité.'); p.renown += 20; } } }),
  P({ id: 'age', name: 'Vieillissement', cat: 'manipulation', icon: '⏳', r: 2, cost: 4, desc: 'Fait vieillir de 15 ans.', apply: (w, x, y, r) => { for (const p of personsIn(w, x, y, r)) p.birth -= 15 * DAYS_PER_YEAR; } }),
  P({ id: 'youth', name: 'Jouvence', cat: 'manipulation', icon: '🍼', r: 2, cost: 6, desc: 'Rajeunit de 15 ans.', apply: (w, x, y, r) => { for (const p of personsIn(w, x, y, r)) p.birth = Math.min(w.tick, p.birth + 15 * DAYS_PER_YEAR); } }),
  P({ id: 'madness', name: 'Folie', cat: 'manipulation', icon: '🌀', r: 2, cost: 5, desc: 'Sème la folie et la discorde.', apply: (w, x, y, r) => { for (const p of personsIn(w, x, y, r)) addTrait(p, 'mad'); } }),
  P({ id: 'inspire', name: 'Inspiration', cat: 'manipulation', icon: '🦸', r: 1.5, cost: 10, desc: 'Fait d’un habitant un héros.', apply: (w, x, y, r) => {
    const p = personsIn(w, x, y, r)[0];
    if (!p) return { msg: 'Personne ici.' };
    addTrait(p, 'hero'); addTrait(p, 'brave'); addTrait(p, 'charismatic'); p.renown += 80;
    bio(w, p, 'Touché par l’inspiration divine.');
    w.addHistory('divine', `${p.name} est touché${p.female ? 'e' : ''} par la grâce et devient un héros.`, 2, x, y);
  } }),
  P({ id: 'peace', name: 'Paix divine', cat: 'manipulation', icon: '🕊️', r: 1, cost: 20, cd: 200, desc: 'Impose la paix au royaume touché.', apply: (w, x, y) => {
    const k = kingdomAtPoint(w, x, y);
    if (!k) return { msg: 'Touchez un territoire.' };
    let n = 0;
    for (const war of w.wars.values()) if (war.end < 0 && (war.attackers.includes(k.id) || war.defenders.includes(k.id))) { endWar(w, war, 'white'); n++; }
    w.fx('magic', x, y, 6);
    return { msg: n ? `${n} guerre(s) terminée(s).` : `${k.name} est déjà en paix.` };
  } }),
  P({ id: 'discord', name: 'Discorde', cat: 'manipulation', icon: '⚔️', r: 1, cost: 15, cd: 200, desc: 'Pousse le royaume touché à la guerre contre son voisin.', apply: (w, x, y) => {
    const k = kingdomAtPoint(w, x, y);
    if (!k) return { msg: 'Touchez un territoire.' };
    let best, bd = Infinity;
    const cap = w.settlements.get(k.capital);
    for (const o of w.livingKingdoms()) {
      if (o.id === k.id || w.atWar(k.id, o.id)) continue;
      const oc = w.settlements.get(o.capital);
      if (!cap || !oc) continue;
      const d = (oc.x - cap.x) ** 2 + (oc.y - cap.y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return { msg: 'Aucun voisin.' };
    w.relation(k.id, best.id).truceUntil = 0;
    declareWar(w, k, best, 'intervention divine');
  } }),
  P({ id: 'favor', name: 'Élu', cat: 'manipulation', icon: '👑', r: 1, cost: 10, desc: 'Fait du royaume touché votre peuple élu (bonus).', apply: (w, x, y) => {
    const k = kingdomAtPoint(w, x, y);
    if (!k) return { msg: 'Touchez un territoire.' };
    for (const o of w.kingdoms.values()) o.chosen = false;
    k.chosen = true;
    w.player.chosenKingdom = k.id;
    k.stability = Math.min(100, k.stability + 20);
    k.treasury += 200;
    w.addHistory('divine', `${k.name} devient le peuple élu du Créateur.`, 2, x, y);
  } }),

  // ---- Ultimate
  P({ id: 'blackhole', name: 'Trou noir', cat: 'ultimate', icon: '🕳️', r: 4, cost: 400, cd: 1200, ultimate: true, desc: 'Un trou noir aspire tout pendant de longues secondes.', apply: (w, x, y, r) => {
    startDisaster(w, 'blackhole', x, y, r, 240);
    w.addHistory('divine', 'Un trou noir s’ouvre à la surface du monde !', 3, x, y);
    w.unlock('ultimate:blackhole');
  } }),
  P({ id: 'supernova', name: 'Supernova', cat: 'ultimate', icon: '💥', r: 40, cost: 600, cd: 2400, ultimate: true, desc: 'Une étoile explose : lumière aveuglante et dévastation.', apply: (w, x, y, r) => {
    w.fx('supernova', x, y, r);
    w.sfx('explosion');
    const dead = damageArea(w, x, y, r, 0.6, 'divin');
    w.map.disc(x, y, r, (i, _x, _y, d) => {
      if (w.map.isWater(i)) return;
      if (d < r * 0.5) { w.map.setBiome(i, B.ASH); w.map.timer[i] = 600; w.map.veg[i] = 0; }
      else if (w.rng.chance(0.15)) ignite(w, i, 80);
    });
    w.climate.tempOffset += 0.08;
    w.addHistory('divine', `Une supernova embrase le ciel : ${dead} victimes.`, 3, x, y);
    w.unlock('ultimate:supernova');
  } }),
  P({ id: 'rift', name: 'Faille dimensionnelle', cat: 'ultimate', icon: '🌌', r: 3, cost: 350, cd: 1200, ultimate: true, desc: 'Ouvre une faille d’où surgissent des démons.', apply: (w, x, y, r) => {
    startDisaster(w, 'rift', x, y, r, 300);
    w.addHistory('divine', 'Une faille dimensionnelle se déchire : des démons envahissent le monde !', 3, x, y);
    w.unlock('ultimate:rift');
  } }),
  P({ id: 'aliens', name: 'Invasion extraterrestre', cat: 'ultimate', icon: '🛸', r: 2, cost: 400, cd: 1500, ultimate: true, desc: 'Des vaisseaux venus des étoiles attaquent.', apply: (w, x, y, r) => {
    for (let k = 0; k < 3; k++) startDisaster(w, 'ufo', x + w.rng.range(-10, 10), y + w.rng.range(-10, 10), r, 360);
    w.addHistory('divine', 'Des vaisseaux extraterrestres envahissent le ciel !', 3, x, y);
    w.unlock('ultimate:aliens');
  } }),
  P({ id: 'apocalypse', name: 'Apocalypse', cat: 'ultimate', icon: '☠️', r: 30, cost: 900, cd: 3000, ultimate: true, desc: 'Pluie de météores, feu, peste et démons.', apply: (w, x, y, r) => {
    startDisaster(w, 'meteorshower', x, y, r, 160);
    startDisaster(w, 'rift', x + w.rng.range(-r, r), y + w.rng.range(-r, r), 3, 250);
    startEpidemic(w, x, y, 'Peste de l’Apocalypse');
    w.fx('apocalypse', x, y, r);
    w.addHistory('divine', 'L’Apocalypse s’abat sur le monde.', 3, x, y);
    w.unlock('ultimate:apocalypse');
  } }),
  P({ id: 'iceage', name: 'Âge glaciaire', cat: 'ultimate', icon: '🧊', r: 1, cost: 300, cd: 3000, ultimate: true, desc: 'Plonge le monde dans un hiver de plusieurs décennies.', apply: (w) => startIceAge(w) }),
  P({ id: 'timestop', name: 'Arrêt du temps', cat: 'ultimate', icon: '⏸️', r: 1, cost: 200, cd: 600, ultimate: true, desc: 'Fige le monde : seuls vos pouvoirs agissent.', apply: () => ({ special: 'timestop' }) }),
  P({ id: 'rewind', name: 'Retour dans le temps', cat: 'ultimate', icon: '⏪', r: 1, cost: 500, cd: 1200, ultimate: true, desc: 'Ramène le monde quelques décennies en arrière.', apply: () => ({ special: 'rewind' }) }),
  P({ id: 'terraform', name: 'Terraformation', cat: 'ultimate', icon: '🌍', r: 18, cost: 300, cd: 900, ultimate: true, desc: 'Rend une vaste région fertile et tempérée.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => {
      m.temp[i] = m.temp[i] * 0.5 + 0.28;
      m.humid[i] = m.humid[i] * 0.5 + 0.28;
      w.lava.delete(i);
      m.fire[i] = 0;
      if (m.height[i] > 0.85) m.height[i] = 0.8;
      m.fert[i] = Math.max(m.fert[i], 220);
    });
    reclassArea(w, x, y, r);
    m.disc(x, y, r, (i) => { if (!m.isWater(i)) m.veg[i] = BIOMES[m.biome[i]].veg; });
    w.fx('magic', x, y, r);
    w.addHistory('divine', 'Le Créateur terraforme une région entière.', 2, x, y);
    w.unlock('ultimate:terraform');
  } }),

  // ---- Editor
  ...([
    ['e_plains', 'Plaine', B.PLAINS, '🟩'], ['e_forest', 'Forêt', B.FOREST, '🌲'], ['e_jungle', 'Jungle', B.JUNGLE, '🌴'], ['e_desert', 'Désert', B.DESERT, '🟨'],
    ['e_savanna', 'Savane', B.SAVANNA, '🦒'], ['e_swamp', 'Marais', B.SWAMP, '🐸'], ['e_tundra', 'Toundra', B.TUNDRA, '🟫'], ['e_taiga', 'Taïga', B.TAIGA, '🌲'],
    ['e_glacier', 'Glacier', B.GLACIER, '🧊'], ['e_hills', 'Collines', B.HILLS, '🟢'], ['e_beach', 'Plage', B.BEACH, '🏖️'], ['e_shallow', 'Mer', B.SHALLOW, '🟦'], ['e_ocean', 'Océan', B.OCEAN, '🌊'],
  ] as [string, string, number, string][]).map(([id, name, biome, icon]) => P({
    id, name, cat: 'editor', icon, r: 3, paint: true, cost: 0, desc: `Peindre le biome : ${name}.`,
    apply: (w, x, y, r) => {
      const water = BIOMES[biome].water;
      paintBiome(w, x, y, r, biome, water ? (biome === B.OCEAN ? SEA_LEVEL - 0.1 : SEA_LEVEL - 0.03) : undefined);
      if (!water) w.map.disc(x, y, r, (i) => { if (w.map.height[i] < SEA_LEVEL) w.map.height[i] = SEA_LEVEL + (biome === B.HILLS ? 0.25 : 0.03); });
    },
  })),
  P({ id: 'e_raise', name: 'Élever', cat: 'editor', icon: '⬆️', r: 3, paint: true, cost: 0, desc: 'Élève le terrain.', apply: (w, x, y, r) => raise(w, x, y, r, 0.03) }),
  P({ id: 'e_lower', name: 'Abaisser', cat: 'editor', icon: '⬇️', r: 3, paint: true, cost: 0, desc: 'Abaisse le terrain.', apply: (w, x, y, r) => raise(w, x, y, r, -0.03) }),
  P({ id: 'e_continent', name: 'Continent', cat: 'editor', icon: '🗺️', r: 12, paint: true, cost: 0, desc: 'Fait émerger une masse continentale.', apply: (w, x, y, r) => raise(w, x, y, r, 0.05) }),
  P({ id: 'e_river', name: 'Rivière', cat: 'editor', icon: '🏞️', r: 0.8, paint: true, cost: 0, desc: 'Dessine une rivière.', apply: (w, x, y, r, c) => POWERS.find((p) => p.id === 'river')!.apply(w, x, y, r, c) }),
  ...([
    ['e_iron', 'Fer', D.IRON], ['e_gold', 'Or', D.GOLD], ['e_coal', 'Charbon', D.COAL], ['e_stone', 'Pierre', D.STONE], ['e_rare', 'Éthérium', D.RARE], ['e_oil', 'Pétrole', D.OIL], ['e_fish', 'Poissons', D.FISH],
  ] as [string, string, number][]).map(([id, name, dep]) => P({
    id, name: `Gisement : ${name}`, cat: 'editor', icon: '💎', r: 1, paint: true, cost: 0, desc: `Place un gisement de ${name.toLowerCase()}.`,
    apply: (w, x, y, r) => w.map.disc(x, y, r, (i) => { w.map.deposit[i] = dep; w.map.depositAmt[i] = 2000; w.map.dirty(i); }),
  })),
  P({ id: 'e_erase', name: 'Effacer', cat: 'editor', icon: '🧽', r: 2, paint: true, cost: 0, desc: 'Retire bâtiments, routes et gisements.', apply: (w, x, y, r) => {
    const m = w.map;
    m.disc(x, y, r, (i) => { m.road[i] = 0; m.deposit[i] = 0; if (m.bld[i] >= 0) w.buildings.get(m.bld[i]) && damageArea(w, i % m.w, (i / m.w) | 0, 0.5, 1, 'divin'); m.dirty(i); });
    w.spatialAnimals.query(x, y, r, (a) => { removeAnimal(w, a, false); });
    m.terrainVer++;
  } }),
];

export const powerById = new Map(POWERS.map((p) => [p.id, p]));

/** Powers are free in creative modes, cost faith (with cooldowns) elsewhere. */
export function limitedPowers(w: World): boolean {
  return !['sandbox', 'editor', 'chaos', 'infinite'].includes(w.opts.mode);
}

export const cooldowns = new Map<string, number>();

export function canUse(w: World, p: PowerDef): string | null {
  if (w.opts.mode === 'scenario' && p.ultimate) return 'Pouvoir ultime indisponible en scénario.';
  if (!limitedPowers(w)) {
    const until = cooldowns.get(p.id) ?? -1;
    if (p.ultimate && w.tick < until) return `Recharge : ${Math.ceil((until - w.tick) / 4)} s`;
    return null;
  }
  if (w.player.faith < p.cost) return `Foi insuffisante (${Math.floor(w.player.faith)}/${p.cost})`;
  const until = cooldowns.get(p.id) ?? -1;
  if (w.tick < until) return `Recharge : ${Math.ceil((until - w.tick) / 4)} s`;
  return null;
}

export function usePower(w: World, p: PowerDef, x: number, y: number, r: number, ctx: PowerCtx): PowerResult {
  const res = p.apply(w, x, y, r, ctx) ?? {};
  if (limitedPowers(w)) {
    w.player.faith = Math.max(0, w.player.faith - p.cost * (p.paint ? 0.25 : 1));
    if (p.cd) cooldowns.set(p.id, w.tick + p.cd);
  } else if (p.ultimate) cooldowns.set(p.id, w.tick + 40);
  w.unlock('power:' + p.id);
  return res;
}
