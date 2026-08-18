import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST=path.resolve('..');
const M={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(DIST,p);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'content-type':M[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(8082,r));
const URL_='http://localhost:8082/';
const check=[]; const ok=(n,c,x='')=>check.push(`${c?'✅':'❌'} ${n}${x?' — '+x:''}`);

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1500,height:1000}});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
p.on('dialog', d => d.accept());
await p.goto(URL_,{waitUntil:'networkidle'});
await p.waitForSelector('#boot.off',{state:'attached'});

/* set a status on a page so usage counts and stripping can be checked */
await p.locator('.matrix .cell').first().hover();
await p.locator('.matrix .cell .notebtn').first().click();
await p.waitForSelector('#drawer.on');
const target = await p.locator('#dpath').textContent();
await p.locator('#dstatus button', { hasText: 'In progress' }).click();
await p.waitForTimeout(250);
ok('status applied', await p.evaluate(t => (ANN.pages[t]||{}).status === 'inprogress', target));

/* the drawer's Status section has its own Manage link */
ok('Manage link on the Status section', (await p.locator('#dmanagestat').count()) === 1);
await p.click('#dmanagestat');
await p.waitForSelector('#labelmodal.on');
const rows = await p.locator('#statlist .labrow').count();
ok('status manager lists the statuses', rows === 7, rows + ' rows');
ok('"No status" is not editable', (await p.locator('#statlist .labrow[data-id="none"]').count()) === 0);
ok('usage count shown', (await p.locator('#statlist .labrow[data-id="inprogress"] .use').textContent()) === '1 page',
   await p.locator('#statlist .labrow[data-id="inprogress"] .use').textContent());

/* rename */
const inp = p.locator('#statlist .labrow[data-id="inprogress"] input');
await inp.fill('Optimising now');
await p.waitForTimeout(700);
ok('status can be renamed', await p.evaluate(() => ANN.statuses.some(s => s.name === 'Optimising now')));

/* recolour */
const sw = p.locator('#statlist .labrow[data-id="inprogress"] .swatch');
const c0 = await sw.getAttribute('data-c');
await sw.click(); await p.waitForTimeout(250);
const c1 = await p.locator('#statlist .labrow[data-id="inprogress"] .swatch').getAttribute('data-c');
ok('status colour can be changed', c0 !== c1, `${c0} → ${c1}`);

/* reorder */
const before = await p.evaluate(() => visibleStatuses(false).map(s => s.id));
await p.locator('#statlist .labrow[data-id="published"] [data-up]').click();
await p.waitForTimeout(250);
const after = await p.evaluate(() => visibleStatuses(false).map(s => s.id));
ok('status can be moved up', after.indexOf('published') === before.indexOf('published') - 1,
   before.join(',') + ' → ' + after.join(','));
ok('first row cannot move up', await p.locator('#statlist .labrow').first().locator('[data-up]').isDisabled());
ok('last row cannot move down', await p.locator('#statlist .labrow').last().locator('[data-down]').isDisabled());

/* the drawer's status buttons follow that order */
await p.click('#labdone'); await p.waitForTimeout(200);
const picker = await p.locator('#dstatus button').allTextContents();
ok('drawer buttons follow the new order',
   picker.indexOf('Published') < picker.indexOf('Drafted'), picker.join(' | '));
ok('renamed status shows in the drawer', picker.includes('Optimising now'));

/* add a status */
await p.click('#dmanagestat'); await p.waitForSelector('#labelmodal.on');
await p.fill('#statnew', 'Waiting on legal');
await p.click('#statnewbtn'); await p.waitForTimeout(300);
ok('status can be added', await p.evaluate(() => ANN.statuses.some(s => s.name === 'Waiting on legal')));
ok('new status appears last', await p.evaluate(() => {
  const v = visibleStatuses(false); return v[v.length-1].name === 'Waiting on legal'; }));

/* remove the status that is in use — the page must lose it, not keep a dead id */
await p.locator('#statlist .labrow[data-id="inprogress"] .del').click();
await p.waitForTimeout(400);
const removed = await p.evaluate(t => ({
  gone: !ANN.statuses.some(s => s.id === 'inprogress'),
  hidden: (ANN.hiddenS||[]).includes('inprogress'),
  pageCleared: (ANN.pages[t]||{}).status === '' || !ANN.pages[t],
}), target);
ok('status removed from the library', removed.gone && removed.hidden, JSON.stringify(removed));
ok('pages using it are cleared', removed.pageCleared);
await p.click('#labdone'); await p.waitForTimeout(300);
ok('removed status gone from the drawer',
   !(await p.locator('#dstatus button').allTextContents()).includes('Optimising now'));
ok('no status pill left on the map',
   await p.evaluate(() => ![...document.querySelectorAll('.apill.st')].some(n => /Optimising/.test(n.textContent))));

/* restore */
await p.click('#dmanagestat'); await p.waitForSelector('#labelmodal.on');
await p.click('#statrestore'); await p.waitForTimeout(400);
ok('restore brings default statuses back', await p.evaluate(() =>
  (ANN.hiddenS||[]).length === 0 && ANN.statuses.some(s => s.id === 'inprogress')));

/* restore-all covers labels too */
await p.locator('#lablist .labrow[data-id="slug"] .del').click();
await p.waitForTimeout(300);
await p.click('#labrestoreall'); await p.waitForTimeout(400);
ok('restore all defaults covers labels and statuses', await p.evaluate(() => {
  const defaults = ['none','todo','inprogress','drafted','published','monitoring','blocked','wontdo'];
  return (ANN.hidden||[]).length === 0 && (ANN.hiddenS||[]).length === 0
    && ANN.labels.some(l => l.id === 'slug')
    && defaults.every(d => ANN.statuses.some(s => s.id === d));   // added ones are kept too
}));
await p.click('#labdone');

/* everything persists */
await p.locator('#dmanagestat').count();
await p.click('#dmanagestat'); await p.waitForSelector('#labelmodal.on');
await p.fill('#statnew','Client review'); await p.click('#statnewbtn'); await p.waitForTimeout(300);
await p.locator('#statlist .labrow[data-id="wontdo"] .del').click(); await p.waitForTimeout(400);
await p.click('#labdone');
await p.reload({waitUntil:'networkidle'});
await p.waitForSelector('#boot.off',{state:'attached'});
const persisted = await p.evaluate(() => ({
  added: ANN.statuses.some(s => s.name === 'Client review'),
  removed: !ANN.statuses.some(s => s.id === 'wontdo') && (ANN.hiddenS||[]).includes('wontdo'),
  order: visibleStatuses(false).map(s => s.id).join(','),
}));
ok('status edits survive a reload', persisted.added && persisted.removed, JSON.stringify(persisted));

/* notes-tab filter reflects the edits */
await p.locator('nav.tabs button[data-tab="notes"]').click(); await p.waitForTimeout(300);
const opts = await p.locator('#nstatus option').allTextContents();
ok('status filter reflects the library', opts.includes('Client review') && !opts.includes("Won't do"),
   opts.join(' | '));

ok('no console errors', errs.length === 0, errs.slice(0,3).join(' | '));
console.log('\n' + check.join('\n'));
const fails = check.filter(x => x.startsWith('❌'));
console.log(`\n${check.length-fails.length}/${check.length} passed`);
await b.close(); srv.close();
process.exit(fails.length?1:0);
