/* WHICH CHECKS A CHANGE NEEDS - asked here, and by the gate.
 *
 *   node check.js                 run what the change touches, four at a time
 *   node check.js --all           every local check
 *   node check.js --list          say what it would run, and run nothing
 *   node check.js --names         print the names only, one per line
 *   node check.js --files a,b,c   judge THESE files rather than looking
 *   node check.js --since REF     judge what git says differs from REF
 *
 * Ported from Bottlefolio's check.js on 2026-10-03. The table lives in
 * checks.json so this and gate.py cannot disagree about it.
 *
 * THE BASELINE. The gate asks git what differs from main. Here there is no git,
 * so index.html is compared with the named lock - the copy that was shipped -
 * and everything else with a stamp kept OUTSIDE the project folder, where
 * nothing can publish it by accident. When it cannot tell, it runs everything,
 * and it always says what it skipped.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

const HERE = __dirname;
const STAMP = path.join(process.env.LOCALAPPDATA || process.env.HOME || HERE,
  'madgolf-check-stamp.json');
const TABLE = JSON.parse(fs.readFileSync(path.join(HERE, 'checks.json'), 'utf8'));
const CHECKS = TABLE.checks;
const APP = ['index.html', 'live.html', 'score.html', 'rsvp.html',
  'manifest.json', 'logo.webp'];

const sha = b => crypto.createHash('sha1').update(b).digest('hex');
const read = f => { try { return fs.readFileSync(path.join(HERE, f)); }
                    catch (e) { return null; } };
const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const has = n => process.argv.indexOf(n) >= 0;

function kindOf(f) {
  if (APP.indexOf(f) >= 0) return 'app';
  if (f === 'sw.js') return 'worker';
  if (f === 'firebase-rules.json') return 'rules';
  return null;
}

function newestLock() {
  return fs.readdirSync(HERE)
    .filter(f => /^madgolf-v[\d.]+\.html$/.test(f))
    .map(f => ({ f: f, v: f.replace(/[^\d.]/g, '').replace(/^\.|\.$/g, '').split('.').map(Number) }))
    .sort((a, b) => (b.v[0] - a.v[0]) || (b.v[1] - a.v[1]) || (b.v[2] - a.v[2]))
    .map(x => x.f)[0] || null;
}

const kinds = new Set();
const why = [];
const named = new Set();
let everything = false;

/* What moved, by file name. A harness that changed runs itself; checks.json
   or check.js changing means everything, because everything reads them. */
