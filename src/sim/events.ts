import { addTrait, bio, fullName } from './person';
import { famine, meteor, startEpidemic } from './disasters';
import { civilWar } from './kingdom';
import { spawnAnimal } from './ecosystem';
import { learnTech, availableTechs } from './tech';
import type { World } from './world';

export const RANDOM_EVENTS = [
  'Famine', 'Découverte', 'Révolution', 'Naissance d’un héros', 'Maladie', 'Invasion', 'Trésor', 'Découverte scientifique', 'Guerre civile', 'Catastrophe naturelle', 'Âge d’or', 'Prophète',
];

/** Monthly random-event director (frequency depends on game mode). */
export function randomEvents(w: World): void {
  const mult = w.opts.mode === 'chaos' ? 5 : w.opts.mode === 'infinite' ? 1.2 : 1;
  if (!w.rng.chance(0.03 * mult)) return;
  const ks = w.livingKingdoms();
  if (!ks.length) return;
  const k = w.rng.pick(ks);
  const cap = w.settlements.get(k.capital);
  if (!cap) return;
  const ev = w.rng.int(0, 11);
  const residents = cap.residents.map((id) => w.persons.get(id)!).filter(Boolean);
  switch (ev) {
    case 0: famine(w, cap.x, cap.y, 25); break;
    case 1: {
      // discovery of a deposit near the capital
      const i = w.map.idx(cap.x + w.rng.int(-6, 6), cap.y + w.rng.int(-6, 6));
      if (!w.map.isWater(i)) {
        w.map.deposit[i] = w.rng.chance(0.3) ? 4 : 2;
        w.map.depositAmt[i] = 2000;
        w.map.dirty(i);
        w.addHistory('event', `Des prospecteurs de ${k.name} découvrent un riche gisement près de ${cap.name}.`, 1, cap.x, cap.y);
      }
      break;
    }
    case 2:
      k.stability = Math.max(0, k.stability - 25);
      w.addHistory('event', `Agitation révolutionnaire en ${k.name}.`, 1, cap.x, cap.y);
      break;
    case 3: case 11: {
      const young = residents.filter((p) => w.tick - p.birth < 120 * 30);
      const p = young.length ? w.rng.pick(young) : residents[0];
      if (!p) break;
      if (ev === 3) {
        addTrait(p, 'hero'); addTrait(p, 'brave'); p.renown += 60;
        bio(w, p, 'Les présages annoncent un destin héroïque.');
        w.addHistory('hero', `Naissance d’une légende : ${fullName(w, p)} de ${cap.name} est promis${p.female ? 'e' : ''} à un grand destin.`, 2, p.x, p.y);
      } else {
        addTrait(p, 'pious'); addTrait(p, 'charismatic'); p.prof = 'priest'; p.renown += 50;
        bio(w, p, 'Reçoit des visions et prêche une nouvelle foi.');
        w.addHistory('religion', `Le prophète ${fullName(w, p)} prêche à ${cap.name}.`, 2, p.x, p.y);
      }
      break;
    }
    case 4: startEpidemic(w, cap.x, cap.y); break;
    case 5: {
      // barbarian / monster invasion near the border
      const sp = w.rng.pick(['wolf', 'bear', 'demon']);
      for (let n = 0; n < 6; n++) spawnAnimal(w, sp, cap.x + w.rng.range(-12, 12), cap.y + w.rng.range(-12, 12), 3);
      w.addHistory('event', `Des hordes de ${sp === 'demon' ? 'démons' : sp === 'wolf' ? 'loups' : 'ours'} menacent ${cap.name}.`, 1, cap.x, cap.y);
      break;
    }
    case 6:
      k.treasury += 300 + k.era * 100;
      w.addHistory('event', `Un trésor antique est mis au jour en ${k.name}.`, 1, cap.x, cap.y);
      break;
    case 7: {
      const av = availableTechs(k);
      if (av.length) {
        learnTech(w, k, w.rng.pick(av));
        w.addHistory('event', `Percée scientifique inattendue en ${k.name}.`, 1, cap.x, cap.y);
      }
      break;
    }
    case 8: {
      const rebel = residents.find((p) => p.traits.includes('ambitious')) ?? residents[0];
      const prov = k.settlements.map((id) => w.settlements.get(id)!).find((s) => s && s.id !== k.capital);
      if (rebel && prov && k.stability < 50) civilWar(w, k, rebel, 'insurrection', prov);
      break;
    }
    case 9: meteor(w, cap.x + w.rng.range(-20, 20), cap.y + w.rng.range(-20, 20), 3); break;
    case 10:
      k.stability = Math.min(100, k.stability + 20);
      cap.happiness = Math.min(100, cap.happiness + 20);
      w.addHistory('event', `Âge d’or : prospérité et arts fleurissent en ${k.name}.`, 1, cap.x, cap.y);
      break;
  }
  w.unlock('random:' + ev);
}
