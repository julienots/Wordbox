import { EventBus } from '../core/events';
import { RNG } from '../core/rng';
import { SpatialHash } from '../core/spatial';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../data/time';
import type { TileMap } from '../world/map';
import { Pathfinder } from '../world/pathfinding';
import type { WorldShape } from '../world/generator';
import {
  Ancestor, Animal, Army, Building, Culture, Disaster, Dynasty, Epidemic, Famous, HistoryEntry, Kingdom,
  Person, Relation, Religion, Settlement, TradeRoute, War, Weather,
} from './entities';

export type GameMode = 'sandbox' | 'survival' | 'apocalypse' | 'civilization' | 'chaos' | 'scenario' | 'evolution' | 'infinite' | 'editor';

export interface WorldOptions {
  id: string;
  name: string;
  seed: number;
  size: number;
  shape: WorldShape;
  mode: GameMode;
  civs: number;
  species: string[];
  climate: number;
  moisture: number;
  animals: number;
  scenario?: string;
  /** Planet this world was colonised from. */
  parentWorld?: string;
}

export interface Fx {
  kind: string;
  x: number;
  y: number;
  r?: number;
  color?: string;
  x2?: number;
  y2?: number;
}

export interface WorldEvents extends Record<string, unknown> {
  history: HistoryEntry;
  fx: Fx;
  sfx: { name: string; x?: number; y?: number };
  toast: { text: string; kind?: string };
  quest: { id: string; name: string };
  colony: { kingdom: number; planet: string; seed: number };
}

export interface Caps {
  persons: number;
  perSettlement: number;
  animals: number;
}

export interface YearStat {
  year: number;
  pop: number;
  kingdoms: number;
  animals: number;
  wars: number;
  wealth: number;
  tech: number;
}

/** A group of settlers travelling to found a new settlement. */
export interface Expedition {
  id: number;
  kingdom: number;
  from: number;
  x: number;
  y: number;
  members: number[];
  extra: number;
  eta: number;
  path: Int32Array;
  naval: boolean;
}

export interface Focus {
  x0: number; y0: number; x1: number; y1: number;
}

export class World {
  readonly bus = new EventBus<WorldEvents>();
  rng: RNG;
  tick = 0;
  nextId = 1;
  pathfinder: Pathfinder;
  persons = new Map<number, Person>();
  animals = new Map<number, Animal>();
  settlements = new Map<number, Settlement>();
  kingdoms = new Map<number, Kingdom>();
  buildings = new Map<number, Building>();
  armies = new Map<number, Army>();
  wars = new Map<number, War>();
  cultures = new Map<number, Culture>();
  religions = new Map<number, Religion>();
  relations = new Map<string, Relation>();
  routes = new Map<number, TradeRoute>();
  dynasties = new Map<number, Dynasty>();
  ancestors = new Map<number, Ancestor>();
  federations = new Map<number, { id: number; name: string; members: number[]; founded: number }>();
  expeditions: Expedition[] = [];
  /** Active fire and lava tiles (sparse sets: no full-map scans). */
  fires = new Set<number>();
  lava = new Map<number, number>();
  cursors = { veg: 0, reclass: 0 };
  famous: Famous[] = [];
  history: HistoryEntry[] = [];
  disasters: Disaster[] = [];
  weather: Weather[] = [];
  epidemics: Epidemic[] = [];
  /** Recently dead persons (resurrection power). */
  graveyard: { p: Person; tick: number }[] = [];

  climate = { tempOffset: 0, humidOffset: 0, iceAge: 0, iceAgeTimer: 0, pollution: 0, lastClassOffset: 0 };
  /** Per-chunk humidity modifier (droughts). */
  drought: Float32Array;
  stats = { births: 0, deaths: 0, warDeaths: 0, disasterDeaths: 0, warsTotal: 0, battles: 0, extinctions: 0, foundings: 0, maxPop: 0, lifeSum: 0, lifeCount: 0, rockets: 0, colonies: 0 };
  series: YearStat[] = [];
  extinctSpecies: string[] = [];
  codex = new Set<string>();
  questsDone = new Set<string>();
  questState: Record<string, number> = {};
  player = { faith: 100, favor: 0, timeStopped: false, chosenKingdom: -1, objectiveYear: 0, lost: false, won: false };
  savedAt = Date.now();
  /** Real seconds of play (statistics). */
  playTime = 0;

