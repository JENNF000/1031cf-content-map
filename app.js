/* 1031CF Content Map — v2 app (fresh build 2026-08-23).
   Board: 14 clusters × 4 tiers (Transactional / Pillar / Fan-out / Redirect).
   data.json is machine-owned; annotations.json is Jennifer's and merges over it. */
'use strict';

/* ============================== constants ============================== */
const TIERS = ['transactional', 'pillar', 'fanout', 'redirect'];
const TIERNAME = { transactional: 'Transactional', pillar: 'Pillar', fanout: 'Fan-out', redirect: 'Redirect' };
/* Muted, institutional chip palette. Named keys are the seeded defaults; a
   custom color picked in Manage is stored as a raw hex — colorOf() takes both. */
const COLORS = { slate:'#68727d', amber:'#9a6700', red:'#b23636', green:'#20713a', blue:'#2b5f9e',
                 purple:'#5f4bb6', teal:'#1b7c83', pink:'#a84c72' };
const colorOf = c => COLORS[c] || (typeof c === 'string' && c[0] === '#' ? c : COLORS.slate);
const PAGE_FIELDS = ['status', 'labels', 'target', 'cluster', 'tier', 'offFlags'];
const DEFAULT_STATUSES = [
  { id:'none', name:'No status', color:'slate', fixed:true, o:-1 },
  { id:'todo', name:'To do', color:'slate', o:0 },
  { id:'inprogress', name:'In progress', color:'amber', o:1 },
  { id:'drafted', name:'Drafted', color:'purple', o:2 },
  { id:'published', name:'Published', color:'green', o:3 },
  { id:'monitoring', name:'Monitoring', color:'blue', o:4 },
  { id:'blocked', name:'Blocked', color:'red', o:5 },
  { id:'wontdo', name:"Won't do", color:'slate', o:6 },
];
const DEFAULT_LABELS = [
  { id:'rewrite', name:'Rewrite', color:'amber' },
  { id:'refresh', name:'Refresh content', color:'amber' },
  { id:'titlemeta', name:'Title / meta', color:'amber' },
  { id:'schema', name:'Add schema', color:'purple' },
  { id:'aeo-answer', name:'AEO: direct answer', color:'teal' },
  { id:'aeo-faq', name:'AEO: FAQ block', color:'teal' },
  { id:'intlinks', name:'Internal links', color:'blue' },
  { id:'eeat', name:'E-E-A-T / author', color:'purple' },
  { id:'needs301', name:'Needs 301', color:'red' },
  { id:'keep', name:'Keep as-is', color:'green' },
  { id:'priority', name:'Priority', color:'pink' },
  /* derived from build flags — outlined rendering, still editable */
  { id:'consolidate', name:'Consolidate', color:'red', derived:true },
  { id:'slug', name:'Slug fix', color:'amber', derived:true },
  { id:'underperform', name:'Underperformer', color:'pink', derived:true },
  { id:'nokw', name:'No keywords', color:'slate', derived:true },
  { id:'newpage', name:'New (no data yet)', color:'blue', derived:true },
  { id:'redirect', name:'301 redirect', color:'blue', derived:true },
];
const INTENTS = [['trans','Transactional'],['comm','Commercial'],['info','Informational']];
/* Editorial calendar vocabularies (her spec, 8/23) */
const CAL_STATUSES = [['outline','Outline','slate'],['draft','Draft','amber'],['queue','In queue in WP','blue'],['published','Published','green']];
const CAL_TYPES = [['new','New'],['rewrite','Rewrite'],['consolidate','Consolidate']];

/* ============================== tiny utils ============================== */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowISO = () => new Date().toISOString();
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'c' + Math.random().toString(36).slice(2) + Date.now());
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ============================== storage ============================== */
const Store = (() => {
  let db = null, useLS = false;
  const open = () => new Promise(res => {
    let rq;
    try { rq = indexedDB.open('cm2', 1); } catch (e) { useLS = true; return res(); }
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => { db = rq.result; res(); };
    rq.onerror = () => { useLS = true; res(); };
  });
  const get = k => new Promise(res => {
    if (useLS || !db) { try { const v = localStorage.getItem('cm2:' + k); res(v ? JSON.parse(v) : null); } catch (e) { res(null); } return; }
    const t = db.transaction('kv').objectStore('kv').get(k);
    t.onsuccess = () => res(t.result == null ? null : t.result); t.onerror = () => res(null);
  });
  const set = (k, v) => new Promise(res => {
    if (useLS || !db) { try { localStorage.setItem('cm2:' + k, JSON.stringify(v)); } catch (e) {} return res(); }
    const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    t.onsuccess = () => res(); t.onerror = () => res();
  });
  return { open, get, set };
})();

/* ============================== annotations ============================== */
let DATA = null;      // machine build (never mutated)
let ANN = null;       // hers
let PAGE = {};        // path -> page record from DATA

function blankAnn() {
  return { version: 2, updated: nowISO(), author: 'Jennifer',
    statuses: JSON.parse(JSON.stringify(DEFAULT_STATUSES)),
    labels: JSON.parse(JSON.stringify(DEFAULT_LABELS)),
    hidden: [], hiddenAt: '', hiddenS: [], hiddenSAt: '', pages: {}, live: {},
    cal: [], calDel: [] };
}
function normAnn(a) {
  if (!a || typeof a !== 'object') return blankAnn();
  a.version = 2;
  a.statuses = (a.statuses && a.statuses.length) ? a.statuses : JSON.parse(JSON.stringify(DEFAULT_STATUSES));
  if (!a.statuses.some(s => s.id === 'none')) a.statuses.unshift(JSON.parse(JSON.stringify(DEFAULT_STATUSES[0])));
  a.labels = (a.labels && a.labels.length) ? a.labels : JSON.parse(JSON.stringify(DEFAULT_LABELS));
  // seed any missing defaults (new derived ids like newpage) without clobbering hers
  for (const d of DEFAULT_LABELS) if (!a.labels.some(l => l.id === d.id) && !(a.hidden||[]).includes(d.id)) a.labels.push(JSON.parse(JSON.stringify(d)));
  for (const d of DEFAULT_STATUSES) if (d.id==='none' && !a.statuses.some(s=>s.id==='none')) a.statuses.unshift(JSON.parse(JSON.stringify(d)));
  a.hidden = a.hidden || []; a.hiddenS = a.hiddenS || [];
  a.pages = a.pages || {}; a.live = a.live || {};
  a.cal = a.cal || []; a.calDel = a.calDel || [];
  for (const p of Object.values(a.pages)) {
    p.comments = p.comments || []; p.delc = p.delc || []; p.f = p.f || {};
    p.labels = p.labels || []; p.offFlags = p.offFlags || [];
    if (p.status == null) p.status = ''; if (p.cluster == null) p.cluster = '';
    if (p.tier == null) p.tier = ''; if (p.target == null) p.target = '';
  }
  return a;
}
/* ---- merge (field-level LWW; see project notes — do not simplify) ---- */
function fieldStamp(e, f) {
  if (e.f && e.f[f]) return e.f[f];
  const has = f === 'labels' || f === 'offFlags' ? (e[f] && e[f].length) : !!e[f];
  return has ? (e.updated || '') : '';
}
function mergePages(a, b) {
  const out = {};
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[path], y = b[path];
    if (!x || !y) { out[path] = JSON.parse(JSON.stringify(x || y)); continue; }
    const m = { comments: [], delc: [...new Set([...(x.delc||[]), ...(y.delc||[])])], f: {}, updated: (x.updated||'') > (y.updated||'') ? x.updated : y.updated };
    const seen = new Set();
    for (const c of [...(x.comments||[]), ...(y.comments||[])]) if (!seen.has(c.id) && !m.delc.includes(c.id)) { seen.add(c.id); m.comments.push(c); }
    m.comments.sort((p, q) => (p.ts||'') < (q.ts||'') ? -1 : 1);
    for (const f of PAGE_FIELDS) {
      const sx = fieldStamp(x, f), sy = fieldStamp(y, f);
      const w = sy > sx ? y : x;
      m[f] = JSON.parse(JSON.stringify(w[f] == null ? (f==='labels'||f==='offFlags'?[]:'') : w[f]));
      const s = sy > sx ? sy : sx; if (s) m.f[f] = s;
    }
    out[path] = m;
  }
  return out;
}
function unionById(a, b) {
  const map = new Map();
  for (const e of [...(a||[]), ...(b||[])]) {
    const prev = map.get(e.id);
    if (!prev) map.set(e.id, JSON.parse(JSON.stringify(e)));
    else if ((e.u||'') > (prev.u||'')) map.set(e.id, JSON.parse(JSON.stringify(e)));
  }
  return [...map.values()];
}
function mergeAnn(a, b) {
  a = normAnn(JSON.parse(JSON.stringify(a))); b = normAnn(JSON.parse(JSON.stringify(b)));
  const m = blankAnn();
  m.updated = (a.updated||'') > (b.updated||'') ? a.updated : b.updated;
  m.statuses = unionById(a.statuses, b.statuses);
  m.labels = unionById(a.labels, b.labels);
  const hA = (a.hiddenAt||''), hB = (b.hiddenAt||'');
  m.hidden = hB > hA ? b.hidden : a.hidden; m.hiddenAt = hB > hA ? hB : hA;
  const sA = (a.hiddenSAt||''), sB = (b.hiddenSAt||'');
  m.hiddenS = sB > sA ? b.hiddenS : a.hiddenS; m.hiddenSAt = sB > sA ? sB : sA;
  m.pages = mergePages(a.pages, b.pages);
  m.calDel = [...new Set([...(a.calDel || []), ...(b.calDel || [])])];
  m.cal = unionById(a.cal, b.cal).filter(e => !m.calDel.includes(e.id));
  m.live = {};
  for (const k of new Set([...Object.keys(a.live), ...Object.keys(b.live)])) {
    const x = a.live[k], y = b.live[k];
    m.live[k] = (!x) ? y : (!y) ? x : ((y.at||'') > (x.at||'') ? y : x);
  }
  return m;
}
/* ---- effective values — every view reads THESE ---- */
const isHiddenL = id => (ANN.hidden||[]).includes(id);
const isHiddenS = id => (ANN.hiddenS||[]).includes(id);
const annOf = path => ANN.pages[path];
const liveOverride = path => (ANN.live[path] || {}).s || '';
function effTier(p) {
  const lo = liveOverride(p.path);
  const e = annOf(p.path);
  if (lo === 'redirect') return 'redirect';
  if (p.tier === 'redirect' && lo !== 'live') return 'redirect';
  return (e && e.tier) || (p.tier === 'redirect' ? 'fanout' : p.tier);
}
function effCat(p) { const e = annOf(p.path); return (e && e.cluster && DATA.cats.includes(e.cluster)) ? e.cluster : p.cat; }
function effLabels(p) {
  const e = annOf(p.path) || {};
  const off = new Set(e.offFlags || []);
  const out = [];
  const t = effTier(p);
  const buildFlags = t === 'redirect' ? ['redirect'] : (p.flags || []).filter(f => f !== 'redirect');
  for (const f of buildFlags) if (!off.has(f) && !isHiddenL(f)) out.push(f);
  for (const l of (e.labels || [])) if (!isHiddenL(l) && !out.includes(l)) out.push(l);
  return out;
}
function statusChanged(p) {
  const lo = liveOverride(p.path);
  return lo && ((lo === 'redirect') !== (p.tier === 'redirect'));
}
function labelDef(id) { return ANN.labels.find(l => l.id === id); }
function visibleStatuses(withNone) {
  return ANN.statuses.filter(s => !isHiddenS(s.id) && (withNone || s.id !== 'none')).sort((a, b) => (a.o||0) - (b.o||0));
}
function liveStats() {
  const s = { total:0, redirects:0, keywords:0, traffic:0, ranking:0, byTier:{transactional:0,pillar:0,fanout:0,redirect:0} };
  for (const p of DATA.pages) {
    const t = effTier(p);
    s.byTier[t]++;
    if (t === 'redirect') { s.redirects++; continue; }
    s.total++; s.keywords += p.kw; s.traffic += p.traffic; if (p.kw > 0) s.ranking++;
  }
  return s;
}

