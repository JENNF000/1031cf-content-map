/* =====================================================================
   1031 Crowdfunding — Content Topic Map (PWA)
   Part 1: local store, annotation model, GitHub sync.
   ===================================================================== */
"use strict";

/* ------------------------------------------------------------ IndexedDB -- */
const IDB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open("1031cf-content-map", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction("kv", mode);
    const req = fn(t.objectStore("kv"));
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
    t.oncomplete = () => res(req ? req.result : undefined);
  }));
  return {
    get: k => run("readonly", s => s.get(k)),
    set: (k, v) => run("readwrite", s => s.put(v, k)),
    del: k => run("readwrite", s => s.delete(k)),
  };
})();

/* Fallback for private-mode browsers where IndexedDB throws. */
const STORE = (() => {
  let broken = false;
  const ls = {
    get: k => { try { const v = localStorage.getItem("1031cf:" + k); return Promise.resolve(v ? JSON.parse(v) : undefined); } catch (e) { return Promise.resolve(undefined); } },
    set: (k, v) => { try { localStorage.setItem("1031cf:" + k, JSON.stringify(v)); } catch (e) {} return Promise.resolve(); },
    del: k => { try { localStorage.removeItem("1031cf:" + k); } catch (e) {} return Promise.resolve(); },
  };
  const wrap = name => (...a) => (broken ? ls[name](...a) : IDB[name](...a).catch(e => { broken = true; return ls[name](...a); }));
  return { get: wrap("get"), set: wrap("set"), del: wrap("del") };
})();

/* --------------------------------------------------------- annotations -- */
const DEFAULT_STATUSES = [
  { id: "none",       name: "No status",     color: "slate"  },
  { id: "todo",       name: "To do",         color: "slate"  },
  { id: "inprogress", name: "In progress",   color: "amber"  },
  { id: "drafted",    name: "Drafted",       color: "purple" },
  { id: "published",  name: "Published",     color: "green"  },
  { id: "monitoring", name: "Monitoring",    color: "blue"   },
  { id: "blocked",    name: "Blocked",       color: "red"    },
  { id: "wontdo",     name: "Won't do",      color: "slate"  },
];

/* Labels the build computes for you. Their ids match the flag keys in
   data.json, so a page carrying flag "slug" automatically wears the "Slug fix"
   label. They are ordinary labels otherwise: rename them, recolour them, take
   them off a page, or delete them from the library entirely. */
const DERIVED_LABELS = [
  { id: "review",       name: "Review",         color: "amber",  derived: true },
  { id: "remove",       name: "Remove",         color: "red",    derived: true },
  { id: "consolidate",  name: "Consolidate",    color: "red",    derived: true },
  { id: "slug",         name: "Slug fix",       color: "amber",  derived: true },
  { id: "underperform", name: "Underperformer", color: "pink",   derived: true },
  { id: "tiermismatch", name: "Tier ≠ yours",   color: "blue",   derived: true },
  { id: "untracked",    name: "Untracked",      color: "slate",  derived: true },
  { id: "nokw",         name: "No keywords",    color: "slate",  derived: true },
  { id: "redirect",     name: "301 redirect",   color: "green",  derived: true },
];

const DEFAULT_LABELS = [
  { id: "rewrite",    name: "Rewrite",            color: "red"    },
  { id: "refresh",    name: "Refresh content",    color: "amber"  },
  { id: "titlemeta",  name: "Title / meta",       color: "amber"  },
  { id: "schema",     name: "Add schema",         color: "purple" },
  { id: "aeo-answer", name: "AEO: direct answer", color: "teal"   },
  { id: "aeo-faq",    name: "AEO: FAQ block",     color: "teal"   },
  { id: "intlinks",   name: "Internal links",     color: "blue"   },
  { id: "eeat",       name: "E-E-A-T / author",   color: "purple" },
  { id: "needs301",   name: "Needs 301",          color: "red"    },
  { id: "keep",       name: "Keep as-is",         color: "green"  },
  { id: "priority",   name: "Priority",           color: "pink"   },
];

const ALL_DEFAULT_LABELS = () => DERIVED_LABELS.concat(DEFAULT_LABELS).map(l => ({ ...l }));

const emptyAnn = () => ({
  version: 2,
  updated: new Date(0).toISOString(),
  author: "",
  statuses: DEFAULT_STATUSES.map(s => ({ ...s })),
  labels: ALL_DEFAULT_LABELS(),
  hidden: [],            // label ids removed from the library
  hiddenAt: new Date(0).toISOString(),
  pages: {},
});

let ANN = emptyAnn();

const nowISO = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9));

/* Fields that carry their own clock so two devices can edit different
   properties of the same page without clobbering each other. */
const PAGE_FIELDS = ["status", "labels", "target", "cluster", "tier", "offFlags"];

function pageAnn(path, create) {
  let a = ANN.pages[path];
  if (!a && create) {
    a = ANN.pages[path] = {
      status: "", labels: [], target: "", cluster: "", tier: "",
      offFlags: [], comments: [], delc: [], f: {}, updated: nowISO(),
    };
  }
  if (a) {
    if (!a.f) a.f = {};
    if (!a.labels) a.labels = [];
    if (!a.offFlags) a.offFlags = [];
    if (!a.comments) a.comments = [];
    if (!a.delc) a.delc = [];
  }
  return a;
}

function annIsEmpty(a) {
  return !a || (!a.status && !(a.labels || []).length && !(a.target || "").trim() &&
    !(a.cluster || "") && !(a.tier || "") && !(a.offFlags || []).length &&
    !(a.comments || []).length);
}

/* `field` is one of PAGE_FIELDS. Comments carry their own ids and tombstones,
   so they don't need a field clock. */
function touch(path, field) {
  const a = pageAnn(path, true);
  a.updated = nowISO();
  if (field) a.f[field] = a.updated;
  ANN.updated = a.updated;
  if (annIsEmpty(a) && !(a.delc || []).length) delete ANN.pages[path];
  saveLocal();
  Sync.schedule();
}

function touchLibrary() {
  ANN.updated = nowISO();
  saveLocal();
  Sync.schedule();
}

function saveLocal() { return STORE.set("annotations", ANN); }

/* Merge two annotation documents.

   Fields resolve independently on their own timestamps, so commenting on a
   laptop can't wipe a status set on a phone. Comments are unioned by id with
   tombstones honoured; the status and label libraries are unioned by id, each
   entry resolving on its own `u` stamp so a rename propagates. */
function mergeAnn(a, b) {
  const out = {
    version: 2,
    updated: (a.updated > b.updated ? a.updated : b.updated),
    author: a.author || b.author || "",
    statuses: unionById(a.statuses, b.statuses),
    labels: unionById(a.labels, b.labels),
    hidden: ((a.hiddenAt || "") >= (b.hiddenAt || "") ? a.hidden : b.hidden) || [],
    hiddenAt: (a.hiddenAt || "") >= (b.hiddenAt || "") ? (a.hiddenAt || "") : (b.hiddenAt || ""),
    pages: {},
  };
  const paths = new Set([...Object.keys(a.pages || {}), ...Object.keys(b.pages || {})]);
  paths.forEach(p => {
    const x = (a.pages || {})[p], y = (b.pages || {})[p];
    if (!x) { out.pages[p] = normPage(y); return; }
    if (!y) { out.pages[p] = normPage(x); return; }
    const delc = [...new Set([...(x.delc || []), ...(y.delc || [])])];
    const seen = new Map();
    [...(x.comments || []), ...(y.comments || [])].forEach(c => { if (c && c.id && !seen.has(c.id)) seen.set(c.id, c); });
    const comments = [...seen.values()]
      .filter(c => !delc.includes(c.id))
      .sort((m, n) => String(m.ts).localeCompare(String(n.ts)));

    /* Per-field clock. Documents written before `f` existed fall back to the
       page clock, but only for fields that actually hold a value — otherwise a
       page created just to hold a comment would "win" every empty field and
       silently wipe a status set on another device. Explicitly clearing a
       field stamps `f`, so clearing still propagates. */
    const isSet = (o, k) => Array.isArray(o[k]) ? o[k].length > 0 : !!String(o[k] || "").trim();
    const fts = (o, k) => (o.f && o.f[k]) || (isSet(o, k) ? (o.updated || "") : "");
    const pick = k => (fts(x, k) >= fts(y, k) ? x : y);

    const merged = { comments, delc, f: {} };
    PAGE_FIELDS.forEach(k => {
      const src = pick(k);
      merged[k] = Array.isArray(src[k]) ? (src[k] || []) : (src[k] || "");
      const t = fts(x, k) >= fts(y, k) ? fts(x, k) : fts(y, k);
      if (t) merged.f[k] = t;
    });
    merged.updated = (x.updated || "") >= (y.updated || "") ? x.updated : y.updated;
    out.pages[p] = merged;
  });
  return out;
}

function normPage(p) {
  const o = {
    comments: (p.comments || []).filter(c => !(p.delc || []).includes(c.id)),
    delc: p.delc || [], f: p.f || {}, updated: p.updated || "",
  };
  PAGE_FIELDS.forEach(k => {
    o[k] = (k === "labels" || k === "offFlags") ? (p[k] || []) : (p[k] || "");
  });
  return o;
}

/* Union two library arrays by id. Where both sides have an entry, the one with
   the later `u` stamp wins, so renaming a label on one device propagates. */
function unionById(x, y) {
  const m = new Map();
  [...(y || []), ...(x || [])].forEach(o => {
    if (!o || !o.id) return;
    const prev = m.get(o.id);
    if (!prev || (o.u || "") >= (prev.u || "")) m.set(o.id, o);
  });
  return [...m.values()];
}

