#!/usr/bin/env node
/* THE CHECK THAT WOULD HAVE CAUGHT BOTH (ported from Bottlefolio, 2026-10-03).

   Two ReferenceErrors reached real users on 2026-09-10, in a build the
   eight-step gate passed: `arr` left behind by a removal, and a bare
   `user` in fbLoadAfterWipeCheck that stopped a shelf loading for anybody
   who followed an invite link. Neither is visible to anything the gate
   ran. A function defined and never called is visible in the source and
   consistency.js finds it; a variable that does not exist in its scope is
   not, and nothing looked.

   node --check will not do it either - both files parse perfectly. It
   takes a linter that builds scopes, so this is one.

   HOW IT READS THE APP. The script lives inside index.html, so it is cut
   out and linted as one module with the app's own globals declared: the
   browser's, the Firebase SDK's, and every top-level `function NAME` and
   `const NAME` the file declares, because they are all one scope at
   runtime and eslint cannot know that from a fragment.

   WHAT IT ASKS. no-undef and no-dupe-keys and the small set of rules that
   catch a fault rather than a style: an undefined variable, a duplicated
   object key, an unreachable statement, a case that falls through. Not
   formatting - this file has a house style and a linter is not the place
   to argue it.
*/
const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');

/* EVERY PAGE THE SITE SERVES, not only the app (MadGolf, 2026-10-03):
   live.html, score.html and rsvp.html are pages strangers open from a text
   message, and nothing had ever checked them. LINT_INDEX lets the
   break-it-on-purpose run point at a scratch copy. */
const PAGES = [process.env.LINT_INDEX || path.join(__dirname, 'index.html'),
  path.join(__dirname, 'live.html'), path.join(__dirname, 'score.html'),
  path.join(__dirname, 'rsvp.html')];

/* Every <script> without a src, in order, with the line it starts on so a
   report points at the real line. A `type="module"` block is linted as a
   module: MadGolf loads the modular Firebase SDK with `import`. */