/* ============================== persistence + sync ============================== */
let SYNC = { token:'', owner:'', repo:'', sha:null, state:'off', queued:false, busy:false };
async function saveAnnLocal() { await Store.set('ann', ANN); }
const pushSoon = debounce(() => Sync.push(), 1200);
function annChanged() {
  ANN.updated = nowISO();
  saveAnnLocal();
  if (SYNC.token) pushSoon();
  if (window.onAnnotationsChanged) window.onAnnotationsChanged();
}
const Sync = {
  api(path, opts) {
    return fetch('https://api.github.com/repos/' + SYNC.owner + '/' + SYNC.repo + '/contents/' + path, Object.assign({
      headers: { Authorization: 'Bearer ' + SYNC.token, Accept: 'application/vnd.github+json' } }, opts || {}));
  },
  async pullPublished() { // public read — no token needed
    try {
      const r = await fetch('annotations.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return false;
      const remote = await r.json();
      if (remote && remote.pages) { ANN = mergeAnn(ANN, remote); await saveAnnLocal(); return true; }
    } catch (e) {}
    return false;
  },
  async push(retry) {
    if (!SYNC.token || SYNC.busy) { SYNC.queued = !!SYNC.token; return; }
    SYNC.busy = true; setSyncChip('saving…');
    try {
      const g = await this.api('annotations.json?ref=main');
      let sha = null;
      if (g.ok) {
        const j = await g.json(); sha = j.sha;
        try { const remote = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g, ''))))); ANN = mergeAnn(ANN, remote); } catch (e) {}
      }
      const body = JSON.stringify(ANN, null, 1);
      const put = await this.api('annotations.json', { method:'PUT', body: JSON.stringify({
        message: 'annotations: ' + ANN.updated, branch: 'main', sha: sha || undefined,
        content: btoa(unescape(encodeURIComponent(body))) }) });
      if (put.status === 409 || put.status === 422) { if (!retry) { SYNC.busy = false; return this.push(true); } }
      if (put.ok) { setSyncChip('synced'); await saveAnnLocal(); if (window.onAnnotationsChanged) window.onAnnotationsChanged(); }
      else if (put.status === 401 || put.status === 403) setSyncChip('bad token');
      else setSyncChip('offline — queued');
    } catch (e) { SYNC.queued = true; setSyncChip('offline — queued'); }
    SYNC.busy = false;
    if (SYNC.queued) { SYNC.queued = false; pushSoon(); }
  },
};
function setSyncChip(t) { $('#chip-sync').textContent = 'Sync: ' + (t || (SYNC.token ? 'on' : 'off')); }

/* ============================== boot ============================== */
let TAB = 'map';
const FILTER = { q:'', cluster:'', tier:'', status:'', label:'', notes:'', compact:false };
async function boot() {
  await Store.open();
  const [annL, dataL, syncL] = [await Store.get('ann'), await Store.get('data'), await Store.get('sync')];
  if (syncL) Object.assign(SYNC, syncL, { busy:false, queued:false });
  let dataR = null;
  try { const r = await fetch('data.json?ts=' + Date.now(), { cache:'no-store' }); if (r.ok) dataR = await r.json(); } catch (e) {}
  DATA = dataR || dataL;
  if (!DATA) { $('#main').innerHTML = '<p style="padding:30px">Could not load data.json (offline and no cached copy yet). Connect once, then the app works offline.</p>'; return; }
  if (dataR) Store.set('data', dataR);
  PAGE = {}; for (const p of DATA.pages) PAGE[p.path] = p;
  ANN = normAnn(annL || blankAnn());
  if (!annL) { await Sync.pullPublished(); }         // first run on a device: adopt published notes
  else Sync.pullPublished().then(ok => { if (ok) redraw(); });
  setSyncChip(); updateChips();
  renderTabs(); redraw();
  // Any annotation change (local edit, library edit, sync merge) redraws the
  // views AND an open drawer — unless a modal is up or she's typing in a field.
  window.onAnnotationsChanged = () => { updateChips(); redraw(); refreshDrawer(); };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting) showUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(reg); });
      });
    }).catch(() => {});
  }
  $('#btn-refresh').addEventListener('click', doRefresh);
  $('#btn-sync').addEventListener('click', syncModal);
  $('#btn-check').addEventListener('click', checkRedirectsModal);
  $('#chip-redir').addEventListener('click', checkRedirectsModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeModal(); if (DRAG.active) endDrag(true); } });
}
function showUpdate(reg) {
  $('#updatebar').classList.remove('hidden');
  $('#btn-reload').onclick = () => { (reg.waiting || {}).postMessage && reg.waiting.postMessage('skip'); setTimeout(() => location.reload(), 250); };
}
function daysAgo(iso) { if (!iso) return 999; return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); }
function updateChips() {
  $('#chip-data').textContent = 'Data as of ' + (DATA.stats.generated || '—');
  if (DATA.stats.partial) $('#chip-data').classList.add('amber');
  const at = Object.values(ANN.live).map(v => v.at).sort().pop() || DATA.stats.crawl_date + 'T00:00:00Z';
  const d = daysAgo(at);
  const el = $('#chip-redir');
  el.textContent = 'Redirects checked ' + (d <= 0 ? 'today' : d + 'd ago');
  el.classList.toggle('amber', d > 7);
}
async function doRefresh() {
  const b = $('#btn-refresh'); b.classList.add('spin'); b.disabled = true;
  let msg = 'Nothing newer published. Shipped redirects since? Use Check redirects.';
  try {
    const r = await fetch('data.json?ts=' + Date.now(), { cache:'no-store' });
    if (r.ok) {
      const fresh = await r.json();
      if (fresh.stats.generated !== DATA.stats.generated) { msg = 'Updated to build of ' + fresh.stats.generated + '.'; }
      DATA = fresh; PAGE = {}; for (const p of DATA.pages) PAGE[p.path] = p;
      Store.set('data', fresh);
    } else msg = 'Could not reach the published data (HTTP ' + r.status + ').';
  } catch (e) { msg = 'Offline — showing the cached build.'; }
  await Sync.pullPublished();
  updateChips(); redraw(); toast(msg);
  b.classList.remove('spin'); b.disabled = false;
}

/* ============================== chrome: tabs, toast, tooltip ============================== */
function calEntries() { return (ANN.cal || []).filter(e => !(ANN.calDel || []).includes(e.id)); }
function renderTabs() {
  const t = [['map','Topic map'],['cal','Editorial calendar'],['pages','All pages'],['insights','Audit insights'],['redirects','Redirects'],['notes','My notes']];
  $('#tabs').innerHTML = t.map(([id, name]) => {
    let n = '';
    if (id === 'insights') n = '<span class="n">' + DATA.insights.filter(i => ['critical','serious'].includes(i.sev)).length + '</span>';
    if (id === 'redirects') n = '<span class="n">' + liveStats().byTier.redirect + '</span>';
    if (id === 'cal' && calEntries().length) n = '<span class="n">' + calEntries().length + '</span>';
    return '<button data-tab="' + id + '" class="' + (TAB === id ? 'on' : '') + '">' + name + n + '</button>';
  }).join('');
  $$('#tabs button').forEach(b => b.addEventListener('click', () => { TAB = b.dataset.tab; renderTabs(); redraw(); }));
}
let toastT = null;
function toast(msg, undo) {
  $$('.toast').forEach(e => e.remove());
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button>Undo</button>' : '');
  if (undo) $('button', el).addEventListener('click', () => { undo(); el.remove(); });
  document.body.appendChild(el);
  clearTimeout(toastT); toastT = setTimeout(() => el.remove(), undo ? 6000 : 3500);
}
/* tooltip */
const tipEl = () => { let e = $('#tooltip'); if (!e) { e = document.createElement('div'); e.id = 'tooltip'; document.body.appendChild(e); } return e; };
function tipHTML(p) {
  const e = annOf(p.path) || {};
  const intents = INTENTS.filter(([k]) => p[k] > 0).map(([k, n]) => n + ' ' + p[k]).join(' · ') || (p.kw ? '—' : '');
  let rows;
  if (p.no_metrics) rows = '<tr><td colspan="2" class="nodata">No SEMrush data yet — new or never-ranking page. Next refresh with API units will fill this in.</td></tr>';
  else rows = [
    ['Keywords', fmt(p.kw)],
    ['Top keyword', p.pkw ? esc(p.pkw) : '—'],
    ['Est. traffic / mo', fmt(p.traffic)],
    ['Volume (top kw)', p.pkw ? fmt(p.vol) : '—'],
    ['Position (top kw)', p.pos != null ? '#' + p.pos : '—'],
    ['Intent (positions)', intents || '—'],
  ].map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('');
  const extra = [];
  if (p.pkw_stale && !p.no_metrics) extra.push('Top keyword / position from Aug 3 pull (not re-pulled — API units).');
  if (p.tier === 'redirect') extra.push('301 → ' + p.redirects_to);
  if (statusChanged(p)) extra.push('Redirect status changed by you (' + (liveOverride(p.path) === 'redirect' ? 'now redirects' : 'marked live') + ').');
  if (e.target) extra.push('Target: ' + esc(e.target));
  return '<div class="t">' + esc(p.label) + '</div><table>' + rows + '</table>' +
    (extra.length ? '<div class="stale">' + extra.map(esc).join('<br>') + '</div>' : '');
}
function bindTips(root) {
  $$('[data-tip]', root).forEach(el => {
    el.addEventListener('mouseenter', () => {
      const p = PAGE[el.dataset.tip]; if (!p || DRAG.active) return;
      const t = tipEl(); t.innerHTML = tipHTML(p); t.style.display = 'block';
      const r = el.getBoundingClientRect();
      t.style.left = Math.min(window.innerWidth - t.offsetWidth - 10, Math.max(8, r.left)) + 'px';
      t.style.top = (r.bottom + 8 + t.offsetHeight > window.innerHeight ? r.top - t.offsetHeight - 8 : r.bottom + 8) + 'px';
    });
    el.addEventListener('mouseleave', () => { tipEl().style.display = 'none'; });
  });
}