/* ---------------------------------------------------------- GitHub sync -- */
const Sync = (() => {
  let cfg = null;          // {owner, repo, branch, path, token, author}
  let sha = null;
  let state = "local";     // local | synced | pending | error | offline
  let msg = "Notes are saved in this browser only — click to sync them to GitHub";
  let timer = null;
  let inflight = false;
  let dirty = false;
  const listeners = [];

  const b64encode = s => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64decode = b => {
    const bin = atob(String(b).replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  function set(s, m) { state = s; msg = m; listeners.forEach(f => f(s, m)); }
  function on(f) { listeners.push(f); f(state, msg); }

  const api = (path, opts = {}) => fetch("https://api.github.com" + path, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + cfg.token,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });

  const contentsUrl = () =>
    `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path
      .split("/").map(encodeURIComponent).join("/")}`;

  async function load() {
    cfg = (await STORE.get("sync")) || null;
    if (cfg && cfg.token) { set("pending", "Connecting…"); }
    return cfg;
  }

  function config() { return cfg; }
  function connected() { return !!(cfg && cfg.token && cfg.owner && cfg.repo); }

  async function save(newCfg) {
    cfg = newCfg;
    await STORE.set("sync", cfg);
    sha = null;
    if (!connected()) { set("local", "Notes are saved in this browser only — click to sync them to GitHub"); return; }
    await pull(true);
  }

  async function disconnect() {
    cfg = null; sha = null;
    await STORE.del("sync");
    set("local", "Notes are saved in this browser only — click to sync them to GitHub");
  }

  async function test(c) {
    const saved = cfg; cfg = c;
    try {
      const r = await api(`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`);
      if (r.status === 404) throw new Error("Repository not found, or the token can't see it.");
      if (r.status === 401) throw new Error("Token rejected (401). Check it was copied in full.");
      if (!r.ok) throw new Error("GitHub returned " + r.status + ".");
      const repo = await r.json();
      if (repo.permissions && !repo.permissions.push) {
        throw new Error("Token can read but not write. It needs Contents: Read and write.");
      }
      return { ok: true, repo: repo.full_name, priv: repo.private };
    } finally { cfg = saved; }
  }

  /* Read remote annotations. Uses the API when a token exists, otherwise the
     static file served alongside the app (read-only). */
  async function fetchRemote() {
    if (connected()) {
      const r = await api(contentsUrl() + "?ref=" + encodeURIComponent(cfg.branch || "main"));
      if (r.status === 404) { sha = null; return null; }
      if (!r.ok) throw new Error("GitHub read failed (" + r.status + ")");
      const j = await r.json();
      sha = j.sha;
      return JSON.parse(b64decode(j.content || ""));
    }
    const r = await fetch("annotations.json", { cache: "no-store" });
    if (!r.ok) return null;
    return r.json();
  }

  async function pull(quiet) {
    if (!navigator.onLine) { set("offline", "Offline — changes are queued"); return; }
    try {
      if (connected()) set("pending", "Syncing…");
      const remote = await fetchRemote();
      if (remote && remote.pages) {
        ANN = mergeAnn(ANN, remote);
        await saveLocal();
      }
      if (connected()) {
        if (dirty) { await push(); } else { set("synced", "Synced " + timeStr()); }
      } else {
        set("local", "Notes are saved in this browser only — click to sync them to GitHub");
      }
      if (!quiet && typeof window.onAnnotationsChanged === "function") window.onAnnotationsChanged();
      return true;
    } catch (e) {
      set("error", e.message || "Sync failed");
      return false;
    }
  }

  async function push() {
    if (!connected()) { dirty = false; return; }
    if (!navigator.onLine) { dirty = true; set("offline", "Offline — changes are queued"); return; }
    if (inflight) { dirty = true; return; }
    inflight = true;
    set("pending", "Saving…");
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const remote = await fetchRemote().catch(() => null);
        if (remote && remote.pages) ANN = mergeAnn(ANN, remote);
        ANN.author = (cfg.author || ANN.author || "");
        await saveLocal();
        const body = {
          message: "Update content-map annotations",
          content: b64encode(JSON.stringify(ANN, null, 1)),
          branch: cfg.branch || "main",
        };
        if (sha) body.sha = sha;
        const r = await api(contentsUrl(), { method: "PUT", body: JSON.stringify(body) });
        if (r.ok) {
          const j = await r.json();
          sha = j.content && j.content.sha;
          dirty = false;
          set("synced", "Synced " + timeStr());
          return true;
        }
        if (r.status === 409 || r.status === 422) { sha = null; continue; }  // stale sha, retry
        const t = await r.text().catch(() => "");
        throw new Error("GitHub write failed (" + r.status + ")" + (t.includes("Resource not accessible") ? " — token lacks Contents: write" : ""));
      }
      throw new Error("Conflicted twice — try again");
    } catch (e) {
      dirty = true;
      set("error", e.message || "Save failed");
      return false;
    } finally { inflight = false; }
  }

  function schedule() {
    dirty = true;
    if (!connected()) { set("local", "Notes are saved in this browser only — click to sync them to GitHub"); return; }
    set("pending", "Unsaved changes…");
    clearTimeout(timer);
    timer = setTimeout(() => push(), 2200);
  }

  function flush() { clearTimeout(timer); if (dirty) return push(); }
  function timeStr() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function getState() { return { state, msg }; }

  addEventListener("online", () => { if (dirty) push(); else pull(true); });
  addEventListener("offline", () => set("offline", "Offline — changes are queued"));
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  return { load, save, disconnect, test, pull, push, schedule, flush, on, config, connected, getState };
})();


/* =====================================================================
   Part 2: dashboard rendering.

   Two ideas run through this file:

   1. "Effective" values. `data.json` says what cluster and tier a page was
      classified into; your annotations may override either. Every view reads
      effCat()/effTier(), never p.cat/p.tier directly, so a page you dragged
      somewhere stays there through a data refresh.

   2. One kind of chip. The flags the build computes (Review, Consolidate,
      Slug fix …) and the labels you apply by hand are the same thing — entries
      in one library, rendered the same way, editable and removable alike.
   ===================================================================== */

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => (v || 0).toLocaleString('en-US');

const TIERS = [
  ["transactional", "Transactional"],
  ["core", "Pillar"],
  ["fanout", "Fan-out"],
  ["utility", "Site / utility"],
  ["redirect", "Redirect"],
];
const TIERNAME = Object.fromEntries(TIERS);
/* the three tiers you can move a page between */
const MOVABLE_TIERS = ["transactional", "core", "fanout"];

let DATA = null, P = [], S = {}, CAL = [], byPath = {};

function bindData(d) {
  DATA = d;
  P = DATA.pages; S = DATA.stats; CAL = DATA.calendar || [];
  byPath = Object.fromEntries(P.map(p => [p.path, p]));
}

/* ---------------------------------------------------------- effective ---- */
const annOf = path => ANN.pages[path];
const statusById = id => (ANN.statuses || []).find(s => s.id === id);
const labelById = id => (ANN.labels || []).find(l => l.id === id);
const isHidden = id => (ANN.hidden || []).includes(id);

function effCat(p) {
  const a = annOf(p.path);
  const c = a && a.cluster;
  return (c && DATA.cats.includes(c)) ? c : p.cat;
}
function effTier(p) {
  const a = annOf(p.path);
  if (p.tier === "redirect") return "redirect";     // redirects are not pages
  const t = a && a.tier;
  return (t && MOVABLE_TIERS.includes(t)) ? t : p.tier;
}
const isMoved = p => {
  const a = annOf(p.path);
  return !!(a && ((a.cluster && a.cluster !== p.cat) || (a.tier && a.tier !== p.tier)));
};

/* Label ids in effect on a page: build-computed flags you haven't switched off,
   plus the ones you applied yourself. Hidden library entries drop out. */
function effLabels(p) {
  const a = annOf(p.path) || {};
  const off = a.offFlags || [];
  const out = [];
  (p.flags || []).forEach(f => { if (!off.includes(f) && !isHidden(f) && !out.includes(f)) out.push(f); });
  (a.labels || []).forEach(l => { if (!isHidden(l) && !out.includes(l)) out.push(l); });
  return out;
}
const isDerivedOn = (p, id) => (p.flags || []).includes(id);

function labelPills(p, max) {
  const ids = effLabels(p);
  const out = ids.map(id => {
    const l = labelById(id);
    if (!l) return "";
    /* build-applied labels read lighter than the ones you put there yourself */
    const auto = isDerivedOn(p, id) ? " auto-l" : "";
    return `<span class="apill${auto}" data-c="${esc(l.color || 'slate')}">${esc(l.name)}</span>`;
  }).filter(Boolean);
  if (max && out.length > max) return out.slice(0, max).join("") + `<span class="apill" data-c="slate">+${out.length - max}</span>`;
  return out.join("");
}

function statusPill(path) {
  const a = annOf(path);
  if (!a || !a.status) return "";
  const st = statusById(a.status);
  if (!st) return "";
  return `<span class="apill st" data-c="${esc(st.color)}"><span class="adot"></span>${esc(st.name)}</span>`;
}

function noteBtnHTML(path) {
  const a = annOf(path);
  const n = a ? (a.comments || []).length : 0;
  const has = a && !annIsEmpty(a);
  return `<button class="notebtn${has ? " has" : ""}" data-note="${esc(path)}" type="button"
    title="Labels and comments">✎${n ? " " + n : ""}</button>`;
}

/* Tier counts have to be recomputed — you may have re-tiered pages yourself. */
function liveStats() {
  const live = P.filter(p => effTier(p) !== "redirect");
  const c = { transactional: 0, core: 0, fanout: 0, utility: 0 };
  live.forEach(p => { const t = effTier(p); if (c[t] !== undefined) c[t]++; });
  return c;
}

/* ---------- header / tiles ---------- */
function renderHeader() {
  $("#topbanner").innerHTML = `<span>⚠</span><div style="flex:1"><div class="btext"><b>Read before using:</b> URLs, keyword counts, positions and
    search volumes are live SEMrush + sitemap data, refreshed weekly. Everything you add — statuses, labels,
    comments, and any page you move between clusters or tiers — is yours and is keyed to the URL, so a refresh
    updates the numbers underneath without touching your work.
    <br><b>Correction (2026-08-03):</b> an earlier build claimed your published consolidations were missing their
    301s. That was wrong. Re-tested properly in Chrome: ${n0(S.redirects)} of ${n0(S.crawled)} crawled URLs return a
    server-level HTTP redirect — including both DST URLs and the California one — and are excluded from every
    count here. One genuine gap survived the re-check; see <b>Your workflow</b>.
    <br>Page titles are slug-derived and publish dates aren't captured. See <b>Data sources</b> for the
    field-by-field breakdown.</div>
    <button class="bantoggle" type="button">Read more</button></div>`;
  $("#topbanner").classList.add("clamped");

  $("#asof").textContent = S.generated;
  $("#foot2").textContent = `${n0(S.total)} live URLs · ${n0(S.keywords)} ranking keywords · ${n0(S.traffic)} est. monthly organic visits · generated ${S.generated}`;
  $("#c-attn").textContent = "(" + (DATA.groups.length - S.resolved_groups) + ")";
  $("#c-slug").textContent = "(" + DATA.slugs.length + ")";
  $("#c-all").textContent = "(" + S.total + ")";
  $("#c-work").textContent = "(" + (S.review + S.remove) + ")";

  const c = liveStats();
  const TILES = [
    ["Live pages", n0(S.total), `${c.transactional} transactional · ${c.core} pillar · ${c.fanout} fan-out`],
    ["Verified redirects", n0(S.redirects), `of ${n0(S.crawled)} URLs crawled — excluded from all counts`],
    ["Ranking keywords", n0(S.keywords), `across ${S.ranking} pages with at least one ranking`],
    ["Est. monthly organic visits", n0(S.traffic), "SEMrush estimate, US database"],
  ];
  const tw = $("#tiles"); tw.innerHTML = "";
  TILES.forEach(([l, v, nt]) => {
    const t = el("div", "tile");
    t.append(el("div", "lab", esc(l)), el("div", "val", v), el("div", "note", esc(nt)));
    tw.append(t);
  });
}

