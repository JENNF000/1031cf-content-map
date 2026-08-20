#!/usr/bin/env python3
"""
Assemble the PWA from the original single-file dashboard plus the additions.

    src/head.html          original HTML shell (CSS + markup, no data, no script)
    src/extra.css          additional styles
    src/extra_markup.html  new tab section + drawer + modals (split on <!--OVERLAYS-->)
    src/store.js           local store + annotation model + GitHub sync
    src/dashboard.js       the original views, wrapped and annotation-aware
    src/ui.js              annotation UI, notes tab, PWA shell, boot

Writes into dist/: index.html, app.js, sw.js, manifest.webmanifest, icons/.
data.json / annotations.json are produced by build.py.
"""
import os, re, hashlib, json, shutil

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "src")
# Site root is the repo root — one level up from build/.
DIST = os.path.abspath(os.path.join(BASE, ".."))
os.makedirs(DIST, exist_ok=True)
os.makedirs(os.path.join(DIST, "icons"), exist_ok=True)

read = lambda n: open(os.path.join(SRC, n), encoding="utf-8").read()

head = read("head.html")
extra_css = read("extra.css")
sections, overlays = read("extra_markup.html").split("<!--OVERLAYS-->")

# ---------------------------------------------------------------- <head> ---
PWA_HEAD = """<meta name="theme-color" content="#f9f9f7">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<meta name="description" content="Organic page inventory, topic clusters and SEO/AEO workflow for 1031crowdfunding.com.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Content Map">
<meta name="mobile-web-app-capable" content="yes">
"""
head = head.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + PWA_HEAD, 1)

# viewport-fit + safe areas for installed iOS
extra_css += """
body{padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
.wrap{padding-bottom:calc(72px + env(safe-area-inset-bottom))}
"""

# ------------------------------------------------------------------ CSS ----
assert "</style>" in head
head = head.replace("</style>", extra_css + "\n</style>", 1)

# --------------------------------------------------------------- header ----
OLD_HDR = """  <div class="hdr-right">
    <span class="fresh"><span class="dot"></span>Data as of <b id="asof" style="font-weight:600"></b></span>
    <button class="btn" id="theme">Dark</button>
    <button class="btn" id="csv">Export CSV</button>
  </div>"""
NEW_HDR = """  <div class="hdr-right">
    <span class="fresh"><span class="dot"></span>Data as of <b id="asof" style="font-weight:600"></b></span>
    <button class="syncchip" id="syncchip" data-s="local" type="button">
      <span class="sdot"></span><span class="stxt">Local only</span></button>
    <button class="btn" id="refresh" type="button">Refresh</button>
    <button class="btn" id="density" type="button">Compact</button>
    <button class="btn" id="csv" type="button">Export CSV</button>
    <button class="btn primary hideinapp" id="install" type="button" style="display:none">Install app</button>
  </div>"""
assert OLD_HDR in head
head = head.replace(OLD_HDR, NEW_HDR, 1)

# ---------------------------------------------------------- header copy ----
# The subtitle moves out of the header and merges with the intro line below the
# rule, so the top of the page is just a title and its controls.
OLD_SUB = """    <h1>1031 Crowdfunding \u2014 Content Topic Map</h1>
    <p class="sub">Every live post mapped to a topic cluster and a page tier, with SEMrush organic keyword volume per page.</p>"""
NEW_SUB = """    <h1>1031 Crowdfunding \u2014 Content Topic Map</h1>"""
assert OLD_SUB in head, "header subtitle not found"
head = head.replace(OLD_SUB, NEW_SUB, 1)

# ------------------------------------------------------------ system bars --
BARS = """<p class="intro" id="topbanner"></p>
<p class="partialnote" id="partialnote"></p>

<div class="sysbar offline" id="offlinebar">
  <span>◍</span><div class="grow">You're offline. Everything below is the last copy that loaded, and any
  labels or comments you add are saved locally and will sync when you're back.</div>
</div>
<div class="sysbar update" id="updatebar">
  <span>↻</span><div class="grow">A new version of the app is ready.</div>
  <button class="btn" id="doupdate" type="button">Reload</button>
</div>"""
assert '<div class="banner" id="topbanner"></div>' in head
head = head.replace('<div class="banner" id="topbanner"></div>', BARS, 1)

# ----------------------------------------------------------------- tabs ----
OLD_TAB = '  <button role="tab" aria-selected="false" data-tab="redir">Redirects'
NEW_TAB = ('  <button role="tab" aria-selected="false" data-tab="notes">My notes '
           '<span class="cnt" id="c-notes"></span></button>\n' + OLD_TAB)