const blocks = [];
PAGES.forEach((file, i) => {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  const mine = [];
  while ((m = re.exec(html))) {
    mine.push({ file: i === 0 ? 'index.html' : path.basename(file), module: /type=["']module["']/.test(m[1]),
      code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  if (!mine.length) {
    console.log('  ✖ lint: no inline script found in ' + path.basename(file));
    process.exit(1);
  }
  blocks.push.apply(blocks, mine);
});
/* board.js, the leaderboard both pages load (2026-10-05). Linted as a file of
   its own; it reads the page's esc(), and the pages that load it may use
   MGBoard. */
const BOARD = path.join(__dirname, 'board.js');
const usesBoard = new Set();
if (fs.existsSync(BOARD)) {
  blocks.push({ file: 'board.js', module: false, code: fs.readFileSync(BOARD, 'utf8'), line: 1 });
  PAGES.forEach(f => { if (/<script src="board\.js">/.test(fs.readFileSync(f, 'utf8'))) usesBoard.add(path.basename(f)); });
}

/* The app's own top-level names, PER PAGE. They are one scope at runtime
   within a page; a linter handed one block cannot know what another declared.
   Pages do not share a scope, so one page's names never excuse another's. */
function declaredIn(file) {
  const declared = new Set();
  const all = blocks.filter(b => b.file === file).map(b => b.code).join('\n');
  /* TOP LEVEL ONLY - no leading whitespace. The first version allowed any
     indentation, so every function-LOCAL const was declared a global: `user`
     and `arr` among them, which are precisely the two variables that crashed
     for real Bottlefolio users. A guard that cannot fail is not a guard. */
  for (const r of [/^function\s+([A-Za-z_$][\w$]*)/gm,
                   /^async\s+function\s+([A-Za-z_$][\w$]*)/gm,
                   /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
                   /^class\s+([A-Za-z_$][\w$]*)/gm,
                   /* `window.NAME = ...` at any depth puts NAME in the page's
                      global scope, which is how the module block hands the
                      Firebase helpers to the plain scripts. */
                   /\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g]) {
    let x;
    while ((x = r.exec(all))) declared.add(x[1]);
  }
  return declared;
}

const PLATFORM = {};
[/* the browser and the platform */
 'window', 'document', 'navigator', 'location', 'history', 'localStorage',
 'sessionStorage', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
 'clearInterval', 'requestAnimationFrame', 'fetch', 'Blob', 'FileReader',
 'URL', 'Image', 'Audio', 'MouseEvent', 'Event', 'CustomEvent', 'DOMParser',
 'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'performance',
 'visualViewport', 'matchMedia', 'getComputedStyle', 'alert', 'confirm',
 'prompt', 'btoa', 'atob', 'crypto', 'AbortController', 'FormData',
 'TextDecoder', 'TextEncoder', 'BarcodeDetector', 'caches', 'indexedDB',
 /* the SDK, loaded from gstatic at runtime */
 'firebase', 'ZXing', 'module', 'require', 'process', 'globalThis'
].forEach(n => { PLATFORM[n] = 'readonly'; });

const linter = new Linter();
const RULES = {
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-obj-calls': 'error',
  'no-sparse-arrays': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error'
};

let problems = [];
const problemsAll = [];
const scopes = {};
blocks.forEach(b => {
  if (!scopes[b.file]) {
    const g = Object.assign({}, PLATFORM);
    declaredIn(b.file).forEach(n => { g[n] = 'writable'; });
    if (b.file === 'board.js') g.esc = 'readonly';
    if (usesBoard.has(b.file)) g.MGBoard = 'readonly';
    scopes[b.file] = g;
  }
  const config = {
    parserOptions: { ecmaVersion: 2022, sourceType: b.module ? 'module' : 'script' },
    env: { browser: true, es2022: true },
    globals: scopes[b.file],
    rules: RULES
  };
  const msgs = linter.verify(b.code, config, { filename: b.file });
  msgs.forEach(x => {
    problemsAll.push({ file: b.file, text: x.message });
    problems.push({
      file: b.file,
      line: b.line + (x.line || 1) - 1,
      rule: x.ruleId || 'parse',
      text: x.message
    });
  });
});

/* Anything already in the file on the day this was added stays allowed by
   name, and nothing new may join it (rule 28a): a check that stands
   between BZ and shipping gets switched off rather than satisfied. Measured
   on index.html v0.91.18, 2026-10-03: 85 findings, 75 of them window._x
   globals this file now understands, and ten real ones - two GHIN buttons
   calling functions that never existed, and _tripRoundTTs created by a bare
   assignment. All fixed in v0.91.19, so the list is empty and stays that
   way: a new finding is fixed, not listed. */
const ALLOWED = {};
problems = problems.filter(p =>
  (ALLOWED[p.file] || []).indexOf(p.text) < 0);
/* THE LIST CANNOT ROT: an allowance nothing needs any more is a failure, so
   the day a fix lands, the excuse goes with it. */
Object.keys(ALLOWED).forEach(f => ALLOWED[f].forEach(t => {
  const still = problemsAll.some(p => p.file === f && p.text === t);
  if (!still) problems.push({ file: f, line: 0, rule: 'allowed-list',
    text: 'allowed but no longer found - remove it from ALLOWED in lint.js: ' + t });
}));

if (!problems.length) {
  console.log('  \u2713 nothing undefined, duplicated or unreachable in '
    + blocks.length + ' script block'
    + (blocks.length === 1 ? '' : 's'));
  process.exit(0);
}
problems.slice(0, 40).forEach(p => {
  console.log('  \u2717 ' + p.file + ':' + p.line + '  ' + p.text
    + '  [' + p.rule + ']');
});
if (problems.length > 40) {
  console.log('  \u2026 and ' + (problems.length - 40) + ' more');
}
console.log('  \u2716 lint: ' + problems.length + ' problem(s)');
process.exit(1);
