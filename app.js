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

const DEFAULT_LABELS = [
  { id: "rewrite",     name: "Rewrite",            color: "red"    },
  { id: "refresh",     name: "Refresh content",    color: "amber"  },
  { id: "consolidate", name: "Consolidate",        color: "red"    },
  { id: "titlemeta",   name: "Title / meta",       color: "amber"  },
  { id: "schema",      name: "Add schema",         color: "purple" },
  { id: "aeo-answer",  name: "AEO: direct answer", color: "teal"   },
  { id: "aeo-faq",     name: "AEO: FAQ block",     color: "teal"   },
  { id: "intlinks",    name: "Internal links",     color: "blue"   },
  { id: "eeat",        name: "E-E-A-T / author",   color: "purple" },
  { id: "redirect",    name: "Needs 301",          color: "red"    },
  { id: "keep",        name: "Keep as-is",         color: "green"  },
  { id: "priority",    name: "Priority",           color: "pink"   },
];

const emptyAnn = () => ({
  version: 1,
  updated: new Date(0).toISOString(),
  author: "",
  statuses: DEFAULT_STATUSES.slice(),
  labels: DEFAULT_LABELS.slice(),
  pages: {},
});

let ANN = emptyAnn();

const nowISO = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9));

function pageAnn(path, create) {
  let a = ANN.pages[path];
  if (!a && create) {
    a = ANN.pages[path] = { status: "", labels: [], target: "", comments: [], delc: [], f: {}, updated: nowISO() };
  }
  if (a && !a.f) a.f = {};
  return a;
}

function annIsEmpty(a) {
  return !a || (!a.status && !(a.labels || []).length && !(a.target || "").trim() && !(a.comments || []).length);
}

/* `field` is one of status | labels | target. Comments carry their own ids and
   tombstones, so they don't need a field clock. */
function touch(path, field) {
  const a = pageAnn(path, true);
  a.updated = nowISO();
  if (field) a.f[field] = a.updated;
  ANN.updated = a.updated;
  if (annIsEmpty(a) && !(a.delc || []).length) delete ANN.pages[path];
  saveLocal();
  Sync.schedule();
}

function saveLocal() { return STORE.set("annotations", ANN); }

/* Merge two annotation documents.

   Fields (status / labels / target) resolve independently on their own
   timestamps, so commenting on a laptop can't wipe a status set on a phone.
   Comments are unioned by id with tombstones honoured; the status and label
   libraries are unioned by id. */
function mergeAnn(a, b) {
  const out = {
    version: 1,
    updated: (a.updated > b.updated ? a.updated : b.updated),
    author: a.author || b.author || "",
    statuses: unionById(a.statuses, b.statuses),
    labels: unionById(a.labels, b.labels),
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
    const isSet = (o, k) => k === "labels" ? (o.labels || []).length > 0 : !!(o[k] || "").trim?.();
    const fts = (o, k) => (o.f && o.f[k]) || (isSet(o, k) ? (o.updated || "") : "");
    const pick = k => (fts(x, k) >= fts(y, k) ? x : y);
    const f = {};
    ["status", "labels", "target"].forEach(k => {
      const t = fts(x, k) >= fts(y, k) ? fts(x, k) : fts(y, k);
      if (t) f[k] = t;
    });

    out.pages[p] = {
      status: pick("status").status || "",
      labels: pick("labels").labels || [],
      target: pick("target").target || "",
      comments, delc, f,
      updated: (x.updated || "") >= (y.updated || "") ? x.updated : y.updated,
    };
  });
  return out;
}

function normPage(p) {
  return {
    status: p.status || "", labels: p.labels || [], target: p.target || "",
    comments: (p.comments || []).filter(c => !(p.delc || []).includes(c.id)),
    delc: p.delc || [], f: p.f || {}, updated: p.updated || "",
  };
}

function unionById(x, y) {
  const m = new Map();
  [...(y || []), ...(x || [])].forEach(o => { if (o && o.id) m.set(o.id, o); });
  return [...m.values()];
}

