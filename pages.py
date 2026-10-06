#!/usr/bin/env python3
"""Write the app's own scorecard code and styles into score.html and live.html.

    python pages.py           rewrite the COPIED blocks from index.html
    python pages.py --check   say whether they already match (consistency.js asks)

BZ, 2026-10-05: the scoring link and the live board "are horrible - we already
have a UX for scorecard entry, so use it". They stay separate pages (BZ chose
that), so the app's code is COPIED into them - and a copy typed by hand drifts.
This copies it from index.html byte for byte, between markers, and --check
fails the build when a copy no longer matches. Change the scorecard in
index.html, run this, and both pages follow.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
INDEX = (HERE / 'index.html').read_text(encoding='utf-8')

# What each page borrows from the app.
FUNCS = {
    # live.html is the one page for everyone in a round (BZ, 2026-10-05):
    # the app's scorecard for players, the board for all. score.html only
    # forwards old links there and carries no copies.
    'live.html': ['esc', 'lastNameOf', 'firstNameOf', 'scorecardName', 'strokesOnHole',
                  'scoreCell', 'scorecardHdr', 'renderScorecardGroup',
                  'buildScoringIndex', 'advanceToNext'],
}
CONSTS = {'live.html': ['GROUP_COLORS', 'GROUP_BORDERS']}
CSS = {
    'live.html': [':root', '*', 'header', '.hdr-inner', '.hdr-left', '.hdr-logo', '.hdr-title',
                  '.hdr-sub', '.card', '.hole-grid', '.hole-cell', '.hole-cell.header',
                  '.hole-cell.total', '.hole-cell.par-cell', '.game-score-input',
                  '.game-score-input:focus', '.holes-toggle', '.holes-toggle.active'],
}


def func_src(name):
    m = re.search(r'^function ' + re.escape(name) + r'\(.*?^}\n', INDEX, re.S | re.M)
    if not m:
        sys.exit('pages.py: function %s not found in index.html' % name)
    return m.group(0)


def const_src(name):
    m = re.search(r'^const ' + re.escape(name) + r'\b.*?;\n', INDEX, re.M)
    if not m:
        sys.exit('pages.py: const %s not found in index.html' % name)
    return m.group(0)


def css_src(sel):
    m = re.search(r'^' + re.escape(sel) + r'\s*\{[^}]*\}\n', INDEX, re.M)
    if not m:
        sys.exit('pages.py: CSS rule %s not found in index.html' % sel)
    return m.group(0)


def block(page):
    css = ''.join(css_src(s) for s in CSS[page])
    js = ''.join(const_src(c) for c in CONSTS[page]) + ''.join(func_src(f) for f in FUNCS[page])
    return css, js


CSS_A, CSS_B = '/* COPIED-CSS from index.html by pages.py - do not edit here */\n', '/* END COPIED-CSS */'
JS_A, JS_B = '/* COPIED-JS from index.html by pages.py - do not edit here */\n', '/* END COPIED-JS */'


def apply(page, text):
    css, js = block(page)
    out = re.sub(re.escape(CSS_A) + r'.*?' + re.escape(CSS_B), lambda m: CSS_A + css + CSS_B, text, flags=re.S)
    out = re.sub(re.escape(JS_A) + r'.*?' + re.escape(JS_B), lambda m: JS_A + js + JS_B, out, flags=re.S)
    if CSS_A not in out or JS_A not in out:
        sys.exit('pages.py: %s has no COPIED-CSS / COPIED-JS markers' % page)
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # Windows console
    except Exception:
        pass
    check = '--check' in sys.argv
    stale = []
    for page in FUNCS:
        p = HERE / page
        text = p.read_text(encoding='utf-8')
        new = apply(page, text)
        if new != text:
            stale.append(page)
            if not check:
                p.write_text(new, encoding='utf-8', newline='\n')
    if check:
        if stale:
            print('  ✖ pages: %s copy the app\'s scorecard code and it has changed - run python pages.py'
                  % ', '.join(stale))
            sys.exit(1)
        print('  ✓ pages: live.html carries the app\'s current scorecard code')
    else:
        print('rewrote: %s' % (', '.join(stale) or 'nothing (already current)'))


if __name__ == '__main__':
    main()
