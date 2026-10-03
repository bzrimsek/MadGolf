#!/usr/bin/env python3
"""The whole gate in one command - what the cloud runs before anything goes live.

    python gate.py              everything this build needs
    python gate.py --fast       audit, tests, lint, consistency
    python gate.py --slow       the browser walk, WebKit, the Firebase rules
    python gate.py --all        everything, whatever changed

Ported from Bottlefolio's gate.py on 2026-10-03. The commands come from
checks.json, the table check.js reads too, so the cloud and the PC cannot
disagree about what a check is. This file only says how they are GROUPED.

Each group runs at once; the next waits for it to pass, because a build that
fails a two-second check is not worth a minute of browser. Results print in
this file's order, one line each, with the time against the median of the last
nine runs (rule 13e) - under nine it says so rather than inventing a number.
"""
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, '.gatetimes.json')
TABLE = json.load(open(os.path.join(HERE, 'checks.json'), encoding='utf-8'))
BY_NAME = {c['name']: c for c in TABLE['checks']}

# The grouping. consistency.js fails if a check in checks.json is in neither.
FAST = [['audit', 'tests'], ['lint', 'consistency']]
SLOW = [['walk', 'ios']]   # ['rules'] joins once the MadGolf admin key exists (CLAUDE.md)

# A harness that ends without its pass line did not pass, whatever its exit
# code: a skip is not a pass, and a harness that stopped early says nothing.
MUST_SAY = {
    'audit': 'All checks passed',
    'tests': 'tests passed',
    'consistency': 'consistency checks pass',
    'walk': 'walk passed',
    'ios': 'ios passed',
    'rules': 'all rules checks pass',
}


def command(name):
    c = BY_NAME[name]
    tool = sys.executable if c['harness'].endswith('.py') else 'node'
    return [tool, c['harness']] + c.get('args', [])


def history():
    try:
        with open(LOG) as f:
            return json.load(f)
    except Exception:
        return {}


def expected(h, step):
    runs = h.get(step, [])
    return sorted(runs[-9:])[4] if len(runs) >= 9 else None


def failed(name, r):
    out = (r.stdout or '') + '\n' + (r.stderr or '')
    if r.returncode != 0 or '✖' in out or '✗' in out:
        return True
    return name in MUST_SAY and MUST_SAY[name] not in out


def run_step(name):
    t0 = time.time()
    env = dict(os.environ, PYTHONUTF8='1')
    r = subprocess.run(command(name), capture_output=True, text=True, cwd=HERE,
                       env=env, encoding='utf-8', errors='replace')
    return r, time.time() - t0


def wanted(args):
    """Which checks this build needs, asked of check.js. None = run everything,
    the only safe way to be wrong here."""
    if '--all' in args or os.environ.get('GATE_ALL'):
        return None
    base = os.environ.get('GATE_BASE', 'origin/main')
    try:
        r = subprocess.run(['node', 'check.js', '--names', '--since', base],
                           capture_output=True, text=True, cwd=HERE, timeout=120)
    except Exception as e:
        print('scope: could not ask check.js (%s) - running everything\n' % e)
        return None
    names = {l.strip() for l in (r.stdout or '').split('\n') if l.strip()}
    if r.returncode != 0 or not names:
        print('scope: check.js gave no answer - running everything\n')
        return None
    if names - set(BY_NAME):
        print('scope: check.js named a check checks.json lacks - running everything\n')
        return None
    for must in ('audit', 'lint', 'consistency'):
        if must not in names:
            print('scope: check.js left out %s - running everything\n' % must)
            return None
    return names


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    args = sys.argv[1:]
    every = {n for g in FAST + SLOW for n in g}
    missing = sorted(set(BY_NAME) - every)
    if missing:
        sys.exit('gate.py: %s is in checks.json but in no group here - it would '
                 'never run.' % ', '.join(missing))
    groups = FAST if '--fast' in args else SLOW if '--slow' in args else FAST + SLOW
    only = wanted(args)
    if only is not None:
        left = sorted(n for g in groups for n in g if n not in only)
        groups = [[n for n in g if n in only] for g in groups]
        groups = [g for g in groups if g]
        print('scope: not needed by this build - %s\n' % ' '.join(left) if left
              else 'scope: this build reaches every check here\n')

    h = history()
    exp = [max(filter(None, [expected(h, n) for n in g]), default=None) for g in groups]
    names = [n for g in groups for n in g]
    if groups and all(exp):
        print('running %d steps, about %.0fs expected\n' % (len(names), sum(exp)))
    else:
        print('running %d steps, no expectation yet (under nine runs on record)\n'
              % len(names))

    t_all = time.time()
    bad = []
    for group in groups:
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=len(group)) as pool:
            results = list(pool.map(run_step, group))
        for name, (r, took) in zip(group, results):
            e = expected(h, name)
            h.setdefault(name, []).append(round(took, 1))
            h[name] = h[name][-30:]
            lines = [l for l in (r.stdout or '').strip().split('\n') if l.strip()]
            last = lines[-1].strip()[:64] if lines else '(no output)'
            no = failed(name, r)
            against = ('%5.1fs against %.0fs' % (took, e)) if e else ('%5.1fs (no expectation yet)' % took)
            print('%-12s %s  %s  %s' % (name, 'FAIL' if no else 'ok  ', against, last), flush=True)
            if no:
                bad.append((name, r, lines))
        if len(group) > 1:
            print('%-12s       %.1fs for these %d at once' % ('', time.time() - t0, len(group)))
        if bad:
            for name, r, lines in bad:
                print('\n%s:' % name)
                print('\n'.join('    ' + l for l in lines[-20:]))
                err = [l for l in (r.stderr or '').strip().split('\n') if l.strip()]
                if err:
                    print('\n'.join('    ' + l for l in err[-16:]))
                if name in MUST_SAY and r.returncode == 0 and MUST_SAY[name] not in (r.stdout or ''):
                    print('    ended without saying "%s"' % MUST_SAY[name])
            break

    with open(LOG, 'w') as f:
        json.dump(h, f)
    print('')
    if bad:
        print('✖ STOPPED AT %s after %.0fs - DO NOT SHIP'
              % (', '.join(n for n, _, _ in bad), time.time() - t_all))
        sys.exit(1)
    print('✔ all %d steps passed in %.0fs' % (len(names), time.time() - t_all))


if __name__ == '__main__':
    main()
