#!/usr/bin/env python3
"""
Publish step for the weekly refresh.

`build.py` (kept with the rest of the pipeline in the Claude project) joins the
sitemap crawl, the SEMrush pull and the editorial inputs, and writes a
`data.json`. This script copies that into the repo root, where the PWA fetches
it, and stamps `version.json`.

    python3 build/publish.py <path/to/freshly-built-data.json>

It NEVER writes annotations.json. That file belongs to the app — it holds
Jennifer's statuses, labels and comments, and the app is the only thing that
should ever change it. This script reads it to report what has been marked,
and to warn when an annotated URL has dropped out of the inventory.
"""
import json, os, sys, shutil, datetime

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ANN_PATH = os.path.join(REPO, "annotations.json")
DATA_PATH = os.path.join(REPO, "data.json")


def main(src):
    if not os.path.exists(src):
        sys.exit(f"no such file: {src}")
    new = json.load(open(src))
    if "pages" not in new or "stats" not in new:
        sys.exit("that doesn't look like a content-map data.json")

    old = json.load(open(DATA_PATH)) if os.path.exists(DATA_PATH) else None

    with open(DATA_PATH, "w") as f:
        json.dump(new, f, separators=(",", ":"))

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with open(os.path.join(REPO, "version.json"), "w") as f:
        json.dump({"data_generated": new["stats"]["generated"], "published": stamp}, f, indent=1)

    print(f"data.json  {len(new['pages'])} URLs · {new['stats']['total']} live · "
          f"{new['stats']['keywords']:,} keywords · generated {new['stats']['generated']}")

    # ---- what changed since the last publish -------------------------------
    if old:
        o = {p["path"] for p in old["pages"]}
        n = {p["path"] for p in new["pages"]}
        added, gone = sorted(n - o), sorted(o - n)
        okw = {p["path"]: p["kw"] for p in old["pages"]}
        movers = sorted(((p["kw"] - okw.get(p["path"], 0), p["path"]) for p in new["pages"]
                         if p["path"] in okw), key=lambda x: -abs(x[0]))[:8]
        print(f"\nsince last publish: +{len(added)} URLs, -{len(gone)} URLs, "
              f"{new['stats']['keywords'] - old['stats']['keywords']:+,} keywords")
        for u in added[:12]:
            print(f"  + {u}")
        for u in gone[:12]:
            print(f"  - {u}")
        for d, u in movers:
            if d:
                print(f"  {d:+5d} kw  {u}")

    # ---- annotations: read-only --------------------------------------------
    if not os.path.exists(ANN_PATH):
        print("\nno annotations.json yet")
        return
    try:
        ann = json.load(open(ANN_PATH))
    except Exception as e:
        print(f"\n!! annotations.json is unreadable ({e}). LEFT UNTOUCHED — do not overwrite it.")
        return

    lab = {l["id"]: l["name"] for l in ann.get("labels") or []}
    sts = {s["id"]: s["name"] for s in ann.get("statuses") or []}
    marked = {k: v for k, v in (ann.get("pages") or {}).items()
              if v.get("status") or v.get("labels") or (v.get("target") or "").strip() or v.get("comments")}
    if not marked:
        print("\nannotations.json present but empty")
        return

    ncom = sum(len(v.get("comments") or []) for v in marked.values())
    print(f"\nJennifer's notes: {len(marked)} pages, {ncom} comments")

    by_s, by_l = {}, {}
    for v in marked.values():
        if v.get("status"):
            k = sts.get(v["status"], v["status"])
            by_s[k] = by_s.get(k, 0) + 1
        for x in v.get("labels") or []:
            k = lab.get(x, x)
            by_l[k] = by_l.get(k, 0) + 1
    for k, c in sorted(by_s.items(), key=lambda x: -x[1]):
        print(f"  status  {k:26s} {c}")
    for k, c in sorted(by_l.items(), key=lambda x: -x[1]):
        print(f"  label   {k:26s} {c}")

    live = {p["path"] for p in new["pages"]}
    orphans = sorted(set(marked) - live)
    if orphans:
        print(f"\n  !! {len(orphans)} annotated URL(s) are no longer in the inventory. "
              f"The notes are preserved; the page has been removed or renamed:")
        for u in orphans:
            print(f"     {u}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "build", "dist", "data.json"))
