export type Habitat = 'land' | 'water' | 'air';
export interface AnimalDef {
  id: string;
  name: string;
  diet: 'herb' | 'carn' | 'omni';
  habitat: Habitat;
  speed: number;
  size: number;
  hp: number;
  atk: number;
  /** Monthly reproduction chance when fed. */
  repro: number;
  maxAge: number;
  /** Food value when eaten / hunted. */
  food: number;
  color: string;
  /** Prey species ids. */
  prey: string[];
  fantastic?: boolean;
  /** Attacks sentient beings. */
  hostile?: boolean;
  biomes?: number[];
  desc: string;
}

export const ANIMALS: AnimalDef[] = [
  { id: 'rabbit', name: 'Lapin', diet: 'herb', habitat: 'land', speed: 0.5, size: 0.35, hp: 3, atk: 0, repro: 0.35, maxAge: 6, food: 4, color: '#c8b8a0', prey: [], desc: 'Prolifique, base de la chaîne alimentaire.' },
  { id: 'deer', name: 'Cerf', diet: 'herb', habitat: 'land', speed: 0.55, size: 0.6, hp: 8, atk: 1, repro: 0.12, maxAge: 15, food: 15, color: '#9a6a3a', prey: [], desc: 'Grand herbivore des forêts.' },
  { id: 'bison', name: 'Bison', diet: 'herb', habitat: 'land', speed: 0.35, size: 0.8, hp: 20, atk: 3, repro: 0.08, maxAge: 20, food: 30, color: '#5a4030', prey: [], desc: 'Troupeaux des plaines et savanes.' },
  { id: 'wolf', name: 'Loup', diet: 'carn', habitat: 'land', speed: 0.6, size: 0.55, hp: 10, atk: 4, repro: 0.07, maxAge: 12, food: 8, color: '#6a6a72', prey: ['rabbit', 'deer', 'bison'], desc: 'Chasseur en meute.' },
  { id: 'bear', name: 'Ours', diet: 'omni', habitat: 'land', speed: 0.4, size: 0.85, hp: 30, atk: 8, repro: 0.04, maxAge: 25, food: 25, color: '#4a3020', prey: ['rabbit', 'deer', 'fish'], hostile: true, desc: 'Puissant omnivore solitaire.' },
  { id: 'fish', name: 'Poisson', diet: 'herb', habitat: 'water', speed: 0.4, size: 0.3, hp: 2, atk: 0, repro: 0.3, maxAge: 5, food: 5, color: '#8fd0e8', prey: [], desc: 'Nourrit pêcheurs et ours.' },
  { id: 'shark', name: 'Squale', diet: 'carn', habitat: 'water', speed: 0.6, size: 0.8, hp: 25, atk: 8, repro: 0.04, maxAge: 30, food: 20, color: '#5a6a80', prey: ['fish'], desc: 'Prédateur des océans.' },
  { id: 'bird', name: 'Oiseau', diet: 'omni', habitat: 'air', speed: 0.8, size: 0.3, hp: 2, atk: 0, repro: 0.2, maxAge: 8, food: 3, color: '#e8e0c0', prey: [], desc: 'Migrateur, disperse les graines.' },
  { id: 'dragon', name: 'Dragon', diet: 'carn', habitat: 'air', speed: 0.9, size: 1.6, hp: 400, atk: 40, repro: 0.004, maxAge: 800, food: 200, color: '#c0302a', prey: ['bison', 'deer', 'bear'], fantastic: true, hostile: true, desc: 'Créature légendaire crachant le feu.' },
  { id: 'griffin', name: 'Griffon', diet: 'carn', habitat: 'air', speed: 0.85, size: 1.1, hp: 120, atk: 15, repro: 0.01, maxAge: 200, food: 60, color: '#d0a050', prey: ['deer', 'rabbit', 'bison'], fantastic: true, desc: 'Gardien majestueux des cimes.' },
  { id: 'serpent', name: 'Serpent de mer', diet: 'carn', habitat: 'water', speed: 0.55, size: 1.8, hp: 300, atk: 25, repro: 0.004, maxAge: 600, food: 150, color: '#2a8a6a', prey: ['fish', 'shark'], fantastic: true, hostile: true, desc: 'Terreur des navigateurs.' },
  { id: 'demon', name: 'Démon', diet: 'carn', habitat: 'land', speed: 0.55, size: 0.9, hp: 60, atk: 12, repro: 0, maxAge: 40, food: 0, color: '#a01a40', prey: [], fantastic: true, hostile: true, desc: 'Surgi d’une faille dimensionnelle.' },
  { id: 'alien', name: 'Envahisseur', diet: 'carn', habitat: 'land', speed: 0.6, size: 0.7, hp: 50, atk: 14, repro: 0, maxAge: 60, food: 0, fantastic: true, hostile: true, color: '#60f0a0', prey: [], desc: 'Venu d’au-delà des étoiles.' },
];
export const animalById = new Map(ANIMALS.map((a) => [a.id, a]));