assert OLD_TAB in head
head = head.replace(OLD_TAB, NEW_TAB, 1)

# -------------------------------------------------------------- filters ----
OLD_F1 = '<select id="fcat"><option value="">All topic clusters</option></select>'
NEW_F1 = OLD_F1 + '\n    <select id="fann"><option value="">Any of my notes</option></select>'
assert OLD_F1 in head
head = head.replace(OLD_F1, NEW_F1, 1)

OLD_F2 = '<select id="ftype2"><option value="">All page types</option></select>'
NEW_F2 = OLD_F2 + '\n    <select id="fann2"><option value="">Any of my notes</option></select>'
assert OLD_F2 in head
head = head.replace(OLD_F2, NEW_F2, 1)


# ------------------------------------------------------ density + tiers ----
OLD_TIER = """<select id="ftier2"><option value="">All tiers</option><option value="transactional">Transactional</option>
      <option value="core">Core</option><option value="fanout">Fan-out</option><option value="utility">Site / utility</option></select>"""
NEW_TIER = """<select id="ftier2"><option value="">All tiers</option><option value="transactional">Transactional</option>
      <option value="core">Pillar</option><option value="fanout">Fan-out</option><option value="utility">Site / utility</option>
      <option value="redirect">Redirect</option></select>"""
assert OLD_TIER in head
head = head.replace(OLD_TIER, NEW_TIER, 1)

# The old flag chip-row is gone: those flags are labels now, and the "Any of my
# notes" select filters by them alongside status. Removing it also takes a dense
# band of colour off the top of the topic map.
i = head.index('<div class="chipfilter" id="fflags">')
j = head.index('</div>', head.index('</div>', i) - 0)
# walk to the matching close: the block contains only <button> children
j = head.index('    </div>', i) + len('    </div>')
head = head[:i] + head[j:]

# ---------------------------------------------------- de-sheet the copy ----
REPL = [
  ('Marked \u201cReview\u201d in your sheet <span class="cnt" id="n-rev">',
   'Marked \u201cReview\u201d <span class="cnt" id="n-rev">'),
  ('Yellow-highlighted topics, ordered by keyword count \u2014 the ones with volume are worth doing first.',
   'Imported once from your keyword workbook, ordered by keyword count \u2014 the ones with volume are worth doing first. '
   'Review is an ordinary label now: switch it off on a page, rename it, or remove it from the library.'),
  ("Pink-highlighted or struck-through. Check keyword counts before deleting \u2014 redirect, don't drop.",
   "Also imported from the workbook. Check keyword counts before deleting \u2014 redirect, don't drop."),
  ('Live pages not in your sheet <span class="cnt" id="n-un">',
   'Never tracked in the original workbook <span class="cnt" id="n-un">'),
  ("Ranked by keyword count. The top of this list is untracked content that's already earning traffic.",
   "Ranked by keyword count. The top of this list is content that was never in the workbook and is already earning traffic."),
  ('Where my tier disagrees with yours <span class="cnt" id="n-mm">',
   'Pages you\u2019ve moved <span class="cnt" id="n-mm">'),
  ('Marked \u201cTO BE CREATED\u201d in your sheet.', 'Marked \u201cTO BE CREATED\u201d in the workbook.'),
]
for a, b in REPL:
    assert a in head, a[:50]
    head = head.replace(a, b, 1)

OLD_WORKBAN = ('Imported from your keyword workbook \u2014 the <b>Review</b> / <b>Remove</b> / <b>Calculator</b>')
assert OLD_WORKBAN in head
head = head.replace(
  OLD_WORKBAN,
  'A one-time import from your keyword workbook \u2014 the <b>Review</b> / <b>Remove</b> / <b>Calculator</b>', 1)


# ------------------------------------------------- inject new section -------
# sections go inside .wrap, just before the footer; overlays go after </div>.
FOOT_MARK = '<footer>'
assert FOOT_MARK in head
head = head.replace(FOOT_MARK, sections.strip() + "\n\n" + FOOT_MARK, 1)

# --------------------------------------------------------------- script ----
app_js = "\n\n".join([read("store.js"), read("dashboard.js"), read("ui.js")])
app_hash = hashlib.sha256(app_js.encode()).hexdigest()[:10]

tail = f"""
<div class="tip" id="tip"></div>
{overlays.strip()}

<script src="app.js?v={app_hash}"></script>
</body>
</html>
"""

# head currently ends right before the original "<div class="tip"...>" block
cut = head.index('<div class="tip" id="tip">')
index_html = head[:cut] + tail