function renderFilters() {
  const fc = $("#fcat"), fc2 = $("#fcat2");
  if (fc.options.length <= 1) DATA.cats.forEach(c => [fc, fc2].forEach(s => s.append(el("option", null, esc(c)))));
  if ($("#ftype2").options.length <= 1)
    [...new Set(P.map(p => p.type))].sort().forEach(t => $("#ftype2").append(el("option", null, esc(t))));
}

let F = { q: "", cat: "", ann: "" };

function matchAnn(p) {
  if (!F.ann) return true;
  const a = annOf(p.path);
  if (F.ann === "__any") return !!a && !annIsEmpty(a);
  if (F.ann === "__none") return !a || annIsEmpty(a);
  if (F.ann === "__comment") return !!a && (a.comments || []).length > 0;
  if (F.ann === "__moved") return isMoved(p);
  if (F.ann.startsWith("s:")) return !!a && a.status === F.ann.slice(2);
  if (F.ann.startsWith("l:")) return effLabels(p).includes(F.ann.slice(2));
  return true;
}

function match(p) {
  if (F.cat && effCat(p) !== F.cat) return false;
  if (!matchAnn(p)) return false;
  if (F.q) {
    const q = F.q.toLowerCase();
    const a = annOf(p.path);
    const inNotes = a && ((a.target || "").toLowerCase().includes(q) ||
      (a.comments || []).some(c => (c.text || "").toLowerCase().includes(q)));
    if (!(p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) ||
      (p.pkw || "").toLowerCase().includes(q) || effCat(p).toLowerCase().includes(q) || inNotes)) return false;
  }
  return true;
}

/* ---------- tooltip ---------- */
const tipEl = () => $("#tip");
function bindTip(node, html) {
  const tip = tipEl();
  node.addEventListener("mouseenter", () => { tip.innerHTML = html; tip.classList.add("on"); });
  node.addEventListener("mousemove", e => {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 13, innerWidth - w - 10) + "px";
    tip.style.top = Math.max(8, e.clientY - h - 11) + "px";
  });
  node.addEventListener("mouseleave", () => tip.classList.remove("on"));
}

function tipFor(p) {
  const a = annOf(p.path);
  const moved = isMoved(p);
  return `<b>${esc(p.label)}</b><br><span style="opacity:.7">${esc(p.path)}</span><br>
    <span style="opacity:.7">${esc(p.type)}</span><br><br>
    Keywords: <b>${n0(p.kw)}</b> · Est. traffic: <b>${n0(p.traffic)}</b><br>
    ${p.pkw ? `Top keyword: <b>${esc(p.pkw)}</b><br>Volume ${n0(p.vol)}/mo · position ${p.pos}<br>` : ''}
    ${p.trans || p.comm ? `Intent: ${p.trans} transactional / ${p.comm} commercial / ${p.info} informational<br>` : ''}
    ${moved ? `<br>↔ Moved by you to <b>${esc(effCat(p))} · ${esc(TIERNAME[effTier(p)])}</b><br>
       <span style="opacity:.7">was ${esc(p.cat)} · ${esc(TIERNAME[p.tier] || p.tier)}</span>` : ''}
    ${p.groups && p.groups.length ? `<br>⚠ Competes on: ${p.groups.map(esc).join('; ')}` : ''}
    ${p.slug_suggest ? `<br>✎ Suggested slug: <b>${esc(p.slug_suggest)}</b>` : ''}
    ${a && a.target ? `<br>◎ Your target: <b>${esc(a.target)}</b>` : ''}
    ${a && (a.comments || []).length ? `<br>💬 ${(a.comments || []).length} comment${(a.comments || []).length > 1 ? 's' : ''}` : ''}`;
}

/* ---------- matrix ---------- */
function renderMatrix() {
  const m = $("#matrix"); m.innerHTML = "";
  const maxkw = Math.max(...P.map(p => p.kw), 1);
  const dense = document.body.dataset.density === "compact";

  DATA.cats.forEach(cat => {
    const all = P.filter(p => effCat(p) === cat);
    const inCat = all.filter(p => match(p));
    const col = el("div", "col");
    col.dataset.cluster = cat;

    const h = el("div", "col-h");
    h.dataset.drop = "cluster";
    h.innerHTML = `<div class="nm">${esc(cat)}</div>
      <div class="mt">${all.length} page${all.length === 1 ? "" : "s"} · ${n0(all.reduce((a, b) => a + b.kw, 0))} keywords</div>
      <div class="dhint">drop to move here</div>`;
    col.append(h);

    let shown = 0;
    TIERS.forEach(([tk, tl]) => {
      const rows = inCat.filter(p => effTier(p) === tk)
        .sort((a, b) => b.kw - a.kw || a.label.localeCompare(b.label));
      const movable = MOVABLE_TIERS.includes(tk);
      if (!rows.length && !movable) return;         // never show empty utility/redirect

      const g = el("div", "tiergroup " + tk);
      if (movable) { g.dataset.drop = "tier"; g.dataset.tier = tk; }
      if (!rows.length) g.classList.add("empty");

      g.append(el("div", "tierlab " + tk,
        `<span class="tname">${esc(tl)}</span><span class="tcount">${rows.length}</span>`));

      rows.forEach(p => {
        shown++;
        const a = el("a", "cell" + (tk === "redirect" ? " isredir" : "") + (isMoved(p) ? " moved" : ""));
        a.href = p.url; a.target = "_blank"; a.rel = "noopener";
        a.dataset.path = p.path;
        if (tk !== "redirect") a.draggable = true;
        const chips = dense ? "" : `${statusPill(p.path)}${labelPills(p, 3)}`;
        a.innerHTML = `<div class="ttl"><span class="txt">${esc(p.label)}</span>
            <span class="kw${p.kw ? '' : ' zero'}">${p.kw ? n0(p.kw) : '—'}</span></div>
          <div class="bar${p.kw ? '' : ' empty'}" style="width:${p.kw ? Math.max(3, Math.round(100 * Math.sqrt(p.kw) / Math.sqrt(maxkw))) : 100}%"></div>
          ${chips ? `<div class="meta">${chips}</div>` : ""}
          ${noteBtnHTML(p.path)}`;
        bindTip(a, tipFor(p));
        g.append(a);
      });

      if (!rows.length) g.append(el("div", "dropzone", "Drop a page here"));
      col.append(g);
    });

    if (!shown) col.append(el("div", "empty-col", "No pages match the current filter."));
    m.append(col);
  });

  wireDrag();
}

/* ---------- drag to re-classify ---------- */
let dragPath = null;

function wireDrag() {
  document.querySelectorAll(".matrix .cell[draggable]").forEach(c => {
    c.addEventListener("dragstart", e => {
      dragPath = c.dataset.path;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragPath); } catch (_) {}
      document.body.classList.add("dragging");
      c.classList.add("dragsrc");
    });
    c.addEventListener("dragend", () => {
      document.body.classList.remove("dragging");
      c.classList.remove("dragsrc");
      document.querySelectorAll(".dropok").forEach(n => n.classList.remove("dropok"));
      dragPath = null;
    });
  });

  document.querySelectorAll(".matrix [data-drop]").forEach(z => {
    z.addEventListener("dragover", e => {
      if (!dragPath) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      z.classList.add("dropok");
    });
    z.addEventListener("dragleave", () => z.classList.remove("dropok"));
    z.addEventListener("drop", e => {
      e.preventDefault();
      z.classList.remove("dropok");
      const path = dragPath || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      if (!path) return;
      const col = z.closest(".col");
      movePage(path, col && col.dataset.cluster, z.dataset.drop === "tier" ? z.dataset.tier : null);
    });
  });
}

/* Apply a manual move. `tier` null means "cluster only, keep the tier". */
function movePage(path, cluster, tier) {
  const p = byPath[path];
  if (!p) return;
  const a = pageAnn(path, true);
  let changed = false;

  if (cluster && cluster !== effCat(p)) {
    a.cluster = cluster === p.cat ? "" : cluster;
    touch(path, "cluster");
    changed = true;
  }
  if (tier && tier !== effTier(p)) {
    a.tier = tier === p.tier ? "" : tier;
    touch(path, "tier");
    changed = true;
  }
  if (!changed) return;

  refreshViews();
  const back = isMoved(p) ? "" : " (back to where the build had it)";
  toast(`${p.label} → ${effCat(p)} · ${TIERNAME[effTier(p)]}${back}`, false, {
    label: "Undo",
    run: () => { resetMove(path); refreshViews(); },
  });
}

function resetMove(path) {
  const a = pageAnn(path, true);
  a.cluster = ""; touch(path, "cluster");
  const b = pageAnn(path, true);
  b.tier = ""; touch(path, "tier");
}

