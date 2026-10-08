/** 1 tick = 1 day. */
export const DAYS_PER_MONTH = 10;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'] as const;
/** Real-time ticks per second at 1x. */
export const BASE_TICKS_PER_SECOND = 4;
export const SPEEDS = [0, 1, 2, 5, 20, 100] as const;

export function yearOf(tick: number): number {
  return Math.floor(tick / DAYS_PER_YEAR);
}
export function monthOf(tick: number): number {
  return Math.floor(tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
}
export function seasonOf(tick: number): number {
  return Math.floor(monthOf(tick) / 3);
}
