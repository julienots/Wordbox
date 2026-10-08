import { fmtNum, hsl } from '../core/math';
import { ANIMALS, animalById } from '../data/animals';
import { BIOMES } from '../data/biomes';
import { BUILDINGS, buildingById, SETTLEMENT_LEVELS } from '../data/buildings';
import { profById } from '../data/professions';
import { DEPOSITS, RES, RES_NAMES } from '../data/resources';
import { SPECIES, speciesById } from '../data/species';
import { DAYS_PER_YEAR } from '../data/time';
import { ERAS, TECHS, techById } from '../data/techs';
import { traitById } from '../data/traits';
import type { Game, Selection } from '../game';
import { FILTERS } from '../render/overlay';
import { profile } from '../save/storage';
import { deityTypeName, roofName } from '../sim/culture';
import { DISASTER_INFO } from '../sim/disasters';
import type { Person } from '../sim/entities';
import { HISTORY_TYPES } from '../sim/history';
import { GOVERNMENTS, kingdomTitle, militaryPower } from '../sim/kingdom';
import { MODES } from '../sim/modes';
import { ageOf, charisma, courage, fullName, intellect, lifespan, loyalty, speed, strength } from '../sim/person';
import { CAT_NAMES, POWERS } from '../sim/powers';
import { QUESTS } from '../sim/quests';
import { unitCount, UNIT_NAMES } from '../sim/war';
import { barChart, lineChart } from './charts';
import { bar, btn, clear, h, kv } from './dom';

type View = { kind: string; arg?: number; tab?: string } | null;

/** Side panel / bottom sheet hosting inspectors and informational panels. */
export class Panels {
  private el: HTMLDivElement;
  private title: HTMLHeadingElement;
  private tabs: HTMLDivElement;
  private body: HTMLDivElement;
  private view: View = null;
  private tick = 0;
  private histFilter = '';
  private histImp = 2;

  constructor(private g: Game) {
    this.title = h('h2');
    this.tabs = h('div', { cls: 'tabs' });
    this.body = h('div', { cls: 'body' });
    this.el = h('div', { id: 'panel' }, h('header', null, this.title, btn('✕', () => this.close(), 'btn icon')), this.tabs, this.body);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.ui.append(this.el);
  }

  isOpen(): boolean { return this.el.classList.contains('open'); }
  close(): void { this.el.classList.remove('open'); this.view = null; }

  private open(title: string, view: View): void {
    this.title.textContent = title;
    this.view = view;
    this.el.classList.add('open');
    clear(this.tabs);
    this.tabs.style.display = 'none';
    clear(this.body);
  }

  private setTabs(list: [string, string][], active: string, fn: (t: string) => void): void {
    clear(this.tabs);
    this.tabs.style.display = 'flex';
    for (const [id, name] of list) this.tabs.append(btn(name, () => fn(id), 'btn' + (id === active ? ' active' : '')));
  }

  /** Periodic refresh of live views (inspectors, stats). */
  refresh(): void {
    if (!this.view || !this.isOpen()) return;
    this.tick++;
    if (this.tick % 4 !== 0) return;
    const v = this.view;
    const scroll = this.body.scrollTop;
    if (v.kind === 'person' || v.kind === 'settlement' || v.kind === 'kingdom' || v.kind === 'animal') this.inspect({ type: v.kind, id: v.arg! }, v.tab);
    else if (v.kind === 'nations') this.nations();
    else return;
    this.body.scrollTop = scroll;
  }

  labelOf(sel: Selection): string {
    const w = this.g.world;
    if (!w || !sel) return '';
    if (sel.type === 'person') { const p = w.persons.get(sel.id); return p ? p.name : '?'; }
    if (sel.type === 'animal') { const a = w.animals.get(sel.id); return a ? animalById.get(a.sp)?.name ?? '' : '?'; }
    if (sel.type === 'settlement') return w.settlements.get(sel.id)?.name ?? '?';
    return w.kingdoms.get(sel.id)?.name ?? '?';
  }

  private personLink(id: number): HTMLElement {
    const w = this.g.world!;
    const p = w.persons.get(id);
    if (p) return h('span', { cls: 'link', onclick: () => this.g.inspect({ type: 'person', id }) }, fullName(w, p));
    const a = w.ancestors.get(id);
    return h('span', { cls: 'muted' }, a ? `${a.name} †` : '—');
  }
  private settlementLink(id: number): HTMLElement {
    const s = this.g.world!.settlements.get(id);
    return s ? h('span', { cls: 'link', onclick: () => this.g.inspect({ type: 'settlement', id }) }, s.name) : h('span', null, '—');
  }
  private kingdomLink(id: number): HTMLElement {
    const k = this.g.world!.kingdoms.get(id);
    return k ? h('span', { cls: 'link', style: `color:${hsl(k.hue, 80, 70)}`, onclick: () => this.g.inspect({ type: 'kingdom', id }) }, k.name + (k.fallen >= 0 ? ' (déchu)' : '')) : h('span', null, '—');
  }

