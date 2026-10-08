import { createWorld } from '../src/sim/setup';
import { step } from '../src/sim/simulation';
import { DAYS_PER_YEAR } from '../src/data/time';
const w = createWorld({ id: 'd', name: 'D', seed: 42, size: 256, shape: 'continents', mode: 'infinite', civs: 6, species: [], climate: 0, moisture: 0, animals: 1 });
for (let y = 1; y <= 110; y++) {
  for (let d = 0; d < DAYS_PER_YEAR; d++) step(w);
  if (y % 10 === 0) {
    const causes: Record<string, number> = {};
    for (const a of w.ancestors.values()) causes[a.cause] = (causes[a.cause] ?? 0) + 1;
    const ss = [...w.settlements.values()].slice(0, 4).map((s) => `${s.name}[pop ${s.pop} r${s.residents.length} x${s.extraPop.toFixed(1)} food ${s.stock.food.toFixed(0)} bal ${s.foodBalance.toFixed(0)} hous ${s.housing} hap ${s.happiness.toFixed(0)} hl ${s.health.toFixed(0)} inf ${s.infected.toFixed(2)} jobs ${JSON.stringify(s.jobs)}]`);
    console.log(`Y${y} births ${w.stats.births} deaths ${w.stats.deaths}`, causes);
    for (const s of ss) console.log('   ', s);
  }
}
