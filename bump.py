#!/usr/bin/env python3
"""
Version bumper for MadGolf. The ONLY way versions change (rule 9).

Reads the system clock - never accepts a timestamp argument, never asks
anyone what time it is.

Writes:
  1. index.html header comment  "Version : vX.Y.Z  Build <stamp>"
  2. index.html  const APP_VERSION
  3. index.html  const BUILD_TIME
  4. sw.js       CACHE_NAME
  (MadGolf draws 'v' + APP_VERSION on screen at runtime, so there is no
  static UI string to write - the old multi-app bump.py said the same.)

Plus the changelog, from one entry, in two places:
  - index.html's CHANGELOG block gets the HEADLINE only (first sentence,
    capped), newest first:   // vX.Y.Z  YYYY-MM-DD  headline
    and keeps the last KEEP_IN_HEADER versions.
  - CHANGELOG.md gets the entry in full.

Then the lock pair, cut from the files just written (rule 23), and the
previous version's locks removed.

Usage:
    python bump.py "what changed, in full sentences"
    python bump.py 0.92.0 "entry"                 a chosen version, ahead only
    python bump.py --renumber 0.92.0 "entry"      a chosen version, any direction

Replaces the old "bump.py madgolf auto / touch" in Apps I've Built, which
wrote to /mnt/user-data/outputs/madgolf - a path from the web container.
"""
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).parent
INDEX = HERE / 'index.html'
SW = HERE / 'sw.js'
CHANGELOG = HERE / 'CHANGELOG.md'

KEEP_IN_HEADER = 10
HEADLINE_MAX = 150
ROLLED = '// Older entries are in CHANGELOG.md.'
CL_HEAD = ('# MadGolf - changelog\n\n'
           'Newest first. The file header in index.html carries the '
           'headlines; the full entries live here.\n')
MARKER = 'live here.\n'
# One changelog line. Five old lines are version RANGES with a date range
# (`// v0.90.1-.28   2026-06-26 to 06-29  ...`), so neither part is a bare
# number; seeding and trimming both read lines through this one pattern.
ENTRY = re.compile(r'(// v(\S+)\s+(\d{4}-\d{2}-\d{2}(?: to [\d-]+)?)\s+)(.*)')


def headline(entry):
    """First sentence, trimmed to something that fits one line."""
    m = re.match(r'(.+?[.!?])(\s|$)', entry)
    head = (m.group(1) if m else entry).strip()
    if len(head) > HEADLINE_MAX:
        head = head[:HEADLINE_MAX].rsplit(' ', 1)[0].rstrip(' ,;:') + '…'
    return head