  // ------------------------------------------------------------ inspectors
  inspect(sel: Selection, tab?: string): void {
    const w = this.g.world;
    if (!w || !sel) return;
    if (sel.type === 'person') return this.person(sel.id, tab ?? 'info');
    if (sel.type === 'settlement') return this.settlement(sel.id, tab ?? 'info');
    if (sel.type === 'kingdom') return this.kingdom(sel.id, tab ?? 'info');
    return this.animal(sel.id);
  }

  private actions(sel: Selection): HTMLElement {
    return h('div', { cls: 'row', style: 'margin-bottom:8px' },
      btn('🎥 Suivre', () => this.g.follow(sel), 'btn primary'),
      btn('📍 Centrer', () => {
        const w = this.g.world!;
        let x = 0, y = 0;
        if (sel?.type === 'person') { const p = w.persons.get(sel.id); if (p) { x = p.x; y = p.y; } }
        else if (sel?.type === 'settlement') { const s = w.settlements.get(sel.id); if (s) { x = s.x; y = s.y; } }
        else if (sel?.type === 'kingdom') { const s = w.settlements.get(w.kingdoms.get(sel.id)?.capital ?? -1); if (s) { x = s.x; y = s.y; } }
        else if (sel?.type === 'animal') { const a = w.animals.get(sel.id); if (a) { x = a.x; y = a.y; } }
        this.g.flyTo(x, y);
      }));
  }

  private person(id: number, tab: string): void {
    const w = this.g.world!;
    const p = w.persons.get(id);
    if (!p) {
      const a = w.ancestors.get(id);
      this.open(a ? `${a.name} †` : 'Disparu', { kind: 'none' });
      if (a) this.body.append(kv([['Naissance', `An ${Math.floor(a.birth / DAYS_PER_YEAR)}`], ['Décès', `An ${Math.floor(a.death / DAYS_PER_YEAR)} (${a.cause})`], ['Père', this.personLink(a.father)], ['Mère', this.personLink(a.mother)]]));
      return;
    }
    this.open(fullName(w, p), { kind: 'person', arg: id, tab });
    this.setTabs([['info', 'Fiche'], ['family', 'Famille'], ['bio', 'Histoire']], tab, (t) => this.person(id, t));
    const b = this.body;
    b.append(this.actions({ type: 'person', id }));
    if (tab === 'info') {
      const sp = speciesById(p.species);
      b.append(kv([
        ['Titre', p.title || '—'], ['Âge', `${Math.floor(ageOf(w, p))} ans (espérance ${Math.round(lifespan(p))})`], ['Sexe', p.female ? 'Femme' : 'Homme'],
        ['Espèce', sp.name], ['Métier', `${profById.get(p.prof)?.icon ?? ''} ${profById.get(p.prof)?.name ?? p.prof} (compétence ${(p.skill * 100).toFixed(0)} %)`],
        ['Ville', this.settlementLink(p.settlement)], ['Nation', this.kingdomLink(p.kingdom)],
        ['Culture', w.cultures.get(p.culture)?.name ?? '—'], ['Religion', w.religions.get(p.religion)?.name ?? '—'],
        ['Partenaire', p.partner >= 0 ? this.personLink(p.partner) : '—'], ['Renommée', Math.round(p.renown)],
      ]));
      b.append(h('h3', null, 'État'));
      b.append(h('div', { cls: 'col' }, h('span', { cls: 'muted' }, 'Santé'), bar(p.health), h('span', { cls: 'muted' }, 'Satiété'), bar(p.hunger), h('span', { cls: 'muted' }, 'Énergie'), bar(p.energy), h('span', { cls: 'muted' }, 'Bonheur'), bar(p.happy)));
      b.append(h('h3', null, 'Aptitudes (génétique + traits)'));
      b.append(kv([['Force', strength(p).toFixed(2)], ['Intelligence', intellect(p).toFixed(2)], ['Vitesse', speed(p).toFixed(2)], ['Charisme', charisma(p).toFixed(2)], ['Courage', courage(p).toFixed(2)], ['Loyauté', loyalty(p).toFixed(2)], ['Taille', p.scale.toFixed(2)]]));
      b.append(h('h3', null, 'Traits'));
      const tr = h('div');
      for (const t of p.traits) { const d = traitById.get(t); if (d) tr.append(h('span', { cls: 'chip ' + (d.good ? 'good' : 'bad') }, d.name)); }
      b.append(tr);
    } else if (tab === 'family') {
      b.append(this.familyTree(p));
    } else {
      const list = h('div', { cls: 'list' });
      for (const [y, t] of p.log) list.append(h('div', { cls: 'item' }, h('span', { cls: 'y' }, `An ${y}`), t));
      if (!p.log.length) list.append(h('div', { cls: 'muted' }, 'Une vie encore sans histoire.'));
      b.append(list);
    }
  }

