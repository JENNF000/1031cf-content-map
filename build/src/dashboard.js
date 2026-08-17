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