/* ============================== views ============================== */
function redraw() {
  tipEl().style.display = 'none';
  const m = $('#main');
  if (TAB === 'map') m.innerHTML = viewMap();
  else if (TAB === 'cal') m.innerHTML = viewCal();
  else if (TAB === 'pages') m.innerHTML = viewPages();
  else if (TAB === 'insights') m.innerHTML = viewInsights();
  else if (TAB === 'redirects') m.innerHTML = viewRedirects();
  else m.innerHTML = viewNotes();
  wire(m);
  renderTabs();
}
function pageMatches(p) {
  const e = annOf(p.path) || {};
  if (FILTER.q) {
    const q = FILTER.q.toLowerCase();
    if (!(p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) || (p.pkw || '').toLowerCase().includes(q) || (e.target || '').toLowerCase().includes(q))) return false;
  }
  if (FILTER.cluster && effCat(p) !== FILTER.cluster) return false;
  if (FILTER.tier && effTier(p) !== FILTER.tier) return false;
  if (FILTER.status && (e.status || 'none') !== FILTER.status) return false;
  if (FILTER.label && !effLabels(p).includes(FILTER.label)) return false;
  if (FILTER.notes === 'any' && !(e.status || (e.labels||[]).length || (e.comments||[]).filter(c=>!(e.delc||[]).includes(c.id)).length || e.target || e.cluster || e.tier)) return false;
  if (FILTER.notes === 'comments' && !((e.comments||[]).filter(c=>!(e.delc||[]).includes(c.id)).length)) return false;
  if (FILTER.notes === 'nodata' && !p.no_metrics) return false;
  if (FILTER.notes === 'moved' && !((e.cluster && e.cluster !== p.cat) || (e.tier && e.tier !== p.tier) || statusChanged(p))) return false;
  return true;
}
function toolbarHTML(hideTier) {
  const statuses = visibleStatuses(true);
  const labels = ANN.labels.filter(l => !isHiddenL(l.id));
  return '<div class="toolbar">' +
    '<input type="search" id="f-q" placeholder="Search pages, slugs, keywords…" value="' + esc(FILTER.q) + '">' +
    '<select id="f-cluster"><option value="">All clusters</option>' + DATA.cats.map(c => '<option ' + (FILTER.cluster === c ? 'selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
    (hideTier ? '' : '<select id="f-tier"><option value="">All tiers</option>' + TIERS.map(t => '<option value="' + t + '" ' + (FILTER.tier === t ? 'selected' : '') + '>' + TIERNAME[t] + '</option>').join('') + '</select>') +
    '<select id="f-status"><option value="">Any status</option>' + statuses.map(s => '<option value="' + s.id + '" ' + (FILTER.status === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>' +
    '<select id="f-label"><option value="">Any label</option>' + labels.map(l => '<option value="' + l.id + '" ' + (FILTER.label === l.id ? 'selected' : '') + '>' + esc(l.name) + (l.derived ? ' (auto)' : '') + '</option>').join('') + '</select>' +
    '<select id="f-notes"><option value="">Everything</option><option value="any" ' + (FILTER.notes === 'any' ? 'selected' : '') + '>Any of my notes</option><option value="comments" ' + (FILTER.notes === 'comments' ? 'selected' : '') + '>Has comments</option><option value="moved" ' + (FILTER.notes === 'moved' ? 'selected' : '') + '>Pages I moved / re-checked</option><option value="nodata" ' + (FILTER.notes === 'nodata' ? 'selected' : '') + '>No data yet</option></select>' +
    '<label class="tog"><input type="checkbox" id="f-compact" ' + (FILTER.compact ? 'checked' : '') + '> Compact</label>' +
    '<span class="count" id="f-count"></span></div>';
}
function statusPill(p) {
  const e = annOf(p.path); if (!e || !e.status || isHiddenS(e.status)) return '';
  const s = ANN.statuses.find(x => x.id === e.status); if (!s) return '';
  return '<span class="spill" style="background:' + colorOf(s.color) + '">' + esc(s.name) + '</span>';
}
function labelPills(p, max) {
  const ids = effLabels(p);
  return ids.slice(0, max).map(id => {
    const d = labelDef(id); if (!d) return '';
    return d.derived
      ? '<span class="apill auto-l" style="color:' + colorOf(d.color) + '">' + esc(d.name) + '</span>'
      : '<span class="apill mine" style="background:' + colorOf(d.color) + '">' + esc(d.name) + '</span>';
  }).join('') + (ids.length > max ? '<span class="apill auto-l" style="color:#64748b">+' + (ids.length - max) + '</span>' : '');
}
function cellHTML(p) {
  const e = annOf(p.path) || {};
  const nc = (e.comments || []).filter(c => !(e.delc || []).includes(c.id)).length;
  const t = effTier(p);
  const kwn = p.no_metrics ? '<span class="kwn">·no data</span>' : (p.kw ? '<span class="kwn">' + fmt(p.kw) + ' kw</span>' : '');
  return '<a class="cell' + (t === 'redirect' ? ' redir-cell' : '') + '" href="' + esc(p.url) + '" target="_blank" rel="noopener" data-drag="' + esc(p.path) + '" data-tip="' + esc(p.path) + '">' +
    esc(p.label) + kwn + (nc ? ' <span class="cmt">💬' + nc + '</span>' : '') +
    (t === 'redirect' ? '<span class="to">→ ' + esc((liveOverride(p.path) === 'redirect' && !p.redirects_to) ? '(marked by you)' : p.redirects_to || '') + '</span>' : '') +
    '<span class="pills">' + statusPill(p) + labelPills(p, 3) + '</span>' +
    '<button class="edit" data-open="' + esc(p.path) + '" title="Open details">✎</button></a>';
}
function viewMap() {
  const s = liveStats();
  const tiles =
    '<div class="tiles">' +
    '<div class="tile"><div class="v">' + fmt(s.total) + '</div><div class="l">Live pages</div></div>' +
    '<div class="tile"><div class="v">' + fmt(s.keywords) + '</div><div class="l">Ranking keywords</div></div>' +
    '<div class="tile"><div class="v">' + fmt(s.traffic) + '</div><div class="l">Est. monthly visits</div></div>' +
    '</div>';
  const strip = DATA.stats.partial ? '<div class="note-strip">⚠ ' + esc(DATA.stats.partial) + '</div>' : '';
  let cols = '';
  for (const c of DATA.cats) {
    const inCat = DATA.pages.filter(p => effCat(p) === c);
    const kw = inCat.filter(p => effTier(p) !== 'redirect').reduce((a, p) => a + p.kw, 0);
    let bands = '';
    for (const t of TIERS) {
      const all = inCat.filter(p => effTier(p) === t).sort((a, b) => b.kw - a.kw || (a.path < b.path ? -1 : 1));
      const vis = all.filter(pageMatches);
      bands += '<div class="band b-' + t + '" data-drop="' + esc(c) + '|' + t + '"><div class="bh"><span>' + TIERNAME[t] + '</span><span class="bn">' + all.length + '</span></div>' +
        '<div class="cells">' + vis.map(cellHTML).join('') + '</div></div>';
    }
    cols += '<div class="col"><div class="head" data-drop="' + esc(c) + '|">' + esc(c) + ' <span class="k">' + fmt(kw) + ' kw</span></div>' + bands + '</div>';
  }
  return strip + tiles + toolbarHTML() + '<div id="matrix">' + cols + '</div>' +
    '<p class="intro">Hover a page for its SEMrush metrics. Drag a card between clusters or tiers to re-categorize (long-press on touch), or use ✎ for the full editor. Counts on each band are the full count for that tier; search and filters hide cards without changing counts.</p>';
}
function intentTop(p) {
  const parts = INTENTS.map(([k, n]) => [n, p[k]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  return parts.length ? parts[0][0] : '—';
}
let SORT = { k:'kw', dir:-1 };
function viewPages() {
  const rows = DATA.pages.filter(pageMatches).sort((a, b) => {
    let va, vb;
    if (SORT.k === 'path') { va = a.path; vb = b.path; }
    else if (SORT.k === 'cat') { va = effCat(a); vb = effCat(b); }
    else if (SORT.k === 'tier') { va = TIERS.indexOf(effTier(a)); vb = TIERS.indexOf(effTier(b)); }
    else if (SORT.k === 'pkw') { va = a.pkw || ''; vb = b.pkw || ''; }
    else { va = a[SORT.k] || 0; vb = b[SORT.k] || 0; }
    return (va < vb ? -1 : va > vb ? 1 : 0) * SORT.dir;
  });
  const th = (k, n, num) => '<th class="' + (num ? 'num' : '') + '" data-sort="' + k + '">' + n + (SORT.k === k ? (SORT.dir < 0 ? ' ▾' : ' ▴') : '') + '</th>';
  return toolbarHTML() +
    '<div style="margin:-4px 0 10px"><button class="btn sub" id="btn-csv">Export CSV</button></div>' +
    '<div class="tablewrap"><table class="grid"><thead><tr>' +
    th('path', 'Page') + th('cat', 'Cluster') + th('tier', 'Tier') +
    th('kw', 'Keywords', 1) + th('traffic', 'Est. traffic', 1) + th('pkw', 'Top keyword') + th('vol', 'Volume', 1) + th('pos', 'Position', 1) +
    '<th>Intent</th><th>Status / labels</th>' +
    '</tr></thead><tbody>' +
    rows.map(p => {
      const t = effTier(p);
      return '<tr><td><a href="#" data-open="' + esc(p.path) + '">' + esc(p.label) + '</a><div class="mini">' + esc(p.path) + '</div></td>' +
      '<td>' + esc(effCat(p)) + '</td><td><span class="badge tier-' + t + '">' + TIERNAME[t] + '</span>' + (t === 'redirect' && p.redirects_to ? '<div class="mini">→ ' + esc(p.redirects_to) + '</div>' : '') + '</td>' +
      (p.no_metrics ? '<td colspan="5" class="mini">no SEMrush data yet</td>' :
        '<td class="num">' + fmt(p.kw) + '</td><td class="num">' + fmt(p.traffic) + '</td><td>' + esc(p.pkw || '—') + (p.pkw_stale && p.pkw ? ' <span class="badge stale" title="top keyword/position from Aug 3">Aug 3</span>' : '') + '</td><td class="num">' + (p.pkw ? fmt(p.vol) : '—') + '</td><td class="num">' + (p.pos != null ? p.pos : '—') + '</td>') +
      '<td>' + (p.no_metrics ? '—' : intentTop(p)) + '</td><td>' + statusPill(p) + ' ' + labelPills(p, 4) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function viewInsights() {
  const sevRank = { critical:0, serious:1, warning:2, info:3, ok:4 };
  const ins = [...DATA.insights].sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);
  let html = '<p class="intro">Findings from the ' + esc(DATA.stats.vintages.crawl) + '. Regenerated on every crawl; your labels and statuses live on top and survive refreshes.</p>';
  html += ins.map(i => '<div class="insight ' + i.sev + '"><span class="sev">' + i.sev + '</span><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p>' +
    (i.items ? '<ul>' + i.items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + '</div>').join('');
  html += '<h2 style="font-size:16px;margin:22px 0 10px">Consolidation groups (' + DATA.groups.filter(g => g.sev !== 'resolved').length + ' open)</h2>';
  const gRank = { critical:0, serious:1, warning:2, partial:3, resolved:4 };
  html += [...DATA.groups].sort((a, b) => gRank[a.sev] - gRank[b.sev]).map(g => {
    const tag = u => u === g.keep ? '<span class="tag keep">KEEP</span>' : g.redirected.includes(u) ? '<span class="tag done">301 ✓</span>' : (g.gone||[]).includes(u) ? '<span class="tag gone">404</span>' : '<span class="tag live">LIVE</span>';
    return '<div class="group"><h4>' + esc(g.topic) + ' <span class="badge ' + (g.sev === 'resolved' ? 'tier-pillar' : g.sev === 'partial' ? 'tier-redirect' : 'soft') + '">' + g.sev + '</span></h4>' +
      '<div class="meta">' + esc(g.cat) + ' · "' + esc(g.kw) + '" (' + fmt(g.vol) + '/mo) · ' + g.still_live.length + ' still competing</div>' +
      '<div>' + g.urls.map(u => '<div class="u">' + tag(u) + '<a href="#" data-open="' + esc(u) + '">' + esc(u) + '</a></div>').join('') + '</div>' +
      '<p style="font-size:12.5px;color:#3d4a46;margin:6px 0 0">' + esc(g.note) + '</p></div>';
  }).join('');
  const slugs = DATA.slugs.filter(s => PAGE[s.url] && effTier(PAGE[s.url]) !== 'redirect');
  html += '<h2 style="font-size:16px;margin:22px 0 10px">Slug-update candidates (' + slugs.length + ' live)</h2>' +
    '<div class="tablewrap"><table class="grid"><thead><tr><th>URL</th><th>Ranking kw</th><th class="num">Vol</th><th>Suggested</th><th>Why</th></tr></thead><tbody>' +
    slugs.map(s => '<tr><td><a href="#" data-open="' + esc(s.url) + '">' + esc(s.url) + '</a></td><td>' + esc(s.kw) + '</td><td class="num">' + fmt(s.vol) + '</td><td><code style="font-size:12px">' + esc(s.suggest) + '</code></td><td style="font-size:12px">' + esc(s.reason) + '</td></tr>').join('') +
    '</tbody></table></div>';
  return html;
}
function viewRedirects() {
  const manual = Object.entries(ANN.live).filter(([path, v]) => v.s === 'redirect' && !(PAGE[path] && PAGE[path].tier === 'redirect'));
  const rows = DATA.redirects.map(r => ({ ...r, manual:false }))
    .concat(manual.map(([path, v]) => ({ old: path, to: '(not verified yet — the next crawl records the destination)', cat: PAGE[path] ? effCat(PAGE[path]) : '—', kw_old: PAGE[path] ? PAGE[path].kw : 0, pkw_old: PAGE[path] ? PAGE[path].pkw : null, kw_new: null, pkw_new: null, to_listing:false, in_sitemap: PAGE[path] ? PAGE[path].in_sitemap : false, manual:true, at: v.at })))
    .filter(r => !FILTER.q || r.old.includes(FILTER.q.toLowerCase()) || (r.to || '').includes(FILTER.q.toLowerCase()))
    .filter(r => !FILTER.cluster || r.cat === FILTER.cluster);
  const relive = Object.entries(ANN.live).filter(([path, v]) => v.s === 'live' && PAGE[path] && PAGE[path].tier === 'redirect');
  return '<p class="intro">Every verified redirect: <b>' + DATA.redirects.length + '</b> confirmed server-level 301/302s from the ' + esc(DATA.stats.crawl_date) + ' same-origin crawl' + (manual.length ? ', plus <b>' + manual.length + '</b> you marked by hand since' : '') + '. Keyword columns show what SEMrush still credits to each URL (old URL keywords normally migrate to the target within weeks of a correct 301). KW data: ' + esc(DATA.stats.vintages.semrush_pages.split(' — ')[0]) + '.</p>' +
    toolbarHTML(true) +
    '<div class="tablewrap"><table class="grid"><thead><tr><th>Old slug</th><th>Redirects to</th><th>Cluster</th><th class="num">KW on old URL</th><th>Top kw (old)</th><th class="num">KW on target</th><th>Top kw (target)</th><th>Flags</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + (PAGE[r.old] ? '<a href="#" data-open="' + esc(r.old) + '">' + esc(r.old) + '</a>' : esc(r.old)) + '</td>' +
      '<td>' + esc(r.to) + '</td><td>' + esc(r.cat) + '</td>' +
      '<td class="num">' + fmt(r.kw_old) + '</td><td>' + esc(r.pkw_old || '—') + '</td>' +
      '<td class="num">' + (r.kw_new == null ? '—' : fmt(r.kw_new)) + '</td><td>' + esc(r.pkw_new || '—') + '</td>' +
      '<td>' + (r.to_listing ? '<span class="badge soft" title="redirects into a listing page — passes no topical relevance (soft-404 pattern)">soft-404</span> ' : '') +
      (r.in_sitemap ? '<span class="badge sm" title="this redirecting URL is still advertised in the sitemap">in sitemap</span> ' : '') +
      (r.manual ? '<span class="badge tier-redirect" title="marked by you, not yet verified by a crawl">yours · ' + esc((r.at || '').slice(0, 10)) + '</span>' : '') + '</td></tr>').join('') +
    '</tbody></table></div>' +
    (relive.length ? '<h3 style="font-size:14px;margin:16px 0 6px">Marked live by you (build says redirect)</h3>' + relive.map(([path]) => '<div class="u" style="font-size:13px"><span class="tag live">LIVE (yours)</span> <a href="#" data-open="' + esc(path) + '">' + esc(path) + '</a></div>').join('') : '');
}
function viewNotes() {
  const entries = DATA.pages.filter(p => { const e = annOf(p.path); return e && (e.status || (e.labels||[]).length || (e.comments||[]).filter(c => !(e.delc||[]).includes(c.id)).length || e.target || e.cluster || e.tier); });
  const orphans = Object.keys(ANN.pages).filter(path => !PAGE[path] && (() => { const e = ANN.pages[path]; return e.status || (e.labels||[]).length || (e.comments||[]).filter(c => !(e.delc||[]).includes(c.id)).length || e.target; })());
  const groups = visibleStatuses(true).map(s => ({ s, list: entries.filter(p => ((annOf(p.path)||{}).status || 'none') === s.id) })).filter(g => g.list.length);
  return '<p class="intro">' + entries.length + ' pages carry your notes (status, labels, placement, target keyword or comments). <button class="btn sub" id="btn-libs" style="padding:3px 10px;font-size:12px">Manage statuses &amp; labels</button></p>' +
    (groups.map(g => '<h3 style="font-size:14px;margin:14px 0 6px">' + esc(g.s.name) + ' <span class="mini">' + g.list.length + '</span></h3>' +
      g.list.map(p => { const e = annOf(p.path); const nc = (e.comments||[]).filter(c => !(e.delc||[]).includes(c.id));
        return '<div class="group" style="padding:9px 12px"><div class="u"><a href="#" data-open="' + esc(p.path) + '"><b>' + esc(p.label) + '</b></a> <span class="mini">' + esc(effCat(p)) + ' · ' + TIERNAME[effTier(p)] + '</span> ' + labelPills(p, 8) + '</div>' +
        (e.target ? '<div class="mini">Target: ' + esc(e.target) + '</div>' : '') +
        nc.map(c => '<div class="comment"><div class="m"><span>' + esc(c.author || '') + ' · ' + esc((c.ts||'').slice(0,10)) + '</span></div>' + esc(c.text) + '</div>').join('') + '</div>'; }).join('')).join('')) +
    (orphans.length ? '<h3 style="font-size:14px;margin:16px 0 6px">Notes on pages no longer in the inventory</h3>' + orphans.map(path => '<div class="u" style="font-size:13px"><span class="tag gone">not in inventory</span> <a href="#" data-open="' + esc(path) + '">' + esc(path) + '</a></div>').join('') : '');
}

/* ============================== editorial calendar ============================== */
const CALF = { q:'', status:'', type:'' };
const linkA = (u, text) => {
  if (!u) return '—';
  const href = /^https?:\/\//i.test(u) ? u : (u.startsWith('/') ? 'https://www.1031crowdfunding.com' + u : '');
  return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text || u) + ' ↗</a>' : esc(u);
};
const calStatusPill = id => {
  const s = CAL_STATUSES.find(x => x[0] === id);
  return s ? '<span class="spill" style="background:' + colorOf(s[2]) + '">' + esc(s[1]) + '</span>' : '—';
};
const fmtDate = d => {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  if (!y || !m) return d;
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] + ' ' + dd + ', ' + y;
};
const isIdea = e => e.bucket === 'idea';
function viewCal() {
  let all = calEntries();
  if (CALF.q) { const q = CALF.q.toLowerCase(); all = all.filter(e => ((e.topic||'') + ' ' + (e.kw||'') + ' ' + (e.url||'') + ' ' + (e.oldurl||'') + ' ' + (e.prompts||'')).toLowerCase().includes(q)); }
  if (CALF.type) all = all.filter(e => (e.types || []).includes(CALF.type));
  let ideas = all.filter(isIdea);
  let list = all.filter(e => !isIdea(e));
  if (CALF.status) list = list.filter(e => e.status === CALF.status);
  list.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : ((a.topic||'') < (b.topic||'') ? -1 : 1)));
  ideas.sort((a, b) => ((a.created||'') < (b.created||'') ? -1 : 1));
  const monthOf = e => e.date ? e.date.slice(0, 7) : '';
  const monthName = k => k ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4) : 'Unscheduled';
  let rows = '', lastMonth = null;
  for (const e of list) {
    const mk = monthOf(e);
    if (mk !== lastMonth) { rows += '<tr class="mrow"><td colspan="10" style="background:#f6f6f4;font-weight:650;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:#52514e">' + monthName(mk) + '</td></tr>'; lastMonth = mk; }
    const oldLinks = (e.oldurl || '').split(',').map(x => x.trim()).filter(Boolean).map(x => linkA(x)).join('<br>') || '—';
    rows += '<tr data-cal="' + e.id + '" style="cursor:pointer" title="Click to edit">' +
      '<td style="white-space:nowrap">' + (fmtDate(e.date) || '—') + '</td>' +
      '<td>' + calStatusPill(e.status) + '</td>' +
      '<td>' + ((e.types || []).map(tid => { const d = CAL_TYPES.find(x => x[0] === tid); return d ? '<span class="badge">' + d[1] + '</span>' : ''; }).join(' ') || '—') + '</td>' +
      '<td style="min-width:160px"><b>' + (esc(e.topic) || '—') + '</b></td>' +
      '<td>' + (e.kw ? esc(e.kw) + '<div class="mini">' + (e.vol ? 'vol ' + fmt(e.vol) : '') + (e.vol && e.kd ? ' · ' : '') + (e.kd ? 'KD ' + esc(e.kd) : '') + '</div>' : '—') + '</td>' +
      '<td style="max-width:220px"><span class="mini" title="' + esc(e.prompts || '') + '">' + esc((e.prompts || '').length > 90 ? e.prompts.slice(0, 90) + '…' : e.prompts || '—') + '</span></td>' +
      '<td>' + (e.gdoc ? linkA(e.gdoc, 'Google Doc') : '—') + '</td>' +
      '<td style="max-width:180px;word-break:break-all">' + linkA(e.url) + '</td>' +
      '<td style="max-width:180px;word-break:break-all">' + oldLinks + '</td>' +
      '<td style="white-space:nowrap">' + (fmtDate(e.lastpub) || '—') + '</td></tr>';
  }
  const ideaCards = ideas.map(e => {
    const meta = [e.kw ? esc(e.kw) + (e.vol ? ' · vol ' + fmt(e.vol) : '') + (e.kd ? ' · KD ' + esc(e.kd) : '') : '',
                  (e.types || []).map(tid => { const d = CAL_TYPES.find(x => x[0] === tid); return d ? d[1] : ''; }).filter(Boolean).join(' + ')]
      .filter(Boolean).join(' — ');
    const olds = (e.oldurl || '').split(',').map(x => x.trim()).filter(Boolean).map(x => linkA(x)).join(' · ');
    return '<div class="group" data-cal="' + e.id + '" style="padding:9px 12px;cursor:pointer" title="Click to edit">' +
      '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><b>' + (esc(e.topic) || '(untitled idea)') + '</b>' +
      (meta ? '<span class="mini">' + meta + '</span>' : '') +
      '<span style="margin-left:auto"><button class="btn sub" data-sched="' + e.id + '" style="padding:3px 12px;font-size:12px">Schedule ↑</button></span></div>' +
      (e.prompts ? '<div class="mini">' + esc(e.prompts.length > 120 ? e.prompts.slice(0, 120) + '…' : e.prompts) + '</div>' : '') +
      (olds ? '<div class="mini">Old: ' + olds + '</div>' : '') + '</div>';
  }).join('');
  return '<p class="intro">Plan pieces here; each row is fully editable (click it). Entries live in your notes file, so they sync across devices and survive data refreshes. <b>' + calEntries().filter(e => !isIdea(e)).length + '</b> scheduled · <b>' + calEntries().filter(isIdea).length + '</b> ideas.</p>' +
    '<div class="toolbar">' +
    '<button class="btn" id="cal-new">+ New entry</button>' +
    '<input type="search" id="cal-q" placeholder="Search topic, keyword, URL…" value="' + esc(CALF.q) + '">' +
    '<select id="cal-status"><option value="">Any status</option>' + CAL_STATUSES.map(s => '<option value="' + s[0] + '" ' + (CALF.status === s[0] ? 'selected' : '') + '>' + s[1] + '</option>').join('') + '</select>' +
    '<select id="cal-type"><option value="">Any type</option>' + CAL_TYPES.map(t => '<option value="' + t[0] + '" ' + (CALF.type === t[0] ? 'selected' : '') + '>' + t[1] + '</option>').join('') + '</select>' +
    '<span class="count">' + list.length + ' shown</span></div>' +
    '<h2 style="font-size:15px;margin:4px 0 8px">Scheduled</h2>' +
    '<div class="tablewrap"><table class="grid"><thead><tr><th>Publish date</th><th>Status</th><th>Content type</th><th>Topic</th><th>Primary target kw</th><th>Target prompts</th><th>Draft</th><th>Publish URL</th><th>Old URL</th><th>Last publish</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="10" class="mini" style="padding:18px">Nothing scheduled yet — hit + New entry, or promote an idea below.</td></tr>') +
    '</tbody></table></div>' +
    '<h2 style="font-size:15px;margin:20px 0 8px">Ideas <span class="mini">' + ideas.length + '</span></h2>' +
    '<div class="addc" style="max-width:560px;margin-bottom:10px"><input type="text" id="idea-new" placeholder="Drop a topic idea… (details later — click it any time to flesh out)"><button class="btn sub" id="idea-add">Add idea</button></div>' +
    (ideaCards || '<p class="mini">No ideas parked. Anything you type above lands here; Schedule ↑ moves it into the table.</p>');
}
function calEditor(id, opts) {
  const existing = id ? calEntries().find(e => e.id === id) : null;
  const e = existing || { id: uuid(), bucket:'sched', date:'', status:'outline', types:[], topic:'', kw:'', vol:'', kd:'', prompts:'', gdoc:'', url:'', oldurl:'', lastpub:'' };
  const bucket0 = (opts && opts.promote) ? 'sched' : (e.bucket === 'idea' ? 'idea' : 'sched');
  const fld = (label, inner) => '<div class="sec" style="margin-bottom:11px"><h5>' + label + '</h5>' + inner + '</div>';
  const ti = (fid, val, ph) => '<input type="text" id="' + fid + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:4px;font:inherit">';
  const m = modal('<h2>' + (existing ? (opts && opts.promote ? 'Schedule this idea' : 'Edit entry') : 'New entry') + '</h2>' +
    fld('Where does this live?', '<div class="pillrow">' +
      '<span class="apill mine ' + (bucket0 === 'idea' ? '' : 'off') + '" data-bk="idea" style="background:' + colorOf('slate') + '">Idea</span>' +
      '<span class="apill mine ' + (bucket0 === 'sched' ? '' : 'off') + '" data-bk="sched" style="background:' + colorOf('green') + '">Scheduled</span></div>') +
    '<div class="row2">' +
      '<div style="flex:1">' + fld('Publish date', '<input type="date" id="c-date" value="' + esc(e.date || '') + '" style="width:100%;padding:6px 10px;border:1px solid var(--line);border-radius:4px;font:inherit">') + '</div>' +
      '<div style="flex:1">' + fld('Status', '<select id="c-status" style="width:100%;padding:7px 8px;border:1px solid var(--line);border-radius:4px;font:inherit;background:#fff"><option value="">—</option>' + CAL_STATUSES.map(s => '<option value="' + s[0] + '" ' + (e.status === s[0] ? 'selected' : '') + '>' + s[1] + '</option>').join('') + '</select>') + '</div>' +
    '</div>' +
    fld('Content type (choose any)', '<div class="pillrow">' + CAL_TYPES.map(t => '<span class="apill mine ' + ((e.types || []).includes(t[0]) ? '' : 'off') + '" data-ct="' + t[0] + '" style="background:' + colorOf('blue') + '">' + t[1] + '</span>').join('') + '</div>') +
    fld('Topic', ti('c-topic', e.topic, 'e.g. QOF basics pillar')) +
    '<div class="row2">' +
      '<div style="flex:2">' + fld('Primary target keyword', ti('c-kw', e.kw, 'e.g. qualified opportunity fund')) + '</div>' +
      '<div style="flex:1">' + fld('Volume', '<input type="number" id="c-vol" value="' + esc(e.vol || '') + '" min="0" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:4px;font:inherit">') + '</div>' +
      '<div style="flex:1">' + fld('KD %', '<input type="number" id="c-kd" value="' + esc(e.kd || '') + '" min="0" max="100" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:4px;font:inherit">') + '</div>' +
    '</div>' +
    fld('Target prompts (AEO)', '<textarea id="c-prompts" style="min-height:70px" placeholder="One per line — e.g. what is a qualified opportunity fund and how does it work">' + esc(e.prompts || '') + '</textarea>') +
    fld('Draft in Google Docs (link)', ti('c-gdoc', e.gdoc, 'https://docs.google.com/document/…')) +
    fld('Publish URL', ti('c-url', e.url, '/education-center/…/ or full URL')) +
    fld('Old URL(s) — for rewrites / consolidations, comma-separated', ti('c-oldurl', e.oldurl, '/old-slug/, /another-old-slug/')) +
    fld('Last publish date (of the old post)', '<input type="date" id="c-lastpub" value="' + esc(e.lastpub || '') + '" style="width:100%;padding:6px 10px;border:1px solid var(--line);border-radius:4px;font:inherit">') +
    '<div class="foot">' + (existing ? '<button class="btn danger" id="c-del">Delete</button>' : '') + '<button class="btn sub" id="c-cancel">Cancel</button><button class="btn" id="c-save">Save</button></div>');
  $$('[data-ct]', m).forEach(el => el.addEventListener('click', () => el.classList.toggle('off')));
  $$('[data-bk]', m).forEach(el => el.addEventListener('click', () => {
    $$('[data-bk]', m).forEach(x => x.classList.add('off'));
    el.classList.remove('off');
    // promoting an idea with no status yet → suggest Outline
    if (el.dataset.bk === 'sched' && !$('#c-status', m).value) $('#c-status', m).value = 'outline';
  }));
  if (opts && opts.promote && !e.status) $('#c-status', m).value = 'outline';
  // convenience: if the keyword matches a known top keyword, prefill its volume
  $('#c-kw', m).addEventListener('change', () => {
    if ($('#c-vol', m).value) return;
    const kw = $('#c-kw', m).value.trim().toLowerCase();
    const hit = DATA.pages.find(p => (p.pkw || '').toLowerCase() === kw && p.vol);
    if (hit) $('#c-vol', m).value = hit.vol;
  });
  $('#c-cancel', m).addEventListener('click', closeModal);
  const del = $('#c-del', m);
  del && del.addEventListener('click', () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Delete — sure?'; setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3500); return; }
    ANN.calDel = [...new Set([...(ANN.calDel || []), e.id])];
    ANN.cal = (ANN.cal || []).filter(x => x.id !== e.id);
    annChanged(); closeModal(); toast('Entry deleted.');
  });
  $('#c-save', m).addEventListener('click', () => {
    const bk = ($$('[data-bk]', m).find(x => !x.classList.contains('off')) || {}).dataset;
    const upd = { id: e.id, created: e.created || nowISO(), u: nowISO(),
      bucket: (bk && bk.bk) === 'idea' ? 'idea' : 'sched',
      date: $('#c-date', m).value, status: $('#c-status', m).value,
      types: $$('[data-ct]', m).filter(x => !x.classList.contains('off')).map(x => x.dataset.ct),
      topic: $('#c-topic', m).value.trim(), kw: $('#c-kw', m).value.trim(),
      vol: $('#c-vol', m).value ? Number($('#c-vol', m).value) : '', kd: $('#c-kd', m).value ? Number($('#c-kd', m).value) : '',
      prompts: $('#c-prompts', m).value.trim(), gdoc: $('#c-gdoc', m).value.trim(),
      url: $('#c-url', m).value.trim(), oldurl: $('#c-oldurl', m).value.trim(), lastpub: $('#c-lastpub', m).value };
    const i = (ANN.cal || []).findIndex(x => x.id === e.id);
    if (i >= 0) ANN.cal[i] = upd; else ANN.cal.push(upd);
    annChanged(); closeModal();
  });
}

/* ============================== wiring ============================== */
function wire(root) {
  const q = $('#f-q', root);
  if (q) {
    q.addEventListener('input', debounce(() => { FILTER.q = q.value.trim(); redrawKeepFocus('f-q'); }, 220));
    const bind = (id, key) => { const el = $('#' + id, root); el && el.addEventListener('change', () => { FILTER[key] = el.value; redraw(); }); };
    bind('f-cluster', 'cluster'); bind('f-tier', 'tier'); bind('f-status', 'status'); bind('f-label', 'label'); bind('f-notes', 'notes');
    const c = $('#f-compact', root); c && c.addEventListener('change', () => { FILTER.compact = c.checked; document.body.classList.toggle('compact', c.checked); });
    document.body.classList.toggle('compact', FILTER.compact);
    const n = DATA.pages.filter(pageMatches).length;
    const fc = $('#f-count', root); if (fc) fc.textContent = n + ' of ' + DATA.pages.length + ' pages';
  }
  $$('[data-open]', root).forEach(el => el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openDrawer(el.dataset.open); }));
  $$('th[data-sort]', root).forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort; if (SORT.k === k) SORT.dir *= -1; else { SORT.k = k; SORT.dir = k === 'path' || k === 'cat' || k === 'pkw' ? 1 : -1; } redraw();
  }));
  const csv = $('#btn-csv', root); csv && csv.addEventListener('click', exportCSV);
  const libs = $('#btn-libs', root); libs && libs.addEventListener('click', libraryModal);
  const cn = $('#cal-new', root); cn && cn.addEventListener('click', () => calEditor(null));
  const cq = $('#cal-q', root);
  if (cq) {
    cq.addEventListener('input', debounce(() => { CALF.q = cq.value.trim(); redrawKeepFocus('cal-q'); }, 220));
    const bindC = (fid, key) => { const el = $('#' + fid, root); el && el.addEventListener('change', () => { CALF[key] = el.value; redraw(); }); };
    bindC('cal-status', 'status'); bindC('cal-type', 'type');
  }
  $$('[data-cal]', root).forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('a') || ev.target.closest('[data-sched]')) return; calEditor(tr.dataset.cal); }));
  $$('[data-sched]', root).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); calEditor(b.dataset.sched, { promote: true }); }));
  const ia = $('#idea-add', root);
  if (ia) {
    const addIdea = () => {
      const inp = $('#idea-new', root); const v = inp.value.trim(); if (!v) return;
      ANN.cal.push({ id: uuid(), created: nowISO(), u: nowISO(), bucket: 'idea', date: '', status: '',
        types: [], topic: v, kw: '', vol: '', kd: '', prompts: '', gdoc: '', url: '', oldurl: '', lastpub: '' });
      annChanged();
    };
    ia.addEventListener('click', addIdea);
    $('#idea-new', root).addEventListener('keydown', ev => { if (ev.key === 'Enter') addIdea(); });
  }
  bindTips(root);
  bindDrag(root);
}
function redrawKeepFocus(id) { redraw(); const el = $('#' + id); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
function exportCSV() {
  const head = ['path','cluster','tier','status','labels','keywords','est_traffic','top_keyword','volume','position','intent_trans','intent_comm','intent_info','target_keyword','redirects_to','comments'];
  const lines = [head.join(',')];
  for (const p of DATA.pages.filter(pageMatches)) {
    const e = annOf(p.path) || {};
    const st = ANN.statuses.find(s => s.id === e.status);
    const cm = (e.comments||[]).filter(c => !(e.delc||[]).includes(c.id)).map(c => c.text).join(' | ');
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    lines.push([p.path, effCat(p), TIERNAME[effTier(p)], st ? st.name : '', effLabels(p).map(id => (labelDef(id)||{}).name).join('; '), p.kw, p.traffic, p.pkw || '', p.vol, p.pos == null ? '' : p.pos, p.trans, p.comm, p.info, e.target || '', p.redirects_to || '', cm].map(cell).join(','));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type:'text/csv' }));
  a.download = 'content-map-' + DATA.stats.generated + '.csv'; a.click();
}

