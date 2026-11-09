#!/usr/bin/env python3
"""Check every moment in data/sports-history.json against its Wikipedia article.

A moment passes when the article's wikitext states its exact date ("November 9, 1996",
"9 November 1996" or a {{date|1996|11|9}}-style template). Run after adding moments;
anything printed as NO needs a better article or a corrected date before it ships.

    python3 tools/verify-sports-history.py [data/sports-history.json]
"""
import json, re, sys, time, urllib.parse, urllib.request

MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
          'September', 'October', 'November', 'December']

def wikitext(title, hops=3):
    for _ in range(hops):
        url = 'https://en.wikipedia.org/w/index.php?action=raw&title=' + urllib.parse.quote(title.replace(' ', '_'))
        req = urllib.request.Request(url, headers={'User-Agent': 'FamDash sports-history check'})
        try:
            body = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
        except Exception:
            return ''
        m = re.match(r'#REDIRECT\s*\[\[([^\]#]+)', body, re.I)
        if not m:
            return body
        title = m.group(1)
    return ''

def states_date(text, y, m, d):
    pats = [f'{MONTHS[m-1]} {d}, {y}', f'{d} {MONTHS[m-1]} {y}', f'{MONTHS[m-1]}&nbsp;{d}, {y}', f'{MONTHS[m-1]} {d} {y}']
    return any(p in text for p in pats) or re.search(rf'\|\s*{y}\s*\|\s*0?{m}\s*\|\s*0?{d}\s*[|}}]', text) is not None

def main(path):
    data = json.load(open(path))
    bad = 0
    for md, items in sorted(data.items()):
        m, d = map(int, md.split('-'))
        for it in items:
            ok = states_date(wikitext(it['a']), it['y'], m, d)
            bad += not ok
            print('OK ' if ok else 'NO ', md, it['y'], it['a'])
            time.sleep(0.3)
    print(f'{bad} problem(s)')
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data/sports-history.json')
