import { ERAS } from '../data/techs';
import { speciesById } from '../data/species';
import { DAYS_PER_YEAR } from '../data/time';
import { POWERS, usePower } from './powers';
import { startIceAge } from './climate';
import { declareWar } from './war';
import type { GameMode, World } from './world';

export interface ModeDef {
  id: GameMode;
  name: string;
  icon: string;
  desc: string;
  goal: string;
}

export const MODES: ModeDef[] = [
  { id: 'sandbox', name: 'Bac à sable', icon: '🏖️', desc: 'Pouvoirs illimités, aucune contrainte.', goal: 'Expérimentez librement.' },
  { id: 'survival', name: 'Survie', icon: '🛡️', desc: 'Vos pouvoirs coûtent de la foi. Protégez votre peuple élu.', goal: 'Gardez votre peuple élu en vie pendant 300 ans.' },
  { id: 'apocalypse', name: 'Apocalypse', icon: '☄️', desc: 'Les catastrophes s’intensifient sans cesse.', goal: 'Qu’au moins une civilisation survive 200 ans.' },
  { id: 'civilization', name: 'Civilisation', icon: '🏛️', desc: 'Suivez et guidez une civilisation.', goal: 'Menez votre peuple élu jusqu’à l’ère spatiale.' },
  { id: 'chaos', name: 'Chaos', icon: '🎲', desc: 'Événements aléatoires permanents, les dieux sont fous.', goal: 'Survivez au chaos.' },
  { id: 'scenario', name: 'Scénario', icon: '📜', desc: 'Défis prédéfinis avec objectifs.', goal: 'Selon le scénario.' },
  { id: 'evolution', name: 'Évolution', icon: '🧬', desc: 'Peuples primitifs, mutations rapides.', goal: 'Faites évoluer une espèce (intelligence moyenne ≥ 1,5) et atteignez l’Âge du fer.' },
  { id: 'infinite', name: 'Infini', icon: '♾️', desc: 'Simulation sans objectif ni fin.', goal: 'Observez le monde vivre.' },
  { id: 'editor', name: 'Éditeur de monde', icon: '🛠️', desc: 'Sculptez le monde avant de lancer la simulation.', goal: 'Créez votre monde.' },
];

export interface ScenarioDef {
  id: string;
  name: string;
  desc: string;
  civs: number;
  setup: (w: World) => void;
  check: (w: World) => 'win' | 'lose' | null;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'last_bastion', name: 'Le Dernier Rempart', desc: 'Votre peuple est encerclé d’ennemis. Survivez 150 ans.', civs: 5,
    setup: (w) => {
      const ks = w.livingKingdoms();
      const me = ks[0];
      if (!me) return;
      me.chosen = true;
      w.player.chosenKingdom = me.id;
      for (const o of ks.slice(1)) { w.relation(me.id, o.id).contact = true; w.relation(me.id, o.id).opinion = -80; }
      w.player.objectiveYear = 150;
    },
    check: (w) => (w.kingdoms.get(w.player.chosenKingdom)?.fallen ?? 0) >= 0 ? 'lose' : w.year >= 150 ? 'win' : null,
  },
  {
    id: 'space_race', name: 'La Course aux étoiles', desc: 'Une civilisation doit lancer une fusée avant l’an 700.', civs: 6,
    setup: (w) => { w.player.objectiveYear = 700; },
    check: (w) => (w.stats.rockets > 0 ? 'win' : w.year >= 700 ? 'lose' : null),
  },
  {
    id: 'eternal_winter', name: 'L’Hiver éternel', desc: 'Un âge glaciaire commence. Gardez 300 habitants en l’an 120.', civs: 5,
    setup: (w) => { startIceAge(w, 150); w.player.objectiveYear = 120; },
    check: (w) => (w.totalPop() < 30 && w.year > 5 ? 'lose' : w.year >= 120 ? (w.totalPop() >= 300 ? 'win' : 'lose') : null),
  },
  {
    id: 'pax', name: 'Pax Mundi', desc: 'Aucune guerre ne doit éclater entre l’an 100 et l’an 250.', civs: 6,
    setup: (w) => { w.player.objectiveYear = 250; },
    check: (w) => {
      const late = [...w.wars.values()].some((x) => x.start >= 100 * DAYS_PER_YEAR);
      if (late) return 'lose';
      return w.year >= 250 ? 'win' : null;
    },
  },
  {
    id: 'clash', name: 'Le Choc des Titans', desc: 'Deux empires rivaux s’affrontent dès l’origine. Faites triompher l’un d’eux.', civs: 2,
    setup: (w) => {
      const [a, b] = w.livingKingdoms();
      if (a && b) { a.techs.push('stone_tools', 'hunting', 'bronze', 'agriculture', 'pottery'); b.techs.push('stone_tools', 'hunting', 'bronze', 'agriculture', 'pottery'); a.era = b.era = 3; declareWar(w, a, b, 'rivalité'); }
    },
    check: (w) => (w.livingKingdoms().length === 1 && w.year > 1 ? 'win' : w.livingKingdoms().length === 0 ? 'lose' : null),
  },
];

