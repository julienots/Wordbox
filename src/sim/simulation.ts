import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../data/time';
import { updateClimate, updateWeather } from './climate';
import { updateCultures } from './culture';
import { updateDiplomacy } from './diplomacy';
import { randomDisasters, updateDisasters, updateEpidemics } from './disasters';
import { updateAnimals, updateFauna, updateVegetation } from './ecosystem';
import { PS } from './entities';
import { randomEvents } from './events';
import { updateHistoryYearly } from './history';
import { updateKingdom } from './kingdom';
import { updateMode } from './modes';
import { updateLives, updatePersons } from './population';
import { updateQuests } from './quests';
import { destroySettlement, trySettlers, updateExpeditions, updateSettlement } from './settlement';
import { updateSpace } from './space';
import { planRoutes, updatePrices, updateTrade } from './trade';
import { updateArmies, updateWars } from './war';
import type { World } from './world';

/** Timing of each system, for the debug overlay. */
export const perf: Record<string, number> = {};

function timed(name: string, fn: () => void): void {
  const t = performance.now();
  fn();
  perf[name] = (perf[name] ?? 0) * 0.9 + (performance.now() - t) * 0.1;
}

/**
 * One simulation tick (= one day). Systems run at different frequencies:
 *  every tick : spatial index, pathfinding queue, people & animal behaviour (LOD-throttled), armies, hazards, weather
 *  rolling    : vegetation (1/30 of the map per tick)
 *  monthly    : settlements & lives (staggered by id across the 10 days), kingdoms, trade, diplomacy, wars, climate, events
 *  yearly     : history/statistics, culture drift, space programs, quests
 */
export function step(w: World): void {
  w.tick++;
  const m = w.map;
  timed('spatial', () => {
    w.spatialPersons.clear();
    for (const p of w.persons.values()) if (p.state !== PS.ARMY) w.spatialPersons.insert(p);
    w.spatialAnimals.clear();
    for (const a of w.animals.values()) w.spatialAnimals.insert(a);
  });
  timed('path', () => w.pathfinder.process(w.focus ? 16 : 40));
  timed('persons', () => updatePersons(w));
  timed('animals', () => updateAnimals(w));
  timed('armies', () => updateArmies(w));
  timed('disasters', () => updateDisasters(w));
  timed('weather', () => updateWeather(w));
  timed('vegetation', () => updateVegetation(w));
  updateExpeditions(w);

  const day = w.tick % DAYS_PER_MONTH;
  timed('settlements', () => {
    for (const s of [...w.settlements.values()]) {
      if (s.id % DAYS_PER_MONTH !== day) continue;
      if (s.pop <= 0 && w.tick - s.founded > DAYS_PER_MONTH * 3) { destroySettlement(w, s, 'dépeuplée'); continue; }
      updateSettlement(w, s);
      updatePrices(s);
      trySettlers(w, s);
    }
  });
  timed('lives', () => updateLives(w));
  timed('fauna', () => updateFauna(w));
  timed('kingdoms', () => {
    for (const k of w.kingdoms.values()) if (k.fallen < 0 && k.id % DAYS_PER_MONTH === day) updateKingdom(w, k);
  });
  if (day === 5) {
    timed('diplomacy', () => updateDiplomacy(w));
    timed('trade', () => { updateTrade(w); planRoutes(w); });
    updateWars(w);
    updateClimate(w);
    updateEpidemics(w);
    randomDisasters(w);
    randomEvents(w);
    updateMode(w);
    // purge ended disasters' bookkeeping & stale graveyard
    if (w.graveyard.length && w.tick - w.graveyard[0].tick > DAYS_PER_YEAR * 10) w.graveyard.shift();
  }
  if (w.tick % DAYS_PER_YEAR === 0) {
    updateHistoryYearly(w);
    updateCultures(w);
    updateSpace(w);
    updateQuests(w);
  }
  void m;
}

/** Fast-forward n ticks without a camera focus (all far LOD): used by offline progress & tests. */
export function runTicks(w: World, n: number): void {
  const f = w.focus;
  w.focus = null;
  for (let i = 0; i < n; i++) step(w);
  w.focus = f;
}
