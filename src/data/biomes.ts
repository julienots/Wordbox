export const enum B {
  DEEP_OCEAN, OCEAN, SHALLOW, LAKE, RIVER, BEACH, PLAINS, FOREST, JUNGLE, SWAMP,
  DESERT, SAVANNA, HILLS, MOUNTAIN, SNOW_PEAK, TUNDRA, TAIGA, GLACIER, VOLCANO,
  LAVA, ASH, BARREN, CORRUPT, SNOW,
}
export const BIOME_COUNT = 24;

export interface BiomeInfo {
  name: string;
  color: [number, number, number];
  water: boolean;
  /** Passable on foot. */
  walk: boolean;
  /** Can host buildings. */
  build: boolean;
  /** Base soil fertility 0..1. */
  fert: number;
  /** Movement cost multiplier (pathfinding). */
  cost: number;
  /** Max vegetation density 0..255. */
  veg: number;
  desc: string;
}

const b = (name: string, color: [number, number, number], water: boolean, walk: boolean, build: boolean, fert: number, cost: number, veg: number, desc: string): BiomeInfo =>
  ({ name, color, water, walk, build, fert, cost, veg, desc });

export const BIOMES: BiomeInfo[] = [
  b('Océan profond', [18, 46, 92], true, false, false, 0, 99, 0, 'Abysses froides où rôdent les créatures marines.'),
  b('Océan', [28, 74, 132], true, false, false, 0, 99, 0, 'Vaste étendue salée, route des navigateurs.'),
  b('Mer côtière', [46, 118, 170], true, false, false, 0.2, 60, 0, 'Eaux peu profondes, riches en poissons.'),
  b('Lac', [52, 124, 178], true, false, false, 0.3, 60, 0, "Réserve d'eau douce essentielle aux premiers villages."),
  b('Rivière', [64, 140, 196], true, true, false, 0.4, 5, 0, 'Les rivières fertilisent les plaines et guident le commerce.'),
  b('Plage', [222, 206, 150], false, true, true, 0.15, 1.2, 30, 'Bande de sable entre terre et mer.'),
  b('Plaine', [112, 168, 76], false, true, true, 0.9, 1, 120, 'Terres fertiles idéales pour l’agriculture.'),
  b('Forêt', [52, 118, 56], false, true, true, 0.6, 1.6, 240, 'Bois abondant, gibier et refuges.'),
  b('Jungle', [34, 104, 48], false, true, true, 0.5, 2.2, 255, 'Végétation dense, chaleur humide et maladies.'),
  b('Marais', [74, 100, 70], false, true, false, 0.4, 2.8, 180, 'Sols spongieux et brumes tenaces.'),
  b('Désert', [218, 188, 118], false, true, true, 0.05, 1.5, 15, 'Chaleur écrasante, eau rare, minerais cachés.'),
  b('Savane', [178, 172, 84], false, true, true, 0.45, 1.1, 90, 'Herbes hautes et grands troupeaux.'),
  b('Collines', [124, 146, 82], false, true, true, 0.5, 1.8, 100, 'Reliefs doux riches en pierre.'),
  b('Montagne', [128, 116, 104], false, true, false, 0.05, 4, 25, 'Pics rocheux recelant fer, or et charbon.'),
  b('Sommet enneigé', [236, 240, 246], false, false, false, 0, 99, 0, 'Neiges éternelles, infranchissables.'),
  b('Toundra', [150, 156, 128], false, true, true, 0.15, 1.6, 50, 'Sols gelés et vents glacials.'),
  b('Taïga', [56, 96, 76], false, true, true, 0.3, 1.8, 200, 'Forêt boréale de conifères.'),
  b('Glacier', [210, 230, 240], false, true, false, 0, 4, 0, 'Fleuves de glace avançant lentement.'),
  b('Volcan', [92, 64, 58], false, false, false, 0, 99, 0, 'Montagne de feu, menace et fertilité.'),
  b('Lave', [230, 90, 30], false, false, false, 0, 99, 0, 'Roche en fusion qui refroidit en basalte.'),
  b('Terre brûlée', [70, 66, 62], false, true, true, 0.3, 1.3, 40, 'Cendres fertiles après incendie ou éruption.'),
  b('Roche nue', [110, 104, 98], false, true, true, 0.02, 1.4, 10, 'Sol stérile et rocailleux.'),
  b('Terre corrompue', [96, 40, 110], false, true, false, 0, 2.5, 0, 'Sol souillé par une faille dimensionnelle.'),
  b('Plaine enneigée', [222, 230, 236], false, true, true, 0.05, 1.8, 20, 'Neige saisonnière ou glaciaire.'),
];

export const isWater = (bi: number) => BIOMES[bi].water;
