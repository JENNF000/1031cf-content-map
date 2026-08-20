/* =====================================================================
   Part 4: keeping redirect status current without a SEMrush pull.

   ⚠ WHY THERE IS NO AUTOMATIC SWEEP FROM GITHUB PAGES

   Detecting whether a URL redirects means reading the response type, and the
   browser will not allow that across origins. Both approaches were tried against
   a real server that answers real 301s:

     fetch(url, { mode:"no-cors", redirect:"manual" })
         → TypeError before any request leaves the browser. no-cors REQUIRES
           redirect:"follow". An earlier build did exactly this and reported all
           332 URLs as unreachable.

     fetch(url, { redirect:"manual" })          // cors mode
         → a cross-origin 3xx with no Access-Control-Allow-Origin is stopped by
           the CORS check. It does NOT surface as "opaqueredirect".

   The `opaqueredirect` method in the project notes worked because that sweep ran
   **same-origin, in a tab on 1031crowdfunding.com itself**. From
   jennf000.github.io it cannot work, and no combination of fetch options fixes
   it. Don't try again without re-reading this.

   So there are three honest routes instead:

     1. If the app is ever served from the site's own origin, the sweep becomes
        possible and is offered automatically — `canSweep()` decides.
     2. Paste the URLs you just redirected. You already know them; this applies
        them in bulk in seconds, needs no crawl and no API units.
     3. Flip a single page by hand from its panel.

   All three write to the same `ANN.live` override, so they flow into the live
   page count, the cluster columns, the tier bands and the CSV identically — and
   survive every data rebuild.
   ===================================================================== */

const SWEEP = { running: false, abort: false, done: 0, total: 0, results: null };
const CONCURRENCY = 8;

/* The sweep is only possible when app and site share an origin. Offering it
   anywhere else would be a lie. */
function siteOrigin() {
  const p = P && P.length ? P.find(x => x.url) : null;
  try { return p ? new URL(p.url).origin : null; } catch (e) { return null; }
}
const canSweep = () => !!siteOrigin() && siteOrigin() === location.origin;

async function probe(url) {
  try {
    const r = await fetch(url, { redirect: "manual", cache: "no-store", credentials: "omit" });
    if (r.type === "opaqueredirect") return "redirect";
    if (r.status >= 300 && r.status < 400) return "redirect";
    if (r.status) return "live";
  } catch (e) { /* fall through to the reachability probe */ }
  try {
    await fetch(url, { mode: "no-cors", redirect: "follow", cache: "no-store", credentials: "omit" });
    return "live";                     // answered; could be 200, could be 404
  } catch (e) { return "error"; }      // never treated as live
}

