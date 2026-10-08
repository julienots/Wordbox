import { fmtNum, hsl } from '../core/math';
import { ANIMALS } from '../data/animals';
import { SPECIES } from '../data/species';
import { SEASONS, seasonOf } from '../data/time';
import type { Game } from '../game';
import { haptic } from '../platform/native';
import { FILTERS } from '../render/overlay';
import { CAT_NAMES, canUse, limitedPowers, PowerCat, POWERS } from '../sim/powers';
import { btn, clear, h } from './dom';

const CAT_ICONS: Record<PowerCat, string> = { nature: '🌿', life: '🧬', destruction: '💥', manipulation: '🌀', ultimate: '☄️', editor: '🛠️' };
const SPEED_LABELS = ['⏸', '▶', '▶▶', '▶▶▶', '⏩', '⚡'];

export class Hud {
  private top: HTMLDivElement;
  private date: HTMLSpanElement;
  private popEl: HTMLSpanElement;
  private faithPill: HTMLDivElement;
  private faithEl: HTMLSpanElement;
  private speedBtns: HTMLButtonElement[] = [];
  private bottom: HTMLDivElement;
  private drawer: HTMLDivElement;
  private wheel: HTMLDivElement;
  private toasts: HTMLDivElement;
  private followEl: HTMLDivElement;
  private minimap: HTMLCanvasElement;
  private hint: HTMLDivElement;
  private objective: HTMLDivElement;
  private cat: PowerCat | null = null;
  private catBtns = new Map<PowerCat, HTMLButtonElement>();
  private navBtn: HTMLButtonElement;
  private editorBtn: HTMLButtonElement;
  private mmTimer = 0;