  caps: Caps = { persons: 5000, perSettlement: 60, animals: 1600 };
  focus: Focus | null = null;
  spatialPersons: SpatialHash<Person>;
  spatialAnimals: SpatialHash<Animal>;

  constructor(readonly opts: WorldOptions, readonly map: TileMap) {
    this.rng = new RNG(opts.seed ^ 0x5eed);
    this.pathfinder = new Pathfinder(map);
    this.drought = new Float32Array(map.cw * map.ch);
    this.spatialPersons = new SpatialHash<Person>(map.w, map.h, 8);
    this.spatialAnimals = new SpatialHash<Animal>(map.w, map.h, 8);
  }

  id(): number {
    return this.nextId++;
  }
  get year(): number {
    return Math.floor(this.tick / DAYS_PER_YEAR);
  }
  get day(): number {
    return this.tick % DAYS_PER_MONTH;
  }

  relKey(a: number, b: number): string {
    return a < b ? a + '-' + b : b + '-' + a;
  }
  relation(a: number, b: number): Relation {
    const k = this.relKey(a, b);
    let r = this.relations.get(k);
    if (!r) {
      r = { a: Math.min(a, b), b: Math.max(a, b), opinion: 0, war: -1, alliance: false, trade: false, pact: false, embargo: false, truceUntil: 0, tributeFrom: -1, grievance: 0, contact: false };
      this.relations.set(k, r);
    }
    return r;
  }
  atWar(a: number, b: number): boolean {
    if (a === b || a < 0 || b < 0) return false;
    const r = this.relations.get(this.relKey(a, b));
    return !!r && r.war >= 0;
  }

  kingdomOf(settlementId: number): Kingdom | undefined {
    const s = this.settlements.get(settlementId);
    return s ? this.kingdoms.get(s.kingdom) : undefined;
  }
  kingdomAt(i: number): number {
    const o = this.map.owner[i];
    if (o < 0) return -1;
    const s = this.settlements.get(o);
    return s ? s.kingdom : -1;
  }
  livingKingdoms(): Kingdom[] {
    const out: Kingdom[] = [];
    for (const k of this.kingdoms.values()) if (k.fallen < 0) out.push(k);
    return out;
  }
  kingdomPop(k: Kingdom): number {
    let n = 0;
    for (const sid of k.settlements) n += this.settlements.get(sid)?.pop ?? 0;
    return n;
  }
  totalPop(): number {
    let n = 0;
    for (const s of this.settlements.values()) n += s.pop;
    return n;
  }

  addHistory(type: string, text: string, imp = 1, x?: number, y?: number): void {
    const e: HistoryEntry = { tick: this.tick, type, text, imp, x, y };
    this.history.push(e);
    if (this.history.length > 4000) {
      // keep all major events, drop old minor ones
      this.history = this.history.filter((h, i) => h.imp >= 2 || i > this.history.length - 2500);
    }
    this.bus.emit('history', e);
  }
  fx(kind: string, x: number, y: number, r?: number, color?: string): void {
    this.bus.emit('fx', { kind, x, y, r, color });
  }
  sfx(name: string, x?: number, y?: number): void {
    this.bus.emit('sfx', { name, x, y });
  }
  unlock(entry: string): void {
    this.codex.add(entry);
  }

  /** Simulation level-of-detail for a position: 0 near, 1 mid, 2 far. */
  lod(x: number, y: number): number {
    const f = this.focus;
    if (!f) return 2;
    if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) return 0;
    const w = (f.x1 - f.x0) * 0.75, h = (f.y1 - f.y0) * 0.75;
    if (x >= f.x0 - w && x <= f.x1 + w && y >= f.y0 - h && y <= f.y1 + h) return 1;
    return 2;
  }
}
