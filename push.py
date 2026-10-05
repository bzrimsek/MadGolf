#!/usr/bin/env python3
"""Push a finished MadGolf build to GitHub, gate it in the cloud, and wait
until it is live.

Ported from Bottlefolio's push.py on 2026-10-03, when MadGolf moved from the
web container to BZ's PC. Before this, a build went live the moment its
files were uploaded to `main`, and the old Ship Gate ran AFTER - a red gate
on a site that had already changed. Now:

    python bump.py "what changed"      the version, as always (rule 9)
    python push.py "short subject"     everything below

  1. The audit runs here first: the named lock is the file that was tested
     (rule 25), and it takes seconds.
  2. No earlier gate run may still be going - a build made on a main that
     run is about to move can never publish. Refused, with that run's link.
  3. Every changed file goes to the `build` branch as ONE commit, made on
     main as it is now. Files the project has retired are removed in the
     same commit.
  4. GitHub runs the whole gate on that commit (.github/workflows/gate.yml).
     Green deploys the Firebase rules (only if they changed), then moves
     `main`, which is what the site serves. Red leaves everything live as
     it was.
  5. This script follows that run and prints each step as it finishes, for
     twenty minutes at most.

Credentials: the `gh` command's own sign-in (`gh auth login`). This script
never sees a token.

Usage:
    python push.py "subject"       push, then watch the cloud gate to the end
    python push.py --no-wait       push and return without watching
    python push.py --dry-run       say what would be pushed; push nothing
"""

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

REPO = 'bzrimsek/MadGolf'
LIVE = 'https://bzrimsek.github.io/MadGolf/'
BRANCH = 'build'
HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)

WATCH_LIMIT = 20 * 60

TRANSIENT = re.compile(r'HTTP 5\d\d|timed out|timeout|connection (reset|refused)'
                       r'|error connecting|dial tcp|no such host|TLS handshake'
                       r'|unexpected EOF|unexpected end of JSON|temporar', re.I)

# What the site serves. The gate publishes exactly these (gate.yml, "The
# site, and only the site"); consistency.js fails if the two lists disagree.
APP = ['index.html', 'sw.js', 'manifest.json', 'logo.webp',
       'live.html', 'score.html', 'rsvp.html']
DOCS = ['CHANGELOG.md', 'CLAUDE.md', 'DEV-RULES.md', 'README.md']
TOOLING = ['madgolf-test.js', 'audit.py', 'bump.py', 'push.py', 'gate.py',
           'check.js', 'checks.json', 'lint.js', 'consistency.js',
           'consistency-sizes.json', 'consistency-doors.json',
           'walk-lib.js', 'browser.js', 'ios.js', 'layout.js', 'trips.js', 'fake-firebase.js',
           'rules.js',
           'package.json', 'package-lock.json', '.github/workflows/gate.yml']
SERVICE = ['firebase-rules.json']

# A file that lives somewhere other than this folder. ONE rule book for every
# app (BZ, 2026-10-03): it is edited only in Apps I've Built\, and each app's
# push publishes a copy, which nobody edits.
SOURCE = {'DEV-RULES.md': os.path.join(PARENT, 'DEV-RULES.md')}

# Retired files that must leave the repo, not merely stop being updated: a
# stale ship.py on GitHub is a second, wrong answer to "how do I ship".
REMOVED = ['ship.py']

# NEVER, whatever the lists above say. The repo is public and main is a
# website.
NEVER = [r'\.csv$', r'\.xlsx$', r'rtdb-export', r'^_superseded/',
         r'adminsdk', r'firebase-admin', r'service.?account', r'\.env$',
         r'-backup\.json$', r'\.clasprc']


def gh_path():
    found = shutil.which('gh')
    if found:
        return found
    default = r'C:\Program Files\GitHub CLI\gh.exe'
    if os.path.exists(default):
        return default
    sys.exit('The gh command is not installed. See CLAUDE.md, "Building".')


GH = None


def say(msg):
    print(msg, flush=True)