function judge(f, reason) {
  const base = f.replace(/^.*\//, '');
  const k = kindOf(base);
  if (k) { kinds.add(k); why.push(base + reason); return; }
  if (base === 'checks.json' || base === 'check.js' || base === 'fake-firebase.js'
      || base === 'walk-lib.js') {
    if (base === 'walk-lib.js' || base === 'fake-firebase.js') {
      named.add('walk'); named.add('ios'); why.push(base + reason); return;
    }
    everything = true; why.push(base + reason + ' - everything reads it'); return;
  }
  const own = CHECKS.filter(c => c.harness === base)[0];
  if (own) { named.add(own.name); why.push(base + reason); }
}

let changed = null;
const files = arg('--files');
const since = arg('--since');
if (files) changed = files.split(',').map(s => s.trim()).filter(Boolean);
if (since) {
  try {
    changed = String(execFileSync('git', ['diff', '--name-only', since], { cwd: HERE }))
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    everything = true;
    why.push('git could not say what differs from ' + since + ' - everything');
  }
}

let fresh = {};
if (!everything && changed) {
  changed.forEach(f => judge(f, ' changed'));
} else if (!everything) {
  const lock = newestLock();
  const now = read('index.html');
  const was = lock ? read(lock) : null;
  if (!now || !was) {
    everything = true;
    why.push('no lock file to compare index.html against - everything');
  } else if (sha(now) !== sha(was)) {
    kinds.add('app'); why.push('index.html differs from ' + lock);
  }
  let stamp = {};
  try { stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch (e) {}
  fs.readdirSync(HERE)
    .filter(f => f !== 'index.html' && !/^madgolf-v/.test(f)
      && (/\.(js|json|py|html)$/.test(f) || f === 'logo.webp'))
    .filter(f => f !== 'package-lock.json')
    .forEach(f => {
      const body = read(f);
      if (body === null) return;
      fresh[f] = sha(body);
      if (stamp[f] !== fresh[f]) judge(f, ' changed since the last clean run');
    });
}

const wanted = CHECKS.filter(c => everything || c.always || named.has(c.name)
  || (c.reaches || []).some(k => kinds.has(k)));

if (has('--names')) {
  console.log(wanted.map(c => c.name).join('\n'));
  process.exit(0);
}

/* rulestest needs Java, so it is the cloud gate's alone. */
const LOCAL_SKIP = { rules: 1 };
const run = (has('--all') ? CHECKS : wanted).filter(c => !LOCAL_SKIP[c.name]);
const skipped = CHECKS.filter(c => !LOCAL_SKIP[c.name] && run.indexOf(c) < 0);
const secs = l => Math.round(l.reduce((t, c) => t + c.secs, 0));

if (has('--all')) { why.length = 0; why.push('--all'); }
if (!why.length) why.push('nothing has changed since the last clean run');
console.log('\n  ' + why.join('\n  '));
console.log('\n  running ' + run.length + ' (' + secs(run) + 's)'
  + (skipped.length ? ', skipping ' + skipped.length + ': ' + skipped.map(c => c.name).join(' ') : '')
  + '\n  not run here: rules (needs Java - the cloud gate runs it)');
console.log('  the cloud gate decides for itself, from what differs from main\n');
if (has('--list')) process.exit(0);

/* THE OUTPUT DECIDES, NOT ONLY THE EXIT CODE: a harness that prints a failure
   and exits 0 is a failure. "0 failed" is not. */
const SAYS_BAD = /✖|✗|^\s*FAIL\b|[1-9]\d* failed|Error:/m;
const LANES = Math.max(1, Number(arg('--lanes')) || 4);
const PY = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Python', 'pythoncore-3.14-64', 'python.exe') : 'python3';
let bad = 0;
const queue = run.slice().sort((a, b) => (b.secs || 0) - (a.secs || 0));

function oneCheck(c) {
  const t = Date.now();
  const py = /\.py$/.test(c.harness);
  const cmd = py ? (fs.existsSync(PY) ? PY : 'python') : 'node';
  return new Promise(done => {
    execFile(cmd, [path.join(HERE, c.harness)].concat(c.args || []),
      { cwd: HERE, maxBuffer: 1 << 26, env: Object.assign({}, process.env, { PYTHONUTF8: '1' }) },
      (err, so, se) => {
        const out = String((so || '') + (se || ''));
        const s = Math.round((Date.now() - t) / 1000);
        if (!err && !SAYS_BAD.test(out)) {
          console.log('  ' + c.name.padEnd(13) + 'ok   ' + s + 's');
        } else {
          bad++;
          console.log('  ' + c.name.padEnd(13) + 'FAILED  ' + s + 's');
          out.split('\n').filter(l => SAYS_BAD.test(l)).slice(0, 12)
            .forEach(l => console.log('      ' + l.trim()));
        }
        done();
      });
  });
}
function lane() {
  const c = queue.shift();
  return c ? oneCheck(c).then(lane) : Promise.resolve();
}
const started = Date.now();
Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, lane)).then(() => {
  console.log('\n  ' + Math.round((Date.now() - started) / 1000) + 's in '
    + Math.min(LANES, run.length) + ' lanes (' + secs(run) + 's one after another)');
  if (!bad && !changed) {
    try { fs.writeFileSync(STAMP, JSON.stringify(fresh, null, 1)); } catch (e) {}
  }
  console.log('  ' + (bad ? '✖ ' + bad + ' failed' : '✓ ' + run.length + ' passed') + '\n');
  process.exit(bad ? 1 : 0);
});