open(os.path.join(DIST, "index.html"), "w", encoding="utf-8").write(index_html)
open(os.path.join(DIST, "app.js"), "w", encoding="utf-8").write(app_js)

# ------------------------------------------------------------- manifest ----
manifest = {
    "name": "1031 CF Content Map",
    "short_name": "Content Map",
    "description": "Organic page inventory, topic clusters and SEO/AEO workflow for 1031crowdfunding.com.",
    "start_url": ".",
    "scope": ".",
    "display": "standalone",
    "orientation": "any",
    "background_color": "#f9f9f7",
    "theme_color": "#f9f9f7",
    "categories": ["business", "productivity"],
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
    "shortcuts": [
        {"name": "My notes", "url": "./#notes"},
        {"name": "Needs attention", "url": "./#attn"},
    ],
}
open(os.path.join(DIST, "manifest.webmanifest"), "w").write(json.dumps(manifest, indent=2))

# Keep the dashboard out of search results. It is served from a public URL, so this
# is politeness to crawlers, not access control.
open(os.path.join(DIST, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")

# -------------------------------------------------------- service worker ---
SW = """/* 1031 CF Content Map — service worker.
   Shell: cache-first (fast, offline). Data: network-first (fresh, offline fallback). */
const VERSION = "__VERSION__";
const SHELL = "shell-" + VERSION;
const DATA  = "data-" + VERSION;
const SHELL_FILES = [
  "./", "index.html", "app.js?v=__APPHASH__", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // never touch api.github.com

  const isData = /\\/(data|annotations|version)\\.json$/.test(url.pathname);

  if (isData) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh && fresh.ok) (await caches.open(DATA)).put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) {
      fetch(req).then(r => { if (r && r.ok) caches.open(SHELL).then(c => c.put(req, r)); }).catch(() => {});
      return hit;
    }
    try {
      const r = await fetch(req);
      if (r && r.ok) (await caches.open(SHELL)).put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === "navigate") {
        const idx = await caches.match("index.html", { ignoreSearch: true });
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
"""
shell_hash = hashlib.sha256((index_html + app_js).encode()).hexdigest()[:10]
open(os.path.join(DIST, "sw.js"), "w").write(
    SW.replace("__VERSION__", shell_hash).replace("__APPHASH__", app_hash))

# ---------------------------------------------------------------- icons ----
import subprocess
icon_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0b0b0b"/>
  <g fill="none" stroke="#2a78d6" stroke-width="26" stroke-linecap="round">
    <path d="M132 356V190"/><path d="M224 356V132"/><path d="M316 356V236"/><path d="M408 356V286"/>
  </g>
  <path d="M104 400h304" stroke="#898781" stroke-width="16" stroke-linecap="round" fill="none"/>
  <circle cx="224" cy="132" r="30" fill="#2a78d6"/>
</svg>"""
maskable_svg = icon_svg.replace('rx="96"', 'rx="0"').replace(
    'viewBox="0 0 512 512">', 'viewBox="0 0 512 512">\n  <rect width="512" height="512" fill="#0b0b0b"/>')
maskable_svg = maskable_svg.replace('<g fill="none"', '<g transform="translate(256,256) scale(0.78) translate(-256,-256)" fill="none"')

open(os.path.join(DIST, "icons", "icon.svg"), "w").write(icon_svg)
open(os.path.join(DIST, "icons", "icon-maskable.svg"), "w").write(maskable_svg)


def png(svg_name, out, size):
    src = os.path.join(DIST, "icons", svg_name)
    dst = os.path.join(DIST, "icons", out)
    for cmd in (["rsvg-convert", "-w", str(size), "-h", str(size), src, "-o", dst],
                ["inkscape", src, "-w", str(size), "-h", str(size), "-o", dst],
                ["convert", "-background", "none", "-resize", f"{size}x{size}", src, dst]):
        try:
            if subprocess.run(cmd, capture_output=True).returncode == 0 and os.path.exists(dst):
                return True
        except FileNotFoundError:
            continue
    try:
        import cairosvg
        cairosvg.svg2png(url=src, write_to=dst, output_width=size, output_height=size)
        return os.path.exists(dst)
    except Exception as e:
        print("icon fallback failed:", e)
    return False


ok = all([
    png("icon.svg", "icon-192.png", 192),
    png("icon.svg", "icon-512.png", 512),
    png("icon-maskable.svg", "icon-maskable-512.png", 512),
    png("icon.svg", "apple-touch-icon.png", 180),
])
print("icons rendered:", ok)
print("index.html", len(index_html), "app.js", len(app_js), "sw version", shell_hash)
