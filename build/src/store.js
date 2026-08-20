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
/* `none` is the clear-the-status button, not a status: it can't be renamed,
   recoloured or removed. `o` is the display order, which is meaningful here in a
   way it isn't for labels — these are the steps of a workflow. */
const DEFAULT_STATUSES = [
  { id: "none",       name: "No status",     color: "slate",  fixed: true, o: -1 },
  { id: "todo",       name: "To do",         color: "slate",  o: 0 },
  { id: "inprogress", name: "In progress",   color: "amber",  o: 1 },
  { id: "drafted",    name: "Drafted",       color: "purple", o: 2 },
  { id: "published",  name: "Published",     color: "green",  o: 3 },
  { id: "monitoring", name: "Monitoring",    color: "blue",   o: 4 },
  { id: "blocked",    name: "Blocked",       color: "red",    o: 5 },
  { id: "wontdo",     name: "Won't do",      color: "slate",  o: 6 },
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
  hiddenS: [],           // status ids removed from the library
  hiddenSAt: new Date(0).toISOString(),
  /* Results of the in-app redirect check, keyed by path:
     { "/path/": { s: "redirect" | "live", at: ISO } }
     This is deliberately separate from `pages` — it's an observation about the
     site, not an annotation, and it is what lets the app reflect a redirect you
     shipped an hour ago without waiting for a SEMrush rebuild. */
  live: {},
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
    hiddenS: ((a.hiddenSAt || "") >= (b.hiddenSAt || "") ? a.hiddenS : b.hiddenS) || [],
    hiddenSAt: (a.hiddenSAt || "") >= (b.hiddenSAt || "") ? (a.hiddenSAt || "") : (b.hiddenSAt || ""),
    live: mergeLive(a.live, b.live),
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

/* Per-URL last-write-wins on the observation timestamp: whichever device checked
   most recently is the one telling the truth about that URL. */
function mergeLive(x, y) {
  const out = {};
  new Set([...Object.keys(x || {}), ...Object.keys(y || {})]).forEach(k => {
    const m = (x || {})[k], n = (y || {})[k];
    if (!m) { out[k] = n; return; }
    if (!n) { out[k] = m; return; }
    out[k] = (m.at || "") >= (n.at || "") ? m : n;
  });
  return out;
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
          /* the push merged the remote in first, so the other device's edits may
             have landed — let the UI redraw against them */
          if (typeof window.onAnnotationsChanged === "function") window.onAnnotationsChanged();
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
