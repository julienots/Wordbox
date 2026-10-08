import { DAYS_PER_YEAR } from '../data/time';
import type { HistoryEntry } from '../sim/entities';
import { step } from '../sim/simulation';
import type { World } from '../sim/world';

/** Offline progression: one game year per 3 real minutes away, capped. */
export const OFFLINE_SECONDS_PER_YEAR = 180;
export const OFFLINE_MAX_YEARS = 100;

export function offlineYears(savedAt: number, now = Date.now()): number {
  const elapsed = Math.max(0, (now - savedAt) / 1000);
  if (elapsed < 120) return 0;
  return Math.min(OFFLINE_MAX_YEARS, Math.floor(elapsed / OFFLINE_SECONDS_PER_YEAR));
}

export interface OfflineReport {
  years: number;
  popBefore: number;
  popAfter: number;
  kingdomsBefore: number;
  kingdomsAfter: number;
  events: HistoryEntry[];
}

/**
 * Simulates the elapsed time in chunks (cooperative: yields between chunks so
 * the UI can show progress), at aggregated LOD (no camera focus).
 */
export async function catchUp(w: World, years: number, onProgress?: (f: number) => void, chunk = 240): Promise<OfflineReport> {
  const popBefore = w.totalPop(), kingdomsBefore = w.livingKingdoms().length;
  const startTick = w.tick;
  const total = years * DAYS_PER_YEAR;
  const focus = w.focus;
  w.focus = null;
  for (let done = 0; done < total; ) {
    const n = Math.min(chunk, total - done);
    for (let i = 0; i < n; i++) step(w);
    done += n;
    onProgress?.(done / total);
    await new Promise((r) => setTimeout(r, 0));
  }
  w.focus = focus;
  const events = w.history.filter((h) => h.tick > startTick && h.imp >= 2).slice(-40);
  return { years, popBefore, popAfter: w.totalPop(), kingdomsBefore, kingdomsAfter: w.livingKingdoms().length, events };
}
