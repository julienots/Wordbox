export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsQuality {
  name: QualityName;
  label: string;
  /** Fraction of devicePixelRatio used for the backbuffer. */
  resolution: number;
  /** Terrain texture pixels per tile in detailed chunks. */
  tilePx: number;
  /** Max cached detailed chunks (render distance / memory). */
  chunkCache: number;
  /** Detailed chunks (re)built per frame. */
  chunkBudget: number;
  shadows: boolean;
  particles: number;
  /** 0 static, 1 sparkles, 2 sparkles + foam animation. */
  water: number;
  maxPersons: number;
  maxAnimals: number;
  trees3d: boolean;
  lights: boolean;
  weather: boolean;
}

export const QUALITIES: Record<QualityName, GraphicsQuality> = {
  low: { name: 'low', label: 'BAS', resolution: 0.6, tilePx: 6, chunkCache: 36, chunkBudget: 1, shadows: false, particles: 150, water: 0, maxPersons: 250, maxAnimals: 120, trees3d: false, lights: false, weather: false },
  medium: { name: 'medium', label: 'MOYEN', resolution: 0.8, tilePx: 8, chunkCache: 64, chunkBudget: 2, shadows: true, particles: 400, water: 1, maxPersons: 600, maxAnimals: 300, trees3d: false, lights: true, weather: true },
  high: { name: 'high', label: 'HAUT', resolution: 1, tilePx: 10, chunkCache: 96, chunkBudget: 3, shadows: true, particles: 900, water: 2, maxPersons: 1200, maxAnimals: 600, trees3d: true, lights: true, weather: true },
  ultra: { name: 'ultra', label: 'ULTRA', resolution: 1.25, tilePx: 12, chunkCache: 144, chunkBudget: 4, shadows: true, particles: 1800, water: 2, maxPersons: 2500, maxAnimals: 1200, trees3d: true, lights: true, weather: true },
};

/** Pick a sensible default from device capabilities. */
export function detectQuality(): QualityName {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  if (cores <= 4 || mem <= 3) return 'low';
  if (cores <= 6 || mem <= 4) return 'medium';
  return 'high';
}
