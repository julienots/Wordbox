import { B } from './biomes';

/** Sentient species able to found civilisations. */
export interface SpeciesDef {
  id: string;
  name: string;
  plural: string;
  /** Preferred biomes (settlement scoring bonus). */
  likes: number[];
  str: number; int: number; spd: number; life: number; fert: number;
  skinHue: number;
  desc: string;
}

export const SPECIES: SpeciesDef[] = [
  { id: 'human', name: 'Humain', plural: 'Humains', likes: [B.PLAINS, B.HILLS, B.SAVANNA], str: 1, int: 1, spd: 1, life: 70, fert: 1.0, skinHue: 28, desc: 'Adaptables et ambitieux, ils prospèrent partout.' },
  { id: 'sylvan', name: 'Sylvain', plural: 'Sylvains', likes: [B.FOREST, B.JUNGLE, B.TAIGA], str: 0.85, int: 1.15, spd: 1.1, life: 160, fert: 0.6, skinHue: 95, desc: 'Peuple des forêts, longévif et contemplatif.' },
  { id: 'stonekin', name: 'Lithien', plural: 'Lithiens', likes: [B.MOUNTAIN, B.HILLS, B.TUNDRA], str: 1.3, int: 0.95, spd: 0.8, life: 120, fert: 0.75, skinHue: 15, desc: 'Nés de la roche, maîtres mineurs et forgerons.' },
  { id: 'saurian', name: 'Saurien', plural: 'Sauriens', likes: [B.SWAMP, B.JUNGLE, B.DESERT], str: 1.15, int: 0.9, spd: 1.05, life: 60, fert: 1.3, skinHue: 140, desc: 'Reptiliens prolifiques des terres chaudes.' },
];
export const speciesById = (id: string) => SPECIES.find((s) => s.id === id) ?? SPECIES[0];