  private familyTree(p: Person): HTMLElement {
    const w = this.g.world!;
    const node = (id: number, me = false) => {
      const x = w.persons.get(id);
      const a = x ? undefined : w.ancestors.get(id);
      if (!x && !a) return null;
      const name = x ? x.name : a!.name;
      const birth = Math.floor((x ? x.birth : a!.birth) / DAYS_PER_YEAR);
      return h('div', { cls: 'node' + (me ? ' me' : '') + (x ? '' : ' dead'), onclick: () => this.g.inspect({ type: 'person', id }) }, name, h('br'), h('span', { cls: 'muted' }, `° ${birth}${a ? ' † ' + Math.floor(a.death / DAYS_PER_YEAR) : ''}`));
    };
    const parentsOf = (id: number): number[] => {
      const x = w.persons.get(id) ?? w.ancestors.get(id);
      return x ? [x.father, x.mother].filter((v) => v >= 0) : [];
    };
    const gen = (ids: number[]) => { const d = h('div', { cls: 'gen' }); for (const id of ids) { const n = node(id, id === p.id); if (n) d.append(n); } return d; };
    const parents = parentsOf(p.id);
    const grand = parents.flatMap(parentsOf);
    const siblings: number[] = [];
    for (const par of parents) { const pp = w.persons.get(par); if (pp) for (const c of pp.children) if (c !== p.id && !siblings.includes(c)) siblings.push(c); }
    const grandkids: number[] = [];
    for (const c of p.children) { const cp = w.persons.get(c); if (cp) grandkids.push(...cp.children); }
    const dyn = w.dynasties.get(p.dynasty);
    return h('div', { cls: 'tree' },
      dyn ? h('div', { cls: 'muted' }, `Maison ${dyn.name} · ${dyn.members} vivants · prestige ${Math.round(dyn.prestige)}`) : null,
      h('div', { cls: 'muted' }, 'Grands-parents'), gen(grand),
      h('div', { cls: 'muted' }, 'Parents'), gen(parents),
      h('div', { cls: 'muted' }, 'Lui/elle, frères et sœurs'), gen([p.id, ...(p.partner >= 0 ? [p.partner] : []), ...siblings.slice(0, 8)]),
      h('div', { cls: 'muted' }, 'Enfants'), gen(p.children.slice(0, 16)),
      h('div', { cls: 'muted' }, 'Petits-enfants'), gen(grandkids.slice(0, 16)),
    );
  }

  private animal(id: number): void {
    const w = this.g.world!;
    const a = w.animals.get(id);
    const def = a ? animalById.get(a.sp) : undefined;
    this.open(def ? def.name : 'Animal disparu', { kind: 'animal', arg: id });
    if (!a || !def) return;
    this.body.append(this.actions({ type: 'animal', id }));
    this.body.append(kv([['Régime', def.diet === 'herb' ? 'Herbivore' : def.diet === 'carn' ? 'Carnivore' : 'Omnivore'], ['Âge', `${Math.floor((w.tick - a.birth) / DAYS_PER_YEAR)} / ${def.maxAge} ans`], ['Points de vie', Math.round(a.hp)], ['Satiété', Math.round(a.hunger)], ['Proies', def.prey.map((x) => animalById.get(x)?.name).join(', ') || '—'], ['Population', [...w.animals.values()].filter((x) => x.sp === a.sp).length]]));
    this.body.append(h('p', { cls: 'muted' }, def.desc));
  }

