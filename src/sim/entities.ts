import type { Stock } from '../data/resources';

export interface Genome {
  str: number; int: number; spd: number; life: number; fert: number; cha: number;
  /** Cosmetic hue offsets inherited through generations. */
  hue: number; hair: number;
}

export const enum PS { IDLE, TO_WORK, WORK, TO_HOME, REST, WANDER, TRAVEL, FLEE, ARMY, FIGHT }

export class Person {
  id = 0;
  name = '';
  dynasty = 0;
  female = false;
  species = 'human';
  birth = 0;
  father = -1;
  mother = -1;
  partner = -1;
  children: number[] = [];
  settlement = -1;
  kingdom = -1;
  culture = -1;
  religion = -1;
  prof = 'child';
  skill = 0.5;
  health = 100;
  /** Satiety 0..100 */
  hunger = 80;
  energy = 100;
  happy = 60;
  genome: Genome = { str: 1, int: 1, spd: 1, life: 1, fert: 1, cha: 1, hue: 0, hair: 0 };
  traits: string[] = [];
  x = 0; y = 0; px = 0; py = 0; tx = 0; ty = 0;
  path: Int32Array | null = null;
  pathI = 0;
  state: PS = PS.IDLE;
  timer = 0;
  army = -1;
  renown = 0;
  title = '';
  /** Visual / physical scale (giant/tiny powers). */
  scale = 1;
  /** Short biography: [year, text]. */
  log: [number, string][] = [];
  /** Tick of last individual update (LOD bookkeeping). */
  lastUpd = 0;
  sick = 0;
}

export class Animal {
  id = 0;
  sp = 'rabbit';
  x = 0; y = 0; px = 0; py = 0; tx = 0; ty = 0;
  birth = 0;
  hunger = 80;
  hp = 1;
  target = -1;
  timer = 0;
  lastUpd = 0;
  /** Owner kingdom for summoned creatures (aliens), -1 wild. */
  faction = -1;
}

export class Building {
  id = 0;
  type = 'house';
  x = 0;
  y = 0;
  settlement = -1;
  /** 0..1 construction progress */
  progress = 0;
  hp = 100;
  /** Era style when (re)built: drives visuals & housing capacity. */
  era = 0;
}

export class Settlement {
  id = 0;
  name = '';
  kingdom = -1;
  x = 0;
  y = 0;
  founded = 0;
  level = 0;
  residents: number[] = [];
  /** Aggregate (statistical) population beyond simulated individuals. */
  extraPop = 0;
  stock: Stock = { food: 60, wood: 30, stone: 10, iron: 0, coal: 0, gold: 0, energy: 0, rare: 0 };
  prices: Stock = { food: 1, wood: 1.5, stone: 2, iron: 5, coal: 4, gold: 10, energy: 3, rare: 40 };
  buildings: number[] = [];
  /** Building type queued for construction. */
  queue: string[] = [];
  tiles = 0;
  wall = 0;
  happiness = 60;
  health = 70;
  faith = 0;
  culture = -1;
  religion = -1;
  /** Profession -> worker count (individuals + aggregate). */
  jobs: Record<string, number> = {};
  /** Net food per month (for UI & AI). */
  foodBalance = 0;
  infected = 0;
  /** Cached natural food capacity of the territory (recomputed periodically). */
  forage = -1;
  /** Cached: territory touches the sea (-1 unknown). */
  coastal = -1;
  /** Acquired immunity 0..1 (epidemics burn out). */
  immune = 0;
  famine = 0;
  /** Siege progress 0..100 when besieged. */
  siege = 0;
  /** Original owner while occupied in an ongoing war (-1 = not occupied). */
  occupiedFrom = -1;
  ruined = false;
  /** Housing capacity (cached). */
  housing = 0;
  storage = 200;
  research = 0;
  energyBalance = 0;
  /** Monthly production snapshot for UI. */
  produced: Partial<Stock> = {};

  get pop(): number {
    return this.residents.length + Math.floor(this.extraPop);
  }
}

export interface Faction {
  id: string;
  name: string;
  power: number;
  approval: number;
}

