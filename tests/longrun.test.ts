import { describe, expect, it } from 'vitest';
import { RES } from '../src/data/resources';
import { DAYS_PER_YEAR } from '../src/data/time';
import { decode, deserialize, encode, serialize } from '../src/save/serialize';
import { createWorld } from '../src/sim/setup';
import { runTicks } from '../src/sim/simulation';

/**
 * TEST 12 / 56 — long simulations. Looks for NaN, impossible negative values,
 * entity explosions, memory growth, stuck AI and save corruption.
 * Default: 2 worlds x 250 years. LONG_SIM=1: 3 worlds x 600 years.
 */
const LONG = !!process.env.LONG_SIM;
const WORLDS = LONG ? [101, 202, 303] : [101, 202];
const YEARS = LONG ? 600 : 250;

describe('TEST 12 — simulation longue', () => {
  for (const seed of WORLDS) {
    it(`world ${seed} stays healthy for ${YEARS} years`, async () => {
      const w = createWorld({ id: 'l' + seed, name: 'Long', seed, size: 224, shape: seed % 2 ? 'continents' : 'pangea', mode: 'infinite', civs: 6, species: [], climate: 0, moisture: 0, animals: 1 });
      const heapStart = process.memoryUsage().heapUsed;
      let lastEraSum = 0, stagnant = 0;
      for (let y = 0; y < YEARS; y += 25) {
        runTicks(w, 25 * DAYS_PER_YEAR);
        await new Promise((r) => setTimeout(r, 0)); // keep the test worker responsive
        for (const s of w.settlements.values()) {
          expect(Number.isFinite(s.extraPop) && s.extraPop >= 0).toBe(true);
          for (const r of RES) expect(Number.isFinite(s.stock[r]) && s.stock[r] >= 0, `${r}@${w.year}`).toBe(true);
          for (const pid of s.residents) expect(w.persons.has(pid)).toBe(true);
        }
        for (const k of w.kingdoms.values()) {
          expect(Number.isFinite(k.treasury) && k.treasury >= 0).toBe(true);
          if (k.fallen < 0) expect(k.settlements.length).toBeGreaterThan(0);
        }
        expect(w.persons.size).toBeLessThanOrEqual(w.caps.persons + 200);
        expect(w.animals.size).toBeLessThanOrEqual(w.caps.animals * 1.6 + 100);
        expect(w.buildings.size).toBeLessThan(60000);
        expect(w.pathfinder.pending).toBeLessThan(500);
        expect(w.fires.size).toBeLessThanOrEqual(4000);
        expect(w.history.length).toBeLessThanOrEqual(4001);
        expect(w.ancestors.size).toBeLessThan(40000);
        const eraSum = w.livingKingdoms().reduce((a, k) => a + k.era, 0);
        stagnant = eraSum === lastEraSum ? stagnant + 1 : 0;
        lastEraSum = eraSum;
      }
      // the world must not freeze in place for 200 years
      expect(stagnant).toBeLessThan(8);
      // the world is alive (people or animals)
      expect(w.totalPop() + w.animals.size).toBeGreaterThan(0);
      // a save of the final state is valid and reloadable
      const loaded = deserialize(await decode(await encode(serialize(w))));
      expect(loaded.totalPop()).toBe(w.totalPop());
      const heapEnd = process.memoryUsage().heapUsed;
      expect((heapEnd - heapStart) / 1e6).toBeLessThan(900);
      console.log(`seed ${seed}: year ${w.year}, pop ${w.totalPop()}, kingdoms ${w.livingKingdoms().length}, wars ${w.wars.size}, heap +${((heapEnd - heapStart) / 1e6).toFixed(0)}MB`);
    }, LONG ? 3_600_000 : 900_000);
  }
});
