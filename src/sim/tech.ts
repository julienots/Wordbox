import { ERAS, TechFx, TECHS, techById } from '../data/techs';
import { Kingdom } from './entities';
import type { World } from './world';

const fxCache = new WeakMap<Kingdom, { n: number; fx: Required<TechFx> }>();

export function knows(k: Kingdom | undefined, tech: string | null): boolean {
  if (!tech) return true;
  return !!k && k.techs.includes(tech);
}

/** Cumulated multipliers from all known technologies (cached until a new tech is learned). */
export function techFx(k: Kingdom | undefined): Required<TechFx> {
  const empty: Required<TechFx> = { food: 0, prod: 0, research: 0, health: 0, military: 0, move: 0, housing: 0, trade: 0, faith: 0, stability: 0 };
  if (!k) return empty;
  const c = fxCache.get(k);
  if (c && c.n === k.techs.length) return c.fx;
  const fx = { ...empty };
  for (const id of k.techs) {
    const t = techById.get(id);
    if (!t) continue;
    for (const key of Object.keys(t.fx) as (keyof TechFx)[]) fx[key] += t.fx[key] ?? 0;
  }
  fxCache.set(k, { n: k.techs.length, fx });
  return fx;
}

export function availableTechs(k: Kingdom): string[] {
  return TECHS.filter((t) => !k.techs.includes(t.id) && t.req.every((r) => k.techs.includes(r))).map((t) => t.id);
}

/** Era style bucket used by buildings & visuals: 0 ancient .. 4 futuristic. */
export function styleOfEra(era: number): number {
  return era <= 2 ? 0 : era <= 6 ? 1 : era <= 9 ? 2 : era <= 11 ? 3 : 4;
}

export function learnTech(w: World, k: Kingdom, id: string): void {
  if (k.techs.includes(id)) return;
  const t = techById.get(id);
  if (!t) return;
  k.techs.push(id);
  w.unlock('tech:' + id);
  const prevEra = k.era;
  k.era = Math.max(k.era, t.era);
  if (k.era > prevEra) {
    w.addHistory('tech', `${k.name} entre dans l’ère : ${ERAS[k.era]}.`, k.era >= 7 ? 3 : 2, ...capitalPos(w, k));
    w.unlock('era:' + k.era);
  } else if (t.era >= 5) {
    w.addHistory('tech', `${k.name} découvre : ${t.name}.`, 1, ...capitalPos(w, k));
  }
}

function capitalPos(w: World, k: Kingdom): [number?, number?] {
  const s = w.settlements.get(k.capital);
  return s ? [s.x, s.y] : [];
}

/** Monthly research: pick a target weighted by cultural values, accumulate points. */
export function updateResearch(w: World, k: Kingdom, points: number): void {
  if (!k.researching || k.techs.includes(k.researching)) {
    const avail = availableTechs(k);
    if (!avail.length) return;
    const c = w.cultures.get(k.culture);
    const pick = w.rng.weighted(avail, (id) => {
      const t = techById.get(id)!;
      let wgt = 1 / (1 + t.era * 0.3);
      if (c) {
        if (t.fx.military) wgt *= 0.6 + c.values.martial;
        if (t.fx.trade) wgt *= 0.6 + c.values.mercantile;
        if (t.fx.research) wgt *= 0.6 + c.values.scholarly;
        if (t.fx.faith) wgt *= 0.6 + c.values.pious;
      }
      return wgt;
    });
    k.researching = pick ?? avail[0];
  }
  k.research += points;
  const t = techById.get(k.researching);
  if (t && k.research >= t.cost) {
    k.research -= t.cost;
    learnTech(w, k, t.id);
    k.researching = '';
  }
}