  private settlement(id: number, tab: string): void {
    const w = this.g.world!;
    const s = w.settlements.get(id);
    if (!s) { this.open('Ruines', { kind: 'none' }); return; }
    const k = w.kingdoms.get(s.kingdom);
    this.open(`${s.name}`, { kind: 'settlement', arg: id, tab });
    this.setTabs([['info', 'Ville'], ['eco', 'Économie'], ['people', 'Habitants']], tab, (t) => this.settlement(id, t));
    const b = this.body;
    b.append(this.actions({ type: 'settlement', id }));
    if (tab === 'info') {
      b.append(kv([
        ['Statut', `${SETTLEMENT_LEVELS[s.level].name}${k?.capital === s.id ? ' · capitale' : ''}`], ['Nation', this.kingdomLink(s.kingdom)],
        ['Population', `${fmtNum(s.pop)} (${s.residents.length} simulés + ${Math.floor(s.extraPop)} agrégés)`], ['Logement', `${s.housing}`],
        ['Fondation', `An ${Math.floor(s.founded / DAYS_PER_YEAR)}`], ['Territoire', `${s.tiles} cases`],
        ['Culture', w.cultures.get(s.culture)?.name ?? '—'], ['Religion', w.religions.get(s.religion)?.name ?? '—'],
        ['Murailles', ['Aucune', 'Palissade', 'Remparts', 'Bastions'][s.wall] ?? s.wall],
        ['Épidémie', s.infected > 0 ? `${Math.round(s.infected * 100)} % infectés` : 'Aucune'], ['Siège', s.siege > 0 ? `${Math.round(s.siege)} %` : '—'],
      ]));
      b.append(h('h3', null, 'Moral'));
      b.append(h('div', { cls: 'col' }, h('span', { cls: 'muted' }, `Bonheur ${Math.round(s.happiness)}`), bar(s.happiness), h('span', { cls: 'muted' }, `Santé ${Math.round(s.health)}`), bar(s.health)));
      b.append(h('h3', null, 'Bâtiments'));
      const counts = new Map<string, [number, number]>();
      for (const bid of s.buildings) { const bd = w.buildings.get(bid); if (!bd) continue; const c = counts.get(bd.type) ?? [0, 0]; c[bd.progress >= 1 ? 0 : 1]++; counts.set(bd.type, c); }
      const d = h('div');
      for (const [t, [n, site]] of counts) d.append(h('span', { cls: 'chip' }, `${buildingById.get(t)?.name ?? t} ×${n}${site ? ` (+${site} 🏗️)` : ''}`));
      b.append(d);
    } else if (tab === 'eco') {
      b.append(h('h3', null, 'Stocks · prix · production/mois'));
      b.append(kv(RES.map((r) => [RES_NAMES[r], `${fmtNum(s.stock[r])} · ${s.prices[r].toFixed(1)} or · ${(s.produced[r] ?? 0) >= 0 ? '+' : ''}${(s.produced[r] ?? 0).toFixed(0)}`] as [string, string])));
      b.append(kv([['Capacité', fmtNum(s.storage)], ['Bilan alimentaire', s.foodBalance.toFixed(0)], ['Énergie', s.energyBalance.toFixed(0)], ['Recherche', s.research.toFixed(1)], ['Foi', s.faith.toFixed(1)]]));
      b.append(h('h3', null, 'Métiers'));
      const d = h('div');
      for (const [p, n] of Object.entries(s.jobs).sort((a, c) => c[1] - a[1])) if (n >= 1) d.append(h('span', { cls: 'chip' }, `${profById.get(p)?.icon ?? ''} ${profById.get(p)?.name ?? p} ${Math.floor(n)}`));
      b.append(d);
      const routes = [...w.routes.values()].filter((r) => r.a === s.id || r.b === s.id);
      b.append(h('h3', null, `Routes commerciales (${routes.length})`));
      for (const r of routes) b.append(h('div', { cls: 'item' }, this.settlementLink(r.a === s.id ? r.b : r.a), ` · volume ${Math.round(r.volume)}${r.naval ? ' · ⛵' : ''}`));
    } else {
      const list = h('div', { cls: 'list' });
      for (const pid of s.residents.slice(0, 120)) {
        const p = w.persons.get(pid);
        if (p) list.append(h('div', { cls: 'item tap', onclick: () => this.g.inspect({ type: 'person', id: pid }) }, `${profById.get(p.prof)?.icon ?? ''} ${fullName(w, p)}`, h('span', { cls: 'muted' }, ` · ${Math.floor(ageOf(w, p))} ans${p.title ? ' · ' + p.title : ''}`)));
      }
      b.append(list);
    }
  }

