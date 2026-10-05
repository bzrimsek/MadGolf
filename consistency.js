#!/usr/bin/env node
/* THE WIRING CHECKS - what the test suite cannot see.
 *
 * madgolf-test.js drives the engine and cannot see the WIRING: an element id
 * nobody declares, a handler naming a function that does not exist, two
 * functions sharing a name, a delivery list that left a file behind. All
 * invisible to it, all visible in the file in a second (rule 30b). Ported in
 * spirit from Bottlefolio's consistency.js on 2026-10-03; every check here
 * was measured against MadGolf v0.91.18 first, and every one was broken on
 * purpose and seen to go red before it was trusted.
 *
 *   node consistency.js            run every check
 *   node consistency.js --sizes    print the size allowance list, ready to paste
 *
 * CONSISTENCY_INDEX=path points it at a scratch copy (for breaking on purpose).
 * Prints a ✖ per finding and "consistency checks pass" when there are none;
 * gate.py and check.js read the output, not only the exit code.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const INDEX = process.env.CONSISTENCY_INDEX || path.join(HERE, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');
const read = f => { try { return fs.readFileSync(path.join(HERE, f), 'utf8'); } catch (e) { return null; } };
const lines = html.split('\n');
const bad = [];
const ok = [];
const fail = s => bad.push(s);
const pass = s => ok.push(s);

/* ── Top-level functions, with their size in code lines ─────────────── */
function topFunctions(text) {
  const ls = text.split('\n');
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    let depth = 0, seen = false, j = i;
    for (; j < ls.length; j++) {
      for (const ch of ls[j]) {
        if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--;
      }
      if (seen && depth <= 0) break;
    }
    const code = ls.slice(i, j + 1).filter(l => l.trim() && !/^\s*\/\//.test(l)).length;
    out.push({ name: m[1], line: i + 1, code: code });
    i = j;
  }
  return out;
}
const fns = topFunctions(html);
const defined = new Set(fns.map(f => f.name));
{
  const r = /\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g; let m;
  while ((m = r.exec(html))) defined.add(m[1]);
  const c = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = c.exec(html))) defined.add(m[1]);
}

/* ── 1. No two top-level functions share a name ─────────────────────── */
/* The second silently replaces the first, so whichever was written last
   wins and the other is dead code that still reads as live. */
{
  const seen = {};
  fns.forEach(f => { (seen[f.name] = seen[f.name] || []).push(f.line); });
  const dup = Object.keys(seen).filter(n => seen[n].length > 1);
  dup.forEach(n => fail('function ' + n + ' is defined ' + seen[n].length
    + ' times (lines ' + seen[n].join(', ') + ') - the last one wins silently'));
  if (!dup.length) pass(fns.length + ' top-level functions, no name defined twice');
}

