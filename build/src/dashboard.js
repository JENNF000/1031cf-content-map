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
const isHiddenS = id => (ANN.hiddenS || []).includes(id);

/* Statuses in display order, minus any you've removed. `none` stays first — it is
   the clear button, not a status. */
function visibleStatuses(withNone) {
  return (ANN.statuses || [])
    .filter(s => (withNone || s.id !== "none") && !isHiddenS(s.id))
    .sort((a, b) => (a.o ?? 99) - (b.o ?? 99));
}

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
  if (!a || !a.status || isHiddenS(a.status)) return "";
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
        if (tk !== "redirect") a.dataset.drag = "1";
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

/* ---------- drag to re-classify ----------------------------------------------

   Deliberately NOT the HTML5 drag-and-drop API. These cells are <a> elements, so
   native DnD fights the browser's own link-dragging; it also can't auto-scroll the
   horizontally scrolling matrix, and does nothing at all on touch. Pointer events
   give one code path for mouse, pen and long-press, and are testable with real
   input rather than synthesised DragEvents.
   ------------------------------------------------------------------------- */

const DRAG = {
  path: null, cell: null, id: null, active: false, moved: false,
  sx: 0, sy: 0, ghost: null, zone: null, lp: null, raf: 0,
  vx: 0, vy: 0, lastX: null, lastY: null, suppress: false,
};

const THRESHOLD = 6;      // px of movement before a mouse drag begins
const LONGPRESS = 380;    // ms of stillness before a touch drag begins

/* Called after every renderMatrix(). Listeners are delegated and installed once,
   so re-rendering can't leave stale handlers behind. */
function wireDrag() {
  if (wireDrag.done) return;
  wireDrag.done = true;

  /* kill the browser's native link drag outright */
  document.addEventListener("dragstart", e => {
    if (e.target.closest && e.target.closest(".matrix .cell")) e.preventDefault();
  });

  document.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cell = e.target.closest && e.target.closest(".matrix .cell[data-drag]");
    if (!cell) return;
    if (e.target.closest("[data-note]")) return;        // the ✎ is not a drag handle
    DRAG.suppress = false;
    DRAG.path = cell.dataset.path;
    DRAG.cell = cell;
    DRAG.id = e.pointerId;
    DRAG.sx = e.clientX; DRAG.sy = e.clientY;
    DRAG.active = false; DRAG.moved = false;
    if (e.pointerType === "touch") {
      const x = e.clientX, y = e.clientY;
      clearTimeout(DRAG.lp);
      DRAG.lp = setTimeout(() => { if (DRAG.path && !DRAG.moved) beginDrag(x, y); }, LONGPRESS);
    }
  }, true);

  addEventListener("pointermove", e => {
    if (DRAG.path === null || e.pointerId !== DRAG.id) return;
    const dx = e.clientX - DRAG.sx, dy = e.clientY - DRAG.sy;
    if (!DRAG.active) {
      if (Math.abs(dx) + Math.abs(dy) > THRESHOLD) {
        DRAG.moved = true;
        clearTimeout(DRAG.lp);
        if (e.pointerType === "touch") { endDrag(false); return; }   // let the page scroll
        beginDrag(e.clientX, e.clientY);
      }
      if (!DRAG.active) return;
    }
    e.preventDefault();
    moveDrag(e.clientX, e.clientY);
  }, { passive: false });

  addEventListener("pointerup", e => {
    if (DRAG.path === null || e.pointerId !== DRAG.id) return;
    if (DRAG.active) { e.preventDefault(); dropDrag(); } else { endDrag(false); }
  });
  addEventListener("pointercancel", () => endDrag(false));

  /* a drag must not also follow the link */
  document.addEventListener("click", e => {
    if (!DRAG.suppress) return;
    DRAG.suppress = false;
    e.preventDefault(); e.stopPropagation();
  }, true);

  addEventListener("keydown", e => {
    if (e.key === "Escape" && DRAG.active) { endDrag(false); toast("Move cancelled"); }
  });
}

function beginDrag(x, y) {
  if (!DRAG.cell) return;
  DRAG.active = true;
  document.body.classList.add("dragging");
  DRAG.cell.classList.add("dragsrc");
  const label = DRAG.cell.querySelector(".ttl .txt");
  DRAG.ghost = el("div", "dragghost", esc(label ? label.textContent : DRAG.path));
  document.body.append(DRAG.ghost);
  /* while a touch drag is live, stop the page scrolling under it */
  DRAG.blockTouch = ev => ev.preventDefault();
  addEventListener("touchmove", DRAG.blockTouch, { passive: false });
  moveDrag(x, y);
}

