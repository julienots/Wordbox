import { clamp } from '../core/math';
import { Kingdom } from './entities';
import { aggression, militaryPower } from './kingdom';
import { fx, has } from './person';
import { declareWar, isAtWar } from './war';
import type { World } from './world';

function borders(w: World, a: Kingdom, b: Kingdom, dist = 26): boolean {
  for (const sa of a.settlements) {
    const s = w.settlements.get(sa);
    if (!s) continue;
    for (const sb of b.settlements) {
      const t = w.settlements.get(sb);
      if (t && (s.x - t.x) ** 2 + (s.y - t.y) ** 2 < dist * dist) return true;
    }
  }
  return false;
}

/** Monthly diplomacy between every pair of living kingdoms (staggered). */
export function updateDiplomacy(w: World): void {
  const ks = w.livingKingdoms();
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      if ((a.id + b.id + w.tick) % 3 !== 0) continue;
      pair(w, a, b);
    }
  }
  federations(w);
}

function pair(w: World, a: Kingdom, b: Kingdom): void {
  const r = w.relation(a.id, b.id);
  const near = borders(w, a, b);
  const far = borders(w, a, b, 60) || (a.era >= 3 && b.era >= 3 && a.techs.includes('sailing'));
  if (!r.contact && (near || far)) {
    r.contact = true;
    w.addHistory('diplomacy', `Premier contact entre ${a.name} et ${b.name}.`, 1);
  }
  if (!r.contact) return;
  // ---- opinion drift
  let target = 0;
  if (a.religion === b.religion) target += 20; else target -= 10;
  if (a.culture === b.culture) target += 15;
  const ca = w.cultures.get(a.culture), cb = w.cultures.get(b.culture);
  if (ca && cb && (ca.parent === cb.id || cb.parent === ca.id)) target += 10;
  if (near) target -= 10;
  if (r.trade) target += 15;
  if (r.alliance) target += 20;
  if (r.embargo) target -= 20;
  if (r.tributeFrom >= 0) target -= 10;
  if (a.government === b.government) target += 5;
  const ra = w.persons.get(a.ruler), rb = w.persons.get(b.ruler);
  for (const ruler of [ra, rb]) {
    if (!ruler) continue;
    if (has(ruler, 'xenophobe')) target -= 15;
    if (has(ruler, 'cosmopolitan') || has(ruler, 'kind')) target += 10;
  }
  const pa = militaryPower(w, a), pb = militaryPower(w, b);
  const ratio = pa / Math.max(1, pb);
  if (ratio > 0.8 && ratio < 1.25 && near) target -= 10; // rivalry
  target -= r.grievance * 0.5;
  target += (a.reputation + b.reputation - 100) * 0.1;
  r.opinion = clamp(r.opinion + (target - r.opinion) * 0.08 + w.rng.normal() * 2, -100, 100);
  r.grievance = Math.max(0, r.grievance - 0.6);

  // tribute payment
  if (r.tributeFrom >= 0) {
    const payer = r.tributeFrom === a.id ? a : b, receiver = payer === a ? b : a;
    const t = Math.min(payer.treasury, 2 + payer.treasury * 0.05);
    payer.treasury -= t;
    receiver.treasury += t;
    if (r.war < 0 && (militaryPower(w, payer) > militaryPower(w, receiver) * 1.2 || w.rng.chance(0.002))) {
      r.tributeFrom = -1;
      w.addHistory('diplomacy', `${payer.name} cesse de payer tribut à ${receiver.name}.`, 1);
    }
  }
  // vassal rebellion
  for (const [v, o] of [[a, b], [b, a]] as [Kingdom, Kingdom][]) {
    if (v.overlord === o.id && militaryPower(w, v) > militaryPower(w, o) * 1.1 && w.rng.chance(0.05)) {
      v.overlord = -1;
      w.addHistory('diplomacy', `${v.name} proclame son indépendance face à ${o.name} !`, 2);
      if (w.rng.chance(0.5)) declareWar(w, o, v, 'indépendance');
      return;
    }
    if (v.overlord === o.id) {
      const t = v.treasury * 0.04;
      v.treasury -= t;
      o.treasury += t;
    }
  }
  if (r.war >= 0) return;

  const aggA = aggression(w, a), aggB = aggression(w, b);
  // ---- treaties
  if (!r.trade && !r.embargo && r.opinion > 5 && a.era >= 2 && b.era >= 2 && w.rng.chance(0.15)) {
    r.trade = true;
    w.addHistory('diplomacy', `Accord commercial entre ${a.name} et ${b.name}.`, 1);
    w.unlock('diplo:trade');
  }
  if (r.trade && r.opinion < -20) { r.trade = false; }
  if (!r.pact && r.opinion > 25 && w.rng.chance(0.05)) {
    r.pact = true;
    w.addHistory('diplomacy', `Pacte de non-agression entre ${a.name} et ${b.name}.`, 1);
    w.unlock('diplo:pact');
  }
  if (!r.alliance && r.opinion > 55 && w.rng.chance(0.06)) {
    r.alliance = true;
    w.addHistory('diplomacy', `Alliance entre ${a.name} et ${b.name}.`, 2);
    w.unlock('diplo:alliance');
  } else if (r.alliance && r.opinion < 15) {
    r.alliance = false;
    w.addHistory('diplomacy', `L’alliance entre ${a.name} et ${b.name} est rompue.`, 1);
  }
  if (!r.embargo && r.opinion < -45 && w.rng.chance(0.05)) {
    r.embargo = true;
    r.trade = false;
    w.addHistory('diplomacy', `${a.name} et ${b.name} se frappent d’embargo.`, 1);
    w.unlock('diplo:embargo');
  } else if (r.embargo && r.opinion > -10) r.embargo = false;
  // weak neighbour buys peace
  if (r.tributeFrom < 0 && near && (ratio > 3 || ratio < 1 / 3) && w.rng.chance(0.03)) {
    const weak = ratio > 3 ? b : a, strong = weak === a ? b : a;
    if (aggression(w, strong) > 0.6) {
      r.tributeFrom = weak.id;
      w.addHistory('diplomacy', `${weak.name} accepte de payer tribut à ${strong.name}.`, 1);
      w.unlock('diplo:tribute');
      return;
    }
  }
  // voluntary vassalage of tiny kingdoms
  if (near && a.overlord < 0 && b.overlord < 0 && r.opinion > 40 && (ratio > 5 || ratio < 0.2) && w.rng.chance(0.02)) {
    const weak = ratio > 5 ? b : a, strong = weak === a ? b : a;
    weak.overlord = strong.id;
    w.addHistory('diplomacy', `${weak.name} se place sous la protection de ${strong.name} (vassalité).`, 2);
    w.unlock('diplo:vassal');
    return;
  }

  // ---- war decision
  if (w.tick < r.truceUntil || a.overlord === b.id || b.overlord === a.id) return;
  for (const [att, def, agg, rat] of [[a, b, aggA, ratio], [b, a, aggB, 1 / ratio]] as [Kingdom, Kingdom, number, number][]) {
    if (isAtWar(w, att) && w.rng.chance(0.8)) continue;
    const ruler = w.persons.get(att.ruler);
    const betrayal = r.alliance && ruler && has(ruler, 'traitor') && rat > 1.5;
    if (r.alliance && !betrayal) continue;
    if (r.pact && !(ruler && fx(ruler, 'loyalty') < 0 && rat > 1.8)) continue;
    let want = 0;
    let cause = '';
    if (near) { want += 0.4; cause = 'territoire'; }
    if (att.religion !== def.religion && (w.cultures.get(att.culture)?.values.pious ?? 0) > 0.6) { want += 0.25; cause = 'religion'; }
    if (r.grievance > 30) { want += 0.3; cause = 'vengeance'; }
    if (att.treasury < 50 && def.treasury > 300) { want += 0.2; cause = 'ressources'; }
    if (att.government !== def.government && att.era >= 7) { want += 0.15; cause = cause || 'idéologie'; }
    if (rat > 0.8 && rat < 1.25 && near) { want += 0.1; cause = cause || 'rivalité'; }
    want *= agg;
    want += (-r.opinion - 10) / 100;
    if (rat < 0.9) want -= 0.4;
    if (att.stability < 30) want -= 0.3;
    if (w.opts.mode === 'chaos') want += 0.2;
    if (want > 0.28 && w.rng.chance(0.1 * want)) {
      declareWar(w, att, def, betrayal ? 'trahison' : cause || 'rivalité');
      return;
    }
  }
}

