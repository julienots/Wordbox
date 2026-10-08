import { fmtNum } from '../core/math';
import { seedFromText } from '../core/rng';
import { SPECIES } from '../data/species';
import type { Game } from '../game';
import { exitApp, isNative } from '../platform/native';
import { QUALITIES, QualityName } from '../render/quality';
import type { OfflineReport } from '../save/offline';
import { profile } from '../save/storage';
import { MODES, SCENARIOS } from '../sim/modes';
import type { GameMode, WorldOptions } from '../sim/world';
import type { WorldShape } from '../world/generator';
import { btn, h } from './dom';

const SIZES: [number, string][] = [[192, 'Petit'], [256, 'Moyen'], [320, 'Grand'], [416, 'Immense']];
const SHAPES: [WorldShape, string][] = [['continents', 'Continents'], ['pangea', 'Pangée'], ['archipelago', 'Archipel'], ['islands', 'Îles'], ['inland', 'Mer intérieure']];

/** Full-screen menus and modal dialogs. */
export class Menus {
  private layer: HTMLDivElement | null = null;
  private stack: (() => void)[] = [];

  constructor(private g: Game) {}

  private show(el: HTMLElement, back?: () => void): void {
    this.layer?.remove();
    this.layer = el as HTMLDivElement;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.g.ui.append(el);
    this.stack = back ? [back] : [];
  }

  closeAll(): void {
    this.layer?.remove();
    this.layer = null;
    this.stack = [];
  }

  /** Returns true when a menu consumed the back action. */
  handleBack(): boolean {
    if (!this.layer) return false;
    const back = this.stack.pop();
    if (back) back();
    else if (this.layer.id === 'menu') { if (isNative) exitApp(); }
    else this.closeAll();
    return true;
  }

  private modal(title: string, ...content: (Node | string | null)[]): HTMLDivElement {
    const card = h('div', { cls: 'card' }, h('h2', null, title), ...content);
    return h('div', { cls: 'modal' }, card);
  }

  loading(text: string, f?: number): void {
    const bar = h('div', { cls: 'progress' }, h('i', { style: `width:${Math.round((f ?? 0) * 100)}%` }));
    if (this.layer?.dataset.loading) {
      this.layer.querySelector('h2')!.textContent = text;
      const i = this.layer.querySelector<HTMLElement>('.progress i');
      if (i) i.style.width = `${Math.round((f ?? 0) * 100)}%`;
      return;
    }
    const m = this.modal(text, f !== undefined ? bar : h('p', { cls: 'muted' }, 'Un instant…'), f === undefined ? null : null);
    m.dataset.loading = '1';
    if (f !== undefined && !m.querySelector('.progress')) m.querySelector('.card')!.append(bar);
    this.show(m);
  }

  async showMain(): Promise<void> {
    const g = this.g;
    const last = profile.get<string | null>('lastWorld', null);
    const slots = await g.store.list();
    const hasLast = !!last && slots.some((s) => s.id === last);
    const menu = h('div', { id: 'menu' },
      h('h1', null, 'AEONIS'),
      h('div', { cls: 'sub' }, 'Chroniques des mondes'),
      hasLast ? btn('▶ Continuer', () => void g.loadWorld(last!), 'btn gold') : null,
      btn('🌍 Nouveau monde', () => this.newWorld(), 'btn primary'),
      btn(`💾 Mondes sauvegardés (${slots.length})`, () => void this.worlds(), 'btn'),
      btn('⚙️ Paramètres', () => this.settings(() => this.showMain()), 'btn'),
      btn('ℹ️ À propos', () => this.about(), 'btn'),
      h('div', { cls: 'muted' }, `Version ${__VERSION__} · hors-ligne`),
    );
    this.show(menu);
  }

