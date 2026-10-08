export const ERAS = [
  'Préhistoire', 'Âge de pierre', 'Agriculture', 'Âge du bronze', 'Âge du fer', 'Moyen Âge', 'Renaissance',
  'Ère industrielle', 'Électricité', 'Ère moderne', 'Ère numérique', 'Robotique', 'Ère spatiale', 'Technologies avancées',
];

export interface TechFx {
  food?: number; prod?: number; research?: number; health?: number; military?: number;
  move?: number; housing?: number; trade?: number; faith?: number; stability?: number;
}
export interface TechDef {
  id: string;
  name: string;
  era: number;
  cost: number;
  req: string[];
  fx: TechFx;
  desc: string;
}

const T = (id: string, name: string, era: number, req: string[], fx: TechFx, desc: string): TechDef =>
  ({ id, name, era, cost: Math.round(45 * Math.pow(2.05, era)), req, fx, desc });

export const TECHS: TechDef[] = [
  T('fire', 'Maîtrise du feu', 0, [], { health: 0.05 }, 'Cuire, se chauffer, éloigner les prédateurs.'),
  T('gathering', 'Cueillette', 0, [], { food: 0.1 }, 'Connaissance des plantes comestibles.'),
  T('stone_tools', 'Outils de pierre', 1, ['fire'], { prod: 0.1 }, 'Haches et grattoirs taillés.'),
  T('hunting', 'Chasse organisée', 1, ['gathering'], { food: 0.1, military: 0.05 }, 'Lances et pièges collectifs.'),
  T('agriculture', 'Agriculture', 2, ['gathering', 'stone_tools'], { food: 0.35 }, 'Semer, irriguer et récolter : naissance des villages.'),
  T('husbandry', 'Élevage', 2, ['hunting'], { food: 0.15 }, 'Domestication du bétail.'),
  T('pottery', 'Poterie', 2, ['fire'], { housing: 0.1 }, 'Stocker grains et eau.'),
  T('bronze', 'Bronze', 3, ['stone_tools', 'pottery'], { prod: 0.15, military: 0.15 }, 'Premier alliage, premières armes de métal.'),
  T('writing', 'Écriture', 3, ['pottery'], { research: 0.25 }, 'Mémoire, lois et savants.'),
  T('sailing', 'Navigation', 3, ['pottery'], { trade: 0.2, move: 0.05 }, 'Les ports ouvrent les mers.'),
  T('wheel', 'Roue', 3, ['agriculture'], { move: 0.15, trade: 0.1 }, 'Charrettes et routes.'),
  T('iron', 'Fer', 4, ['bronze'], { prod: 0.15, military: 0.2 }, 'Outils et armes durables.'),
  T('masonry', 'Maçonnerie', 4, ['bronze'], { housing: 0.2 }, 'Murailles et bâtiments de pierre.'),
  T('mathematics', 'Mathématiques', 4, ['writing'], { research: 0.2 }, 'La logique du monde.'),
  T('currency', 'Monnaie', 4, ['writing', 'bronze'], { trade: 0.3 }, 'Marchés et impôts.'),
  T('feudalism', 'Féodalité', 5, ['iron', 'currency'], { stability: 0.1, military: 0.1 }, 'Seigneurs, vassaux et châteaux.'),
  T('fortification', 'Fortifications', 5, ['masonry'], { military: 0.1 }, 'Remparts et tours de guet.'),
  T('theology', 'Théologie', 5, ['writing'], { faith: 0.3, stability: 0.05 }, 'Les cultes deviennent des religions organisées.'),
  T('medicine', 'Médecine', 5, ['mathematics'], { health: 0.2 }, 'Soins, herbes et chirurgiens.'),
  T('printing', 'Imprimerie', 6, ['theology', 'mathematics'], { research: 0.3 }, 'Le savoir se diffuse.'),
  T('gunpowder', 'Poudre noire', 6, ['iron', 'mathematics'], { military: 0.3 }, 'Canons et arquebuses.'),
  T('astronomy', 'Astronomie', 6, ['mathematics', 'sailing'], { research: 0.15, trade: 0.1 }, 'Les étoiles guident les navires.'),
  T('banking', 'Banque', 6, ['currency'], { trade: 0.3 }, 'Crédit et grandes compagnies.'),
  T('steam', 'Machine à vapeur', 7, ['printing', 'iron'], { prod: 0.3 }, 'La force du charbon.'),
  T('industry', 'Industrialisation', 7, ['steam', 'banking'], { prod: 0.4, housing: 0.3 }, 'Usines et villes ouvrières.'),
  T('railway', 'Chemin de fer', 7, ['steam'], { move: 0.3, trade: 0.2 }, 'Le monde rétrécit.'),
  T('electricity', 'Électricité', 8, ['industry'], { prod: 0.3, research: 0.2 }, 'Centrales et lumière nocturne.'),
  T('chemistry', 'Chimie', 8, ['medicine', 'industry'], { food: 0.3, health: 0.1 }, 'Engrais et matériaux.'),
  T('combustion', 'Moteur à combustion', 8, ['railway'], { move: 0.3, military: 0.2 }, 'Automobiles et blindés.'),
  T('aviation', 'Aviation', 9, ['combustion', 'electricity'], { move: 0.3, military: 0.3 }, 'Conquête du ciel.'),
  T('antibiotics', 'Antibiotiques', 9, ['chemistry'], { health: 0.4 }, 'La fin des grandes épidémies.'),
  T('fission', 'Fission nucléaire', 9, ['electricity', 'chemistry'], { prod: 0.2, military: 0.4 }, 'Énergie immense, danger immense.'),
  T('computing', 'Informatique', 10, ['electricity', 'mathematics'], { research: 0.5 }, 'Calcul automatique.'),
  T('networks', 'Réseaux', 10, ['computing'], { trade: 0.4, stability: 0.05 }, 'Communication instantanée.'),
  T('genetics', 'Génétique', 10, ['antibiotics', 'computing'], { health: 0.3, food: 0.3 }, 'Le code du vivant.'),
  T('robotics', 'Robotique', 11, ['computing', 'industry'], { prod: 0.6 }, 'Machines autonomes.'),
  T('ai', 'Intelligence artificielle', 11, ['networks', 'robotics'], { research: 0.6 }, 'Esprits de silicium.'),
  T('fusion', 'Fusion', 11, ['fission', 'computing'], { prod: 0.4 }, 'Énergie des étoiles.'),
  T('rocketry', 'Fusées', 12, ['aviation', 'computing'], { research: 0.2 }, 'Vers l’orbite.'),
  T('satellites', 'Satellites', 12, ['rocketry', 'networks'], { trade: 0.2, research: 0.2 }, 'Le ciel est cartographié.'),
  T('stations', 'Stations orbitales', 12, ['satellites', 'fusion'], { research: 0.3 }, 'Habitats en apesanteur.'),
  T('colonization', 'Colonisation spatiale', 13, ['stations', 'genetics'], { housing: 0.3 }, 'D’autres mondes à peupler.'),
  T('antimatter', 'Antimatière', 13, ['fusion', 'stations'], { prod: 0.5, military: 0.5 }, 'Énergie absolue.'),
  T('transcendence', 'Transcendance', 13, ['ai', 'antimatter'], { research: 1, stability: 0.2 }, 'Au-delà de la matière.'),
];
export const techById = new Map(TECHS.map((t) => [t.id, t]));
