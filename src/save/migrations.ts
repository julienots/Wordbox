import type { SaveData } from './serialize';

/**
 * Save format version. Rules for future versions (V3+):
 *  - never remove or rename a field without adding a migration step here;
 *  - new entity fields get defaults automatically (entities are restored onto
 *    freshly constructed class instances), so additive changes need no step;
 *  - each step upgrades exactly one version: MIGRATIONS[n] turns n into n+1.
 */
export const SAVE_VERSION = 2;

type Step = (d: SaveData) => SaveData;

export const MIGRATIONS: Record<number, Step> = {
  // v1 (early V2 prototype) -> v2: settlements gained epidemic immunity & caches,
  // world gained rolling-update cursors, sparse fire/lava sets and per-chunk drought.
  1: (d) => {
    const settlements = (d.settlements as Record<string, unknown>[] | undefined) ?? [];
    for (const s of settlements) {
      s.immune ??= 0;
      s.forage ??= -1;
      s.coastal ??= -1;
    }
    d.cursors ??= { veg: 0, reclass: 0 };
    d.fires ??= [];
    d.lava ??= [];
    d.expeditions ??= [];
    d.version = 2;
    return d;
  },
};

export function migrate(d: SaveData): SaveData {
  let v = typeof d.version === 'number' ? d.version : 1;
  if (v > SAVE_VERSION) throw new Error(`Sauvegarde créée par une version plus récente du jeu (format ${v}).`);
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Aucune migration depuis le format ${v}.`);
    d = step(d);
    v++;
    d.version = v;
  }
  return d;
}
