/* Redirect status kept current WITHOUT a SEMrush pull.

   The automatic scan is only offered when the app shares an origin with the site,
   because a cross-origin browser request cannot reveal a redirect — verified
   below against a real server answering real 301s. So both routes are tested:
   the paste/bulk route (which is what works from GitHub Pages) and the
   same-origin scan (which is what would work if the app were served from the
   site's own domain). */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('..');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const REDIRECTS = new Set();
const GONE = new Set();
let hits = 0;

/* One server that serves BOTH the app and the "site", so the app can be loaded
   same-origin with the inventory for the scan test. */
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  if (REDIRECTS.has(p)) { hits++; r.writeHead(301, { Location: '/dest/' }); return r.end(); }
  if (GONE.has(p)) { hits++; r.writeHead(404); return r.end('gone'); }
  let f = path.join(DIST, p === '/' ? '/index.html' : p);
  if (fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
    r.writeHead(200, { 'content-type': M[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    return fs.createReadStream(f).pipe(r);
  }
  hits++;                                   // an inventory URL, not an app file
  r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html>a page</html>');
});
await new Promise(r => srv.listen(8073, r));
const ORIGIN = 'http://localhost:8073';

const check = [];
const ok = (n, c, x = '') => { const l = `${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`; check.push(l); console.log(l); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached' });

const base = await page.evaluate(() => ({
  live: P.filter(p => effTier(p) !== 'redirect').length,
  redir: P.filter(p => effTier(p) === 'redirect').length,
  sampleLive: P.filter(p => effTier(p) !== 'redirect').slice(0, 3).map(p => p.path),
  sampleRedir: P.filter(p => effTier(p) === 'redirect').slice(0, 1).map(p => p.path),
  origin: location.origin,
}));
ok('baseline', base.live === 299 && base.redir === 33, `${base.live} live · ${base.redir} redirects`);

/* ---------- 1. cross-origin really cannot see a redirect ---------- */
REDIRECTS.add(base.sampleLive[0]);
const xo = await page.evaluate(async u => {
  const out = {};
  try {
    const r = await fetch('http://127.0.0.1:8073' + u, { redirect: 'manual', cache: 'no-store' });
    out.cors = r.type;
  } catch (e) { out.cors = 'threw: ' + e.name; }
  try {
    await fetch('http://127.0.0.1:8073' + u, { mode: 'no-cors', redirect: 'manual' });
    out.nocors = 'resolved';
  } catch (e) { out.nocors = 'threw: ' + e.name; }
  return out;
}, base.sampleLive[0]);
ok('cross-origin + redirect:manual is blocked, not observable',
   xo.cors !== 'opaqueredirect', 'cors→' + xo.cors);
ok('no-cors + redirect:manual throws before any request',
   /threw/.test(xo.nocors), 'no-cors→' + xo.nocors);

/* ---------- 2. the paste route: what actually works from GitHub Pages ------- */
await page.click('#checkbtn');
await page.waitForSelector('#checkmodal.on');
ok('the cross-origin limitation is explained in the modal',
   /browser won.t\s+allow it/i.test((await page.locator('#checkmodal .mbox').textContent()).replace(/\s+/g, ' ')));

/* mixed input: a path, a full URL, no trailing slash, a bogus line */
const pasted = [base.sampleLive[0], ORIGIN + base.sampleLive[1],
  base.sampleLive[2].replace(/\/$/, ''), '/no-such-page-anywhere/'].join('\n');
await page.fill('#chkurls', pasted);
await page.waitForTimeout(350);
const prev = await page.locator('#chkresult').textContent();
ok('paste matches paths, full URLs and missing slashes', /3 will change to redirecting/i.test(prev),
   prev.replace(/\s+/g, ' ').slice(0, 70));
ok('an unknown URL is reported back, not silently dropped', /1 not in the inventory/i.test(prev));
ok('nothing applied until you say so', await page.evaluate(() => Object.keys(ANN.live || {}).length === 0));

await page.click('#chkapply');
await page.waitForTimeout(400);
const applied = await page.evaluate(s => ({
  stored: Object.keys(ANN.live || {}).length,
  tiers: s.map(p => effTier(byPath[p])),
  live: P.filter(p => effTier(p) !== 'redirect').length,
}), base.sampleLive);
ok('only the pasted URLs are recorded', applied.stored === 3, applied.stored + ' recorded');
ok('they all drop to the redirect tier', applied.tiers.every(t => t === 'redirect'), applied.tiers.join(','));
ok('live page count falls by 3', applied.live === base.live - 3, `${base.live} → ${applied.live}`);
const tile = (await page.locator('#tiles .tile').first().textContent()).replace(/\s+/g, ' ');
ok('the headline tile follows', tile.includes(String(applied.live)), tile.trim().slice(0, 60));
ok('the map moves them into the redirect band', await page.evaluate(s => s.every(p => {
  const c = document.querySelector(`.cell[data-path="${CSS.escape(p)}"]`);
  return c && c.closest('.tiergroup.redirect');
}), base.sampleLive));

/* ---------- 3. bringing one back ---------- */
await page.click('#checkbtn'); await page.waitForSelector('#checkmodal.on');
await page.fill('#chkurls', base.sampleRedir[0]);
await page.locator('input[name="chkstate"][value="live"]').check();
await page.waitForTimeout(350);
ok('a redirect can be marked as serving again',
   /1 will change to serving content/i.test(await page.locator('#chkresult').textContent()));
await page.click('#chkapply'); await page.waitForTimeout(400);
ok('it comes back as a page', await page.evaluate(p => effTier(byPath[p]) === 'fanout', base.sampleRedir[0]));

/* ---------- 4. the per-page control ---------- */
await page.locator('nav.tabs button[data-tab="all"]').click();
await page.waitForTimeout(200);
const one = await page.evaluate(() => P.find(p => effTier(p) === 'fanout' && !(ANN.live || {})[p.path]).path);
await page.evaluate(p => openDrawer(p), one);
await page.waitForSelector('#drawer.on');
ok('the panel has a live-status control', (await page.locator('#dlivebtns button').count()) === 2);
await page.locator('#dlivebtns button[data-v="redirect"]').click();
await page.waitForTimeout(300);
ok('one click marks a single page as redirecting',
   await page.evaluate(p => effTier(byPath[p]) === 'redirect', one));
ok('and offers to fall back to the build', (await page.locator('#dliveclear').count()) === 1);
await page.click('#dliveclear'); await page.waitForTimeout(300);
ok('falling back restores the build value',
   await page.evaluate(p => effTier(byPath[p]) === 'fanout' && !(ANN.live || {})[p], one));
await page.click('#dclose');

/* ---------- 5. header chip + filter ---------- */
ok('header reports when redirect status was last touched',
   /checked today/i.test(await page.locator('#redirchip').textContent()));
await page.locator('nav.tabs button[data-tab="map"]').click();
await page.selectOption('#fann', '__statuschanged');
await page.waitForTimeout(300);
ok('you can filter to pages whose status you changed',
   (await page.locator('.matrix .cell').count()) === 4,
   (await page.locator('.matrix .cell').count()) + ' cells');
await page.selectOption('#fann', '');

/* ---------- 6. survives reload and a data rebuild ---------- */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached' });
ok('status survives a reload',
   await page.evaluate(s => s.every(p => effTier(byPath[p]) === 'redirect'), base.sampleLive));

const orig = fs.readFileSync(path.join(DIST, 'data.json'), 'utf8');
const d = JSON.parse(orig);
d.stats.generated = '2026-08-25 09:00 UTC';
d.pages.forEach(p => { p.kw += 1; });
fs.writeFileSync(path.join(DIST, 'data.json'), JSON.stringify(d));
await page.click('#refresh');
await page.waitForTimeout(1500);
ok('status survives a data rebuild',
   await page.evaluate(s => s.every(p => effTier(byPath[p]) === 'redirect'), base.sampleLive));
fs.writeFileSync(path.join(DIST, 'data.json'), orig);

/* ---------- 7. Refresh no longer implies the data matches the site -------- */
await page.click('#refresh');          // settle on the restored file first
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelectorAll('.toast').forEach(n => n.remove()));
await page.click('#refresh');          // now a genuine no-change refresh
await page.waitForTimeout(1400);
const toastTxt = await page.locator('.toast').first().textContent().catch(() => '');
ok('Refresh points at the redirect route instead of claiming freshness',
   /Check redirects|redirect/i.test(toastTxt) && !/up to date/i.test(toastTxt),
   toastTxt.replace(/\s+/g, ' ').trim().slice(0, 90));

/* ---------- 8. same-origin: the scan IS offered and works ---------- */
await page.evaluate(o => { P.forEach(p => { p.url = o + p.path; }); }, ORIGIN);
await page.click('#checkbtn'); await page.waitForSelector('#checkmodal.on');
ok('served same-origin, the scan is offered', await page.locator('#chkstart').isVisible());
REDIRECTS.clear();
const allRedir = await page.evaluate(() => P.filter(p => p.tier === 'redirect').map(p => p.path));
allRedir.forEach(p => REDIRECTS.add(p));          // the build's redirects still redirect
const newly = await page.evaluate(() => P.filter(p => p.tier !== 'redirect' && !(ANN.live || {})[p.path]).slice(0, 2).map(p => p.path));
newly.forEach(p => REDIRECTS.add(p));
GONE.add(await page.evaluate(() => P.find(p => p.tier !== 'redirect').path));
hits = 0;
await page.click('#chkstart');
await page.waitForFunction(() => document.querySelector('#chkresult').textContent.length > 20, null, { timeout: 90000 });
const scan = await page.evaluate(() => {
  const c = { redirect: 0, live: 0, error: 0 };
  Object.values(SWEEP.results || {}).forEach(v => c[v]++);
  return c;
});
ok('the same-origin scan reaches every URL', hits > 300, hits + ' requests');
ok('it detects real 301s', scan.redirect >= allRedir.length + newly.length,
   JSON.stringify(scan));
ok('it reports nothing as unreachable', scan.error === 0, JSON.stringify(scan));
const scanRes = await page.evaluate(n => n.map(p => SWEEP.results[p]), newly);
ok('newly-redirecting pages are spotted by the scan', scanRes.every(v => v === 'redirect'), scanRes.join(','));
await page.click('#chkcancel');

ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\n' + check.join('\n'));
const fails = check.filter(c => c.startsWith('❌'));
console.log(`\n${check.length - fails.length}/${check.length} passed`);
await browser.close(); srv.close();
process.exit(fails.length ? 1 : 0);