/* ---------- groups ---------- */
const SEVW = { critical: 0, serious: 1, warning: 2, partial: 3, resolved: 4 };
const SEVCLS = { critical: "crit", serious: "ser", warning: "warn", partial: "partial", resolved: "resolved" };
function renderGroups() {
  const g = $("#groups"); g.innerHTML = "";
  [...DATA.groups].sort((a, b) => SEVW[a.sev] - SEVW[b.sev] || b.urls.length - a.urls.length).forEach(gr => {
    const c = el("div", "card " + SEVCLS[gr.sev]);
    c.append(el("h3", null, `${esc(gr.topic)} <span class="sevtag ${gr.sev}">${gr.sev === "resolved" ? "done" : gr.sev}</span>`));
    c.append(el("div", "kv", `${esc(gr.cat)} · <b>${(gr.still_live || []).length + 1} still competing</b> of ${gr.urls.length} · ${(gr.redirected || []).length} already redirected · shared term “${esc(gr.kw)}”${gr.vol ? ` (${n0(gr.vol)}/mo)` : ''}`));
    const w = gr.work;
    if (w) {
      const done = w.state === "done";
      c.append(el("div", "workbar " + (done ? (w.remaining.length ? "partial" : "done") : "partial"),
        `${done ? "✓" : "◷"} <b>Your calendar: ${esc(w.status)}${w.ctype ? " — " + esc(w.ctype) : ""}</b>
         ${w.date ? ` (${esc(w.date)})` : ''} · “${esc(w.topic)}”<br>
         ${w.merged.length ? `Absorbed ${w.merged.length} page${w.merged.length > 1 ? 's' : ''} from this group.` : ''}
         ${w.remaining.length ? ` <b>${w.remaining.length} still live</b> and competing.` : ` Group looks closed out.`}`));
    }
    c.append(el("p", null, esc(gr.note)));
    const ul = el("ul", "urls");
    gr.urls.forEach(u => {
      const p = byPath[u];
      const gone = w && w.merged.includes(u);
      const li = el("li", (u === gr.keep ? "keep" : "") + (gone ? " gone" : ""));
      li.innerHTML = `${u === gr.keep ? '<span class="kp">keep</span>' : ''}
        ${gone ? `<span class="kp" style="color:var(--good-text)">${(gr.redirected || []).includes(u) ? '301' : 'merged'}</span>` : ''}
        <a class="u" href="https://www.1031crowdfunding.com${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>
        ${p ? statusPill(u) + labelPills(p, 2) + noteBtnHTML(u) : ''}
        <span class="n">${p && p.kw ? n0(p.kw) + ' kw' : '0 kw'}${p && p.pos ? ' · #' + p.pos : ''}</span>`;
      ul.append(li);
    });
    c.append(ul); g.append(c);
  });
}

/* ---------- workflow ---------- */
function liFor(p, extra) {
  const li = el("li");
  li.innerHTML = `<a class="u" href="${p.url}" target="_blank" rel="noopener">${esc(p.path)}</a>
    ${extra || ''}${statusPill(p.path)}${noteBtnHTML(p.path)}<span class="n">${p.kw ? n0(p.kw) + ' kw' : '0 kw'}${p.pos ? ' · #' + p.pos : ''}</span>`;
  bindTip(li, tipFor(p));
  return li;
}

function renderRedir() {
  const RD = DATA.redirects || { map: {}, anomalies: [] };
  const m = Object.entries(RD.map || {});
  $("#c-redir").textContent = "(" + m.length + ")";
  $("#n-redir").textContent = "(" + m.length + ")";
  $("#redirintro").innerHTML = `<b>${m.length} of ${n0(S.crawled)} crawled URLs are redirects, not pages.</b>
    They carry ${n0(S.redirect_kw)} SEMrush keywords between them, and every one of them appeared in the
    sitemap crawl — which is why earlier builds counted them as live content. They are now excluded from the
    live page count, the cluster columns, and every label.<br><br>
    <b>Method:</b> ${esc(RD.method || '')}`;
  const al = $("#anomlist"); al.innerHTML = "";
  (RD.anomalies || []).forEach(a => {
    const li = el("li");
    li.innerHTML = `<span class="u" style="font-family:inherit;font-size:12.5px">${esc(a)}</span>`; al.append(li);
  });
  const t = $("#redirtbl");
  t.innerHTML = `<thead><tr><th>Old URL</th><th>Redirects to</th><th>Cluster</th>
    <th class="num">Kw on old URL</th><th class="num">Pos</th></tr></thead><tbody></tbody>`;
  const tb = t.querySelector("tbody");
  m.map(([u, d]) => ({ u, d, p: byPath[u] }))
    .sort((a, b) => ((b.p && b.p.kw) || 0) - ((a.p && a.p.kw) || 0))
    .forEach(({ u, d, p }) => {
      const tr = el("tr");
      tr.innerHTML = `<td class="mono"><a href="https://www.1031crowdfunding.com${esc(u)}" target="_blank" rel="noopener" class="old">${esc(u)}</a></td>
       <td class="mono new">${esc(d)}</td><td>${esc(p ? effCat(p) : '—')}</td>
       <td class="num">${p && p.kw ? n0(p.kw) : '—'}</td><td class="num">${(p && p.pos) ?? '—'}</td>`;
      tb.append(tr);
    });
}

function renderWork() {
  const wt = $("#worktiles"); wt.innerHTML = "";
  const pub = CAL.filter(c => c.status === "Published").length, out = CAL.length - pub;
  [["Redirects verified", n0(S.redirects), `${S.resolved_by_redirect} groups closed by work you already did`],
  ["Your pipeline", CAL.length, `${pub} published · ${out} in outline`],
  ["Marked Review", n0(S.review), "imported from your workbook"],
  ["Marked Remove", n0(S.remove), "imported from your workbook"],
  ["Pages you've moved", n0(P.filter(isMoved).length), "manually re-clustered or re-tiered"],
  ["Pages you've marked", n0(Object.keys(ANN.pages).filter(k => !annIsEmpty(ANN.pages[k])).length),
    "status, labels or comments"],
  ].forEach(([l, v, nt]) => {
    const t = el("div", "tile");
    t.append(el("div", "lab", esc(l)), el("div", "val", v), el("div", "note", esc(nt))); wt.append(t);
  });

  const RD = DATA.redirects || { map: {}, anomalies: [] }, rg = $("#redirgap"); rg.innerHTML = "";
  const box = el("div", "card resolved"); box.style.marginBottom = "12px";
  box.append(el("h3", null, `Redirect check — verified in Chrome
    <span class="sevtag resolved">${n0(S.redirects)} redirects confirmed</span>`));
  box.append(el("div", "kv", `Every URL in the inventory tested ${esc(RD.verified || '')} · ${S.resolved_by_redirect} consolidation groups partly or fully closed by redirects you already shipped`));
  const stillOpen = (RD.confirmed_live || []).filter(u => byPath[u]);
  if (stillOpen.length) {
    const d = el("div", "workbar partial"); d.style.borderColor = "var(--serious)";
    const k401 = byPath["/use-401k-for-real-estate-investing/"], n401 = byPath["/how-to-use-401k-to-invest-in-real-estate/"];
    d.innerHTML = `<b>One genuine gap survived the re-check.</b><br>
      <span style="font-family:ui-monospace,monospace">/use-401k-for-real-estate-investing/</span>
      returns <b>200, not a redirect</b> — confirmed twice. It holds
      <b>${k401 ? n0(k401.kw) : '?'} keywords${k401 && k401.pos ? ' at #' + k401.pos : ''}</b> while the newer
      <span style="font-family:ui-monospace,monospace">/how-to-use-401k-to-invest-in-real-estate/</span>
      has ${n401 ? n0(n401.kw) : '?'}. Two live pages, near-identical titles.<br><br>
      <b>Next:</b> 301 the old URL to the new one to move those keywords across.`;
    box.append(d);
  }
  rg.append(box);

  const ct = el("table");
  ct.innerHTML = `<thead><tr><th>Status</th><th>Type</th><th>Topic</th><th class="num">Vol</th><th class="num">KD</th>
    <th>Published URL</th><th>Absorbed</th></tr></thead><tbody>${CAL.map(c => `<tr><td><span class="sevtag ${c.status === "Published" ? "resolved" : "partial"}">${esc(c.status)}</span></td>
      <td>${esc(c.ctype || '—')}</td><td>${esc(c.topic || '—')}</td>
      <td class="num">${c.vol ? n0(c.vol) : '—'}</td><td class="num">${c.kd ?? '—'}</td>
      <td class="mono">${c.url ? `<a href="https://www.1031crowdfunding.com${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>` : '<span style="color:var(--muted)">not published</span>'}</td>
      <td class="mono" style="color:var(--muted)">${c.orig.length ? c.orig.map(esc).join("<br>") : '—'}</td></tr>`).join("")}</tbody>`;
  $("#caltbl").innerHTML = ""; $("#caltbl").append(ct);

  const rev = P.filter(p => effLabels(p).includes("review")).sort((a, b) => b.kw - a.kw);
  const rem = P.filter(p => effLabels(p).includes("remove")).sort((a, b) => b.kw - a.kw);
  const mv = P.filter(isMoved).sort((a, b) => b.kw - a.kw);
  const un = P.filter(p => effLabels(p).includes("untracked")).sort((a, b) => b.kw - a.kw).slice(0, 40);
  $("#n-rev").textContent = "(" + rev.length + ")"; $("#n-rem").textContent = "(" + rem.length + ")";
  $("#n-mm").textContent = "(" + mv.length + ")"; $("#n-un").textContent = "(top 40 of " + S.untracked + ")";
  $("#mmnote").innerHTML = mv.length
    ? `Pages you dragged into a different cluster or tier. These stick through every data refresh.
       Open one and use <b>Reset to build default</b> to undo.`
    : `Nothing moved yet. Drag any page on the <b>Topic map</b> into another cluster column or tier band and it
       will be listed here.`;
  const fill = (sel, arr, ex) => { const u = $(sel); u.innerHTML = ""; arr.forEach(p => u.append(liFor(p, ex ? ex(p) : ''))); };
  fill("#revlist", rev, p => `<span class="apill" data-c="slate">${esc(effCat(p))}</span>`);
  fill("#remlist", rem);
  fill("#mmlist", mv, p => `<span class="apill" data-c="blue">${esc(p.cat)} · ${esc(TIERNAME[p.tier] || p.tier)} → ${esc(effCat(p))} · ${esc(TIERNAME[effTier(p)])}</span>`);
  fill("#unlist", un, p => `<span class="apill" data-c="slate">${esc(effCat(p))}</span>`);
  const tb = $("#tbclist"); tb.innerHTML = "";
  (DATA.to_be_created || []).forEach(t => {
    const li = el("li");
    li.innerHTML = `<span class="u">${esc(t.topic)}</span><span class="n">${esc(t.cluster)}</span>`; tb.append(li);
  });
  if (!(DATA.to_be_created || []).length) tb.innerHTML = '<li style="color:var(--muted)">None flagged.</li>';
}

