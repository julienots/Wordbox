import { AudioEngine } from './audio/audio';
import { hash2 } from './core/rng';
import { BASE_TICKS_PER_SECOND, DAYS_PER_YEAR, SPEEDS } from './data/time';
import { DebugOverlay } from './debug/debug';
import { Input } from './input/input';
import { haptic, onBack, onLifecycle, setHaptics } from './platform/native';
import { Camera } from './render/camera';
import { QUALITIES } from './render/quality';
import { Renderer } from './render/renderer';
import { catchUp, offlineYears, OfflineReport } from './save/offline';
import { decode, deserialize, encode, serialize } from './save/serialize';
import { createStore, profile, SaveStore, SlotMeta } from './save/storage';
import { loadSettings, saveSettings, Settings } from './settings';
import { animalById } from './data/animals';
import { setupMode } from './sim/modes';
import { canUse, cooldowns, PowerCtx, PowerDef, usePower } from './sim/powers';
import { createWorld, QUALITY_CAPS, applyCaps, spawnTribe } from './sim/setup';
import { step } from './sim/simulation';
import { isAtWar } from './sim/war';
import type { World, WorldOptions } from './sim/world';
import { Hud } from './ui/hud';
import { Menus } from './ui/menus';
import { Panels } from './ui/panels';

export type Selection = { type: 'person' | 'settlement' | 'kingdom' | 'animal'; id: number } | null;

/**
 * Game controller: owns the active world, the frame loop (fixed-step simulation
 * with a CPU budget per frame, decoupled from rendering), saving, and glue
 * between input, powers, UI, audio and renderer.
 */