  newWorld(): void {
    const g = this.g;
    const name = h('input', { type: 'text', value: 'Monde de ' + ['Aube', 'Braise', 'Cendre', 'Écume', 'Givre', 'Lumen', 'Orée'][Math.floor(Math.random() * 7)] });
    const seed = h('input', { type: 'text', value: String(Math.floor(Math.random() * 1e9)) });
    const sel = (opts: [string | number, string][], v: string | number) => { const s = h('select'); for (const [id, n] of opts) s.append(h('option', { value: String(id), selected: id === v }, n)); return s; };
    const size = sel(SIZES, 256);
    const shape = sel(SHAPES, 'continents');
    const mode = sel(MODES.map((m) => [m.id, `${m.icon} ${m.name}`]), 'sandbox');
    const scenario = sel(SCENARIOS.map((s) => [s.id, s.name]), SCENARIOS[0].id);
    const scenRow = h('label', null, 'Scénario');
    const modeDesc = h('div', { cls: 'muted', style: 'grid-column:1/-1' });
    const range = (min: number, max: number, step: number, v: number) => h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v) });
    const civs = range(0, 14, 1, 6);
    const civsVal = h('span', null, '6');
    civs.oninput = () => (civsVal.textContent = civs.value);
    const climate = range(-1, 1, 0.1, 0);
    const moisture = range(-1, 1, 0.1, 0);
    const fauna = range(0, 2, 0.1, 1);
    const species = h('div', { cls: 'row' });
    for (const s of SPECIES) species.append(h('label', { cls: 'chip' }, h('input', { type: 'checkbox', checked: true, value: s.id }), s.plural));
    const sync = () => {
      const m = MODES.find((x) => x.id === mode.value)!;
      modeDesc.textContent = `${m.desc} — ${m.goal}`;
      const sc = mode.value === 'scenario';
      scenario.style.display = scenRow.style.display = sc ? '' : 'none';
      if (sc) civs.value = String(SCENARIOS.find((s) => s.id === scenario.value)?.civs ?? 5), (civsVal.textContent = civs.value);
    };
    mode.onchange = sync;
    scenario.onchange = sync;
    const form = h('div', { cls: 'form' },
      h('label', null, 'Nom'), name,
      h('label', null, 'Graine'), h('div', { cls: 'row' }, seed, btn('🎲', () => (seed.value = String(Math.floor(Math.random() * 1e9))), 'btn icon')),
      h('label', null, 'Taille'), size,
      h('label', null, 'Forme'), shape,
      h('label', null, 'Mode'), mode, modeDesc,
      scenRow, scenario,
      h('label', null, 'Civilisations'), h('div', { cls: 'row' }, civs, civsVal),
      h('label', null, 'Peuples'), species,
      h('label', null, 'Climat (froid ↔ chaud)'), climate,
      h('label', null, 'Humidité (aride ↔ humide)'), moisture,
      h('label', null, 'Faune'), fauna,
    );
    sync();
    const create = () => {
      const sp = [...species.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
      const opts: WorldOptions = {
        id: 'w' + Date.now().toString(36), name: name.value.trim() || 'Nouveau monde', seed: seedFromText(seed.value), size: Number(size.value),
        shape: shape.value as WorldShape, mode: mode.value as GameMode, civs: mode.value === 'evolution' ? Math.max(2, Number(civs.value)) : Number(civs.value),
        species: sp.length ? sp : ['human'], climate: Number(climate.value), moisture: Number(moisture.value), animals: Number(fauna.value),
        scenario: mode.value === 'scenario' ? scenario.value : undefined,
      };
      void g.newWorld(opts);
    };
    this.show(this.modal('Nouveau monde', form, h('div', { cls: 'row', style: 'margin-top:14px' }, btn('Annuler', () => this.showMain()), h('div', { cls: 'grow' }), btn('✨ Créer le monde', create, 'btn gold'))), () => this.showMain());
  }

  async worlds(): Promise<void> {
    const g = this.g;
    const slots = await g.store.list();
    const list = h('div', { cls: 'col' });
    const roots = slots.filter((s) => !s.parent || !slots.some((p) => p.id === s.parent));
    const render = (s: (typeof slots)[number], indent = 0) => {
      list.append(h('div', { cls: 'slot', style: `margin-left:${indent * 22}px` },
        s.thumb ? h('img', { src: s.thumb }) : h('div', { style: 'width:64px;height:64px;border-radius:8px;background:#123;display:flex;align-items:center;justify-content:center;font-size:28px' }, indent ? '🪐' : '🌍'),
        h('div', { cls: 'grow' }, h('b', null, (indent ? '🪐 ' : '') + s.name), h('br'), h('span', { cls: 'muted' }, `An ${s.year} · ${fmtNum(s.pop)} hab. · ${s.kingdoms} nations · ${MODES.find((m) => m.id === s.mode)?.name ?? s.mode}`), h('br'), h('span', { cls: 'muted' }, `${new Date(s.savedAt).toLocaleString('fr-FR')} · graine ${s.seed}${s.bytes ? ` · ${(s.bytes / 1024).toFixed(0)} Ko` : ''}`)),
        btn('▶', () => void g.loadWorld(s.id), 'btn primary icon'),
        btn('🗑', () => { if (confirm(`Supprimer « ${s.name} » ?`)) void g.store.remove(s.id).then(() => this.worlds()); }, 'btn danger icon'),
      ));
      for (const c of slots.filter((x) => x.parent === s.id)) render(c, indent + 1);
    };
    for (const s of roots) render(s);
    if (!slots.length) list.append(h('p', { cls: 'muted' }, 'Aucun monde sauvegardé.'));
    this.show(this.modal('Mondes & planètes', h('p', { cls: 'muted' }, 'Les planètes colonisées par vos civilisations apparaissent sous leur monde d’origine.'), list, h('div', { cls: 'row', style: 'margin-top:12px' }, btn('← Retour', () => this.showMain()), h('div', { cls: 'grow' }), btn('🌍 Nouveau monde', () => this.newWorld(), 'btn gold'))), () => this.showMain());
  }

  pause(): void {
    const g = this.g;
    const prev = g.speed;
    g.setSpeed(0);
    const resume = () => { this.closeAll(); g.setSpeed(prev || 1); };
    const w = g.world;
    this.show(this.modal('Pause',
      w ? h('p', { cls: 'muted' }, `${w.opts.name} · An ${w.year} · graine ${w.opts.seed} · ${MODES.find((m) => m.id === w.opts.mode)?.name}`) : null,
      h('div', { cls: 'col' },
        btn('▶ Reprendre', resume, 'btn gold'),
        btn('💾 Sauvegarder', () => void g.save().then(() => g.hud.toast('Monde sauvegardé.')), 'btn'),
        btn('📄 Sauvegarder comme nouveau monde', () => void g.save(true).then(() => g.hud.toast('Copie créée.')), 'btn'),
        btn('⚙️ Paramètres', () => this.settings(() => this.pause()), 'btn'),
        btn('🏠 Menu principal', () => void g.quitToMenu(), 'btn danger'),
      )), resume);
  }

  settings(back: () => void): void {
    const g = this.g;
    const s = g.settings;
    const q = h('select');
    for (const [id, qq] of Object.entries(QUALITIES)) q.append(h('option', { value: id, selected: id === s.quality }, qq.label));
    q.onchange = () => g.updateSettings({ quality: q.value as QualityName });
    const vol = (key: keyof typeof s.volumes, label: string) => {
      const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volumes[key]) });
      r.oninput = () => g.updateSettings({ volumes: { ...g.settings.volumes, [key]: Number(r.value) } });
      return [h('label', null, label), r];
    };
    const check = (key: 'dayNight' | 'audio' | 'haptics' | 'offline' | 'minimap' | 'tutorial' | 'debug', label: string) => {
      const c = h('input', { type: 'checkbox', checked: s[key] as boolean });
      c.onchange = () => g.updateSettings({ [key]: c.checked });
      return [h('label', null, label), c];
    };
    const auto = h('select');
    for (const [v, n] of [[0, 'Désactivée'], [1, '1 min'], [2, '2 min'], [5, '5 min']] as const) auto.append(h('option', { value: String(v), selected: v === s.autosave }, n));
    auto.onchange = () => g.updateSettings({ autosave: Number(auto.value) });
    const form = h('div', { cls: 'form' },
      h('label', null, 'Qualité graphique'), q,
      ...check('dayNight', 'Cycle jour / nuit'),
      ...check('minimap', 'Mini-carte'),
      ...check('audio', 'Son'),
      ...vol('master', 'Volume général'), ...vol('music', 'Musique'), ...vol('sfx', 'Effets'), ...vol('ambience', 'Ambiance'),
      ...check('haptics', 'Retour haptique'),
      h('label', null, 'Sauvegarde auto'), auto,
      ...check('offline', 'Progression hors-ligne'),
      ...check('tutorial', 'Afficher l’aide au démarrage'),
      ...(__DEBUG__ ? check('debug', 'Overlay de debug') : []),
    );
    const qd = QUALITIES[s.quality];
    this.show(this.modal('Paramètres', form, h('p', { cls: 'muted' }, `Qualité ${qd.label} : ombres ${qd.shadows ? 'oui' : 'non'}, particules ${qd.particles}, eau ${['statique', 'animée', 'animée+'][qd.water]}, ${qd.maxPersons} habitants visibles, distance ${qd.chunkCache} chunks.`), btn('← Retour', back, 'btn')), back);
  }

  offlineReport(r: OfflineReport): void {
    const list = h('div', { cls: 'list' });
    for (const e of r.events.slice(-25)) list.append(h('div', { cls: `item imp${e.imp}` }, h('span', { cls: 'y' }, `An ${Math.floor(e.tick / 120)}`), e.text));
    if (!r.events.length) list.append(h('p', { cls: 'muted' }, 'Le monde a vécu paisiblement.'));
    this.show(this.modal('Pendant votre absence…',
      h('p', null, `${r.years} années se sont écoulées.`),
      h('p', { cls: 'muted' }, `Population : ${fmtNum(r.popBefore)} → ${fmtNum(r.popAfter)} · Nations : ${r.kingdomsBefore} → ${r.kingdomsAfter}`),
      list, btn('Continuer', () => this.closeAll(), 'btn gold')));
  }

  tutorial(): void {
    this.show(this.modal('Bienvenue, Créateur',
      h('div', { cls: 'list' },
        h('div', { cls: 'item' }, '☝️ Un doigt : déplacer la caméra · deux doigts : zoomer (pincer) · double-tap : zoomer.'),
        h('div', { cls: 'item' }, '🔍 Zoom éloigné : royaumes et frontières · moyen : villes et armées · proche : habitants et animaux.'),
        h('div', { cls: 'item' }, '👆 Touchez un habitant, une ville ou un royaume pour l’inspecter et le suivre. Appui long : inspecter la ville / le royaume.'),
        h('div', { cls: 'item' }, '✨ La roue des pouvoirs et la barre du bas donnent accès à la nature, la vie, la destruction, la manipulation et aux pouvoirs ultimes.'),
        h('div', { cls: 'item' }, '⏩ Accélérez le temps en haut à droite. Les civilisations vivent seules : observez, favorisez ou détruisez.'),
      ),
      h('div', { cls: 'row', style: 'margin-top:12px' }, btn('Ne plus afficher', () => { this.g.updateSettings({ tutorial: false }); this.closeAll(); }), h('div', { cls: 'grow' }), btn('Commencer', () => this.closeAll(), 'btn gold'))));
  }

  about(): void {
    this.show(this.modal('À propos d’Aeonis',
      h('p', null, 'Aeonis est un simulateur de mondes et de civilisations : génération procédurale, habitants individuels avec familles et génétique, cultures, religions, royaumes, diplomatie, guerres, économie, technologies jusqu’à l’espace, écosystème, climat et pouvoirs divins.'),
      h('p', { cls: 'muted' }, 'Tous les graphismes et sons sont générés procéduralement. Fonctionne entièrement hors-ligne.'),
      btn('← Retour', () => this.showMain(), 'btn')), () => this.showMain());
  }
}