/* ---------- slug table ---------- */
function renderSlugs() {
  const t = $("#slugtbl");
  t.innerHTML = `<thead><tr><th>Current slug</th><th>Suggested</th><th class="num">Its top keyword</th>
    <th class="num">Vol</th><th>Why</th></tr></thead><tbody></tbody>`;
  const tb = t.querySelector("tbody");
  [...DATA.slugs].sort((a, b) => b.vol - a.vol).forEach(s => {
    const tr = el("tr");
    tr.innerHTML = `<td class="mono"><a href="https://www.1031crowdfunding.com${esc(s.url)}" target="_blank" rel="noopener" class="old">${esc(s.url)}</a></td>
      <td class="mono new">${esc(s.suggest)}</td>
      <td>${esc(s.kw)}</td><td class="num">${s.vol ? n0(s.vol) : '—'}</td>
      <td style="color:var(--ink-2)">${esc(s.reason)}</td>`;
    tb.append(tr);
  });
}

/* ---------- all pages table ---------- */
let sortK = "kw", sortD = -1;
function renderAll() {
  const t = $("#alltbl");
  const q = ($("#q2").value || "").toLowerCase(), c = $("#fcat2").value, ti = $("#ftier2").value, ty = $("#ftype2").value;
  const an = $("#fann2") ? $("#fann2").value : "";
  let rows = P.filter(p => {
    if (c && effCat(p) !== c) return false;
    if (ti && effTier(p) !== ti) return false;
    if (ty && p.type !== ty) return false;
    if (an) { const save = F.ann; F.ann = an; const ok = matchAnn(p); F.ann = save; if (!ok) return false; }
    if (q) {
      const a = annOf(p.path);
      const inNotes = a && ((a.target || "").toLowerCase().includes(q) ||
        (a.comments || []).some(x => (x.text || "").toLowerCase().includes(q)));
      if (!(p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) ||
        (p.pkw || "").toLowerCase().includes(q) || inNotes)) return false;
    }
    return true;
  });
  const key = (p, k) => {
    if (k === "cat") return effCat(p);
    if (k === "tier") return TIERNAME[effTier(p)] || effTier(p);
    if (k === "status") return (statusById((annOf(p.path) || {}).status) || {}).name || "";
    if (k === "labels") return effLabels(p).length;
    if (k === "notes") return (annOf(p.path) || {}).updated || "";
    return p[k];
  };
  rows.sort((a, b) => {
    let x = key(a, sortK), y = key(b, sortK);
    if (x === null || x === undefined) x = sortK === "pos" ? 999 : "";
    if (y === null || y === undefined) y = sortK === "pos" ? 999 : "";
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sortD;
  });
  const cols = [["label", "Page"], ["cat", "Cluster"], ["tier", "Tier"], ["status", "Status"],
  ["type", "Type"], ["kw", "Keywords", 1], ["traffic", "Traffic", 1], ["pkw", "Top keyword"],
  ["vol", "Vol", 1], ["pos", "Pos", 1], ["labels", "Labels"], ["notes", "Notes"]];
  t.innerHTML = `<thead><tr>${cols.map(([k, l, n]) => `<th data-k="${k}" class="${n ? 'num' : ''}">${l}${sortK === k ? (sortD < 0 ? ' ↓' : ' ↑') : ''}</th>`).join("")}</tr></thead><tbody></tbody>`;
  t.querySelectorAll("th").forEach(th => th.onclick = () => {
    const k = th.dataset.k; if (sortK === k) sortD *= -1; else { sortK = k; sortD = (k === "pos") ? 1 : -1; } renderAll();
  });
  const tb = t.querySelector("tbody");
  rows.forEach(p => {
    const tr = el("tr");
    tr.innerHTML = `<td><a href="${p.url}" target="_blank" rel="noopener">${esc(p.label)}</a>
        <div class="mono" style="color:var(--muted);margin-top:2px">${esc(p.path)}</div></td>
      <td>${esc(effCat(p))}${isMoved(p) ? ' <span class="movedot" title="moved by you">↔</span>' : ''}</td>
      <td>${esc(TIERNAME[effTier(p)] || effTier(p))}</td>
      <td>${statusPill(p.path) || '<span style="color:var(--muted)">—</span>'}</td>
      <td>${esc(p.type)}</td>
      <td class="num">${p.kw ? n0(p.kw) : '—'}</td><td class="num">${p.traffic ? n0(p.traffic) : '—'}</td>
      <td>${esc(p.pkw || '—')}</td><td class="num">${p.vol ? n0(p.vol) : '—'}</td>
      <td class="num">${p.pos ?? '—'}</td>
      <td>${labelPills(p, 3) || ''}</td>
      <td style="white-space:nowrap">${noteBtnHTML(p.path)}</td>`;
    tb.append(tr);
  });
}

/* ---------- coverage ---------- */
function renderCov() {
  const rows = DATA.cats.map(c => {
    const ps = P.filter(p => effCat(p) === c);
    return {
      c, kw: ps.reduce((a, b) => a + b.kw, 0), n: ps.length,
      t: ps.filter(p => effTier(p) === "transactional").length,
      co: ps.filter(p => effTier(p) === "core").length,
      f: ps.filter(p => effTier(p) === "fanout").length
    };
  }).sort((a, b) => b.kw - a.kw);
  const max = Math.max(...rows.map(r => r.kw), 1);
  const ch = $("#chart"); ch.innerHTML = "";
  ch.append(el("div", "hbar head", `<span class="nm">Cluster</span><span></span><span class="v">Keywords</span><span class="v2">Pages</span>`));
  rows.forEach(r => {
    const d = el("div", "hbar");
    d.innerHTML = `<span class="nm">${esc(r.c)}</span>
      <span class="track"><span class="fill" style="width:${Math.max(1, 100 * r.kw / max)}%"></span></span>
      <span class="v">${n0(r.kw)}</span><span class="v2">${r.n}</span>`;
    bindTip(d, `<b>${esc(r.c)}</b><br>${n0(r.kw)} ranking keywords across ${r.n} pages<br>
      ${r.t} transactional · ${r.co} pillar · ${r.f} fan-out`);
    ch.append(d);
  });

  const st = $("#struct"); st.innerHTML = "";
  const tb = el("table");
  tb.innerHTML = `<thead><tr><th>Cluster</th><th class="num">Transactional</th><th class="num">Pillar</th>
    <th class="num">Fan-out</th><th>Structure</th></tr></thead><tbody>${rows.map(r => {
    let v, col;
    if (!r.co && r.f > 3) { v = "No pillar page — fan-out has nothing to point at"; col = "var(--critical)"; }
    else if (!r.t && r.co) { v = "No transactional page in this cluster"; col = "var(--serious)"; }
    else if (!r.co) { v = "No pillar page"; col = "var(--warning)"; }
    else v = "Complete", col = "var(--good-text)";
    return `<tr><td>${esc(r.c)}</td><td class="num">${r.t || '—'}</td><td class="num">${r.co || '—'}</td>
        <td class="num">${r.f || '—'}</td><td style="color:${col};font-weight:600">${v}</td></tr>`;
  }).join("")}</tbody>`;
  st.append(tb);
}

function renderAllViews() {
  renderHeader(); renderFilters();
  renderMatrix(); renderGroups(); renderWork(); renderRedir(); renderSlugs(); renderAll(); renderCov();
  renderNotes();
}


/* =====================================================================
   Part 3: annotation UI, label manager, notes tab, sync modal, PWA shell.
   ===================================================================== */

