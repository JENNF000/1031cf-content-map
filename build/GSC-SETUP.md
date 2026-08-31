# Connecting Search Console to the Content Map (one-time, ~10 minutes)

The app pulls your GSC data **in your browser** — you approve a read-only Google
popup each session. No passwords, no key files, nothing stored except the
client ID below and your property choice. What gets saved elsewhere: after each
pull the app publishes the computed **overlap summary** (queries split across
2+ pages, with impressions/clicks/positions) to your repo as `gsc-overlap.json`
so the weekly Claude report can make merge/split recommendations. Reminder:
the repo is public, so that summary is publicly readable — you chose this
trade-off on 8/25; delete the file from the repo and turn off Sync before a
pull if you ever change your mind.

## Steps (use the Google account that has Search Console access)

1. Go to **console.cloud.google.com** → sign in.
2. Top bar → project picker → **New project** → name it `1031cf-content-map`
   → Create → make sure it's selected.
3. Left menu → **APIs & Services → Library** → search **"Google Search Console
   API"** → open it → **Enable**.
4. **APIs & Services → OAuth consent screen** (Google may call it "Google Auth
   Platform → Branding/Audience"):
   - App name: `1031CF Content Map` · your email for both contact fields.
   - **Audience/User type:** if the option **Internal** is available (it is for
     Google Workspace accounts), pick it — done. If only **External**: pick it,
     then under **Audience → Test users** add your own email. (In "Testing"
     mode only listed test users can connect, which is exactly what we want.)
   - Scopes: you can skip adding scopes here; the app requests the read-only
     Search Console scope at connect time.
5. **APIs & Services → Credentials → + Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `content-map`
   - **Authorized JavaScript origins → + Add URI:**
     `https://jennf000.github.io`
   - Leave "Authorized redirect URIs" empty (not needed).
   - **Create** → copy the **Client ID** (looks like
     `1234567890-abc…xyz.apps.googleusercontent.com`).
6. Open the app → **GSC overlaps** tab → paste the client ID → **Save** →
   **Connect GSC** → Google popup → choose your account → Allow.
   The app finds your 1031crowdfunding.com property automatically (or shows a
   list to pick from), pulls the last ~90 days, and renders the overlaps.

## Afterwards

- **Refresh from GSC** re-pulls any time (each pull also re-publishes
  `gsc-overlap.json` if Sync is on).
- The popup reappears about once an hour of active use — that's the token
  expiring, by design.
- If Google shows *"Access blocked: app not verified"*: you skipped the test-
  user step (4) — add your email under Test users and retry.
- If the popup opens and instantly closes with an error mentioning `origin`:
  the JavaScript origin in step 5 doesn't exactly match
  `https://jennf000.github.io` (no trailing slash, no path).
