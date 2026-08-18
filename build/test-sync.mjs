import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const DIST = path.resolve('..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(8097, r));
const URL_ = 'http://localhost:8097/';

/* ---- fake GitHub contents API, shared by both browser contexts ---- */
let repoFile = null;            // {content(json string), sha}
let putCount = 0, conflictOnce = false;
const sha = s => 'sha' + [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);

async function routeGitHub(ctx, label) {
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const auth = req.headers()['authorization'];
    if (auth !== 'Bearer github_pat_TESTTOKEN')
      return route.fulfill({ status: 401, json: { message: 'Bad credentials' } });

    if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname))
      return route.fulfill({ status: 200, json: { full_name: 'jf/1031cf-content-map', private: true, permissions: { push: true, pull: true } } });

    if (u.pathname.endsWith('/contents/annotations.json')) {
      if (req.method() === 'GET') {
        if (!repoFile) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
        return route.fulfill({ status: 200, json: { sha: repoFile.sha, content: Buffer.from(repoFile.content, 'utf8').toString('base64') } });
      }
      if (req.method() === 'PUT') {
        putCount++;
        const body = JSON.parse(req.postData());
        if (conflictOnce) { conflictOnce = false; return route.fulfill({ status: 409, json: { message: 'conflict' } }); }
        if (repoFile && body.sha !== repoFile.sha) return route.fulfill({ status: 409, json: { message: 'stale sha' } });
        const content = Buffer.from(body.content, 'base64').toString('utf8');
        repoFile = { content, sha: sha(content) };
        return route.fulfill({ status: 200, json: { content: { sha: repoFile.sha } } });
      }
    }
    return route.fulfill({ status: 404, json: { message: 'nope' } });
  });
}

