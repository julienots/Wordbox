// Dev tool: renders generated worlds to PNG for quick visual inspection.
// Usage: npx vite-node scripts/preview-map.ts -- <outDir> [seed] [size]
import { writeFileSync } from 'node:fs';
import { BIOMES } from '../src/data/biomes';
import { generateMap, type WorldShape } from '../src/world/generator';
// @ts-expect-error plain JS helper
import { encodePNG } from './png.mjs';

const [outDir = '.', seed = '12345', size = '320'] = process.argv.slice(2).filter((a) => a !== '--');
for (const shape of ['continents', 'pangea', 'archipelago', 'islands', 'inland'] as WorldShape[]) {
  const t = performance.now();
  const m = generateMap({ seed: Number(seed), size: Number(size), shape });
  const counts = new Array(BIOMES.length).fill(0);
  const px = new Uint8Array(m.size * 4);
  for (let i = 0; i < m.size; i++) {
    const c = BIOMES[m.biome[i]].color;
    counts[m.biome[i]]++;
    px.set([c[0], c[1], c[2], 255], i * 4);
  }
  console.log(shape, Math.round(performance.now() - t) + 'ms', counts.map((c, i) => (c ? BIOMES[i].name + ':' + c : '')).filter(Boolean).join(' '));
  writeFileSync(`${outDir}/${shape}.png`, encodePNG(m.w, m.h, px));
}
