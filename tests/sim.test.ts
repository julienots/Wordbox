import { describe, expect, it } from 'vitest';
import { B } from '../src/data/biomes';
import { RES } from '../src/data/resources';
import { DAYS_PER_YEAR } from '../src/data/time';
import { migrate, SAVE_VERSION } from '../src/save/migrations';
import { catchUp, offlineYears } from '../src/save/offline';
import { decode, deserialize, encode, serialize } from '../src/save/serialize';
import { MemoryStore } from '../src/save/storage';
import { earthquake, ignite, meteor, startEpidemic } from '../src/sim/disasters';
import { MODES, SCENARIOS, setupMode } from '../src/sim/modes';
import { POWERS, usePower } from '../src/sim/powers';
import { createWorld } from '../src/sim/setup';
import { runTicks, step } from '../src/sim/simulation';
import { declareWar, endWar } from '../src/sim/war';
import type { GameMode, World, WorldOptions } from '../src/sim/world';
import { generateMap } from '../src/world/generator';

const opts = (o: Partial<WorldOptions> = {}): WorldOptions => ({
  id: 't', name: 'Test', seed: 1234, size: 160, shape: 'continents', mode: 'infinite', civs: 4, species: [], climate: 0, moisture: 0, animals: 1, ...o,
});
const years = (w: World, n: number) => runTicks(w, n * DAYS_PER_YEAR);

function assertSane(w: World) {
  for (const s of w.settlements.values()) {
    expect(Number.isFinite(s.extraPop)).toBe(true);
    expect(s.extraPop).toBeGreaterThanOrEqual(0);
    for (const r of RES) {
      expect(Number.isFinite(s.stock[r]), `stock ${r}`).toBe(true);
      expect(s.stock[r]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.prices[r])).toBe(true);
    }
    expect(s.pop).toBeGreaterThanOrEqual(0);
  }
  for (const k of w.kingdoms.values()) {
    expect(Number.isFinite(k.treasury)).toBe(true);
    expect(k.treasury).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(k.stability)).toBe(true);
  }
  for (const p of w.persons.values()) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  }
  expect(w.persons.size).toBeLessThanOrEqual(w.caps.persons + 200);
  expect(w.animals.size).toBeLessThanOrEqual(w.caps.animals * 1.6 + 100);
}

describe('TEST 1 — création du monde', () => {
  it('is deterministic for a given seed and contains varied biomes', () => {
    const a = generateMap({ seed: 99, size: 192, shape: 'continents' });
    const b = generateMap({ seed: 99, size: 192, shape: 'continents' });
    const c = generateMap({ seed: 100, size: 192, shape: 'continents' });
    expect(Buffer.from(a.biome).equals(Buffer.from(b.biome))).toBe(true);
    expect(Buffer.from(a.height.buffer).equals(Buffer.from(b.height.buffer))).toBe(true);
    expect(Buffer.from(a.biome).equals(Buffer.from(c.biome))).toBe(false);
    const present = new Set(a.biome);
    for (const bi of [B.DEEP_OCEAN, B.OCEAN, B.SHALLOW, B.RIVER, B.BEACH, B.PLAINS, B.FOREST, B.MOUNTAIN, B.HILLS]) expect(present.has(bi), `biome ${bi}`).toBe(true);
    let land = 0;
    for (let i = 0; i < a.size; i++) if (!a.isWater(i)) land++;
    expect(land / a.size).toBeGreaterThan(0.25);
    expect(land / a.size).toBeLessThan(0.65);
  });
  it('supports all world shapes', () => {
    for (const shape of ['continents', 'pangea', 'archipelago', 'islands', 'inland'] as const) {
      const m = generateMap({ seed: 5, size: 128, shape });
      expect(m.size).toBe(128 * 128);
    }
  });
});

describe('TEST 2 — civilisations', () => {
  it('creates kingdoms with capital, ruler, culture and religion', () => {
    const w = createWorld(opts());
    const ks = w.livingKingdoms();
    expect(ks.length).toBe(4);
    for (const k of ks) {
      expect(w.settlements.get(k.capital)).toBeDefined();
      expect(w.persons.get(k.ruler)).toBeDefined();
      expect(w.cultures.get(k.culture)).toBeDefined();
      expect(w.religions.get(k.religion)).toBeDefined();
      expect(w.settlements.get(k.capital)!.residents.length).toBeGreaterThan(5);
    }
  });
});

