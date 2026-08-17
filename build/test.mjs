import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(8099, r));
const URL_ = 'http://localhost:8099/';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();

const errors = [], logs = [];
page.on('console', m => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const check = [];
const ok = (name, cond, extra = '') => check.push(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached', timeout: 15000 }).catch(() => {});

ok('boot screen dismissed', await page.locator('#boot').evaluate(n => n.classList.contains('off')));
ok('data loaded', (await page.locator('#asof').textContent()).length > 5, await page.locator('#asof').textContent());
ok('matrix rendered', await page.locator('.matrix .col').count() === 12, (await page.locator('.matrix .col').count()) + ' clusters');
ok('cells rendered', await page.locator('.matrix .cell').count() > 250, (await page.locator('.matrix .cell').count()) + ' cells');
ok('note buttons present', await page.locator('.notebtn').count() > 250);
ok('tabs count', await page.locator('nav.tabs button').count() === 9);

// --- service worker
const swReg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!r && !!(r.active || r.installing || r.waiting);
});
ok('service worker registered', swReg);

// --- manifest
const mres = await page.request.get(URL_ + 'manifest.webmanifest');
const mani = await mres.json();
ok('manifest valid', mres.ok() && mani.icons.length === 3 && mani.display === 'standalone');
for (const ic of mani.icons) {
  const r = await page.request.get(URL_ + ic.src);
  ok('icon ' + ic.src, r.ok() && (await r.body()).length > 500);
}

// --- annotations: set status, label, comment
await page.locator('.matrix .cell .notebtn').first().click();
await page.waitForSelector('#drawer.on');
const drawerPath = await page.locator('#dpath').textContent();
ok('drawer opens', !!drawerPath, drawerPath);
await page.locator('#dstatus button', { hasText: 'In progress' }).click();
await page.locator('#dlabels button', { hasText: 'Rewrite' }).click();
await page.locator('#dlabels button', { hasText: 'AEO: FAQ block' }).click();
await page.fill('#dtarget', 'what is a dst 1031 exchange');
await page.fill('#dcomment', 'Needs a direct-answer paragraph above the fold, then the FAQ block.');
await page.click('#dpost');
await page.waitForTimeout(400);
ok('comment posted', (await page.locator('#dthread li').count()) === 1);
ok('badges on cell', (await page.locator('.matrix .cell .apill').count()) >= 3);

// second page
await page.click('#dclose');
await page.locator('.matrix .cell .notebtn').nth(3).click();
await page.waitForSelector('#drawer.on');
await page.locator('#dstatus button', { hasText: 'Monitoring' }).click();
await page.fill('#dnewlabel', 'Q4 sprint');
await page.click('#daddlabel');
await page.waitForTimeout(300);
ok('custom label added', (await page.locator('#dlabels button', { hasText: 'Q4 sprint' }).count()) === 1);
await page.click('#dclose');

// --- notes tab
await page.locator('nav.tabs button[data-tab="notes"]').click();
await page.waitForTimeout(300);
ok('notes tab lists pages', (await page.locator('#notelist .notecard').count()) === 2,
   (await page.locator('#notelist .notecard').count()) + ' cards');

// --- persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached', timeout: 15000 });
await page.locator('nav.tabs button[data-tab="notes"]').click();
await page.waitForTimeout(400);
ok('annotations survive reload', (await page.locator('#notelist .notecard').count()) === 2);
ok('custom label survives reload', await page.evaluate(() => ANN.labels.some(l => l.name === 'Q4 sprint')));

// --- simulate a data refresh: new data.json, same URLs, changed metrics
const orig = JSON.parse(fs.readFileSync(path.join(DIST,'data.json'), 'utf8'));
const bumped = JSON.parse(JSON.stringify(orig));
bumped.stats.generated = '2026-08-17 09:00 UTC';
bumped.stats.keywords += 111;
bumped.pages.forEach(p => { p.kw = p.kw + 1; });
fs.writeFileSync(path.join(DIST,'data.json'), JSON.stringify(bumped));
await page.click('#refresh');
await page.waitForTimeout(1200);
ok('refresh picked up new data', (await page.locator('#asof').textContent()).includes('2026-08-17'),
   await page.locator('#asof').textContent());
await page.locator('nav.tabs button[data-tab="notes"]').click();
await page.waitForTimeout(300);
ok('annotations survive data refresh', (await page.locator('#notelist .notecard').count()) === 2);
fs.writeFileSync(path.join(DIST,'data.json'), JSON.stringify(orig));

// --- offline
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForSelector('#boot.off', { state: 'attached', timeout: 15000 }).catch(() => {});
const offlineWorks = await page.locator('.matrix .cell').count();
ok('renders offline from cache', offlineWorks > 250, offlineWorks + ' cells');
ok('offline bar shown', await page.locator('#offlinebar').evaluate(n => n.classList.contains('on')).catch(() => false));
await ctx.setOffline(false);

// --- export
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached' });
await page.locator('nav.tabs button[data-tab="notes"]').click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#annexport')]);
const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
ok('export contains notes', Object.keys(exp.pages).length === 2);

// --- CSV export includes note columns
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
const csv = fs.readFileSync(await dl2.path(), 'utf8');
ok('CSV has note columns', csv.split('\n')[0].includes('status') && csv.split('\n')[0].includes('moved_by_you') && csv.includes('In progress'));

// --- other tabs render
for (const t of ['attn', 'work', 'redir', 'slug', 'all', 'cov', 'src']) {
  await page.locator(`nav.tabs button[data-tab="${t}"]`).click();
  await page.waitForTimeout(120);
  const vis = await page.locator(`#tab-${t}`).isVisible();
  const kids = await page.locator(`#tab-${t} *`).count();
  ok(`tab ${t}`, vis && kids > 5, kids + ' nodes');
}

// --- mobile layout
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(URL_, { waitUntil: 'networkidle' });
await m.waitForSelector('#boot.off', { state: 'attached', timeout: 15000 });
const hOverflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
ok('no horizontal overflow on mobile', !hOverflow);
await m.screenshot({ path: 'shots/mobile.png', fullPage: false });

await page.locator('nav.tabs button[data-tab="map"]').click();
await page.screenshot({ path: 'shots/map.png', fullPage: false });
await page.locator('.matrix .cell .notebtn').first().click();
await page.waitForSelector('#drawer.on');
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/drawer.png' });
await page.click('#dclose');
await page.locator('nav.tabs button[data-tab="notes"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/notes.png' });
await page.click('#syncchip');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/sync.png' });

ok('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log('\n' + check.join('\n'));
const fails = check.filter(c => c.startsWith('❌'));
console.log(`\n${check.length - fails.length}/${check.length} passed`);
if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));

await browser.close();
server.close();
process.exit(fails.length ? 1 : 0);
