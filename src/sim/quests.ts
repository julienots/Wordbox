import { B } from '../data/biomes';
import type { World } from './world';

export interface QuestDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** Progress 0..1 */
  progress: (w: World) => number;
}

const kingdomMaxPop = (w: World) => Math.max(0, ...w.livingKingdoms().map((k) => w.kingdomPop(k)));

export const QUESTS: QuestDef[] = [
  { id: 'pop10k', name: 'Grande nation', icon: '👥', desc: 'Une civilisation atteint 10 000 habitants.', progress: (w) => kingdomMaxPop(w) / 10000 },
  { id: 'worldwar', name: 'Guerre mondiale', icon: '🌐', desc: 'Une guerre implique au moins 4 nations.', progress: (w) => Math.max(0, ...[...w.wars.values()].filter((x) => x.end < 0).map((x) => x.attackers.length + x.defenders.length)) / 4 },
  { id: 'space', name: 'Vers les étoiles', icon: '🚀', desc: 'Une civilisation lance une fusée.', progress: (w) => (w.stats.rockets > 0 ? 1 : Math.max(0, ...w.livingKingdoms().map((k) => k.era)) / 12) },
  { id: 'colony', name: 'Nouveau monde', icon: '🪐', desc: 'Coloniser une autre planète.', progress: (w) => Math.min(1, w.stats.colonies) },
  { id: 'rescue', name: 'Sauveur', icon: '🛟', desc: 'Une civilisation réduite à une seule ville renaît (4 villes).', progress: (w) => (w.questState.rescued ? 1 : 0) },
  { id: 'desert', name: 'Planète désertique', icon: '🏜️', desc: '70 % des terres sont des déserts.', progress: (w) => (w.questState.desertShare ?? 0) / 0.7 },
  { id: 'extinction', name: 'Extinction', icon: '🦴', desc: 'Faire disparaître une espèce animale.', progress: (w) => Math.min(1, w.stats.extinctions) },
  { id: 'pacifist', name: 'Peuple pacifique', icon: '🕊️', desc: 'Une civilisation vit 200 ans sans jamais faire la guerre.', progress: (w) => (w.questState.pacifistYears ?? 0) / 200 },
  { id: 'empire', name: 'Imperium', icon: '👑', desc: 'Un empire est proclamé.', progress: (w) => (w.livingKingdoms().some((k) => k.government === 'empire') ? 1 : 0) },
  { id: 'federation', name: 'Union des peuples', icon: '🤝', desc: 'Une fédération est créée.', progress: (w) => Math.min(1, w.federations.size) },
  { id: 'godhood', name: 'Divinité', icon: '🙏', desc: '1 000 fidèles vous vénèrent.', progress: (w) => Math.max(0, ...[...w.religions.values()].filter((r) => r.playerGod).map((r) => r.followers)) / 1000 },
  { id: 'legends', name: 'Âge des légendes', icon: '🦸', desc: '10 personnages célèbres.', progress: (w) => w.famous.length / 10 },
  { id: 'millennium', name: 'Millénaire', icon: '⏳', desc: 'Le monde atteint l’an 1000.', progress: (w) => w.year / 1000 },
  { id: 'doom', name: 'Fin du monde', icon: '☠️', desc: 'Toute vie intelligente disparaît après avoir dépassé 500 âmes.', progress: (w) => (w.stats.maxPop >= 500 && w.totalPop() === 0 ? 1 : 0) },
];

/** Yearly quest evaluation (expensive scans happen here only). */
export function updateQuests(w: World): void {
  // desert share
  let land = 0, desert = 0;
  const m = w.map;
  for (let i = 0; i < m.size; i += 3) {
    if (m.isWater(i)) continue;
    land++;
    if (m.biome[i] === B.DESERT) desert++;
  }
  w.questState.desertShare = land ? desert / land : 0;
  // pacifist: oldest kingdom that never went to war
  let best = 0;
  for (const k of w.livingKingdoms()) {
    const warred = [...w.wars.values()].some((x) => x.attackers.includes(k.id) || x.defenders.includes(k.id));
    if (!warred) best = Math.max(best, (w.tick - k.founded) / 120);
  }
  w.questState.pacifistYears = best;
  // rescue tracking
  for (const k of w.livingKingdoms()) {
    const key = 'low:' + k.id;
    if (k.settlements.length === 1 && k.conquests >= 3) w.questState[key] = 1;
    if (w.questState[key] && k.settlements.length >= 4) w.questState.rescued = 1;
  }
  for (const q of QUESTS) {
    if (w.questsDone.has(q.id)) continue;
    if (q.progress(w) >= 1) {
      w.questsDone.add(q.id);
      w.bus.emit('quest', { id: q.id, name: q.name });
      w.addHistory('world', `Défi accompli : ${q.name}.`, 1);
    }
  }
}
