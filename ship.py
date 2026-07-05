#!/usr/bin/env python3
"""ship.py — MadGolf pre-ship gate.

Runs the pre-delivery audit AND the test harness. Refuses to ship unless BOTH pass.
This is the single gate: run `python3 ship.py` before every push. Nothing ships red.

Usage: python3 ship.py [path/to/index.html]     (default: index.html next to this script)
Exit 0 = safe to ship.  Exit 1 = do not ship.

Expects audit.py, madgolf-test.js, sw.js, and index.html in the same folder.
"""
import sys, os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))

def locate(name, alt_dir):
    for d in (HERE, alt_dir):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None

def main():
    index = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'index.html'))
    base  = os.path.dirname(index)

    if not os.path.exists(index):
        print(f'\n  ✖ index.html not found at {index}\n')
        return 1

    audit = locate('audit.py', base)
    tests = locate('madgolf-test.js', base)

    m = re.search(r"APP_VERSION\s*=\s*'([\d.]+)'", open(index, encoding='utf-8').read())
    ver = m.group(1) if m else '?'

    print(f'\n══════════ ship gate — MadGolf v{ver} ══════════\n')
    ok = True

    # 1) Audit ────────────────────────────────────────────────
    if not audit:
        print('  ✖ audit.py not found alongside index.html'); ok = False
    else:
        print('▸ audit')
        r = subprocess.run(['python3', audit, index], capture_output=True, text=True)
        if r.returncode != 0:
            sys.stdout.write(r.stdout + r.stderr)
            print('  ✖ AUDIT FAILED'); ok = False
        else:
            print('  ✓ audit passed')

    # 2) Tests ────────────────────────────────────────────────
    if not tests:
        print('  ✖ madgolf-test.js not found alongside index.html'); ok = False
    else:
        print('▸ tests')
        r = subprocess.run(['node', tests, index], capture_output=True, text=True)
        out = r.stdout + r.stderr
        if r.returncode != 0:
            sys.stdout.write(out)
            print('  ✖ TESTS FAILED'); ok = False
        else:
            summary = next((l.strip() for l in out.splitlines() if 'passed' in l), 'tests passed')
            print(f'  ✓ {summary}')

    # Verdict ─────────────────────────────────────────────────
    print()
    if ok:
        print(f'  ✔ SAFE TO SHIP — v{ver}')
        print(f'    upload: index.html, sw.js, madgolf-v{ver}.html, madgolf-v{ver}-sw.js')
        print(f'    (+ madgolf-test.js if tests changed this session — rule 29)\n')
        return 0
    print('  ✖ DO NOT SHIP — fix the failure(s) above\n')
    return 1

if __name__ == '__main__':
    sys.exit(main())
