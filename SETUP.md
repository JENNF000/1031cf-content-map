# Setting this up — about 15 minutes, no command line

> ## Already done steps 1–4? Read this instead.
>
> To update to this version, unzip the new file and re-upload **everything except
> `annotations.json`** to your repository:
>
> 1. Open your repo on GitHub → **Add file** → **Upload files**.
> 2. Drag in the new `index.html`, `app.js`, `sw.js`, `README.md`, `SETUP.md`, and
>    the `build` folder. GitHub replaces the old versions and leaves everything
>    else alone.
> 3. Commit. Then open the app — it will show *"A new version of the app is
>    ready"* with a **Reload** button. Click it.
>
> **Never re-upload `annotations.json`.** That's the file that holds your labels
> and comments. It isn't in this zip for exactly that reason.
>
> Anything you already labelled is kept — the app upgrades your notes in place.
> Then carry on at **step 5** below to turn on sync.

---

You'll do four things: put the files on GitHub, turn on hosting, install the app,
and connect sync so your notes follow you between devices.

If you get stuck at any step, stop and tell me where — don't work around it.

---

## 1. Create the repository — 4 minutes

1. Go to **https://github.com** and sign in. If you don't have an account, click
   **Sign up**; a free one is all this needs.
2. Click the **+** in the top-right corner → **New repository**.
3. Fill in:
   - **Repository name:** `1031cf-content-map`
     *(it has to match exactly — it becomes part of your web address)*
   - **Description:** optional
   - **Public** — leave this selected. GitHub Pages needs it on a free account.
   - Leave *Add a README file* **unchecked**, and both dropdowns on *None*.
4. Click **Create repository**.

You'll land on a mostly-empty page with setup instructions. Ignore all of it.

## 2. Upload the files — 4 minutes

1. Unzip `1031cf-content-map.zip` that I sent you. You'll get a folder with
   `index.html`, `app.js`, `data.json`, an `icons` folder, and some others.
2. On that empty GitHub page, click the link **uploading an existing file**
   (in the line *"…or upload an existing file"*).
3. Open the unzipped folder, select **everything inside it** — all the files
   *and* the `icons` and `build` folders — and drag them onto the GitHub page.
   - On a Mac: `Cmd+A` inside the folder, then drag.
   - Don't drag the outer folder itself. Drag its contents.
   - macOS hides files starting with a dot. If `.nojekyll` and `.gitignore`
     don't come across, that's fine — neither is required.