export class Game {
  settings: Settings = loadSettings();
  store: SaveStore = createStore();
  audio = new AudioEngine();
  world: World | null = null;
  slot: SlotMeta | null = null;
  cam: Camera | null = null;
  renderer: Renderer | null = null;
  input: Input | null = null;
  hud: Hud;
  panels: Panels;
  menus: Menus;
  debug: DebugOverlay | null = null;
  speed = 1;
  power: PowerDef | null = null;
  powerParam: string | undefined = undefined;
  brushScale = 1;
  powerCtx: PowerCtx = { held: { persons: [], animals: [] } };
  selection: Selection = null;
  /** Real seconds remaining for the "time stop" ultimate. */
  timeStop = 0;
  private acc = 0;
  private last = 0;
  private time = 0;
  private lastAutosave = performance.now();
  private snapshots: { tick: number; data: Uint8Array }[] = [];
  private snapshotBusy = false;
  private hudTimer = 0;
  private ambTimer = 0;
  private unsubs: (() => void)[] = [];
  /** Demo world animating the main menu background. */
  private demo = false;
  saturated = false;
  effectiveTps = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly ui: HTMLElement) {
    this.hud = new Hud(this);
    this.panels = new Panels(this);
    this.menus = new Menus(this);
    if (__DEBUG__) {
      this.debug = new DebugOverlay(ui);
      this.debug.toggle(this.settings.debug);
    }
    this.applyAudioSettings();
    setHaptics(this.settings.haptics);
    window.addEventListener('resize', () => this.renderer?.resize());
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    onBack(() => this.back());
    onLifecycle(() => this.onPause(), () => this.onResume());
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ lifecycle
  async boot(): Promise<void> {
    await this.startDemo();
    this.menus.showMain();
  }

  private async startDemo(): Promise<void> {
    const w = createWorld({ id: 'demo', name: 'Démo', seed: (Date.now() / 86400000) | 0, size: 160, shape: 'continents', mode: 'infinite', civs: 5, species: [], climate: 0, moisture: 0, animals: 1 }, QUALITY_CAPS.low);
    for (let i = 0; i < 40 * DAYS_PER_YEAR; i++) step(w);
    this.attach(w, null, true);
    this.speed = 3;
    this.cam!.zoom = Math.max(this.cam!.minZoom * 1.6, 3);
  }

  attach(w: World, slot: SlotMeta | null, demo = false): void {
    this.detach();
    this.world = w;
    this.slot = slot;
    this.demo = demo;
    applyCaps(w, QUALITY_CAPS[this.settings.quality]);
    cooldowns.clear();
    this.cam = new Camera(w.map.w, w.map.h);
    this.renderer = new Renderer(this.canvas, w, this.cam, QUALITIES[this.settings.quality]);
    this.renderer.dayNight = this.settings.dayNight;
    this.renderer.resize();
    const k = w.kingdoms.get(w.player.chosenKingdom) ?? w.livingKingdoms()[0];
    const cap = k ? w.settlements.get(k.capital) : undefined;
    if (cap && !demo) {
      this.cam.x = cap.x; this.cam.y = cap.y; this.cam.zoom = 9;
    } else this.cam.zoom = this.cam.minZoom * 1.2;
    this.snapshots = [];
    this.selection = null;
    this.power = null;
    this.timeStop = 0;
    w.player.timeStopped = false;
    this.speed = demo ? 3 : 1;
    if (!demo) {
      this.input = new Input(this.canvas, this.cam, {
        tap: (x, y) => this.onTap(x, y),
        doubleTap: (x, y) => { if (!this.power) this.cam?.flyTo(x, y, Math.min(this.cam.maxZoom, this.cam.zoom * 2.2), 0.35); },
        longPress: (x, y) => { haptic('medium'); this.select(x, y, true); },
        painting: () => !!this.power?.paint,
        paint: (x, y, first) => this.applyPower(x, y, first),
        paintEnd: () => this.hud.refreshPowerState(),
        hover: (x, y) => { if (this.renderer?.brush) { this.renderer.brush.x = x; this.renderer.brush.y = y; } },
        key: (key) => this.onKey(key),
      });
      this.unsubs.push(w.bus.on('history', (e) => {
        if (e.imp >= 2) this.hud.toast(e.text, 'imp' + e.imp);
        if (e.type === 'war') this.audio.sfx('war', 0.8);
      }));
      this.unsubs.push(w.bus.on('toast', (e) => this.hud.toast(e.text, e.kind)));
      this.unsubs.push(w.bus.on('quest', (q) => this.onQuest(q.id, q.name)));
      this.unsubs.push(w.bus.on('colony', (c) => void this.createColony(c.kingdom, c.planet, c.seed)));
      this.hud.show(true);
    } else this.hud.show(false);
    this.unsubs.push(w.bus.on('sfx', (e) => this.playSfx(e.name, e.x, e.y)));
    this.hud.onWorld();
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.input?.dispose();
    this.input = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.world = null;
    this.panels.close();
  }

  async newWorld(opts: WorldOptions): Promise<void> {
    this.menus.loading('Création du monde…');
    await new Promise((r) => setTimeout(r, 30));
    const w = createWorld(opts, QUALITY_CAPS[this.settings.quality]);
    setupMode(w);
    if (opts.mode === 'editor') w.player.timeStopped = false;
    const slot = this.metaOf(w);
    this.attach(w, slot);
    if (opts.mode === 'editor') this.speed = 0;
    this.menus.closeAll();
    await this.save();
    if (this.settings.tutorial) this.menus.tutorial();
  }

  async loadWorld(id: string, offline = true): Promise<void> {
    this.menus.loading('Chargement…');
    try {
      const bytes = await this.store.read(id);
      if (!bytes) throw new Error('Sauvegarde introuvable.');
      const w = deserialize(await decode(bytes));
      const meta = (await this.store.list()).find((m) => m.id === id) ?? this.metaOf(w);
      const years = offline && this.settings.offline && w.opts.mode !== 'editor' ? offlineYears(w.savedAt) : 0;
      let report: OfflineReport | null = null;
      if (years > 0) {
        report = await catchUp(w, years, (f) => this.menus.loading(`Pendant votre absence… ${Math.round(f * 100)} %`, f));
      }
      this.attach(w, meta);
      this.menus.closeAll();
      if (report) {
        this.menus.offlineReport(report);
        await this.save();
      }
    } catch (e) {
      this.menus.closeAll();
      this.menus.showMain();
      this.hud.toast('Erreur de chargement : ' + (e as Error).message, 'lose');
    }
  }

  metaOf(w: World): SlotMeta {
    return {
      id: w.opts.id, name: w.opts.name, seed: w.opts.seed, mode: w.opts.mode, year: w.year, pop: w.totalPop(),
      kingdoms: w.livingKingdoms().length, size: w.opts.size, savedAt: Date.now(), parent: w.opts.parentWorld,
    };
  }

  thumbnail(): string | undefined {
    const r = this.renderer;
    if (!r) return undefined;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const ctx = c.getContext('2d')!;
    r.terrain.refreshWorld();
    ctx.drawImage(r.terrain.worldCanvas, 0, 0, 96, 96);
    ctx.drawImage(r.overlay.canvas, 0, 0, 96, 96);
    return c.toDataURL('image/png');
  }

  async save(asNew = false): Promise<void> {
    const w = this.world;
    if (!w || this.demo) return;
    if (asNew) {
      w.opts.id = 'w' + Date.now().toString(36);
      w.opts.name = w.opts.name.replace(/ \(copie.*\)$/, '') + ` (copie an ${w.year})`;
    }
    const meta = { ...this.metaOf(w), thumb: this.thumbnail() };
    w.savedAt = Date.now();
    const data = await encode(serialize(w));
    await this.store.write(meta, data);
    this.slot = meta;
    profile.set('lastWorld', meta.id);
    this.lastAutosave = performance.now();
  }

  private onPause(): void {
    if (this.world && !this.demo) void this.save();
    this.audio.suspend();
  }

  private onResume(): void {
    this.audio.resume();
    const w = this.world;
    if (!w || this.demo || !this.settings.offline) return;
    const years = offlineYears(w.savedAt);
    if (years > 0) {
      void catchUp(w, years, (f) => this.menus.loading(`Pendant votre absence… ${Math.round(f * 100)} %`, f)).then((rep) => {
        this.menus.closeAll();
        this.menus.offlineReport(rep);
        void this.save();
      });
    }
  }

  back(): void {
    if (this.menus.handleBack()) return;
    if (this.panels.isOpen()) { this.panels.close(); return; }
    if (this.hud.closeOverlays()) return;
    if (this.power) { this.setPower(null); return; }
    if (this.world && !this.demo) this.menus.pause();
  }

  async quitToMenu(): Promise<void> {
    await this.save();
    await this.startDemo();
    this.menus.showMain();
  }

  // ------------------------------------------------------------ loop
  private frame(t: number): void {
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
    this.last = t;
    this.time += dt;
    const w = this.world, cam = this.cam, r = this.renderer;
    if (w && cam && r) {
      if (!this.demo) w.playTime += dt;
      cam.update(dt);
      if (this.demo) { cam.x += dt * 1.5; if (cam.x > w.map.w * 0.8) cam.x = w.map.w * 0.2; }
      const v = cam.view(2);
      w.focus = { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 };
      // fixed-step simulation with a CPU budget so rendering never freezes
      const simStart = performance.now();
      let ticks = 0;
      if (this.timeStop > 0) {
        this.timeStop -= dt;
        if (this.timeStop <= 0) { w.player.timeStopped = false; this.hud.toast('Le temps reprend son cours.'); }
      }
      const tps = w.player.timeStopped ? 0 : BASE_TICKS_PER_SECOND * SPEEDS[this.speed];
      this.acc += dt * tps;
      const budget = this.demo ? 4 : 11;
      this.saturated = false;
      while (this.acc >= 1) {
        step(w);
        this.acc -= 1;
        ticks++;
        if (performance.now() - simStart > budget) { this.saturated = this.acc > 2; this.acc = Math.min(this.acc, 2); break; }
      }
      this.effectiveTps = this.effectiveTps * 0.95 + (ticks / Math.max(dt, 1e-3)) * 0.05;
      const simMs = performance.now() - simStart;
      const alpha = Math.min(1, this.acc);
      r.render(dt, this.time, alpha);
      if (this.debug) { this.debug.simMs = simMs; this.debug.ticksPerSec = this.effectiveTps; this.debug.update(w, r); }
      this.hudTimer += dt;
      if (this.hudTimer > 0.25) { this.hudTimer = 0; this.hud.update(); this.panels.refresh(); }
      this.ambTimer += dt;
      if (this.ambTimer > 0.5) { this.ambTimer = 0; this.updateAmbience(); }
      if (!this.demo) this.maintenance(w);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private maintenance(w: World): void {
    const now = performance.now();
    if (this.settings.autosave > 0 && now - this.lastAutosave > this.settings.autosave * 60000) {
      this.lastAutosave = now;
      void this.save();
    }
    // in-memory snapshots for the "rewind" power (every 10 years, last 6)
    const last = this.snapshots[this.snapshots.length - 1];
    if (!this.snapshotBusy && (!last || w.tick - last.tick >= DAYS_PER_YEAR * 10)) {
      this.snapshotBusy = true;
      const tick = w.tick;
      void encode(serialize(w)).then((data) => {
        this.snapshots.push({ tick, data });
        if (this.snapshots.length > 6) this.snapshots.shift();
        this.snapshotBusy = false;
      });
    }
    const atWar = w.livingKingdoms().some((k) => isAtWar(w, k));
    this.audio.mood = w.opts.mode === 'apocalypse' && w.year > 50 ? 'doom' : atWar ? 'war' : w.livingKingdoms().some((k) => k.era >= 10) ? 'wonder' : 'peace';
  }

  private updateAmbience(): void {
    const w = this.world, cam = this.cam;
    if (!w || !cam) return;
    const m = w.map;
    let water = 0, forest = 0, n = 0;
    const v = cam.view(0);
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(v.x0 + Math.random() * (v.x1 - v.x0)), y = Math.floor(v.y0 + Math.random() * (v.y1 - v.y0));
      if (!m.inside(x, y)) continue;
      const i = m.idx(x, y);
      n++;
      if (m.isWater(i)) water++;
      else if (m.veg[i] > 150) forest++;
    }
    let rain = 0;
    for (const c of w.weather) if (Math.hypot(c.x - cam.x, c.y - cam.y) < c.r && c.type !== 'snow') rain = 1;
    const zoomOut = 1 - Math.min(1, cam.zoom / 20);
    this.audio.ambience({ zoomOut, water: n ? water / n : 0, forest: n ? (forest / n) * (1 - zoomOut) : 0, rain, night: this.renderer?.night(this.time) ?? 0, time: this.time });
  }

  playSfx(name: string, x?: number, y?: number): void {
    const cam = this.cam;
    let vol = 1;
    if (cam && x !== undefined && y !== undefined) {
      const d = Math.hypot(x - cam.x, y - cam.y) * cam.zoom;
      vol = Math.max(0, 1 - d / (Math.max(cam.vw, cam.vh) * 1.2));
    }
    this.audio.sfx(name, vol);
  }

  applyAudioSettings(): void {
    this.audio.volumes = { ...this.settings.volumes };
    this.audio.enabled = this.settings.audio;
    this.audio.applyVolumes();
  }

  updateSettings(patch: Partial<Settings>): void {
    const before = this.settings.quality;
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    if (patch.quality && patch.quality !== before && this.renderer && this.world) {
      this.renderer.setQuality(QUALITIES[patch.quality]);
      applyCaps(this.world, QUALITY_CAPS[patch.quality]);
    }
    if (this.renderer) this.renderer.dayNight = this.settings.dayNight;
    if (patch.debug !== undefined) this.debug?.toggle(patch.debug);
    setHaptics(this.settings.haptics);
    this.applyAudioSettings();
    this.hud.onWorld();
  }

  setSpeed(i: number): void {
    this.speed = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.hud.update();
  }

  // ------------------------------------------------------------ interaction
  private onKey(key: string): void {
    if (key === ' ') this.setSpeed(this.speed === 0 ? 1 : 0);
    else if (/^[0-5]$/.test(key)) this.setSpeed(Number(key));
    else if (key === 'd' && this.debug) this.updateSettings({ debug: !this.settings.debug });
  }

  setPower(p: PowerDef | null, param?: string): void {
    this.power = p;
    if (param !== undefined) this.powerParam = param;
    this.powerCtx.held = { persons: [], animals: [] };
    if (this.renderer) this.renderer.brush = p ? { x: this.cam!.x, y: this.cam!.y, r: p.r * this.brushScale, color: p.ultimate ? '#c890ff' : p.cat === 'destruction' ? '#ff7a5a' : '#ffe28a' } : null;
    this.hud.refreshPowerState();
  }

  applyPower(x: number, y: number, first: boolean): void {
    const w = this.world, p = this.power;
    if (!w || !p) return;
    if (!w.map.inside(x | 0, y | 0)) return;
    const err = canUse(w, p);
    if (err) {
      if (first) { this.hud.toast(err, 'lose'); this.audio.sfx('error'); }
      return;
    }
    const r = p.r * (p.paint ? this.brushScale : 1);
    this.powerCtx.param = this.powerParam;
    const res = usePower(w, p, x, y, r, this.powerCtx);
    if (this.renderer?.brush) { this.renderer.brush.x = x; this.renderer.brush.y = y; this.renderer.brush.r = r; }
    if (first) {
      haptic(p.cat === 'destruction' || p.ultimate ? 'heavy' : 'light');
      this.playSfx(p.cat === 'destruction' && !['fire', 'plague', 'famine', 'curse'].includes(p.id) ? 'explosion' : p.id === 'fire' ? 'fire' : 'magic', x, y);
    }
    if (res.msg && first) this.hud.toast(res.msg);
    if (res.special === 'timestop') {
      w.player.timeStopped = true;
      this.timeStop = 20;
      this.hud.toast('⏸️ Le temps est figé pendant 20 secondes. Vos pouvoirs restent actifs.', 'imp3');
    } else if (res.special === 'rewind') void this.rewind();
    this.hud.refreshPowerState();
  }

  private async rewind(): Promise<void> {
    const w = this.world;
    if (!w) return;
    const target = this.snapshots.find((s) => w.tick - s.tick >= DAYS_PER_YEAR * 20) ?? this.snapshots[0];
    if (!target) { this.hud.toast('Aucun instant passé mémorisé pour l’instant.'); return; }
    const old = deserialize(await decode(target.data));
    old.player.faith = w.player.faith;
    old.addHistory('divine', `Le Créateur remonte le temps de l’an ${w.year} à l’an ${old.year}.`, 3);
    old.questsDone = w.questsDone;
    const cam = this.cam!;
    const pos = { x: cam.x, y: cam.y, z: cam.zoom };
    this.attach(old, this.slot);
    this.cam!.x = pos.x; this.cam!.y = pos.y; this.cam!.zoom = pos.z;
    this.renderer!.effects.flash = 1;
    this.renderer!.effects.flashColor = '180,200,255';
    this.hud.toast(`⏪ Retour à l’an ${old.year}.`, 'imp3');
  }

  private onTap(x: number, y: number): void {
    if (this.power) { this.applyPower(x, y, true); return; }
    this.select(x, y, false);
  }

  /** Pick the closest thing under the finger: person, animal, settlement, kingdom. */
  select(x: number, y: number, deep: boolean): void {
    const w = this.world, cam = this.cam;
    if (!w || !cam || !w.map.inside(x | 0, y | 0)) return;
    const radius = Math.max(0.8, 14 / cam.zoom);
    if (cam.zoom >= 8 && !deep) {
      const p = w.spatialPersons.nearest(x, y, radius, () => true);
      if (p) { this.inspect({ type: 'person', id: p.id }); return; }
      const a = w.spatialAnimals.nearest(x, y, radius, () => true);
      if (a) { this.inspect({ type: 'animal', id: a.id }); return; }
    }
    for (const army of w.armies.values()) {
      if (Math.hypot(army.x - x, army.y - y) < radius * 1.5) { this.inspect({ type: 'kingdom', id: army.kingdom }); return; }
    }
    const own = w.map.owner[w.map.idx(x | 0, y | 0)];
    const s = w.settlements.get(own);
    if (s) {
      const near = Math.hypot(s.x - x, s.y - y) < Math.max(3, 30 / cam.zoom);
      this.inspect(deep && !near ? { type: 'kingdom', id: s.kingdom } : { type: 'settlement', id: s.id });
      return;
    }
    let best = -1, bd = Infinity;
    for (const st of w.settlements.values()) {
      const d = Math.hypot(st.x - x, st.y - y);
      if (d < bd) { bd = d; best = st.id; }
    }
    if (best >= 0 && bd < 24 / cam.zoom + 1) { this.inspect({ type: 'settlement', id: best }); return; }
    this.panels.tile(x | 0, y | 0);
  }

  inspect(sel: Selection): void {
    this.selection = sel;
    if (this.renderer) this.renderer.selectedPerson = sel?.type === 'person' ? sel.id : -1;
    this.audio.sfx('open');
    this.panels.inspect(sel);
  }

  follow(sel: Selection): void {
    const w = this.world, cam = this.cam;
    if (!w || !cam || !sel) return;
    const label = this.panels.labelOf(sel);
    cam.follow = {
      label,
      pos: () => {
        if (sel.type === 'person') { const p = w.persons.get(sel.id); return p ? (p.army >= 0 ? w.armies.get(p.army) ?? p : p) : null; }
        if (sel.type === 'animal') return w.animals.get(sel.id) ?? null;
        if (sel.type === 'settlement') { const s = w.settlements.get(sel.id); return s ? { x: s.x + 0.5, y: s.y + 0.5 } : null; }
        const k = w.kingdoms.get(sel.id);
        const s = k ? w.settlements.get(k.capital) : undefined;
        return s ? { x: s.x + 0.5, y: s.y + 0.5 } : null;
      },
    };
    if (sel.type === 'kingdom') cam.flyTo(cam.x, cam.y, Math.min(cam.zoom, 6), 0.4);
    else if (cam.zoom < 10) cam.flyTo(cam.x, cam.y, 14, 0.4);
    this.hud.update();
  }

  flyTo(x: number, y: number, zoom?: number): void {
    this.cam?.flyTo(x, y, zoom ?? Math.max(this.cam.zoom, 8));
  }

  private onQuest(id: string, name: string): void {
    const all = profile.get<string[]>('achievements', []);
    if (!all.includes(id)) { all.push(id); profile.set('achievements', all); }
    this.hud.toast(`🏆 Défi accompli : ${name}`, 'win');
    this.audio.sfx('quest');
    haptic('medium');
  }

  /** A space-faring kingdom colonised a new planet: generate & save it as a new world. */
  private async createColony(kingdomId: number, planet: string, seed: number): Promise<void> {
    const w = this.world;
    const k = w?.kingdoms.get(kingdomId);
    if (!w || !k) return;
    const opts: WorldOptions = { id: 'p' + (seed >>> 0).toString(36), name: planet, seed: seed >>> 0, size: 192, shape: (['archipelago', 'pangea', 'islands', 'continents'] as const)[seed % 4], mode: 'infinite', civs: 2, species: [], climate: ((seed >> 4) % 3) - 1, moisture: 0, animals: 0.8, parentWorld: w.opts.id };
    const colony = createWorld(opts, QUALITY_CAPS.low);
    // the colonists: a tribe of the same species with the founding kingdom's technology
    const m = colony.map;
    for (let t = 0; t < 2000; t++) {
      const i = colony.rng.int(0, m.size - 1);
      if (!m.buildable(i) || m.owner[i] >= 0) continue;
      const nk = spawnTribe(colony, i % m.w, (i / m.w) | 0, k.species, 16);
      if (nk) {
        nk.name = `Colonie de ${k.name}`;
        nk.techs = [...k.techs];
        nk.era = k.era;
        colony.addHistory('space', `Arrivée des colons venus de ${w.opts.name} (${k.name}).`, 3);
        break;
      }
    }
    const meta = { id: opts.id, name: planet, seed: opts.seed, mode: 'infinite', year: 0, pop: colony.totalPop(), kingdoms: colony.livingKingdoms().length, size: 192, savedAt: Date.now(), parent: w.opts.id };
    await this.store.write(meta, await encode(serialize(colony)));
    this.hud.toast(`🪐 Nouvelle planète colonisée : ${planet} (disponible dans « Mondes »).`, 'imp3');
  }

  hash(): number {
    return hash2(this.world?.tick ?? 0, 7);
  }

  speciesName(sp: string): string {
    return animalById.get(sp)?.name ?? sp;
  }
}
