/**
 * Fully procedural audio (Web Audio API): no audio files are needed, which keeps
 * the APK light and the game 100 % offline. Three buses with separate volumes:
 * music, sfx and ambience.
 */
export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

const SCALES: Record<string, number[]> = {
  peace: [0, 2, 4, 7, 9, 12, 14, 16],
  wonder: [0, 2, 4, 6, 7, 9, 11, 12],
  war: [0, 2, 3, 5, 7, 8, 10, 12],
  doom: [0, 1, 3, 5, 6, 8, 10, 12],
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfxBus!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private nextBar = 0;
  private bar = 0;
  private timer = 0;
  private windGain: GainNode | null = null;
  private waveGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private lastSfx = new Map<string, number>();
  mood: keyof typeof SCALES = 'peace';
  volumes: Volumes = { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.6 };
  enabled = true;

  /** Must be called from a user gesture (autoplay policies). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
    this.nextBar = ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 250);
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { void this.ctx?.resume(); }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.volumes;
    this.master.gain.setTargetAtTime(this.enabled ? v.master : 0, t, 0.1);
    this.music.gain.setTargetAtTime(v.music * 0.35, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(v.sfx * 0.6, t, 0.05);
    this.amb.gain.setTargetAtTime(v.ambience * 0.5, t, 0.2);
  }

  // ------------------------------------------------------------ music
  private note(freq: number, start: number, dur: number, type: OscillatorType, gain: number, dest: AudioNode, attack = 0.02): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    while (this.nextBar < ctx.currentTime + 1) {
      const t = this.nextBar;
      const scale = SCALES[this.mood];
      const root = this.mood === 'war' || this.mood === 'doom' ? 110 : 130.81;
      const barLen = this.mood === 'war' ? 2.4 : 3.6;
      const deg = [0, 3, 4, 2, 5, 3, 1, 4][this.bar % 8];
      const f = (st: number) => root * Math.pow(2, st / 12);
      // pad chord
      for (const k of [0, 2, 4]) this.note(f(scale[(deg + k) % scale.length]), t, barLen * 1.1, 'triangle', 0.05, this.music, 0.8);
      this.note(f(scale[deg % scale.length] - 12), t, barLen, 'sine', 0.08, this.music, 0.3);
      // arpeggio / melody
      const steps = this.mood === 'war' ? 8 : 6;
      for (let s = 0; s < steps; s++) {
        if (Math.random() < (this.mood === 'peace' ? 0.45 : 0.6)) {
          const st = scale[(deg + Math.floor(Math.random() * 5)) % scale.length] + 12;
          this.note(f(st), t + (s * barLen) / steps, 0.9, this.mood === 'wonder' ? 'sine' : 'triangle', 0.035, this.music);
        }
      }
      // war drums
      if (this.mood === 'war' || this.mood === 'doom') {
        for (let s = 0; s < 4; s++) this.drum(t + (s * barLen) / 4, s % 2 ? 0.12 : 0.2);
      }
      this.nextBar += barLen;
      this.bar++;
    }
  }

  private drum(t: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.35);
  }

  // ------------------------------------------------------------ ambience
  private loopNoise(filterType: BiquadFilterType, freq: number, q = 0.7): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    return g;
  }

  private startAmbience(): void {
    this.windGain = this.loopNoise('lowpass', 400);
    this.waveGain = this.loopNoise('bandpass', 600, 0.4);
    this.rainGain = this.loopNoise('highpass', 3000);
  }

  /** Called a few times per second with what is around the camera. */
  ambience(o: { zoomOut: number; water: number; forest: number; rain: number; night: number; time: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.windGain) return;
    const t = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.05 + o.zoomOut * 0.25, t, 0.5);
    this.waveGain!.gain.setTargetAtTime(o.water * 0.2 * (0.6 + 0.4 * Math.sin(o.time * 0.7)), t, 0.4);
    this.rainGain!.gain.setTargetAtTime(o.rain * 0.18, t, 0.5);
    if (o.forest > 0.2 && o.night < 0.3 && Math.random() < o.forest * 0.15) this.chirp();
  }

  private chirp(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 2200 + Math.random() * 1800;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + k * 0.09;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * 1.4, s + 0.06);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.03, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.07);
      o.connect(g).connect(this.amb);
      o.start(s);
      o.stop(s + 0.08);
    }
  }

  // ------------------------------------------------------------ sfx
  private noiseHit(start: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, start);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(start, Math.random());
    src.stop(start + dur + 0.05);
  }

  /** volume 0..1 lets callers attenuate by distance. */
  sfx(name: string, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || volume <= 0.02) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? 0) < 90) return; // anti-spam
    this.lastSfx.set(name, now);
    const t = ctx.currentTime;
    const v = Math.min(1, volume);
    switch (name) {
      case 'click': this.note(880, t, 0.06, 'sine', 0.15 * v, this.sfxBus, 0.005); break;
      case 'open': this.note(660, t, 0.08, 'sine', 0.1 * v, this.sfxBus, 0.005); this.note(990, t + 0.05, 0.1, 'sine', 0.08 * v, this.sfxBus, 0.005); break;
      case 'error': this.note(220, t, 0.15, 'square', 0.06 * v, this.sfxBus, 0.005); break;
      case 'build': for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.12, 0.06, 'bandpass', 900, 600, 0.3 * v); break;
      case 'explosion': this.noiseHit(t, 1.4, 'lowpass', 2000, 60, 0.9 * v); this.drumSfx(t, 0.6 * v); break;
      case 'thunder': this.noiseHit(t + 0.05, 2.2, 'lowpass', 900, 50, 0.7 * v); break;
      case 'quake': this.noiseHit(t, 2.5, 'lowpass', 160, 40, 1 * v); break;
      case 'wave': this.noiseHit(t, 2.5, 'bandpass', 300, 1200, 0.5 * v); break;
      case 'battle': for (let k = 0; k < 4; k++) this.note(1800 + Math.random() * 900, t + k * 0.07, 0.05, 'square', 0.03 * v, this.sfxBus, 0.002); break;
      case 'war': this.horn(t, v); break;
      case 'rocket': this.noiseHit(t, 3, 'bandpass', 200, 2500, 0.5 * v); break;
      case 'magic': case 'power': for (let k = 0; k < 5; k++) this.note(880 * Math.pow(2, [0, 4, 7, 11, 12][k] / 12), t + k * 0.05, 0.5, 'sine', 0.06 * v, this.sfxBus, 0.005); break;
      case 'birth': this.note(1320, t, 0.3, 'sine', 0.05 * v, this.sfxBus, 0.005); break;
      case 'fire': this.noiseHit(t, 0.6, 'highpass', 2000, 4000, 0.2 * v); break;
      case 'quest': for (let k = 0; k < 4; k++) this.note(523 * Math.pow(2, [0, 4, 7, 12][k] / 12), t + k * 0.11, 0.6, 'triangle', 0.1 * v, this.sfxBus, 0.01); break;
    }
  }

  private drumSfx(t: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 1);
  }

  private horn(t: number, v: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(175, t + 0.4);
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15 * v, t + 0.2);
    g.gain.linearRampToValueAtTime(0, t + 1.6);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 1.7);
  }

  dispose(): void {
    clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