  private kingdom(id: number, tab: string): void {
    const w = this.g.world!;
    const k = w.kingdoms.get(id);
    if (!k) return;
    this.open(kingdomTitle(k), { kind: 'kingdom', arg: id, tab });
    this.setTabs([['info', 'Royaume'], ['politics', 'Politique'], ['diplo', 'Diplomatie'], ['army', 'Armées'], ['tech', 'Savoir'], ['culture', 'Culture']], tab, (t) => this.kingdom(id, t));
    const b = this.body;
    b.append(this.actions({ type: 'kingdom', id }));
    const pop = w.kingdomPop(k);
    if (tab === 'info') {
      if (k.fallen >= 0) b.append(h('p', { cls: 'chip bad' }, `Tombé en l’an ${Math.floor(k.fallen / DAYS_PER_YEAR)}`));
      b.append(kv([
        ['Régime', GOVERNMENTS[k.government]?.name ?? k.government], ['Souverain', this.personLink(k.ruler)], ['Héritier', this.personLink(k.heir)],
        ['Capitale', this.settlementLink(k.capital)], ['Espèce', speciesById(k.species).plural], ['Population', fmtNum(pop)],
        ['Villes', k.settlements.length], ['Ère', ERAS[k.era]], ['Trésor', `${fmtNum(k.treasury)} or`], ['Puissance militaire', fmtNum(militaryPower(w, k))],
        ['Réputation', Math.round(k.reputation)], ['Suzerain', k.overlord >= 0 ? this.kingdomLink(k.overlord) : '—'],
        ['Fédération', k.federation >= 0 ? w.federations.get(k.federation)?.name ?? '—' : '—'],
        ['Espace', k.rockets ? `🚀 ${k.rockets} · 🛰️ ${k.satellites} · 🛸 ${k.stations} · 🪐 ${k.colonies.join(', ') || '—'}` : '—'],
      ]));
      b.append(h('h3', null, `Stabilité ${Math.round(k.stability)}`), bar(k.stability, k.stability < 30 ? '#ff6a5a' : undefined));
      b.append(h('div', { cls: 'row', style: 'margin-top:10px' }, btn('👑 Faire de ce peuple votre élu', () => {
        for (const o of w.kingdoms.values()) o.chosen = false;
        k.chosen = true; w.player.chosenKingdom = k.id; this.g.hud.toast(`${k.name} est votre peuple élu.`);
      })));
      b.append(h('h3', null, 'Villes'));
      for (const sid of k.settlements) { const s = w.settlements.get(sid); if (s) b.append(h('div', { cls: 'item tap', onclick: () => this.g.inspect({ type: 'settlement', id: sid }) }, `${s.name}`, h('span', { cls: 'muted' }, ` · ${SETTLEMENT_LEVELS[s.level].name} · ${fmtNum(s.pop)}`))); }
    } else if (tab === 'politics') {
      b.append(h('h3', null, 'Factions'));
      for (const f of k.factions) b.append(h('div', { cls: 'col', style: 'margin-bottom:6px' }, h('span', null, `${f.name} — pouvoir ${Math.round(f.power)}, approbation ${Math.round(f.approval)}`), bar(f.approval, f.approval < 30 ? '#ff6a5a' : undefined)));
      b.append(h('h3', null, 'Conseil'));
      for (const pid of k.council) b.append(h('div', { cls: 'item' }, this.personLink(pid)));
      b.append(kv([['Succession', { primogeniture: 'Primogéniture', elective: 'Élective', strongest: 'Loi du plus fort' }[k.succession]], ['Règnes', k.reigns], ['Lassitude de guerre', Math.round(k.warExhaustion)]]));
      const d = w.dynasties.get(k.dynasty);
      if (d) b.append(kv([['Dynastie', `Maison ${d.name}`], ['Prestige', Math.round(d.prestige)]]));
    } else if (tab === 'diplo') {
      const list = h('div', { cls: 'list' });
      for (const o of w.livingKingdoms()) {
        if (o.id === k.id) continue;
        const r = w.relations.get(w.relKey(k.id, o.id));
        if (!r || !r.contact) continue;
        const tags = [r.war >= 0 ? '⚔️ guerre' : '', r.alliance ? '🤝 alliance' : '', r.trade ? '💰 commerce' : '', r.pact ? '📜 pacte' : '', r.embargo ? '🚫 embargo' : '', r.tributeFrom === k.id ? '💸 paie tribut' : r.tributeFrom === o.id ? '💸 reçoit tribut' : '', o.overlord === k.id ? '👑 vassal' : '', k.overlord === o.id ? '⛓️ suzerain' : ''].filter(Boolean).join(' · ');
        list.append(h('div', { cls: 'item' }, this.kingdomLink(o.id), h('span', { cls: 'muted' }, ` opinion ${Math.round(r.opinion)}`), h('br'), h('span', { cls: 'muted' }, tags || 'paix')));
      }
      if (!list.children.length) list.append(h('div', { cls: 'muted' }, 'Aucun contact diplomatique.'));
      b.append(list);
      b.append(h('h3', null, 'Guerres'));
      for (const war of [...w.wars.values()].filter((x) => x.attackers.includes(k.id) || x.defenders.includes(k.id)).slice(-12).reverse())
        b.append(h('div', { cls: 'item' }, war.name, h('br'), h('span', { cls: 'muted' }, `${war.end < 0 ? 'en cours' : 'terminée'} · ${war.battles} batailles · ${Math.round(war.deaths)} morts · score ${Math.round(war.score)}`)));
    } else if (tab === 'army') {
      b.append(kv([['Armurerie', fmtNum(k.armory)], ['Armées en campagne', k.armies.length]]));
      for (const aid of k.armies) {
        const a = w.armies.get(aid);
        if (!a) continue;
        b.append(h('h3', null, a.name));
        b.append(kv([['Commandant', this.personLink(a.commander)], ['Effectif', unitCount(a.units)], ['Moral', Math.round(a.morale)], ['Ravitaillement', Math.round(a.supply)], ['Expérience', a.xp.toFixed(1)], ['Équipement', a.equipment.toFixed(2)], ['État', { idle: 'au repos', march: 'en marche', siege: 'siège', battle: 'bataille', return: 'retour' }[a.state]]]));
        const d = h('div');
        for (const [u, n] of Object.entries(a.units)) if (n > 0) d.append(h('span', { cls: 'chip' }, `${UNIT_NAMES[u as keyof typeof a.units](k)} ${n}`));
        b.append(d, btn('🎥 Suivre cette armée', () => { if (this.g.cam) this.g.cam.follow = { label: a.name, pos: () => w.armies.get(aid) ?? null }; }));
      }
    } else if (tab === 'tech') {
      const cur = techById.get(k.researching);
      b.append(kv([['Ère', ERAS[k.era]], ['Recherche en cours', cur ? `${cur.name} (${Math.min(100, Math.round((k.research / cur.cost) * 100))} %)` : '—'], ['Technologies', `${k.techs.length} / ${TECHS.length}`]]));
      for (let e = 0; e <= 13; e++) {
        const list = TECHS.filter((t) => t.era === e);
        b.append(h('h3', null, ERAS[e]));
        const d = h('div');
        for (const t of list) d.append(h('span', { cls: 'chip ' + (k.techs.includes(t.id) ? 'good' : ''), style: k.techs.includes(t.id) ? '' : 'opacity:.45' }, t.name));
        b.append(d);
      }
    } else {
      const c = w.cultures.get(k.culture), r = w.religions.get(k.religion);
      if (c) {
        b.append(h('h3', null, `Culture ${c.name}`));
        b.append(kv([['Architecture', roofName(c.roof)], ['Membres', fmtNum(c.members)], ['Traditions', c.traditions.join(', ')]]));
        for (const [key, name] of [['martial', 'Martiale'], ['pious', 'Pieuse'], ['mercantile', 'Marchande'], ['scholarly', 'Savante'], ['naturalist', 'Naturaliste'], ['artistic', 'Artistique']] as const)
          b.append(h('div', { cls: 'col' }, h('span', { cls: 'muted' }, name), bar(c.values[key] * 100)));
      }
      if (r) {
        b.append(h('h3', null, r.name));
        b.append(kv([['Divinité', `${deityTypeName(r.deityType)} — ${r.deity}`], ['Préceptes', r.tenets.join(', ')], ['Rites', r.rites.join(', ')], ['Fête', r.festival], ['Fidèles', fmtNum(r.followers)]]));
      }
    }
  }

