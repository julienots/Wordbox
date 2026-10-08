import { clamp, finite } from '../core/math';
import { B } from '../data/biomes';
import { BASE_PRICE, RES } from '../data/resources';
import { Settlement } from './entities';
import { knows, techFx } from './tech';
import type { World } from './world';

/** Local market prices follow supply and demand around base prices. */
export function updatePrices(s: Settlement): void {
  const pop = Math.max(1, s.pop);
  for (const r of RES) {
    const demand = r === 'food' ? pop * 1.5 : r === 'wood' || r === 'stone' ? pop * 0.3 : pop * 0.1;
    const ratio = (demand + 10) / (s.stock[r] + 10);
    s.prices[r] = finite(clamp(BASE_PRICE[r] * Math.pow(ratio, 0.5), BASE_PRICE[r] * 0.2, BASE_PRICE[r] * 6), BASE_PRICE[r]);
  }
}

/** Create trade routes between settlements (internal and with trade partners) and build roads along them. */
export function planRoutes(w: World): void {
  if (w.routes.size > w.settlements.size * 2) return;
  const all = [...w.settlements.values()].filter((s) => s.level >= 1);
  if (all.length < 2) return;
  const s = w.rng.pick(all);
  const k = w.kingdoms.get(s.kingdom);
  if (!k || k.era < 1) return;
  let best: Settlement | undefined, bd = Infinity;
  for (const o of all) {
    if (o.id === s.id) continue;
    if ([...w.routes.values()].some((r) => (r.a === s.id && r.b === o.id) || (r.a === o.id && r.b === s.id))) continue;
    if (o.kingdom !== s.kingdom) {
      const rel = w.relation(o.kingdom, s.kingdom);
      if (!rel.trade || rel.war >= 0 || rel.embargo) continue;
    }
    const d = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
    if (d < bd && d < (40 + k.era * 6) ** 2) { bd = d; best = o; }
  }
  if (!best) return;
  const target = best;
  const naval = knows(k, 'sailing');
  w.pathfinder.request(w.map.idx(s.x, s.y), w.map.idx(target.x, target.y), naval ? 1 : 0, (path) => {
    if (!path || !w.settlements.has(s.id) || !w.settlements.has(target.id)) return;
    const id = w.id();
    let water = 0;
    for (let i = 0; i < path.length; i++) if (w.map.isWater(path[i]) && w.map.biome[path[i]] !== B.RIVER) water++;
    w.routes.set(id, { id, a: s.id, b: target.id, path, volume: 0, naval: water > 3 });
    buildRoad(w, path, k.era);
    w.unlock('route');
  });
}

/** Roads on land, bridges over rivers & shallow straits (bridges need masonry era). */
function buildRoad(w: World, path: Int32Array, era: number): void {
  const m = w.map;
  const lvl = era < 4 ? 1 : era < 8 ? 2 : 3;
  for (let i = 0; i < path.length; i++) {
    const t = path[i];
    const b = m.biome[t];
    if (m.bld[t] >= 0) continue;
    if (m.isWater(t)) {
      const bridgeable = b === B.RIVER || (b === B.SHALLOW && era >= 7) || (b === B.LAKE && era >= 5);
      if (!bridgeable || era < 3) continue;
    }
    if (m.road[t] < lvl) {
      const wasWalk = m.walkable(t);
      m.road[t] = lvl;
      m.dirty(t);
      if (!wasWalk) m.terrainVer++;
      if (m.isWater(t)) w.unlock('bridge');
    }
  }
}

/** Monthly flows along trade routes: surplus goes where prices are higher; both sides earn gold. */
export function updateTrade(w: World): void {
  for (const [id, r] of w.routes) {
    const a = w.settlements.get(r.a), b = w.settlements.get(r.b);
    if (!a || !b) { w.routes.delete(id); continue; }
    if (a.kingdom !== b.kingdom) {
      const rel = w.relation(a.kingdom, b.kingdom);
      if (!rel.trade || rel.war >= 0 || rel.embargo) { r.volume = 0; continue; }
    }
    const ka = w.kingdoms.get(a.kingdom), kb = w.kingdoms.get(b.kingdom);
    const cap = 10 + (a.jobs.merchant ?? 0) * 6 + (b.jobs.merchant ?? 0) * 6;
    let volume = 0;
    for (const res of RES) {
      if (res === 'gold') continue;
      const [from, to] = a.prices[res] < b.prices[res] ? [a, b] : [b, a];
      const spread = to.prices[res] - from.prices[res];
      if (spread < BASE_PRICE[res] * 0.15) continue;
      const amt = Math.min(cap / RES.length * 2, from.stock[res] * 0.1, Math.max(0, to.storage - to.stock[res]));
      if (amt <= 0) continue;
      from.stock[res] -= amt;
      to.stock[res] += amt;
      const profit = amt * spread * 0.5 * (1 + techFx(ka).trade);
      from.stock.gold += profit * 0.5;
      to.stock.gold += profit * 0.5;
      volume += amt;
    }
    r.volume = volume;
    if (ka && kb && ka !== kb) {
      const rel = w.relation(ka.id, kb.id);
      rel.opinion = Math.min(100, rel.opinion + 0.2);
    }
  }
}
