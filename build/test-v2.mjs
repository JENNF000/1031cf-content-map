import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(8095, r));
const URL_ = 'http://localhost:8095/';

const check = [];
const ok = (n, c, x = '') => check.push(`${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached', timeout: 15000 });

/* ---------- 1. cleaner map + naming ---------- */
ok('tier bands are real containers', await page.locator('.tiergroup').count() > 20,
   (await page.locator('.tiergroup').count()) + ' bands');
const tierNames = await page.locator('.matrix .tierlab .tname').allTextContents();
ok('"Core page" is now "Pillar"', tierNames.includes('Pillar') && !tierNames.some(t => /core/i.test(t)),
   [...new Set(tierNames)].join(', '));
ok('every band shows a count', (await page.locator('.tierlab .tcount').count()) === (await page.locator('.tiergroup').count()));
ok('flag chip-row removed', (await page.locator('#fflags').count()) === 0);
ok('drag hint present', (await page.locator('.maphint').count()) === 1);

/* ---------- 6. topic-map tiles trimmed ---------- */
const tiles = await page.locator('#tiles .tile .lab').allTextContents();
ok('Review / not-in-sheet tiles gone', tiles.length === 4 &&
   !tiles.some(t => /review|sheet/i.test(t)), tiles.join(' | '));

/* ---------- 5. "In your sheet" out of the drawer ---------- */
await page.locator('.matrix .cell').first().hover();
await page.locator('.matrix .cell .notebtn').first().click();
await page.waitForSelector('#drawer.on');
const metricLabels = await page.locator('#dmetrics .ml').allTextContents();
ok('"In your sheet" box removed', !metricLabels.some(t => /sheet/i.test(t)), metricLabels.join(' | '));
ok('replaced with page type', metricLabels.includes('Page type'));

/* ---------- 3. build flags are labels, and switchable ---------- */
const target = await page.locator('#dpath').textContent();
const autoCount = await page.locator('#dlabels button .auto').count();
ok('build flags appear in the label list', autoCount > 0, autoCount + ' auto labels');
const autoBtn = page.locator('#dlabels button', { has: page.locator('.auto') }).first();
const autoName = (await autoBtn.textContent()).replace('auto', '').trim();
ok('auto label starts switched on', (await autoBtn.getAttribute('aria-pressed')) === 'true', autoName);
await autoBtn.click(); await page.waitForTimeout(250);
ok('auto label can be switched off', (await autoBtn.getAttribute('aria-pressed')) === 'false');
const offFlags = await page.evaluate(t => (ANN.pages[t] || {}).offFlags || [], target);
ok('switching off is recorded, not lost', offFlags.length === 1, JSON.stringify(offFlags));

/* ---------- 2. placement via the drawer ---------- */
const before = await page.evaluate(t => {
  const p = byPath[t]; return { cat: p.cat, tier: p.tier };
}, target);
await page.selectOption('#dcluster', 'Opportunity Zones');
await page.waitForTimeout(300);
await page.selectOption('#dtier', 'fanout');
await page.waitForTimeout(300);
const moved = await page.evaluate(t => {
  const p = byPath[t];
  return { cat: effCat(p), tier: effTier(p), moved: isMoved(p) };
}, target);
ok('cluster + tier override applied', moved.cat === 'Opportunity Zones' && moved.tier === 'fanout' && moved.moved,
   `${before.cat}/${before.tier} → ${moved.cat}/${moved.tier}`);
ok('reset control appears', (await page.locator('#dreset').count()) === 1);

/* it must show up in the new cluster column on the map */
await page.click('#dclose');
await page.waitForTimeout(300);
const inNewCol = await page.evaluate(t => {
  const col = [...document.querySelectorAll('.matrix .col')].find(c => c.dataset.cluster === 'Opportunity Zones');
  return !!col && !!col.querySelector(`.cell[data-path="${CSS.escape(t)}"]`);
}, target);
ok('page renders in its new column', inNewCol);
ok('moved page is marked on the map', await page.locator(`.cell[data-path="${target}"].moved`).count() === 1);

/* ---------- 2b. drag handles are present ----------
   The drag itself is exercised with real trusted input in test-realdrag.mjs.
   An earlier synthetic-DragEvent test here passed while the feature was broken,
   so this file only checks the wiring is in place. */
const handles = await page.locator('.matrix .cell[data-drag]').count();
ok('cells carry drag handles', handles > 200, handles + ' draggable cells');
ok('no native draggable attribute left behind',
   (await page.locator('.matrix .cell[draggable]').count()) === 0);
const zones = await page.locator('.matrix [data-drop]').count();
ok('drop zones exist', zones > 30, zones + ' zones');

/* empty bands only appear while dragging, so there is always somewhere to drop */
const emptyHidden = await page.evaluate(() => {
  const e = document.querySelector('.tiergroup.empty');
  if (!e) return 'none';
  const hidden = getComputedStyle(e).display === 'none';
  document.body.classList.add('dragging');
  const shown = getComputedStyle(e).display !== 'none';
  document.body.classList.remove('dragging');
  return hidden && shown;
});
ok('empty drop bands reveal on drag', emptyHidden === true || emptyHidden === 'none', String(emptyHidden));

/* ---------- moves survive a data refresh ---------- */
const orig = fs.readFileSync(path.join(DIST, 'data.json'), 'utf8');
const d = JSON.parse(orig);
d.stats.generated = '2026-08-17 18:00 UTC';
d.pages.forEach(p => { p.kw += 2; });
fs.writeFileSync(path.join(DIST, 'data.json'), JSON.stringify(d));
await page.click('#refresh');
await page.waitForTimeout(1500);
const survived = await page.evaluate(t => {
  const p = byPath[t]; return effCat(p) + '/' + effTier(p);
}, target);
ok('manual placement survives a refresh', survived === 'Opportunity Zones/fanout', survived);
const offSurvived = await page.evaluate(t => ((ANN.pages[t] || {}).offFlags || []).length, target);
ok('switched-off label survives a refresh', offSurvived === 1);
fs.writeFileSync(path.join(DIST, 'data.json'), orig);

/* ---------- 4. label rename, recolour, remove ---------- */
await page.locator('nav.tabs button[data-tab="notes"]').click();
await page.waitForTimeout(200);
await page.click('#annlabels');
await page.waitForSelector('#labelmodal.on');
const rows = await page.locator('#lablist .labrow').count();
ok('label manager lists the library', rows > 15, rows + ' labels');

const firstInput = page.locator('#lablist .labrow input[type=text]').first();
const origName = await firstInput.inputValue();
await firstInput.fill('Renamed label');
await page.waitForTimeout(700);
const renamed = await page.evaluate(() => ANN.labels.some(l => l.name === 'Renamed label'));
ok('label can be renamed', renamed, `${origName} → Renamed label`);

const sw = page.locator('#lablist .labrow .swatch').first();
const c0 = await sw.getAttribute('data-c');
await sw.click(); await page.waitForTimeout(300);
const c1 = await page.locator('#lablist .labrow .swatch').first().getAttribute('data-c');
ok('label colour can be changed', c0 !== c1, `${c0} → ${c1}`);

page.on('dialog', d => d.accept());
const delRow = page.locator('#lablist .labrow[data-id="aeo-faq"]');
await delRow.locator('.del').click();
await page.waitForTimeout(500);
const removed = await page.evaluate(() =>
  !ANN.labels.some(l => l.id === 'aeo-faq') && (ANN.hidden || []).includes('aeo-faq'));
ok('label can be removed from the library', removed);
const stillOnPages = await page.evaluate(() =>
  Object.values(ANN.pages).some(p => (p.labels || []).includes('aeo-faq')));
ok('removal strips it from every page', !stillOnPages);

/* removing a build-computed label makes it vanish from the map too */
const beforeAuto = await page.evaluate(() => document.querySelectorAll('.apill').length);
const derivedRow = page.locator('#lablist .labrow[data-id="slug"]');
await derivedRow.locator('.del').click();
await page.waitForTimeout(600);
const slugGone = await page.evaluate(() => (ANN.hidden || []).includes('slug'));
ok('a build label can be removed too', slugGone);
await page.click('#labdone'); await page.waitForTimeout(400);
const anySlugPill = await page.evaluate(() =>
  [...document.querySelectorAll('.apill')].some(n => n.textContent.trim() === 'Slug fix'));
ok('removed build label disappears from the views', !anySlugPill);

/* restore */
await page.click('#annlabels'); await page.waitForSelector('#labelmodal.on');
await page.click('#labrestore'); await page.waitForTimeout(500);
const restored = await page.evaluate(() =>
  (ANN.hidden || []).length === 0 && ANN.labels.some(l => l.id === 'slug') && ANN.labels.some(l => l.id === 'aeo-faq'));
ok('restore defaults brings them back', restored);
await page.click('#labdone');

/* ---------- persistence ---------- */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached' });
const afterReload = await page.evaluate(t => {
  const p = byPath[t];
  return { placement: effCat(p) + '/' + effTier(p),
           renamed: ANN.labels.some(l => l.name === 'Renamed label'),
           off: ((ANN.pages[t] || {}).offFlags || []).length };
}, target);
ok('everything survives a reload',
   afterReload.placement === 'Opportunity Zones/fanout' && afterReload.renamed && afterReload.off === 1,
   JSON.stringify(afterReload));

/* ---------- density ---------- */
const chipsBefore = await page.locator('.matrix .cell .meta').count();
await page.click('#density'); await page.waitForTimeout(400);
const chipsAfter = await page.locator('.matrix .cell .meta').count();
ok('compact density strips chips', chipsBefore > 0 && chipsAfter === 0, `${chipsBefore} → ${chipsAfter}`);
await page.click('#density'); await page.waitForTimeout(400);

/* ---------- screenshots ---------- */
await page.locator('nav.tabs button[data-tab="map"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/v2-map.png', clip: { x: 0, y: 0, width: 1500, height: 1000 } });
await page.locator('.matrix .cell').first().hover();
await page.locator('.matrix .cell .notebtn').first().click();
await page.waitForSelector('#drawer.on'); await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/v2-drawer.png' });
await page.click('#dclose');
await page.locator('nav.tabs button[data-tab="notes"]').click();
await page.click('#annlabels'); await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/v2-labels.png' });
await page.click('#labdone');

const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(URL_, { waitUntil: 'networkidle' });
await m.waitForSelector('#boot.off', { state: 'attached' });
ok('no horizontal overflow on mobile',
   !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
await m.screenshot({ path: 'shots/v2-mobile.png' });

ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n' + check.join('\n'));
const fails = check.filter(c => c.startsWith('❌'));
console.log(`\n${check.length - fails.length}/${check.length} passed`);
await browser.close(); srv.close();
process.exit(fails.length ? 1 : 0);