/* ---------------------------------------------------------- toasts ------ */
function toast(msg, bad, action) {
  const t = el("div", "toast" + (bad ? " bad" : ""));
  t.append(el("span", null, esc(msg)));
  if (action) {
    const b = el("button", "tact", esc(action.label));
    b.type = "button";
    b.onclick = () => { action.run(); t.remove(); };
    t.append(b);
    t.style.pointerEvents = "auto";
  }
  $("#toasts").append(t);
  setTimeout(() => { t.style.transition = "opacity .25s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 260); },
    bad ? 5200 : (action ? 5200 : 2600));
}

/* ---------------------------------------------------------- drawer ------ */
let openPath = null;

function openDrawer(path) {
  /* A page can vanish from the inventory (removed, renamed, 301'd) while your
     notes on it survive. Open the drawer anyway with a placeholder. */
  const p = byPath[path] || {
    label: path, path, url: "https://www.1031crowdfunding.com" + path,
    tier: "fanout", cat: DATA.cats[0], type: "Not in the current inventory", flags: [],
    kw: 0, traffic: 0, pkw: null, vol: 0, pos: null,
    trans: 0, comm: 0, info: 0, groups: [], missing: true,
  };
  openPath = path;
  $("#dtitle").textContent = p.label;
  const a = $("#dpath"); a.textContent = p.path; a.href = p.url;
  $("#dmeta").innerHTML =
    (p.missing ? `<span class="apill" data-c="red">No longer in the inventory</span>` : "") +
    `<span class="apill" data-c="slate">${esc(effCat(p))}</span>
     <span class="apill" data-c="blue">${esc(TIERNAME[effTier(p)] || effTier(p))}</span>
     ${isMoved(p) ? '<span class="apill" data-c="purple">↔ moved by you</span>' : ''}`;

  $("#dmetrics").innerHTML = `
    <div><div class="ml">Keywords</div><div class="mv">${p.kw ? n0(p.kw) : "—"}</div>
      <div class="mn">${p.traffic ? n0(p.traffic) + " est. visits/mo" : "no estimated traffic"}</div></div>
    <div><div class="ml">Top keyword</div><div class="mv" style="font-size:13px;line-height:1.35">${esc(p.pkw || "—")}</div>
      <div class="mn">${p.vol ? n0(p.vol) + "/mo · position " + (p.pos ?? "—") : "not ranking"}</div></div>
    <div><div class="ml">Intent split</div><div class="mv" style="font-size:13px">${p.trans}/${p.comm}/${p.info}</div>
      <div class="mn">transactional / commercial / informational</div></div>
    <div><div class="ml">Page type</div><div class="mv" style="font-size:13px">${esc(p.type)}</div>
      <div class="mn">${p.groups && p.groups.length ? "competes on " + p.groups.length + " term" + (p.groups.length > 1 ? "s" : "") : "no keyword overlap flagged"}</div></div>`;

  renderPlacement();
  renderStatusPicker();
  renderLabelPicker();
  const pa = annOf(path);
  $("#dtarget").value = pa ? (pa.target || "") : "";
  renderThread();
  $("#dcomment").value = "";
  $("#dsaved").textContent = "";
  $("#drawer").classList.add("on");
  $("#scrim").classList.add("on");
}

function closeDrawer() {
  $("#drawer").classList.remove("on");
  $("#scrim").classList.remove("on");
  openPath = null;
}

/* ---------- placement (cluster + tier), the tap-friendly twin of drag ---- */
function renderPlacement() {
  const p = byPath[openPath];
  const w = $("#dplacement");
  if (!p) { w.innerHTML = '<span class="emptyc">Not in the current inventory.</span>'; return; }
  const moved = isMoved(p);
  w.innerHTML = `
    <div class="prow">
      <label for="dcluster">Cluster</label>
      <select id="dcluster">${DATA.cats.map(c =>
        `<option value="${esc(c)}"${c === effCat(p) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
    </div>
    <div class="prow">
      <label for="dtier">Tier</label>
      <select id="dtier"${p.tier === "redirect" ? " disabled" : ""}>${MOVABLE_TIERS.map(t =>
        `<option value="${esc(t)}"${t === effTier(p) ? " selected" : ""}>${esc(TIERNAME[t])}</option>`).join("")}
        ${["utility", "redirect"].includes(p.tier) ? `<option value="${esc(p.tier)}" selected>${esc(TIERNAME[p.tier])}</option>` : ""}
      </select>
    </div>
    ${moved ? `<div class="phint">Build default was <b>${esc(p.cat)} · ${esc(TIERNAME[p.tier] || p.tier)}</b>.
       <button class="linkbtn" id="dreset" type="button">Reset to build default</button></div>`
      : `<div class="phint">Matches the build's own classification. Drag the page on the topic map, or change it here.</div>`}`;

  $("#dcluster").onchange = e => {
    const a = pageAnn(openPath, true);
    a.cluster = e.target.value === p.cat ? "" : e.target.value;
    touch(openPath, "cluster"); renderPlacement(); refreshViews(); flashSaved("Moved");
    $("#dmeta").querySelector(".apill").outerHTML = `<span class="apill" data-c="slate">${esc(effCat(p))}</span>`;
  };
  const dt = $("#dtier");
  if (dt) dt.onchange = e => {
    const a = pageAnn(openPath, true);
    a.tier = e.target.value === p.tier ? "" : e.target.value;
    touch(openPath, "tier"); renderPlacement(); refreshViews(); flashSaved("Moved");
  };
  const dr = $("#dreset");
  if (dr) dr.onclick = () => { resetMove(openPath); renderPlacement(); openDrawer(openPath); refreshViews(); flashSaved("Reset"); };
}

/* ---------- status ---------- */
function renderStatusPicker() {
  const cur = (annOf(openPath) || {}).status || "";
  const w = $("#dstatus"); w.innerHTML = "";
  ANN.statuses.forEach(s => {
    const b = el("button", null, esc(s.name));
    b.type = "button";
    b.dataset.c = s.color;
    b.setAttribute("aria-pressed", String(s.id === "none" ? !cur : cur === s.id));
    b.onclick = () => {
      const a = pageAnn(openPath, true);
      a.status = (s.id === "none" || a.status === s.id) ? "" : s.id;
      touch(openPath, "status"); renderStatusPicker(); refreshViews(); flashSaved();
    };
    w.append(b);
  });
}

/* ---------- labels ---------- */
function renderLabelPicker() {
  const p = byPath[openPath] || { flags: [] };
  const on = effLabels(p);
  const w = $("#dlabels"); w.innerHTML = "";
  const visible = ANN.labels.filter(l => !isHidden(l.id));
  if (!visible.length) { w.innerHTML = '<span class="emptyc">No labels in the library. Add one below.</span>'; return; }
  visible.forEach(l => {
    const auto = isDerivedOn(p, l.id);
    const b = el("button", null, esc(l.name) + (auto ? '<span class="auto" title="the build applied this automatically">auto</span>' : ''));
    b.type = "button";
    b.dataset.c = l.color || "slate";
    b.setAttribute("aria-pressed", String(on.includes(l.id)));
    b.onclick = () => { toggleLabel(l.id); renderLabelPicker(); refreshViews(); flashSaved(); };
    w.append(b);
  });
}

/* Turning a build-computed label off records it in offFlags rather than trying
   to edit data.json, so the next refresh can't quietly turn it back on. */
function toggleLabel(id) {
  const p = byPath[openPath] || { flags: [] };
  const a = pageAnn(openPath, true);
  if (isDerivedOn(p, id)) {
    const off = a.offFlags || (a.offFlags = []);
    const i = off.indexOf(id);
    if (i >= 0) off.splice(i, 1); else off.push(id);
    touch(openPath, "offFlags");
    const j = (a.labels || []).indexOf(id);
    if (j >= 0) { a.labels.splice(j, 1); touch(openPath, "labels"); }
  } else {
    const ls = a.labels || (a.labels = []);
    const i = ls.indexOf(id);
    if (i >= 0) ls.splice(i, 1); else ls.push(id);
    touch(openPath, "labels");
  }
}

const LABEL_COLORS = ["blue", "amber", "green", "purple", "teal", "pink", "red", "slate"];

function addLabel() {
  const inp = $("#dnewlabel");
  const name = inp.value.trim();
  if (!name) return;
  const id = slugId(name);
  if (isHidden(id)) ANN.hidden = ANN.hidden.filter(h => h !== id), ANN.hiddenAt = nowISO();
  if (!ANN.labels.some(l => l.id === id)) {
    ANN.labels.push({ id, name, color: LABEL_COLORS[ANN.labels.length % LABEL_COLORS.length], u: nowISO() });
  }
  touchLibrary();
  if (openPath) {
    const a = pageAnn(openPath, true);
    if (!(a.labels || []).includes(id)) { a.labels.push(id); touch(openPath, "labels"); }
  }
  inp.value = "";
  renderLabelPicker(); refreshViews(); buildAnnFilters(); flashSaved();
}

function slugId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || ("l" + uid().slice(0, 6));
}

/* ---------- label manager ---------- */
function labelUsage(id) {
  let n = 0;
  P.forEach(p => { if (effLabels(p).includes(id)) n++; });
  return n;
}

function openLabels() {
  renderLabelManager();
  $("#labelmodal").classList.add("on");
}
const closeLabels = () => $("#labelmodal").classList.remove("on");

function renderLabelManager() {
  const w = $("#lablist"); w.innerHTML = "";
  const visible = ANN.labels.filter(l => !isHidden(l.id));
  if (!visible.length) w.innerHTML = '<div class="emptyc" style="padding:8px 0">Every label has been removed. Use “Restore defaults” below.</div>';
  visible.forEach(l => {
    const row = el("div", "labrow");
    row.dataset.id = l.id;
    row.innerHTML = `
      <button class="swatch" data-c="${esc(l.color || 'slate')}" type="button" title="Change colour"></button>
      <input type="text" value="${esc(l.name)}" aria-label="Label name">
      <span class="use">${labelUsage(l.id)} page${labelUsage(l.id) === 1 ? "" : "s"}${l.derived ? " · auto" : ""}</span>
      <button class="del" type="button" title="Remove this label everywhere">Remove</button>`;
    const [sw, inp, , del] = row.children;
    sw.onclick = () => {
      const i = LABEL_COLORS.indexOf(l.color || "slate");
      l.color = LABEL_COLORS[(i + 1) % LABEL_COLORS.length];
      l.u = nowISO();
      touchLibrary(); renderLabelManager(); refreshViews();
    };
    let rt;
    inp.oninput = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const v = inp.value.trim();
        if (!v) return;
        l.name = v; l.u = nowISO();
        touchLibrary(); refreshViews(); buildAnnFilters();
      }, 400);
    };
    del.onclick = () => removeLabel(l);
    w.append(row);
  });

  const hid = (ANN.hidden || []).length;
  $("#labhidden").innerHTML = hid
    ? `${hid} label${hid > 1 ? "s" : ""} removed. <button class="linkbtn" id="labrestore" type="button">Restore defaults</button>`
    : `<button class="linkbtn" id="labrestore" type="button">Restore default labels</button>`;
  $("#labrestore").onclick = restoreLabels;
}

function removeLabel(l) {
  const n = labelUsage(l.id);
  const msg = n
    ? `Remove “${l.name}” from the library and from ${n} page${n > 1 ? "s" : ""}?`
    : `Remove “${l.name}” from the library?`;
  if (!confirm(msg + (l.derived
    ? "\n\nThis one is applied automatically by the build. Removing it stops it appearing anywhere; you can restore it later."
    : ""))) return;

  ANN.labels = ANN.labels.filter(x => x.id !== l.id);
  ANN.hidden = [...new Set([...(ANN.hidden || []), l.id])];
  ANN.hiddenAt = nowISO();
  Object.keys(ANN.pages).forEach(path => {
    const a = ANN.pages[path];
    if ((a.labels || []).includes(l.id)) {
      a.labels = a.labels.filter(x => x !== l.id);
      touch(path, "labels");
    }
  });
  touchLibrary();
  renderLabelManager(); renderLabelPicker(); refreshViews(); buildAnnFilters();
  toast(`Removed “${l.name}”`);
}

function restoreLabels() {
  ANN.hidden = []; ANN.hiddenAt = nowISO();
  ALL_DEFAULT_LABELS().forEach(d => { if (!ANN.labels.some(l => l.id === d.id)) ANN.labels.push(d); });
  touchLibrary();
  renderLabelManager(); renderLabelPicker(); refreshViews(); buildAnnFilters();
  toast("Default labels restored");
}

/* ---------- comments ---------- */
function renderThread() {
  const a = annOf(openPath);
  const list = (a && a.comments) || [];
  $("#dccount").textContent = list.length ? "(" + list.length + ")" : "";
  const ul = $("#dthread"); ul.innerHTML = "";
  if (!list.length) { ul.innerHTML = '<li style="background:none;border:0;padding:0"><span class="emptyc">No comments yet.</span></li>'; return; }
  list.forEach(c => {
    const li = el("li");
    const when = new Date(c.ts);
    li.innerHTML = `<div class="cmeta"><b>${esc(c.author || "You")}</b>
        <span>${isNaN(when) ? "" : when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        <button class="cdel" data-del="${esc(c.id)}" type="button">delete</button></span></div>
      <div class="ctext">${esc(c.text)}</div>`;
    ul.append(li);
  });
  ul.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    const a2 = pageAnn(openPath, true);
    const id = b.dataset.del;
    a2.comments = (a2.comments || []).filter(c => c.id !== id);
    a2.delc = [...new Set([...(a2.delc || []), id])];
    touch(openPath); renderThread(); refreshViews();
  });
}

function postComment() {
  const ta = $("#dcomment");
  const text = ta.value.trim();
  if (!text) return;
  const a = pageAnn(openPath, true);
  a.comments = a.comments || [];
  a.comments.push({
    id: uid(), ts: nowISO(),
    author: (Sync.config() && Sync.config().author) || ANN.author || "You",
    text,
  });
  ta.value = "";
  touch(openPath); renderThread(); refreshViews(); flashSaved("Comment added");
}

let savedTimer;
function flashSaved(m) {
  const s = $("#dsaved");
  if (!s) return;
  s.textContent = m || "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { s.textContent = ""; }, 1800);
}

/* --------------------------------------------------------- notes tab ---- */
function renderNotes() {
  const paths = Object.keys(ANN.pages).filter(p => !annIsEmpty(ANN.pages[p]));
  $("#c-notes").textContent = paths.length ? "(" + paths.length + ")" : "";

  const nt = $("#notetiles"); nt.innerHTML = "";
  const cCount = paths.reduce((n, p) => n + (ANN.pages[p].comments || []).length, 0);
  const byStatus = {};
  paths.forEach(p => { const s = ANN.pages[p].status; if (s) byStatus[s] = (byStatus[s] || 0) + 1; });
  const topStatus = Object.entries(byStatus).sort((a, b) => b[1] - a[1])[0];
  const kwCovered = paths.reduce((n, p) => n + ((byPath[p] || {}).kw || 0), 0);
  [["Pages you've marked", n0(paths.length), `of ${n0(S.total)} live pages`],
  ["Comments", n0(cCount), "across all pages"],
  ["Keywords under management", n0(kwCovered), `${S.keywords ? Math.round(100 * kwCovered / S.keywords) : 0}% of your ranking keywords`],
  ["Most common status", topStatus ? (statusById(topStatus[0]) || {}).name || "—" : "—",
    topStatus ? topStatus[1] + " page" + (topStatus[1] > 1 ? "s" : "") : "nothing marked yet", true],
  ].forEach(([l, v, n, isText]) => {
    const t = el("div", "tile");
    t.append(el("div", "lab", esc(l)), el("div", "val" + (isText ? " txt" : ""), esc(v)), el("div", "note", esc(n)));
    nt.append(t);
  });

  const ss = $("#nstatus"), sl = $("#nlabel");
  const keepS = ss.value, keepL = sl.value;
  ss.innerHTML = '<option value="">Any status</option>' +
    ANN.statuses.filter(s => s.id !== "none").map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  sl.innerHTML = '<option value="">Any label</option>' +
    ANN.labels.filter(l => !isHidden(l.id)).map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  ss.value = keepS; sl.value = keepL;

  const q = ($("#nq").value || "").toLowerCase();
  const fs = ss.value, fl = sl.value, sort = $("#nsort").value;
  let rows = paths.filter(p => {
    const a = ANN.pages[p];
    const pg = byPath[p];
    if (fs && a.status !== fs) return false;
    if (fl && !(pg ? effLabels(pg) : (a.labels || [])).includes(fl)) return false;
    if (q) {
      const hay = [p, (pg || {}).label || "", a.target || "", ...(a.comments || []).map(c => c.text)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  rows.sort((x, y) => {
    if (sort === "path") return x.localeCompare(y);
    if (sort === "kw") return ((byPath[y] || {}).kw || 0) - ((byPath[x] || {}).kw || 0);
    if (sort === "traffic") return ((byPath[y] || {}).traffic || 0) - ((byPath[x] || {}).traffic || 0);
    return String(ANN.pages[y].updated || "").localeCompare(String(ANN.pages[x].updated || ""));
  });

  const w = $("#notelist"); w.innerHTML = "";
  if (!rows.length) {
    w.innerHTML = `<div class="card" style="grid-column:1/-1"><h3>Nothing here yet</h3>
      <p style="color:var(--ink-2);font-size:13px;line-height:1.65">Open any page from the
      <b>Topic map</b> or <b>All pages</b> tab and click the <span class="notebtn" style="cursor:default">✎</span>
      button to set a status, apply labels, or leave a comment. Everything you write is keyed to the URL, so the
      weekly data refresh updates the metrics without touching your notes.</p></div>`;
    return;
  }
  rows.forEach(path => {
    const a = ANN.pages[path], pg = byPath[path];
    const last = (a.comments || [])[(a.comments || []).length - 1];
    const c = el("div", "notecard" + (pg ? "" : " gonecard"));
    c.innerHTML = `<div class="nh">
        <div><div class="nt">${esc((pg || {}).label || path)}</div><div class="np">${esc(path)}</div></div>
        <div class="nkw">${pg && pg.kw ? n0(pg.kw) + " kw" : "0 kw"}${pg && pg.pos ? " · #" + pg.pos : ""}</div>
      </div>
      <div class="nb">${pg ? "" : '<span class="apill" data-c="red">not in inventory</span>'}
        ${pg && isMoved(pg) ? '<span class="apill" data-c="purple">↔ moved</span>' : ''}
        ${statusPill(path)}${pg ? labelPills(pg, 6) : ''}
        ${(a.comments || []).length ? `<span class="apill" data-c="slate">${(a.comments || []).length} comment${(a.comments || []).length > 1 ? "s" : ""}</span>` : ""}</div>
      ${a.target ? `<div class="nc"><b>Target:</b> ${esc(a.target)}</div>` : ""}
      ${last ? `<div class="nc">${esc(last.text.length > 240 ? last.text.slice(0, 240) + "…" : last.text)}</div>` : ""}`;
    c.onclick = () => openDrawer(path);
    w.append(c);
  });
}

/* ------------------------------------------------------ export / import - */
function exportNotes() {
  const blob = new Blob([JSON.stringify(ANN, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "1031cf-content-map-notes-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function importNotes(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const inc = JSON.parse(r.result);
      if (!inc || typeof inc !== "object" || !inc.pages) throw new Error("Not a notes file");
      ANN = mergeAnn(ANN, inc);
      saveLocal(); Sync.schedule(); refreshViews(); buildAnnFilters();
      toast("Notes merged — nothing was overwritten");
    } catch (e) { toast("Couldn't read that file: " + e.message, true); }
  };
  r.readAsText(file);
}

/* ------------------------------------------------------- sync modal ----- */
function openSync() {
  const c = Sync.config() || {};
  $("#syowner").value = c.owner || "";
  $("#syrepo").value = c.repo || "";
  $("#sybranch").value = c.branch || "main";
  $("#sypath").value = c.path || "annotations.json";
  $("#sytoken").value = c.token || "";
  $("#syauthor").value = c.author || ANN.author || "";
  $("#systatus").textContent = ""; $("#systatus").className = "status";
  $("#syncmodal").classList.add("on");
  setTimeout(() => $("#syowner").focus(), 60);
}
const closeSync = () => $("#syncmodal").classList.remove("on");

function readSyncForm() {
  return {
    owner: $("#syowner").value.trim(),
    repo: $("#syrepo").value.trim(),
    branch: $("#sybranch").value.trim() || "main",
    path: ($("#sypath").value.trim() || "annotations.json").replace(/^\/+/, ""),
    token: $("#sytoken").value.trim(),
    author: $("#syauthor").value.trim(),
  };
}

function syStatus(msg, cls) { const s = $("#systatus"); s.textContent = msg; s.className = "status " + (cls || ""); }

/* --------------------------------------------------------- refresh ------ */
async function loadData(force) {
  const r = await fetch("data.json", { cache: force ? "reload" : "default" });
  if (!r.ok) throw new Error("data.json returned " + r.status);
  return r.json();
}

async function refreshData(manual) {
  const btn = $("#refresh");
  const old = btn.innerHTML;
  btn.innerHTML = '<span class="spin"></span>Refreshing';
  btn.disabled = true;
  try {
    if (!navigator.onLine) throw new Error("You're offline");
    const prev = DATA && DATA.stats && DATA.stats.generated;
    const d = await loadData(true);
    bindData(d);
    await STORE.set("data", d);
    await Sync.pull(true);
    renderAllViews();
    buildAnnFilters();
    if (manual) {
      toast(prev && prev === d.stats.generated
        ? "Already up to date — data as of " + d.stats.generated
        : "Updated — data as of " + d.stats.generated);
    }
  } catch (e) {
    if (manual) toast("Couldn't refresh: " + (e.message || e), true);
  } finally { btn.innerHTML = old; btn.disabled = false; }
}

function refreshViews() {
  if (!DATA) return;
  renderHeader();
  renderMatrix(); renderGroups(); renderWork(); renderAll(); renderCov(); renderNotes();
}
window.onAnnotationsChanged = () => { refreshViews(); buildAnnFilters(); };

/* ------------------------------------------------------------ wiring ---- */
function wire() {
  /* delegated: any ✎ button anywhere opens the drawer */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-note]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    openDrawer(b.dataset.note);
  }, true);

  $("#dclose").onclick = closeDrawer;
  $("#scrim").onclick = closeDrawer;
  addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if ($("#labelmodal").classList.contains("on")) closeLabels();
      else if ($("#syncmodal").classList.contains("on")) closeSync();
      else if ($("#drawer").classList.contains("on")) closeDrawer();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && $("#drawer").classList.contains("on")) postComment();
  });

  $("#dpost").onclick = postComment;
  $("#daddlabel").onclick = addLabel;
  $("#dnewlabel").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } };
  $("#dmanage").onclick = openLabels;
  let tt;
  $("#dtarget").oninput = () => {
    const path = openPath; if (!path) return;
    clearTimeout(tt);
    tt = setTimeout(() => {
      const a = pageAnn(path, true);
      a.target = $("#dtarget").value;
      touch(path, "target"); refreshViews(); flashSaved();
    }, 500);
  };
  $("#dclear").onclick = () => {
    if (!openPath) return;
    const a = annOf(openPath);
    if (!a) { closeDrawer(); return; }
    if (!confirm("Remove the status, labels, target, placement and all comments for this page? This can't be undone.")) return;
    const ids = (a.comments || []).map(c => c.id);
    const t = nowISO();
    ANN.pages[openPath] = {
      status: "", labels: [], target: "", cluster: "", tier: "", offFlags: [], comments: [],
      delc: [...(a.delc || []), ...ids],
      f: { status: t, labels: t, target: t, cluster: t, tier: t, offFlags: t }, updated: t,
    };
    ANN.updated = t;
    saveLocal(); Sync.schedule();
    openDrawer(openPath);
    refreshViews(); toast("Notes cleared for this page");
  };

  /* label manager */
  $("#labclose").onclick = closeLabels;
  $("#labdone").onclick = closeLabels;
  $("#labelmodal").onclick = e => { if (e.target === $("#labelmodal")) closeLabels(); };
  $("#labnewbtn").onclick = () => {
    const v = $("#labnew").value.trim();
    if (!v) return;
    const id = slugId(v);
    ANN.hidden = (ANN.hidden || []).filter(h => h !== id); ANN.hiddenAt = nowISO();
    if (!ANN.labels.some(l => l.id === id))
      ANN.labels.push({ id, name: v, color: LABEL_COLORS[ANN.labels.length % LABEL_COLORS.length], u: nowISO() });
    $("#labnew").value = "";
    touchLibrary(); renderLabelManager(); renderLabelPicker(); refreshViews(); buildAnnFilters();
  };
  $("#labnew").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#labnewbtn").click(); } };

  /* notes tab controls */
  ["#nq", "#nstatus", "#nlabel", "#nsort"].forEach(s => $(s).oninput = renderNotes);
  $("#annexport").onclick = exportNotes;
  $("#annimport").onclick = () => $("#annfile").click();
  $("#annfile").onchange = e => { if (e.target.files[0]) importNotes(e.target.files[0]); e.target.value = ""; };
  $("#annlabels").onclick = openLabels;

  /* filters */
  $("#q").oninput = e => { F.q = e.target.value; renderMatrix(); };
  $("#fcat").onchange = e => { F.cat = e.target.value; renderMatrix(); };
  $("#fann").onchange = e => { F.ann = e.target.value; renderMatrix(); };
  ["#q2", "#fcat2", "#ftier2", "#ftype2", "#fann2"].forEach(s => { const n = $(s); if (n) n.oninput = renderAll; });

  document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => {
    document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["map", "attn", "work", "notes", "redir", "slug", "all", "cov", "src"].forEach(t => {
      const n = $("#tab-" + t); if (n) n.classList.toggle("hide", t !== b.dataset.tab);
    });
    if (b.dataset.tab === "notes") renderNotes();
  });

  $("#theme").onclick = () => {
    const d = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = d ? "light" : "dark";
    $("#theme").textContent = d ? "Dark" : "Light";
    document.querySelector('meta[name="theme-color"]').content = d ? "#f9f9f7" : "#0d0d0d";
    STORE.set("theme", d ? "light" : "dark");
  };

  $("#density").onclick = () => {
    const compact = document.body.dataset.density === "compact";
    document.body.dataset.density = compact ? "detailed" : "compact";
    $("#density").textContent = compact ? "Compact" : "Detailed";
    STORE.set("density", document.body.dataset.density);
    renderMatrix();
  };

  $("#csv").onclick = () => {
    const h = ["path", "label", "cluster", "tier", "cluster_from_build", "tier_from_build", "moved_by_you",
      "type", "keywords", "traffic", "primary_keyword", "volume", "position",
      "status", "labels", "target", "comments"];
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const csv = [h.join(",")].concat(P.map(p => {
      const a = annOf(p.path) || {};
      return [p.path, p.label, effCat(p), TIERNAME[effTier(p)] || effTier(p), p.cat, TIERNAME[p.tier] || p.tier,
      isMoved(p) ? "yes" : "no", p.type, p.kw, p.traffic, p.pkw, p.vol, p.pos,
      (statusById(a.status) || {}).name || "",
      effLabels(p).map(id => (labelById(id) || {}).name || id).join("|"),
        a.target || "",
      (a.comments || []).map(c => `${c.author}: ${c.text}`).join(" ⏎ ")].map(q).join(",");
    })).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "1031cf-content-map.csv"; a.click();
  };

  $("#refresh").onclick = () => refreshData(true);

  /* sync modal */
  $("#syncchip").onclick = openSync;
  $("#sycancel").onclick = closeSync;
  $("#syncmodal").onclick = e => { if (e.target === $("#syncmodal")) closeSync(); };
  $("#sytest").onclick = async () => {
    const c = readSyncForm();
    if (!c.owner || !c.repo || !c.token) { syStatus("Owner, repository and token are all required.", "bad"); return; }
    syStatus("Testing…");
    try {
      const r = await Sync.test(c);
      syStatus(`Connected to ${r.repo}${r.priv ? " (private)" : " (public)"} — write access confirmed.`, "ok");
    } catch (e) { syStatus(e.message, "bad"); }
  };
  $("#sysave").onclick = async () => {
    const c = readSyncForm();
    if (!c.owner || !c.repo || !c.token) { syStatus("Owner, repository and token are all required.", "bad"); return; }
    syStatus("Connecting…");
    try {
      await Sync.test(c);
      ANN.author = c.author || ANN.author;
      await Sync.save(c);
      await Sync.push();
      refreshViews();
      closeSync();
      toast("Sync connected — your notes are now backed up");
    } catch (e) { syStatus(e.message, "bad"); }
  };
  $("#sydisconnect").onclick = async () => {
    await Sync.disconnect();
    closeSync();
    toast("Disconnected — notes stay on this device");
  };

  Sync.on((state, msg) => {
    const c = $("#syncchip");
    if (!c) return;
    c.dataset.s = state;
    c.querySelector("span.stxt").textContent =
      state === "synced" ? "Synced" : state === "pending" ? "Saving…" :
        state === "error" ? "Sync issue" : state === "offline" ? "Offline" : "Local only";
    c.title = msg;
  });

  /* collapsible intro banner on narrow screens (re-rendered by renderHeader) */
  document.addEventListener("click", e => {
    const b = e.target.closest(".bantoggle");
    if (!b) return;
    const c = $("#topbanner").classList.toggle("clamped");
    b.textContent = c ? "Read more" : "Show less";
  });

  addEventListener("online", () => $("#offlinebar").classList.remove("on"));
  addEventListener("offline", () => $("#offlinebar").classList.add("on"));
  if (!navigator.onLine) $("#offlinebar").classList.add("on");
}

/* -------------------------------------------------------- PWA shell ----- */
let deferredPrompt = null;
addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $("#install");
  if (b) { b.style.display = ""; b.onclick = async () => { b.style.display = "none"; deferredPrompt.prompt(); deferredPrompt = null; }; }
});
addEventListener("appinstalled", () => { const b = $("#install"); if (b) b.style.display = "none"; });

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").then(reg => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          const bar = $("#updatebar");
          bar.classList.add("on");
          $("#doupdate").onclick = () => { nw.postMessage({ type: "SKIP_WAITING" }); };
        }
      });
    });
    setInterval(() => reg.update(), 60 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return; reloading = true; location.reload();
  });
}

/* ------------------------------------------------------------- boot ----- */
(async function boot() {
  try {
    const theme = await STORE.get("theme");
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.dataset.theme = "dark";
    document.querySelector('meta[name="theme-color"]').content = dark ? "#0d0d0d" : "#f9f9f7";
    document.body.dataset.density = (await STORE.get("density")) || "detailed";

    const stored = await STORE.get("annotations");
    if (stored && stored.pages) {
      ANN = mergeAnn(emptyAnn(), migrate(stored));
      ANN.labels = ANN.labels.filter(l => !isHidden(l.id));
    }

    await Sync.load();

    let d = null;
    try { d = await loadData(false); await STORE.set("data", d); }
    catch (e) { d = await STORE.get("data"); if (!d) throw e; }
    bindData(d);

    if (dark) $("#theme").textContent = "Light";
    if (document.body.dataset.density === "compact") $("#density").textContent = "Detailed";

    wire();
    renderAllViews();
    buildAnnFilters();
    $("#boot").classList.add("off");

    registerSW();
    Sync.pull(true).then(() => { buildAnnFilters(); refreshViews(); });
  } catch (e) {
    $("#boot").innerHTML = `<div class="berr"><b>Couldn't load the content map.</b><br><br>
      ${esc(e.message || String(e))}<br><br>
      If this is the first time you've opened the app, check that <code>data.json</code> sits next to
      <code>index.html</code> on the server. Otherwise try reloading — an offline copy is kept after the
      first successful load.</div>`;
  }
})();

/* v1 documents had a "redirect" label meaning "needs a 301"; v2 uses that id for
   the build-computed "this URL redirects" label and calls the manual one
   "needs301". Rename it so both survive. */
function migrate(a) {
  if ((a.version || 1) >= 2) return a;
  const old = (a.labels || []).find(l => l.id === "redirect" && /needs/i.test(l.name || ""));
  if (old) {
    old.id = "needs301";
    Object.values(a.pages || {}).forEach(p => {
      p.labels = (p.labels || []).map(x => (x === "redirect" ? "needs301" : x));
    });
  }
  a.version = 2;
  return a;
}

function buildAnnFilters() {
  const opts = () => '<option value="">Any of my notes</option>' +
    '<option value="__any">Has notes</option>' +
    '<option value="__none">No notes</option>' +
    '<option value="__comment">Has comments</option>' +
    '<option value="__moved">Moved by me</option>' +
    '<optgroup label="Status">' + ANN.statuses.filter(s => s.id !== "none")
      .map(s => `<option value="s:${esc(s.id)}">${esc(s.name)}</option>`).join("") + '</optgroup>' +
    '<optgroup label="Label">' + ANN.labels.filter(l => !isHidden(l.id))
      .map(l => `<option value="l:${esc(l.id)}">${esc(l.name)}</option>`).join("") + '</optgroup>';
  [["#fann", F.ann], ["#fann2", $("#fann2") ? $("#fann2").value : ""]].forEach(([sel, keep]) => {
    const n = $(sel); if (!n) return;
    n.innerHTML = opts(); n.value = keep || "";
  });
}