/* ── 2. Every inline handler names a function that exists ───────────── */
/* onclick="fooBar(...)" with no fooBar is a button that does nothing and
   logs an error nobody reads. The suite's handler scan evaluates them; this
   reads them, including the ones inside template strings it never renders. */
{
  const r = /\bon(?:click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*\\?["'`]\s*(?:return\s+|event\.stopPropagation\(\);\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
  const NATIVE = new Set(['event', 'this', 'document', 'window', 'if', 'setTimeout',
    'alert', 'confirm', 'history', 'location', 'navigator', 'void']);
  const names = new Set(); let m;
  while ((m = r.exec(html))) names.add(m[1]);
  const missing = [...names].filter(n => !defined.has(n) && !NATIVE.has(n));
  missing.forEach(n => fail('a handler calls ' + n + '(), which is defined nowhere'));
  if (!missing.length) pass(names.size + ' handler functions, all defined');
}

/* ── 2b. No JSON.stringify inside an inline handler ─────────────────── */
/* onclick="f(${JSON.stringify(x)})" writes double quotes into a double-quoted
   attribute, which ends it: the button does nothing and logs a syntax error
   nobody sees. It shipped twice - score.html's +/- buttons (2026-10-03) and
   the live share sheet's Text buttons (2026-10-05). Every page is read. */
{
  const pages = ['index.html', 'live.html', 'score.html', 'rsvp.html'];
  const r = /\bon[a-z]+\s*=\s*"[^"]*\$\{\s*JSON\.stringify\(/g;
  let n = 0;
  pages.forEach(f => {
    const src = f === 'index.html' ? html : (read(f) || '');
    let m;
    while ((m = r.exec(src))) {
      n++;
      fail(f + ':' + src.slice(0, m.index).split('\n').length
        + ' puts JSON.stringify inside a double-quoted handler - its quotes end the attribute; pass data-* fields instead');
    }
  });
  if (!n) pass('no handler builds its arguments with JSON.stringify');
}

/* ── 3. getElementById names an id the file can produce ─────────────── */
/* An id looked up and never declared is a feature that silently does
   nothing (the `if (el)` guard swallows it). Declared means anywhere: static
   markup, a template string, or an .id assignment. Ids built at runtime
   from a variable cannot be read here and are not counted. */
const ID_ALLOWED = [
  /* Measured on v0.91.18, 2026-10-03, and listed by name (rule 28a). Each is
     looked up and never declared in the file. Fix one, remove it here - the
     check fails an allowance that is no longer needed. */
];
{
  const ids = new Set(); let m;
  for (const r of [/\bid\s*=\s*\\?["']([\w-]+)\\?["']/g, /\.id\s*=\s*["'`]([\w-]+)["'`]/g,
                   /\bid\s*:\s*["']([\w-]+)["']/g]) {
    while ((m = r.exec(html))) ids.add(m[1]);
  }
  /* Two more ways MadGolf declares an id, both measured on v0.91.18:
     a PREFIX joined to a number (`id="parTotal' + startHole`), and an id
     handed to a helper that writes the attribute (workflowNav's titleId,
     'outing-plan-player-hdr'). The second is accepted when the same quoted
     string appears somewhere OTHER than a lookup - a typo in a lookup has no
     second spelling to hide behind. */
  const prefixes = []; const p = /\bid\s*=\s*\\?["']([\w-]+)\\?["']?\s*(?:\+|\$\{)/g;
  while ((m = p.exec(html))) prefixes.push(m[1]);
  const quoted = {}; const q = /["']([\w-]+)["']/g;
  while ((m = q.exec(html))) quoted[m[1]] = (quoted[m[1]] || 0) + 1;
  const want = new Map(); const looks = {};
  const g = /getElementById\(\s*["']([\w-]+)["']\s*\)/g;
  while ((m = g.exec(html))) {
    looks[m[1]] = (looks[m[1]] || 0) + 1;
    if (!want.has(m[1])) want.set(m[1], html.slice(0, m.index).split('\n').length);
  }
  const missing = [...want.keys()].filter(x => !ids.has(x)
    && !prefixes.some(pre => x.indexOf(pre) === 0 && /^\d+$/.test(x.slice(pre.length)))
    && !((quoted[x] || 0) > looks[x]));
  missing.filter(x => ID_ALLOWED.indexOf(x) < 0).forEach(x =>
    fail('getElementById(\'' + x + '\') at index.html:' + want.get(x) + ' - no element has that id'));
  ID_ALLOWED.filter(x => missing.indexOf(x) < 0).forEach(x =>
    fail('ID_ALLOWED lists ' + x + ', which is no longer missing - remove it'));
  if (!missing.filter(x => ID_ALLOWED.indexOf(x) < 0).length)
    pass(want.size + ' ids looked up, all declared'
      + (ID_ALLOWED.length ? ' (' + ID_ALLOWED.length + ' known, listed by name)' : ''));
}

/* ── 4. Nothing writes to Firebase before the load lands (rule 21) ──── */
/* fbWrite refuses when _fbLoaded is false, so every write passes one door.
   This fails if that door loses its guard, or a second door appears: a PUT
   to the database written anywhere but fbWrite. */
{
  const at = html.indexOf('function fbWrite');
  const body = at >= 0 ? html.slice(at, html.indexOf('\n}', at)) : '';
  if (!body) fail('fbWrite not found - the one door for writes has moved');
  else if (!/if\s*\(\s*!_fbLoaded\s*\)/.test(body)) fail('fbWrite no longer refuses before _fbLoaded (rule 21)');
  else pass('fbWrite refuses to write before the load lands');
  const puts = [];
  const r = /method\s*:\s*["'](PUT|PATCH|POST|DELETE)["']/g; let m;
  while ((m = r.exec(html))) {
    const ln = html.slice(0, m.index).split('\n').length;
    const owner = fns.filter(f => f.line <= ln).pop();
    puts.push((owner ? owner.name : '?') + ':' + m[1]);
  }
  /* The doors that may write, and why. fbWrite: the user's state. The live
     board, the RSVP and admin paths write their own subtrees, each checked
     against firebase-rules.json by rulestest.js. Measured 2026-10-03. */
  const DOORS = (read('consistency-doors.json') ? JSON.parse(read('consistency-doors.json')) : null);
  if (DOORS) {
    const extra = puts.filter(p => DOORS.indexOf(p) < 0);
    extra.forEach(p => fail('a new database write door: ' + p + ' - route it through an existing one, or add it to consistency-doors.json with its rule'));
    DOORS.filter(d => puts.indexOf(d) < 0).forEach(d => fail('consistency-doors.json lists ' + d + ', which no longer writes - remove it'));
    if (!extra.length) pass(puts.length + ' database writes, all through known doors');
  } else {
    console.log('  doors measured: ' + JSON.stringify([...new Set(puts)]));
  }
}

/* ── 5. Screens only get smaller (rule 30f) ─────────────────────────── */
const SIZES = (read('consistency-sizes.json') ? JSON.parse(read('consistency-sizes.json')) : null);
if (process.argv.indexOf('--sizes') >= 0) {
  const out = {};
  fns.filter(f => f.code > 100).sort((a, b) => b.code - a.code).forEach(f => { out[f.name] = f.code; });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
if (!SIZES) {
  fail('consistency-sizes.json is missing - run node consistency.js --sizes > consistency-sizes.json');
} else {
  const by = {}; fns.forEach(f => { by[f.name] = f; });
  let n = 0;
  fns.filter(f => f.code > 100).forEach(f => {
    if (!(f.name in SIZES)) fail(f.name + ' is ' + f.code + ' code lines - over 100 and new. Extract a helper (rule 30).');
    else if (f.code > SIZES[f.name]) fail(f.name + ' grew from ' + SIZES[f.name] + ' to ' + f.code + ' code lines - a listed function only shrinks (rule 30f)');
    else n++;
  });
  Object.keys(SIZES).forEach(k => {
    if (!by[k]) fail('consistency-sizes.json lists ' + k + ', which is no longer in the file - remove it');
    else if (by[k].code < SIZES[k]) fail(k + ' shrank to ' + by[k].code + ' (allowance ' + SIZES[k] + ') - lower its allowance to match: node consistency.js --sizes');
  });
  pass(n + ' functions over 100 lines, none grown, none new');
}

/* ── 6. The delivery lists agree ────────────────────────────────────── */
/* What the site serves is written in three places: push.py sends it,
   gate.yml publishes it, sw.js precaches it. A file in one and not another
   is a page that 404s, or a precache that fails and leaves the old app. */
{
  const push = read('push.py') || '';
  const gy = read('.github/workflows/gate.yml') || '';
  const sw = read('sw.js') || '';
  const list = (src, re) => { const m = src.match(re); return m ? (m[1].match(/[\w.-]+\.(?:html|js|json|webp|png)/g) || []) : null; };
  const app = list(push, /\nAPP = \[([\s\S]*?)\]/);
  const site = list(gy, /# SITE-FILES\n\s*cp ([\s\S]*?) site\//);
  const shell = (sw.match(/const ASSETS\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
    .match(/[\w.-]+\.(?:html|js|json|webp|png)/g) || [];
  if (!app) fail('push.py has no APP list');
  if (!site) fail('gate.yml has no "# SITE-FILES" cp line');
  if (app && site) {
    const a = new Set(app), s = new Set(site);
    app.filter(x => !s.has(x)).forEach(x => fail(x + ' is pushed (push.py APP) but not published (gate.yml SITE-FILES)'));
    site.filter(x => !a.has(x)).forEach(x => fail(x + ' is published (gate.yml) but never pushed (push.py APP)'));
    shell.filter(x => !s.has(x)).forEach(x => fail('sw.js precaches ' + x + ', which the site does not serve'));
    if (app.every(x => s.has(x)) && site.every(x => a.has(x)) && shell.every(x => s.has(x)))
      pass(app.length + ' site files: pushed, published and precached lists agree');
  }
}

/* ── 7. Every check is sent, grouped and runnable ───────────────────── */
/* checks.json is the one table. A harness it names that push.py does not
   send fails every cloud gate (Bottlefolio lost two builds to exactly that,
   2026-10-02); a check gate.py does not group never runs at all. */
{
  const table = JSON.parse(read('checks.json'));
  const push = read('push.py') || '';
  const gate = read('gate.py') || '';
  const tooling = (push.match(/\nTOOLING = \[([\s\S]*?)\]/) || [, ''])[1];
  const grouped = (gate.match(/\nFAST = (\[[\s\S]*?\])\n/) || [, ''])[1]
    + (gate.match(/\nSLOW = (\[[\s\S]*?\])\n/) || [, ''])[1];
  let good = true;
  table.checks.forEach(c => {
    if (!fs.existsSync(path.join(HERE, c.harness))) { good = false; fail('checks.json names ' + c.harness + ', which is not in this folder'); }
    if (tooling.indexOf("'" + c.harness + "'") < 0) { good = false; fail(c.harness + ' is a check but push.py does not send it - the cloud gate could not run it'); }
    if (grouped.indexOf("'" + c.name + "'") < 0) { good = false; fail('check ' + c.name + ' is in no gate.py group - it would never run in the cloud'); }
  });
  if (good) pass(table.checks.length + ' checks: each present, sent and grouped');
}

/* ── 8. One rule book (BZ, 2026-10-03) ──────────────────────────────── */
/* On BZ's PC the book lives one folder up and no copy may sit here. In the
   cloud gate (CI is set) the checkout IS the repo, where push.py's published
   copy belongs - so there the copy must be present instead. */
if (process.env.CI) {
  if (fs.existsSync(path.join(HERE, 'DEV-RULES.md'))) pass('the published DEV-RULES.md is in the repo');
  else fail('DEV-RULES.md is missing from the repo - push.py publishes it from ..\\DEV-RULES.md');
} else {
  ['DEV-RULES.md', 'rules.md'].forEach(f => {
    if (fs.existsSync(path.join(HERE, f)))
      fail(f + ' is in the MadGolf folder - the only rule book is ..\\DEV-RULES.md; push.py publishes a copy of that');
  });
  if (!fs.existsSync(path.join(HERE, '..', 'DEV-RULES.md')))
    fail('..\\DEV-RULES.md is missing - push.py would publish no rules');
  else if (!fs.existsSync(path.join(HERE, 'DEV-RULES.md')) && !fs.existsSync(path.join(HERE, 'rules.md')))
    pass('one rule book, in Apps I\'ve Built');
}

/* ── 9. Every file a check reads is sent ────────────────────────────── */
/* consistency.js read two baseline files push.py did not send, and the
   first cloud gate would have died on them (caught by a dry run,
   2026-10-03). Any JSON this folder's checks open by name must be sent. */
{
  /* Every list push.py sends from: APP, DOCS, TOOLING, SERVICE. */
  const pushSrc = read('push.py') || '';
  const tooling = ['APP', 'DOCS', 'TOOLING', 'SERVICE'].map(k =>
    (pushSrc.match(new RegExp('\\n' + k + ' = \\[([\\s\\S]*?)\\]')) || [, ''])[1]).join('\n');
  const needs = new Set();
  ['consistency.js', 'check.js', 'gate.py', 'lint.js', 'walk-lib.js'].forEach(f => {
    const src = read(f) || '';
    (src.match(/['"]([\w.-]+\.json)['"]/g) || []).forEach(q => {
      const n = q.slice(1, -1);
      /* A dot-file is state a run keeps for itself (.gatetimes.json is
         restored from cache on the runner), not a project file: the first
         v0.91.20 gate failed demanding it be pushed, 2026-10-04. */
      if (fs.existsSync(path.join(HERE, n)) && n[0] !== '.' && n !== 'package.json' && n !== 'package-lock.json') needs.add(n);
    });
  });
  const unsent = [...needs].filter(n => tooling.indexOf("'" + n + "'") < 0);
  unsent.forEach(n => fail(n + ' is read by a check but push.py does not send it - the cloud gate would fail'));
  if (!unsent.length) pass(needs.size + ' data files the checks read, all sent');
}

/* ── Report ─────────────────────────────────────────────────────────── */
ok.forEach(s => console.log('  ✓ ' + s));
bad.forEach(s => console.log('  ✖ ' + s));
if (bad.length) {
  console.log('  ✖ consistency: ' + bad.length + ' finding(s)');
  process.exit(1);
}
console.log('  ✓ consistency checks pass');