  constructor(private g: Game) {
    const ui = g.ui;
    // ---- top bar
    this.date = h('span');
    this.popEl = h('span');
    this.faithEl = h('span');
    this.faithPill = h('div', { cls: 'pill', title: 'Foi : énergie divine des modes limités' }, '🙏', this.faithEl);
    const speedbar = h('div', { id: 'speedbar' });
    SPEED_LABELS.forEach((l, i) => {
      const b = btn(l, () => { g.setSpeed(i); haptic(); });
      this.speedBtns.push(b);
      speedbar.append(b);
    });
    this.objective = h('div', { cls: 'pill', style: 'display:none;max-width:40vw;overflow:hidden;text-overflow:ellipsis' });
    this.top = h('div', { id: 'topbar' },
      h('div', { cls: 'pill' }, this.date),
      h('div', { cls: 'pill' }, this.popEl),
      this.faithPill,
      this.objective,
      h('div', { cls: 'spacer' }),
      speedbar,
      btn('☰', () => g.menus.pause(), 'btn icon', 'Menu'),
    );
    // ---- bottom bar
    const tools = h('div', { cls: 'toolbar' });
    this.navBtn = this.tool(tools, '🖐', 'Explorer', () => { g.setPower(null); this.openCat(null); });
    for (const cat of ['nature', 'life', 'destruction', 'manipulation', 'ultimate'] as PowerCat[]) {
      this.catBtns.set(cat, this.tool(tools, CAT_ICONS[cat], CAT_NAMES[cat], () => this.openCat(this.cat === cat ? null : cat)));
    }
    this.editorBtn = this.tool(tools, CAT_ICONS.editor, 'Éditeur', () => this.openCat(this.cat === 'editor' ? null : 'editor'));
    this.catBtns.set('editor', this.editorBtn);
    this.tool(tools, '🗺️', 'Filtres', () => g.panels.filters());
    this.tool(tools, '📊', 'Stats', () => g.panels.stats());
    this.tool(tools, '📜', 'Histoire', () => g.panels.timeline());
    this.tool(tools, '👑', 'Nations', () => g.panels.nations());
    this.tool(tools, '📖', 'Codex', () => g.panels.codex());
    this.tool(tools, '🏆', 'Défis', () => g.panels.quests());
    const wheelBtn = h('button', { id: 'wheelBtn', title: 'Roue des pouvoirs', onclick: () => this.openWheel() }, '✨');
    this.bottom = h('div', { id: 'bottombar' }, wheelBtn, tools);
    this.drawer = h('div', { id: 'drawer' });
    this.wheel = h('div', { id: 'wheel', onclick: (e) => { if (e.target === this.wheel) this.closeWheel(); } });
    this.toasts = h('div', { id: 'toasts' });
    this.followEl = h('div', { id: 'follow', cls: 'pill' });
    this.minimap = h('canvas', { id: 'minimap', width: 132, height: 132 });
    this.minimap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const w = g.world;
      if (!w || !g.cam) return;
      const r = this.minimap.getBoundingClientRect();
      g.cam.flyTo(((e.clientX - r.left) / r.width) * w.map.w, ((e.clientY - r.top) / r.height) * w.map.h, g.cam.zoom, 0.4);
    });
    this.hint = h('div', { id: 'hint' });
    ui.append(this.top, this.minimap, this.drawer, this.bottom, this.followEl, this.toasts, this.hint, this.wheel);
    this.show(false);
  }

  private tool(parent: HTMLElement, icon: string, label: string, fn: () => void): HTMLButtonElement {
    const b = h('button', { cls: 'btn', title: label, onclick: (e) => { e.stopPropagation(); haptic(); this.g.audio.sfx('click'); fn(); } }, icon, h('small', null, label));
    parent.append(b);
    return b;
  }

  show(on: boolean): void {
    for (const el of [this.top, this.bottom]) el.style.display = on ? 'flex' : 'none';
    this.minimap.style.display = on && this.g.settings.minimap ? 'block' : 'none';
    if (!on) { this.drawer.classList.remove('open'); this.closeWheel(); this.followEl.style.display = 'none'; }
  }

  onWorld(): void {
    const w = this.g.world;
    if (!w) return;
    this.faithPill.style.display = limitedPowers(w) ? 'flex' : 'none';
    this.editorBtn.style.display = ['sandbox', 'editor'].includes(w.opts.mode) ? 'flex' : 'none';
    this.minimap.style.display = this.top.style.display !== 'none' && this.g.settings.minimap ? 'block' : 'none';
    this.update();
  }

  closeOverlays(): boolean {
    if (this.wheel.classList.contains('open')) { this.closeWheel(); return true; }
    if (this.drawer.classList.contains('open')) { this.openCat(null); return true; }
    return false;
  }

  update(): void {
    const g = this.g, w = g.world;
    if (!w) return;
    this.date.innerHTML = `An <b>${w.year}</b> · ${SEASONS[seasonOf(w.tick)]}`;
    this.popEl.innerHTML = `👥 <b>${fmtNum(w.totalPop())}</b> · 🏰 ${w.livingKingdoms().length}${g.saturated ? ' · ⚠️' : ''}`;
    this.popEl.title = g.saturated ? 'Simulation saturée : la vitesse réelle est limitée pour garder le jeu fluide.' : '';
    this.faithEl.innerHTML = `<b>${Math.floor(w.player.faith)}</b>`;
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === g.speed && !w.player.timeStopped));
    const f = g.cam?.follow;
    this.followEl.style.display = f ? 'flex' : 'none';
    if (f) {
      clear(this.followEl);
      this.followEl.append('🎥 ' + f.label, btn('✕', () => { if (g.cam) g.cam.follow = null; this.update(); }, 'btn icon'));
    }
    const goal = w.opts.mode !== 'sandbox' && w.opts.mode !== 'infinite' && w.opts.mode !== 'editor';
    this.objective.style.display = goal ? 'flex' : 'none';
    if (goal) this.objective.textContent = w.player.won ? '🏆 Victoire !' : w.player.lost ? '💀 Défaite' : '🎯 ' + this.goalText();
    this.mmTimer++;
    if (this.mmTimer % 4 === 0) this.drawMinimap();
    if (this.cat) this.refreshPowerState();
  }

  private goalText(): string {
    const w = this.g.world!;
    switch (w.opts.mode) {
      case 'survival': return `Survivre jusqu’à l’an 300`;
      case 'apocalypse': return `Tenir jusqu’à l’an 200`;
      case 'civilization': { const k = w.kingdoms.get(w.player.chosenKingdom); return k ? `${k.name} → ère spatiale` : 'Ère spatiale'; }
      case 'evolution': return 'Intelligence ≥ 1,5 + Âge du fer';
      case 'scenario': return w.player.objectiveYear ? `Objectif : an ${w.player.objectiveYear}` : 'Scénario';
      case 'chaos': return 'Survivre au chaos';
      default: return '';
    }
  }

  private drawMinimap(): void {
    const g = this.g, w = g.world, r = g.renderer, cam = g.cam;
    if (!w || !r || !cam || this.minimap.style.display === 'none') return;
    const ctx = this.minimap.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(r.terrain.worldCanvas, 0, 0, 132, 132);
    ctx.drawImage(r.overlay.canvas, 0, 0, 132, 132);
    const v = cam.view(0);
    const sx = 132 / w.map.w, sy = 132 / w.map.h;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(v.x0 * sx, v.y0 * sy, (v.x1 - v.x0) * sx, (v.y1 - v.y0) * sy);
    for (const a of w.armies.values()) {
      const k = w.kingdoms.get(a.kingdom);
      ctx.fillStyle = k ? hsl(k.hue, 90, 60) : '#f00';
      ctx.fillRect(a.x * sx - 1.5, a.y * sy - 1.5, 3, 3);
    }
  }

  toast(text: string, kind = ''): void {
    const t = h('div', { cls: 'toast ' + kind }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 4000);
  }

  setHint(text: string): void {
    this.hint.textContent = text;
    this.hint.style.display = text ? 'block' : 'none';
  }

  // ------------------------------------------------------------ powers drawer
  openCat(cat: PowerCat | null): void {
    this.cat = cat;
    for (const [c, b] of this.catBtns) b.classList.toggle('active', c === cat);
    this.navBtn.classList.toggle('active', !cat && !this.g.power);
    if (!cat) { this.drawer.classList.remove('open'); this.g.setPower(null); return; }
    this.drawer.classList.add('open');
    this.renderDrawer();
  }

  private renderDrawer(): void {
    const g = this.g, w = g.world;
    clear(this.drawer);
    if (!w || !this.cat) return;
    const list = h('div', { cls: 'powers' });
    for (const p of POWERS.filter((x) => x.cat === this.cat)) {
      const el = h('button', {
        cls: 'power' + (g.power?.id === p.id ? ' sel' : '') + (p.ultimate ? ' ultimate' : ''), title: p.desc,
        onclick: (e) => {
          e.stopPropagation();
          haptic();
          g.audio.sfx('click');
          g.setPower(g.power?.id === p.id ? null : p);
          this.renderDrawer();
        },
      }, p.icon, h('span', null, p.name));
      if (limitedPowers(w) && p.cost) el.append(h('i', { cls: 'cost' }, String(p.cost)));
      el.dataset.power = p.id;
      list.append(el);
    }
    this.drawer.append(list);
    const opts = h('div', { cls: 'opts' });
    const p = g.power;
    if (p) {
      opts.append(h('span', null, `${p.icon} ${p.desc}`));
      if (p.paint) {
        const range = h('input', { type: 'range', min: '0.4', max: '3', step: '0.1', value: String(g.brushScale) });
        range.oninput = () => { g.brushScale = Number(range.value); if (g.renderer?.brush) g.renderer.brush.r = p.r * g.brushScale; };
        opts.append(h('label', { cls: 'row' }, 'Pinceau', range));
      }
      if (p.id === 'humans') opts.append(this.picker(SPECIES.map((s) => [s.id, s.name]), g.powerParam ?? 'human'));
      if (p.id === 'animal') opts.append(this.picker(ANIMALS.map((a) => [a.id, a.name]), g.powerParam ?? 'rabbit'));
    } else opts.append(h('span', { cls: 'muted' }, 'Choisissez un pouvoir puis touchez la carte (deux doigts pour déplacer la caméra).'));
    if (this.cat === 'editor') opts.append(btn('🌡️ Climat global', () => g.panels.climate()));
    this.drawer.append(opts);
    this.refreshPowerState();
  }

  private picker(options: [string, string][], value: string): HTMLSelectElement {
    const sel = h('select');
    for (const [id, name] of options) sel.append(h('option', { value: id, selected: id === value }, name));
    sel.onchange = () => { this.g.powerParam = sel.value; };
    this.g.powerParam = value;
    return sel;
  }

  refreshPowerState(): void {
    const g = this.g, w = g.world;
    this.navBtn.classList.toggle('active', !g.power && !this.cat);
    this.setHint(g.power ? (g.power.paint ? `${g.power.icon} Glissez pour peindre · 2 doigts pour la caméra` : `${g.power.icon} Touchez la carte pour utiliser « ${g.power.name} »`) : '');
    if (!w) return;
    for (const el of this.drawer.querySelectorAll<HTMLElement>('.power')) {
      const p = POWERS.find((x) => x.id === el.dataset.power);
      if (p) el.classList.toggle('locked', !!canUse(w, p));
    }
  }

  // ------------------------------------------------------------ power wheel
  openWheel(cat: PowerCat | null = null): void {
    const g = this.g;
    const w = g.world;
    if (!w) return;
    clear(this.wheel);
    this.wheel.classList.add('open');
    const ring = h('div', { cls: 'wheel-ring' });
    const center = h('div', { cls: 'wheel-center', onclick: (e) => { e.stopPropagation(); if (cat) this.openWheel(null); else this.closeWheel(); } }, cat ? `${CAT_ICONS[cat]}\n${CAT_NAMES[cat]}\n↩` : 'Pouvoirs\ndivins');
    center.style.whiteSpace = 'pre-line';
    ring.append(center);
    const cats = (['nature', 'life', 'destruction', 'manipulation', 'ultimate', 'editor'] as PowerCat[]).filter((c) => c !== 'editor' || ['sandbox', 'editor'].includes(w.opts.mode));
    const items = cat ? POWERS.filter((p) => p.cat === cat).map((p) => ({ icon: p.icon, label: p.name, fn: () => { g.setPower(p); this.openCat(cat); this.closeWheel(); } }))
      : cats.map((c) => ({ icon: CAT_ICONS[c], label: CAT_NAMES[c], fn: () => this.openWheel(c) }));
    const n = items.length;
    const rings = n > 14 ? 2 : 1;
    items.forEach((it, i) => {
      const ringIdx = rings === 2 && i >= Math.ceil(n / 2) ? 1 : 0;
      const inRing = rings === 2 ? (ringIdx === 0 ? Math.ceil(n / 2) : n - Math.ceil(n / 2)) : n;
      const k = ringIdx === 0 ? i : i - Math.ceil(n / 2);
      const a = (k / inRing) * Math.PI * 2 - Math.PI / 2 + ringIdx * 0.2;
      const rad = (rings === 2 ? (ringIdx === 0 ? 30 : 45) : 36) ;
      const el = h('button', { cls: 'wheel-item' + (cat ? '' : ' cat'), onclick: (e) => { e.stopPropagation(); haptic(); g.audio.sfx('click'); it.fn(); } }, it.icon, h('span', null, it.label));
      el.style.left = `${50 + Math.cos(a) * rad}%`;
      el.style.top = `${50 + Math.sin(a) * rad}%`;
      ring.append(el);
    });
    this.wheel.append(ring);
  }

  closeWheel(): void {
    this.wheel.classList.remove('open');
  }

  filterName(): string {
    const f = this.g.renderer?.overlay.filter ?? 'none';
    return FILTERS.find((x) => x.id === f)?.name ?? '';
  }
}
