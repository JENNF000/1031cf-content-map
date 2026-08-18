/* Drag tested with REAL input — trusted pointer events, the same path a hand
   takes. The earlier synthetic-DragEvent test passed while the feature was
   broken, which is exactly the failure mode this file exists to prevent. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('..');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': M[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(8089, r));
const URL_ = 'http://localhost:8089/';

const check = [];
const ok = (n, c, x = '') => check.push(`${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached' });

/* Find a source cell. The destination is measured mid-drag on purpose: empty
   tier bands are display:none until a drag is in progress, so measuring them
   beforehand yields a zero-size rect at (0,0). */
const findSource = srcSel => page.evaluate(sel => {
  const cell = document.querySelector(sel);
  if (!cell) return { err: 'no source cell for ' + sel };
  /* Put the top of the matrix at the top of the viewport, so a fan-out cell and
     another column's Transactional band are on screen together. Vertical
     auto-scroll is exercised separately in test 6. */
  const m = document.querySelector('#matrix');
  m.scrollLeft = 0;                       // earlier drags may have scrolled it
  m.scrollIntoView({ block: 'start' });
  scrollBy(0, -12);
  const r = cell.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
    return { err: 'source cell off screen at ' + Math.round(r.x) + ',' + Math.round(r.y) };
  const p = byPath[cell.dataset.path];
  return { path: cell.dataset.path, fromCat: p.cat, fromTier: p.tier,
           from: [Math.round(r.x + r.width / 2), Math.round(r.y + 14)] };
}, srcSel);

const zoneCentre = (cluster, tier) => page.evaluate(([cluster, tier]) => {
  const col = [...document.querySelectorAll('.matrix .col')].find(c => c.dataset.cluster === cluster);
  if (!col) return { err: 'no column ' + cluster };
  const zone = tier ? col.querySelector('.tiergroup.' + tier) : col.querySelector('.col-h');
  if (!zone) return { err: 'no zone ' + (tier || 'header') + ' in ' + cluster };
  /* The column may be off to the right. In real use the drag auto-scrolls there
     (test 6); here we scroll the container so the drop logic itself is what's
     under test, not the scrolling. */
  const m = document.querySelector('#matrix');
  const mr = m.getBoundingClientRect();
  let r = zone.getBoundingClientRect();
  if (r.right > mr.right - 20 || r.left < mr.left + 20) {
    m.scrollLeft += (r.left - mr.left) - (mr.width / 2 - r.width / 2);
    r = zone.getBoundingClientRect();
  }
  if (!r.width || !r.height) return { err: 'zone has no box (still hidden?)' };
  if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight)
    return { err: 'zone off screen at ' + Math.round(r.x) + ',' + Math.round(r.y) };
  return { to: [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(r.height / 2, 34))] };
}, [cluster, tier]);

async function dragTo(from, cluster, tier) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + 10, from[1] + 8);   // cross the threshold, bands appear
  await page.waitForTimeout(60);
  const z = await zoneCentre(cluster, tier);
  if (z.err) { await page.mouse.up(); return { err: z.err }; }
  const to = z.to;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from[0] + (to[0] - from[0]) * i / 12,
                          from[1] + (to[1] - from[1]) * i / 12);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(80);
  const mid = await page.evaluate(() => ({
    dragging: document.body.classList.contains('dragging'),
    ghost: !!document.querySelector('.dragghost'),
    ghostText: (document.querySelector('.dragghost') || {}).textContent || '',
    dropok: document.querySelectorAll('.dropok').length,
    zone: (document.querySelector('.dropok') || {}).className || '',
  }));
  await page.mouse.up();
  await page.waitForTimeout(250);
  return mid;
}

/* ---------- 1. cross-cluster + cross-tier drag ---------- */
const a = await findSource('.matrix .col .tiergroup.fanout .cell[data-drag]');
ok('found a source cell', !a.err, a.err || `${a.path} (${a.fromCat}/${a.fromTier})`);
const mid = await dragTo(a.from, '1031 Exchange Rules', 'transactional');
ok('empty target band becomes a real drop target once dragging', !mid.err, mid.err || mid.zone);
ok('drag actually starts', mid.dragging, JSON.stringify(mid));
ok('ghost follows the cursor', mid.ghost, mid.ghostText);
ok('target band highlights', mid.dropok === 1, mid.dropok + ' highlighted');
const r1 = await page.evaluate(t => ({ cat: effCat(byPath[t]), tier: effTier(byPath[t]), moved: isMoved(byPath[t]) }), a.path);
ok('page lands in the target cluster + tier',
   r1.cat === '1031 Exchange Rules' && r1.tier === 'transactional' && r1.moved,
   `${a.fromCat}/${a.fromTier} → ${r1.cat}/${r1.tier}`);
ok('drag state fully cleaned up',
   await page.evaluate(() => !document.body.classList.contains('dragging')
     && !document.querySelector('.dragghost') && !document.querySelector('.dropok')));
ok('undo offered', (await page.locator('.toast .tact').count()) >= 1);

/* ---------- 2. the drag must not follow the link ---------- */
ok('no navigation and no new tab', page.url() === URL_ && ctx.pages().length === 1,
   page.url() + ' · ' + ctx.pages().length + ' page(s)');

/* ---------- 3. a plain click still opens the page ---------- */
await page.waitForTimeout(500);   // let any suppress flag expire
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null),
  page.locator('.matrix .cell[data-drag]').first().click({ position: { x: 60, y: 12 } }),
]);
ok('click without movement still opens the URL', !!popup,
   popup ? await popup.url() : 'no page opened');