/* ---------------------------------------------------------- GitHub sync -- */
const Sync = (() => {
  let cfg = null;          // {owner, repo, branch, path, token, author}
  let sha = null;
  let state = "local";     // local | synced | pending | error | offline
  let msg = "Saved on this device only";
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
    if (!connected()) { set("local", "Saved on this device only"); return; }
    await pull(true);
  }

  async function disconnect() {
    cfg = null; sha = null;
    await STORE.del("sync");
    set("local", "Saved on this device only");
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
        set("local", "Saved on this device only");
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
    if (!connected()) { set("local", "Saved on this device only"); return; }
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
   Part 2: dashboard rendering. Same views as the original single-file
   build, with the annotation layer woven in.
   ===================================================================== */

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => (v || 0).toLocaleString('en-US');
const TIERS = [["transactional", "Transactional page"], ["core", "Core page"], ["fanout", "Fan-out pages"], ["utility", "Site / utility"], ["redirect", "Redirects (not live)"]];
const FLAGLAB = {
  review: "Review", remove: "Remove", consolidate: "Consolidate", slug: "Slug fix",
  underperform: "Underperformer", tiermismatch: "Tier ≠ yours", untracked: "Untracked", nokw: "No keywords",
  redirect: "301"
};

let DATA = null, P = [], S = {}, CAL = [], byPath = {};

function bindData(d) {
  DATA = d;
  P = DATA.pages; S = DATA.stats; CAL = DATA.calendar || [];
  byPath = Object.fromEntries(P.map(p => [p.path, p]));
}

/* ---------- annotation helpers used by the views ---------- */
const statusById = id => (ANN.statuses || []).find(s => s.id === id);
const labelById  = id => (ANN.labels || []).find(l => l.id === id);
const annOf      = path => ANN.pages[path];

function annBadges(path, max) {
  const a = annOf(path); if (!a) return "";
  const out = [];
  if (a.status && a.status !== "none") {
    const st = statusById(a.status);
    if (st) out.push(`<span class="apill" data-c="${esc(st.color)}"><span class="adot"></span>${esc(st.name)}</span>`);
  }
  (a.labels || []).forEach(id => {
    const l = labelById(id);
    if (l) out.push(`<span class="apill" data-c="${esc(l.color)}">${esc(l.name)}</span>`);
  });
  if (max && out.length > max) {
    const extra = out.length - max;
    return out.slice(0, max).join("") + `<span class="apill" data-c="slate">+${extra}</span>`;
  }
  return out.join("");
}

function noteBtnHTML(path) {
  const a = annOf(path);
  const n = a ? (a.comments || []).length : 0;
  const has = a && !annIsEmpty(a);
  return `<button class="notebtn${has ? " has" : ""}" data-note="${esc(path)}" type="button"
    title="Labels and comments">✎${n ? " " + n : ""}</button>`;
}

/* ---------- header / tiles ---------- */
function renderHeader() {
  $("#topbanner").innerHTML = `<span>⚠</span><div style="flex:1"><div class="btext"><b>Read before using:</b> URLs, keyword counts, positions and
    search volumes are live SEMrush + sitemap data. Your <b>Review / Remove</b> statuses and editorial-calendar
    pipeline are imported from your keyword workbook — ${n0(S.review)} Review, ${n0(S.remove)} Remove, and
    ${S.resolved_groups + S.partial_groups} consolidation groups you've already worked.
    <br><b>Correction (2026-08-03):</b> an earlier build claimed your published consolidations were missing their
    301s. That was wrong. Re-tested properly in Chrome: ${n0(S.redirects)} of ${n0(S.crawled)} crawled URLs return a
    server-level HTTP redirect — including both DST URLs and the California one — and are now excluded from every
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

  const TILES = [
    ["Live pages", n0(S.total), `${S.transactional} transactional · ${S.core} core · ${S.fanout} fan-out`],
    ["Verified redirects", n0(S.redirects), `of ${n0(S.crawled)} URLs crawled — excluded from all counts`],
    ["Ranking keywords", n0(S.keywords), `across ${S.ranking} pages with at least one ranking`],
    ["Est. monthly organic visits", n0(S.traffic), "SEMrush estimate, US database"],
    ["Marked “Review” by you", n0(S.review), `plus ${S.remove} marked Remove`],
    ["Not in your sheet", n0(S.untracked), `${S.tracked} of ${S.total} pages are tracked`],
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

let F = { q: "", cat: "", flag: "", ann: "" };

function matchAnn(p) {
  if (!F.ann) return true;
  const a = annOf(p.path);
  if (F.ann === "__any") return !!a && !annIsEmpty(a);
  if (F.ann === "__none") return !a || annIsEmpty(a);
  if (F.ann === "__comment") return !!a && (a.comments || []).length > 0;
  if (F.ann.startsWith("s:")) return !!a && a.status === F.ann.slice(2);
  if (F.ann.startsWith("l:")) return !!a && (a.labels || []).includes(F.ann.slice(2));
  return true;
}

function match(p) {
  if (F.cat && p.cat !== F.cat) return false;
  if (F.flag && !p.flags.includes(F.flag)) return false;
  if (!matchAnn(p)) return false;
  if (F.q) {
    const q = F.q.toLowerCase();
    const a = annOf(p.path);
    const inNotes = a && ((a.target || "").toLowerCase().includes(q) ||
      (a.comments || []).some(c => (c.text || "").toLowerCase().includes(q)));
    if (!(p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) ||
      (p.pkw || "").toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) || inNotes)) return false;
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
  return `<b>${esc(p.label)}</b><br><span style="opacity:.7">${esc(p.path)}</span><br><br>
    Keywords: <b>${n0(p.kw)}</b> · Est. traffic: <b>${n0(p.traffic)}</b><br>
    ${p.pkw ? `Top keyword: <b>${esc(p.pkw)}</b><br>Volume ${n0(p.vol)}/mo · position ${p.pos}<br>` : ''}
    ${p.trans || p.comm ? `Intent: ${p.trans} transactional / ${p.comm} commercial / ${p.info} informational<br>` : ''}
    ${p.sheet_topic ? `<br>Your sheet: “${esc(p.sheet_topic)}” under <b>${esc(p.sheet_cluster)}</b>${p.sheet_status ? ` · marked <b>${esc(p.sheet_status)}</b>` : ''}` : '<br>Not in your tracking sheet'}
    ${p.kw_check ? `<br>Your sheet cyan-flagged this keyword count` : ''}
    ${p.tier_mismatch ? `<br>⇄ Your sheet has this as <b>${esc(p.tier_mismatch)}</b>, I inferred <b>${esc(p.tier)}</b>` : ''}
    ${p.groups.length ? `<br>⚠ Competes on: ${p.groups.map(esc).join('; ')}` : ''}
    ${p.slug_suggest ? `<br>✎ Suggested slug: <b>${esc(p.slug_suggest)}</b>` : ''}
    ${a && !annIsEmpty(a) ? `<br><br><span style="opacity:.7">Your notes:</span> ${annBadges(p.path, 4) || '—'}${(a.comments || []).length ? `<br>${(a.comments || []).length} comment${(a.comments || []).length > 1 ? 's' : ''}` : ''}` : ''}`;
}

/* ---------- matrix ---------- */
function renderMatrix() {
  const m = $("#matrix"); m.innerHTML = "";
  const maxkw = Math.max(...P.map(p => p.kw), 1);
  DATA.cats.forEach(cat => {
    const inCat = P.filter(p => p.cat === cat && match(p));
    const all = P.filter(p => p.cat === cat);
    const col = el("div", "col");
    const h = el("div", "col-h");
    h.append(el("div", "nm", esc(cat)),
      el("div", "mt", `${all.length} pages · ${n0(all.reduce((a, b) => a + b.kw, 0))} keywords`));
    col.append(h);
    let any = false;
    TIERS.forEach(([tk, tl]) => {
      const rows = inCat.filter(p => p.tier === tk).sort((a, b) => b.kw - a.kw || a.label.localeCompare(b.label));
      if (!rows.length) return;
      any = true;
      col.append(el("div", "tierlab " + tk, `${esc(tl)} <span style="color:var(--muted);font-weight:400">${rows.length}</span>`));
      rows.forEach(p => {
        const a = el("a", "cell" + (p.tier === "redirect" ? " isredir" : "")); a.href = p.url; a.target = "_blank"; a.rel = "noopener";
        const pills = p.flags.map(f => `<span class="pill ${f}">${FLAGLAB[f]}</span>`).join("");
        a.innerHTML = `<div class="ttl"><span class="txt">${esc(p.label)}</span>
            <span class="kw${p.kw ? '' : ' zero'}">${p.kw ? n0(p.kw) : '—'}</span></div>
          <div class="bar${p.kw ? '' : ' empty'}" style="width:${p.kw ? Math.max(3, Math.round(100 * Math.sqrt(p.kw) / Math.sqrt(maxkw))) : 100}%"></div>
          <div class="meta">${noteBtnHTML(p.path)}<span class="typ">${esc(p.type)}</span>${pills}${annBadges(p.path, 3)}</div>`;
        bindTip(a, tipFor(p));
        col.append(a);
      });
    });
    if (!any) col.append(el("div", "empty-col", "No pages match the current filter."));
    m.append(col);
  });
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
      const p = byPath[u] || { kw: 0, pos: null, sheet_status: null };
      const gone = w && w.merged.includes(u);
      const li = el("li", (u === gr.keep ? "keep" : "") + (gone ? " gone" : ""));
      li.innerHTML = `${u === gr.keep ? '<span class="kp">keep</span>' : ''}
        ${gone ? `<span class="kp" style="color:var(--good-text)">${(gr.redirected || []).includes(u) ? '301' : 'merged'}</span>` : ''}
        <a class="u" href="https://www.1031crowdfunding.com${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>
        ${p.sheet_status ? `<span class="pill ${p.sheet_status}">${FLAGLAB[p.sheet_status] || p.sheet_status}</span>` : ''}
        ${byPath[u] ? noteBtnHTML(u) : ''}${annBadges(u, 2)}
        <span class="n">${p.kw ? n0(p.kw) + ' kw' : '0 kw'}${p.pos ? ' · #' + p.pos : ''}</span>`;
      ul.append(li);
    });
    c.append(ul); g.append(c);
  });
}

/* ---------- workflow ---------- */
function liFor(p, extra) {
  const li = el("li");
  li.innerHTML = `<a class="u" href="${p.url}" target="_blank" rel="noopener">${esc(p.path)}</a>
    ${extra || ''}${noteBtnHTML(p.path)}${annBadges(p.path, 2)}<span class="n">${p.kw ? n0(p.kw) + ' kw' : '0 kw'}${p.pos ? ' · #' + p.pos : ''}</span>`;
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
    live page count, the cluster columns, and every flag.<br><br>
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
  m.map(([u, d]) => ({ u, d, p: byPath[u] || { kw: 0, pos: null, cat: '' } }))
    .sort((a, b) => b.p.kw - a.p.kw)
    .forEach(({ u, d, p }) => {
      const tr = el("tr");
      tr.innerHTML = `<td class="mono"><a href="https://www.1031crowdfunding.com${esc(u)}" target="_blank" rel="noopener" class="old">${esc(u)}</a></td>
       <td class="mono new">${esc(d)}</td><td>${esc(p.cat || '—')}</td>
       <td class="num">${p.kw ? n0(p.kw) : '—'}</td><td class="num">${p.pos ?? '—'}</td>`;
      tb.append(tr);
    });
}

function renderWork() {
  const wt = $("#worktiles"); wt.innerHTML = "";
  const pub = CAL.filter(c => c.status === "Published").length, out = CAL.length - pub;
  [["Redirects verified", n0(S.redirects), `${S.resolved_by_redirect} groups closed by work you already did`],
  ["Your pipeline", CAL.length, `${pub} published · ${out} in outline`],
  ["Marked Review", n0(S.review), "yellow in URL Organizing"],
  ["Marked Remove", n0(S.remove), "pink or struck through"],
  ["Tier disagreements", n0(S.mismatch), `${n0(S.promoted)} more are the education-center rule, not conflicts`],
  ["Sheet coverage", Math.round(100 * S.tracked / S.total) + "%", `${n0(S.untracked)} live pages untracked`],
  ].forEach(([l, v, nt]) => {
    const t = el("div", "tile");
    t.append(el("div", "lab", esc(l)), el("div", "val", v), el("div", "note", esc(nt))); wt.append(t);
  });

  const RD = DATA.redirects || { map: {}, anomalies: [] }, rg = $("#redirgap"); rg.innerHTML = "";
  const box = el("div", "card resolved"); box.style.marginBottom = "12px";
  box.append(el("h3", null, `Redirect check — verified in Chrome
    <span class="sevtag resolved">${n0(S.redirects)} redirects confirmed</span>`));
  box.append(el("div", "kv", `Every URL in the inventory tested ${esc(RD.verified || '')} · ${S.resolved_by_redirect} consolidation groups partly or fully closed by redirects you already shipped`));
  box.append(el("p", null, `An earlier build of this dashboard claimed your published consolidations were missing
    their 301s. That was wrong and has been retracted — the method behind it couldn't see status codes at all.
    Re-tested properly: ${n0(S.redirects)} of the ${n0(S.crawled)} crawled URLs return a server-level HTTP
    redirect, including both DST URLs and the California one. Those are now excluded from every count on this
    dashboard. See the Redirects tab for the full map.`));
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
      <b>Next:</b> 301 the old URL to the new one to move those keywords across. This is the only one of the
      three I originally flagged that holds up.`;
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

  const rev = P.filter(p => p.sheet_status === "review").sort((a, b) => b.kw - a.kw);
  const rem = P.filter(p => p.sheet_status === "remove").sort((a, b) => b.kw - a.kw);
  const mm = P.filter(p => p.tier_mismatch).sort((a, b) => b.kw - a.kw);
  const un = P.filter(p => p.flags.includes("untracked")).sort((a, b) => b.kw - a.kw).slice(0, 40);
  $("#n-rev").textContent = "(" + rev.length + ")"; $("#n-rem").textContent = "(" + rem.length + ")";
  $("#n-mm").textContent = "(" + mm.length + ")"; $("#n-un").textContent = "(top 40 of " + S.untracked + ")";
  $("#mmnote").innerHTML = mm.length
    ? `Only counts the actionable direction — you marked it a Transactional or Main Page and my rule demoted it
       to fan-out. Your call wins; tell me and I'll pin it.`
    : `None left. Your REIT Main Page pick has been adopted. The other ${n0(S.promoted)} differences are
       education-center hubs your sheet lists as sub-pages — that's the confirmed
       “<code>/education-center/</code> = core” rule, not a conflict.`;
  const fill = (sel, arr, ex) => { const u = $(sel); u.innerHTML = ""; arr.forEach(p => u.append(liFor(p, ex ? ex(p) : ''))); };
  fill("#revlist", rev, p => `<span class="pill nokw">${esc(p.cat)}</span>`);
  fill("#remlist", rem);
  fill("#mmlist", mm, p => `<span class="pill tiermismatch">yours: ${esc(p.tier_mismatch)} · mine: ${esc(p.tier)}</span>`);
  fill("#unlist", un, p => `<span class="pill nokw">${esc(p.cat)}</span>`);
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
    if (c && p.cat !== c) return false;
    if (ti && p.tier !== ti) return false;
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
  const annKey = p => { const a = annOf(p.path); return a ? (a.updated || "") : ""; };
  rows.sort((a, b) => {
    if (sortK === "notes") return String(annKey(b)).localeCompare(String(annKey(a))) * (sortD < 0 ? 1 : -1);
    let x = a[sortK], y = b[sortK];
    if (x === null) x = sortK === "pos" ? 999 : ""; if (y === null) y = sortK === "pos" ? 999 : "";
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sortD;
  });
  const cols = [["label", "Page"], ["cat", "Cluster"], ["tier", "Tier"], ["sheet_status", "Your status"],
  ["type", "Type"], ["kw", "Keywords", 1],
  ["traffic", "Traffic", 1], ["pkw", "Top keyword"], ["vol", "Vol", 1], ["pos", "Pos", 1], ["flags", "Flags"],
  ["notes", "Your notes"]];
  t.innerHTML = `<thead><tr>${cols.map(([k, l, n]) => `<th data-k="${k}" class="${n ? 'num' : ''}">${l}${sortK === k ? (sortD < 0 ? ' ↓' : ' ↑') : ''}</th>`).join("")}</tr></thead><tbody></tbody>`;
  t.querySelectorAll("th").forEach(th => th.onclick = () => {
    const k = th.dataset.k; if (sortK === k) sortD *= -1; else { sortK = k; sortD = (k === "pos") ? 1 : -1; } renderAll();
  });
  const tb = t.querySelector("tbody");
  rows.forEach(p => {
    const tr = el("tr");
    tr.innerHTML = `<td><a href="${p.url}" target="_blank" rel="noopener">${esc(p.label)}</a>
        <div class="mono" style="color:var(--muted);margin-top:2px">${esc(p.path)}</div></td>
      <td>${esc(p.cat)}</td><td style="text-transform:capitalize">${esc(p.tier)}</td>
      <td>${p.sheet_status ? `<span class="pill ${p.sheet_status}">${FLAGLAB[p.sheet_status] || esc(p.sheet_status)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${esc(p.type)}</td>
      <td class="num">${p.kw ? n0(p.kw) : '—'}</td><td class="num">${p.traffic ? n0(p.traffic) : '—'}</td>
      <td>${esc(p.pkw || '—')}</td><td class="num">${p.vol ? n0(p.vol) : '—'}</td>
      <td class="num">${p.pos ?? '—'}</td>
      <td>${p.flags.map(f => `<span class="pill ${f}">${FLAGLAB[f]}</span>`).join(" ") || ''}</td>
      <td style="white-space:nowrap">${noteBtnHTML(p.path)} ${annBadges(p.path, 2)}</td>`;
    tb.append(tr);
  });
}

/* ---------- coverage ---------- */
function renderCov() {
  const rows = DATA.cats.map(c => {
    const ps = P.filter(p => p.cat === c);
    return {
      c, kw: ps.reduce((a, b) => a + b.kw, 0), n: ps.length,
      t: ps.filter(p => p.tier === "transactional").length, co: ps.filter(p => p.tier === "core").length,
      f: ps.filter(p => p.tier === "fanout").length
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
      ${r.t} transactional · ${r.co} core · ${r.f} fan-out`);
    ch.append(d);
  });

  const st = $("#struct"); st.innerHTML = "";
  const tb = el("table");
  tb.innerHTML = `<thead><tr><th>Cluster</th><th class="num">Transactional</th><th class="num">Core</th>
    <th class="num">Fan-out</th><th>Structure</th></tr></thead><tbody>${rows.map(r => {
    let v, col;
    if (!r.co && r.f > 3) { v = "No core page — fan-out has nothing to point at"; col = "var(--critical)"; }
    else if (!r.t && r.co) { v = "No transactional page in this cluster"; col = "var(--serious)"; }
    else if (!r.co) { v = "No core page"; col = "var(--warning)"; }
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
   Part 3: annotation UI, notes tab, sync modal, PWA shell behaviour.
   ===================================================================== */

/* ---------------------------------------------------------- toasts ------ */
function toast(msg, bad) {
  const t = el("div", "toast" + (bad ? " bad" : ""), esc(msg));
  $("#toasts").append(t);
  setTimeout(() => { t.style.transition = "opacity .25s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 260); }, bad ? 5200 : 2600);
}

/* ---------------------------------------------------------- drawer ------ */
let openPath = null;

function openDrawer(path) {
  /* A page can vanish from the inventory (removed, renamed, 301'd) while your
     notes on it survive. Open the drawer anyway with a placeholder, so the
     notes stay reachable instead of becoming a dead card. */
  const p = byPath[path] || {
    label: path, path, url: "https://www.1031crowdfunding.com" + path,
    tier: "gone", cat: "—", type: "Not in the current inventory", flags: [],
    kw: 0, traffic: 0, pkw: null, vol: 0, pos: null,
    trans: 0, comm: 0, info: 0, tracked: false, sheet_topic: null, missing: true,
  };
  openPath = path;
  $("#dtitle").textContent = p.label;
  const a = $("#dpath"); a.textContent = p.path; a.href = p.url;
  $("#dmeta").innerHTML =
    (p.missing ? `<span class="pill remove">No longer in the inventory</span>` : "") +
    `<span class="pill ${esc(p.tier)}" style="background:var(--surface-2);border:1px solid var(--grid);text-transform:capitalize">${esc(p.tier)}</span>
     <span class="pill nokw">${esc(p.cat)}</span>
     <span class="pill nokw">${esc(p.type)}</span>
     ${p.flags.map(f => `<span class="pill ${f}">${FLAGLAB[f] || f}</span>`).join("")}`;

  $("#dmetrics").innerHTML = `
    <div><div class="ml">Keywords</div><div class="mv">${p.kw ? n0(p.kw) : "—"}</div>
      <div class="mn">${p.traffic ? n0(p.traffic) + " est. visits/mo" : "no estimated traffic"}</div></div>
    <div><div class="ml">Top keyword</div><div class="mv" style="font-size:13px;line-height:1.35">${esc(p.pkw || "—")}</div>
      <div class="mn">${p.vol ? n0(p.vol) + "/mo · position " + (p.pos ?? "—") : "not ranking"}</div></div>
    <div><div class="ml">Intent split</div><div class="mv" style="font-size:13px">${p.trans}/${p.comm}/${p.info}</div>
      <div class="mn">transactional / commercial / informational</div></div>
    <div><div class="ml">In your sheet</div><div class="mv" style="font-size:13px">${p.tracked ? "Yes" : "No"}</div>
      <div class="mn">${p.sheet_topic ? esc(p.sheet_topic) : "not tracked in the workbook"}</div></div>`;

  renderStatusPicker();
  renderLabelPicker();
  const pa = annOf(path);
  $("#dtarget").value = pa ? (pa.target || "") : "";
  renderThread();
  $("#dcomment").value = "";
  $("#dsaved").textContent = "";
  $("#drawer").classList.add("on");
  $("#scrim").classList.add("on");
  setTimeout(() => $("#dcomment").focus({ preventScroll: true }), 240);
}

function closeDrawer() {
  $("#drawer").classList.remove("on");
  $("#scrim").classList.remove("on");
  openPath = null;
}

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

function renderLabelPicker() {
  const cur = (annOf(openPath) || {}).labels || [];
  const w = $("#dlabels"); w.innerHTML = "";
  ANN.labels.forEach(l => {
    const b = el("button", null, esc(l.name));
    b.type = "button";
    b.dataset.c = l.color;
    b.setAttribute("aria-pressed", String(cur.includes(l.id)));
    b.onclick = () => {
      const a = pageAnn(openPath, true);
      a.labels = a.labels || [];
      const i = a.labels.indexOf(l.id);
      if (i >= 0) a.labels.splice(i, 1); else a.labels.push(l.id);
      touch(openPath, "labels"); renderLabelPicker(); refreshViews(); flashSaved();
    };
    w.append(b);
  });
}

const LABEL_COLORS = ["blue", "amber", "green", "purple", "teal", "pink", "red", "slate"];
function addLabel() {
  const inp = $("#dnewlabel");
  const name = inp.value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid();
  if (!ANN.labels.some(l => l.id === id)) {
    ANN.labels.push({ id, name, color: LABEL_COLORS[ANN.labels.length % LABEL_COLORS.length] });
  }
  if (openPath) {
    const a = pageAnn(openPath, true);
    a.labels = a.labels || [];
    if (!a.labels.includes(id)) a.labels.push(id);
    touch(openPath, "labels");
  } else { ANN.updated = nowISO(); saveLocal(); Sync.schedule(); }
  inp.value = "";
  renderLabelPicker(); refreshViews(); flashSaved();
}

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
    ANN.labels.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  ss.value = keepS; sl.value = keepL;

  const q = ($("#nq").value || "").toLowerCase();
  const fs = ss.value, fl = sl.value, sort = $("#nsort").value;
  let rows = paths.filter(p => {
    const a = ANN.pages[p];
    if (fs && a.status !== fs) return false;
    if (fl && !(a.labels || []).includes(fl)) return false;
    if (q) {
      const pg = byPath[p] || {};
      const hay = [p, pg.label || "", a.target || "", ...(a.comments || []).map(c => c.text)].join(" ").toLowerCase();
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
    const a = ANN.pages[path], pg = byPath[path] || { label: path, kw: 0, traffic: 0 };
    const last = (a.comments || [])[(a.comments || []).length - 1];
    const c = el("div", "notecard" + (byPath[path] ? "" : " gonecard"));
    c.innerHTML = `<div class="nh">
        <div><div class="nt">${esc(pg.label)}</div><div class="np">${esc(path)}</div></div>
        <div class="nkw">${pg.kw ? n0(pg.kw) + " kw" : "0 kw"}${pg.pos ? " · #" + pg.pos : ""}</div>
      </div>
      <div class="nb">${byPath[path] ? "" : '<span class="apill" data-c="red">not in inventory</span>'}
        ${annBadges(path) || '<span class="emptyc">no labels</span>'}
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
      saveLocal(); Sync.schedule(); refreshViews();
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
  renderMatrix(); renderGroups(); renderWork(); renderAll(); renderNotes();
}
window.onAnnotationsChanged = refreshViews;

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
      if ($("#syncmodal").classList.contains("on")) closeSync();
      else if ($("#drawer").classList.contains("on")) closeDrawer();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && $("#drawer").classList.contains("on")) postComment();
  });

  $("#dpost").onclick = postComment;
  $("#daddlabel").onclick = addLabel;
  $("#dnewlabel").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } };
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
    if (!confirm("Remove the status, labels, target and all comments for this page? This can't be undone.")) return;
    const ids = (a.comments || []).map(c => c.id);
    const t = nowISO();
    ANN.pages[openPath] = { status: "", labels: [], target: "", comments: [],
      delc: [...(a.delc || []), ...ids], f: { status: t, labels: t, target: t }, updated: t };
    ANN.updated = nowISO();
    saveLocal(); Sync.schedule();
    renderStatusPicker(); renderLabelPicker(); renderThread();
    $("#dtarget").value = "";
    refreshViews(); toast("Notes cleared for this page");
  };

  /* notes tab controls */
  ["#nq", "#nstatus", "#nlabel", "#nsort"].forEach(s => $(s).oninput = renderNotes);
  $("#annexport").onclick = exportNotes;
  $("#annimport").onclick = () => $("#annfile").click();
  $("#annfile").onchange = e => { if (e.target.files[0]) importNotes(e.target.files[0]); e.target.value = ""; };

  /* original filters */
  $("#q").oninput = e => { F.q = e.target.value; renderMatrix(); };
  $("#fcat").onchange = e => { F.cat = e.target.value; renderMatrix(); };
  $("#fann").onchange = e => { F.ann = e.target.value; renderMatrix(); };
  $("#fflags").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    $("#fflags").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    F.flag = b.dataset.f; renderMatrix();
  };
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

  $("#csv").onclick = () => {
    const h = ["path", "label", "cluster", "tier", "your_status", "your_sheet_topic", "your_sheet_cluster", "in_your_sheet",
      "type", "keywords", "traffic", "primary_keyword", "volume", "position", "flags", "suggested_slug",
      "note_status", "note_labels", "note_target", "note_comments"];
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const csv = [h.join(",")].concat(P.map(p => {
      const a = annOf(p.path) || {};
      return [p.path, p.label, p.cat, p.tier, p.sheet_status, p.sheet_topic,
        p.sheet_cluster, p.tracked ? "yes" : "no", p.type, p.kw, p.traffic, p.pkw, p.vol, p.pos,
        p.flags.join("|"), p.slug_suggest,
      (statusById(a.status) || {}).name || "",
      (a.labels || []).map(id => (labelById(id) || {}).name || id).join("|"),
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

  /* sync chip state */
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
    if (dark) { document.documentElement.dataset.theme = "dark"; }
    document.querySelector('meta[name="theme-color"]').content = dark ? "#0d0d0d" : "#f9f9f7";

    const stored = await STORE.get("annotations");
    if (stored && stored.pages) {
      ANN = mergeAnn(emptyAnn(), stored);
      /* keep any newly shipped default labels/statuses available */
      ANN.statuses = unionById(ANN.statuses, DEFAULT_STATUSES);
      ANN.labels = unionById(ANN.labels, DEFAULT_LABELS);
    }

    await Sync.load();

    let d = null;
    try { d = await loadData(false); await STORE.set("data", d); }
    catch (e) { d = await STORE.get("data"); if (!d) throw e; }
    bindData(d);

    if (dark) $("#theme").textContent = "Light";

    wire();
    renderAllViews();
    $("#boot").classList.add("off");

    /* filters that depend on the annotation library */
    buildAnnFilters();

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

function buildAnnFilters() {
  const opts = () => '<option value="">Any of my notes</option>' +
    '<option value="__any">Has notes</option>' +
    '<option value="__none">No notes</option>' +
    '<option value="__comment">Has comments</option>' +
    '<optgroup label="Status">' + ANN.statuses.filter(s => s.id !== "none")
      .map(s => `<option value="s:${esc(s.id)}">${esc(s.name)}</option>`).join("") + '</optgroup>' +
    '<optgroup label="Label">' + ANN.labels
      .map(l => `<option value="l:${esc(l.id)}">${esc(l.name)}</option>`).join("") + '</optgroup>';
  [["#fann", F.ann], ["#fann2", $("#fann2") ? $("#fann2").value : ""]].forEach(([sel, keep]) => {
    const n = $(sel); if (!n) return;
    n.innerHTML = opts(); n.value = keep || "";
  });
}