/* ============================== drawer ============================== */
let DRAWER = null;
function closeDrawer() { $$('.drawer,.drawer-scrim').forEach(e => e.remove()); DRAWER = null; }
function refreshDrawer() {
  if (!DRAWER || $('.modal-scrim')) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  openDrawer(DRAWER);
}
function ensurePageAnn(path) {
  if (!ANN.pages[path]) ANN.pages[path] = { comments:[], delc:[], f:{}, status:'', labels:[], target:'', cluster:'', tier:'', offFlags:[], updated:'' };
  return ANN.pages[path];
}
function stampField(e, f) { e.f = e.f || {}; e.f[f] = nowISO(); e.updated = e.f[f]; }
function openDrawer(path) {
  closeDrawer();
  const p = PAGE[path];
  const e = annOf(path) || {};
  const scrim = document.createElement('div'); scrim.className = 'drawer-scrim'; scrim.addEventListener('click', closeDrawer);
  const d = document.createElement('div'); d.className = 'drawer';
  const t = p ? effTier(p) : null;
  const nc = (e.comments || []).filter(c => !(e.delc || []).includes(c.id));
  const orphan = !p;
  d.innerHTML = '<div class="dh"><button class="dx">✕</button><h2>' + esc(p ? p.label : path) + '</h2><div class="p">' + esc(path) + (orphan ? ' · <b>not in inventory</b>' : '') + ' · <a href="https://www.1031crowdfunding.com' + esc(path) + '" target="_blank" rel="noopener">open ↗</a></div></div>' +
  '<div class="body">' +
  (p ? '<div class="sec"><h5>SEMrush</h5>' + (p.no_metrics ? '<p class="mini">No data yet — new or never-ranking page.</p>' :
    '<div class="kv"><span class="k">Keywords</span><span>' + fmt(p.kw) + '</span>' +
    '<span class="k">Top keyword</span><span>' + esc(p.pkw || '—') + (p.pkw_stale && p.pkw ? ' <span class="badge stale">Aug 3</span>' : '') + '</span>' +
    '<span class="k">Est. traffic / mo</span><span>' + fmt(p.traffic) + '</span>' +
    '<span class="k">Volume (top kw)</span><span>' + (p.pkw ? fmt(p.vol) : '—') + '</span>' +
    '<span class="k">Position</span><span>' + (p.pos != null ? '#' + p.pos : '—') + '</span>' +
    '<span class="k">Intent positions</span><span>' + (INTENTS.map(([k, n]) => p[k] ? n + ' ' + p[k] : '').filter(Boolean).join(' · ') || '—') + '</span></div>') + '</div>' : '') +
  (p ? '<div class="sec"><h5>Placement</h5><div class="row2">' +
    '<select id="d-cluster"><option value="">' + esc(p.cat) + ' (build)</option>' + DATA.cats.map(c => '<option ' + (e.cluster === c ? 'selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
    '<select id="d-tier" ' + (t === 'redirect' ? 'disabled title="a redirecting URL stays in the Redirect band — change its live status below to re-tier it"' : '') + '><option value="">' + TIERNAME[p.tier === 'redirect' ? 'fanout' : p.tier] + ' (build)</option>' + TIERS.filter(x => x !== 'redirect').map(x => '<option value="' + x + '" ' + (e.tier === x ? 'selected' : '') + '>' + TIERNAME[x] + '</option>').join('') + '</select></div>' +
    ((e.cluster && e.cluster !== p.cat) || (e.tier && e.tier !== p.tier) ? '<p class="mini">Build has this as ' + esc(p.cat) + ' / ' + TIERNAME[p.tier] + '. <a href="#" id="d-resetplace">Reset to build</a></p>' : '') + '</div>' : '') +
  (p ? '<div class="sec"><h5>Live status</h5>' + (() => {
      const lo = liveOverride(path);
      if (p.tier === 'redirect') return '<p class="mini">Verified redirect → <b>' + esc(p.redirects_to || '') + '</b>' + (lo === 'live' ? ' — <b>you marked it live</b>.' : '') + '</p><button class="btn sub" id="d-live">' + (lo === 'live' ? 'Use build value (redirect)' : 'Mark as live (build is wrong / page restored)') + '</button>';
      return '<p class="mini">Crawled live (200, index,follow)' + (lo === 'redirect' ? ' — <b>you marked it as redirecting</b>.' : '') + '</p><button class="btn sub" id="d-live">' + (lo === 'redirect' ? 'Use build value (live)' : 'Mark as redirecting (I shipped a 301)') + '</button>';
    })() + '</div>' : '') +
  '<div class="sec"><h5>Status</h5><div class="pillrow">' + visibleStatuses(true).map(s => '<span class="apill mine ' + (((e.status || 'none') === s.id) ? '' : 'off') + '" data-st="' + s.id + '" style="background:' + colorOf(s.color) + '">' + esc(s.name) + '</span>').join('') + '</div></div>' +
  '<div class="sec"><h5>Labels <a href="#" id="d-libs" style="font-weight:400;font-size:11px">manage</a></h5><div class="pillrow">' +
    ANN.labels.filter(l => !isHiddenL(l.id)).map(l => {
      const on = p ? effLabels(p).includes(l.id) : (e.labels || []).includes(l.id);
      const style = l.derived ? 'class="apill auto-l ' + (on ? '' : 'off') + '" style="color:' + colorOf(l.color) + '"' : 'class="apill mine ' + (on ? '' : 'off') + '" style="background:' + colorOf(l.color) + '"';
      return '<span ' + style + ' data-lb="' + l.id + '">' + esc(l.name) + '</span>';
    }).join('') + '</div><p class="mini">Outlined labels are computed by the build — click to switch off for this page. Solid ones are yours.</p></div>' +
  '<div class="sec"><h5>Target keyword</h5><input type="text" id="d-target" placeholder="e.g. what is a dst 1031 exchange" value="' + esc(e.target || '') + '"></div>' +
  '<div class="sec"><h5>Comments</h5><div id="d-comments">' + nc.map(c => '<div class="comment" data-c="' + c.id + '"><div class="m"><span>' + esc(c.author || '') + ' · ' + esc((c.ts || '').slice(0, 16).replace('T', ' ')) + '</span><button data-delc="' + c.id + '">delete</button></div>' + esc(c.text) + '</div>').join('') + '</div>' +
    '<div class="addc"><input type="text" id="d-newc" placeholder="Add a comment…"><button class="btn" id="d-addc">Add</button></div></div>' +
  '</div>';
  document.body.appendChild(scrim); document.body.appendChild(d);
  DRAWER = path;
  $('.dx', d).addEventListener('click', closeDrawer);
  const rewire = () => { redraw(); openDrawer(path); };
  const dc = $('#d-cluster', d); dc && dc.addEventListener('change', () => { const a = ensurePageAnn(path); a.cluster = dc.value; stampField(a, 'cluster'); annChanged(); });
  const dt = $('#d-tier', d); dt && dt.addEventListener('change', () => { const a = ensurePageAnn(path); a.tier = dt.value; stampField(a, 'tier'); annChanged(); });
  const rp = $('#d-resetplace', d); rp && rp.addEventListener('click', ev => { ev.preventDefault(); const a = ensurePageAnn(path); a.cluster = ''; a.tier = ''; stampField(a, 'cluster'); stampField(a, 'tier'); annChanged(); openDrawer(path); });
  const dl = $('#d-live', d); dl && dl.addEventListener('click', () => {
    const cur = liveOverride(path);
    if (cur) delete ANN.live[path];
    else ANN.live[path] = { s: p.tier === 'redirect' ? 'live' : 'redirect', at: nowISO() };
    if (!cur && p.tier !== 'redirect') toast('Marked as redirecting. Tip: paste the destination in Check redirects so it shows in the table.');
    annChanged(); openDrawer(path);
  });
  $$('[data-st]', d).forEach(el => el.addEventListener('click', () => {
    const a = ensurePageAnn(path); a.status = el.dataset.st === 'none' ? '' : el.dataset.st; stampField(a, 'status'); annChanged(); openDrawer(path);
  }));
  $$('[data-lb]', d).forEach(el => el.addEventListener('click', () => {
    const a = ensurePageAnn(path); const id = el.dataset.lb;
    const def = labelDef(id);
    const isBuildFlag = p && def && def.derived && (p.flags || []).includes(id);
    if (isBuildFlag) { const off = new Set(a.offFlags || []); off.has(id) ? off.delete(id) : off.add(id); a.offFlags = [...off]; stampField(a, 'offFlags'); }
    else { const ls = new Set(a.labels || []); ls.has(id) ? ls.delete(id) : ls.add(id); a.labels = [...ls]; stampField(a, 'labels'); }
    annChanged(); openDrawer(path);
  }));
  const tg = $('#d-target', d); tg.addEventListener('change', () => { const a = ensurePageAnn(path); a.target = tg.value.trim(); stampField(a, 'target'); annChanged(); });
  const add = () => {
    const inp = $('#d-newc', d); const v = inp.value.trim(); if (!v) return;
    const a = ensurePageAnn(path);
    a.comments.push({ id: uuid(), ts: nowISO(), author: ANN.author || 'Jennifer', text: v });
    a.updated = nowISO(); annChanged(); openDrawer(path);
  };
  $('#d-addc', d).addEventListener('click', add);
  $('#d-newc', d).addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
  $$('[data-delc]', d).forEach(el => el.addEventListener('click', () => {
    const a = ensurePageAnn(path); a.delc.push(el.dataset.delc); a.updated = nowISO(); annChanged(); openDrawer(path);
  }));
  const lb = $('#d-libs', d); lb && lb.addEventListener('click', ev => { ev.preventDefault(); libraryModal(); });
}

/* ============================== modals ============================== */
function closeModal() { $$('.modal-scrim').forEach(e => e.remove()); }
function modal(html) {
  closeModal();
  const s = document.createElement('div'); s.className = 'modal-scrim';
  s.innerHTML = '<div class="modal">' + html + '</div>';
  s.addEventListener('click', e => { if (e.target === s) { closeModal(); if (DRAWER) openDrawer(DRAWER); } });
  document.body.appendChild(s);
  return $('.modal', s);
}
function syncModal() {
  const m = modal('<h2>Sync setup</h2>' +
    '<p style="font-size:13px">Your notes save on this device automatically. To sync them across devices (and back to the repo), paste a fine-grained GitHub token with <b>Contents: Read and write</b> on the <code>' + esc(SYNC.repo || '1031cf-content-map') + '</code> repo only. The token stays in your browser.</p>' +
    '<div class="row2" style="margin-bottom:8px"><input type="text" id="m-owner" placeholder="GitHub user" value="' + esc(SYNC.owner || 'JENNF000') + '" style="flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:7px"><input type="text" id="m-repo" placeholder="repo" value="' + esc(SYNC.repo || '1031cf-content-map') + '" style="flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:7px"></div>' +
    '<input type="text" id="m-token" placeholder="github_pat_…" value="' + esc(SYNC.token || '') + '" style="width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px">' +
    '<div class="foot">' + (SYNC.token ? '<button class="btn danger" id="m-disc">Disconnect</button>' : '') + '<button class="btn sub" id="m-cancel">Cancel</button><button class="btn" id="m-save">Save &amp; test</button></div>');
  $('#m-cancel', m).addEventListener('click', closeModal);
  const disc = $('#m-disc', m); disc && disc.addEventListener('click', async () => { SYNC.token = ''; await Store.set('sync', { token:'', owner:SYNC.owner, repo:SYNC.repo }); setSyncChip(); closeModal(); });
  $('#m-save', m).addEventListener('click', async () => {
    SYNC.owner = $('#m-owner', m).value.trim(); SYNC.repo = $('#m-repo', m).value.trim(); SYNC.token = $('#m-token', m).value.trim();
    await Store.set('sync', { token:SYNC.token, owner:SYNC.owner, repo:SYNC.repo });
    if (!SYNC.token) { setSyncChip(); return closeModal(); }
    setSyncChip('testing…');
    const r = await Sync.api('annotations.json?ref=main').catch(() => null);
    if (r && (r.ok || r.status === 404)) { setSyncChip('on'); toast('Sync connected.'); Sync.push(); }
    else setSyncChip(r && (r.status === 401 || r.status === 403) ? 'bad token' : 'error');
    closeModal();
  });
}
function parseUrls(text) {
  const out = { matched: [], unmatched: [] };
  const norm = new Map();
  for (const p of DATA.pages) norm.set(p.path.replace(/\/$/, ''), p.path);
  for (let raw of text.split(/[\n,]+/)) {
    raw = raw.trim(); if (!raw) continue;
    let path = raw;
    try { if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname; } catch (e) {}
    if (!path.startsWith('/')) path = '/' + path;
    const hit = norm.get(path.replace(/\/$/, ''));
    if (hit) out.matched.push(hit); else out.unmatched.push(raw);
  }
  out.matched = [...new Set(out.matched)];
  return out;
}
function checkRedirectsModal() {
  const m = modal('<h2>Check redirects</h2>' +
    '<p style="font-size:13px">Just shipped 301s? Paste the old URLs (full URLs or paths, one per line or comma-separated). They will be moved to the Redirect band and stamped as checked today. A browser on this domain cannot verify cross-origin redirects itself — the weekly crawl confirms them properly.</p>' +
    '<textarea id="m-urls" placeholder="/old-slug/\nhttps://www.1031crowdfunding.com/another-old-page/"></textarea>' +
    '<div id="m-diff"></div>' +
    '<div class="foot"><button class="btn sub" id="m-cancel">Cancel</button><button class="btn" id="m-prev">Preview</button><button class="btn hidden" id="m-apply">Apply</button></div>');
  $('#m-cancel', m).addEventListener('click', closeModal);
  let parsed = null;
  $('#m-prev', m).addEventListener('click', () => {
    parsed = parseUrls($('#m-urls', m).value);
    const already = parsed.matched.filter(p => effTier(PAGE[p]) === 'redirect');
    const toMark = parsed.matched.filter(p => effTier(PAGE[p]) !== 'redirect');
    $('#m-diff', m).innerHTML = '<div class="diff">' +
      (toMark.length ? '<b>' + toMark.length + ' will be marked as redirecting:</b><br>' + toMark.map(esc).join('<br>') + '<br>' : '<b>Nothing new to mark.</b><br>') +
      (already.length ? '<span style="color:#64748b">' + already.length + ' already shown as redirects (no change).</span><br>' : '') +
      (parsed.unmatched.length ? '<span style="color:#b91c1c"><b>Not in the inventory (ignored):</b><br>' + parsed.unmatched.map(esc).join('<br>') + '</span>' : '') + '</div>';
    $('#m-apply', m).classList.toggle('hidden', !toMark.length);
  });
  $('#m-apply', m).addEventListener('click', () => {
    const at = nowISO();
    let n = 0;
    for (const p of parsed.matched) if (effTier(PAGE[p]) !== 'redirect') { ANN.live[p] = { s:'redirect', at }; n++; }
    annChanged(); closeModal(); toast(n + ' pages moved to Redirect.');
  });
}
function libraryModal() {
  // Each swatch embeds a native <input type=color> — clicking it opens the
  // browser's full color picker (hex / RGB / eyedropper), her choice saved as hex.
  const swatch = (kind, id, cur) => '<div class="swatch" style="background:' + colorOf(cur) + '"><input type="color" value="' + colorOf(cur) + '" data-pick="' + kind + '" data-for="' + id + '" title="Pick a color"></div>';
  const m = modal('<h2>Statuses &amp; labels</h2>' +
    '<h3 style="font-size:13px;margin:10px 0 4px">Statuses</h3><div id="m-sts"></div>' +
    '<div class="addc" style="margin-top:6px"><input type="text" id="m-news" placeholder="New status…"><button class="btn sub" id="m-adds">Add status</button></div>' +
    '<h3 style="font-size:13px;margin:16px 0 4px">Labels</h3><div id="m-lbs"></div>' +
    '<div class="addc" style="margin-top:6px"><input type="text" id="m-newl" placeholder="New label…"><button class="btn sub" id="m-addl">Add label</button></div>' +
    '<div class="foot"><button class="btn sub" id="m-restore">Restore removed</button><button class="btn" id="m-done">Done</button></div>');
  const usage = id => DATA.pages.filter(p => { const e = annOf(p.path); return e && e.status === id; }).length;
  const usageL = id => DATA.pages.filter(p => effLabels(p).includes(id)).length;
  const draw = () => {
    const sts = visibleStatuses(false);
    $('#m-sts', m).innerHTML = sts.map((s, i) =>
      '<div class="libitem" data-id="' + s.id + '">' + swatch('s', s.id, s.color) +
      '<input type="text" value="' + esc(s.name) + '" data-rn="s"><span class="use">' + usage(s.id) + ' pages</span>' +
      '<button data-mv="-1" ' + (i === 0 ? 'disabled' : '') + '>↑</button><button data-mv="1" ' + (i === sts.length - 1 ? 'disabled' : '') + '>↓</button><button data-rm="s" title="remove">✕</button></div>').join('');
    $('#m-lbs', m).innerHTML = ANN.labels.filter(l => !isHiddenL(l.id)).map(l =>
      '<div class="libitem" data-id="' + l.id + '">' + swatch('l', l.id, l.color) +
      '<input type="text" value="' + esc(l.name) + '" data-rn="l"><span class="use">' + usageL(l.id) + ' pages' + (l.derived ? ' · auto' : '') + '</span><button data-rm="l" title="remove">✕</button></div>').join('');
    wireLib();
  };
  // Resolve the entry FRESH on every event — a sync merge replaces ANN, so a
  // reference captured at bind time can point into a dead object (colors picked
  // after a merge silently vanished). Persist on 'input' too, debounced: some
  // pickers (macOS panel) close without ever firing 'change'.
  const saveSoon = debounce(() => annChanged(), 600);
  const bindPick = (it, kind, id) => {
    const inp = $('input[data-pick]', it); if (!inp) return;
    const entry = () => (kind === 's' ? ANN.statuses : ANN.labels).find(x => x.id === id);
    inp.addEventListener('input', () => {
      const e2 = entry(); if (!e2) return;
      e2.color = inp.value; e2.u = nowISO();
      inp.parentElement.style.background = inp.value;
      saveSoon();
    });
    inp.addEventListener('change', () => {
      const e2 = entry(); if (!e2) return;
      e2.color = inp.value; e2.u = nowISO();
      inp.parentElement.style.background = inp.value;
      annChanged();
    });
  };
  const wireLib = () => {
    $$('#m-sts .libitem', m).forEach(it => {
      const id = it.dataset.id;
      $('[data-rn]', it).addEventListener('change', ev => { const s = ANN.statuses.find(x => x.id === id); s.name = ev.target.value.trim() || s.name; s.u = nowISO(); annChanged(); });
      bindPick(it, 's', id);
      $$('[data-mv]', it).forEach(b => b.addEventListener('click', () => {
        const list = visibleStatuses(false); const i = list.findIndex(x => x.id === id); const j = i + Number(b.dataset.mv);
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((s, k) => { s.o = k; s.u = nowISO(); });
        annChanged(); draw();
      }));
      $('[data-rm]', it).addEventListener('click', ev => {
        const b = ev.currentTarget;
        const n = usage(id);
        if (n && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'remove from ' + n + '?'; b.style.color = '#d03b3b'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '✕'; b.style.color = ''; }, 3500); return; }
        ANN.hiddenS = [...new Set([...(ANN.hiddenS || []), id])]; ANN.hiddenSAt = nowISO();
        for (const [path, e] of Object.entries(ANN.pages)) if (e.status === id) { e.status = ''; stampField(e, 'status'); }
        annChanged(); draw();
      });
    });
    $$('#m-lbs .libitem', m).forEach(it => {
      const id = it.dataset.id;
      $('[data-rn]', it).addEventListener('change', ev => { const l = ANN.labels.find(x => x.id === id); l.name = ev.target.value.trim() || l.name; l.u = nowISO(); annChanged(); });
      bindPick(it, 'l', id);
      $('[data-rm]', it).addEventListener('click', ev => {
        const b = ev.currentTarget;
        const n = usageL(id);
        if (n && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'remove from ' + n + '?'; b.style.color = '#d03b3b'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '✕'; b.style.color = ''; }, 3500); return; }
        ANN.hidden = [...new Set([...(ANN.hidden || []), id])]; ANN.hiddenAt = nowISO();
        for (const e of Object.values(ANN.pages)) { const i = (e.labels || []).indexOf(id); if (i >= 0) { e.labels.splice(i, 1); stampField(e, 'labels'); } }
        annChanged(); draw();
      });
    });
  };
  $('#m-adds', m).addEventListener('click', () => {
    const name = $('#m-news', m).value.trim(); if (!name) return;
    ANN.statuses.push({ id:'s' + uuid().slice(0, 8), name, color:'slate', o: Math.max(0, ...visibleStatuses(false).map(s => s.o || 0)) + 1, u: nowISO() });
    $('#m-news', m).value = '';
    annChanged(); draw();
  });
  $('#m-addl', m).addEventListener('click', () => {
    const name = $('#m-newl', m).value.trim(); if (!name) return;
    ANN.labels.push({ id:'l' + uuid().slice(0, 8), name, color:'blue', u: nowISO() });
    $('#m-newl', m).value = '';
    annChanged(); draw();
  });
  $('#m-restore', m).addEventListener('click', () => {
    ANN.hidden = []; ANN.hiddenAt = nowISO(); ANN.hiddenS = []; ANN.hiddenSAt = nowISO();
    normAnn(ANN); annChanged(); draw(); toast('Removed statuses and labels restored.');
  });
  $('#m-done', m).addEventListener('click', () => { closeModal(); redraw(); if (DRAWER) openDrawer(DRAWER); });
  draw();
}