if (popup) await popup.close();

/* ---------- 4. dropping on a column header moves cluster only ---------- */
const b = await findSource('.matrix .col .tiergroup.fanout .cell[data-drag]');
ok('found a source cell for the header drop', !b.err, b.err || b.path);
const bres = await dragTo(b.from, 'Opportunity Zones', null);
ok('header highlights as a drop target', !bres.err && bres.dropok === 1,
   bres.err || JSON.stringify(bres));
const r2 = await page.evaluate(t => ({ cat: effCat(byPath[t]), tier: effTier(byPath[t]) }), b.path);
ok('header drop changes cluster and keeps the tier',
   r2.cat === 'Opportunity Zones' && r2.tier === b.fromTier,
   `${b.fromCat}/${b.fromTier} → ${r2.cat}/${r2.tier}`);

/* ---------- 5. Escape cancels mid-drag ---------- */
const c = await findSource('.matrix .col .tiergroup.fanout .cell[data-drag]');
await page.mouse.move(c.from[0], c.from[1]);
await page.mouse.down();
await page.mouse.move(c.from[0] + 12, c.from[1] + 8);
await page.waitForTimeout(60);
const cz = await zoneCentre('REIT', 'transactional');
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(c.from[0] + (cz.to[0] - c.from[0]) * i / 8, c.from[1] + (cz.to[1] - c.from[1]) * i / 8);
  await page.waitForTimeout(16);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(120);
const cancelled = await page.evaluate(() => !document.body.classList.contains('dragging') && !document.querySelector('.dragghost'));
await page.mouse.up();
await page.waitForTimeout(200);
const r3 = await page.evaluate(t => effCat(byPath[t]), c.path);
ok('Escape cancels and nothing moves', cancelled && r3 === c.fromCat, `${c.fromCat} → ${r3}`);

/* ---------- 6. auto-scroll reaches an off-screen column ---------- */
const scrolled = await page.evaluate(() => {
  const m = document.querySelector('#matrix');
  m.scrollLeft = 0;
  return { max: m.scrollWidth - m.clientWidth, left: m.scrollLeft };
});
ok('matrix does scroll sideways', scrolled.max > 100, 'scrollable by ' + Math.round(scrolled.max) + 'px');
const d = await findSource('.matrix .col .tiergroup.fanout .cell[data-drag]');
await page.mouse.move(d.from[0], d.from[1]);
await page.mouse.down();
await page.mouse.move(d.from[0] + 40, d.from[1] + 10);
await page.mouse.move(1580, 500);           // hold near the right edge
await page.waitForTimeout(700);
const afterScroll = await page.evaluate(() => document.querySelector('#matrix').scrollLeft);
await page.keyboard.press('Escape');
await page.mouse.up();
ok('holding at the edge auto-scrolls the matrix', afterScroll > 50, Math.round(afterScroll) + 'px scrolled');

/* ---------- 7. moves persist ---------- */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#boot.off', { state: 'attached' });
const r4 = await page.evaluate(t => effCat(byPath[t]) + '/' + effTier(byPath[t]), a.path);
ok('dragged placement survives a reload', r4 === '1031 Exchange Rules/transactional', r4);

/* ---------- 8. touch: long-press drags, a swipe scrolls ---------- */
const touchCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const t = await touchCtx.newPage();
const terrs = []; t.on('pageerror', e => terrs.push(e.message));
await t.goto(URL_, { waitUntil: 'networkidle' });
await t.waitForSelector('#boot.off', { state: 'attached' });
const tg = await t.evaluate(() => {
  const cell = document.querySelector('.matrix .col .tiergroup.fanout .cell[data-drag]');
  cell.scrollIntoView({ block: 'center' });
  const r = cell.getBoundingClientRect();
  return { path: cell.dataset.path, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 14) };
});
/* a quick swipe must NOT start a drag — it should still scroll */
await t.touchscreen.tap(1, 1).catch(() => {});
const swipe = await t.evaluate(async ([x, y]) => {
  const el = document.elementFromPoint(x, y);
  const mk = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true }));
  mk('pointerdown', x, y);
  await new Promise(r => setTimeout(r, 60));
  dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y - 40, isPrimary: true }));
  await new Promise(r => setTimeout(r, 60));
  const dragging = document.body.classList.contains('dragging');
  dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y - 40, isPrimary: true }));
  return dragging;
}, [tg.x, tg.y]);
ok('a quick swipe does not start a drag on touch', swipe === false, String(swipe));
/* a long press should */
const held = await t.evaluate(async ([x, y]) => {
  const el = document.elementFromPoint(x, y);
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
  await new Promise(r => setTimeout(r, 520));
  const dragging = document.body.classList.contains('dragging') && !!document.querySelector('.dragghost');
  dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
  return dragging;
}, [tg.x, tg.y]);
ok('a long press does start a drag on touch', held === true, String(held));
ok('no errors on the touch page', terrs.length === 0, terrs.slice(0, 2).join(' | '));
await t.screenshot({ path: 'shots/drag-mobile.png' });

ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\n' + check.join('\n'));
const fails = check.filter(x => x.startsWith('❌'));
console.log(`\n${check.length - fails.length}/${check.length} passed`);
await browser.close(); srv.close();
process.exit(fails.length ? 1 : 0);
