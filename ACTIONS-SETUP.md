# On-demand site crawls (one-time setup, ~3 minutes)

The repo now contains its own crawler: a **GitHub Action** that crawls
www.1031crowdfunding.com from GitHub's servers, rebuilds `data.json` (same
classification rules as always, SEMrush metrics carried forward), and commits
the result. It runs **daily at 6am PT automatically**, and — once you do the
token step below — **every time you hit Refresh in the app**.

It never touches `annotations.json` (your notes) or `gsc-overlap.json`.

## What you upload

From the v2.9 zip, upload to the repo (paths matter):
- `.github/workflows/crawl.yml`  → create it via **Add file → Create new file**,
  type `.github/workflows/crawl.yml` as the name, paste the file's contents,
  commit. (The GitHub uploader can't create dot-folders by drag-and-drop; the
  create-file box can. One time only — updates can be drag-dropped afterwards.)
- `crawler/crawl_build.py` and `crawler/flags.json` → **Add file → Upload
  files**, but first type `crawler/` into… actually simpler: use **Create new
  file**, name it `crawler/crawl_build.py`, paste contents, commit; repeat for
  `crawler/flags.json`.
- `app.js`, `sw.js`, `version.json` → normal upload to the repo **root**.

## Give your token permission to start the crawl (~1 minute)

Your existing GitHub token can already write files; starting an Action needs
one more permission:

1. github.com → your avatar → **Settings → Developer settings →
   Personal access tokens → Fine-grained tokens** → open your
   `1031cf-content-map` token → **Edit**.
2. Under **Repository permissions**, find **Actions** → set to
   **Read and write** → **Update**. (The token string doesn't change —
   nothing to re-paste in the app.)

## Try it

- In the app, hit **Refresh** → the toast says "Site crawl started — new build
  lands here in ~2–3 min", and the app picks the new build up automatically.
- Or on GitHub: **Actions** tab → *Site crawl & rebuild* → **Run workflow**.
- The daily 6am PT run needs nothing from you.

## If the first run fails

Open the **Actions** tab and click the failed run. If the log says the sitemap
couldn't be fetched or most URLs were unreachable, the site's host is likely
blocking GitHub's servers (some firewalls do) — tell Claude, and the weekly
Chrome-based crawl remains the fallback. The crawler deliberately aborts
without committing anything when that happens, so a blocked run can never
wipe the board.
