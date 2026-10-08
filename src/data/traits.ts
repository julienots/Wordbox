/** Trait effects are additive modifiers read by AI, politics, economy and war. */
export interface TraitFx {
  str?: number; int?: number; spd?: number; courage?: number; loyalty?: number;
  ambition?: number; happy?: number; fert?: number; life?: number; work?: number;
  piety?: number; aggression?: number; curiosity?: number; charisma?: number;
  greed?: number; health?: number; social?: number;
}
export interface TraitDef {
  id: string;
  name: string;
  /** Mutually exclusive trait. */
  opposite?: string;
  /** Spawn weight (0 = only via power/event). */
  weight: number;
  /** Probability to inherit from a parent having it. */
  inherit: number;
  fx: TraitFx;
  good: boolean;
}

const t = (id: string, name: string, weight: number, inherit: number, fx: TraitFx, good: boolean, opposite?: string): TraitDef =>
  ({ id, name, weight, inherit, fx, good, opposite });

export const TRAITS: TraitDef[] = [
  t('brave', 'Courageux', 8, 0.3, { courage: 0.4, aggression: 0.1 }, true, 'coward'),
  t('coward', 'Peureux', 6, 0.3, { courage: -0.4 }, false, 'brave'),
  t('smart', 'Intelligent', 7, 0.5, { int: 0.3, curiosity: 0.1 }, true, 'dull'),
  t('dull', 'Simplet', 5, 0.4, { int: -0.25 }, false, 'smart'),
  t('brutal', 'Brutal', 5, 0.25, { aggression: 0.4, str: 0.1, happy: -0.05 }, false, 'peaceful'),
  t('peaceful', 'Pacifique', 7, 0.25, { aggression: -0.4, happy: 0.05 }, true, 'brutal'),
  t('ambitious', 'Ambitieux', 6, 0.3, { ambition: 0.5, work: 0.1, loyalty: -0.15 }, true, 'content'),
  t('content', 'Humble', 5, 0.2, { ambition: -0.4, happy: 0.1 }, true, 'ambitious'),
  t('loyal', 'Loyal', 7, 0.3, { loyalty: 0.45 }, true, 'traitor'),
  t('traitor', 'Fourbe', 3, 0.2, { loyalty: -0.5, ambition: 0.2 }, false, 'loyal'),
  t('selfish', 'Égoïste', 5, 0.25, { greed: 0.3, social: -0.2, loyalty: -0.1 }, false, 'generous'),
  t('generous', 'Généreux', 5, 0.25, { greed: -0.3, social: 0.2, happy: 0.05 }, true, 'selfish'),
  t('charismatic', 'Charismatique', 4, 0.35, { charisma: 0.5, social: 0.2 }, true),
  t('hardworking', 'Travailleur', 8, 0.3, { work: 0.35 }, true, 'lazy'),
  t('lazy', 'Paresseux', 6, 0.3, { work: -0.35, happy: 0.05 }, false, 'hardworking'),
  t('pious', 'Religieux', 7, 0.4, { piety: 0.5 }, true, 'skeptic'),
  t('skeptic', 'Sceptique', 4, 0.3, { piety: -0.4, curiosity: 0.15 }, true, 'pious'),
  t('curious', 'Curieux', 6, 0.3, { curiosity: 0.45, int: 0.05 }, true),
  t('greedy', 'Avide', 4, 0.3, { greed: 0.5, ambition: 0.1 }, false),
  t('strong', 'Robuste', 6, 0.55, { str: 0.35, health: 0.1 }, true, 'frail'),
  t('frail', 'Chétif', 4, 0.45, { str: -0.3, health: -0.15 }, false, 'strong'),
  t('fertile', 'Fertile', 5, 0.6, { fert: 0.5 }, true, 'sterile'),
  t('sterile', 'Stérile', 2, 0.1, { fert: -1 }, false, 'fertile'),
  t('longlived', 'Longévif', 3, 0.6, { life: 0.3, health: 0.1 }, true, 'sickly'),
  t('sickly', 'Maladif', 4, 0.4, { health: -0.3, life: -0.2 }, false, 'longlived'),
  t('genius', 'Génie', 1, 0.15, { int: 0.8, curiosity: 0.3 }, true),
  t('mad', 'Fou', 1, 0.2, { aggression: 0.3, loyalty: -0.3, int: -0.1, happy: -0.2 }, false),
  t('cruel', 'Cruel', 3, 0.2, { aggression: 0.3, social: -0.3 }, false, 'kind'),
  t('kind', 'Bienveillant', 6, 0.2, { social: 0.3, happy: 0.1 }, true, 'cruel'),
  t('wanderer', 'Vagabond', 4, 0.3, { curiosity: 0.3, spd: 0.1 }, true, 'homebody'),
  t('homebody', 'Casanier', 5, 0.3, { curiosity: -0.3, happy: 0.05 }, true, 'wanderer'),
  t('xenophobe', 'Xénophobe', 3, 0.3, { aggression: 0.2, social: -0.2 }, false, 'cosmopolitan'),
  t('cosmopolitan', 'Cosmopolite', 4, 0.3, { social: 0.3, curiosity: 0.1 }, true, 'xenophobe'),
  t('swift', 'Véloce', 4, 0.5, { spd: 0.35 }, true),
  t('strategist', 'Stratège', 2, 0.2, { int: 0.2, courage: 0.1 }, true),
  // Granted by divine powers / events only:
  t('immortal', 'Immortel', 0, 0, { health: 1 }, true),
  t('giant', 'Géant', 0, 0.5, { str: 1, spd: -0.1 }, true),
  t('tiny', 'Minuscule', 0, 0.5, { str: -0.5, spd: 0.2 }, false),
  t('blessed', 'Béni des dieux', 0, 0, { happy: 0.3, health: 0.3, piety: 0.3 }, true),
  t('cursed', 'Maudit', 0, 0, { happy: -0.3, health: -0.3 }, false),
  t('mutant', 'Mutant', 0, 0.5, { str: 0.2, int: 0.2, fert: -0.3 }, true),
  t('hero', 'Héroïque', 0, 0.1, { courage: 0.6, charisma: 0.3, str: 0.2 }, true),
];

export const traitById = new Map(TRAITS.map((x) => [x.id, x]));
