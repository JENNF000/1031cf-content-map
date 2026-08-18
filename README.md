# 1031 CF Content Map

An installable web app (PWA) for tracking and organising every organic page on
1031crowdfunding.com, and for running the ongoing SEO/AEO work against them.

**Live app:** `https://<your-github-username>.github.io/1031cf-content-map/`
→ see [SETUP.md](SETUP.md) if that URL doesn't exist yet.

---

## What's in here

| Path | What it is |
|---|---|
| `index.html`, `app.js` | The app. Single shell, no build step needed to run it. |
| `data.json` | The dataset — pages, clusters, tiers, SEMrush metrics, flags. **Replaced on every refresh.** |
| `annotations.json` | Your statuses, labels, target keywords and comments. **Written by the app. Nothing else may overwrite it.** |
| `version.json` | Data + publish timestamps. |
| `sw.js` | Service worker: shell cached for offline, data always fetched fresh with a cached fallback. |
| `manifest.webmanifest`, `icons/` | What makes it installable. |
| `robots.txt` | Asks crawlers to stay away. This site is served from a public URL — see *Privacy* below. |
| `build/` | Tooling. Not needed to use the app. |

## What "yours" covers

Four things live in `annotations.json` and survive every data refresh:

- **Status** — one per page, from a library you control. Ships as To do /
  In progress / Drafted / Published / Monitoring / Blocked / Won't do; all of them
  can be renamed, recoloured, reordered, removed or added to. Order is stored on
  each entry as `o` rather than implied by array position, so it survives a merge.
  `none` is the clear button, not a status: `fixed: true`, never editable.
  Removals go in `hiddenS` (statuses) / `hidden` (labels) with their own clocks, so
  deleting something on one device isn't undone by the other device still having
  it — the entry may linger in the library but nothing renders it. Read
  `visibleStatuses()`, never `ANN.statuses` directly.
- **Labels** — one library holding both the build-computed ones (Review,
  Consolidate, Slug fix, Underperformer, Untracked, No keywords, 301 redirect)
  and your own. Every entry can be renamed, recoloured or removed. Switching a
  build-computed label off on a single page is recorded in that page's
  `offFlags`, so the next refresh can't quietly turn it back on.
- **Placement** — the cluster and tier you dragged a page into. `data.json` keeps
  the build's classification untouched; `cluster` and `tier` in your annotations
  override it, and the whole app reads `effCat()` / `effTier()` rather than the
  raw fields.

  Dragging is implemented on **pointer events, not the HTML5 drag-and-drop API**.
  The cells are `<a>` elements, so native DnD fights the browser's own
  link-dragging (it hung the drag loop outright in Chromium), can't auto-scroll a
  horizontally scrolling container, and does nothing on touch. Pointer events give
  one path for mouse, pen and long-press — and can be tested with real trusted
  input, which is what `build/test-realdrag.mjs` does. Don't swap this back.
- **Comments** and a **target keyword**.

Tier names in the interface are Transactional / **Pillar** / Fan-out. The
underlying id for Pillar is still `core`, so no data migration was needed.

## The two halves, and why they never collide

`data.json` is **machine-owned**. It is regenerated from scratch each refresh out
of the sitemap crawl, the SEMrush pull and the editorial inputs. Nothing you type
in the app is ever stored there.

`annotations.json` is **yours**. Every entry is keyed by URL path
(`/education-center/what-is-a-delaware-statutory-trust/`), and the app merges it
over `data.json` at render time. So a refresh can change every keyword count,
position and flag on the site without touching a single word you wrote.

If a page you annotated disappears from the inventory — removed, renamed, 301'd —
your notes are kept. The app shows the card with a dashed border and a *not in
inventory* badge, and the refresh prints a warning naming the URL.

## Refreshing the data

Automatic: a scheduled Claude task runs weekly (Monday 07:00 PT) — it re-crawls
the sitemaps, re-pulls SEMrush, re-verifies redirects, rebuilds `data.json` and
commits it here. The app picks it up the next time it's opened, or when you press
**Refresh**.

On demand: ask Claude to refresh the content map and it runs the same job.

The in-app **Refresh** button re-fetches `data.json` from this repo. It does not
itself run a SEMrush pull — that needs Claude's tools.

Manual, if you ever need it:

```bash
python3 build/publish.py path/to/newly-built-data.json
```

That copies the file into place, stamps `version.json`, prints what changed since
last time, and reports your annotations. It never writes `annotations.json`.

## Rebuilding the app itself

Only needed when the interface changes, not when the data does.

```bash
python3 build/assemble.py     # writes index.html, app.js, sw.js, manifest, icons
cd build && node test.mjs && node test-v2.mjs && node test-realdrag.mjs \
            && node test-status.mjs && node test-sync.mjs && node test-orphan.mjs
```

Sources live in `build/src/`: `store.js` (local store, annotation model, GitHub
sync), `dashboard.js` (the views), `ui.js` (annotation UI, notes tab, PWA shell),
`extra.css`, `extra_markup.html`, and `head.html` (the original shell).

`assemble.py` fingerprints the output into the service-worker cache name, so a
rebuild automatically invalidates the old shell and the app offers a reload.

## How sync works

The app stores everything in IndexedDB first, so it works with no network and no
account. Connecting a GitHub token additionally mirrors `annotations.json` here.

- **Merge is field-level.** Status, labels, target keyword, cluster, tier and
  `offFlags` each carry their own timestamp. Adding a comment on your laptop
  cannot wipe a status you set on your phone, and re-clustering on one device
  doesn't undo a re-tiering on the other.
- **The label library merges per entry**, each resolving on its own `u` stamp, so
  a rename propagates. Removals are recorded in `hidden[]` so a deleted label
  doesn't reappear from the other device.
- **Comments are unioned by id**, with tombstones — a deleted comment stays
  deleted and is never resurrected by a merge from another device.
- **Conflicts retry.** A stale-SHA `409` re-reads, re-merges and pushes again.
- **Offline edits queue** and push on reconnect.
- The token lives in your browser only. It is never written to this repo.

## Privacy

This repo is public, and GitHub Pages serves it at a public URL. `data.json` and
`annotations.json` — including your comments — are readable by anyone who has the
address. `robots.txt` and a `noindex` tag keep it out of search results, but that
is politeness to crawlers, not access control.

If that stops being acceptable, the fix is to put the same files behind
Cloudflare Pages with Cloudflare Access (free, email-gated) and point the app
there. Nothing in the code needs to change.

## Browser support

Chrome, Edge and Android install it from the address-bar icon. On iOS, Safari →
Share → *Add to Home Screen*. Any modern browser runs it in a tab. Private
windows without IndexedDB fall back to `localStorage` automatically.