  tile(x: number, y: number): void {
    const w = this.g.world!;
    const m = w.map, i = m.idx(x, y);
    this.open(BIOMES[m.biome[i]].name, { kind: 'tile' });
    this.body.append(kv([
      ['Position', `${x}, ${y}`], ['Altitude', (m.height[i] * 100).toFixed(0)], ['Température', (m.temp[i] * 100).toFixed(0)], ['Humidité', (m.humid[i] * 100).toFixed(0)],
      ['Fertilité', Math.round((m.fert[i] / 255) * 100) + ' %'], ['Végétation', Math.round((m.veg[i] / 255) * 100) + ' %'],
      ['Gisement', m.deposit[i] ? `${DEPOSITS[m.deposit[i]].name} (${m.depositAmt[i]})` : '—'], ['Route', ['—', 'Chemin', 'Route pavée', 'Autoroute'][m.road[i]]],
    ]), h('p', { cls: 'muted' }, BIOMES[m.biome[i]].desc));
  }

  // ------------------------------------------------------------ informational panels
  filters(): void {
    this.open('Filtres de carte', { kind: 'filters' });
    const r = this.g.renderer;
    const grid = h('div', { cls: 'row' });
    for (const f of FILTERS) grid.append(btn(`${f.icon} ${f.name}`, () => { if (r) r.overlay.filter = f.id; this.filters(); }, 'btn' + (r?.overlay.filter === f.id ? ' active' : '')));
    this.body.append(grid);
  }

  stats(): void {
    const w = this.g.world!;
    this.open('Statistiques mondiales', { kind: 'stats' });
    const b = this.body;
    const ks = w.livingKingdoms();
    let territory = 0;
    for (const s of w.settlements.values()) territory += s.tiles;
    const life = w.stats.lifeCount ? w.stats.lifeSum / w.stats.lifeCount : 0;
    b.append(kv([
      ['Population mondiale', fmtNum(w.totalPop())], ['Individus simulés', fmtNum(w.persons.size)], ['Civilisations', `${ks.length} vivantes / ${w.kingdoms.size}`],
      ['Villes', w.settlements.size], ['Territoire contrôlé', `${fmtNum(territory)} cases`], ['Animaux', fmtNum(w.animals.size)], ['Espèces éteintes', w.extinctSpecies.length],
      ['Guerres', `${[...w.wars.values()].filter((x) => x.end < 0).length} en cours / ${w.stats.warsTotal}`], ['Batailles', w.stats.battles],
      ['Naissances', fmtNum(w.stats.births)], ['Morts', fmtNum(w.stats.deaths)], ['Morts au combat', fmtNum(w.stats.warDeaths)], ['Victimes de catastrophes', fmtNum(w.stats.disasterDeaths)],
      ['Espérance de vie', life ? `${life.toFixed(0)} ans` : '—'], ['Fusées lancées', w.stats.rockets], ['Colonies', w.stats.colonies], ['Pic de population', fmtNum(w.stats.maxPop)],
    ]));
    const years = w.series.map((s) => s.year);
    b.append(h('h3', null, 'Population (échelle log)'));
    const c1 = h('canvas', { cls: 'chart' }); b.append(c1);
    b.append(h('h3', null, 'Civilisations · guerres · ère max'));
    const c2 = h('canvas', { cls: 'chart' }); b.append(c2);
    b.append(h('h3', null, 'Population par civilisation'));
    const c3 = h('canvas', { cls: 'chart' }); b.append(c3);
    b.append(h('h3', null, 'Richesse par civilisation'));
    const c4 = h('canvas', { cls: 'chart' }); b.append(c4);
    requestAnimationFrame(() => {
      lineChart(c1, years, [{ name: 'Population', color: '#6fb4ff', values: w.series.map((s) => s.pop) }, { name: 'Animaux', color: '#6ee09a', values: w.series.map((s) => s.animals) }], true);
      lineChart(c2, years, [{ name: 'Nations', color: '#f2c75c', values: w.series.map((s) => s.kingdoms) }, { name: 'Guerres', color: '#ff6a5a', values: w.series.map((s) => s.wars) }, { name: 'Ère', color: '#b77aff', values: w.series.map((s) => s.tech) }]);
      const sorted = [...ks].sort((a, c) => w.kingdomPop(c) - w.kingdomPop(a)).slice(0, 12);
      barChart(c3, sorted.map((k) => ({ label: k.name, value: w.kingdomPop(k), color: hsl(k.hue, 70, 55) })));
      barChart(c4, sorted.map((k) => ({ label: k.name, value: k.wealth, color: hsl(k.hue, 70, 55) })));
    });
  }

