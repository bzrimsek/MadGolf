#!/usr/bin/env python3
"""audit.py — MadGolf pre-delivery audit.
Usage: python3 audit.py [path/to/index.html]
Must pass with 0 failures before every delivery. No exceptions.

Checks:
  1. JS syntax (node --check)
  2. APP_VERSION present and valid
  3. Changelog entry for current version exists and is non-blank
  4. HTML: no unclosed <div class="card"> or <div class="modal-overlay">
  5. HTML: all modal-overlay divs have an id attribute
  6. HTML: no 'trm-' element IDs (old fsRender form pattern — must use modal IDs)
  7. No bare fsShowGameTab() calls without a label argument
  8. No adminMode references
  9. sw.js CACHE_NAME matches APP_VERSION
"""
import sys, re, os, subprocess

def fail(msg):
    print(f'  ✖ FAIL: {msg}')
    return False

def ok(msg):
    print(f'  ✓ {msg}')
    return True

def run_audit(html_path):
    sw_path = os.path.join(os.path.dirname(html_path), 'sw.js')
    failures = 0

    print(f'\nAudit: {html_path}\n')

    with open(html_path, encoding='utf-8') as f:
        html = f.read()

    # ── 1. Extract JS and syntax check ───────────────────────────
    blocks = re.findall(r'<script(?![^>]*\bsrc\b)(?![^>]*type=["\']module["\'])[^>]*>([\s\S]*?)<\/script>', html)
    raw_js = '\n'.join(blocks)
    js_tmp = '/tmp/audit_madgolf.js'
    with open(js_tmp, 'w') as f:
        f.write(raw_js)
    result = subprocess.run(['node', '--check', js_tmp], capture_output=True, text=True)
    if result.returncode != 0:
        failures += 1
        fail('JS syntax error:\n' + result.stderr[:400])
    else:
        ok('JS syntax valid')

    # ── 2. APP_VERSION ────────────────────────────────────────────
    m = re.search(r"const APP_VERSION\s*=\s*'([\d.]+)'", html)
    if not m:
        failures += 1; fail('APP_VERSION not found')
    else:
        version = m.group(1)
        ok(f'APP_VERSION = {version}')

    # ── 3. Changelog entry ────────────────────────────────────────
    if m:
        escaped = re.escape(version)
        if not re.search(rf'//\s*v{escaped}\s+\d{{4}}-\d{{2}}-\d{{2}}\s+.{{5,}}', html):
            failures += 1; fail(f'No changelog entry for v{version}')
        else:
            ok(f'Changelog entry for v{version} found')

    # ── 4. Unclosed card/modal divs ───────────────────────────────
    # Extract HTML (outside script tags)
    html_only = re.sub(r'<script[\s\S]*?</script>', '', html)
    # Count div.card openings vs closings is hard; instead look for the known bad pattern:
    # <div class="card"> immediately followed by comment then another tag without content
    bad_card = re.search(r'<div class="card">\s*\n\s*\n\s*<!--', html_only)
    if bad_card:
        failures += 1; fail('Suspected unclosed <div class="card"> (empty div followed by comment)')
    else:
        ok('No unclosed card divs detected')

    # ── 5. Modal overlay ids ──────────────────────────────────────
    overlays = re.findall(r'<div class="modal-overlay"([^>]*)>', html_only)
    for attrs in overlays:
        if 'id=' not in attrs:
            failures += 1; fail(f'modal-overlay missing id: <div class="modal-overlay"{attrs}>')
            break
    else:
        ok(f'All modal-overlay divs have id ({len(overlays)} found)')

    # ── 6. No trm- IDs ───────────────────────────────────────────
    if re.search(r"getElementById\('trm-|id=\"trm-|id='trm-", html):
        failures += 1; fail("Found 'trm-' element IDs — old fsRender form pattern, must use modal IDs")
    else:
        ok('No trm- element IDs')

    # ── 7. No bare fsShowGameTab() ────────────────────────────────
    bare = [l.strip() for l in raw_js.split('\n')
            if 'fsShowGameTab()' in l
            and 'function fsShow' not in l
            and 'fsShow() {' not in l]
    if bare:
        failures += 1; fail(f'Bare fsShowGameTab() without label ({len(bare)} instances)')
    else:
        ok('All fsShowGameTab() calls have label argument')

    # ── 8. No adminMode ──────────────────────────────────────────
    admin_refs = [l.strip() for l in html.split('\n')
                  if 'adminMode' in l and '// ' not in l.lstrip()[:3] and 'changelog' not in l.lower()]
    if admin_refs:
        failures += 1; fail(f'adminMode references found ({len(admin_refs)} lines)')
    else:
        ok('No adminMode references')

    # ── 9. sw.js version match ────────────────────────────────────
    if os.path.exists(sw_path):
        with open(sw_path) as f:
            sw = f.read()
        sw_m = re.search(r"madgolf-v([\d.]+)", sw)
        if sw_m and m:
            if sw_m.group(1) != version:
                failures += 1; fail(f'sw.js CACHE_NAME v{sw_m.group(1)} != APP_VERSION v{version}')
            else:
                ok(f'sw.js CACHE_NAME matches v{version}')
        else:
            failures += 1; fail('Could not parse sw.js CACHE_NAME')
    else:
        failures += 1; fail(f'sw.js not found at {sw_path}')

    # ── Summary ───────────────────────────────────────────────────
    print()
    if failures == 0:
        print(f'  ✔ All checks passed — safe to deliver\n')
    else:
        print(f'  ✖ {failures} check(s) failed — DO NOT DELIVER\n')
    return failures == 0

if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/outputs/madgolf/index.html'
    ok = run_audit(path)
    sys.exit(0 if ok else 1)