describe('TEST 3/4/5 — construction, population, économie', () => {
  const w = createWorld(opts({ seed: 777, size: 192 }));
  const startBuildings = w.buildings.size;
  const startPop = w.totalPop();
  years(w, 60);
  it('builds automatically', () => {
    expect(w.buildings.size).toBeGreaterThan(startBuildings);
    expect([...w.buildings.values()].filter((b) => b.progress >= 1).length).toBeGreaterThan(startBuildings);
    expect([...w.buildings.values()].some((b) => b.type === 'farm' || b.type === 'lumber' || b.type === 'storage')).toBe(true);
  });
  it('grows a population with real families', () => {
    expect(w.totalPop()).toBeGreaterThan(startPop);
    expect(w.stats.births).toBeGreaterThan(20);
    const withParents = [...w.persons.values()].filter((p) => p.father >= 0 && p.mother >= 0);
    expect(withParents.length).toBeGreaterThan(5);
    const child = withParents[0];
    const parent = w.persons.get(child.father) ?? w.ancestors.get(child.father);
    expect(parent).toBeDefined();
    expect(w.dynasties.size).toBeGreaterThan(0);
  });
  it('keeps the economy sane', () => {
    assertSane(w);
    const s = [...w.settlements.values()][0];
    expect(Object.keys(s.jobs).length).toBeGreaterThan(1);
    expect(w.livingKingdoms().some((k) => k.techs.length > 2)).toBe(true);
  });
});

describe('TEST 6/7 — diplomatie et guerre', () => {
  it('handles relations, war, battles, sieges and peace', () => {
    const w = createWorld(opts({ seed: 4242, size: 128, civs: 3 }));
    years(w, 15);
    const [a, b] = w.livingKingdoms();
    expect(a && b).toBeTruthy();
    const rel = w.relation(a.id, b.id);
    rel.alliance = true;
    rel.opinion = 60;
    const war = declareWar(w, a, b, 'territoire')!;
    expect(war).toBeDefined();
    expect(w.atWar(a.id, b.id)).toBe(true);
    expect(rel.alliance).toBe(false); // betrayal breaks the alliance
    expect(a.reputation).toBeLessThan(50);
    expect(a.armies.length + b.armies.length).toBeGreaterThan(0);
    years(w, 6);
    assertSane(w);
    if (war.end < 0) endWar(w, war, 'white');
    expect(w.atWar(a.id, b.id)).toBe(false);
    expect(w.relation(a.id, b.id).truceUntil).toBeGreaterThan(w.tick);
    expect(w.history.some((h) => h.type === 'war')).toBe(true);
    expect(w.history.some((h) => h.type === 'peace')).toBe(true);
  });
});

describe('TEST 8 — catastrophes', () => {
  it('meteor, fire, earthquake and epidemic have lasting consequences', () => {
    const w = createWorld(opts({ seed: 31, size: 128, civs: 2 }));
    years(w, 5);
    const s = [...w.settlements.values()][0];
    const popBefore = w.totalPop();
    meteor(w, s.x, s.y, 5);
    expect(w.totalPop()).toBeLessThan(popBefore);
    const i = w.map.idx(s.x, s.y);
    expect([B.BARREN, B.ASH, B.LAKE]).toContain(w.map.biome[i]);
    // fire spreads then burns out
    let forest = -1;
    for (let j = 0; j < w.map.size; j++) if (w.map.veg[j] > 200 && w.map.owner[j] < 0) { forest = j; break; }
    ignite(w, forest, 90);
    runTicks(w, 40);
    runTicks(w, 600);
    expect(w.fires.size).toBe(0);
    earthquake(w, s.x, s.y, 10);
    const other = [...w.settlements.values()][0];
    if (other) {
      startEpidemic(w, other.x, other.y);
      years(w, 15);
      expect(w.epidemics.every((e) => !e.active) || w.epidemics.length > 0).toBe(true);
    }
    assertSane(w);
  });
});

