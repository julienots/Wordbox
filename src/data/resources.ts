export const RES = ['food', 'wood', 'stone', 'iron', 'coal', 'gold', 'energy', 'rare'] as const;
export type Res = (typeof RES)[number];
export type Stock = Record<Res, number>;
export const RES_NAMES: Record<Res, string> = {
  food: 'Nourriture', wood: 'Bois', stone: 'Pierre', iron: 'Fer', coal: 'Charbon', gold: 'Or', energy: 'Énergie', rare: 'Éthérium',
};
/** Base market prices in gold units. */
export const BASE_PRICE: Stock = { food: 1, wood: 1.5, stone: 2, iron: 5, coal: 4, gold: 10, energy: 3, rare: 40 };
export const emptyStock = (): Stock => ({ food: 0, wood: 0, stone: 0, iron: 0, coal: 0, gold: 0, energy: 0, rare: 0 });

/** Tile deposits. */
export const enum D { NONE, STONE, IRON, COAL, GOLD, RARE, FISH, FERTILE, OIL }
export const DEPOSITS: { name: string; res: Res | null; color: string }[] = [
  { name: 'Aucun', res: null, color: '#0000' },
  { name: 'Carrière', res: 'stone', color: '#b8b0a4' },
  { name: 'Fer', res: 'iron', color: '#b0634a' },
  { name: 'Charbon', res: 'coal', color: '#2a2a2a' },
  { name: 'Or', res: 'gold', color: '#f2c832' },
  { name: 'Éthérium', res: 'rare', color: '#c050ff' },
  { name: 'Banc de poissons', res: 'food', color: '#9fe0ff' },
  { name: 'Terre noire', res: 'food', color: '#4a3a20' },
  { name: 'Pétrole', res: 'energy', color: '#111' },
];