def gh(path, method='GET', body=None, quiet404=False, retry=False):
    """One GitHub API call through gh's own sign-in. With retry, GitHub's own
    5xx or a network blip is asked again, four tries over about a minute."""
    cmd = [GH, 'api', '-X', method, path]
    data = None
    if body is not None:
        cmd += ['--input', '-']
        data = json.dumps(body).encode()
    waits = [5, 15, 40] if retry else []
    tries = 0
    while True:
        tries += 1
        r = subprocess.run(cmd, input=data, capture_output=True)
        if not r.returncode:
            break
        err = (r.stderr or r.stdout).decode(errors='replace').strip()
        if quiet404 and 'HTTP 404' in err:
            return None
        if retry and TRANSIENT.search(err) and waits:
            wait = waits.pop(0)
            say('  (GitHub did not answer %s %s - asking again in %ds)'
                % (method, path.split('?')[0], wait))
            time.sleep(wait)
            continue
        sys.exit('GitHub refused %s %s: %s' % (method, path, err[:300]))
    out = r.stdout.decode()
    return json.loads(out) if out.strip() else {}


def version():
    with open(os.path.join(HERE, 'index.html'), encoding='utf-8') as fh:
        m = re.search(r"const APP_VERSION\s*=\s*'([\d.]+)'", fh.read())
    if not m:
        sys.exit('No APP_VERSION in index.html')
    return m.group(1)


