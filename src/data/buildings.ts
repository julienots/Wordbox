import type { Stock } from './resources';

export type Placement = 'any' | 'fertile' | 'deposit' | 'coast' | 'forest' | 'center' | 'edge';

export interface BuildingDef {
  id: string;
  name: string;
  tech: string | null;
  cost: Partial<Stock>;
  /** Construction work units. */
  work: number;
  housing?: number;
  storage?: number;
  /** Job slots provided, by profession. */
  jobs?: Record<string, number>;
  research?: number;
  faith?: number;
  health?: number;
  happy?: number;
  defense?: number;
  /** Energy produced (+) or consumed (-) per month. */
  energy?: number;
  /** Minimum settlement level. */
  minLevel: number;
  place: Placement;
  /** Desired count = base + per * population/100, capped by max. */
  base: number;
  per: number;
  max: number;
  /** Visual height in tile units (pseudo-3D extrusion). */
  height: number;
  desc: string;
}

const d = (o: BuildingDef) => o;

export const BUILDINGS: BuildingDef[] = [
  d({ id: 'house', name: 'Maison', tech: null, cost: { wood: 6 }, work: 20, housing: 6, minLevel: 0, place: 'any', base: 1, per: 0, max: 400, height: 0.6, desc: 'Abrite une famille. Évolue de la hutte à la tour d’habitation.' }),
  d({ id: 'storage', name: 'Entrepôt', tech: null, cost: { wood: 12 }, work: 30, storage: 400, minLevel: 0, place: 'center', base: 1, per: 0.4, max: 8, height: 0.7, desc: 'Stocke nourriture et matériaux.' }),
  d({ id: 'farm', name: 'Ferme', tech: 'agriculture', cost: { wood: 8 }, work: 25, jobs: { farmer: 4 }, minLevel: 0, place: 'fertile', base: 1, per: 3, max: 120, height: 0.25, desc: 'Champs cultivés, cœur de l’économie.' }),
  d({ id: 'well', name: 'Puits', tech: 'pottery', cost: { stone: 8 }, work: 15, health: 0.04, minLevel: 1, place: 'center', base: 1, per: 0.3, max: 6, height: 0.3, desc: 'Eau potable : moins de maladies.' }),
  d({ id: 'workshop', name: 'Atelier', tech: 'stone_tools', cost: { wood: 15, stone: 5 }, work: 35, jobs: { smith: 2 }, minLevel: 1, place: 'any', base: 1, per: 0.6, max: 12, height: 0.7, desc: 'Fabrique outils et armes.' }),
  d({ id: 'lumber', name: 'Camp de bûcherons', tech: null, cost: { wood: 5 }, work: 15, jobs: { woodcutter: 3 }, minLevel: 0, place: 'forest', base: 1, per: 0.8, max: 15, height: 0.4, desc: 'Exploite les forêts proches.' }),
  d({ id: 'mine', name: 'Mine', tech: 'stone_tools', cost: { wood: 15 }, work: 40, jobs: { miner: 4 }, minLevel: 1, place: 'deposit', base: 1, per: 0.8, max: 12, height: 0.5, desc: 'Extrait pierre, fer, charbon, or ou éthérium.' }),
  d({ id: 'market', name: 'Marché', tech: 'currency', cost: { wood: 20, stone: 20 }, work: 60, jobs: { merchant: 3 }, happy: 0.03, minLevel: 2, place: 'center', base: 1, per: 0.3, max: 6, height: 0.6, desc: 'Échanges et prix locaux.' }),
  d({ id: 'barracks', name: 'Caserne', tech: 'bronze', cost: { wood: 20, stone: 20, iron: 5 }, work: 70, jobs: { soldier: 8 }, defense: 2, minLevel: 2, place: 'edge', base: 0, per: 0.3, max: 6, height: 0.8, desc: 'Entraîne et loge les soldats.' }),
  d({ id: 'temple', name: 'Temple', tech: null, cost: { wood: 15, stone: 20 }, work: 60, jobs: { priest: 2 }, faith: 3, happy: 0.04, minLevel: 1, place: 'center', base: 1, per: 0.15, max: 5, height: 1.3, desc: 'Lieu de culte, rites et fêtes.' }),
  d({ id: 'townhall', name: 'Hôtel de ville', tech: 'writing', cost: { wood: 30, stone: 40 }, work: 90, jobs: { leader: 1 }, minLevel: 2, place: 'center', base: 1, per: 0, max: 1, height: 1.1, desc: 'Administration, impôts et ordre.' }),
  d({ id: 'port', name: 'Port', tech: 'sailing', cost: { wood: 30 }, work: 50, jobs: { fisher: 4, merchant: 1 }, minLevel: 1, place: 'coast', base: 0, per: 0.5, max: 4, height: 0.5, desc: 'Pêche, commerce maritime et expéditions.' }),
  d({ id: 'castle', name: 'Château', tech: 'feudalism', cost: { stone: 120, iron: 20 }, work: 220, defense: 8, minLevel: 3, place: 'center', base: 1, per: 0, max: 1, height: 2, desc: 'Forteresse seigneuriale.' }),
  d({ id: 'university', name: 'Université', tech: 'printing', cost: { stone: 80, gold: 20 }, work: 160, jobs: { scholar: 6 }, research: 2, minLevel: 3, place: 'any', base: 0, per: 0.05, max: 3, height: 1.4, desc: 'Foyer du savoir.' }),
  d({ id: 'library', name: 'Bibliothèque', tech: 'writing', cost: { wood: 20, stone: 25 }, work: 70, jobs: { scholar: 3 }, research: 0.8, minLevel: 2, place: 'any', base: 0, per: 0.1, max: 3, height: 0.9, desc: 'Archives et copistes.' }),
  d({ id: 'hospital', name: 'Hôpital', tech: 'medicine', cost: { stone: 50, wood: 20 }, work: 110, jobs: { doctor: 4 }, health: 0.12, minLevel: 2, place: 'any', base: 0, per: 0.15, max: 4, height: 1, desc: 'Soigne malades et blessés.' }),
  d({ id: 'factory', name: 'Usine', tech: 'industry', cost: { stone: 60, iron: 40 }, work: 140, jobs: { worker: 12 }, energy: -6, minLevel: 3, place: 'edge', base: 0, per: 0.4, max: 10, height: 1.2, desc: 'Production de masse.' }),
  d({ id: 'powerplant', name: 'Centrale', tech: 'electricity', cost: { stone: 80, iron: 60 }, work: 180, jobs: { engineer: 5 }, energy: 30, minLevel: 3, place: 'edge', base: 0, per: 0.2, max: 4, height: 1.6, desc: 'Électricité pour les usines et les foyers.' }),
  d({ id: 'lab', name: 'Laboratoire', tech: 'computing', cost: { stone: 60, iron: 40, gold: 30 }, work: 200, jobs: { scholar: 8 }, research: 4, energy: -5, minLevel: 3, place: 'any', base: 0, per: 0.04, max: 2, height: 1.5, desc: 'Recherche de pointe.' }),
  d({ id: 'spaceport', name: 'Astroport', tech: 'rocketry', cost: { iron: 200, gold: 80, rare: 5 }, work: 400, jobs: { engineer: 10 }, energy: -20, minLevel: 4, place: 'edge', base: 1, per: 0, max: 1, height: 2.6, desc: 'Lance fusées, satellites et colons vers les étoiles.' }),
];
export const buildingById = new Map(BUILDINGS.map((b) => [b.id, b]));

export const SETTLEMENT_LEVELS = [
  { name: 'Campement', pop: 0, radius: 3 },
  { name: 'Village', pop: 20, radius: 5 },
  { name: 'Bourg', pop: 120, radius: 7 },
  { name: 'Ville', pop: 500, radius: 9 },
  { name: 'Grande cité', pop: 2500, radius: 11 },
  { name: 'Mégapole', pop: 10000, radius: 13 },
];
