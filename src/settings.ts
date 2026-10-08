import type { Volumes } from './audio/audio';
import { detectQuality, QualityName } from './render/quality';
import { profile } from './save/storage';

export interface Settings {
  quality: QualityName;
  dayNight: boolean;
  volumes: Volumes;
  audio: boolean;
  haptics: boolean;
  /** Autosave interval in minutes (0 = off). */
  autosave: number;
  offline: boolean;
  labels: boolean;
  minimap: boolean;
  debug: boolean;
  tutorial: boolean;
}

export function loadSettings(): Settings {
  const def: Settings = {
    quality: detectQuality(), dayNight: true, volumes: { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.6 }, audio: true,
    haptics: true, autosave: 2, offline: true, labels: true, minimap: true, debug: false, tutorial: true,
  };
  const s = profile.get<Partial<Settings>>('settings', {});
  return { ...def, ...s, volumes: { ...def.volumes, ...(s.volumes ?? {}) } };
}

export function saveSettings(s: Settings): void {
  profile.set('settings', s);
}
