#!/usr/bin/env python3
"""1031 Crowdfunding Content Topic Map — crawler + builder for GitHub Actions.

Runs in the repo (daily schedule + on-demand from the app's Refresh button):
crawls www.1031crowdfunding.com server-side (real status codes, real 301-vs-302),
re-classifies with the same rules as the weekly build, carries SEMrush metrics
forward from the previous data.json, and rewrites data.json + version.json.

NEVER touches annotations.json (Jennifer's) or gsc-overlap.json (app-written).

Safety: if more than 15% of previously-live URLs error out, the site is
probably blocking the runner (or down) — abort with exit 1 and commit nothing.

Local testing: set SITE_BASE=http://127.0.0.1:PORT to crawl a mock site.
"""
import json, os, re, sys, datetime, urllib.parse
from concurrent.futures import ThreadPoolExecutor
import urllib.request

BASE = os.environ.get('SITE_BASE', 'https://www.1031crowdfunding.com')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (1031cf-content-map crawler)'
NOW = datetime.datetime.now(datetime.timezone.utc)
TODAY = NOW.strftime('%Y-%m-%d')
STAMP = NOW.strftime('%Y-%m-%d %H:%M UTC')

def http(url, follow=False, timeout=20):
    """GET url. Returns (status, location_or_None, body_first_60kb_or_None)."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*'})
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, None, r.read(60000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        loc = e.headers.get('Location') if e.code in (301, 302, 303, 307, 308) else None
        return e.code, loc, None
    except Exception:
        return 0, None, None

def to_path(u, base_path='/'):
    try:
        p = urllib.parse.urljoin(urllib.parse.urljoin(BASE, base_path), u.strip())
        parsed = urllib.parse.urlparse(p)
        site = urllib.parse.urlparse(BASE)
        if parsed.netloc and parsed.netloc != site.netloc and not parsed.netloc.endswith('1031crowdfunding.com'):
            return None
        return parsed.path or '/'
    except Exception:
        return None

# ---------------- 1. sitemap union ----------------
def get_sitemap_paths():
    paths = set()
    st, _, body = http(BASE + '/sitemap_index.xml', follow=True)
    if st != 200 or not body:
        return None
    children = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', body)
    child_urls = [c for c in children if 'sitemap' in c and c.rstrip('/').endswith('.xml')]
    if not child_urls:  # flat urlset
        for u in children:
            p = to_path(u)
            if p: paths.add(p)
        return paths
    for cu in child_urls:
        st2, _, b2 = http(cu if cu.startswith('http') else BASE + cu, follow=True)
        if st2 == 200 and b2:
            for u in re.findall(r'<loc>\s*([^<]+?)\s*</loc>', b2):
                p = to_path(u)
                if p: paths.add(p)
    return paths

# ---------------- 2. sweep ----------------
def sweep_one(path):
    st, loc, body = http(BASE + path)
    rec = {'s': st}
    if st in (301, 302, 303, 307, 308):
        rec['d'] = to_path(loc or '', path)
        rec['rcode'] = st
    elif st == 200 and body:
        m = re.search(r'<meta[^>]+name=["\']?robots["\']?[^>]*content=["\']([^"\']*)["\']', body, re.I) \
            or re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*name=["\']?robots["\']?', body, re.I)
        if m: rec['robots'] = m.group(1)
        c = re.search(r'<link[^>]+rel=["\']?canonical["\']?[^>]*href=["\']([^"\']+)["\']', body, re.I)
        if c: rec['canon'] = to_path(c.group(1), path)
    return path, rec

# ---------------- classification (identical rules to the weekly build) ----------------
CATS = ["1031 Exchange", "1031 Exchange Rules", "DST", "721 Exchange", "REIT",
        "Opportunity Zones", "Bridge Fund / Loan", "Real Estate Investment",
        "Asset Classes", "Tax & Capital Gains", "Retirement & IRA",
        "Company", "Press Mentions", "Featured Videos"]
TRANSACTIONAL = {
    "/1031-exchange-properties/": "1031 Exchange",
    "/education-center/1031-crowdfunding-scenarios/": "1031 Exchange",
    "/delaware-statutory-trusts/": "DST",
    "/1031cf-portfolio-4-dst/": "DST", "/1031cf-portfolio-5-dst/": "DST",
    "/721-acquisition/": "721 Exchange", "/721-exchange-real-estate-investing/": "721 Exchange",
    "/real-estate-investment-trusts/": "REIT",
    "/qualified-opportunity-zones/": "Opportunity Zones",
    "/bridge-financing-funds/": "Bridge Fund / Loan",
    "/invest-with-an-ira/": "Retirement & IRA",
    "/invest-in-alternatives/": "Real Estate Investment",
    "/investment-platform/": "Company", "/register/": "Company", "/contactus/": "Company",
    "/portfolio/aspen-valley-senior-living-2/": "Asset Classes",
    "/portfolio/iris-memory-care-of-edmond/": "Asset Classes",
    "/portfolio/iris-memory-care-of-rowlett/": "Asset Classes",
    "/portfolio/pacific-view-senior-living/": "Asset Classes",
    "/portfolio/rosewood-specialty-care/": "Asset Classes",
}
PILLAR = {
    "/education-center/guide-to-1031-exchanges/": "1031 Exchange",
    "/1031-exchange-rules/": "1031 Exchange Rules",
    "/education-center/dst-1031-exchange/": "1031 Exchange Rules",
    "/education-center/what-is-a-delaware-statutory-trust/": "DST",
    "/education-center/everything-you-should-know-about-upreits/": "721 Exchange",
    "/what-is-a-reit-and-how-does-it-work/": "REIT",
    "/everything-you-need-to-know-about-reits/": "REIT",
    "/explore-the-potential-of-reits-a-guide-for-investors/": "REIT",
    "/what-is-a-bridge-loan/": "Bridge Fund / Loan",
    "/income-producing-real-estate-the-basics/": "Real Estate Investment",
    "/education-center/senior-housing/": "Asset Classes",
    "/education-center/multifamily-properties/": "Asset Classes",
    "/education-center/nnn-property-investments-what-you-should-know/": "Asset Classes",
    "/education-center/investing-in-student-housing/": "Asset Classes",
    "/education-center/self-storage-investments/": "Asset Classes",
    "/education-center/investing-medical-office-buildings/": "Asset Classes",
    "/education-center/industrial-real-estate-investing-guide/": "Asset Classes",
    "/capital-gains-tax-calculator/": "Tax & Capital Gains",
    "/what-is-an-ira-and-why-should-you-invest/": "Retirement & IRA",
    "/marketplace-for-1031-exchange-investments/": "Company",
}
FORCE = {
    "/retirement-reit/": ("REIT", "fanout"),
    "/education-center/1031-exchange-services/": ("1031 Exchange", "fanout"),
    "/education-center/qofs-vs-dsts/": ("Opportunity Zones", "fanout"),
    "/": ("Company", "transactional"),
    "/education-center/blog/": ("Company", "fanout"), "/education-center/faq/": ("Company", "fanout"),
    "/education-center/glossary/": ("Company", "fanout"), "/education-center/spanish-1031/": ("Company", "fanout"),
    "/testimonials/": ("Company", "fanout"), "/ebook/": ("Company", "fanout"),
    "/security/": ("Company", "fanout"), "/privacy-policy/": ("Company", "fanout"),
    "/terms/": ("Company", "fanout"), "/sitemap/": ("Company", "fanout"),
    "/a-solution-for-your-1031-exchange-who-we-are/": ("Company", "fanout"),
    "/new-look-new-resource-library/": ("Company", "fanout"),
    "/https-www-youtube-com-1031crowdfunding/": ("Company", "fanout"),
    "/education-center/calculator/": ("1031 Exchange Rules", "fanout"),
    "/education-center/replacement-calculator/": ("1031 Exchange", "fanout"),
    "/education-center/ltv-calculator/": ("Real Estate Investment", "fanout"),
    "/capital-gains-got-you-down/": ("Tax & Capital Gains", "fanout"),
    "/how-the-one-big-beautiful-bill-affects-real-estate-investors/": ("Tax & Capital Gains", "fanout"),
    "/how-trumps-one-big-beautiful-bill-will-affect-us-housing-market/": ("Tax & Capital Gains", "fanout"),
}
AUTHOR_TAG = re.compile(r"^/(author|tag|category)/")
PRESS = re.compile(
    r"1031-crowdfunding-(ranks|review|receives|moves|celebrates|accepted|launches|llc|sees|tracks|ceo)|"
    r"1031-crowdfundings-2015-review|1031-cf-properties-launches|"
    r"edward-fernandez|ed-fernandez|ceo-of-1031|with-ed-fernandez|ft-ed-fernandez|"
    r"marketwatch|kiplinger|forbes|globest|investmentnews|benzinga|yield-talk|"
    r"inc-5000|inc-pacific|regionals-2023|inc-s-2022|inc-magazines|wsr-pathfinder|"
    r"td-ameritrade|nasaq-tradetalks|newswatch|boroughs-burbs|best-ever-cre|"
    r"audra-lambert|deal-scout|wealthchannel|money-talks-news|"
    r"what-financial-advisors-need|harnessing-the-power-of-1031-exchanges|"
    r"a-smart-spin-on-1031|1031cf-bridge-fund-iii-distributes|"
    r"new-fund-capitalized-on-senior-housing|why-1031-crowdfunding-is-launching")
VIDEO = re.compile(r"^/(featured-video-|youtube-)")
COMPANY_MISC = re.compile(
    r"great-leader|stay-humble|quick-wins|build-the-right-culture|find-a-mentor|"
    r"calculated-risks|keep-pace-and-grow|why-partnering-with-a-cpa")
RULES = [
    (r"721|upreit|downreit|operating-partnership", "721 Exchange"),
    (r"\bdst|delaware-statutory|dsts-", "DST"),
    (r"reit", "REIT"),
    (r"opportunity-zone|\bqoz\b|qof|opportunity-zones", "Opportunity Zones"),
    (r"bridge|private-credit|alternative-lenders|negative-leverage|maturing-loans|fannie-mae-loans|loan-originations", "Bridge Fund / Loan"),
    (r"senior-housing|assisted-living|senior-living|student-housing|multifamily|multi-family|"
     r"self-storage|medical-office|industrial|data-center|triple-net|\bnnn\b|net-lease|single-net|"
     r"hospitality|mixed-use|single-family|commercial-real-estate|types-of-commercial|"
     r"commercial-vs-residential|healthcare-real-estate|offices-struggle", "Asset Classes"),
    (r"holding-period|identification|three-property|equal-or-greater|deadline|"
     r"2-year-rule|5-year|180-days|all-or-nothing|not-allowed|roll-over|timing|"
     r"safe-harbor|related-party|family-member|corporation-do-a-1031|llc-do-a-1031|"
     r"principal-residence|florida-1031-exchange-rules", "1031 Exchange Rules"),
    (r"1031|1033|1035|731|like-kind|starker|qualified-intermediar|boot|escrow|"
     r"exchange-accommodation|relinquished|replacement-property|drop-and-swap|"
     r"tenant-in-common|reverse-exchange|construction-exchange|improvement|"
     r"vacation-homes|preserve-1031|gop-tax-plan", "1031 Exchange"),
    (r"ira|401k|retirement|self-directed", "Retirement & IRA"),
    (r"capital-gain|depreciation|cost-segregation|inherit|section-897|disregarded-entity|"
     r"tax-rates|tax-day|tax-free|tax-inflation|defer|mineral-rights|tax-strategies", "Tax & Capital Gains"),
]

def classify(path, is_redirect):
    if path in FORCE and not is_redirect: return FORCE[path]
    if not is_redirect:
        if path in TRANSACTIONAL: return TRANSACTIONAL[path], "transactional"
        if path in PILLAR: return PILLAR[path], "pillar"
    if VIDEO.match(path): cat = "Featured Videos"
    elif PRESS.search(path): cat = "Press Mentions"
    elif AUTHOR_TAG.match(path) or COMPANY_MISC.search(path): cat = "Company"
    else:
        cat = None
        for rx, c in RULES:
            if re.search(rx, path): cat = c; break
        if cat is None: cat = "Real Estate Investment"
    return cat, ("redirect" if is_redirect else "fanout")

def slugify_label(path):
    s = path.strip('/').split('/')[-1]
    s = re.sub(r'^featured-video-', '', s)
    s = re.sub(r'^youtube-', 'YouTube: ', s)
    s = s.replace('-', ' ')
    plural = {"dsts":"DSTs","reits":"REITs","iras":"IRAs","qofs":"QOFs","upreits":"UPREITs","downreits":"DownREITs"}
    s = re.sub(r"\b(1031|721|731|401k|dst|dsts|reit|reits|ira|iras|nnn|qoz|qof|qofs|irr|npv|llc|cpa|tic|upreit|upreits|downreit|downreits|irc|obbb|us|u s|ai|cre)\b",
               lambda m: plural.get(m.group(0), m.group(0).upper()), s)
    if path == '/': return 'Home'
    if path.startswith('/author/'): return 'Author: ' + s.title()
    if path.startswith('/portfolio/'): return 'Property: ' + (s[:1].upper() + s[1:])
    return s[:1].upper() + s[1:] if s else path

def page_type(path):
    if path.startswith('/education-center/'): return 'Education Center'
    if VIDEO.match(path): return 'Featured Video'
    if path.startswith('/portfolio/'): return 'Property / Offering'
    if AUTHOR_TAG.match(path): return 'Archive'
    if path in TRANSACTIONAL: return 'Landing / Offering'
    if path in PILLAR: return 'Guide / Hub'
    if PRESS.search(path): return 'Press / PR'
    if path in FORCE and FORCE[path][0] == 'Company': return 'Site page'
    return 'Blog'

# ---------------- main ----------------
def main():
    prev = json.load(open(os.path.join(ROOT, 'data.json')))
    flags = json.load(open(os.path.join(HERE, 'flags.json')))
    prev_metrics = {p['path']: p for p in prev['pages']}
    prev_live = [p['path'] for p in prev['pages'] if p['tier'] != 'redirect']
    prior_paths = set(prev_metrics.keys())
    for i in prev.get('insights', []):
        if i.get('id') == 'p404':
            prior_paths.update(i.get('items') or [])

    sm = get_sitemap_paths()
    if sm is None:
        print('FATAL: could not fetch sitemap_index.xml — site blocking the runner, or down. Nothing committed.')
        sys.exit(1)
    inventory = sorted(sm | prior_paths)
    print('sweeping %d URLs (%d from sitemap, %d carried)…' % (len(inventory), len(sm), len(inventory) - len(sm)))

    results = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for path, rec in ex.map(sweep_one, inventory):
            results[path] = rec
    errors = [p for p, r in results.items() if r['s'] == 0]
    prev_live_err = [p for p in prev_live if results.get(p, {}).get('s') == 0]
    if prev_live and len(prev_live_err) / len(prev_live) > 0.15:
        print('FATAL: %d/%d previously-live URLs unreachable — assuming the runner is blocked. Nothing committed.'
              % (len(prev_live_err), len(prev_live)))
        sys.exit(1)
    # a handful of transient errors: keep previous status for those paths
    for p in errors:
        if p in prev_metrics:
            prevrow = prev_metrics[p]
            results[p] = {'s': 200} if prevrow['tier'] != 'redirect' else {'s': 301, 'd': prevrow.get('redirects_to'), 'rcode': 301}

    redirects = {p: r for p, r in results.items() if r.get('d') is not None}
    gone = sorted(p for p, r in results.items() if r['s'] in (404, 410))
    noindex = sorted(p for p, r in results.items() if r['s'] == 200 and re.search(r'noindex|\bnone\b', r.get('robots') or '', re.I))
    live = sorted(p for p, r in results.items() if r['s'] == 200 and p not in noindex)
    canon_mismatch = {p: r['canon'] for p, r in results.items() if r['s'] == 200 and r.get('canon') and r['canon'] != p}

    dup_lookup, slug_lookup = {}, {s['url']: s for s in flags['slug_fixes']}
    for g in flags['consolidation_groups']:
        for u in g['urls']: dup_lookup.setdefault(u, []).append(g['topic'])
        g['redirected'] = sorted(u for u in g['urls'] if u in redirects)
        g['gone'] = sorted(u for u in g['urls'] if u in gone)
        g['still_live'] = sorted(u for u in g['urls'] if u in live and u != g['keep'])
        n = len(g['still_live'])
        g['sev'] = 'resolved' if n == 0 else ('partial' if (g['redirected'] or g['gone']) else ('critical' if n >= 4 else 'serious' if n >= 2 else 'warning'))

    pages = []
    for p in sorted(set(live) | set(redirects)):
        is_r = p in redirects
        cat, tier = classify(p, is_r)
        m = prev_metrics.get(p)
        pflags = []
        if not is_r:
            if p in dup_lookup: pflags.append('consolidate')
            if p in slug_lookup or re.search(r'-\d$|-part-\d$', p.rstrip('/')): pflags.append('slug')
            if m and m.get('pos') and m['pos'] > 20 and (m.get('vol') or 0) >= 500: pflags.append('underperform')
            if (not m or (m.get('kw') or 0) == 0) and page_type(p) not in ('Site page', 'Archive'): pflags.append('nokw')
            if m is None: pflags.append('newpage')
        else:
            pflags = ['redirect']
        pages.append({
            'path': p, 'url': 'https://www.1031crowdfunding.com' + p, 'label': slugify_label(p),
            'cat': cat, 'tier': tier, 'type': page_type(p), 'in_sitemap': p in sm,
            'redirects_to': redirects.get(p, {}).get('d'),
            'rcode': redirects.get(p, {}).get('rcode'),
            'kw': (m or {}).get('kw', 0), 'traffic': (m or {}).get('traffic', 0),
            'trans': (m or {}).get('trans', 0), 'comm': (m or {}).get('comm', 0), 'info': (m or {}).get('info', 0),
            'pkw': (m or {}).get('pkw'), 'vol': (m or {}).get('vol', 0), 'pos': (m or {}).get('pos'),
            'pkw_stale': (m or {}).get('pkw_stale', True) if m else False, 'no_metrics': m is None,
            'flags': pflags, 'groups': dup_lookup.get(p, []),
            'slug_suggest': slug_lookup.get(p, {}).get('suggest'),
            'slug_reason': slug_lookup.get(p, {}).get('reason'),
        })

    listing = ('/', '/category/news/', '/education-center/blog/', '/education-center/glossary/')
    redir_rows = []
    for old in sorted(redirects):
        to = redirects[old].get('d') or ''
        mo, mt = prev_metrics.get(old), prev_metrics.get(to)
        cat, _ = classify(old, True)
        redir_rows.append({'old': old, 'to': to, 'rcode': redirects[old].get('rcode'), 'cat': cat,
            'kw_old': (mo or {}).get('kw', 0), 'pkw_old': (mo or {}).get('pkw'),
            'kw_new': (mt or {}).get('kw', 0) if mt else None, 'pkw_new': (mt or {}).get('pkw'),
            'to_listing': to in listing, 'in_sitemap': old in sm})

    # ---- insights: fully computed (editorial judgment stays with the weekly Claude report) ----
    TOPICAL = [c for c in CATS if c not in ('Company', 'Press Mentions', 'Featured Videos')]
    live_pages = [p for p in pages if p['tier'] != 'redirect']
    no_pillar = [c for c in TOPICAL if not any(p['cat'] == c and p['tier'] == 'pillar' for p in live_pages)]
    open_groups = [g for g in flags['consolidation_groups'] if g['sev'] != 'resolved']
    n_sm = sum(1 for r in redir_rows if r['in_sitemap'])
    soft = [r for r in redir_rows if r['to_listing']]
    t302 = [r for r in redir_rows if r['rcode'] == 302]
    slugs_live = [s for s in flags['slug_fixes'] if s['url'] in live]
    newp = [p for p in live_pages if p['no_metrics']]
    insights = []
    insights.append({'id':'cannibal','sev':'critical','title':'Keyword cannibalization: %d open consolidation groups' % len(open_groups),
        'body':'Groups of live pages competing for the same primary term (from crawler/flags.json — editorial judgment). Severity recomputed from this crawl: still-live counts shrink as redirects ship.','count':len(open_groups)})
    if no_pillar:
        insights.append({'id':'nopillar','sev':'serious','title':'Clusters with no pillar page: ' + ', '.join(no_pillar),
            'body':'A cluster without a pillar has nothing for its fan-out pages to link up to.','count':len(no_pillar)})
    if gone:
        insights.append({'id':'p404','sev':'critical','title':'%d URLs return 404' % len(gone),
            'body':'Hard 404s found this crawl. Deliberately retired pages should 301 to their nearest replacement instead of 404ing.','count':len(gone),'items':gone})
    if noindex:
        insights.append({'id':'noidx','sev':'serious','title':'%d pages are noindexed' % len(noindex),
            'body':'These returned 200 but carry a noindex meta robots tag — excluded from the board. If any noindex is accidental, that page is invisible to Google.','count':len(noindex),'items':noindex})
    if canon_mismatch:
        insights.append({'id':'canon','sev':'warning','title':'%d pages canonicalize elsewhere' % len(canon_mismatch),
            'body':'rel=canonical points at a different URL — Google may credit that URL instead.','count':len(canon_mismatch),
            'items':[k + ' → ' + v for k, v in sorted(canon_mismatch.items())]})
    if t302:
        insights.append({'id':'t302','sev':'warning','title':'%d redirects are 302 (temporary), not 301' % len(t302),
            'body':'A 302 tells Google the move is temporary, so link equity may not transfer. Retired pages should use 301.','count':len(t302),
            'items':[r['old'] + ' → ' + r['to'] for r in t302]})
    insights.append({'id':'sitemap','sev':'serious','title':'%d redirecting URLs are still advertised in the sitemap' % n_sm,
        'body':'A sitemap should only list canonical, 200-status URLs; redirecting entries waste crawl budget.','count':n_sm})
    insights.append({'id':'soft404','sev':'warning','title':'%d redirects point at listing pages (soft-404 pattern)' % len(soft),
        'body':'Redirects into listing/hub pages pass no topical relevance. Fine for true retirements; a loss for pages that had links or rankings.','count':len(soft),
        'items':[r['old'] + ' → ' + r['to'] for r in soft]})
    insights.append({'id':'slugs','sev':'warning','title':'%d slug-update candidates' % len(slugs_live),
        'body':'Live URLs whose slug misses its own primary keyword or carries a duplicate/part-N suffix (from crawler/flags.json). Ship each with a 301.','count':len(slugs_live)})
    insights.append({'id':'fresh','sev':'info','title':'%d live pages have no SEMrush data yet' % len(newp),
        'body':'New since the last SEMrush pull (or never ranked). GSC data covers them as soon as Google indexes them.','count':len(newp)})

    counts = {c: {t: sum(1 for p in pages if p['cat'] == c and p['tier'] == t) for t in ('transactional','pillar','fanout','redirect')} for c in CATS}
    for c in CATS: counts[c]['kw'] = sum(p['kw'] for p in pages if p['cat'] == c and p['tier'] != 'redirect')

    prev_v = prev.get('stats', {}).get('vintages', {})
    stats = {
        'crawled': len(inventory), 'total': len(live_pages), 'redirects': len(redir_rows),
        'gone': len(gone), 'noindex': len(noindex),
        'keywords': sum(p['kw'] for p in live_pages), 'traffic': sum(p['traffic'] for p in live_pages),
        'ranking': sum(1 for p in live_pages if p['kw'] > 0),
        'nokw': sum(1 for p in live_pages if 'nokw' in p['flags']), 'no_metrics': len(newp),
        'transactional': sum(1 for p in live_pages if p['tier'] == 'transactional'),
        'pillar': sum(1 for p in live_pages if p['tier'] == 'pillar'),
        'fanout': sum(1 for p in live_pages if p['tier'] == 'fanout'),
        'groups_open': len(open_groups), 'slugs': len(slugs_live),
        'generated': STAMP, 'crawl_date': TODAY,
        'vintages': {
            'crawl': STAMP + ' — automated crawl (GitHub Action): status, redirects incl. 301/302, meta robots, canonicals',
            'semrush_pages': prev_v.get('semrush_pages', 'carried forward'),
            'semrush_kw': prev_v.get('semrush_kw', 'carried forward'),
        },
        'partial': 'SEMrush metrics carried forward (' + prev_v.get('semrush_pages', 'earlier build').split(' — ')[0] + '); crawl data fresh as of ' + STAMP + '. GSC supplies live query/click data in the app.',
        'built_by': 'github-action',
    }
    payload = {'stats': stats, 'cats': CATS, 'counts': counts, 'pages': pages,
               'groups': flags['consolidation_groups'], 'slugs': flags['slug_fixes'],
               'insights': insights, 'redirects': redir_rows}
    json.dump(payload, open(os.path.join(ROOT, 'data.json'), 'w'), separators=(',', ':'))
    try:
        v = json.load(open(os.path.join(ROOT, 'version.json')))
    except Exception:
        v = {}
    v['data'] = STAMP
    json.dump(v, open(os.path.join(ROOT, 'version.json'), 'w'))
    print('OK: %d live, %d redirects (%d×302), %d gone, %d noindex, %d new pages' %
          (len(live_pages), len(redir_rows), len(t302), len(gone), len(newp)))

if __name__ == '__main__':
    main()
