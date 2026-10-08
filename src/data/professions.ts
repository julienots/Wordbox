import type { Res } from './resources';

export interface ProfessionDef {
  id: string;
  name: string;
  /** Tech required to unlock (null = always). */
  tech: string | null;
  produces?: Res;
  /** Base output per worker per month. */
  rate?: number;
  icon: string;
}

export const PROFESSIONS: ProfessionDef[] = [
  { id: 'gatherer', name: 'Cueilleur', tech: null, produces: 'food', rate: 5, icon: '🫐' },
  { id: 'farmer', name: 'Agriculteur', tech: 'agriculture', produces: 'food', rate: 9, icon: '🌾' },
  { id: 'hunter', name: 'Chasseur', tech: null, produces: 'food', rate: 5, icon: '🏹' },
  { id: 'fisher', name: 'Pêcheur', tech: null, produces: 'food', rate: 6, icon: '🎣' },
  { id: 'woodcutter', name: 'Bûcheron', tech: null, produces: 'wood', rate: 4, icon: '🪓' },
  { id: 'miner', name: 'Mineur', tech: 'stone_tools', produces: 'stone', rate: 3, icon: '⛏️' },
  { id: 'builder', name: 'Constructeur', tech: null, icon: '🔨' },
  { id: 'smith', name: 'Forgeron', tech: 'bronze', icon: '⚒️' },
  { id: 'merchant', name: 'Marchand', tech: 'currency', produces: 'gold', rate: 1.5, icon: '💰' },
  { id: 'soldier', name: 'Soldat', tech: null, icon: '⚔️' },
  { id: 'priest', name: 'Prêtre', tech: null, icon: '🙏' },
  { id: 'scholar', name: 'Scientifique', tech: 'writing', icon: '📜' },
  { id: 'doctor', name: 'Médecin', tech: 'medicine', icon: '⚕️' },
  { id: 'engineer', name: 'Ingénieur', tech: 'steam', produces: 'energy', rate: 4, icon: '⚙️' },
  { id: 'worker', name: 'Ouvrier', tech: 'industry', icon: '🏭' },
  { id: 'leader', name: 'Dirigeant', tech: null, icon: '👑' },
  { id: 'child', name: 'Enfant', tech: null, icon: '🧒' },
  { id: 'elder', name: 'Ancien', tech: null, icon: '🧓' },
];
export const profById = new Map(PROFESSIONS.map((p) => [p.id, p]));