const check = [];
const ok = (n, c, x = '') => check.push(`${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/* ============ device A: connect + write ============ */
const A = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await routeGitHub(A, 'A');
const a = await A.newPage();
const errA = []; a.on('pageerror', e => errA.push(e.message));
await a.goto(URL_, { waitUntil: 'networkidle' });
await a.waitForSelector('#boot.off', { state: 'attached' });

await a.click('#syncchip');
await a.fill('#syowner', 'jf'); await a.fill('#syrepo', '1031cf-content-map');
await a.fill('#sybranch', 'main'); await a.fill('#sypath', 'annotations.json');
await a.fill('#sytoken', 'github_pat_TESTTOKEN'); await a.fill('#syauthor', 'Jennifer');
await a.click('#sytest'); await a.waitForTimeout(400);
ok('test connection succeeds', (await a.locator('#systatus').textContent()).includes('write access'),
   await a.locator('#systatus').textContent());

await a.click('#sysave'); await a.waitForTimeout(900);
ok('modal closes on save', !(await a.locator('#syncmodal').evaluate(n => n.classList.contains('on'))));
ok('chip reads synced', (await a.locator('#syncchip').getAttribute('data-s')) === 'synced',
   await a.locator('#syncchip').getAttribute('data-s'));
ok('remote file created', !!repoFile);

/* bad token is rejected */
await a.click('#syncchip'); await a.fill('#sytoken', 'wrong'); await a.click('#sytest'); await a.waitForTimeout(400);
ok('bad token rejected', (await a.locator('#systatus').textContent()).includes('401'),
   await a.locator('#systatus').textContent());
await a.fill('#sytoken', 'github_pat_TESTTOKEN'); await a.click('#sycancel');

/* annotate on A */
await a.locator('.matrix .cell .notebtn').first().click();
await a.waitForSelector('#drawer.on');
const pathA = await a.locator('#dpath').textContent();
await a.locator('#dstatus button', { hasText: 'In progress' }).click();
await a.locator('#dlabels button', { hasText: 'Rewrite' }).click();
await a.fill('#dcomment', 'From laptop: needs a direct answer up top.');
await a.click('#dpost');
await a.waitForTimeout(3200);
ok('push after edit', repoFile && JSON.parse(repoFile.content).pages[pathA]?.comments?.length === 1,
   'putCount=' + putCount);
ok('author recorded', repoFile && JSON.parse(repoFile.content).pages[pathA].comments[0].author === 'Jennifer');
await a.click('#dclose');

/* ============ device B: fresh profile, pulls A's work ============ */
const B = await browser.newContext({ viewport: { width: 400, height: 860 } });
await routeGitHub(B, 'B');
const b = await B.newPage();
const errB = []; b.on('pageerror', e => errB.push(e.message));
await b.goto(URL_, { waitUntil: 'networkidle' });
await b.waitForSelector('#boot.off', { state: 'attached' });
await b.click('#syncchip');
await b.fill('#syowner', 'jf'); await b.fill('#syrepo', '1031cf-content-map');
await b.fill('#sybranch', 'main'); await b.fill('#sypath', 'annotations.json');
await b.fill('#sytoken', 'github_pat_TESTTOKEN'); await b.fill('#syauthor', 'Jennifer (phone)');
await b.click('#sysave'); await b.waitForTimeout(1200);
await b.locator('nav.tabs button[data-tab="notes"]').click();
await b.waitForTimeout(400);
ok('device B pulled device A notes', (await b.locator('#notelist .notecard').count()) === 1,
   (await b.locator('#notelist .notecard').count()) + ' cards');

/* B edits a DIFFERENT page — both must survive */
await b.locator('nav.tabs button[data-tab="map"]').click();
await b.locator('.matrix .cell .notebtn').nth(2).click();
await b.waitForSelector('#drawer.on');
const pathB = await b.locator('#dpath').textContent();
await b.locator('#dstatus button', { hasText: 'Blocked' }).click();
await b.fill('#dcomment', 'From phone: waiting on legal review.');
await b.click('#dpost');
await b.waitForTimeout(3200);
const remote1 = JSON.parse(repoFile.content);
ok('both devices merged, no loss', !!remote1.pages[pathA] && !!remote1.pages[pathB],
   Object.keys(remote1.pages).length + ' pages in repo');

/* A also comments on the SAME page B touched, while offline-ish — concurrent edit */
await a.locator('.matrix .cell .notebtn').nth(2).click();
await a.waitForSelector('#drawer.on');
await a.fill('#dcomment', 'From laptop: legal signed off Friday.');
await a.click('#dpost');
await a.waitForTimeout(3200);
const remote2 = JSON.parse(repoFile.content);
const cmts = remote2.pages[pathB].comments.map(c => c.text);
ok('concurrent comments both kept', cmts.length === 2, cmts.length + ' comments: ' + cmts.map(t => t.slice(0, 18)).join(' / '));
ok('status from later write kept', remote2.pages[pathB].status === 'blocked', remote2.pages[pathB].status);

/* stale-sha conflict is retried transparently */
conflictOnce = true;
await a.fill('#dcomment', 'Third comment after a forced conflict.');
await a.click('#dpost');
await a.waitForTimeout(4000);
const remote3 = JSON.parse(repoFile.content);
ok('retries through a 409', remote3.pages[pathB].comments.length === 3,
   remote3.pages[pathB].comments.length + ' comments');
ok('chip back to synced after conflict', (await a.locator('#syncchip').getAttribute('data-s')) === 'synced',
   await a.locator('#syncchip').getAttribute('data-s'));

/* offline queue: edit offline, then come back */
await A.setOffline(true);
await a.fill('#dcomment', 'Written while offline on a plane.');
await a.click('#dpost');
await a.waitForTimeout(2600);
ok('offline shows queued state', ['offline', 'error', 'pending'].includes(await a.locator('#syncchip').getAttribute('data-s')),
   await a.locator('#syncchip').getAttribute('data-s'));
const beforeOnline = JSON.parse(repoFile.content).pages[pathB].comments.length;
await A.setOffline(false);
await a.waitForTimeout(3500);
const remote4 = JSON.parse(repoFile.content);
ok('queued edit pushed on reconnect', remote4.pages[pathB].comments.length === beforeOnline + 1,
   `${beforeOnline} → ${remote4.pages[pathB].comments.length}`);

/* comment deletion must not resurrect via merge */
const delId = remote4.pages[pathB].comments[0].id;
await a.locator(`[data-del="${delId}"]`).click();
await a.waitForTimeout(3200);
await b.reload({ waitUntil: 'networkidle' });
await b.waitForSelector('#boot.off', { state: 'attached' });
await b.waitForTimeout(1800);
const remote5 = JSON.parse(repoFile.content);
ok('deleted comment stays deleted', !remote5.pages[pathB].comments.some(c => c.id === delId),
   remote5.pages[pathB].comments.length + ' left');

/* placement + label overrides merge per field across devices */
await a.evaluate(() => closeDrawer());
const shared = await a.evaluate(() => {
  const p = P.find(x => x.tier === 'fanout' && x.cat === 'DST');
  openDrawer(p.path); return p.path;
});
await a.waitForSelector('#drawer.on');
await a.selectOption('#dcluster', 'Opportunity Zones');
await a.waitForTimeout(3200);
ok('device A cluster move pushed',
   JSON.parse(repoFile.content).pages[shared]?.cluster === 'Opportunity Zones',
   JSON.stringify(JSON.parse(repoFile.content).pages[shared]?.cluster));

/* B, which has just pulled, changes the TIER of the same page */
await b.reload({ waitUntil: 'networkidle' });
await b.waitForSelector('#boot.off', { state: 'attached' });
await b.waitForTimeout(1800);
await b.evaluate(t => openDrawer(t), shared);
await b.waitForSelector('#drawer.on');
await b.selectOption('#dtier', 'transactional');
await b.waitForTimeout(3200);
const both = JSON.parse(repoFile.content).pages[shared];
ok('cluster from A and tier from B both survive',
   both.cluster === 'Opportunity Zones' && both.tier === 'transactional',
   `${both.cluster} / ${both.tier}`);

/* A switches a build label off; B renames a label. Neither should clobber. */
await a.evaluate(t => openDrawer(t), shared);
await a.waitForSelector('#drawer.on');
const anyAuto = await a.locator('#dlabels button', { has: a.locator('.auto') }).count();
if (anyAuto) { await a.locator('#dlabels button', { has: a.locator('.auto') }).first().click(); }
await a.waitForTimeout(3200);
await b.evaluate(() => { const l = ANN.labels.find(x => x.id === 'rewrite'); l.name = 'Rewrite (B)'; l.u = new Date().toISOString(); touchLibrary(); });
await b.waitForTimeout(3200);
const fin = JSON.parse(repoFile.content);
ok('label switch-off and library rename both survive',
   (!anyAuto || (fin.pages[shared].offFlags || []).length === 1) &&
   fin.labels.some(l => l.name === 'Rewrite (B)'),
   `offFlags=${JSON.stringify(fin.pages[shared].offFlags)} renamed=${fin.labels.some(l => l.name === 'Rewrite (B)')}`);
ok('placement not lost by the label round-trip',
   fin.pages[shared].cluster === 'Opportunity Zones' && fin.pages[shared].tier === 'transactional',
   `${fin.pages[shared].cluster} / ${fin.pages[shared].tier}`);
await a.evaluate(() => closeDrawer());

/* status library edits merge per entry, and a removal isn't undone by the other
   device still having it */
await a.evaluate(() => {
  const st = ANN.statuses.find(x => x.id === 'drafted');
  st.name = 'Drafted (A)'; st.u = new Date().toISOString();
  touchLibrary();
});
await a.waitForTimeout(3200);
ok('status rename from A pushed',
   JSON.parse(repoFile.content).statuses.some(x => x.name === 'Drafted (A)'));

await b.reload({ waitUntil: 'networkidle' });
await b.waitForSelector('#boot.off', { state: 'attached' });
await b.waitForTimeout(1800);
ok('device B sees the rename', await b.evaluate(() => ANN.statuses.some(x => x.name === 'Drafted (A)')));

/* B removes a different status; A reorders. Both must survive. */
await b.evaluate(() => {
  ANN.statuses = ANN.statuses.filter(x => x.id !== 'monitoring');
  ANN.hiddenS = ['monitoring']; ANN.hiddenSAt = new Date().toISOString();
  touchLibrary();
});
await b.waitForTimeout(3200);
await a.evaluate(() => {
  const t = new Date().toISOString();
  visibleStatuses(false).slice().reverse().forEach((x, k) => { x.o = k; x.u = t; });
  touchLibrary();
});
await a.waitForTimeout(3400);
const fin2 = JSON.parse(repoFile.content);
/* A hidden entry may stay in the library — `hiddenS` is what suppresses it, and
   that's deliberate so the other device can't resurrect it. What matters is that
   nothing renders it. */
ok('removal from B survives A reordering',
   (fin2.hiddenS || []).includes('monitoring'), JSON.stringify(fin2.hiddenS || []));
/* check the live library, then reopen the drawer to confirm the picker rebuilds
   from it (a closed drawer keeps whatever it last rendered) */
ok('a hidden status is gone from the library on A',
   await a.evaluate(() => !visibleStatuses(true).some(x => x.id === 'monitoring')));
ok('reopening the drawer no longer offers it',
   await a.evaluate(t => {
     openDrawer(t);
     const gone = ![...document.querySelectorAll('#dstatus button')].some(n => /Monitoring/.test(n.textContent));
     closeDrawer();
     return gone;
   }, shared));
ok('order from A survives too',
   fin2.statuses.filter(x => x.id !== 'none').every(x => typeof x.o === 'number'));

/* B reloads: the removed status must not come back from A's copy */
await b.reload({ waitUntil: 'networkidle' });
await b.waitForSelector('#boot.off', { state: 'attached' });
await b.waitForTimeout(1800);
ok('removed status stays removed on B',
   await b.evaluate(() => (ANN.hiddenS || []).includes('monitoring')
     && !visibleStatuses(false).some(x => x.id === 'monitoring')));

/* disconnect leaves local data intact */
await a.click('#syncchip'); await a.click('#sydisconnect'); await a.waitForTimeout(500);
ok('disconnect returns to local', (await a.locator('#syncchip').getAttribute('data-s')) === 'local');
await a.locator('nav.tabs button[data-tab="notes"]').click();
await a.waitForTimeout(300);
ok('notes survive disconnect', (await a.locator('#notelist .notecard').count()) >= 2);

ok('no page errors', errA.length + errB.length === 0, [...errA, ...errB].slice(0, 3).join(' | '));

console.log('\n' + check.join('\n'));
const fails = check.filter(c => c.startsWith('❌'));
console.log(`\n${check.length - fails.length}/${check.length} passed`);
await browser.close(); srv.close();
process.exit(fails.length ? 1 : 0);