def eastern_now():
    """Eastern Time without a tz-database dependency: EDT (UTC-4) from the
    second Sunday in March to the first Sunday in November, else EST."""
    utc = datetime.now(timezone.utc)

    def nth_sunday(year, month, n):
        d = datetime(year, month, 1, tzinfo=timezone.utc)
        d += timedelta(days=(6 - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)

    y = utc.year
    dst_start = nth_sunday(y, 3, 2).replace(hour=7)
    dst_end = nth_sunday(y, 11, 1).replace(hour=6)
    offset = -4 if dst_start <= utc < dst_end else -5
    return utc + timedelta(hours=offset)


def read_version(text):
    m = re.search(r"const APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'", text)
    if not m:
        sys.exit('APP_VERSION not found in index.html - cannot bump.')
    return tuple(int(g) for g in m.groups())


def next_version(major, minor, patch):
    patch += 1
    if patch >= 100:
        patch, minor = 0, minor + 1
    if minor >= 100:
        minor, major = 0, major + 1
    return major, minor, patch


def seed_changelog(html):
    """The first run moves every full entry out of the index.html header into
    CHANGELOG.md, so nothing is lost when the header is trimmed to headlines.
    Runs once: after that CHANGELOG.md exists and the header holds headlines."""
    block = re.search(r'\nCHANGELOG\n((?:(?://.*)?\n)+?)-->', html)
    lines = [l for l in block.group(1).split('\n') if l.startswith('// v')] if block else []
    body = CL_HEAD
    for l in lines:
        m = ENTRY.match(l)
        if not m:
            sys.exit('Cannot read this changelog line, so it would be lost: ' + l[:80])
        body += '\n## v%s  ·  %s\n\n%s\n' % (m.group(2), m.group(3), m.group(4).strip())
    return body, len(lines)


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    args = sys.argv[1:]
    if not args or not ' '.join(args).strip():
        sys.exit('Refusing to bump: a changelog entry is required.\n'
                 'Usage: python bump.py [--renumber] [x.y.z] "what changed"')
    renumber = False
    if args[0].strip() == '--renumber':
        renumber, args = True, args[1:]
    forced = None
    if args and re.fullmatch(r'\d+\.\d+\.\d+', args[0].strip()):
        forced = tuple(int(x) for x in args[0].strip().split('.'))
        args = args[1:]
    entry = ' '.join(' '.join(args).split())
    if not entry:
        sys.exit('Refusing to bump: a changelog entry is still required.')
    if '[describe changes here]' in entry:
        sys.exit('Refusing to bump: changelog placeholder not filled in.')

    # UTF-8 and LF, said outright: on Windows the defaults are the ANSI
    # codepage and CRLF, and a CRLF index.html is one the harness cannot split.
    html = INDEX.read_text(encoding='utf-8')
    sw = SW.read_text(encoding='utf-8')

    cur = read_version(html)
    if forced:
        if forced <= cur and not renumber:
            sys.exit('Refusing to bump: %d.%d.%d is not ahead of %d.%d.%d.\n'
                     'If you mean it, say so: bump.py --renumber x.y.z "entry"'
                     % (forced + cur))
        if forced == cur:
            # The cache name carries the version, so the same number gives the
            # worker no reason to believe anything changed.
            print('  ! RE-CUTTING THE SAME VERSION: phones that already have it '
                  'will not update.')
        major, minor, patch = forced
    else:
        major, minor, patch = next_version(*cur)
    ver = '%d.%d.%d' % (major, minor, patch)
    now = eastern_now()
    stamp = now.strftime('%Y-%m-%d %I:%M %p ET')
    day = now.strftime('%Y-%m-%d')

    seeded = 0
    if CHANGELOG.exists():
        body = CHANGELOG.read_text(encoding='utf-8')
    else:
        body, seeded = seed_changelog(html)

    html, n = re.subn(r'(     Version : v)[\d.]+(  Build ).*',
                      lambda m: m.group(1) + ver + m.group(2) + stamp, html, count=1)
    if not n:
        sys.exit('Header "Version :" line not found - cannot bump.')

    head = headline(entry)
    html, n = re.subn(r'(\nCHANGELOG\n)',
                      lambda m: m.group(1) + '// v%s  %s  %s\n' % (ver, day, head),
                      html, count=1)
    if not n:
        sys.exit('CHANGELOG block not found - cannot bump.')

    # The header keeps headlines only. Entries written before CHANGELOG.md
    # existed are whole paragraphs; they are in CHANGELOG.md now, so each is
    # cut to its headline here.
    block = re.search(r'\nCHANGELOG\n((?:(?://.*)?\n)+?)-->', html)
    if block:
        kept = []
        for l in block.group(1).split('\n'):
            m = ENTRY.match(l)
            if m:
                kept.append(m.group(1) + headline(m.group(4)))
            elif l.startswith('// v'):
                sys.exit('Cannot read this changelog line: ' + l[:80])
        html = html.replace(block.group(1),
                            '\n'.join(kept[:KEEP_IN_HEADER] + [ROLLED]) + '\n', 1)

    html, n = re.subn(r"(const APP_VERSION\s*=\s*')[\d.]+(')",
                      lambda m: m.group(1) + ver + m.group(2), html, count=1)
    if not n:
        sys.exit('APP_VERSION not found - cannot bump.')
    html, n = re.subn(r"(const BUILD_TIME\s*=\s*')[^']*(')[^\n]*",
                      lambda m: m.group(1) + stamp + m.group(2) + ';  // written by bump.py',
                      html, count=1)
    if not n:
        sys.exit('BUILD_TIME not found - cannot bump.')

    sw, n = re.subn(r"(const CACHE_NAME\s*=\s*'madgolf-v)[\d.]+(')",
                    lambda m: m.group(1) + ver + m.group(2), sw, count=1)
    if not n:
        sys.exit('CACHE_NAME not found in sw.js - cannot bump.')

    record = '\n## v%s  ·  %s\n\n%s\n' % (ver, stamp, entry)
    body = body.replace(MARKER, MARKER + record, 1) if MARKER in body \
        else body.rstrip() + '\n' + record

    INDEX.write_text(html, encoding='utf-8', newline='\n')
    SW.write_text(sw, encoding='utf-8', newline='\n')
    CHANGELOG.write_text(body, encoding='utf-8', newline='\n')

    lock_html = HERE / ('madgolf-v%s.html' % ver)
    lock_sw = HERE / ('madgolf-v%s-sw.js' % ver)
    shutil.copy(INDEX, lock_html)
    shutil.copy(SW, lock_sw)
    for old in HERE.glob('madgolf-v*'):
        if old.name not in (lock_html.name, lock_sw.name) \
                and re.match(r'madgolf-v[\d.]+(-sw\.js|\.html)$', old.name):
            old.unlink()

    print('bumped to v%s  Build %s' % (ver, stamp))
    if seeded:
        print('CHANGELOG.md created with the %d entries the header held' % seeded)
    print('header:    // v%s  %s  %s' % (ver, day, head))
    print('locks:     madgolf-v%s.html + madgolf-v%s-sw.js' % (ver, ver))
    print('now run:   python push.py "short subject"')


if __name__ == '__main__':
    main()
