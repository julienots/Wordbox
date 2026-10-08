// End-to-end smoke test in headless Chromium: boots the built game, creates a
// world, uses powers, inspects, saves/loads, and fails on any console error.
// Usage: npm run build:debug && node scripts/smoke.mjs [outDir]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const out = process.argv[2] ?? 'test-output';
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join('dist', decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/\/$/, '/index.html'));
  let body;
  try { body = await readFile(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
  res.end(body);
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) errors.push(name); };
for (const vp of [{ width: 1280, height: 720, name: 'landscape' }, { width: 412, height: 870, name: 'portrait', mobile: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console ${vp.name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror ${vp.name}] ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('#menu', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${vp.name}-1-menu.png` });
  check(`${vp.name}: main menu`, await page.isVisible('text=Nouveau monde'));
  await page.click('text=Nouveau monde');
  await page.waitForSelector('text=Créer le monde');
  await page.screenshot({ path: `${out}/${vp.name}-2-newworld.png` });
  await page.click('text=Créer le monde');
  await page.waitForFunction(() => window.game?.world && !window.game.world.opts.id.startsWith('demo') && document.querySelector('#topbar')?.style.display !== 'none', null, { timeout: 60000 });
  await page.click('text=Commencer').catch(() => undefined);
  const y0 = await page.evaluate(() => window.game.world.year);
  await page.evaluate(() => window.game.setSpeed(5));
  await page.waitForTimeout(6000);
  const y1 = await page.evaluate(() => window.game.world.year);
  check(`${vp.name}: simulation advances`, y1 > y0, `(${y0} -> ${y1})`);
  await page.screenshot({ path: `${out}/${vp.name}-3-strategic.png` });
  // zoom to the capital: close-up view with people and buildings
  await page.evaluate(() => { const g = window.game; const w = g.world; const k = w.livingKingdoms()[0]; const s = w.settlements.get(k.capital); g.setSpeed(1); g.cam.x = s.x + 0.5; g.cam.y = s.y + 0.5; g.cam.zoom = 28; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${vp.name}-4-close.png` });
  await page.evaluate(() => { window.game.cam.zoom = 9; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${vp.name}-5-mid.png` });
  // tap the capital -> inspector
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(600);
  check(`${vp.name}: inspector opens`, await page.isVisible('#panel.open'));
  await page.screenshot({ path: `${out}/${vp.name}-6-inspector.png` });
  await page.evaluate(() => window.game.panels.close());
  // powers through the wheel
  await page.click('#wheelBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${vp.name}-7-wheel.png` });
  await page.click('.wheel-item:has-text("Destruction")');
  await page.click('.wheel-item:has-text("Météore")');
  await page.mouse.click(vp.width / 2 + 60, vp.height / 2 + 40);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${vp.name}-8-meteor.png` });
  const meteorHist = await page.evaluate(() => window.game.world.history.some((h) => h.text.includes('météore')));
  check(`${vp.name}: meteor power`, meteorHist);
  // every power once (API level)
  const powerErr = await page.evaluate(() => {
    const g = window.game; const errs = [];
    const { x, y } = g.cam;
    for (const id of ['tree', 'fire', 'lightning', 'heal', 'tornado', 'blackhole', 'supernova', 'rift', 'aliens', 'terraform', 'humans', 'animal']) {
      try { const p = POWERS_LOOKUP(id); g.setPower(p); g.applyPower(x + Math.random() * 20 - 10, y + Math.random() * 20 - 10, true); } catch (e) { errs.push(id + ':' + e.message); }
    }
    g.setPower(null);
    return errs;
    function POWERS_LOOKUP(id) { return g.hud.constructor && g.world && window.__powers?.find((p) => p.id === id); }
  }).catch((e) => [String(e)]);
  check(`${vp.name}: powers api`, powerErr.length === 0, powerErr.join(','));
  await page.evaluate(() => { window.game.cam.zoom = 6; });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${vp.name}-9-ultimates.png` });
  // panels
  for (const label of ['Stats', 'Histoire', 'Nations', 'Codex', 'Défis', 'Filtres']) {
    await page.click(`.toolbar .btn:has-text("${label}")`);
    await page.waitForTimeout(400);
    check(`${vp.name}: panel ${label}`, await page.isVisible('#panel.open'));
    if (label === 'Stats' || label === 'Histoire') await page.screenshot({ path: `${out}/${vp.name}-panel-${label}.png` });
  }
  await page.click('.btn:has-text("Religions")');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${vp.name}-filter-religion.png` });
  // save + reload from storage
  await page.evaluate(() => window.game.setSpeed(0));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.game.save());
  const id = await page.evaluate(() => window.game.world.opts.id);
  const pop = await page.evaluate(() => window.game.world.totalPop() + '@' + window.game.world.tick);
  const pop2 = await page.evaluate(async (i) => { await window.game.loadWorld(i, false); return window.game.world.totalPop() + '@' + window.game.world.tick; }, id);
  check(`${vp.name}: save/load`, pop2 === pop, `(${pop} vs ${pop2})`);
  const fps = await page.evaluate(() => window.game.renderer.stats.fps);
  results.push(`INFO ${vp.name}: fps ${fps} (headless swiftshader)`);
  await ctx.close();
}
await browser.close();
server.close();
console.log(results.join('\n'));
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('SMOKE OK');
