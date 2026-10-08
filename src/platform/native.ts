import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();
let hapticsEnabled = true;

export function setHaptics(on: boolean): void {
  hapticsEnabled = on;
}

/** Tactile feedback (native haptics on Android, vibration API fallback). */
export function haptic(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!hapticsEnabled) return;
  if (isNative) {
    void Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => undefined);
  } else if ('vibrate' in navigator) {
    try { navigator.vibrate(kind === 'heavy' ? 40 : kind === 'medium' ? 20 : 8); } catch { /* not allowed */ }
  }
}

/** Android back button (falls back to Escape on desktop). */
export function onBack(fn: () => void): void {
  if (isNative) void App.addListener('backButton', fn);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') fn(); });
}

/** App goes to background / comes back (save + offline progression). */
export function onLifecycle(pause: () => void, resume: () => void): void {
  if (isNative) {
    void App.addListener('pause', pause);
    void App.addListener('resume', resume);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  window.addEventListener('pagehide', pause);
}

export function exitApp(): void {
  if (isNative) void App.exitApp();
}