async function sweepAll(paths, onProgress) {
  SWEEP.running = true; SWEEP.abort = false;
  SWEEP.done = 0; SWEEP.total = paths.length;
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < paths.length && !SWEEP.abort) {
      const path = paths[i++];
      const p = byPath[path];
      out[path] = await probe(p && p.url ? p.url : path);
      SWEEP.done++;
      if (onProgress) onProgress(SWEEP.done, SWEEP.total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  SWEEP.running = false;
  return out;
}

/* --------------------------------------------------------- write path ---- */
/* One function behind all three routes. */
function setLiveStatus(paths, state) {
  const at = nowISO();
  ANN.live = ANN.live || {};
  paths.forEach(p => { ANN.live[p] = { s: state, at }; });
  ANN.updated = at;
  saveLocal(); Sync.schedule();
  refreshViews(); buildAnnFilters();
}

function clearLiveStatus(path) {
  if (ANN.live) delete ANN.live[path];
  ANN.updated = nowISO();
  saveLocal(); Sync.schedule();
  refreshViews();
}

function lastCheckedAt() {
  const v = Object.values(ANN.live || {});
  if (!v.length) return null;
  return v.reduce((m, x) => (x.at > m ? x.at : m), "");
}

/* ---------------------------------------------------------------- UI ----- */
function openCheck() {
  $("#checkmodal").classList.add("on");
  SWEEP.results = null;
  $("#chkresult").innerHTML = "";
  $("#chkprog").style.display = "none";
  $("#chkapply").style.display = "none";
  $("#chkstop").style.display = "none";
  $("#chkstart").style.display = canSweep() ? "" : "none";
  $("#chksweep").style.display = canSweep() ? "" : "none";
  $("#chkurls").value = "";
  renderCheckSummary();
  setTimeout(() => $("#chkurls").focus(), 60);
}
const closeCheck = () => { SWEEP.abort = true; $("#checkmodal").classList.remove("on"); };

function renderCheckSummary() {
  const n = Object.keys(ANN.live || {}).length;
  const changed = P.filter(p => statusChanged(p)).length;
  $("#chksummary").innerHTML = n
    ? `You've recorded a status for ${n0(n)} URL${n === 1 ? "" : "s"}${changed
      ? `, ${changed} of which differ from the published build` : ""} — last updated ${esc((lastCheckedAt() || "").slice(0, 10))}.`
    : `Nothing recorded yet, so the app is using the redirect map from the last data build.`;
}

/* Accepts full URLs or paths, one per line or comma separated, trailing slash
   optional — whatever your redirect plugin happens to export. */
function parseUrls(text) {
  const wanted = [], missing = [];
  text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).forEach(raw => {
    let p = raw;
    try { if (/^https?:\/\//i.test(raw)) p = new URL(raw).pathname; } catch (e) {}
    if (!p.startsWith("/")) p = "/" + p;
    const hit = [p, p.endsWith("/") ? p.slice(0, -1) : p + "/"].find(c => byPath[c]);
    if (hit) { if (!wanted.includes(hit)) wanted.push(hit); }
    else missing.push(raw);
  });
  return { wanted, missing };
}

function previewPaste() {
  const state = document.querySelector('input[name="chkstate"]:checked').value;
  const { wanted, missing } = parseUrls($("#chkurls").value);
  const w = $("#chkresult");
  if (!wanted.length && !missing.length) { w.innerHTML = ""; $("#chkapply").style.display = "none"; return; }

  const changing = wanted.filter(p =>
    (effTier(byPath[p]) === "redirect" ? "redirect" : "live") !== state);

  let html = "";
  if (changing.length) {
    html += `<h4>${changing.length} will change to ${state === "redirect" ? "redirecting" : "serving content"}</h4>
      <ul class="chklist">${changing.map(u =>
      `<li class="${state === "redirect" ? "gone" : "back"}">${esc(u)}<span class="n">${byPath[u].kw ? n0(byPath[u].kw) + " kw" : "0 kw"}</span></li>`).join("")}</ul>`;
  }
  const already = wanted.length - changing.length;
  if (already) html += `<div class="chknote">${already} already recorded that way — no change.</div>`;
  if (missing.length) {
    html += `<div class="chknote warn"><b>${missing.length} not in the inventory</b>, so ${missing.length === 1 ? "it was" : "they were"} skipped.
      Either a typo, or the page is newer than the last data build:<br>${missing.slice(0, 12).map(esc).join("<br>")}</div>`;
  }
  w.innerHTML = html;
  $("#chkapply").style.display = changing.length ? "" : "none";
  $("#chkapply").textContent = `Apply ${changing.length} change${changing.length === 1 ? "" : "s"}`;
  $("#chkapply").onclick = () => {
    setLiveStatus(changing, state);
    closeCheck();
    toast(`${changing.length} URL${changing.length === 1 ? "" : "s"} marked as ${state === "redirect" ? "redirecting" : "serving content"}`);
  };
}

/* ---------- the automatic sweep, only where it can actually work ---------- */
async function runCheck() {
  if (!canSweep()) return;
  const paths = P.map(p => p.path);
  $("#chkstart").style.display = "none";
  $("#chkstop").style.display = "";
  $("#chkprog").style.display = "";
  const bar = $("#chkbar"), lab = $("#chklab");
  bar.style.width = "0%";
  lab.textContent = `Checking 0 of ${paths.length}…`;

  const res = await sweepAll(paths, (d, t) => {
    bar.style.width = (100 * d / t).toFixed(1) + "%";
    lab.textContent = `Checking ${d} of ${t}…`;
  });
  $("#chkstop").style.display = "none";
  SWEEP.results = res;

  const errs = Object.keys(res).filter(k => res[k] === "error");
  const changed = Object.keys(res).filter(k => {
    if (res[k] === "error" || !byPath[k]) return false;
    return res[k] !== (effTier(byPath[k]) === "redirect" ? "redirect" : "live");
  });
  let html = changed.length
    ? `<h4>${changed.length} changed</h4><ul class="chklist">${changed.slice(0, 60).map(u =>
      `<li class="${res[u] === "redirect" ? "gone" : "back"}">${esc(u)}<span class="n">${res[u] === "redirect" ? "now redirects" : "serving again"}</span></li>`).join("")}</ul>`
    : `<div class="chknote ok">No changes — everything matches what the app shows.</div>`;
  if (errs.length) html += `<div class="chknote warn">${errs.length} couldn't be reached; left untouched.</div>`;
  $("#chkresult").innerHTML = html;

  if (changed.length) {
    $("#chkapply").style.display = "";
    $("#chkapply").textContent = `Apply ${changed.length} change${changed.length === 1 ? "" : "s"}`;
    $("#chkapply").onclick = () => {
      const at = nowISO();
      ANN.live = ANN.live || {};
      Object.keys(res).forEach(p => { if (res[p] !== "error") ANN.live[p] = { s: res[p], at }; });
      ANN.updated = at; saveLocal(); Sync.schedule();
      closeCheck(); refreshViews(); buildAnnFilters();
      toast(`Applied ${changed.length} status change${changed.length === 1 ? "" : "s"}`);
    };
  }
}
