import { hash2 } from '../core/rng';
import { countBuildings } from './settlement';
import { knows } from './tech';
import type { World } from './world';

/** Yearly space program for advanced civilisations: rockets, satellites, stations, colonies. */
export function updateSpace(w: World): void {
  for (const k of w.livingKingdoms()) {
    if (!knows(k, 'rocketry')) continue;
    const cap = w.settlements.get(k.capital);
    if (!cap || countBuildings(w, cap, 'spaceport', false) === 0) continue;
    if (k.treasury < 200) continue;
    k.treasury -= 150;
    k.rockets++;
    w.stats.rockets++;
    const port = cap.buildings.map((id) => w.buildings.get(id)!).find((b) => b && b.type === 'spaceport');
    w.fx('rocket', (port?.x ?? cap.x) + 0.5, (port?.y ?? cap.y) + 0.5);
    w.sfx('rocket');
    if (k.rockets === 1) w.addHistory('space', `${k.name} lance sa première fusée vers les étoiles !`, 3, cap.x, cap.y);
    w.unlock('space:rocket');
    if (knows(k, 'satellites') && w.rng.chance(0.6)) {
      k.satellites++;
      if (k.satellites === 1) w.addHistory('space', `${k.name} place son premier satellite en orbite.`, 2);
      w.unlock('space:satellite');
    }
    if (knows(k, 'stations') && k.satellites >= 3 && k.stations === 0 && w.rng.chance(0.3)) {
      k.stations = 1;
      w.addHistory('space', `${k.name} assemble une station orbitale habitée.`, 3);
      w.unlock('space:station');
    }
    if (knows(k, 'colonization') && k.stations > 0 && w.rng.chance(0.15) && k.colonies.length < 3) {
      const seed = hash2(w.opts.seed, k.id * 31 + k.colonies.length);
      const planet = `${k.name} ${['Prime', 'Nova', 'Secunda', 'Tertia'][k.colonies.length] ?? 'Ultima'}`;
      k.colonies.push(planet);
      w.stats.colonies++;
      w.addHistory('space', `Des colons de ${k.name} s’installent sur une nouvelle planète : ${planet} !`, 3);
      w.unlock('space:colony');
      w.bus.emit('colony', { kingdom: k.id, planet, seed });
    }
  }
}
