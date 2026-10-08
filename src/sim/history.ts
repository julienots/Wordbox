import { Person } from './entities';
import { ageOf, fullName, has } from './person';
import type { World } from './world';

export const HISTORY_TYPES: Record<string, string> = {
  found: 'Fondations', settlement: 'Cités', war: 'Guerres', battle: 'Batailles', peace: 'Paix', politics: 'Politique',
  ruler: 'Souverains', diplomacy: 'Diplomatie', tech: 'Technologies', disaster: 'Catastrophes', climate: 'Climat',
  religion: 'Religions', culture: 'Cultures', ecology: 'Écologie', hero: 'Héros', death: 'Décès', fall: 'Chutes',
  build: 'Merveilles', space: 'Espace', explore: 'Exploration', event: 'Événements', divine: 'Interventions divines', world: 'Monde',
};

function roleOf(w: World, p: Person): string {
  if (p.title.includes('de ') && (p.prof === 'leader' || p.title.match(/Roi|Reine|Empereur|Impératrice|Chef|Président|Consul|Archonte|prêtre/))) {
    return has(p, 'cruel') || has(p, 'brutal') ? 'Tyran' : 'Souverain';
  }
  if (p.prof === 'soldier' || p.title.startsWith('Général')) return 'Général';
  if (p.prof === 'scholar' || has(p, 'genius')) return 'Savant';
  if (p.prof === 'priest') return 'Prophète';
  if (p.log.some((l) => l[1].startsWith('Fonde') || l[1].startsWith('Mène une expédition'))) return 'Explorateur';
  if (has(p, 'hero')) return 'Héros';
  return 'Personnalité';
}

/** Yearly: statistics series & hall of fame. */
export function updateHistoryYearly(w: World): void {
  let wealth = 0, tech = 0;
  const ks = w.livingKingdoms();
  for (const k of ks) { wealth += k.wealth; tech = Math.max(tech, k.era); }
  w.series.push({
    year: w.year, pop: w.totalPop(), kingdoms: ks.length, animals: w.animals.size,
    wars: [...w.wars.values()].filter((x) => x.end < 0).length, wealth: Math.round(wealth), tech,
  });
  if (w.series.length > 2000) w.series = w.series.filter((_, i) => i % 2 === 0);
  // hall of fame
  for (const p of w.persons.values()) {
    if (p.renown < 90) continue;
    const existing = w.famous.find((f) => f.id === p.id);
    const k = w.kingdoms.get(p.kingdom);
    if (existing) { existing.renown = Math.round(p.renown); existing.role = roleOf(w, p); continue; }
    const role = roleOf(w, p);
    w.famous.push({ id: p.id, name: fullName(w, p), role, reason: p.log.at(-1)?.[1] ?? '', birth: p.birth, death: -1, renown: Math.round(p.renown), kingdom: k?.name ?? '' });
    w.addHistory('hero', `${fullName(w, p)} entre dans la légende (${role.toLowerCase()}, ${Math.floor(ageOf(w, p))} ans).`, 2, p.x, p.y);
    w.unlock('famous:' + p.id);
  }
  if (w.famous.length > 300) {
    w.famous.sort((a, b) => b.renown - a.renown);
    w.famous.length = 300;
  }
}