/* ============================== drag (pointer events — NOT HTML5 DnD) ============================== */
const DRAG = { active:false, path:null, ghost:null, zone:null, sx:0, sy:0, moved:false, suppress:false, supT:null, lpT:null, raf:null, py:0, px:0 };
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('[data-drag]')) e.preventDefault(); });
function bindDrag(root) {
  $$('[data-drag]', root).forEach(el => {
    el.addEventListener('click', e => {
      if (DRAG.suppress || DRAG.active) { e.preventDefault(); return; }
    });
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const path = el.dataset.drag;
      DRAG.sx = e.clientX; DRAG.sy = e.clientY; DRAG.moved = false;
      const start = () => beginDrag(el, path, e);
      if (e.pointerType === 'touch') {
        DRAG.lpT = setTimeout(start, 380);
        const cancel = () => { clearTimeout(DRAG.lpT); el.removeEventListener('pointerup', cancel); el.removeEventListener('pointercancel', cancel); };
        el.addEventListener('pointerup', cancel, { once:true }); el.addEventListener('pointercancel', cancel, { once:true });
        const mv = ev => { if (Math.abs(ev.clientX - DRAG.sx) > 6 || Math.abs(ev.clientY - DRAG.sy) > 6) { clearTimeout(DRAG.lpT); el.removeEventListener('pointermove', mv); } };
        el.addEventListener('pointermove', mv);
      } else {
        const mv = ev => { if (!DRAG.active && (Math.abs(ev.clientX - DRAG.sx) > 5 || Math.abs(ev.clientY - DRAG.sy) > 5)) { beginDrag(el, path, ev); } };
        const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up, { once:true });
      }
    });
  });
}
let touchBlock = null;
function beginDrag(el, path, e) {
  if (DRAG.active) return;
  DRAG.active = true; DRAG.path = path; DRAG.moved = true;
  tipEl().style.display = 'none';
  const g = document.createElement('div'); g.id = 'ghost';
  g.textContent = (PAGE[path] || { label: path }).label;
  document.body.appendChild(g); DRAG.ghost = g;
  moveGhost(e.clientX, e.clientY);
  document.addEventListener('pointermove', moveDrag);
  document.addEventListener('pointerup', dropDrag, { once:true });
  touchBlock = ev => { if (DRAG.active) ev.preventDefault(); };
  document.addEventListener('touchmove', touchBlock, { passive:false });
  document.body.style.userSelect = 'none';
  autoScrollLoop();
}
function moveGhost(x, y) { if (DRAG.ghost) { DRAG.ghost.style.left = (x + 12) + 'px'; DRAG.ghost.style.top = (y + 10) + 'px'; } DRAG.px = x; DRAG.py = y; }
function zoneAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest('[data-drop]') : null;
}
function moveDrag(e) {
  moveGhost(e.clientX, e.clientY);
  const z = zoneAt(e.clientX, e.clientY);
  if (z !== DRAG.zone) {
    DRAG.zone && DRAG.zone.classList.remove('dropok');
    DRAG.zone = null;
    if (z && dropAllowed(z)) { DRAG.zone = z; z.classList.add('dropok'); }
  }
}
function dropAllowed(z) {
  const p = PAGE[DRAG.path]; if (!p) return false;
  const [, tier] = z.dataset.drop.split('|');
  const isRedir = effTier(p) === 'redirect';
  if (isRedir) return tier === 'redirect' || tier === '';   // redirects can re-cluster only
  return tier !== 'redirect';                                // live pages can't be dropped into Redirect
}
function autoScrollLoop() {
  if (!DRAG.active) return;
  const M = 56, S = 14;
  const mx = $('#matrix');
  if (mx) {
    const r = mx.getBoundingClientRect();
    if (DRAG.px < r.left + M) mx.scrollLeft -= S;
    else if (DRAG.px > r.right - M) mx.scrollLeft += S;
  }
  if (!DRAG.zone && !zoneAt(DRAG.px, DRAG.py)) {   // vertical scroll yields to drop targets
    if (DRAG.py < 90) window.scrollBy(0, -S);
    else if (DRAG.py > window.innerHeight - M) window.scrollBy(0, S);
  }
  DRAG.raf = requestAnimationFrame(autoScrollLoop);
}
function dropDrag(e) {
  const z = DRAG.zone;
  const path = DRAG.path;
  endDrag();
  if (!z || !path) return;
  const p = PAGE[path];
  const [cluster, tier] = z.dataset.drop.split('|');
  const a = ensurePageAnn(path);
  const prev = { cluster: a.cluster, tier: a.tier, fc: a.f.cluster, ft: a.f.tier };
  a.cluster = cluster === p.cat ? '' : cluster; stampField(a, 'cluster');
  if (tier && tier !== 'redirect') { a.tier = tier === p.tier ? '' : tier; stampField(a, 'tier'); }
  annChanged();
  toast('Moved to ' + cluster + (tier && tier !== 'redirect' ? ' / ' + TIERNAME[tier] : ''), () => {
    a.cluster = prev.cluster; a.tier = prev.tier;
    a.f.cluster = prev.fc || nowISO(); a.f.tier = prev.ft || nowISO(); a.updated = nowISO();
    annChanged();
  });
}
function endDrag(cancelled) {
  DRAG.active = false;
  clearTimeout(DRAG.lpT);
  cancelAnimationFrame(DRAG.raf);
  DRAG.zone && DRAG.zone.classList.remove('dropok');
  DRAG.zone = null;
  DRAG.ghost && DRAG.ghost.remove(); DRAG.ghost = null;
  document.removeEventListener('pointermove', moveDrag);
  touchBlock && document.removeEventListener('touchmove', touchBlock);
  document.body.style.userSelect = '';
  DRAG.suppress = true;
  clearTimeout(DRAG.supT);
  DRAG.supT = setTimeout(() => { DRAG.suppress = false; }, 350);
  if (cancelled) DRAG.path = null;
}

boot();
