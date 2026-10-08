// Dev tool: CPU profile of N simulated years (writes a .cpuprofile summary to stdout).
import { createServer } from 'vite';
import { ViteNodeServer } from 'vite-node/server';
import { ViteNodeRunner } from 'vite-node/client';
import { Session } from 'node:inspector/promises';

const years = Number(process.argv[2] ?? 30), warm = Number(process.argv[3] ?? 250);
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
const node = new ViteNodeServer(server);
const runner = new ViteNodeRunner({ root: server.config.root, base: server.config.base, fetchModule: (id) => node.fetchModule(id), resolveId: (id, imp) => node.resolveId(id, imp) });
const { createWorld } = await runner.executeFile('./src/sim/setup.ts');
const { step } = await runner.executeFile('./src/sim/simulation.ts');
const w = createWorld({ id: 'p', name: 'P', seed: 42, size: 256, shape: 'continents', mode: 'infinite', civs: 6, species: [], climate: 0, moisture: 0, animals: 1 });
for (let i = 0; i < warm * 120; i++) step(w);
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.start');
for (let i = 0; i < years * 120; i++) step(w);
const { profile } = await session.post('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(((v / total) * 100).toFixed(1).padStart(5) + '%', k);
await server.close();