  nations(): void {
    const w = this.g.world!;
    this.open('Nations du monde', { kind: 'nations' });
    const list = h('div', { cls: 'list' });
    const ks = [...w.kingdoms.values()].sort((a, b) => (a.fallen >= 0 ? 1 : 0) - (b.fallen >= 0 ? 1 : 0) || w.kingdomPop(b) - w.kingdomPop(a));
    for (const k of ks.slice(0, 60)) {
      list.append(h('div', { cls: 'item tap', onclick: () => this.g.inspect({ type: 'kingdom', id: k.id }) },
        h('span', { style: `color:${hsl(k.hue, 80, 70)};font-weight:700` }, kingdomTitle(k)),
        h('br'), h('span', { cls: 'muted' }, k.fallen >= 0 ? `déchu en l’an ${Math.floor(k.fallen / DAYS_PER_YEAR)}` : `${fmtNum(w.kingdomPop(k))} hab. · ${k.settlements.length} villes · ${ERAS[k.era]} · stabilité ${Math.round(k.stability)}`)));
    }
    this.body.append(list);
    if (w.famous.length) {
      this.body.append(h('h3', null, 'Personnages célèbres'));
      for (const f of [...w.famous].sort((a, b) => b.renown - a.renown).slice(0, 30))
        this.body.append(h('div', { cls: 'item tap', onclick: () => this.g.inspect({ type: 'person', id: f.id }) }, `★ ${f.name}`, h('span', { cls: 'muted' }, ` · ${f.role} · ${f.kingdom} · renommée ${f.renown}${f.death >= 0 ? ' · †' : ''}`)));
    }
  }

  timeline(): void {
    const w = this.g.world!;
    this.open('Chronologie du monde', { kind: 'timeline' });
    const types = ['', ...Object.keys(HISTORY_TYPES)];
    const sel = h('select');
    for (const t of types) sel.append(h('option', { value: t, selected: t === this.histFilter }, t ? HISTORY_TYPES[t] : 'Tous les événements'));
    sel.onchange = () => { this.histFilter = sel.value; this.timeline(); };
    const imp = h('select');
    for (const [v, n] of [[1, 'Tous'], [2, 'Importants'], [3, 'Majeurs']] as const) imp.append(h('option', { value: String(v), selected: v === this.histImp }, n));
    imp.onchange = () => { this.histImp = Number(imp.value); this.timeline(); };
    this.body.append(h('div', { cls: 'row' }, sel, imp));
    // density strip: one bar per decade
    const ev = w.history.filter((e) => e.imp >= this.histImp && (!this.histFilter || e.type === this.histFilter));
    const strip = h('canvas', { cls: 'chart', style: 'height:50px;margin:8px 0' });
    this.body.append(strip);
    requestAnimationFrame(() => {
      const decades = Math.max(1, Math.ceil((w.year + 1) / 10));
      const counts = new Array(decades).fill(0);
      for (const e of ev) counts[Math.floor(e.tick / DAYS_PER_YEAR / 10)]++;
      const dpr = window.devicePixelRatio || 1;
      strip.width = strip.clientWidth * dpr; strip.height = 50 * dpr;
      const ctx = strip.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const max = Math.max(1, ...counts), bw = strip.clientWidth / decades;
      counts.forEach((c, i) => { ctx.fillStyle = '#f2c75c'; ctx.fillRect(i * bw, 50 - (c / max) * 46, Math.max(1, bw - 1), (c / max) * 46); });
      strip.onclick = (e) => {
        const d = Math.floor((e.offsetX / strip.clientWidth) * decades);
        const target = list.querySelector<HTMLElement>(`[data-dec="${d}"]`);
        target?.scrollIntoView({ block: 'start' });
      };
    });
    const list = h('div', { cls: 'list' });
    let lastDec = -1;
    for (const e of ev.slice(-400)) {
      const y = Math.floor(e.tick / DAYS_PER_YEAR);
      const item = h('div', { cls: `item imp${e.imp}` + (e.x !== undefined ? ' tap' : ''), onclick: () => { if (e.x !== undefined && e.y !== undefined) this.g.flyTo(e.x, e.y, 10); } }, h('span', { cls: 'y' }, `An ${y}`), e.text);
      if (Math.floor(y / 10) !== lastDec) { lastDec = Math.floor(y / 10); item.dataset.dec = String(lastDec); }
      list.append(item);
    }
    this.body.append(list);
    requestAnimationFrame(() => (this.body.scrollTop = this.body.scrollHeight));
  }