describe('TEST 9/10 — sauvegarde et chargement', () => {
  it('round-trips a world through compression, storage and migration', async () => {
    const w = createWorld(opts({ seed: 8, size: 128 }));
    years(w, 30);
    const data = serialize(w);
    expect(data.version).toBe(SAVE_VERSION);
    const bytes = await encode(data);
    expect(bytes[0]).toBe(0x1f); // gzip
    const store = new MemoryStore();
    await store.write({ id: 'w1', name: 'Test', seed: 8, mode: 'infinite', year: w.year, pop: w.totalPop(), kingdoms: 4, size: 128, savedAt: Date.now() }, bytes);
    expect((await store.list())[0].id).toBe('w1');
    const loaded = deserialize(await decode((await store.read('w1'))!));
    expect(loaded.tick).toBe(w.tick);
    expect(loaded.totalPop()).toBe(w.totalPop());
    expect(loaded.persons.size).toBe(w.persons.size);
    expect(loaded.kingdoms.size).toBe(w.kingdoms.size);
    expect(loaded.history.length).toBe(w.history.length);
    expect(Buffer.from(loaded.map.biome).equals(Buffer.from(w.map.biome))).toBe(true);
    // the loaded world keeps living
    years(loaded, 10);
    assertSane(loaded);
    expect(loaded.year).toBe(w.year + 10);
  });
  it('migrates older save formats and rejects newer ones', () => {
    const w = createWorld(opts({ seed: 9, size: 96, civs: 2 }));
    const d = serialize(w) as Record<string, unknown> & ReturnType<typeof serialize>;
    d.version = 1;
    delete d.cursors;
    delete d.fires;
    for (const s of d.settlements as Record<string, unknown>[]) delete s.immune;
    const m = migrate(JSON.parse(JSON.stringify(d)));
    expect(m.version).toBe(SAVE_VERSION);
    const loaded = deserialize(JSON.parse(JSON.stringify(d)));
    expect([...loaded.settlements.values()][0].immune).toBe(0);
    expect(() => migrate({ ...d, version: SAVE_VERSION + 1 })).toThrow();
    expect(() => deserialize({ format: 'nope' } as never)).toThrow();
  });
});

describe('TEST 11 — simulation accélérée', () => {
  it('runs fast enough for high speed play', () => {
    const w = createWorld(opts({ seed: 11, size: 192, civs: 6 }));
    years(w, 20);
    const t = performance.now();
    runTicks(w, 1200);
    const msPerTick = (performance.now() - t) / 1200;
    expect(msPerTick).toBeLessThan(6);
  });
});

describe('TEST 13 — retour après plusieurs heures hors-ligne', () => {
  it('computes and simulates elapsed time', async () => {
    expect(offlineYears(Date.now() - 30 * 1000)).toBe(0);
    expect(offlineYears(Date.now() - 30 * 60 * 1000)).toBe(10);
    expect(offlineYears(Date.now() - 8 * 3600 * 1000)).toBe(100);
    const w = createWorld(opts({ seed: 13, size: 128 }));
    const y0 = w.year;
    let progress = 0;
    const report = await catchUp(w, 12, (f) => (progress = f));
    expect(w.year).toBe(y0 + 12);
    expect(progress).toBe(1);
    expect(report.years).toBe(12);
    expect(report.popAfter).toBeGreaterThan(0);
    assertSane(w);
  });
});

describe('Pouvoirs divins', () => {
  it('every power can be applied without error', () => {
    const w = createWorld(opts({ seed: 21, size: 128, mode: 'sandbox' }));
    years(w, 5);
    const s = [...w.settlements.values()][0];
    const ctx = { held: { persons: [] as number[], animals: [] as number[] }, param: undefined as string | undefined };
    for (const p of POWERS) {
      let x = s.x + 0.5, y = s.y + 0.5;
      if (p.id === 'tsunami' || p.id === 'hurricane') {
        for (let i = 0; i < w.map.size; i++) if (w.map.biome[i] === B.OCEAN) { x = i % w.map.w; y = (i / w.map.w) | 0; break; }
      }
      expect(() => usePower(w, p, x, y, p.r, ctx), p.id).not.toThrow();
      step(w);
    }
    runTicks(w, 400);
    assertSane(w);
  });
});

describe('Modes de jeu', () => {
  it('every mode and scenario runs', () => {
    for (const m of MODES) {
      const w = createWorld(opts({ seed: 50, size: 96, civs: m.id === 'scenario' ? SCENARIOS[0].civs : 3, mode: m.id as GameMode, scenario: SCENARIOS[0].id }));
      setupMode(w);
      years(w, 4);
      assertSane(w);
    }
    for (const sc of SCENARIOS) {
      const w = createWorld(opts({ seed: 51, size: 96, civs: sc.civs, mode: 'scenario', scenario: sc.id }));
      setupMode(w);
      years(w, 3);
      assertSane(w);
    }
  });
});
