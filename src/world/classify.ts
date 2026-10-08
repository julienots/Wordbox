import { B } from '../data/biomes';

export const SEA_LEVEL = 0.5;

/** Biomes that the climate is allowed to re-derive (natural land cover). */
export const CLIMATE_BIOMES = new Set<number>([
  B.PLAINS, B.FOREST, B.JUNGLE, B.SWAMP, B.DESERT, B.SAVANNA, B.HILLS, B.MOUNTAIN,
  B.SNOW_PEAK, B.TUNDRA, B.TAIGA, B.GLACIER, B.SNOW,
]);

/** Pure biome classification from elevation, effective temperature and humidity. */
export function classify(h: number, t: number, m: number): number {
  if (h < SEA_LEVEL - 0.16) return B.DEEP_OCEAN;
  if (h < SEA_LEVEL - 0.045) return B.OCEAN;
  if (h < SEA_LEVEL) return B.SHALLOW;
  const e = (h - SEA_LEVEL) / (1 - SEA_LEVEL);
  if (e > 0.8) return t < 0.55 ? B.SNOW_PEAK : B.MOUNTAIN;
  if (e > 0.6) return t < 0.18 ? B.SNOW_PEAK : B.MOUNTAIN;
  if (t < 0.1) return B.GLACIER;
  if (t < 0.2) return m > 0.6 ? B.SNOW : B.TUNDRA;
  if (t < 0.34) return m > 0.42 ? B.TAIGA : B.TUNDRA;
  if (e > 0.42) return B.HILLS;
  if (t < 0.68) {
    if (m < 0.22) return t > 0.55 ? B.DESERT : B.PLAINS;
    if (m < 0.5) return B.PLAINS;
    if (m < 0.78 || e > 0.12) return B.FOREST;
    return B.SWAMP;
  }
  if (m < 0.26) return B.DESERT;
  if (m < 0.44) return B.SAVANNA;
  if (m < 0.58) return B.PLAINS;
  if (m > 0.8 && e < 0.08) return B.SWAMP;
  return B.JUNGLE;
}

/** Effective temperature including altitude lapse rate and global climate offset. */
export function effTemp(baseT: number, h: number, offset: number): number {
  const e = Math.max(0, (h - SEA_LEVEL) / (1 - SEA_LEVEL));
  return baseT - e * 0.45 + offset;
}