export function setupMode(w: World): void {
  const ks = w.livingKingdoms();
  if (['survival', 'civilization'].includes(w.opts.mode) && ks[0]) {
    ks[0].chosen = true;
    w.player.chosenKingdom = ks[0].id;
    w.player.faith = 150;
  }
  if (w.opts.mode === 'apocalypse') w.player.faith = 300;
  if (w.opts.mode === 'scenario') SCENARIOS.find((s) => s.id === w.opts.scenario)?.setup(w);
}

function finish(w: World, won: boolean, text: string): void {
  if (w.player.won || w.player.lost) return;
  if (won) w.player.won = true; else w.player.lost = true;
  w.addHistory('world', text, 3);
  w.bus.emit('toast', { text, kind: won ? 'win' : 'lose' });
  w.unlock('mode:' + w.opts.mode + (won ? ':win' : ':lose'));
}

/** Monthly mode rules: faith regeneration, chaos director, objectives. */
export function updateMode(w: World): void {
  const mode = w.opts.mode;
  w.player.faith = Math.min(9999, w.player.faith + (mode === 'apocalypse' ? 4 : 2));
  const chosen = w.kingdoms.get(w.player.chosenKingdom);
  if (chosen && chosen.fallen < 0) w.player.faith += 0.5 + chosen.settlements.length * 0.2;
  if (mode === 'chaos' && w.rng.chance(0.15)) {
    const pool = POWERS.filter((p) => ['destruction', 'manipulation', 'life', 'nature'].includes(p.cat) && !p.ultimate && p.id !== 'teleport');
    const p = w.rng.pick(pool);
    const x = w.rng.int(10, w.map.w - 10), y = w.rng.int(10, w.map.h - 10);
    usePower(w, p, x, y, p.r, { held: { persons: [], animals: [] }, param: undefined });
    w.bus.emit('toast', { text: `Le chaos frappe : ${p.name} !`, kind: 'chaos' });
  }
  if (w.tick % DAYS_PER_YEAR !== 0) return;
  switch (mode) {
    case 'survival':
      if (chosen && chosen.fallen >= 0) finish(w, false, `Défaite : votre peuple élu (${chosen.name}) a disparu.`);
      else if (w.year >= 300) finish(w, true, 'Victoire : votre peuple a survécu trois siècles !');
      break;
    case 'apocalypse':
      if (w.livingKingdoms().length === 0 && w.year > 2) finish(w, false, 'Défaite : plus aucune civilisation ne survit.');
      else if (w.year >= 200) finish(w, true, 'Victoire : la vie a résisté à l’Apocalypse !');
      break;
    case 'civilization':
      if (chosen && chosen.fallen >= 0) finish(w, false, `Défaite : ${chosen.name} est tombé.`);
      else if (chosen && chosen.era >= 12) finish(w, true, `Victoire : ${chosen.name} atteint l’${ERAS[12]} !`);
      break;
    case 'evolution': {
      const bySp = new Map<string, [number, number]>();
      for (const p of w.persons.values()) {
        const e = bySp.get(p.species) ?? [0, 0];
        e[0] += p.genome.int; e[1]++;
        bySp.set(p.species, e);
      }
      for (const [sp, [sum, n]] of bySp) {
        const avg = sum / n;
        w.questState['evo:' + sp] = avg;
        if (avg >= 1.5 && w.livingKingdoms().some((k) => k.species === sp && k.era >= 4)) finish(w, true, `Victoire : les ${speciesById(sp).plural} ont évolué vers l’intelligence !`);
      }
      break;
    }
    case 'scenario': {
      const sc = SCENARIOS.find((s) => s.id === w.opts.scenario);
      const r = sc?.check(w);
      if (r) finish(w, r === 'win', r === 'win' ? `Scénario réussi : ${sc!.name} !` : `Scénario échoué : ${sc!.name}.`);
      break;
    }
  }
}