export class Kingdom {
  id = 0;
  name = '';
  hue = 0;
  species = 'human';
  culture = -1;
  religion = -1;
  capital = -1;
  settlements: number[] = [];
  ruler = -1;
  heir = -1;
  dynasty = 0;
  government = 'tribe';
  succession: 'primogeniture' | 'elective' | 'strongest' = 'primogeniture';
  techs: string[] = ['fire'];
  researching = '';
  research = 0;
  era = 0;
  treasury = 0;
  armory = 0;
  stability = 70;
  factions: Faction[] = [];
  council: number[] = [];
  armies: number[] = [];
  reputation = 50;
  overlord = -1;
  warExhaustion = 0;
  founded = 0;
  fallen = -1;
  reigns = 0;
  /** Favoured by the player (survival / civilization modes). */
  chosen = false;
  satellites = 0;
  stations = 0;
  rockets = 0;
  colonies: string[] = [];
  /** Kingdom-wide production snapshot. */
  wealth = 0;
  federation = -1;
  /** Peak settlement count (empire detection). */
  conquests = 0;
}

export interface Relation {
  a: number;
  b: number;
  opinion: number;
  war: number;
  alliance: boolean;
  trade: boolean;
  pact: boolean;
  embargo: boolean;
  truceUntil: number;
  /** Kingdom paying tribute in this pair, -1 none. */
  tributeFrom: number;
  /** Memory of betrayals / wars (decays). */
  grievance: number;
  contact: boolean;
}

export class War {
  id = 0;
  name = '';
  attackers: number[] = [];
  defenders: number[] = [];
  cause = '';
  start = 0;
  end = -1;
  /** Positive favours attackers. */
  score = 0;
  battles = 0;
  deaths = 0;
  captured = 0;
  civil = false;
}

export interface Units { inf: number; arch: number; cav: number; heavy: number; siege: number; special: number }

export class Army {
  id = 0;
  name = '';
  kingdom = -1;
  war = -1;
  commander = -1;
  units: Units = { inf: 0, arch: 0, cav: 0, heavy: 0, siege: 0, special: 0 };
  members: number[] = [];
  home = -1;
  x = 0; y = 0; px = 0; py = 0;
  targetSettlement = -1;
  targetArmy = -1;
  path: Int32Array | null = null;
  pathI = 0;
  waitingPath = false;
  morale = 80;
  supply = 100;
  xp = 0;
  equipment = 1;
  state: 'idle' | 'march' | 'siege' | 'battle' | 'return' = 'idle';
  kills = 0;
}

export class Culture {
  id = 0;
  name = '';
  lang = 0;
  values = { martial: 0.5, pious: 0.5, mercantile: 0.5, scholarly: 0.5, naturalist: 0.5, artistic: 0.5, collectivist: 0.5 };
  traditions: string[] = [];
  roof = 0;
  hue = 0;
  wallHue = 0;
  clothesHue = 0;
  parent = -1;
  founded = 0;
  extinct = -1;
  members = 0;
}

export class Religion {
  id = 0;
  name = '';
  deityType = 'gods';
  deity = '';
  tenets: string[] = [];
  rites: string[] = [];
  festival = '';
  hue = 0;
  founder = -1;
  founded = 0;
  followers = 0;
  playerGod = false;
  parent = -1;
  extinct = -1;
}

export interface TradeRoute {
  id: number;
  a: number;
  b: number;
  path: Int32Array;
  volume: number;
  naval: boolean;
}

export interface HistoryEntry {
  tick: number;
  type: string;
  text: string;
  imp: number;
  x?: number;
  y?: number;
}

export interface Famous {
  id: number;
  name: string;
  role: string;
  reason: string;
  birth: number;
  death: number;
  renown: number;
  kingdom: string;
}

export interface Dynasty {
  id: number;
  name: string;
  founder: number;
  founded: number;
  members: number;
  prestige: number;
  kingdom: number;
}

export interface Disaster {
  id: number;
  type: string;
  x: number;
  y: number;
  r: number;
  life: number;
  vx: number;
  vy: number;
  power: number;
}

export interface Weather {
  id: number;
  type: 'rain' | 'snow' | 'storm' | 'hurricane';
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  life: number;
  power: number;
}

export interface Epidemic {
  id: number;
  name: string;
  virulence: number;
  lethality: number;
  start: number;
  deaths: number;
  active: boolean;
}

/** Archived dead person (compact genealogy record). */
export interface Ancestor {
  id: number;
  name: string;
  dynasty: number;
  birth: number;
  death: number;
  father: number;
  mother: number;
  female: boolean;
  renown: number;
  cause: string;
}
