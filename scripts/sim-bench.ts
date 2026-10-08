// Dev tool: headless simulation benchmark & sanity report.
// Usage: npx vite-node scripts/sim-bench.ts -- [years] [size] [seed] [mode]
import { createWorld } from '../src/sim/setup';
import { step, perf } from '../src/sim/simulation';
import { DAYS_PER_YEAR } from '../src/data/time';
import { ERAS } from '../src/data/techs';
import type { GameMode } from '../src/sim/world';

const [years = '100', size = '256', seed = '42', mode = 'infinite'] = process.argv.slice(2).filter((a) => a !== '--');
const t0 = performance.now();
const w = createWorld({ id: 'bench', name: 'Bench', seed: Number(seed), size: Number(size), shape: 'continents', mode: mode as GameMode, civs: 6, species: [], climate: 0, moisture: 0, animals: 1 });
console.log(`world created in ${Math.round(performance.now() - t0)} ms`);
const t1 = performance.now();
for (let y = 1; y <= Number(years); y++) {
  const ty = performance.now();
  for (let d = 0; d < DAYS_PER_YEAR; d++) step(w);
  if (y % 25 === 0 || y === 1) {
    const ks = w.livingKingdoms();
    console.log(`year ${w.year} | ${(performance.now() - ty).toFixed(0)}ms/yr | pop ${w.totalPop()} indiv ${w.persons.size} | animals ${w.animals.size} | settl ${w.settlements.size} | kingdoms ${ks.length} | eras ${ks.map((k) => k.era).join(',')} | wars ${[...w.wars.values()].filter((x) => x.end < 0).length}/${w.wars.size} | bld ${w.buildings.size} | fires ${w.fires.size}`);
  }
}
console.log(`total ${((performance.now() - t1) / 1000).toFixed(1)} s`);
console.log('perf ms/tick', Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, v.toFixed(3)])));
for (const k of w.kingdoms.values()) console.log(`${k.name} ${k.government} era=${ERAS[k.era]} pop=${w.kingdomPop(k)} settl=${k.settlements.length} stab=${k.stability.toFixed(0)} treas=${k.treasury.toFixed(0)} fallen=${k.fallen}`);
console.log('--- history (imp>=2, last 40)');
for (const h of w.history.filter((h) => h.imp >= 2).slice(-40)) console.log(`An ${Math.floor(h.tick / DAYS_PER_YEAR)}: ${h.text}`);
