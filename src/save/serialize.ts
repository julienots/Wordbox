import { RNG } from '../core/rng';
import { TileMap } from '../world/map';
import {
  Animal, Army, Building, Culture, Kingdom, Person, PS, Religion, Settlement, War,
} from '../sim/entities';
import { World, WorldOptions } from '../sim/world';
import { migrate, SAVE_VERSION } from './migrations';

/** Bumped when the game itself changes (informational; compatibility is driven by SAVE_VERSION). */
export const GAME_VERSION = __VERSION__;

type Typed = Float32Array | Uint8Array | Uint16Array | Int32Array | Uint32Array;

export function toB64(a: Typed): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64<T extends Typed>(b64: string, Ctor: { new (buf: ArrayBuffer): T }): T {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Ctor(bytes.buffer);
}

const MAP_FIELDS: [keyof TileMap, { new (buf: ArrayBuffer): Typed }][] = [
  ['height', Float32Array], ['temp', Float32Array], ['humid', Float32Array], ['biome', Uint8Array], ['deposit', Uint8Array],
  ['depositAmt', Uint16Array], ['veg', Uint8Array], ['fert', Uint8Array], ['owner', Int32Array], ['road', Uint8Array],
  ['bld', Int32Array], ['fire', Uint8Array], ['timer', Uint16Array], ['waterDist', Uint8Array],
];

export interface SaveData {
  format: 'aeonis-world';
  version: number;
  game: string;
  savedAt: number;
  [k: string]: unknown;
}

const strip = <T extends object>(o: T, drop: string[] = []) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!drop.includes(k)) out[k] = v;
  return out;
};

/** World -> plain JSON-safe object. */
export function serialize(w: World): SaveData {
  const m = w.map;
  const map: Record<string, unknown> = { w: m.w, h: m.h, terrainVer: m.terrainVer };
  for (const [f] of MAP_FIELDS) map[f] = toB64(m[f] as Typed);
  return {
    format: 'aeonis-world',
    version: SAVE_VERSION,
    game: GAME_VERSION,
    savedAt: Date.now(),
    opts: w.opts,
    tick: w.tick,
    nextId: w.nextId,
    rng: w.rng.state,
    map,
    persons: [...w.persons.values()].map((p) => strip(p, ['path'])),
    animals: [...w.animals.values()],
    settlements: [...w.settlements.values()],
    kingdoms: [...w.kingdoms.values()],
    buildings: [...w.buildings.values()],
    armies: [...w.armies.values()].map((a) => strip(a, ['path', 'waitingPath'])),
    wars: [...w.wars.values()],
    cultures: [...w.cultures.values()],
    religions: [...w.religions.values()],
    relations: [...w.relations.values()],
    routes: [...w.routes.values()].map((r) => ({ ...r, path: toB64(r.path) })),
    dynasties: [...w.dynasties.values()],
    ancestors: [...w.ancestors.values()],
    federations: [...w.federations.values()],
    famous: w.famous,
    history: w.history,
    disasters: w.disasters,
    weather: w.weather,
    epidemics: w.epidemics,
    expeditions: w.expeditions.map((e) => ({ ...e, path: toB64(e.path) })),
    fires: [...w.fires],
    lava: [...w.lava],
    cursors: w.cursors,
    climate: w.climate,
    drought: toB64(w.drought),
    stats: w.stats,
    series: w.series,
    extinctSpecies: w.extinctSpecies,
    codex: [...w.codex],
    questsDone: [...w.questsDone],
    questState: w.questState,
    player: w.player,
    playTime: w.playTime,
  };
}

function restore<T extends object>(Ctor: { new (): T }, raw: unknown): T {
  return Object.assign(new Ctor(), raw);
}

