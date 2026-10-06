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
#
# ROOTS, not a list: every function a root calls, and every one THOSE call, is
# copied too, so a helper added to the engine tomorrow is carried without
# anyone remembering to list it. live.html is the one page for everyone in a
# round (BZ, 2026-10-05): the app's scorecard for players, and - since the
# board froze while BZ's app was in the background - the app's own trip
# engine (liveFromSrc), so the page works every board out itself.
# score.html only forwards old links there and carries no copies.
ROOTS = {
    'live.html': ['esc', 'firstNameOf', 'scorecardName', 'renderScorecardGroup',
                  'buildScoringIndex', 'advanceToNext', 'liveFromSrc'],
}
CONSTS = {'live.html': ['GROUP_COLORS', 'GROUP_BORDERS']}
# Never followed: the page does not save. outingComputeResults saves the teams
# it draws for a blind draw (fsSaveGame), and the published outing already has
# them, so live.html defines fsSaveGame as a no-op instead of carrying the
# app's whole save path.
STOP = {'fsSaveGame'}
CSS = {
    'live.html': [':root', '*', 'header', '.hdr-inner', '.hdr-left', '.hdr-logo', '.hdr-title',
                  '.hdr-sub', '.card', '.hole-grid', '.hole-cell', '.hole-cell.header',
                  '.hole-cell.total', '.hole-cell.par-cell', '.game-score-input',
                  '.game-score-input:focus', '.holes-toggle', '.holes-toggle.active'],
}


def _body_end(i):
    """Index just past the brace that closes the body opening at or after i.
    Skips strings, template literals and comments, so a '{' inside one is not
    counted. A regex literal holding a brace would fool it; lint.js would then
    fail the page, which is where that is caught."""
    i = INDEX.index('{', i)
    depth, n = 0, len(INDEX)
    while i < n:
        c = INDEX[i]
        if c in '\'"`':
            q, i = c, i + 1
            while i < n and INDEX[i] != q:
                i += 2 if INDEX[i] == '\\' else 1
        elif INDEX.startswith('//', i):
            i = INDEX.index('\n', i)
        elif INDEX.startswith('/*', i):
            i = INDEX.index('*/', i) + 1
        elif c == '/' and INDEX[:i].rstrip()[-1:] in '(,=:[!&|?{};+':
            # A regex literal (esc's /[<>"'&]/ held both quotes): skip to its
            # closing slash, minding escapes and [...] classes.
            i, cls = i + 1, False
            while i < n and (cls or INDEX[i] != '/'):
                if INDEX[i] == '\\':
                    i += 1
                elif INDEX[i] == '[':
                    cls = True
                elif INDEX[i] == ']':
                    cls = False
                i += 1
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    sys.exit('pages.py: unbalanced braces after offset %d' % i)


TOP = {m.group(1): m.start() for m in re.finditer(r'^(?:async )?function (\w+)\s*\(', INDEX, re.M)}


def func_src(name):
    if name not in TOP:
        sys.exit('pages.py: function %s not found in index.html' % name)
    a = TOP[name]
    b = _body_end(INDEX.index(')', a))
    return INDEX[a:b] + '\n'


def closure(roots):
    """Every top-level function the roots call, in index.html's order."""
    seen, todo = set(), list(roots)
    while todo:
        f = todo.pop()
        if f in seen or f in STOP:
            continue
        seen.add(f)
        for x in re.findall(r'\b([A-Za-z_]\w*)\s*\(', func_src(f)):
            if x in TOP and x not in seen:
                todo.append(x)
    return sorted(seen, key=TOP.get)


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
    funcs = closure(ROOTS[page])
    body = ''.join(func_src(f) for f in funcs)
    # The UPPER_CASE constants the copied functions read come along as well.
    consts = list(CONSTS[page]) + [c for c in re.findall(r'^const ([A-Z][A-Z0-9_]+)\b', INDEX, re.M)
                                   if c not in CONSTS[page] and re.search(r'\b' + c + r'\b', body)]
    js = ''.join(const_src(c) for c in consts) + body
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
    for page in ROOTS:
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
        print('  ✓ pages: live.html carries the app\'s current scorecard and board code (%d functions)'
              % len(closure(ROOTS['live.html'])))
    else:
        print('rewrote: %s' % (', '.join(stale) or 'nothing (already current)'))


if __name__ == '__main__':
    main()