/** Long-standing allied blocs of advanced nations merge into federations. */
function federations(w: World): void {
  if (w.tick % 120 !== 60) return;
  for (const k of w.livingKingdoms()) {
    if (k.federation >= 0 || k.era < 6) continue;
    const allies = w.livingKingdoms().filter((o) => o.id !== k.id && o.federation < 0 && o.era >= 6 && w.relation(k.id, o.id).alliance && w.relation(k.id, o.id).opinion > 70);
    if (allies.length >= 2 && w.rng.chance(0.25)) {
      const id = w.id();
      const members = [k.id, ...allies.map((a) => a.id)];
      const name = `Fédération ${k.name}-${allies[0].name}`;
      w.federations.set(id, { id, name, members, founded: w.tick });
      for (const m of members) w.kingdoms.get(m)!.federation = id;
      w.addHistory('diplomacy', `Création de la ${name} (${members.length} nations).`, 3);
      w.unlock('diplo:federation');
    }
  }
  // federation members share peace among themselves
  for (const f of w.federations.values()) {
    f.members = f.members.filter((id) => w.kingdoms.get(id)?.fallen === -1);
    for (const a of f.members) for (const b of f.members) if (a < b) { const r = w.relation(a, b); r.alliance = true; r.trade = true; }
  }
}