  codex(tab = 'species'): void {
    const w = this.g.world!;
    this.open('Codex', { kind: 'codex' });
    const known = new Set([...w.codex, ...profile.get<string[]>('codex', [])]);
    profile.set('codex', [...known].filter((k) => !/:\d+$/.test(k)));
    this.setTabs([['species', 'Peuples'], ['animals', 'Faune'], ['civs', 'Civilisations'], ['tech', 'Technologies'], ['buildings', 'Bâtiments'], ['disasters', 'Catastrophes'], ['powers', 'Pouvoirs'], ['heroes', 'Célébrités'], ['events', 'Histoire'], ['biomes', 'Biomes'], ['modes', 'Modes']], tab, (t) => this.codex(t));
    const b = this.body;
    const entry = (ok: boolean, title: string, desc: string) => b.append(h('div', { cls: 'item' + (ok ? '' : ' locked-entry') }, h('b', null, ok ? title : '???'), h('br'), h('span', { cls: 'muted' }, ok ? desc : 'Pas encore découvert.')));
    switch (tab) {
      case 'species': for (const s of SPECIES) entry(known.has('species:' + s.id), s.plural, `${s.desc} Longévité ${s.life} ans.`); break;
      case 'animals': for (const a of ANIMALS) entry(known.has('animal:' + a.id), a.name, a.desc + (w.extinctSpecies.includes(a.id) ? ' (éteint dans ce monde)' : '')); break;
      case 'civs':
        for (const k of w.kingdoms.values()) entry(true, kingdomTitle(k), `${speciesById(k.species).plural}, fondé en l’an ${Math.floor(k.founded / DAYS_PER_YEAR)}${k.fallen >= 0 ? `, tombé en l’an ${Math.floor(k.fallen / DAYS_PER_YEAR)}` : ''}. ${GOVERNMENTS[k.government]?.name}.`);
        for (const c of w.cultures.values()) entry(true, `Culture ${c.name}`, `Traditions : ${c.traditions.join(', ')}. ${c.extinct >= 0 ? 'Éteinte.' : `${fmtNum(c.members)} membres.`}`);
        for (const r of w.religions.values()) entry(true, r.name, `${deityTypeName(r.deityType)} · ${r.tenets.join(', ')}${r.extinct >= 0 ? ' · éteinte' : ''}`);
        break;
      case 'tech': for (const t of TECHS) entry(known.has('tech:' + t.id), `${t.name} (${ERAS[t.era]})`, t.desc); break;
      case 'buildings': for (const bd of BUILDINGS) entry(known.has('building:' + bd.id), bd.name, bd.desc); entry(known.has('walls'), 'Murailles', 'Protègent les villes des sièges.'); entry(known.has('route'), 'Routes', 'Accélèrent déplacements, commerce et armées.'); entry(known.has('bridge'), 'Ponts', 'Les routes franchissent rivières et détroits.'); break;
      case 'disasters': for (const [id, d] of Object.entries(DISASTER_INFO)) entry(known.has('disaster:' + id), d.name, d.desc); break;
      case 'powers': for (const p of POWERS) entry(known.has('power:' + p.id) || !p.ultimate, `${p.icon} ${p.name} · ${CAT_NAMES[p.cat]}`, p.desc); break;
      case 'heroes': for (const f of w.famous) entry(true, `${f.name} — ${f.role}`, `${f.kingdom} · né en l’an ${Math.floor(f.birth / DAYS_PER_YEAR)}${f.death >= 0 ? `, mort en l’an ${Math.floor(f.death / DAYS_PER_YEAR)}` : ''} · ${f.reason}`); if (!w.famous.length) b.append(h('p', { cls: 'muted' }, 'Aucune légende pour l’instant.')); break;
      case 'events': for (const e of w.history.filter((x) => x.imp >= 3).slice(-150)) entry(true, `An ${Math.floor(e.tick / DAYS_PER_YEAR)}`, e.text); break;
      case 'biomes': for (const bi of BIOMES) entry(true, bi.name, bi.desc); break;
      case 'modes': for (const m of MODES) entry(true, `${m.icon} ${m.name}`, `${m.desc} Objectif : ${m.goal}`); break;
    }
  }

  quests(): void {
    const w = this.g.world!;
    this.open('Défis', { kind: 'quests' });
    const global = new Set(profile.get<string[]>('achievements', []));
    for (const q of QUESTS) {
      const done = w.questsDone.has(q.id);
      const p = Math.min(1, Math.max(0, q.progress(w)));
      this.body.append(h('div', { cls: 'item' }, h('b', null, `${q.icon} ${q.name}`), done ? h('span', { cls: 'chip good' }, 'accompli') : global.has(q.id) ? h('span', { cls: 'chip' }, 'déjà réussi ailleurs') : null, h('br'), h('span', { cls: 'muted' }, q.desc), bar(done ? 100 : p * 100)));
    }
  }

  climate(): void {
    const w = this.g.world!;
    this.open('Climat global', { kind: 'climate' });
    const mk = (label: string, get: () => number, set: (v: number) => void) => {
      const r = h('input', { type: 'range', min: '-0.3', max: '0.3', step: '0.01', value: String(get()) });
      const val = h('span', null, get().toFixed(2));
      r.oninput = () => { set(Number(r.value)); val.textContent = Number(r.value).toFixed(2); };
      return h('div', { cls: 'col' }, h('span', null, label), h('div', { cls: 'row' }, r, val));
    };
    this.body.append(
      mk('Température mondiale', () => w.climate.tempOffset, (v) => { w.climate.tempOffset = v; }),
      mk('Humidité mondiale', () => w.climate.humidOffset, (v) => { w.climate.humidOffset = v; }),
      h('p', { cls: 'muted' }, 'Les biomes se réajustent progressivement (glaciers, déserts, forêts) au fil des mois.'),
    );
  }
}