def blob_sha(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\x00' + raw).hexdigest()


def audited():
    env = dict(os.environ, PYTHONUTF8='1')
    r = subprocess.run([sys.executable, 'audit.py', 'index.html'], cwd=HERE,
                       capture_output=True, text=True, encoding='utf-8',
                       errors='replace', env=env)
    out = r.stdout + r.stderr
    ok = r.returncode == 0 and 'All checks passed' in out
    if not ok:
        say(out[-1500:])
    return ok


def gate_busy():
    runs = gh('repos/%s/actions/workflows/gate.yml/runs?branch=%s&per_page=20'
              % (REPO, BRANCH), quiet404=True) or {}
    for run in runs.get('workflow_runs', []):
        if run.get('status') != 'completed':
            return run
    return None


def wanted(v):
    names = APP + ['madgolf-v%s.html' % v, 'madgolf-v%s-sw.js' % v]
    names += DOCS + TOOLING + SERVICE
    for n in names + REMOVED:
        for pat in NEVER:
            if re.search(pat, n):
                sys.exit('REFUSED: %s matches a never-push rule (%s).' % (n, pat))
    return names


def local_path(name):
    return SOURCE.get(name) or os.path.join(HERE, name.replace('/', os.sep))


def push(v, subject, dry):
    main = gh('repos/%s/git/ref/heads/main' % REPO)
    main_sha = main['object']['sha']
    tree = gh('repos/%s/git/trees/%s?recursive=1' % (REPO, main_sha))
    have = {t['path']: t['sha'] for t in tree['tree'] if t['type'] == 'blob'}

    changed, missing = [], []
    for name in wanted(v):
        path = local_path(name)
        if not os.path.exists(path):
            missing.append(name)
            continue
        raw = open(path, 'rb').read()
        if have.get(name) != blob_sha(raw):
            changed.append((name, raw))
    # The previous version's lock pair goes when this one arrives, as it does
    # on this PC (bump.py), so the repo holds one pair: the live one.
    gone = [n for n in have
            if (n in REMOVED or re.match(r'madgolf-v[\d.]+(-sw\.js|\.html)$', n))
            and n not in ('madgolf-v%s.html' % v, 'madgolf-v%s-sw.js' % v)]

    for name in missing:
        say('  (not in this folder, left as it is on GitHub: %s)' % name)
    if not changed and not gone:
        say('Nothing differs from what main already has. Nothing pushed.')
        return None
    say('%d file(s) differ from the live main:' % len(changed))
    for name, raw in changed:
        say('  %-34s %8d bytes' % (name, len(raw)))
    for name in gone:
        say('  %-34s  removed' % name)
    if dry:
        say('Dry run: nothing pushed.')
        return None

    entries = []
    for name, raw in changed:
        # retry: a blob POST is safe to repeat (same bytes, same sha), and a
        # dropped upload of index.html stopped the v0.91.21 push (2026-10-05).
        b = gh('repos/%s/git/blobs' % REPO, 'POST',
               {'content': base64.b64encode(raw).decode(), 'encoding': 'base64'}, retry=True)
        entries.append({'path': name, 'mode': '100644', 'type': 'blob', 'sha': b['sha']})
    for name in gone:
        entries.append({'path': name, 'mode': '100644', 'type': 'blob', 'sha': None})
    new_tree = gh('repos/%s/git/trees' % REPO, 'POST',
                  {'base_tree': tree['sha'], 'tree': entries})
    message = 'MadGolf %s: %s' % (v, subject) if subject else 'MadGolf %s' % v
    commit = gh('repos/%s/git/commits' % REPO, 'POST',
                {'message': message, 'tree': new_tree['sha'], 'parents': [main_sha]})
    if gh('repos/%s/git/ref/heads/%s' % (REPO, BRANCH), quiet404=True):
        gh('repos/%s/git/refs/heads/%s' % (REPO, BRANCH), 'PATCH',
           {'sha': commit['sha'], 'force': True})
    else:
        gh('repos/%s/git/refs' % REPO, 'POST',
           {'ref': 'refs/heads/%s' % BRANCH, 'sha': commit['sha']})
    say('Pushed %d file(s), removed %d, to %s as one commit %s.'
        % (len(changed), len(gone), BRANCH, commit['sha'][:7]))
    return commit['sha']


def watch(sha, v):
    """Follow the cloud gate for this commit, a line per finished step."""
    deadline = time.time() + WATCH_LIMIT
    say('\nWaiting for GitHub to start the gate...')
    run = None
    for _ in range(40):
        runs = gh('repos/%s/actions/runs?head_sha=%s&per_page=5' % (REPO, sha),
                  retry=True)
        if runs.get('workflow_runs'):
            run = runs['workflow_runs'][0]
            break
        time.sleep(3)
    if not run:
        sys.exit('GitHub did not start a gate run for %s within two minutes. '
                 'Check https://github.com/%s/actions' % (sha[:7], REPO))
    say('Gate started: %s' % run['html_url'])
    t0 = time.time()
    shown = set()
    while True:
        if time.time() > deadline:
            say('\nStopped watching after %d minutes, with the gate still %s.'
                % (WATCH_LIMIT // 60, run.get('status', 'running').replace('_', ' ')))
            say('Nothing on GitHub was stopped; only a green run moves main.')
            say('  The run: %s' % run['html_url'])
            say('  Published yet? `python push.py --dry-run` says "Nothing '
                'differs" once it has.')
            return 1
        jobs = gh('repos/%s/actions/runs/%d/jobs' % (REPO, run['id']), retry=True)
        for job in jobs.get('jobs', []):
            for step in job.get('steps', []):
                key = (job['id'], step['number'])
                if step['status'] == 'completed' and key not in shown:
                    shown.add(key)
                    mark = {'success': 'ok  ', 'skipped': 'skip'}.get(step['conclusion'], 'FAIL')
                    say('  %s  %4.0fs  %s' % (mark, time.time() - t0, step['name']))
        run = gh('repos/%s/actions/runs/%d' % (REPO, run['id']), retry=True)
        if run['status'] == 'completed':
            break
        time.sleep(8)
    if run['conclusion'] == 'success':
        say('\nLIVE: v%s at %s  (%.0fs from push to live)' % (v, LIVE, time.time() - t0))
        return 0
    say('\nThe gate did NOT pass (%s). The live site is unchanged.' % run['conclusion'])
    r = subprocess.run([GH, 'run', 'view', str(run['id']), '--repo', REPO, '--log-failed'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = [l for l in r.stdout.splitlines() if l.strip()][-40:]
    say('\n'.join(tail))
    say('\nFull log: %s' % run['html_url'])
    return 1


def main():
    global GH
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    subject = ' '.join(args).strip()
    GH = gh_path()
    v = version()
    say('MadGolf v%s\n' % v)

    say('1. audit, here')
    if not audited():
        sys.exit('The audit has not passed. Nothing pushed.')
    say('   passed')

    say('2. nothing else gating')
    busy = gate_busy()
    if busy:
        why = ('A gate run on %s is still %s: %s\nWait for it to finish, then '
               'push again.' % (BRANCH, busy['status'].replace('_', ' '), busy['html_url']))
        if not dry:
            sys.exit('REFUSED. ' + why + ' Nothing pushed.')
        say('   a real push would be REFUSED now. ' + why)
    else:
        say('   no gate run on %s is queued or running' % BRANCH)

    say('3. push')
    sha = push(v, subject, dry)
    if not sha:
        return 0
    if '--no-wait' in sys.argv:
        say('Not waiting. Follow it at https://github.com/%s/actions' % REPO)
        return 0

    say('4. the cloud gate, then live')
    return watch(sha, v)


if __name__ == '__main__':
    sys.exit(main())
