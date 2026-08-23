# Content Map v2 — deploying the new app (one upload, ~1 minute)

This zip is the **complete new app**, built fresh on Aug 23, 2026. It replaces
everything in your `1031cf-content-map` repo. Same URL, same sync token — nothing
to reconfigure.

## What changed (the short version)

- **New taxonomy: 14 clusters** — your list from Aug 23, including the new
  *Press Mentions*, *Featured Videos*, and the *Real Estate Investment* catch-all
  (the old "Metrics & Fundamentals" pages live there now; "Company & News" split
  into Company and Press Mentions).
- **Redirect is now a fourth tier** with its own band in every cluster column,
  plus a dedicated **Redirects** tab: old slug → destination, cluster, and
  keywords on both URLs.
- Fresh **Aug 23 crawl**: 389 live pages, 51 verified redirects, 3 404s, every
  page's meta robots checked (all index,follow).
- **Your one comment was migrated** ("Old post had 41 keywords." on
  /delaware-statutory-trust-pros-and-cons/). Statuses and labels start fresh from
  the new audit, as you asked — the standard status list and label library are
  seeded and fully editable.
- SEMrush numbers are **carried forward** (pages data Aug 18, top keywords mostly
  Aug 3) because the API unit balance is at zero — the amber strip in the app
  says exactly this. Top up units and the next weekly build refreshes them.

## Upload steps

1. Open **github.com/JENNF000/1031cf-content-map** in your browser.
2. **Add file → Upload files.**
3. Unzip `1031cf-content-map-v2.zip` on your computer and drag **everything
   inside it** (including the `icons` folder) into the upload area.
4. Commit. GitHub replaces files with the same names and keeps history —
   nothing is lost, and you can roll back any file from the repo's History.
5. Open https://jennf000.github.io/1031cf-content-map/ . If you had the old app
   open or installed, a black bar will say **"A new version of the app is
   ready" — click Reload before doing anything else.** (On the phone: close and
   reopen the installed app twice if the bar doesn't appear.)

### One deliberate exception to the usual rule

Normally nothing ever overwrites `annotations.json` (your notes). **This upload
does replace it once, on purpose** — you chose a fresh start with only comments
migrated. The old version stays in the repo history if you ever want to look
something up. After this upload, the usual rule is back in force: the app writes
that file, builds never do.

## Using the new pieces

- **Hover any card** → keyword count, top keyword, est. traffic, volume,
  position, intent (with a note when a number is from an older pull).
- **Redirect band / Redirects tab** — every verified 301 with keywords on the
  old and new URL. Ship new redirects between crawls? **Check redirects** in the
  header: paste the old URLs, preview, apply.
- **Audit insights tab** — cannibalization groups (recomputed against verified
  redirects), missing pillar pages, slug fixes, the 3 new 404s, sitemap hygiene,
  soft-404 redirects.
- **Drag cards** between clusters/tiers (long-press on touch), or use the ✎
  drawer for dropdowns, status, labels, target keyword, and comments.
- **Refresh** pulls the latest published data. It cannot run a SEMrush pull —
  that stays with the weekly Monday build.

## If sync shows "off"

Your token is stored per-browser. If a device shows Sync: off, open **Sync
setup** and paste the same fine-grained token (Contents: Read & write on this
one repo). Owner/repo are prefilled.