4. Wait for every file to show as uploaded (the `icons` folder will expand into
   several entries — that's expected).
5. Scroll to the bottom, leave the commit message as-is, click **Commit changes**.

## 3. Turn on hosting — 3 minutes, mostly waiting

1. In your repository, click **Settings** (the tab along the top, far right).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, leave it on **Deploy from a branch**.
4. Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
5. Wait about a minute, then refresh the page. A green box appears at the top:
   *"Your site is live at …"*.

Your address will be:

```
https://YOUR-USERNAME.github.io/1031cf-content-map/
```

Open it. You should see the content map, exactly as it looked before, with three
new things in the header: a **Refresh** button, a **Local only** chip, and an
**Install app** button.

> If you get a 404, wait another minute and reload — Pages can take a moment on
> the first publish. If it's still 404 after five minutes, check that
> `index.html` is at the *top level* of the repository, not inside a subfolder.

## 4. Install it — 1 minute

**On your Mac (Chrome or Edge):** click **Install app** in the header, or the
install icon at the right-hand end of the address bar. It gets its own window and
a Dock icon.

**On your iPhone (Safari):** open the address → tap the **Share** button → scroll
down → **Add to Home Screen**.

**On Android (Chrome):** open the address → menu → **Install app**.

Once installed it works offline. The last data you loaded stays available, and any
labels or comments you add while offline sync when you're back.

## 5. Connect sync — 5 minutes

Without this, your notes live only in the browser you typed them in. With it,
your laptop and phone stay in step and I can read your labels on each refresh.

### Create the token

1. Go to **https://github.com/settings/personal-access-tokens/new**
   *(or: your avatar → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token)*
2. **Token name:** `content-map-sync`
3. **Expiration:** pick 1 year. *(Note the date — when it expires, sync stops and
   the chip turns orange. You just make a new one and paste it in.)*
4. **Repository access:** select **Only select repositories**, then choose
   `1031cf-content-map`.
5. **Permissions.** GitHub redesigned this box — it starts empty, and you add
   permissions one at a time rather than scrolling a list:
   - Click **+ Add permissions** (top-right of the Permissions box).
   - A searchable list opens. Type `Contents`, and select it.
   - **Contents** appears as a row under the **Repositories** tab with an access
     dropdown beside it. Set that dropdown to **Read and write**.
   - **Metadata** is added on its own as *Read-only*. That's mandatory and
     correct — leave it.
   - The counters at the top should read **Repositories 2**, **Account 0**.
6. Click **Generate token** at the bottom, then **copy the token**. It's shown
   once and never again.

This token can read and write that one repository and nothing else. It cannot
touch your other repos or your account.

### Paste it into the app

1. In the app, click the **Local only** chip in the header.
2. Fill in:
   - **GitHub owner:** your GitHub username
   - **Repository:** `1031cf-content-map`
   - **Branch:** `main`
   - **File path:** `annotations.json`
   - **Access token:** paste it
   - **Your name:** whatever you want on your comments
3. Click **Test connection**. You should get *"write access confirmed"* in green.
4. Click **Save & sync**. The chip turns green and reads **Synced**.

Repeat step 5 on your phone with the same token, and both devices share one set
of notes.

---

## Using it

**To label or comment on a page:** hover any page on the topic map and click the
small **✎** that appears in its corner. It's also on every row of the All-pages
table, the consolidation groups, and your workflow lists. A panel slides in from
the right with that page's metrics, its placement, a status, labels, a target
keyword field, and a comment thread.

**To move a page:** press on it and drag. Drop it on another cluster's **column
header** to change only its cluster, or on a **Transactional** / **Pillar** /
**Fan-out** band to change both. Empty bands appear while you're dragging, so
there's always somewhere to drop, and the target you're over lights up blue.

- A page name follows your cursor so you can see what you're carrying.
- Drag toward the left or right edge and the columns scroll, so you can reach a
  cluster that's off-screen.
- **Esc** cancels mid-drag; after a drop you get an **Undo**.
- On a phone, **press and hold** for about half a second, then drag. A quick swipe
  still scrolls the page as normal.
- Prefer not to drag at all? The **Placement** dropdowns in the panel do the same
  thing, and work everywhere.

Either way the move sticks through every data refresh, a moved page is marked with
a purple edge, and the panel offers **Reset to build default**.

**Statuses** are single-choice, and they're yours to define. They ship as To do,
In progress, Drafted, Published, Monitoring, Blocked, Won't do — rename any of
them, change a colour, add your own, remove ones you don't use, and drag the order
around with the ▲▼ arrows so they read as the steps you actually work through.
The order you set is the order they appear on every page. Removing a status that's
in use leaves those pages with no status rather than a dead label.

**Labels** are one library — the ones the build works out for itself (Review,
Remove, Consolidate, Slug fix, Underperformer, Untracked, No keywords, 301
redirect) sit alongside the SEO/AEO set (Rewrite, Refresh content, Title/meta,
Add schema, AEO: direct answer, AEO: FAQ block, Internal links, E-E-A-T/author,
Needs 301, Keep as-is, Priority). Build-applied ones are marked **auto** and draw
as outlines; the ones you apply yourself draw solid, so you can tell at a glance
which is which.

Everything is editable. **Manage** — next to either the Status or Labels heading in
the panel, or **Statuses & labels** on the My notes tab — opens one place to rename
anything, change a colour, or remove it entirely —
including the automatic ones. Removing takes it off every page and it stops
appearing anywhere; **Restore default labels** brings them back. Switching an
*auto* label off on a single page is remembered, so the next refresh can't turn
it back on.

**Compact** in the header strips the chips off the topic map when you want to see
structure rather than detail.

**Light or dark** follows your Mac's appearance setting — there's no toggle in the
app. Say the word if you'd rather have one back.

## Two different kinds of "current"

The header carries two chips, because these move for different reasons.

**Data as of …** is the SEMrush build — keyword counts, traffic, positions. It
turns amber past 8 days. **Refresh** pulls whatever has been published to the repo;
it can't run a SEMrush pull itself, so if the chip is amber, ask me for a fresh one.

**Redirects checked …** is whether each URL still serves a page. This is the one
that changes when *you* do work, and it needs no SEMrush at all.

### Telling the app you've shipped redirects

Click **Check redirects** in the header (or the chip). Paste the URLs you just
redirected — full URLs or paths, one per line or comma separated, trailing slash
optional, whatever your redirect plugin exports. You'll see exactly what will
change before anything happens; anything not in the inventory is listed back to
you rather than dropped. Apply, and those pages leave the live count and drop into
the Redirect band immediately.

For a single page, the panel now has a **Live status** control — *Serves a page* /
*Redirects* — with a link back to whatever the last build said.

Either way it sticks through every data rebuild, and **Redirect status changed by
me** in the notes filter shows you everything you've overridden.

### Why there's no "scan my site" button

The app is on `github.io` and your site is on `1031crowdfunding.com`. Browsers
don't let a page on one domain see whether a URL on another domain redirects — I
tried both documented tricks against a real server and neither works. The original
redirect map was built by running the scan in a tab *on your site*, which is
same-origin and therefore allowed.

So: ask me and I'll run a verified sweep that way. Or, if the app were ever served
from your own domain, the scan button appears by itself and works natively — the
code already checks for that.

**Target keyword / prompt** is deliberately separate from the keyword the page
currently ranks for — it's what you *intend* it to win, including AEO prompts.

**Everything saves as you type.** There's no save button.

**The My notes tab** collects everything you've marked, searchable across your
comment text, filterable by status and label. Both filter dropdowns on the topic
map and All-pages tabs can also filter by your statuses and labels.

**Export CSV** now includes four extra columns — your status, labels, target and
comments — so it drops straight into a spreadsheet.

## Refreshing the data

The weekly job runs Monday 07:00 PT and commits a new `data.json`. Press
**Refresh** in the app any time to pull the latest; the *Data as of* stamp in the
header tells you what you're looking at.

Want one sooner, or a different day? Tell me and I'll run it or change the
schedule.

## Two things worth knowing

**The site is public.** Anyone with the address can read the dashboard and your
comments. It's excluded from search results, but that's not the same as private.
If you'd rather it were gated, say so — putting the same files behind Cloudflare
Access is about ten minutes and no code changes.

**Your token is only in your browser.** It's never committed to the repository.
If you ever want to revoke it: GitHub → Settings → Developer settings →
Fine-grained tokens → the token → **Revoke**. The app keeps working; it just goes
back to saving locally.