function moveDrag(x, y) {
  DRAG.lastX = x; DRAG.lastY = y;
  if (DRAG.ghost) { DRAG.ghost.style.left = x + "px"; DRAG.ghost.style.top = y + "px"; }
  const z = zoneAt(x, y);
  if (z !== DRAG.zone) {
    if (DRAG.zone) DRAG.zone.classList.remove("dropok");
    DRAG.zone = z;
    if (z) z.classList.add("dropok");
  }
  autoScroll(x, y);
}

function zoneAt(x, y) {
  const n = document.elementFromPoint(x, y);      // the ghost is pointer-events:none
  return n && n.closest ? n.closest("[data-drop]") : null;
}

/* A drag has to be able to reach a target that isn't currently on screen. The
   matrix scrolls sideways and rarely fits 12 clusters; columns are also taller
   than the viewport, so the Transactional band at the top of a column can be
   well above a fan-out page near the bottom of another. Both axes auto-scroll
   when the pointer nears an edge. */
function autoScroll(x, y) {
  const m = $("#matrix");
  const HEDGE = 70, VEDGE = 60, SPEED = 22;
  let vx = 0, vy = 0;

  if (m) {
    const r = m.getBoundingClientRect();
    if (x < r.left + HEDGE) vx = -SPEED * Math.min(1, (r.left + HEDGE - x) / HEDGE);
    else if (x > r.right - HEDGE) vx = SPEED * Math.min(1, (x - (r.right - HEDGE)) / HEDGE);
  }
  /* Only scroll vertically when the pointer is NOT over a drop target. A column
     header sits near the top of the screen, so scrolling up on approach would
     slide the very thing being aimed at out from under the cursor. */
  if (!DRAG.zone) {
    if (y < VEDGE) vy = -SPEED * Math.min(1, (VEDGE - y) / VEDGE);
    else if (y > innerHeight - VEDGE) vy = SPEED * Math.min(1, (y - (innerHeight - VEDGE)) / VEDGE);
  }

  DRAG.vx = vx; DRAG.vy = vy;
  if ((vx || vy) && !DRAG.raf) {
    const step = () => {
      if (!DRAG.active || (!DRAG.vx && !DRAG.vy)) { DRAG.raf = 0; return; }
      if (DRAG.vx && m) m.scrollLeft += DRAG.vx;
      if (DRAG.vy) scrollBy(0, DRAG.vy);
      /* the pointer hasn't moved but the page under it has, so re-test the zone */
      if (DRAG.lastX != null) {
        const z = zoneAt(DRAG.lastX, DRAG.lastY);
        if (z !== DRAG.zone) {
          if (DRAG.zone) DRAG.zone.classList.remove("dropok");
          DRAG.zone = z;
          if (z) z.classList.add("dropok");
        }
        if (z) DRAG.vy = 0;      // a target is under the cursor — stop chasing it away
      }
      DRAG.raf = requestAnimationFrame(step);
    };
    DRAG.raf = requestAnimationFrame(step);
  }
}

function dropDrag() {
  const zone = DRAG.zone, path = DRAG.path;
  const col = zone && zone.closest(".col");
  endDrag(true);
  if (!zone || !col) return;
  movePage(path, col.dataset.cluster, zone.dataset.drop === "tier" ? zone.dataset.tier : null);
}

function endDrag(wasDrag) {
  clearTimeout(DRAG.lp);
  if (DRAG.raf) { cancelAnimationFrame(DRAG.raf); DRAG.raf = 0; }
  if (DRAG.blockTouch) { removeEventListener("touchmove", DRAG.blockTouch); DRAG.blockTouch = null; }
  if (DRAG.ghost) { DRAG.ghost.remove(); DRAG.ghost = null; }
  if (DRAG.zone) { DRAG.zone.classList.remove("dropok"); DRAG.zone = null; }
  if (DRAG.cell) DRAG.cell.classList.remove("dragsrc");
  document.body.classList.remove("dragging");
  document.querySelectorAll(".dropok").forEach(n => n.classList.remove("dropok"));
  DRAG.suppress = !!(wasDrag || DRAG.active);
  /* The click that a drag suppresses may never arrive — the pointer can come up
     over a different element entirely. Expire the flag so it can't swallow an
     unrelated click later on. */
  if (DRAG.suppress) setTimeout(() => { DRAG.suppress = false; }, 350);
  DRAG.active = false; DRAG.moved = false;
  DRAG.path = null; DRAG.cell = null; DRAG.id = null;
  DRAG.vx = 0; DRAG.vy = 0; DRAG.lastX = null; DRAG.lastY = null;
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
