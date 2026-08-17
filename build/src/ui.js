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