/** Plain object (any supported version) -> World. Throws on unsupported/corrupt data. */
export function deserialize(input: SaveData): World {
  if (!input || input.format !== 'aeonis-world') throw new Error('Fichier de sauvegarde invalide.');
  const d = migrate(input);
  const mraw = d.map as Record<string, unknown>;
  const map = new TileMap(mraw.w as number, mraw.h as number);
  for (const [f, Ctor] of MAP_FIELDS) {
    const arr = fromB64(mraw[f] as string, Ctor);
    if (arr.length !== map.size) throw new Error(`Carte corrompue (${String(f)}).`);
    (map as unknown as Record<string, Typed>)[f as string] = arr;
  }
  map.terrainVer = (mraw.terrainVer as number) ?? 0;
  const w = new World(d.opts as WorldOptions, map);
  w.tick = d.tick as number;
  w.nextId = d.nextId as number;
  w.rng = new RNG(0);
  w.rng.state = d.rng as number;
  const list = <T>(k: string) => (d[k] as T[] | undefined) ?? [];
  for (const r of list<Person>('persons')) {
    const p = restore(Person, r);
    p.path = null;
    if (p.state === PS.TRAVEL) p.state = PS.IDLE;
    w.persons.set(p.id, p);
  }
  for (const r of list<Animal>('animals')) { const a = restore(Animal, r); w.animals.set(a.id, a); }
  for (const r of list<Settlement>('settlements')) { const s = restore(Settlement, r); w.settlements.set(s.id, s); }
  for (const r of list<Kingdom>('kingdoms')) { const k = restore(Kingdom, r); w.kingdoms.set(k.id, k); }
  for (const r of list<Building>('buildings')) { const b = restore(Building, r); w.buildings.set(b.id, b); }
  for (const r of list<Army>('armies')) { const a = restore(Army, r); a.path = null; a.waitingPath = false; w.armies.set(a.id, a); }
  for (const r of list<War>('wars')) { const x = restore(War, r); w.wars.set(x.id, x); }
  for (const r of list<Culture>('cultures')) { const c = restore(Culture, r); c.values = { ...new Culture().values, ...c.values }; w.cultures.set(c.id, c); }
  for (const r of list<Religion>('religions')) { const x = restore(Religion, r); w.religions.set(x.id, x); }
  for (const r of list<import('../sim/entities').Relation>('relations')) w.relations.set(w.relKey(r.a, r.b), r);
  for (const r of list<{ id: number; a: number; b: number; path: string; volume: number; naval: boolean }>('routes'))
    w.routes.set(r.id, { ...r, path: fromB64(r.path, Int32Array) });
  for (const r of list<import('../sim/entities').Dynasty>('dynasties')) w.dynasties.set(r.id, r);
  for (const r of list<import('../sim/entities').Ancestor>('ancestors')) w.ancestors.set(r.id, r);
  for (const r of list<{ id: number; name: string; members: number[]; founded: number }>('federations')) w.federations.set(r.id, r);
  w.famous = list('famous');
  w.history = list('history');
  w.disasters = list('disasters');
  w.weather = list('weather');
  w.epidemics = list('epidemics');
  w.expeditions = list<{ path: string }>('expeditions').map((e) => ({ ...(e as unknown as World['expeditions'][number]), path: fromB64(e.path, Int32Array) }));
  for (const e of w.expeditions) for (const id of e.members) { const p = w.persons.get(id); if (p) { p.state = PS.TRAVEL; p.path = e.path; } }
  w.fires = new Set(list<number>('fires'));
  w.lava = new Map(list<[number, number]>('lava'));
  w.cursors = { ...w.cursors, ...(d.cursors as object) };
  w.climate = { ...w.climate, ...(d.climate as object) };
  if (d.drought) {
    const dr = fromB64(d.drought as string, Float32Array);
    if (dr.length === w.drought.length) w.drought = dr;
  }
  w.stats = { ...w.stats, ...(d.stats as object) };
  w.series = list('series');
  w.extinctSpecies = list('extinctSpecies');
  w.codex = new Set(list<string>('codex'));
  w.questsDone = new Set(list<string>('questsDone'));
  w.questState = (d.questState as Record<string, number>) ?? {};
  w.player = { ...w.player, ...(d.player as object) };
  w.playTime = (d.playTime as number) ?? 0;
  w.savedAt = d.savedAt;
  validate(w);
  return w;
}

/** Repairs references and impossible values so that a damaged save stays playable. */
export function validate(w: World): string[] {
  const fixes: string[] = [];
  for (const s of w.settlements.values()) {
    const before = s.residents.length;
    s.residents = s.residents.filter((id) => w.persons.get(id)?.settlement === s.id);
    if (s.residents.length !== before) fixes.push(`residents:${s.id}`);
    if (!Number.isFinite(s.extraPop) || s.extraPop < 0) { s.extraPop = 0; fixes.push(`extraPop:${s.id}`); }
    for (const [k, v] of Object.entries(s.stock)) if (!Number.isFinite(v) || v < 0) { (s.stock as Record<string, number>)[k] = 0; fixes.push(`stock:${s.id}:${k}`); }
    s.buildings = s.buildings.filter((id) => w.buildings.has(id));
  }
  for (const k of w.kingdoms.values()) {
    k.settlements = k.settlements.filter((id) => w.settlements.get(id)?.kingdom === k.id);
    k.armies = k.armies.filter((id) => w.armies.has(id));
    if (!Number.isFinite(k.treasury) || k.treasury < 0) { k.treasury = 0; fixes.push(`treasury:${k.id}`); }
  }
  for (const p of w.persons.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { p.x = p.y = p.px = p.py = 1; fixes.push(`pos:${p.id}`); }
    if (p.army >= 0 && !w.armies.has(p.army)) { p.army = -1; p.state = PS.IDLE; }
  }
  return fixes;
}

// ---------------------------------------------------------------- compression

export async function encode(data: SaveData): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream === 'undefined') return json;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decode(bytes: Uint8Array): Promise<SaveData> {
  let raw = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(raw)) as SaveData;
}
