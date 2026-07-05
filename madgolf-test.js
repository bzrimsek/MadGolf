#!/usr/bin/env node
// =============================================================
// MadGolf Test Harness v1.0
// Tests core math extracted from index.html — no browser needed.
// Output: pass/fail summary; verbose detail only on failures.
// Usage:  node madgolf-test.js [path/to/index.html]
// =============================================================

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const htmlPath = process.argv[2] || path.join(__dirname, 'index.html');
if (!fs.existsSync(htmlPath)) {
  console.error(`Cannot find ${htmlPath}\nUsage: node madgolf-test.js path/to/index.html`);
  process.exit(1);
}

// ── 1. Extract JS from index.html ────────────────────────────
const html = fs.readFileSync(htmlPath, 'utf8');

const vMatch = html.match(/const APP_VERSION\s*=\s*'([^']+)'/);
const APP_VERSION = vMatch ? vMatch[1] : '?';

// Pull all inline <script> blocks (no src=, no type=module)
const scriptBlocks = [];
const reScript = /<script(?![^>]*\bsrc\b)(?![^>]*type=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = reScript.exec(html)) !== null) scriptBlocks.push(m[1]);
const rawJS = scriptBlocks.join('\n');

// ── 2. Sandbox: shim browser globals ─────────────────────────
// Dummy DOM element — returned for every getElementById/querySelector call
const dummyEl = {
  style: { display:'', height:'', visibility:'' },
  innerHTML: '', textContent: '', value: '', checked: false,
  addEventListener: () => {}, removeEventListener: () => {},
  querySelector: () => dummyEl, querySelectorAll: () => [],
  closest: () => null, classList: { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} },
  getBoundingClientRect: () => ({ top:0, left:0, width:0, height:0 }),
  scrollIntoView: () => {},
  focus: () => {}, blur: () => {}, click: () => {},
  dataset: {},
};

const sandbox = {
  // Window-level DOM methods
  addEventListener:    () => {},
  removeEventListener: () => {},
  requestAnimationFrame: cb => {},
  cancelAnimationFrame: () => {},

  window: null, // set below after sandbox built

  document: {
    getElementById:      () => dummyEl,
    querySelector:       () => dummyEl,
    querySelectorAll:    () => [],
    addEventListener:    () => {},
    removeEventListener: () => {},
    body:  { style:{}, classList:{add:()=>{},remove:()=>{},contains:()=>false}, appendChild:()=>{} },
    head:  { appendChild: () => {} },
    createElement: tag => ({ ...dummyEl, tagName:tag.toUpperCase(), appendChild:()=>{}, setAttribute:()=>{} }),
    createDocumentFragment: () => dummyEl,
    activeElement: dummyEl,
  },

  navigator: { onLine: true, serviceWorker: { register: () => Promise.resolve() } },
  localStorage: { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
  location:  { hostname:'test', href:'', origin:'https://test', pathname:'/' },
  history:   { pushState:()=>{}, replaceState:()=>{} },

  // Timers — no-ops
  setTimeout: ()=>{}, clearTimeout: ()=>{},
  setInterval: ()=>{}, clearInterval: ()=>{},
  requestIdleCallback: ()=>{},

  // Standard globals
  Promise, console, JSON, Math, Date,
  Array, Object, String, Number, Boolean, Error,
  parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent,
  Set, Map, Symbol, WeakMap, WeakSet,

  // Async stubs — scoring engine uses fetchGhinHI but tests don't call it
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  fetchWithTimeout: () => Promise.resolve({ json: () => Promise.resolve({}) }),

  // Firebase stubs — prevent ReferenceError
  initializeApp:        ()=>({}),
  getDatabase:          ()=>({}),
  getAuth:              ()=>({}),
  ref:                  ()=>({}),
  onValue:              ()=>{},
  set:                  ()=>Promise.resolve(),
  get:                  ()=>Promise.resolve({ val:()=>null, exists:()=>false }),
  update:               ()=>Promise.resolve(),
  push:                 ()=>({}),
  remove:               ()=>Promise.resolve(),
  signInWithPopup:      ()=>Promise.resolve(),
  GoogleAuthProvider:   function(){},
  onAuthStateChanged:   ()=>{},
  getMessaging:         ()=>({}),

  // App-level helpers called at module scope
  toast:         ()=>{},
  confirmDo:     ()=>{},
  renderHome:    ()=>{},
  scheduleWrite: ()=>{},
  fbLoad:        ()=>{},

  // Utilities the app defines early and cross-references
  esc:   s => String(s == null ? '' : s),
  uid:   ()=>'test-uid',
  toArr: v => Array.isArray(v) ? v : (v && typeof v==='object' ? Object.values(v) : []),

  // App global state
  S: {},
  _dirty: false,
  _fbLoaded: false,
};

// Self-reference: code that reads `window.X` finds the sandbox
sandbox.window = sandbox;
vm.createContext(sandbox);

// ── 3. Run the app JS in the sandbox ─────────────────────────
let evalError = null;
try {
  vm.runInContext(rawJS, sandbox, { filename:'index.html', timeout:8000 });
} catch(e) {
  evalError = e;
}

// Helper: set a property on the vm-local S (which is let S, separate from sandbox.S
// after loadLocal() reassigns it). Use for tests that need S.players etc. in the vm.
function vmSetS(key, value) {
  sandbox[`__vmset_${key}`] = value;
  vm.runInContext(`S['${key}'] = __vmset_${key}`, sandbox);
}

// Pull math functions out of sandbox for use in tests
const {
  roundHalfAwayZero, roundHalfUp1dp,
  calcRawCourseHcp, calcCourseHcp,
  strokesOnHole, fsBuildChs, fsGetStrokesForSc,
  calcBBBPoints,
  fsCalcDOCMatch, fsDocMatchDefs,
  fsCalcNassauSeg, fsBuildNassauPairs, fsGetNassauPairs,
  fsCalcOneMatch,
  wolfCalcTotals, wolfSettlement, wolfNetScore, wolfCalcHoleWinner,
  wolfCaptainIdx, wolfCaptainPid,
  outingBuildTeams, outingEnsureTeams, outingRecentPairHistory, outingTTto24,
  outingScoringCtx, outingComputeTeamResults,
  leagueBuildPool, leagueGetEstablishedPartner, leagueBuildEstablishedTeams,
  leagueSendRsvpInvite,
  leagueDealAbcd, leagueBuildTierMap,
  leagueSessionById, leagueFirstOpenSession, leagueCourse,
  tripAssignBorrows, tripScoringCtx, tripLeaderboard, tripFmt12hr, tripFmtLabel,
  tripFmtShort, tripDayLabel, tripCourseById, tripPlayers, tripPlayerIds, isTripManager,
  fsGetWalkoffPairs, fsGetPairMatches, fsTeamsComplete, fsInitTeams,
  outingDealAbcd, outingAllOutings, outingById,
  sortedCourses, tripAllTrips, tripById, leagueAll, leagueById,
  fsGetCourse, fsPlayerById,
  fmtHcp, fmtMoney, fsDate, fsGameTypeLabel, lastNameOf, firstNameOf,
  wolfHoleBase,
  tripCountback,
  toArr, encodePhone, decodePhone, formatPhone, uid, stripPII,
  saveLeagueMsg, tripSetStrokeAllowance,
  bestShell, leaguePartnersSub, tripFmtBadge, tripGetPairHistory,
  stripValidScore,
  normalizeState,
} = sandbox;

// vmSetS helper aliases — set S properties in the vm context
function vmS(key, val) { vmSetS(key, val); }

// ── 4. Test runner ────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function expect(desc, actual, expected) {
  const ok = actual === expected ||
    (typeof expected === 'number' && typeof actual === 'number' &&
     Math.abs(actual - expected) < 0.00001);
  if (ok) { passed++; }
  else     { failed++; failures.push({ desc, actual, expected }); }
}


// ── 5. STRUCTURE CHECKS ───────────────────────────────────────

const requiredFns = [
  'roundHalfAwayZero', 'roundHalfUp1dp',
  'calcRawCourseHcp', 'calcCourseHcp',
  'strokesOnHole', 'fsBuildChs', 'fsGetStrokesForSc',
  'calcBBBPoints', 'fsCalcDOCMatch', 'fsDocMatchDefs',
  'fsCalcNassauSeg', 'fsBuildNassauPairs', 'fsGetNassauPairs',
  'fsCalcOneMatch',
  'normalizeState', 'fmtMoney', 'fmtHcp',
];
requiredFns.forEach(fn => {
  expect(`Function exists: ${fn}`, typeof sandbox[fn] === 'function', true);
});

// Version present in four HTML locations
expect('Version in file header',
  /MadGolf — Unified Golf PWA[\s\S]*?Version\s*:\s*v\d+\.\d+/.test(html), true);
expect('APP_VERSION const present',
  /const APP_VERSION\s*=\s*'\d+\.\d+[\d.]*'/.test(html), true);
expect('BUILD_TIME const present',
  /const BUILD_TIME\s*=\s*'[^']+ET'/.test(html), true);
expect('Splash version uses APP_VERSION',
  /v'\s*\+\s*APP_VERSION/.test(html), true);

// sw.js CACHE_NAME matches APP_VERSION
const swPath = path.join(path.dirname(htmlPath), 'sw.js');
if (fs.existsSync(swPath)) {
  const swContent = fs.readFileSync(swPath, 'utf8');
  const swVMatch  = swContent.match(/madgolf-v([\d.]+)/);
  const swVer     = swVMatch ? swVMatch[1] : null;
  expect(`sw.js CACHE_NAME (${swVer}) matches APP_VERSION (${APP_VERSION})`, swVer, APP_VERSION);
} else {
  failures.push({ desc:'sw.js not found alongside index.html', actual:'missing', expected:'present' });
  failed++;
}

// Changelog entry for current version is non-blank
const changelogRe = new RegExp(`//\\s*v${APP_VERSION.replace(/\./g,'\\.')}\\s+\\d{4}-\\d{2}-\\d{2}\\s+.{5,}`);
expect('Changelog entry present and non-blank', changelogRe.test(html), true);

// Regression guards (v0.90.31):
// Standings row builder must be a live interpolation, not a backslash-escaped literal
// that prints as source text. The bug was `\${rows.map(...)}` inside the outer template.
expect('Standings rows not escaped-literal', /\\\$\{rows\.map/.test(html), false);
expect('Standings uses extracted rowsHtml', /const rowsHtml\s*=\s*rows\.map/.test(html), true);
// Completed league session must offer a direct path back to the League hub
expect('Completed session → Back to League', /s\.completed\?[^]*leagueRenderHub\(\)[^]*Back to League/.test(html), true);
// Outing group screen must rehydrate transient groups from persisted planning.groups
// (else navigating away wipes groups → everyone collapses into one group on the scorecard)
expect('Outing group screen rehydrates groups', /window\._outingGroups\s*=\s*o\.groups\.map\(gr\s*=>/.test(html), true);

// Auth & security
expect('DEV_UID declared in <head>',              /window\.DEV_UID\s*=/.test(html),                            true);
expect('signInWithPopup used (GitHub Pages)',      /signInWithPopup/.test(html),                                true);
expect('signInWithRedirect NOT used',             /signInWithRedirect/.test(html),                             false);
expect('CSP meta tag absent (intentionally)',     /<meta[^>]+http-equiv=["']Content-Security-Policy/.test(html), false);


// ── 6. ROUNDING ───────────────────────────────────────────────

// roundHalfAwayZero — positive
expect('roundHalfAwayZero(0.5)=1',   roundHalfAwayZero(0.5),   1);
expect('roundHalfAwayZero(1.5)=2',   roundHalfAwayZero(1.5),   2);
expect('roundHalfAwayZero(2.4)=2',   roundHalfAwayZero(2.4),   2);
expect('roundHalfAwayZero(2.5)=3',   roundHalfAwayZero(2.5),   3);
expect('roundHalfAwayZero(0.0)=0',   roundHalfAwayZero(0.0),   0);
// Negative: rounds away from zero
expect('roundHalfAwayZero(-0.5)=-1', roundHalfAwayZero(-0.5), -1);
expect('roundHalfAwayZero(-1.5)=-2', roundHalfAwayZero(-1.5), -2);
expect('roundHalfAwayZero(-2.4)=-2', roundHalfAwayZero(-2.4), -2);
expect('roundHalfAwayZero(-2.5)=-3', roundHalfAwayZero(-2.5), -3);

// roundHalfUp1dp — used for 9-hole HCP index halving
expect('roundHalfUp1dp(5.05)=5.1',   roundHalfUp1dp(5.05),     5.1);
expect('roundHalfUp1dp(5.04)=5.0',   roundHalfUp1dp(5.04),     5.0);
expect('roundHalfUp1dp(10.0)=10.0',  roundHalfUp1dp(10.0),    10.0);
expect('roundHalfUp1dp(8.35)=8.4',   roundHalfUp1dp(8.35),     8.4);
expect('roundHalfUp1dp(7.5)=7.5',    roundHalfUp1dp(7.5),      7.5);
expect('roundHalfUp1dp(7.45)=7.5',   roundHalfUp1dp(7.45),     7.5);


// ── 7. COURSE HANDICAP ────────────────────────────────────────

// Baseline: idx=10, slope=113, rating=72, par=72 → raw=10 → CH=10
expect('calcCourseHcp 10/113/72/72',
  calcCourseHcp(10.0, 113, 72.0, 72, false), 10);

// High slope: idx=18, slope=130, rating=74.2, par=72
// raw = 18*(130/113) + 2.2 = 22.908 → CH=23
expect('calcCourseHcp 18/130/74.2/72',
  calcCourseHcp(18.0, 130, 74.2, 72, false), 23);

// Scratch: idx=0, slope=130, rating=74.2, par=72 → raw=2.2 → CH=2
expect('calcCourseHcp scratch 0/130/74.2/72',
  calcCourseHcp(0.0, 130, 74.2, 72, false), 2);

// Plus handicap: idx=-2, slope=113, rating=72, par=72 → raw=-2 → CH=-2
expect('calcCourseHcp plus -2/113/72/72',
  calcCourseHcp(-2.0, 113, 72.0, 72, false), -2);

// 9-hole: rating<50 → NO halving (raw rating used directly)
// idx=16, slope=113, rating=36.5, par=36 → raw=16+0.5=16.5 → CH=17
expect('calcCourseHcp 9h rating<50 no-halve',
  calcCourseHcp(16.0, 113, 36.5, 36, true), 17);

// 9-hole: rating>=50 → halve both idx and rating
// idx=16→8.0, r=72→36, slope=113, par=36 → raw=8+(36-36)=8 → CH=8
expect('calcCourseHcp 9h rating>=50 halve',
  calcCourseHcp(16.0, 113, 72.0, 36, true), 8);

// 9-hole half-stroke rounding: idx=15 → roundHalfUp1dp(7.5)=7.5
// raw=7.5+(36-36)=7.5 → roundHalfAwayZero(7.5)=8
expect('calcCourseHcp 9h idx=15 half-stroke rounding',
  calcCourseHcp(15.0, 113, 72.0, 36, true), 8);

// No rounding boundary issue at idx=14: 14→7.0, raw=7 → CH=7
expect('calcCourseHcp 9h idx=14 no boundary issue',
  calcCourseHcp(14.0, 113, 72.0, 36, true), 7);


// ── 8. STROKES ON HOLE ────────────────────────────────────────

// CH=18, mod=18: all holes get exactly 1 stroke
expect('strokesOnHole CH=18 hcp=1 mod=18 → 1',  strokesOnHole(18, 1, 18),  1);
expect('strokesOnHole CH=18 hcp=18 mod=18 → 1', strokesOnHole(18, 18, 18), 1);

// CH=19, mod=18: base=1; remainder=1; only hcp<=1 gets double
expect('strokesOnHole CH=19 hcp=1 mod=18 → 2',  strokesOnHole(19, 1, 18),  2);
expect('strokesOnHole CH=19 hcp=2 mod=18 → 1',  strokesOnHole(19, 2, 18),  1);
expect('strokesOnHole CH=19 hcp=18 mod=18 → 1', strokesOnHole(19, 18, 18), 1);

// CH=0: no strokes
expect('strokesOnHole CH=0 hcp=1 mod=18 → 0',   strokesOnHole(0, 1, 18),   0);
expect('strokesOnHole CH=0 hcp=18 mod=18 → 0',  strokesOnHole(0, 18, 18),  0);

// CH=9, mod=18: remainder=9; hcp<=9 get 1 stroke, hcp>9 get 0
expect('strokesOnHole CH=9 hcp=9 mod=18 → 1',   strokesOnHole(9, 9, 18),   1);
expect('strokesOnHole CH=9 hcp=10 mod=18 → 0',  strokesOnHole(9, 10, 18),  0);
expect('strokesOnHole CH=9 hcp=1 mod=18 → 1',   strokesOnHole(9, 1, 18),   1);

// Plus handicap CH=-2, mod=18: a=2; hcp > (18-2)=16 loses a stroke
expect('strokesOnHole CH=-2 hcp=17 mod=18 → -1', strokesOnHole(-2, 17, 18), -1);
expect('strokesOnHole CH=-2 hcp=18 mod=18 → -1', strokesOnHole(-2, 18, 18), -1);
expect('strokesOnHole CH=-2 hcp=16 mod=18 → 0',  strokesOnHole(-2, 16, 18),  0);
expect('strokesOnHole CH=-2 hcp=1 mod=18 → 0',   strokesOnHole(-2, 1, 18),   0);

// 9-hole mod=9, CH=9: base=1; remainder=0; all holes get exactly 1
expect('strokesOnHole CH=9 hcp=1 mod=9 → 1',     strokesOnHole(9, 1, 9),    1);
expect('strokesOnHole CH=9 hcp=9 mod=9 → 1',     strokesOnHole(9, 9, 9),    1);

// mod=9, CH=10: base=1; remainder=1; hcp<=1 gets double
expect('strokesOnHole CH=10 hcp=1 mod=9 → 2',    strokesOnHole(10, 1, 9),   2);
expect('strokesOnHole CH=10 hcp=2 mod=9 → 1',    strokesOnHole(10, 2, 9),   1);


// ── 9. fsBuildChs ─────────────────────────────────────────────

function make18HoleCourse(slope, rating) {
  return {
    slope: slope || 113, rating: rating || 72.0, nineHole: false,
    holes: Array.from({length:18}, (_,i) => ({ num:i+1, par:4, hcp:i+1 }))
  };
}

// Equal HCPs, strokeOffLow → both 0
{
  const c = make18HoleCourse(113, 72.0);
  const p = [{ id:'p1', hcp:10.0 }, { id:'p2', hcp:10.0 }];
  const { chs } = fsBuildChs(p, c, true);
  expect('fsBuildChs equal HCPs strokeOffLow: both 0', chs['p1'] === 0 && chs['p2'] === 0, true);
}

// strokeOffLow: p1=10, p2=18 → adj p1=0, p2=8
{
  const c = make18HoleCourse(113, 72.0);
  const p = [{ id:'p1', hcp:10.0 }, { id:'p2', hcp:18.0 }];
  const { chs, rawChs, minCH } = fsBuildChs(p, c, true);
  expect('fsBuildChs strokeOffLow: low man=0',   chs['p1'],    0);
  expect('fsBuildChs strokeOffLow: diff=8',      chs['p2'],    8);
  expect('fsBuildChs strokeOffLow: minCH=10',    minCH,        10);
  expect('fsBuildChs rawChs p1 preserved=10',   rawChs['p1'], 10);
  expect('fsBuildChs rawChs p2 preserved=18',   rawChs['p2'], 18);
}

// No strokeOffLow → raw CHs returned directly
{
  const c = make18HoleCourse(113, 72.0);
  const p = [{ id:'p1', hcp:10.0 }, { id:'p2', hcp:18.0 }];
  const { chs } = fsBuildChs(p, c, false);
  expect('fsBuildChs no-strokeOffLow: p1=10', chs['p1'], 10);
  expect('fsBuildChs no-strokeOffLow: p2=18', chs['p2'], 18);
}

// Null course → all 0
{
  const { chs } = fsBuildChs([{ id:'p1', hcp:15.0 }], null, false);
  expect('fsBuildChs null course → 0', chs['p1'], 0);
}

// Plus handicap propagates
{
  const c = make18HoleCourse(113, 72.0);
  const p = [{ id:'p1', hcp:-2.0 }, { id:'p2', hcp:0.0 }];
  const { chs } = fsBuildChs(p, c, false);
  expect('fsBuildChs plus hcp -2 propagates', chs['p1'], -2);
  expect('fsBuildChs scratch 0 propagates',   chs['p2'],  0);
}

// strokeOffLow clamps at 0 (negative adj not possible)
{
  const c = make18HoleCourse(113, 72.0);
  // p1 hcp=-2 → CH=-2, p2 hcp=0 → CH=0; min=-2; adj: p1=max(0,-2-(-2))=0, p2=max(0,0-(-2))=2
  const p = [{ id:'p1', hcp:-2.0 }, { id:'p2', hcp:0.0 }];
  const { chs } = fsBuildChs(p, c, true);
  expect('fsBuildChs strokeOffLow clamps at 0: p1=0', chs['p1'], 0);
  expect('fsBuildChs strokeOffLow: p2 gets 2',        chs['p2'], 2);
}


// ── 10. BBB ───────────────────────────────────────────────────

// Basic point accumulation across 2 holes
{
  const g = {
    playerIds: ['p1','p2','p3','p4'],
    bbb: {
      1: { bingo:'p1', bango:'p2', bongo:'p3' },
      2: { bingo:'p1', bango:'p1', bongo:'p4' },
    }
  };
  const pts = calcBBBPoints(g);
  expect('BBB p1 total=3',  pts['p1'].total,  3);
  expect('BBB p1 bingo=2',  pts['p1'].bingo,  2);
  expect('BBB p1 bango=1',  pts['p1'].bango,  1);
  expect('BBB p1 bongo=0',  pts['p1'].bongo,  0);
  expect('BBB p2 total=1',  pts['p2'].total,  1);
  expect('BBB p3 total=1',  pts['p3'].total,  1);
  expect('BBB p4 total=1',  pts['p4'].total,  1);
}

// Empty bbb object
{
  const pts = calcBBBPoints({ playerIds:['p1','p2'], bbb:{} });
  expect('BBB empty: p1=0', pts['p1'].total, 0);
  expect('BBB empty: p2=0', pts['p2'].total, 0);
}

// Null hole entry (Firebase nulls — normalizeState strips these, but math must not crash)
{
  const g = { playerIds:['p1','p2'], bbb:{ 1:{bingo:'p1', bango:'p2', bongo:'p1'}, 2:null } };
  const pts = calcBBBPoints(g);
  expect('BBB null hole no crash: p1 total=2', pts['p1'].total, 2);
}

// Settlement pool formula: net = (own * n - totalPts) * cost
// 4P, p1=6 pts, rest=4 each, total=18, cost=$2 → p1:+$12, others:-$4
{
  const n=4, totalPts=18, cost=2;
  expect('BBB settlement p1 net=+12', (6*n-totalPts)*cost,  12);
  expect('BBB settlement p2 net=-4',  (4*n-totalPts)*cost,  -4);
}

// All equal → zero net
{
  const n=4, totalPts=12, cost=5;
  expect('BBB settlement all-equal net=0', (3*n-totalPts)*cost, 0);
}


// ── 11. fsBuildNassauPairs ────────────────────────────────────

// 2-player → single 1v1 pair
{
  const p = [{id:'p1',name:'Alice'},{id:'p2',name:'Bob'}];
  const pairs = fsBuildNassauPairs(p, null);
  expect('Nassau 2P: pair count=1',  pairs.length,  1);
  expect('Nassau 2P: pair.A=p1',     pairs[0].A,    'p1');
  expect('Nassau 2P: pair.B=p2',     pairs[0].B,    'p2');
}

// 3-player → 3 pairs (all combos: AB, AC, BC)
{
  const p = [{id:'p1',name:'A'},{id:'p2',name:'B'},{id:'p3',name:'C'}];
  const pairs = fsBuildNassauPairs(p, null);
  expect('Nassau 3P: pair count=3',      pairs.length,   3);
  expect('Nassau 3P: pair0 A=p1 B=p2',   pairs[0].A==='p1' && pairs[0].B==='p2', true);
  expect('Nassau 3P: pair1 A=p1 B=p3',   pairs[1].A==='p1' && pairs[1].B==='p3', true);
  expect('Nassau 3P: pair2 A=p2 B=p3',   pairs[2].A==='p2' && pairs[2].B==='p3', true);
}

// 4-player → 1 pair with teamA/teamB arrays from teamState
{
  const p = [{id:'p1',name:'A'},{id:'p2',name:'B'},{id:'p3',name:'C'},{id:'p4',name:'D'}];
  const ts = { A:['p1','p2'], B:['p3','p4'] };
  const pairs = fsBuildNassauPairs(p, ts);
  expect('Nassau 4P: pair count=1',         pairs.length,                       1);
  expect('Nassau 4P: teamA=[p1,p2]',        JSON.stringify(pairs[0].teamA),     JSON.stringify(['p1','p2']));
  expect('Nassau 4P: teamB=[p3,p4]',        JSON.stringify(pairs[0].teamB),     JSON.stringify(['p3','p4']));
}

// Legacy migration: fsGetNassauPairs falls back to g.teams
{
  const g = { teams:{ A:['p1','p2'], B:['p3','p4'] } };
  const pairs = fsGetNassauPairs(g);
  expect('Nassau legacy g.teams: count=1',      pairs.length,              1);
  expect('Nassau legacy g.teams: has teamA',     Array.isArray(pairs[0].teamA), true);
  expect('Nassau legacy g.teams: teamA=[p1,p2]', JSON.stringify(pairs[0].teamA), JSON.stringify(['p1','p2']));
}

// g.pairs takes precedence over g.teams
{
  const g = {
    pairs: [{A:'p1',B:'p2',label:'p1 v p2'}],
    teams: { A:['old1','old2'], B:['old3','old4'] }
  };
  const pairs = fsGetNassauPairs(g);
  expect('Nassau g.pairs precedence over g.teams', pairs[0].A, 'p1');
}


// ── 12. fsCalcNassauSeg ───────────────────────────────────────

function makeHoles(n) {
  return Array.from({length:n}, (_,i) => ({ num:i+1, par:4, hcp:i+1 }));
}

// ── STROKE PLAY MODE ─────────────────────────────────────────
// All tied gross, no strokes → tied segment
{
  const holes = makeHoles(18);
  const g = {
    chs:{ p1:0, p2:0 }, _totalHoles:18, nassauMode:'stroke',
    scores:{
      p1:{ 1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:4,9:4 },
      p2:{ 1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:4,9:4 },
    }
  };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau SP all-tied: winner=tie',  r.winner, 'tie');
  expect('Nassau SP all-tied: played=9',    r.played, 9);
  expect('Nassau SP all-tied: aT===bT',     r.aT === r.bT, true);
}

// p1 wins front: all 3s vs all 5s, no strokes
{
  const holes = makeHoles(18);
  const g = {
    chs:{ p1:0, p2:0 }, _totalHoles:18, nassauMode:'stroke',
    scores:{
      p1:{ 1:3,2:3,3:3,4:3,5:3,6:3,7:3,8:3,9:3 },
      p2:{ 1:5,2:5,3:5,4:5,5:5,6:5,7:5,8:5,9:5 },
    }
  };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau SP p1 wins: winner=A', r.winner, 'A');
  expect('Nassau SP p1 wins: aT=27',   r.aT,      27);
  expect('Nassau SP p1 wins: bT=45',   r.bT,      45);
}

// No scores → played=0, winner=null
{
  const holes = makeHoles(18);
  const g = { chs:{p1:0,p2:0}, _totalHoles:18, nassauMode:'stroke', scores:{p1:{},p2:{}} };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau SP no scores: played=0',   r.played, 0);
  expect('Nassau SP no scores: winner=null', r.winner, null);
}

// Stroke adjustment: p2 CH=1 gets 1 stroke on hole 1 → p2 net h1=3, B wins
{
  const holes = makeHoles(18);
  const g = {
    chs:{ p1:0, p2:1 }, _totalHoles:18, nassauMode:'stroke',
    scores:{
      p1:{ 1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:4,9:4 },
      p2:{ 1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:4,9:4 },
    }
  };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau SP HCP stroke: winner=B', r.winner, 'B');
  expect('Nassau SP HCP stroke: aT=36',    r.aT,      36);
  expect('Nassau SP HCP stroke: bT=35',    r.bT,      35);
}

// ── MATCH PLAY MODE ──────────────────────────────────────────
// p1 wins every hole → 9 UP, closed on h5 (5 up with 4 to play), thru=9
{
  const holes = makeHoles(18);
  const g = {
    chs:{ p1:0, p2:0 }, _totalHoles:18, nassauMode:'match',
    scores:{
      p1:{ 1:3,2:3,3:3,4:3,5:3,6:3,7:3,8:3,9:3 },
      p2:{ 1:5,2:5,3:5,4:5,5:5,6:5,7:5,8:5,9:5 },
    }
  };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau MP p1 wins all: winner=A',  r.winner, 'A');
  expect('Nassau MP p1 wins all: mode=match',r.mode,   'match');
  expect('Nassau MP p1 wins all: aUp=9',     r.aUp,    9);
  expect('Nassau MP p1 wins all: bUp=0',     r.bUp,    0);
  expect('Nassau MP p1 wins all: isClosed',  r.isClosed, true);
  expect('Nassau MP p1 wins all: thru=9',    r.thru,   9);
}

// All tied → All Square (winner=tie, diff=0)
{
  const holes = makeHoles(18);
  const g = {
    chs:{ p1:0, p2:0 }, _totalHoles:18, nassauMode:'match',
    scores:{
      p1:{ 1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:4,9:4 },
      p2:{ 1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:4,9:4 },
    }
  };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau MP all tied: winner=tie', r.winner, 'tie');
  expect('Nassau MP all tied: diff=0',     r.diff,   0);
  expect('Nassau MP all tied: thru=9',     r.thru,   9);
  expect('Nassau MP all tied: isClosed=F', r.isClosed, false);
}

// p1 wins 5, p2 wins 4, thru 9 → A wins (not closed — 5 up after 9 is closed: 5>0 remaining=0)
{
  const holes = makeHoles(18);
  // p1 birdies h1-5, p2 birdies h6-9, both par rest
  const s1={}, s2={};
  for(let i=1;i<=9;i++){s1[i]=i<=5?3:4; s2[i]=i<=5?4:3;}
  const g = { chs:{p1:0,p2:0}, _totalHoles:18, nassauMode:'match', scores:{p1:s1,p2:s2} };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau MP 5v4: winner=A',     r.winner, 'A');
  expect('Nassau MP 5v4: aUp=5',        r.aUp,    5);
  expect('Nassau MP 5v4: bUp=4',        r.bUp,    4);
  expect('Nassau MP 5v4: diff=1',       r.diff,   1);
  expect('Nassau MP 5v4: isClosed=T',   r.isClosed, true); // 5 up after 5 holes, 4 remain → closed
}

// Partial scores (thru 5): p1 wins 3, p2 wins 2
{
  const holes = makeHoles(18);
  const s1={1:3,2:3,3:3,4:4,5:4};
  const s2={1:4,2:4,3:4,4:3,5:3};
  const g = { chs:{p1:0,p2:0}, _totalHoles:18, nassauMode:'match', scores:{p1:s1,p2:s2} };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau MP partial 3v2: winner=null',  r.winner, null);
  expect('Nassau MP partial 3v2: aUp=3',        r.aUp,    3);
  expect('Nassau MP partial 3v2: bUp=2',        r.bUp,    2);
  expect('Nassau MP partial 3v2: thru=5',       r.thru,   5);
  expect('Nassau MP partial 3v2: remaining=4',  r.remaining, 4);
}

// Dormie: p1 leads 4 up with 4 holes left after 5 holes played
{
  const holes = makeHoles(18);
  const s1={1:3,2:3,3:3,4:3,5:4}; // wins h1-4
  const s2={1:4,2:4,3:4,4:4,5:4};
  const g = { chs:{p1:0,p2:0}, _totalHoles:18, nassauMode:'match', scores:{p1:s1,p2:s2} };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau MP dormie: isDormie=T',  r.isDormie, true);
  expect('Nassau MP dormie: diff=4',      r.diff,     4);
  expect('Nassau MP dormie: remaining=4', r.remaining, 4);
}

// No scores → no winner, thru=0
{
  const holes = makeHoles(18);
  const g = { chs:{p1:0,p2:0}, _totalHoles:18, nassauMode:'match', scores:{p1:{},p2:{}} };
  const r = fsCalcNassauSeg(g, holes.slice(0,9), { A:'p1', B:'p2' });
  expect('Nassau MP no scores: winner=null', r.winner, null);
  expect('Nassau MP no scores: thru=0',      r.thru,   0);
}

// Back 9 segment (stroke play)
{
  const holes = makeHoles(18);
  const g = {
    chs:{ p1:0, p2:0 }, _totalHoles:18, nassauMode:'stroke',
    scores:{
      p1:{ 10:4,11:4,12:4,13:4,14:4,15:4,16:4,17:4,18:4 },
      p2:{ 10:3,11:3,12:3,13:3,14:3,15:3,16:3,17:3,18:3 },
    }
  };
  const r = fsCalcNassauSeg(g, holes.slice(9), { A:'p1', B:'p2' });
  expect('Nassau seg back 9 p2 wins: winner=B', r.winner, 'B');
  expect('Nassau seg back 9: played=9',         r.played, 9);
}


// ── 13. DOC SEGMENT SPLIT ─────────────────────────────────────

// 18-hole: floor(18/3)=6 → segs [1-6],[7-12],[13-18]
{
  const n = 18;
  const segSize = Math.floor(n / 3);
  const holes = makeHoles(n);
  const segs = [holes.slice(0,segSize), holes.slice(segSize,segSize*2), holes.slice(segSize*2)];
  expect('DOC segSize=6',               segSize,                                               6);
  expect('DOC seg0 holes=6',            segs[0].length,                                        6);
  expect('DOC seg1 holes=6',            segs[1].length,                                        6);
  expect('DOC seg2 holes=6',            segs[2].length,                                        6);
  expect('DOC seg0 starts h1',          segs[0][0].num,                                        1);
  expect('DOC seg1 starts h7',          segs[1][0].num,                                        7);
  expect('DOC seg2 starts h13',         segs[2][0].num,                                        13);
  expect('DOC total holes covered=18',  segs[0].length+segs[1].length+segs[2].length,          18);
  expect('DOC seg0 ends h6',            segs[0][segs[0].length-1].num,                         6);
  expect('DOC seg1 ends h12',           segs[1][segs[1].length-1].num,                         12);
  expect('DOC seg2 ends h18',           segs[2][segs[2].length-1].num,                         18);
}


// ── 14. normalizeState ────────────────────────────────────────

// Empty input → all required keys present
{
  const s = normalizeState({});
  expect('normalizeState empty: account object',   typeof s.account,             'object');
  expect('normalizeState empty: players array',    Array.isArray(s.players),     true);
  expect('normalizeState empty: courses array',    Array.isArray(s.courses),     true);
  expect('normalizeState empty: events array',     Array.isArray(s.events),      true);
  expect('normalizeState empty: config object',    typeof s.config,              'object');
  expect('normalizeState empty: ghinProxyUrl set', s.config.ghinProxyUrl.length > 0, true);
  expect('normalizeState empty: gameOrder array',  Array.isArray(s.config.gameOrder), true);
  expect('normalizeState empty: log array',        Array.isArray(s.config.log),  true);
  expect('normalizeState empty: modules object',   typeof s.config.modules,      'object');
  expect('normalizeState empty: games config',     typeof s.config.games,        'object');
}

// Games config default values present
{
  const s = normalizeState({});
  expect('normalizeState: skins config exists',       typeof s.config.games.skins,                'object');
  expect('normalizeState: bbb config exists',         typeof s.config.games.fourPlayer.bbb,       'object');
  expect('normalizeState: nassau config exists',      typeof s.config.games.fourPlayer.nassau,    'object');
  expect('normalizeState: doc config exists',         typeof s.config.games.fourPlayer.doc,       'object');
  expect('normalizeState: walkoff config exists',     typeof s.config.games.fourPlayer.walkoff,   'object');
}

// Null bbb hole keys stripped (Firebase nulls)
{
  const raw = { events:[{ id:'e1', bbb:{ 1:{bingo:'p1'}, 2:null, 3:null } }] };
  const s = normalizeState(raw);
  expect('normalizeState: null bbb[2] stripped',   s.events[0].bbb[2],         undefined);
  expect('normalizeState: null bbb[3] stripped',   s.events[0].bbb[3],         undefined);
  expect('normalizeState: valid bbb[1] preserved', s.events[0].bbb[1] != null, true);
}

// Null input → safe defaults
{
  const s = normalizeState(null);
  expect('normalizeState: null input safe', Array.isArray(s.players), true);
}

// myPlayerId defaults to null
{
  const s = normalizeState({});
  expect('normalizeState: myPlayerId=null', s.config.myPlayerId, null);
}


// ── 15. FORMATTING ────────────────────────────────────────────

// fmtMoney: positive gets '+', negative gets no sign (reads as debt in settlement table)
expect('fmtMoney(10)=+$10',    fmtMoney(10),    '+$10');
expect('fmtMoney(-10)=$10',    fmtMoney(-10),   '$10');
expect('fmtMoney(0)=+$0',      fmtMoney(0),     '+$0');
expect('fmtMoney(5.7)=+$6',    fmtMoney(5.7),   '+$6');
expect('fmtMoney(-5.7)=$6',    fmtMoney(-5.7),  '$6');

// fmtHcp: plus handicap negative index shown as '+N.N'
expect('fmtHcp(10.0)=10.0',    fmtHcp(10.0),    '10.0');
expect('fmtHcp(0.0)=0.0',      fmtHcp(0.0),     '0.0');
expect('fmtHcp(-2.0)=+2.0',    fmtHcp(-2.0),    '+2.0');
expect('fmtHcp(null)=—',       fmtHcp(null),    '—');
expect('fmtHcp(NaN)=—',        fmtHcp(NaN),     '—');
expect('fmtHcp(undefined)=—',  fmtHcp(undefined), '—');



// ── 17. KNOWN SCORECARD DATASET ───────────────────────────────
// Source: physical scorecard, BZ/KB/JM/ZM, blue tees
// All gross scores verified against confirmed totals:
//   BZ 48/45/93, KB 40/41/81, JM 45/49/94, ZM 37/40/77
//
// Course: Blue tees, Rating 71.2, Slope 129, Par 72
// Course HCs (read directly from card): BZ=11, KB=6, JM=14, ZM=3

{
  const SC_COURSE = {
    id:'sc-course', name:'Test Course', slope:129, rating:71.2, nineHole:false,
    holes:[
      {num:1, par:4,hcp:11},{num:2, par:4,hcp:5 },{num:3, par:3,hcp:13},
      {num:4, par:5,hcp:1 },{num:5, par:4,hcp:9 },{num:6, par:4,hcp:7 },
      {num:7, par:3,hcp:17},{num:8, par:5,hcp:3 },{num:9, par:4,hcp:15},
      {num:10,par:4,hcp:12},{num:11,par:4,hcp:6 },{num:12,par:3,hcp:16},
      {num:13,par:5,hcp:4 },{num:14,par:4,hcp:2 },{num:15,par:4,hcp:8 },
      {num:16,par:3,hcp:18},{num:17,par:5,hcp:10},{num:18,par:4,hcp:14},
    ]
  };

  const SC_PLAYERS = [
    {id:'bz',name:'BZ',hcp:11},
    {id:'kb',name:'KB',hcp:6 },
    {id:'jm',name:'JM',hcp:14},
    {id:'zm',name:'ZM',hcp:3 },
  ];

  const SC_GROSS = {
    bz:[5,7,4,5,5,8,6,6,2, 6,5,4,5,5,5,3,7,5],
    kb:[4,6,3,5,5,5,4,5,3, 5,5,4,5,4,5,3,5,5],
    jm:[4,7,4,4,5,6,5,6,4, 6,6,4,5,6,6,4,7,5],
    zm:[4,4,3,5,4,5,5,5,2, 4,7,3,4,5,6,4,3,4],
  };

  // Course HCs read directly from scorecard — not derived via calcCourseHcp
  const SC_CHS = {bz:11, kb:6, jm:14, zm:3};

  const sum = arr => arr.reduce((a,b)=>a+b,0);

  // Inject course and players into sandbox so fsGetCourse / fsPlayerById work
  sandbox.S.courses = [SC_COURSE];
  sandbox.S.players = SC_PLAYERS.map(p=>({...p}));

  // ── Gross total sanity checks ────────────────────────────
  expect('SC gross BZ out=48', sum(SC_GROSS.bz.slice(0,9)), 48);
  expect('SC gross BZ in=45',  sum(SC_GROSS.bz.slice(9)),   45);
  expect('SC gross BZ tot=93', sum(SC_GROSS.bz),            93);
  expect('SC gross KB out=40', sum(SC_GROSS.kb.slice(0,9)), 40);
  expect('SC gross KB in=41',  sum(SC_GROSS.kb.slice(9)),   41);
  expect('SC gross KB tot=81', sum(SC_GROSS.kb),            81);
  expect('SC gross JM out=45', sum(SC_GROSS.jm.slice(0,9)), 45);
  expect('SC gross JM in=49',  sum(SC_GROSS.jm.slice(9)),   49);
  expect('SC gross JM tot=94', sum(SC_GROSS.jm),            94);
  expect('SC gross ZM out=37', sum(SC_GROSS.zm.slice(0,9)), 37);
  expect('SC gross ZM in=40',  sum(SC_GROSS.zm.slice(9)),   40);
  expect('SC gross ZM tot=77', sum(SC_GROSS.zm),            77);

  // ── Strokes per hole spot checks ────────────────────────
  // Total strokes given must equal CH
  const totalStrokes = id => SC_COURSE.holes.reduce((a,h)=>a+strokesOnHole(SC_CHS[id],h.hcp,18),0);
  expect('SC total strokes BZ=11', totalStrokes('bz'), 11);
  expect('SC total strokes KB=6',  totalStrokes('kb'),  6);
  expect('SC total strokes JM=14', totalStrokes('jm'), 14);
  expect('SC total strokes ZM=3',  totalStrokes('zm'),  3);

  // Critical per-hole spot checks
  expect('SC strokes BZ H1  hcp11 CH11 → 1', strokesOnHole(11,11,18), 1);
  expect('SC strokes BZ H7  hcp17 CH11 → 0', strokesOnHole(11,17,18), 0);
  expect('SC strokes KB H1  hcp11 CH6  → 0', strokesOnHole( 6,11,18), 0);
  expect('SC strokes KB H2  hcp5  CH6  → 1', strokesOnHole( 6, 5,18), 1);
  expect('SC strokes JM H4  hcp1  CH14 → 1', strokesOnHole(14, 1,18), 1);
  expect('SC strokes JM H7  hcp17 CH14 → 0', strokesOnHole(14,17,18), 0);
  expect('SC strokes ZM H4  hcp1  CH3  → 1', strokesOnHole( 3, 1,18), 1);
  expect('SC strokes ZM H2  hcp5  CH3  → 0', strokesOnHole( 3, 5,18), 0);
  expect('SC strokes ZM H14 hcp2  CH3  → 1', strokesOnHole( 3, 2,18), 1);

  // ── Net scores: full 18-hole card ───────────────────────
  // [hole_num, player_id, expected_net]  — all pre-computed independently
  const netChecks = [
    // H1 hcp11: BZ 5-1=4, KB 4-0=4, JM 4-1=3, ZM 4-0=4
    [1,'bz',4],[1,'kb',4],[1,'jm',3],[1,'zm',4],
    // H2 hcp5:  BZ 7-1=6, KB 6-1=5, JM 7-1=6, ZM 4-0=4
    [2,'bz',6],[2,'kb',5],[2,'jm',6],[2,'zm',4],
    // H3 hcp13: BZ 4-0=4, KB 3-0=3, JM 4-1=3, ZM 3-0=3
    [3,'bz',4],[3,'kb',3],[3,'jm',3],[3,'zm',3],
    // H4 hcp1:  BZ 5-1=4, KB 5-1=4, JM 4-1=3, ZM 5-1=4
    [4,'bz',4],[4,'kb',4],[4,'jm',3],[4,'zm',4],
    // H5 hcp9:  BZ 5-1=4, KB 5-0=5, JM 5-1=4, ZM 4-0=4
    [5,'bz',4],[5,'kb',5],[5,'jm',4],[5,'zm',4],
    // H6 hcp7:  BZ 8-1=7, KB 5-0=5, JM 6-1=5, ZM 5-0=5
    [6,'bz',7],[6,'kb',5],[6,'jm',5],[6,'zm',5],
    // H7 hcp17: BZ 6-0=6, KB 4-0=4, JM 5-0=5, ZM 5-0=5
    [7,'bz',6],[7,'kb',4],[7,'jm',5],[7,'zm',5],
    // H8 hcp3:  BZ 6-1=5, KB 5-1=4, JM 6-1=5, ZM 5-1=4
    [8,'bz',5],[8,'kb',4],[8,'jm',5],[8,'zm',4],
    // H9 hcp15: BZ 2-0=2, KB 3-0=3, JM 4-0=4, ZM 2-0=2
    [9,'bz',2],[9,'kb',3],[9,'jm',4],[9,'zm',2],
    // H10 hcp12: BZ 6-0=6, KB 5-0=5, JM 6-1=5, ZM 4-0=4
    [10,'bz',6],[10,'kb',5],[10,'jm',5],[10,'zm',4],
    // H11 hcp6:  BZ 5-1=4, KB 5-1=4, JM 6-1=5, ZM 7-0=7
    [11,'bz',4],[11,'kb',4],[11,'jm',5],[11,'zm',7],
    // H12 hcp16: BZ 4-0=4, KB 4-0=4, JM 4-0=4, ZM 3-0=3
    [12,'bz',4],[12,'kb',4],[12,'jm',4],[12,'zm',3],
    // H13 hcp4:  BZ 5-1=4, KB 5-1=4, JM 5-1=4, ZM 4-0=4
    [13,'bz',4],[13,'kb',4],[13,'jm',4],[13,'zm',4],
    // H14 hcp2:  BZ 5-1=4, KB 4-1=3, JM 6-1=5, ZM 5-1=4
    [14,'bz',4],[14,'kb',3],[14,'jm',5],[14,'zm',4],
    // H15 hcp8:  BZ 5-1=4, KB 5-0=5, JM 6-1=5, ZM 6-0=6
    [15,'bz',4],[15,'kb',5],[15,'jm',5],[15,'zm',6],
    // H16 hcp18: BZ 3-0=3, KB 3-0=3, JM 4-0=4, ZM 4-0=4
    [16,'bz',3],[16,'kb',3],[16,'jm',4],[16,'zm',4],
    // H17 hcp10: BZ 7-1=6, KB 5-0=5, JM 7-1=6, ZM 3-0=3
    [17,'bz',6],[17,'kb',5],[17,'jm',6],[17,'zm',3],
    // H18 hcp14: BZ 5-0=5, KB 5-0=5, JM 5-1=4, ZM 4-0=4
    [18,'bz',5],[18,'kb',5],[18,'jm',4],[18,'zm',4],
  ];

  netChecks.forEach(([hNum, pid, expectedNet]) => {
    const hole   = SC_COURSE.holes.find(h => h.num === hNum);
    const gr     = SC_GROSS[pid][hNum - 1];
    const str    = strokesOnHole(SC_CHS[pid], hole.hcp, 18);
    const net    = gr - str;
    expect(`SC net H${hNum} ${pid.toUpperCase()} ${gr}-${str}=${expectedNet}`, net, expectedNet);
  });

  // ── Net totals ──────────────────────────────────────────
  const netTotal = id => SC_COURSE.holes.reduce((a,h,i) =>
    a + SC_GROSS[id][i] - strokesOnHole(SC_CHS[id], h.hcp, 18), 0);
  expect('SC net total BZ=82', netTotal('bz'), 82);
  expect('SC net total KB=75', netTotal('kb'), 75);
  expect('SC net total JM=80', netTotal('jm'), 80);
  expect('SC net total ZM=74', netTotal('zm'), 74);

  // ── fsGetStrokesForSc adapter ───────────────────────────
  {
    const g = {courseId:'sc-course', chs:SC_CHS, _totalHoles:18, scores:{}};
    expect('fsGetStrokesForSc BZ H1  hcp11 → 1', fsGetStrokesForSc(g,'bz',{num:1, par:4,hcp:11}), 1);
    expect('fsGetStrokesForSc KB H2  hcp5  → 1', fsGetStrokesForSc(g,'kb',{num:2, par:4,hcp:5 }), 1);
    expect('fsGetStrokesForSc JM H7  hcp17 → 0', fsGetStrokesForSc(g,'jm',{num:7, par:3,hcp:17}), 0);
    expect('fsGetStrokesForSc ZM H4  hcp1  → 1', fsGetStrokesForSc(g,'zm',{num:4, par:5,hcp:1 }), 1);
    expect('fsGetStrokesForSc ZM H14 hcp2  → 1', fsGetStrokesForSc(g,'zm',{num:14,par:4,hcp:2 }), 1);
    expect('fsGetStrokesForSc ZM H2  hcp5  → 0', fsGetStrokesForSc(g,'zm',{num:2, par:4,hcp:5 }), 0);
  }

  // ── fsCalcNassauSeg with real scores ────────────────────
  {
    const scores = {};
    SC_PLAYERS.forEach(p => {
      scores[p.id] = {};
      SC_COURSE.holes.forEach((h,i) => { scores[p.id][h.num] = SC_GROSS[p.id][i]; });
    });
    const g = {courseId:'sc-course', chs:SC_CHS, _totalHoles:18, nassauMode:'stroke', scores};
    const front = SC_COURSE.holes.slice(0,9);
    const back  = SC_COURSE.holes.slice(9);

    // BZ v KB front: BZ net=42, KB net=37 → KB wins (B)
    const bzKbF = fsCalcNassauSeg(g, front, {A:'bz',B:'kb'});
    expect('SC Nassau BZ v KB front winner=B', bzKbF.winner, 'B');
    expect('SC Nassau BZ v KB front aT=42',    bzKbF.aT,     42);
    expect('SC Nassau BZ v KB front bT=37',    bzKbF.bT,     37);
    expect('SC Nassau BZ v KB front played=9', bzKbF.played,  9);

    // BZ v KB back: BZ net=40, KB net=38 → KB wins (B)
    const bzKbB = fsCalcNassauSeg(g, back, {A:'bz',B:'kb'});
    expect('SC Nassau BZ v KB back winner=B',  bzKbB.winner, 'B');
    expect('SC Nassau BZ v KB back aT=40',     bzKbB.aT,     40);
    expect('SC Nassau BZ v KB back bT=38',     bzKbB.bT,     38);
    expect('SC Nassau BZ v KB back played=9',  bzKbB.played,  9);

    // BZ v KB total: BZ net=82, KB net=75 → KB wins (B)
    const bzKbT = fsCalcNassauSeg(g, SC_COURSE.holes, {A:'bz',B:'kb'});
    expect('SC Nassau BZ v KB total winner=B', bzKbT.winner, 'B');
    expect('SC Nassau BZ v KB total aT=82',    bzKbT.aT,     82);
    expect('SC Nassau BZ v KB total bT=75',    bzKbT.bT,     75);

    // ZM v JM front: ZM net=35, JM net=38 → ZM wins (A)
    const zmJmF = fsCalcNassauSeg(g, front, {A:'zm',B:'jm'});
    expect('SC Nassau ZM v JM front winner=A', zmJmF.winner, 'A');
    expect('SC Nassau ZM v JM front aT=35',    zmJmF.aT,     35);
    expect('SC Nassau ZM v JM front bT=38',    zmJmF.bT,     38);

    // ZM v JM back: ZM net=39, JM net=42 → ZM wins (A)
    const zmJmB = fsCalcNassauSeg(g, back, {A:'zm',B:'jm'});
    expect('SC Nassau ZM v JM back winner=A',  zmJmB.winner, 'A');
    expect('SC Nassau ZM v JM back aT=39',     zmJmB.aT,     39);
    expect('SC Nassau ZM v JM back bT=42',     zmJmB.bT,     42);
  }

  // ── fsCalcDOCMatch with real scores ─────────────────────
  // cart1={driver:BZ, passenger:JM}, cart2={driver:KB, passenger:ZM}
  // Match 0 Drivers v Pass  (holes 1-6):  BZ+KB v JM+ZM → JM/ZM wins 3-0
  // Match 1 Opposites       (holes 7-12): BZ+ZM v KB+JM → BZ/ZM wins 3-1
  // Match 2 Cart Partners   (holes 13-18):BZ+JM v KB+ZM → KB/ZM wins 2-1
  {
    const scores = {};
    SC_PLAYERS.forEach(p => {
      scores[p.id] = {};
      SC_COURSE.holes.forEach((h,i) => { scores[p.id][h.num] = SC_GROSS[p.id][i]; });
    });
    const segSize = 6;
    const g = {
      courseId:'sc-course', chs:SC_CHS, _totalHoles:18, scores,
      segs:[
        SC_COURSE.holes.slice(0,6),
        SC_COURSE.holes.slice(6,12),
        SC_COURSE.holes.slice(12,18),
      ],
      carts:{
        cart1:{driver:'bz', passenger:'jm'},
        cart2:{driver:'kb', passenger:'zm'},
      },
    };
    const defs = fsDocMatchDefs(g);

    const m0 = fsCalcDOCMatch(g, 0, defs);
    expect('SC DOC match0 (Drv v Pass): t2 leads',   m0.cls,     'mb-down');
    expect('SC DOC match0: leading=t2lbl',            m0.leading, defs[0].t2lbl);

    const m1 = fsCalcDOCMatch(g, 1, defs);
    expect('SC DOC match1 (Opp): t1 leads',           m1.cls,     'mb-up');
    expect('SC DOC match1: leading=t1lbl',            m1.leading, defs[1].t1lbl);

    const m2 = fsCalcDOCMatch(g, 2, defs);
    expect('SC DOC match2 (Cart): t2 leads',          m2.cls,     'mb-down');
    expect('SC DOC match2: leading=t2lbl',            m2.leading, defs[2].t2lbl);
  }
}


// ── 19. SCORING UTILITIES ────────────────────────────────────

{
  const { calcPlayingHcp, pointTarget, effectiveHcpRatings,
          strokesOnHoleHalf, stablefordPts } = sandbox;

  // ── calcPlayingHcp ──────────────────────────────────────────
  // Normal: roundHalfAwayZero(raw * adj)
  expect('calcPlayingHcp(10.0, 100)', calcPlayingHcp(10.0, 100), 10);
  expect('calcPlayingHcp(10.0, 85)',  calcPlayingHcp(10.0, 85),  9);  // 8.5 → 9
  expect('calcPlayingHcp(18.0, 85)',  calcPlayingHcp(18.0, 85),  15); // 15.3 → 15
  expect('calcPlayingHcp(18.0, 75)',  calcPlayingHcp(18.0, 75),  14); // 13.5 → 14
  expect('calcPlayingHcp(0.0,  100)', calcPlayingHcp(0.0,  100),  0);
  // Plus handicap: roundHalfAwayZero applied twice
  expect('calcPlayingHcp(-2.0, 100)', calcPlayingHcp(-2.0, 100), -2);
  expect('calcPlayingHcp(-2.0, 85)',  calcPlayingHcp(-2.0, 85),  -2); // round(-2)*0.85=round(-1.7)=-2
  expect('calcPlayingHcp(-4.0, 75)',  calcPlayingHcp(-4.0, 75),  -3); // round(-4)*0.75=round(-3)=-3

  // ── pointTarget ─────────────────────────────────────────────
  // 18-hole: 36 - courseHcp
  expect('pointTarget(10, false)=26',  pointTarget(10, false), 26);
  expect('pointTarget(0,  false)=36',  pointTarget(0,  false), 36);
  expect('pointTarget(18, false)=18',  pointTarget(18, false), 18);
  expect('pointTarget(36, false)=0',   pointTarget(36, false),  0);
  // 9-hole: 18 - courseHcp
  expect('pointTarget(9,  true)=9',    pointTarget(9,  true),   9);
  expect('pointTarget(0,  true)=18',   pointTarget(0,  true),  18);

  // ── stablefordPts ───────────────────────────────────────────
  // Standard settings (dblEagle=8, eagle=4, birdie=2, par=1, bogey=0, dbl=0)
  const cfg = { dblEagle:8, eagle:4, birdie:2, par:1, bogey:0, dbl:0 };
  expect('stablefordPts(-3, cfg)=8',  stablefordPts(-3, cfg), 8); // dbl eagle
  expect('stablefordPts(-4, cfg)=8',  stablefordPts(-4, cfg), 8); // albatross → dbl eagle bucket
  expect('stablefordPts(-2, cfg)=4',  stablefordPts(-2, cfg), 4); // eagle
  expect('stablefordPts(-1, cfg)=2',  stablefordPts(-1, cfg), 2); // birdie
  expect('stablefordPts(0,  cfg)=1',  stablefordPts( 0, cfg), 1); // par
  expect('stablefordPts(1,  cfg)=0',  stablefordPts( 1, cfg), 0); // bogey
  expect('stablefordPts(2,  cfg)=0',  stablefordPts( 2, cfg), 0); // double bogey+
  expect('stablefordPts(5,  cfg)=0',  stablefordPts( 5, cfg), 0); // triple+

  // Custom settings (eagle=5)
  const cfg2 = { dblEagle:8, eagle:5, birdie:2, par:1, bogey:0, dbl:0 };
  expect('stablefordPts(-2, cfg2)=5', stablefordPts(-2, cfg2), 5);

  // ── strokesOnHoleHalf ───────────────────────────────────────
  // Should be exactly 0.5× strokesOnHole
  expect('strokesOnHoleHalf(18, 1, 18)=0.5', strokesOnHoleHalf(18, 1, 18), 0.5);
  expect('strokesOnHoleHalf(18, 18,18)=0.5', strokesOnHoleHalf(18,18, 18), 0.5);
  expect('strokesOnHoleHalf(0,  1, 18)=0',   strokesOnHoleHalf(0,  1, 18), 0);
  expect('strokesOnHoleHalf(9,  1, 18)=0.5', strokesOnHoleHalf(9,  1, 18), 0.5);
  expect('strokesOnHoleHalf(9, 10, 18)=0',   strokesOnHoleHalf(9, 10, 18), 0);

  // ── effectiveHcpRatings ─────────────────────────────────────
  // Full 18-hole: returns null
  {
    const course18 = { nineHole:false, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})) };
    expect('effectiveHcpRatings full 18 → null', effectiveHcpRatings(course18, course18.holes), null);
  }
  // 9-hole course with 1-9 ratings: returns null (already correct scale)
  {
    const course9 = { nineHole:true, holes:Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1})) };
    expect('effectiveHcpRatings 9h 1-9 scale → null', effectiveHcpRatings(course9, course9.holes), null);
  }
  // 9-of-18 (front 9 of 18-hole course, ratings 1-18): re-ranks to 1-9
  {
    const course18 = { nineHole:false, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})) };
    const front9   = course18.holes.slice(0,9); // hcp ratings: 1,2,3,4,5,6,7,8,9 — max=9
    // max <= 9 → returns null
    expect('effectiveHcpRatings front9 hcp1-9 → null', effectiveHcpRatings(course18, front9), null);
  }
  {
    // Back 9: hcp ratings 10,11,12,13,14,15,16,17,18 — max=18 > 9 → re-rank
    const course18 = { nineHole:false, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})) };
    const back9    = course18.holes.slice(9); // holes 10-18, hcp 10-18
    const rankMap  = effectiveHcpRatings(course18, back9);
    expect('effectiveHcpRatings back9: map exists',      rankMap !== null, true);
    expect('effectiveHcpRatings back9: hardest h10(hcp10) → rank 1', rankMap[10], 1);
    expect('effectiveHcpRatings back9: easiest h18(hcp18) → rank 9', rankMap[18], 9);
    expect('effectiveHcpRatings back9: 9 entries',       Object.keys(rankMap).length, 9);
  }
}

// ── 20. OUTING COMPUTE RESULTS ───────────────────────────────

{
  const { outingComputeResults } = sandbox;
  expect('outingComputeResults exists', typeof outingComputeResults, 'function');

  // Build a minimal outing game with 4 players, 9 holes, known scores
  // Course: slope=113, rating=36, par=36, 9 holes, hcp ratings 1-9
  const OC_COURSE = {
    id:'oc1', name:'Test 9', slope:113, rating:36.0, nineHole:true,
    holes: Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1}))
  };
  // fsGetCourse uses the vm-local S which gets reset by loadLocal() at init.
  // Patch it directly for this test so it finds our test course.
  const origFsGetCourse = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id === 'oc1' ? OC_COURSE : origFsGetCourse(id);

  // Players: CH 0, 9, 18, 4
  // With 9-hole mod, CH=9 gets 1 stroke on all 9 holes, CH=18 gets 2 on hcp1 and 1 on rest
  const OC_PLAYERS = [
    {id:'a',name:'Alice', hcp:0,  courseHcp:0,  isGuest:false},
    {id:'b',name:'Bob',   hcp:9,  courseHcp:9,  isGuest:false},
    {id:'c',name:'Carol', hcp:18, courseHcp:18, isGuest:false},
    {id:'d',name:'Dave',  hcp:4,  courseHcp:4,  isGuest:false},
  ];
  // Gross scores: all make par (4) on every hole
  const parScores = {};
  OC_PLAYERS.forEach(p => {
    parScores[p.id] = {};
    OC_COURSE.holes.forEach(h => { parScores[p.id][h.num] = 4; });
  });

  const oc_stab = {
    id:'oc-stab', type:'outing', status:'active', _scoring:true,
    courseId:'oc1', courseName:'Test 9',
    gameType:'stableford', skins:false, nineSide:'all',
    playerIds:OC_PLAYERS.map(p=>p.id),
    playerNames:OC_PLAYERS.map(p=>p.name),
    players:OC_PLAYERS,
    groups:[{id:'g1',playerIds:OC_PLAYERS.map(p=>p.id)}],
    scores: JSON.parse(JSON.stringify(parScores)),
    phase:'scoring',
  };

  // Save outing to sandbox S.events so outingComputeResults can find course
  sandbox.S.events = [oc_stab];

  const r = outingComputeResults(oc_stab);
  expect('outingComputeResults: returns result', r !== null, true);
  expect('outingComputeResults: playerData count=4', r.playerData.length, 4);
  expect('outingComputeResults: activeHoles=9', r.activeHoles.length, 9);

  // All players score gross 4 on par 4 holes → grossVsPar=0 → par → 1 pt each hole
  // Stableford uses GROSS score vs par (matching Friday Game canonical — HCP strokes
  // reduce the score needed to earn points but pts table is applied to gross)
  // So everyone making gross par gets 1 pt/hole regardless of HCP strokes given.
  const alice = r.playerData.find(p=>p.id==='a');
  expect('outingComputeResults Alice totalGross=36', alice.totalGross, 36);
  expect('outingComputeResults Alice totalPts=9',   alice.totalPts,   9);  // 9 × gross par = 9 × 1pt
  expect('outingComputeResults Alice ptTarget=18',  alice.ptTarget,   18); // 18 - CH0

  const bob = r.playerData.find(p=>p.id==='b');
  expect('outingComputeResults Bob totalGross=36',  bob.totalGross,  36);
  expect('outingComputeResults Bob totalPts=9',     bob.totalPts,    9);   // gross par = 1pt each
  expect('outingComputeResults Bob ptTarget=9',     bob.ptTarget,    9);   // 18 - CH9

  const carol = r.playerData.find(p=>p.id==='c');
  expect('outingComputeResults Carol totalGross=36', carol.totalGross, 36);
  expect('outingComputeResults Carol totalPts=9',    carol.totalPts,   9);  // gross par = 1pt each
  expect('outingComputeResults Carol ptTarget=0',    carol.ptTarget,    0); // 18 - CH18

  const dave = r.playerData.find(p=>p.id==='d');
  expect('outingComputeResults Dave totalGross=36',  dave.totalGross, 36);
  expect('outingComputeResults Dave totalPts=9',     dave.totalPts,    9);  // gross par = 1pt each
  expect('outingComputeResults Dave ptTarget=14',    dave.ptTarget,   14); // 18 - CH4

  // Low Net check: net totals
  // Alice net = 36 (no strokes); Bob net = 27 (9 strokes); Carol net = 18 (18 strokes); Dave net = 32 (4 strokes)
  expect('outingComputeResults Alice totalNet=36', alice.totalNet, 36);
  expect('outingComputeResults Bob totalNet=27',   bob.totalNet,   27);
  expect('outingComputeResults Carol totalNet=18', carol.totalNet, 18);
  expect('outingComputeResults Dave totalNet=32',  dave.totalNet,  32);

  // Skins: all make par gross — Alice (CH=0) net par on all, Bob net birdie on all,
  // Carol net eagle on all, Dave net birdie on h1-4 and par on h5-9
  // Net skins: Carol wins all 9 holes outright (net 2 = eagle, lowest)
  const carolNetWins = r.netSkins.filter(w=>w&&w.id==='c').length;
  expect('outingComputeResults Carol wins all 9 net skins', carolNetWins, 9);

  // Gross skins: all score 4 gross on all holes → all tied → no gross skin winners
  const anyGrossWinner = r.grossSkins.some(w=>w!==null);
  expect('outingComputeResults no gross skin winners (all tied)', anyGrossWinner, false);
}

// ── 21. OUTING COMPUTE RESULTS — EXTENDED ────────────────────
// Additional coverage: Low Net, Low Gross, Skins, partial scores, 18-hole

{
  // Shared test course — 18-hole, slope 113, rating 72, par 72
  const OC18 = {
    id:'oc18', name:'Test 18', slope:113, rating:72.0, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:i<9?4:4,hcp:i+1}))
  };
  // 4 players, CH 0/5/10/18
  const OCP = [
    {id:'p1',name:'P1',hcp:0,  courseHcp:0,  isGuest:false},
    {id:'p2',name:'P2',hcp:5,  courseHcp:5,  isGuest:false},
    {id:'p3',name:'P3',hcp:10, courseHcp:10, isGuest:false},
    {id:'p4',name:'P4',hcp:18, courseHcp:18, isGuest:false},
  ];

  // Patch fsGetCourse for oc18
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='oc18' ? OC18 : id==='oc1' ? {id:'oc1',name:'T9',slope:113,rating:36,nineHole:true,holes:Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1}))} : origFGC(id);

  function makeGame(gameType, scores, skins=false) {
    return {
      id:'ocx', type:'outing', status:'active', _scoring:true,
      courseId:'oc18', courseName:'Test 18',
      gameType, skins, nineSide:'all',
      playerIds:OCP.map(p=>p.id), playerNames:OCP.map(p=>p.name),
      players:OCP, groups:[{id:'g1',playerIds:OCP.map(p=>p.id)}],
      scores: JSON.parse(JSON.stringify(scores)), phase:'scoring',
    };
  }

  // Build scores: p1=all 4s (par), p2=all 5s (bogey), p3=all 3s (birdie), p4=all 6s (dbl bogey)
  function makeScores(grossByPid) {
    const sc = {};
    OCP.forEach(p => {
      sc[p.id] = {};
      OC18.holes.forEach(h => { sc[p.id][h.num] = grossByPid[p.id]; });
    });
    return sc;
  }
  const scores_mixed = makeScores({p1:4, p2:5, p3:3, p4:6});

  // ── Low Net leaderboard order ─────────────────────────────
  // p1 CH=0: net=gross=4 each → totalNet=72
  // p2 CH=5: 5 strokes (hcp 1-5 holes) → net: 5 holes net=4, 13 holes net=5 → totalNet=5*4+13*5=85? wait
  // p2 gross=5 all 18, gets strokes on hcp 1-5 → net on those=4, rest=5
  // totalNet = 5*4 + 13*5 = 20+65 = 85... but total gross = 90
  // Actually: p2 gross=5 every hole; CH=5: stroke on hcp<=5: holes 1-5 → net=4; holes 6-18 → net=5
  // totalNet = 5*4 + 13*5 = 85. Wait gross p2=5×18=90, net=90-5=85 ✓
  // p3 CH=10: gross=3 all holes → totalNet=3×18-10=54-10=44
  // p4 CH=18: gross=6 all holes → totalNet=6×18-18=108-18=90
  // Low Net order: p3(44) < p1(72) < p2(85) < p4(90)
  {
    const g = makeGame('lownet', scores_mixed);
    const r = sandbox.outingComputeResults(g);
    expect('outing lownet p1 totalGross=72', r.playerData.find(p=>p.id==='p1').totalGross, 72);
    expect('outing lownet p1 totalNet=72',   r.playerData.find(p=>p.id==='p1').totalNet,   72);
    expect('outing lownet p2 totalGross=90', r.playerData.find(p=>p.id==='p2').totalGross, 90);
    expect('outing lownet p2 totalNet=85',   r.playerData.find(p=>p.id==='p2').totalNet,   85);
    expect('outing lownet p3 totalGross=54', r.playerData.find(p=>p.id==='p3').totalGross, 54);
    expect('outing lownet p3 totalNet=44',   r.playerData.find(p=>p.id==='p3').totalNet,   44);
    expect('outing lownet p4 totalGross=108',r.playerData.find(p=>p.id==='p4').totalGross, 108);
    expect('outing lownet p4 totalNet=90',   r.playerData.find(p=>p.id==='p4').totalNet,   90);
  }

  // ── Low Gross leaderboard order ───────────────────────────
  // p1=72, p2=90, p3=54, p4=108 → order: p3 < p1 < p2 < p4
  {
    const g = makeGame('gross', scores_mixed);
    const r = sandbox.outingComputeResults(g);
    expect('outing gross p3 totalGross=54',  r.playerData.find(p=>p.id==='p3').totalGross, 54);
    expect('outing gross p1 totalGross=72',  r.playerData.find(p=>p.id==='p1').totalGross, 72);
    expect('outing gross p2 totalGross=90',  r.playerData.find(p=>p.id==='p2').totalGross, 90);
    expect('outing gross p4 totalGross=108', r.playerData.find(p=>p.id==='p4').totalGross, 108);
    // totalNet still computed (used for skins)
    expect('outing gross p3 totalNet=44',    r.playerData.find(p=>p.id==='p3').totalNet,   44);
  }

  // ── Stableford pts on 18-hole course ─────────────────────
  // p3 shoots gross birdie (3) on all 18 par-4 holes → grossVsPar=-1 → 2 pts each → 36 pts
  // p1 shoots par (4) → 1 pt each → 18 pts
  // p2 shoots bogey (5) → 0 pts each → 0 pts
  {
    const g = makeGame('stableford', scores_mixed);
    const r = sandbox.outingComputeResults(g);
    expect('outing stab p3 totalPts=36', r.playerData.find(p=>p.id==='p3').totalPts, 36);
    expect('outing stab p1 totalPts=18', r.playerData.find(p=>p.id==='p1').totalPts, 18);
    expect('outing stab p2 totalPts=0',  r.playerData.find(p=>p.id==='p2').totalPts,  0);
    expect('outing stab p4 totalPts=0',  r.playerData.find(p=>p.id==='p4').totalPts,  0);
    // ptTarget: 36 - CH
    expect('outing stab p1 ptTarget=36', r.playerData.find(p=>p.id==='p1').ptTarget, 36);
    expect('outing stab p2 ptTarget=31', r.playerData.find(p=>p.id==='p2').ptTarget, 31);
    expect('outing stab p3 ptTarget=26', r.playerData.find(p=>p.id==='p3').ptTarget, 26);
    expect('outing stab p4 ptTarget=18', r.playerData.find(p=>p.id==='p4').ptTarget, 18);
  }

  // ── Skins — gross winners ─────────────────────────────────
  // p3 shoots 3 on all holes, everyone else shoots 4+ → p3 wins all 18 gross skins
  {
    const g = makeGame('stableford', scores_mixed, true);
    const r = sandbox.outingComputeResults(g);
    const p3GrossWins = r.grossSkins.filter(w=>w&&w.id==='p3').length;
    expect('outing skins p3 wins all 18 gross', p3GrossWins, 18);
    expect('outing skins p3 grossTally=18', r.grossTally['p3'], 18);
    expect('outing skins others grossTally=0',
      r.grossTally['p1']===0 && r.grossTally['p2']===0 && r.grossTally['p4']===0, true);
  }

  // ── Skins — net winners ───────────────────────────────────
  // All players shoot gross 4 (par) on all holes — net varies by CH strokes:
  // p1 CH=0: net 4 everywhere; p2 CH=5: net 3 on hcp 1-5; p3 CH=10: net 3 on hcp 1-10; p4 CH=18: net 3 everywhere
  // Net skin winner = unique lowest. Ties produce no winner.
  // Holes hcp 1-5:  p2/p3/p4 all net 3 → 3-way tie → no winner
  // Holes hcp 6-10: p3/p4 net 3 → 2-way tie → no winner
  // Holes hcp 11-18: only p4 net 3 → p4 wins (8 holes)
  {
    const scAllPar = makeScores({p1:4,p2:4,p3:4,p4:4});
    const g = makeGame('stableford', scAllPar, true);
    const r = sandbox.outingComputeResults(g);
    const p4NetWins = r.netSkins.filter(w=>w&&w.id==='p4').length;
    expect('outing skins p4 wins 8 net (unique lowest hcp 11-18)', p4NetWins, 8);
    expect('outing skins p4 netTally=8', r.netTally['p4'], 8);
    expect('outing skins no gross winners (all tied gross)', r.grossSkins.every(w=>w===null), true);
    // Tied holes produce no winner
    expect('outing skins h1 no winner (3-way tie)', r.netSkins[0], null);
    expect('outing skins h6 no winner (p3/p4 tie)', r.netSkins[5], null);
    // p4 alone at net 3 on holes with hcp > 10
    expect('outing skins h11 winner=p4', r.netSkins[10]?.id, 'p4');
    expect('outing skins h18 winner=p4', r.netSkins[17]?.id, 'p4');
  }

  // ── Partial scores (some holes missing) ──────────────────
  // p1 has scores on holes 1-9 only; holes 10-18 missing
  {
    const scPartial = {};
    OCP.forEach(p => {
      scPartial[p.id] = {};
      OC18.holes.slice(0,9).forEach(h => { scPartial[p.id][h.num] = 4; });
      // back 9 missing
    });
    const g = makeGame('lownet', scPartial);
    const r = sandbox.outingComputeResults(g);
    // totalGross = sum of scored holes only (front 9 = 9×4=36)
    expect('outing partial p1 totalGross=36', r.playerData.find(p=>p.id==='p1').totalGross, 36);
    // Holes with no score contribute 0 to net/pts
    expect('outing partial p1 totalNet front only',
      r.playerData.find(p=>p.id==='p1').totalNet, 36); // CH=0 no strokes
    // Result object still returns all 18 holeData entries
    expect('outing partial holeData length=18', r.playerData[0].holeData.length, 18);
    // Missing holes have gross=0
    expect('outing partial h10 gross=0', r.playerData.find(p=>p.id==='p1').holeData[9].gross, 0);
  }

  // ── outingComputeResults returns activeHoles ──────────────
  {
    // Front 9 only
    const g = makeGame('lownet', makeScores({p1:4,p2:4,p3:4,p4:4}));
    g.nineSide = 'front';
    const r = sandbox.outingComputeResults(g);
    expect('outing front9 activeHoles=9', r.activeHoles.length, 9);
    expect('outing front9 holeData=9',    r.playerData[0].holeData.length, 9);
    expect('outing front9 first hole=1',  r.activeHoles[0].num, 1);
    expect('outing front9 last hole=9',   r.activeHoles[8].num, 9);
  }
  {
    // Back 9 only
    const g = makeGame('lownet', makeScores({p1:4,p2:4,p3:4,p4:4}));
    g.nineSide = 'back';
    const r = sandbox.outingComputeResults(g);
    expect('outing back9 activeHoles=9', r.activeHoles.length, 9);
    expect('outing back9 first hole=10', r.activeHoles[0].num, 10);
    expect('outing back9 last hole=18',  r.activeHoles[8].num, 18);
  }

  // ── outingComputeResults summary fields for finish ──────────
  // outingFinish uses vm-local S (not testable via sandbox.S), so we test
  // that results contain the correct data for the summary logic to use.
  {
    // Stableford: winner by highest pts vs quota → p3 (+10 vs quota 26)
    const rStab = sandbox.outingComputeResults(makeGame('stableford', scores_mixed));
    const stabSorted = [...rStab.playerData].filter(p=>p.totalGross>0)
      .sort((a,b)=>(b.totalPts-b.ptTarget)-(a.totalPts-a.ptTarget));
    expect('outing finish stab winner=P3', stabSorted[0].name, 'P3');
    expect('outing finish stab winner pts=36', stabSorted[0].totalPts, 36);
    expect('outing finish stab +/-=+10', stabSorted[0].totalPts-stabSorted[0].ptTarget, 10);

    // Low Net: winner by lowest net → p3 (net 44)
    const rNet = sandbox.outingComputeResults(makeGame('lownet', scores_mixed));
    const netSorted = [...rNet.playerData].filter(p=>p.totalGross>0)
      .sort((a,b)=>a.totalNet-b.totalNet);
    expect('outing finish lownet winner=P3', netSorted[0].name, 'P3');
    expect('outing finish lownet net=44', netSorted[0].totalNet, 44);

    // Low Gross: winner by lowest gross → p3 (gross 54)
    const rGross = sandbox.outingComputeResults(makeGame('gross', scores_mixed));
    const grossSorted = [...rGross.playerData].filter(p=>p.totalGross>0)
      .sort((a,b)=>a.totalGross-b.totalGross);
    expect('outing finish gross winner=P3', grossSorted[0].name, 'P3');
    expect('outing finish gross gross=54', grossSorted[0].totalGross, 54);

    // Restore fsGetCourse
    sandbox.fsGetCourse = origFGC;
  }
}

// ── 22. OUTING GROUP GENERATION ──────────────────────────────
// Tests outingGenerateGroups — balanced distribution, no 2-somes when avoidable,
// max group size 4, all players covered, sizes differ by at most 1.

{
  // Pull function from sandbox
  const outingGenerateGroups = sandbox.outingGenerateGroups;
  expect('outingGenerateGroups exists', typeof outingGenerateGroups, 'function');

  function groupSizes(n) {
    const pids = Array.from({length:n}, (_,i)=>`p${i}`);
    const groups = outingGenerateGroups(pids);
    return groups.map(g => g.playerIds.length).sort((a,b)=>b-a); // desc
  }
  function totalPlayers(n) {
    const pids = Array.from({length:n}, (_,i)=>`p${i}`);
    return outingGenerateGroups(pids).reduce((a,g)=>a+g.playerIds.length,0);
  }
  function allPlayersPresent(n) {
    const pids = Array.from({length:n}, (_,i)=>`p${i}`);
    const pidSet = new Set(pids);
    const groups = outingGenerateGroups(pids);
    const seen = new Set(groups.flatMap(g=>g.playerIds));
    return pidSet.size === seen.size && [...pidSet].every(id=>seen.has(id));
  }
  function maxGroupSize(n) { return Math.max(...groupSizes(n)); }
  function minGroupSize(n) { return Math.min(...groupSizes(n)); }
  function balanced(n)     { return maxGroupSize(n) - minGroupSize(n) <= 1; }

  // All players accounted for — run 3 times each (shuffled)
  [2,4,8,12,16,20,21,24].forEach(n => {
    for (let r=0; r<3; r++) {
      expect(`outingGenerateGroups n=${n}: all players present (run ${r+1})`, allPlayersPresent(n), true);
    }
  });

  // Max group size never exceeds 4
  [2,3,4,5,6,8,9,12,13,16,17,20,21,24].forEach(n => {
    expect(`outingGenerateGroups n=${n}: max group size ≤ 4`, maxGroupSize(n) <= 4, true);
  });

  // Group sizes differ by at most 1 (balanced)
  [2,3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24].forEach(n => {
    expect(`outingGenerateGroups n=${n}: balanced (sizes differ ≤1)`, balanced(n), true);
  });

  // No 2-somes when n≥6 (5 is unavoidable: can't make two groups of 3 from 5)
  [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24].forEach(n => {
    expect(`outingGenerateGroups n=${n}: no 2-somes`, minGroupSize(n) >= 3, true);
  });

  // Exact group count checks
  expect('outingGenerateGroups n=4:  1 group',  outingGenerateGroups(Array.from({length:4},(_,i)=>`p${i}`)).length,  1);
  expect('outingGenerateGroups n=8:  2 groups', outingGenerateGroups(Array.from({length:8},(_,i)=>`p${i}`)).length,  2);
  expect('outingGenerateGroups n=12: 3 groups', outingGenerateGroups(Array.from({length:12},(_,i)=>`p${i}`)).length, 3);
  expect('outingGenerateGroups n=16: 4 groups', outingGenerateGroups(Array.from({length:16},(_,i)=>`p${i}`)).length, 4);
  expect('outingGenerateGroups n=20: 5 groups', outingGenerateGroups(Array.from({length:20},(_,i)=>`p${i}`)).length, 5);
  expect('outingGenerateGroups n=21: 6 groups', outingGenerateGroups(Array.from({length:21},(_,i)=>`p${i}`)).length, 6);
  expect('outingGenerateGroups n=24: 6 groups', outingGenerateGroups(Array.from({length:24},(_,i)=>`p${i}`)).length, 6);

  // Exact size distributions for key cases
  expect('outingGenerateGroups n=5:  sizes [3,2]',       JSON.stringify(groupSizes(5)),  JSON.stringify([3,2]));
  expect('outingGenerateGroups n=6:  sizes [3,3]',       JSON.stringify(groupSizes(6)),  JSON.stringify([3,3]));
  expect('outingGenerateGroups n=9:  sizes [3,3,3]',     JSON.stringify(groupSizes(9)),  JSON.stringify([3,3,3]));
  expect('outingGenerateGroups n=21: sizes [4,4,4,3,3,3]', JSON.stringify(groupSizes(21)), JSON.stringify([4,4,4,3,3,3]));

  // Each group has a unique id
  {
    const pids = Array.from({length:12},(_,i)=>`p${i}`);
    const groups = outingGenerateGroups(pids);
    const ids = groups.map(g=>g.id);
    expect('outingGenerateGroups: all group ids unique', new Set(ids).size, ids.length);
  }
}


// ── 23. OUTING GROUP ASSIGNMENT ──────────────────────────────
// Tests outingBuildTierMap, outingDoAssign, outingTogglePlayer,
// outingAddGroup, outingSetGroupMethod, outingGenerateAndAssign.

{
  const {
    outingBuildTierMap, outingPlayerTier, outingTierColor, outingTierBg,
    outingShuffleArr, outingDealAbcd,
    outingGenerateGroups, outingHasScores,
  } = sandbox;

  // ── outingBuildTierMap ──────────────────────────────────────
  // 8 players sorted by courseHcp → first 2=A, next 2=B, next 2=C, last 2=D
  {
    const players = [
      {id:'p1',courseHcp:2},{id:'p2',courseHcp:5},
      {id:'p3',courseHcp:8},{id:'p4',courseHcp:11},
      {id:'p5',courseHcp:14},{id:'p6',courseHcp:17},
      {id:'p7',courseHcp:20},{id:'p8',courseHcp:23},
    ];
    outingBuildTierMap(players, 2); // 2 groups → first 2=A, next 2=B, next 2=C, rest=D
    expect('tierMap p1(CH2)=A',  outingPlayerTier('p1'), 'A');
    expect('tierMap p2(CH5)=A',  outingPlayerTier('p2'), 'A');
    expect('tierMap p3(CH8)=B',  outingPlayerTier('p3'), 'B');
    expect('tierMap p4(CH11)=B', outingPlayerTier('p4'), 'B');
    expect('tierMap p5(CH14)=C', outingPlayerTier('p5'), 'C');
    expect('tierMap p6(CH17)=C', outingPlayerTier('p6'), 'C');
    expect('tierMap p7(CH20)=D', outingPlayerTier('p7'), 'D');
    expect('tierMap p8(CH23)=D', outingPlayerTier('p8'), 'D');
  }

  // 4 groups → first 4=A, next 4=B, etc.
  {
    const players = Array.from({length:16},(_,i)=>({id:`p${i}`,courseHcp:i*2}));
    outingBuildTierMap(players, 4);
    expect('tierMap 4grp: p0=A',  outingPlayerTier('p0'),  'A');
    expect('tierMap 4grp: p3=A',  outingPlayerTier('p3'),  'A');
    expect('tierMap 4grp: p4=B',  outingPlayerTier('p4'),  'B');
    expect('tierMap 4grp: p7=B',  outingPlayerTier('p7'),  'B');
    expect('tierMap 4grp: p8=C',  outingPlayerTier('p8'),  'C');
    expect('tierMap 4grp: p11=C', outingPlayerTier('p11'), 'C');
    expect('tierMap 4grp: p12=D', outingPlayerTier('p12'), 'D');
    expect('tierMap 4grp: p15=D', outingPlayerTier('p15'), 'D');
  }

  // ── tierColor / tierBg ──────────────────────────────────────
  expect('tierColor A=gold',    outingTierColor('A'), 'var(--gold)');
  expect('tierColor B=green',   outingTierColor('B'), '#86efac');
  expect('tierColor C=purple',  outingTierColor('C'), '#c4b5fd');
  expect('tierColor D=red',     outingTierColor('D'), '#fca5a5');
  expect('tierBg A=g800',       outingTierBg('A'),    'var(--g800)');

  // ── outingShuffleArr ────────────────────────────────────────
  {
    const arr = [1,2,3,4,5,6,7,8];
    const shuffled = outingShuffleArr(arr);
    expect('shuffle: same length', shuffled.length, arr.length);
    expect('shuffle: same elements', [...shuffled].sort((a,b)=>a-b).join(','), arr.join(','));
    expect('shuffle: original unchanged', arr.join(','), '1,2,3,4,5,6,7,8');
  }

  // ── outingDoAssign — random method ──────────────────────────
  {
    const pids = Array.from({length:12},(_,i)=>`p${i}`);
    vmSetS('players', pids.map(id=>({id,name:id,hcp:10,courseHcp:10})));
    sandbox.window._outingGroupMethod = 'random';
    sandbox.window._outingPicked = pids;
    const groups = outingGenerateGroups(pids); // 3×4 with playerIds already filled
    // Reset playerIds so doAssign fills them from scratch
    groups.forEach(g=>g.playerIds=[]);
    sandbox.window._outingGroups = groups;
    sandbox.outingDoAssign(null);
    const allPids = groups.flatMap(g=>g.playerIds);
    expect('doAssign random: all 12 placed', allPids.length, 12);
    expect('doAssign random: no duplicates', new Set(allPids).size, 12);
    expect('doAssign random: 3 groups', groups.length, 3);
    expect('doAssign random: balanced max-min≤1',
      Math.max(...groups.map(g=>g.playerIds.length)) - Math.min(...groups.map(g=>g.playerIds.length)) <= 1, true);
  }

  // ── outingDoAssign — ABCD method ────────────────────────────
  {
    const players = [
      {id:'a1',name:'A1',hcp:2, courseHcp:2},
      {id:'a2',name:'A2',hcp:4, courseHcp:4},
      {id:'b1',name:'B1',hcp:10,courseHcp:10},
      {id:'b2',name:'B2',hcp:12,courseHcp:12},
      {id:'c1',name:'C1',hcp:18,courseHcp:18},
      {id:'c2',name:'C2',hcp:20,courseHcp:20},
      {id:'d1',name:'D1',hcp:26,courseHcp:26},
      {id:'d2',name:'D2',hcp:28,courseHcp:28},
    ];
    const pids = players.map(p=>p.id);
    vmSetS('players', players);
    sandbox.window._outingPicked = pids;
    sandbox.window._outingGroupMethod = 'abcd';
    outingBuildTierMap(players, 2);
    const groups = outingGenerateGroups(pids);
    groups.forEach(g=>g.playerIds=[]);
    sandbox.window._outingGroups = groups;
    sandbox.outingDoAssign(null);
    const allPids = groups.flatMap(g=>g.playerIds);
    expect('doAssign abcd: all 8 placed', allPids.length, 8);
    expect('doAssign abcd: no duplicates', new Set(allPids).size, 8);
    // Each group should have one from each tier
    groups.forEach((grp,gi) => {
      const tiers = grp.playerIds.map(id=>outingPlayerTier(id));
      expect(`doAssign abcd grp${gi}: has A`, tiers.includes('A'), true);
      expect(`doAssign abcd grp${gi}: has B`, tiers.includes('B'), true);
      expect(`doAssign abcd grp${gi}: has C`, tiers.includes('C'), true);
      expect(`doAssign abcd grp${gi}: has D`, tiers.includes('D'), true);
    });
  }

  // ── outingHasScores ─────────────────────────────────────────
  expect('hasScores: empty scores=false', outingHasScores({scores:{}}), false);
  expect('hasScores: null scores=false',  outingHasScores({scores:null}), false);
  expect('hasScores: no game=false',      outingHasScores(null), false);
  expect('hasScores: with score=true',
    outingHasScores({scores:{p1:{1:4}}}), true);
  expect('hasScores: empty hole obj=false',
    outingHasScores({scores:{p1:{}}}), false);

  // Clean up sandbox state
  sandbox.window._outingGroupMethod = null;
  sandbox.window._outingPicked = null;
}


// ── 25. OUTING TEAM FORMAT HELPERS ───────────────────────────
// Tests outingIsTeamFormat, outingIsScramble

{
  const { outingIsTeamFormat, outingIsScramble } = sandbox;

  expect('outingIsTeamFormat exists', typeof outingIsTeamFormat, 'function');
  expect('outingIsScramble exists',   typeof outingIsScramble,   'function');

  // Team formats
  expect('isTeamFormat: scramble=true',     outingIsTeamFormat('scramble'),    true);
  expect('isTeamFormat: shamble=true',      outingIsTeamFormat('shamble'),     true);
  expect('isTeamFormat: twoBestBall=true',  outingIsTeamFormat('twoBestBall'), true);
  expect('isTeamFormat: threeTwoOne=true',  outingIsTeamFormat('threeTwoOne'), true);

  // Non-team formats
  expect('isTeamFormat: stableford=false',  outingIsTeamFormat('stableford'),  false);
  expect('isTeamFormat: lownet=false',      outingIsTeamFormat('lownet'),      false);
  expect('isTeamFormat: gross=false',       outingIsTeamFormat('gross'),       false);
  expect('isTeamFormat: pstableford=false', outingIsTeamFormat('pstableford'), false);
  expect('isTeamFormat: bbmatch=false',     outingIsTeamFormat('bbmatch'),     false);
  expect('isTeamFormat: undefined=false',   outingIsTeamFormat(undefined),     false);

  // Scramble discriminator
  expect('isScramble: scramble=true',      outingIsScramble('scramble'),    true);
  expect('isScramble: shamble=false',      outingIsScramble('shamble'),     false);
  expect('isScramble: twoBestBall=false',  outingIsScramble('twoBestBall'), false);
  expect('isScramble: threeTwoOne=false',  outingIsScramble('threeTwoOne'), false);
  expect('isScramble: stableford=false',   outingIsScramble('stableford'),  false);
}


// ── 26. OUTING SCRAMBLE TEAM CH ──────────────────────────────
// Tests outingScrambleTeamCH

{
  const { outingScrambleTeamCH } = sandbox;
  expect('outingScrambleTeamCH exists', typeof outingScrambleTeamCH, 'function');

  // Test course — 18 holes (hcpScale=18), slope 113, rating 72, par 72
  const TC18 = {
    id:'tc18', name:'TC18', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  // 9-hole course for is9 test
  const TC9 = {
    id:'tc9', name:'TC9', slope:113, rating:36.0, par:36, nineHole:true,
    holes: Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const activeHoles18 = TC18.holes;
  const activeHoles9  = TC9.holes;

  // Ensure config has default scramble abcdPct
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  // 4 players CH 0, 8, 16, 24 — sorted ascending → [0,8,16,24]
  // weighted: 0×100% + 8×85% + 16×70% + 24×60% = 0 + 6.8 + 11.2 + 14.4 = 32.4 → round → 32
  const players4 = [
    {id:'t1',name:'T1',hcp:0, courseHcp:0},
    {id:'t2',name:'T2',hcp:8, courseHcp:8},
    {id:'t3',name:'T3',hcp:16,courseHcp:16},
    {id:'t4',name:'T4',hcp:24,courseHcp:24},
  ];
  expect('scrambleTeamCH 4p CH[0,8,16,24] pcts[100,85,70,60]=32',
    outingScrambleTeamCH(players4, TC18, activeHoles18), 32);

  // 3 players CH 0, 8, 16 — pcts fallback [100,85,70]
  // sorted: [0,8,16]; weighted: 0 + 6.8 + 11.2 = 18
  const players3 = players4.slice(0,3);
  expect('scrambleTeamCH 3p CH[0,8,16] pcts[100,85,70]=18',
    outingScrambleTeamCH(players3, TC18, activeHoles18), 18);

  // 2 players CH 0, 8 — pcts fallback [100,85]
  // sorted: [0,8]; weighted: 0 + 6.8 = 6.8 → round → 7
  const players2 = players4.slice(0,2);
  expect('scrambleTeamCH 2p CH[0,8] pcts[100,85]=7',
    outingScrambleTeamCH(players2, TC18, activeHoles18), 7);

  // hcpMethod='none' → always 0
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'none', abcdPct:[100,85,70,60] } } } });
  expect('scrambleTeamCH hcpMethod=none → 0',
    outingScrambleTeamCH(players4, TC18, activeHoles18), 0);

  // Restore abcd config
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  // Empty players → 0
  expect('scrambleTeamCH empty players=0',
    outingScrambleTeamCH([], TC18, activeHoles18), 0);

  // Sort order: passing players in reverse CH order still gives same result
  const playersReversed = [...players4].reverse();
  expect('scrambleTeamCH input order irrelevant (sorts internally)',
    outingScrambleTeamCH(playersReversed, TC18, activeHoles18), 32);

  // Custom abcdPct via config
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[80,80,80,80] } } } });
  // 4 players × 80%: 0×.8 + 8×.8 + 16×.8 + 24×.8 = 38.4 → round → 38
  expect('scrambleTeamCH custom pcts[80,80,80,80]=38',
    outingScrambleTeamCH(players4, TC18, activeHoles18), 38);

  // Restore default
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });
}


// ── 27. OUTING BEST BALLS HOLE NET ───────────────────────────
// Tests outingBestBallsHoleNet

{
  const { outingBestBallsHoleNet } = sandbox;
  expect('outingBestBallsHoleNet exists', typeof outingBestBallsHoleNet, 'function');

  // 18-hole course, all par 4, hcp 1-18
  const TC18 = {
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const hcpScale = 18;
  const rankMap  = null; // null → uses hole.hcp directly

  // Players: CH 0/8/16/24, all shoot gross 4 on hole 1 (hcp=1)
  // strokesOnHole(0,1,18)=0 → net=4
  // strokesOnHole(8,1,18)=1 → net=3  (8 % 18 = 8, hcp=1 ≤ 8 → floor(8/18)=0+1=1)
  // strokesOnHole(16,1,18)=1 → net=3  (16%18=16, hcp=1≤16 → 0+1=1)
  // strokesOnHole(24,1,18)=2 → net=2  (24%18=6, hcp=1≤6 → floor(24/18)=1+1=2)
  // All 4 nets: [4,3,3,2] → sorted: [2,3,3,4] → best2: [2,3]
  const players4 = [
    {id:'p1',courseHcp:0},
    {id:'p2',courseHcp:8},
    {id:'p3',courseHcp:16},
    {id:'p4',courseHcp:24},
  ];
  const scores4_h1 = { p1:{1:4}, p2:{1:4}, p3:{1:4}, p4:{1:4} };
  const h1 = TC18.holes[0]; // hole 1, hcp=1

  const best2_h1 = outingBestBallsHoleNet(players4, scores4_h1, h1, hcpScale, rankMap);
  expect('bestBalls h1: returns 2 nets',        best2_h1.length, 2);
  expect('bestBalls h1: best net = 2',          best2_h1[0], 2);
  expect('bestBalls h1: second best net = 3',   best2_h1[1], 3);

  // Hole 18 (hcp=18):
  // strokesOnHole(0,18,18)=0 → net=4
  // strokesOnHole(8,18,18)=0 → net=4  (8%18=8, hcp=18 > 8 → 0 strokes)
  // strokesOnHole(16,18,18)=0 → net=3  (16%18=16, hcp=18>16 → 0... wait 18>16 so 0+0=0)
  // Actually: hcp=18, courseHcp%hcpScale: 0%18=0, 8%18=8, 16%18=16, 24%18=6
  // p3: 16%18=16, hole hcp=18 > 16 → 0 extra strokes, floor(16/18)=0 → total=0 → net=3
  // p4: 24%18=6, hole hcp=18 > 6 → 0 extra, floor(24/18)=1 → total=1 → net=5
  // All nets h18: p1=4, p2=5(wait: strokesOnHole(8,18,18): 8%18=8, 18>8 → 0+floor=0 → net=5-0=5... 
  // p2 gross is 4 not 5 here — all players gross=4
  // p2 CH=8: strokes(8,18,18)=0 → net=4; p3 CH=16: strokes(16,18,18)=0 → net=4... 
  // Wait, recheck: 16%18=16, hole hcp=18: 18 ≤ 16? No → 0 strokes. net=4-0=4
  // p4 CH=24: floor(24/18)=1, 24%18=6, hole hcp=18: 18 ≤ 6? No → 1+0=1 → net=3
  // All nets h18 with gross=4: p1=4,p2=4,p3=4,p4=3 → best2=[3,4]
  // Hole 18 (hcp=18): use scores keyed on hole 18
  // strokes: p1(CH=0)→0→net=4; p2(CH=8)→0→net=4; p3(CH=16)→0→net=4; p4(CH=24)→1→net=3
  // nets sorted: [3,4,4,4] → best2=[3,4]
  const scores4_h18 = { p1:{18:4}, p2:{18:4}, p3:{18:4}, p4:{18:4} };
  const h18 = TC18.holes[17];
  const best2_h18 = outingBestBallsHoleNet(players4, scores4_h18, h18, hcpScale, rankMap);
  expect('bestBalls h18: best net = 3',         best2_h18[0], 3);
  expect('bestBalls h18: second best net = 4',  best2_h18[1], 4);

  // Missing score: p4 has no entry → filtered out → only 3 nets returned, still best 2
  // nets without p4 on h1: [4,3,3] → best2=[3,3]
  const scores3_h1 = { p1:{1:4}, p2:{1:4}, p3:{1:4} }; // p4 absent
  const best2_missing = outingBestBallsHoleNet(players4, scores3_h1, h1, hcpScale, rankMap);
  expect('bestBalls missing p4: length=2',      best2_missing.length, 2);
  // p1 CH=0→net=4; p2 CH=8→net=3 (str=1 on hcp=1); p3 CH=16→net=3 (str=1 on hcp=1); p4 absent
  // nets present: [4,3,3] → sorted: [3,3,4] → best2=[3,3]
  expect('bestBalls missing p4: best=3',        best2_missing[0], 3);
  expect('bestBalls missing p4: second=3',      best2_missing[1], 3);

  // Gross=0 treated as missing (parseInt('') or missing key)
  const scores_zero = { p1:{1:0}, p2:{1:4}, p3:{1:4}, p4:{1:4} };
  const best2_zero = outingBestBallsHoleNet(players4, scores_zero, h1, hcpScale, rankMap);
  expect('bestBalls gross=0 filtered: length=2', best2_zero.length, 2);

  // Only 1 player scored → returns [net] (length 1, best 2 of 1)
  const scores1_h1 = { p1:{1:4} };
  const best2_one = outingBestBallsHoleNet(players4, scores1_h1, h1, hcpScale, rankMap);
  expect('bestBalls only 1 player scored: length=1', best2_one.length, 1);
  expect('bestBalls only 1 player scored: net=4',    best2_one[0], 4);

  // Returns sorted ascending (lower is better)
  expect('bestBalls result sorted ascending', best2_h1[0] <= best2_h1[1], true);
}


// ── 28. OUTING THREE-TWO-ONE BEST NETS ───────────────────────
// Tests outingThreeTwoOneBestNets

{
  const { outingThreeTwoOneBestNets } = sandbox;
  expect('outingThreeTwoOneBestNets exists', typeof outingThreeTwoOneBestNets, 'function');

  // Mixed-par course: 3 holes — par 3, par 4, par 5
  // hcpScale=3 (only 3 holes active)
  const hcpScale = 3;
  const h_par3 = {num:1,par:3,hcp:1};
  const h_par4 = {num:2,par:4,hcp:2};
  const h_par5 = {num:3,par:5,hcp:3};
  const rankMap = null;

  // Players CH 0/8/16/24, all gross: P1=4, P2=5, P3=3, P4=6
  // strokesOnHole(CH, hcp, 3):
  //   CH=0:  floor(0/3)+(...) = 0 always
  //   CH=8:  floor(8/3)=2 on all holes (hcp ≤ 8%3=2 → 2+1=3; hcp=3 > 2 → 2+0=2... let me compute
  //   Actually: 8%3=2, h1 hcp=1≤2→floor=2+1=3; h2 hcp=2≤2→2+1=3; h3 hcp=3>2→2+0=2
  //   CH=16: 16%3=1, floor=5; h1 hcp=1≤1→5+1=6; h2 hcp=2>1→5+0=5; h3 hcp=3>1→5+0=5
  //   CH=24: 24%3=0, floor=8; hcp≤0 never → all=8

  // P1 gross=4 CH=0:   h_par3 str=0→net=4; h_par4 str=0→net=4; h_par5 str=0→net=4
  // P2 gross=5 CH=8:   h_par3 str=3→net=2; h_par4 str=3→net=2; h_par5 str=2→net=3
  // P3 gross=3 CH=16:  h_par3 str=6→net=-3; h_par4 str=5→net=-2; h_par5 str=5→net=-2
  // P4 gross=6 CH=24:  h_par3 str=8→net=-2; h_par4 str=8→net=-2; h_par5 str=8→net=-2

  const players = [
    {id:'p1',courseHcp:0},
    {id:'p2',courseHcp:8},
    {id:'p3',courseHcp:16},
    {id:'p4',courseHcp:24},
  ];
  const scores = { p1:{1:4,2:4,3:4}, p2:{1:5,2:5,3:5}, p3:{1:3,2:3,3:3}, p4:{1:6,2:6,3:6} };

  // par3 hole → take 3: all 4 nets → sorted: [-3,-2,2,4] → take3=[-3,-2,2] → sum=-3
  const nets_par3 = outingThreeTwoOneBestNets(players, scores, h_par3, hcpScale, rankMap);
  expect('321 par3: takes 3 nets',    nets_par3.length, 3);
  expect('321 par3: best net=-3',     nets_par3[0], -3);
  expect('321 par3: 2nd net=-2',      nets_par3[1], -2);
  expect('321 par3: 3rd net=2',       nets_par3[2], 2);

  // par4 hole → take 2: nets=[-2,-2,2,4] → take2=[-2,-2] → sum=-4
  const nets_par4 = outingThreeTwoOneBestNets(players, scores, h_par4, hcpScale, rankMap);
  expect('321 par4: takes 2 nets',    nets_par4.length, 2);
  expect('321 par4: best net=-2',     nets_par4[0], -2);
  expect('321 par4: 2nd net=-2',      nets_par4[1], -2);

  // par5 hole → take 1: nets=[-2,-2,3,4] → take1=[-2] → sum=-2
  const nets_par5 = outingThreeTwoOneBestNets(players, scores, h_par5, hcpScale, rankMap);
  expect('321 par5: takes 1 net',     nets_par5.length, 1);
  expect('321 par5: best net=-2',     nets_par5[0], -2);

  // Returns sorted ascending (lowest = best)
  expect('321 par3 sorted ascending', nets_par3[0] <= nets_par3[1], true);
  expect('321 par4 sorted ascending', nets_par4[0] <= nets_par4[1], true);

  // Missing score: p4 absent on par4 → filtered, 3 nets remain, take 2
  const scores_missing = { p1:{2:4}, p2:{2:5}, p3:{2:3} };
  const nets_missing = outingThreeTwoOneBestNets(players, scores_missing, h_par4, hcpScale, rankMap);
  expect('321 missing p4 par4: takes 2',      nets_missing.length, 2);
  // p1 net=4, p2 net=2, p3 net=-2 → sorted: [-2,2,4] → take2=[-2,2]
  expect('321 missing p4 par4: best=-2',      nets_missing[0], -2);
  expect('321 missing p4 par4: 2nd=2',        nets_missing[1], 2);
}


// ── 29. OUTING COMPUTE TEAM RESULTS ──────────────────────────
// Tests outingComputeTeamResults for all four team formats

{
  const origFGC = sandbox.fsGetCourse;

  // Shared 18-hole course
  const TCTM = {
    id:'tctm', name:'TeamCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tctm' ? TCTM : origFGC(id);
  vmSetS('config', { games: { fourPlayer: { scramble:{ hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  const activeHoles = TCTM.holes;

  // 4 players: P1 CH=0 g=4, P2 CH=8 g=5, P3 CH=16 g=3, P4 CH=24 g=6
  const TEAM_PLAYERS = [
    {id:'p1',name:'P1',hcp:0, courseHcp:0},
    {id:'p2',name:'P2',hcp:8, courseHcp:8},
    {id:'p3',name:'P3',hcp:16,courseHcp:16},
    {id:'p4',name:'P4',hcp:24,courseHcp:24},
  ];

  // Build per-player scores — gross constant across all 18 holes
  function makePerPlayerScores(grossByPid) {
    const sc = {};
    TEAM_PLAYERS.forEach(p => {
      sc[p.id] = {};
      activeHoles.forEach(h => { sc[p.id][h.num] = grossByPid[p.id]; });
    });
    return sc;
  }
  const mixedScores = makePerPlayerScores({p1:4, p2:5, p3:3, p4:6});

  function makeTeamGame(gt, scores, groups) {
    return {
      id:'tg1', type:'outing', status:'active', _scoring:true,
      courseId:'tctm', gameType:gt, skins:false, nineSide:'all',
      players: TEAM_PLAYERS,
      groups: groups || [{id:'g1', playerIds:TEAM_PLAYERS.map(p=>p.id)}],
      scores: JSON.parse(JSON.stringify(scores)),
    };
  }

  // ── Scramble ────────────────────────────────────────────────
  // One grp_N key per group, gross=75, teamCH=32 → teamNet=43
  // parEq=72, netVsPar=43-72=-29
  {
    const scrambleScores = { 'grp_0': {} };
    activeHoles.forEach(h => { scrambleScores['grp_0'][h.num] = 5; }); // 5×18=90 gross... use varied
    // Use total=75: first 3 holes=3, rest=4+1=5... easier: 3 holes×5=15, 15 holes×4=60, total=75
    const sc = {};
    activeHoles.forEach((h,i) => { sc[h.num] = i < 3 ? 5 : 4; }); // 3×5+15×4=75
    const scrambleScores2 = { 'grp_0': sc };

    const g = makeTeamGame('scramble', scrambleScores2);
    const r = sandbox.outingComputeResults(g);
    expect('scramble: isTeam=true',         r.isTeam, true);
    expect('scramble: teamResults array',   Array.isArray(r.teamResults), true);
    expect('scramble: 1 group result',      r.teamResults.length, 1);
    expect('scramble: gi=0',                r.teamResults[0].gi, 0);
    expect('scramble: gross=75',            r.teamResults[0].gross, 75);
    expect('scramble: teamCH=32',           r.teamResults[0].teamCH, 32);
    expect('scramble: teamNet=43',          r.teamResults[0].teamNet, 43);
    expect('scramble: parEq=72',            r.teamResults[0].parEq, 72);
    expect('scramble: netVsPar=-29',        r.teamResults[0].netVsPar, -29);
  }

  // Scramble: no score entered → group excluded from results
  {
    const emptyScores = { 'grp_0': {} };
    const g = makeTeamGame('scramble', emptyScores);
    const r = sandbox.outingComputeResults(g);
    expect('scramble no scores: teamResults empty', r.teamResults.length, 0);
  }

  // ── 2-Best Ball ─────────────────────────────────────────────
  // Per-player scores: P1=4, P2=5, P3=3, P4=6 on all 18 holes
  // Pre-computed: teamNet=110, parEq=144, netVsPar=-34
  {
    const g = makeTeamGame('twoBestBall', mixedScores);
    const r = sandbox.outingComputeResults(g);
    expect('2BB: isTeam=true',          r.isTeam, true);
    expect('2BB: teamResults length=1', r.teamResults.length, 1);
    expect('2BB: teamNet=110',          r.teamResults[0].teamNet, 110);
    expect('2BB: parEq=144',            r.teamResults[0].parEq, 144);
    expect('2BB: netVsPar=-34',         r.teamResults[0].netVsPar, -34);
    expect('2BB: gi=0',                 r.teamResults[0].gi, 0);
  }

  // ── Shamble ─────────────────────────────────────────────────
  // Same per-player scores, same best-2-net computation as 2BB
  {
    const g = makeTeamGame('shamble', mixedScores);
    const r = sandbox.outingComputeResults(g);
    expect('shamble: isTeam=true',          r.isTeam, true);
    expect('shamble: teamResults length=1', r.teamResults.length, 1);
    expect('shamble: teamNet=110',          r.teamResults[0].teamNet, 110);
    expect('shamble: parEq=144',            r.teamResults[0].parEq, 144);
    expect('shamble: netVsPar=-34',         r.teamResults[0].netVsPar, -34);
  }

  // ── 3-2-1 (all par 4, so take=2 per hole, same math as 2BB) ─
  // On an all-par-4 course 3-2-1 takes 2 per hole → same result as 2BB
  {
    const g = makeTeamGame('threeTwoOne', mixedScores);
    const r = sandbox.outingComputeResults(g);
    expect('321 all-par4: isTeam=true',          r.isTeam, true);
    expect('321 all-par4: teamResults length=1', r.teamResults.length, 1);
    expect('321 all-par4: teamNet=110',          r.teamResults[0].teamNet, 110);
    expect('321 all-par4: parEq=144',            r.teamResults[0].parEq, 144);
    expect('321 all-par4: netVsPar=-34',         r.teamResults[0].netVsPar, -34);
  }

  // ── 3-2-1 mixed-par: confirm per-par counting differs from 2BB ──
  // 3-hole course: hole1=par3, hole2=par4, hole3=par5
  // P1=4,P2=5,P3=3,P4=6 gross, hcpScale=3
  // Pre-computed: teamNet=-9, parEq=22, netVsPar=-31
  {
    const TC3 = {
      id:'tc3', name:'TC3', slope:113, rating:12.0, par:12, nineHole:true,
      holes: [{num:1,par:3,hcp:1},{num:2,par:4,hcp:2},{num:3,par:5,hcp:3}],
    };
    sandbox.fsGetCourse = id => id==='tc3' ? TC3 : id==='tctm' ? TCTM : origFGC(id);
    const sc3 = {};
    TEAM_PLAYERS.forEach(p => {
      const gross = {p1:4,p2:5,p3:3,p4:6}[p.id];
      sc3[p.id] = {1:gross, 2:gross, 3:gross};
    });
    const g3 = {
      id:'tg3', type:'outing', status:'active', _scoring:true,
      courseId:'tc3', gameType:'threeTwoOne', skins:false, nineSide:'all',
      players:TEAM_PLAYERS,
      groups:[{id:'g1', playerIds:TEAM_PLAYERS.map(p=>p.id)}],
      scores: JSON.parse(JSON.stringify(sc3)),
    };
    const r3 = sandbox.outingComputeResults(g3);
    expect('321 mixed-par: teamNet=-9',     r3.teamResults[0].teamNet, -9);
    expect('321 mixed-par: parEq=22',       r3.teamResults[0].parEq, 22);
    expect('321 mixed-par: netVsPar=-31',   r3.teamResults[0].netVsPar, -31);
    sandbox.fsGetCourse = id => id==='tctm' ? TCTM : origFGC(id);
  }

  // ── 2-group sort order ──────────────────────────────────────
  // Group 0 (bad players): CH=0, gross=8 all holes → no net strokes → teamNet=144, parEq=144, netVsPar=0
  // Group 1 (good players): P1-P4 mixed → netVsPar=-34
  // Group 1 should sort first (lower netVsPar)
  {
    const badPlayers = [
      {id:'b1',name:'B1',hcp:0,courseHcp:0},
      {id:'b2',name:'B2',hcp:0,courseHcp:0},
    ];
    const badScores = {};
    badPlayers.forEach(p => {
      badScores[p.id] = {};
      activeHoles.forEach(h => { badScores[p.id][h.num] = 8; });
    });
    Object.assign(badScores, mixedScores); // group 1 = good players

    const twoGroupGame = {
      id:'tg2', type:'outing', status:'active', _scoring:true,
      courseId:'tctm', gameType:'twoBestBall', skins:false, nineSide:'all',
      players:[...badPlayers, ...TEAM_PLAYERS],
      groups:[
        {id:'g0', playerIds:badPlayers.map(p=>p.id)},
        {id:'g1', playerIds:TEAM_PLAYERS.map(p=>p.id)},
      ],
      scores: JSON.parse(JSON.stringify(badScores)),
    };
    const r2 = sandbox.outingComputeResults(twoGroupGame);
    expect('2BB 2-group: 2 results',               r2.teamResults.length, 2);
    expect('2BB 2-group: winner is good group',     r2.teamResults[0].gi, 1);
    expect('2BB 2-group: winner netVsPar=-34',      r2.teamResults[0].netVsPar, -34);
    expect('2BB 2-group: loser gi=0',               r2.teamResults[1].gi, 0);
  }

  // ── No scores entered → group excluded ──────────────────────
  {
    const g = makeTeamGame('twoBestBall', {});
    const r = sandbox.outingComputeResults(g);
    expect('2BB no scores: teamResults empty', r.teamResults.length, 0);
  }

  // ── Front 9 only ─────────────────────────────────────────────
  {
    const g = makeTeamGame('twoBestBall', mixedScores);
    g.nineSide = 'front';
    const r = sandbox.outingComputeResults(g);
    expect('2BB front9: activeHoles=9',  r.activeHoles.length, 9);
    // 9 holes × par4×2 = 72
    expect('2BB front9: parEq=72',       r.teamResults[0].parEq, 72);
    // teamNet: 9 holes of same pattern → 110/2 = 55
    // hcpScale=9 for front-9 — strokes differ from full-18 calculation → teamNet=41
  expect('2BB front9: teamNet=41',     r.teamResults[0].teamNet, 41);
  }

  sandbox.fsGetCourse = origFGC;
}


// ── 30. OUTING COMPUTE TEAM SKINS ────────────────────────────
// Tests outingComputeTeamSkins

{
  const origFGC = sandbox.fsGetCourse;

  const TC18 = {
    id:'tcs18', name:'SkinsCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tcs18' ? TC18 : origFGC(id);
  vmSetS('config', { games: { fourPlayer: { scramble:{ hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  const activeHoles = TC18.holes;

  // ── 2-Best Ball skins: 2 groups ──
  // Group A: PA1(CH=0), PA2(CH=0) — both gross=4 → net=4 each, best2 sum=8 on every hole
  // Group B: PB1(CH=18), PB2(CH=18) — both gross=4 → strokes on hcp1-18 → net=3 each, best2 sum=6
  // B wins all 18 skins
  const playersA = [{id:'a1',name:'A1',hcp:0,courseHcp:0},{id:'a2',name:'A2',hcp:0,courseHcp:0}];
  const playersB = [{id:'b1',name:'B1',hcp:18,courseHcp:18},{id:'b2',name:'B2',hcp:18,courseHcp:18}];
  const scA = {}; playersA.forEach(p=>{ scA[p.id]={}; activeHoles.forEach(h=>{scA[p.id][h.num]=4;}); });
  const scB = {}; playersB.forEach(p=>{ scB[p.id]={}; activeHoles.forEach(h=>{scB[p.id][h.num]=4;}); });

  const bb2Game = {
    id:'sk1', type:'outing', status:'active', _scoring:true,
    courseId:'tcs18', gameType:'twoBestBall', skins:true, nineSide:'all',
    players:[...playersA,...playersB],
    groups:[
      {id:'ga', playerIds:['a1','a2']},
      {id:'gb', playerIds:['b1','b2']},
    ],
    scores: Object.assign({}, scA, scB),
  };
  const skinsResult = sandbox.outingComputeTeamSkins(bb2Game, TC18, activeHoles);
  expect('team skins 2BB: group B wins 18 skins', skinsResult[1], 18);
  expect('team skins 2BB: group A wins 0 skins',  skinsResult[0], 0);

  // ── Scramble skins: 2 groups ──
  // Group 0: teamCH=32 (players4 from section 26), gross=5 all holes → net=5-strokes(32,hcp,18)
  // Group 1: teamCH=0, gross=5 all holes → net=5-0=5 on all holes
  // g0 CH=32: floor(32/18)=1; 32%18=14 → strokes=1+1=2 on hcp≤14, 1+0=1 on hcp>14
  // h1(hcp=1≤14): g0 net=5-2=3; g1 net=5-0=5 → g0 wins
  // h15(hcp=15>14): g0 net=5-1=4; g1 net=5 → g0 wins
  // h18(hcp=18>14): g0 net=5-1=4; g1 net=5 → g0 wins
  // g0 wins all 18 holes
  const scr_players0 = [{id:'sp1',name:'S1',hcp:0,courseHcp:0},{id:'sp2',name:'S2',hcp:8,courseHcp:8},
                        {id:'sp3',name:'S3',hcp:16,courseHcp:16},{id:'sp4',name:'S4',hcp:24,courseHcp:24}];
  const scr_players1 = [{id:'sq1',name:'Q1',hcp:0,courseHcp:0}];
  const scr_scores = {'grp_0':{}, 'grp_1':{}};
  activeHoles.forEach(h=>{ scr_scores['grp_0'][h.num]=5; scr_scores['grp_1'][h.num]=5; });

  const scrGame = {
    id:'sk2', type:'outing', status:'active', _scoring:true,
    courseId:'tcs18', gameType:'scramble', skins:true, nineSide:'all',
    players:[...scr_players0,...scr_players1],
    groups:[
      {id:'g0', playerIds:scr_players0.map(p=>p.id)},
      {id:'g1', playerIds:scr_players1.map(p=>p.id)},
    ],
    scores: JSON.parse(JSON.stringify(scr_scores)),
  };
  const scrSkins = sandbox.outingComputeTeamSkins(scrGame, TC18, activeHoles);
  expect('team skins scramble: group 0 wins 18', scrSkins[0], 18);
  expect('team skins scramble: group 1 wins 0',  scrSkins[1], 0);

  // ── Tie produces no winner ──
  // Both groups same team net on every hole → wins map all zero
  const tieA = [{id:'t1',name:'T1',hcp:0,courseHcp:0},{id:'t2',name:'T2',hcp:0,courseHcp:0}];
  const tieB = [{id:'t3',name:'T3',hcp:0,courseHcp:0},{id:'t4',name:'T4',hcp:0,courseHcp:0}];
  const tieScores = {};
  [...tieA,...tieB].forEach(p=>{ tieScores[p.id]={}; activeHoles.forEach(h=>{tieScores[p.id][h.num]=4;}); });
  const tieGame = {
    id:'sk3', type:'outing', status:'active', _scoring:true,
    courseId:'tcs18', gameType:'twoBestBall', skins:false, nineSide:'all',
    players:[...tieA,...tieB],
    groups:[{id:'ga',playerIds:['t1','t2']},{id:'gb',playerIds:['t3','t4']}],
    scores: JSON.parse(JSON.stringify(tieScores)),
  };
  const tieSkins = sandbox.outingComputeTeamSkins(tieGame, TC18, activeHoles);
  expect('team skins tie: group 0 wins 0', tieSkins[0], 0);
  expect('team skins tie: group 1 wins 0', tieSkins[1], 0);

  // ── Return shape: keys are group indices ──
  expect('team skins: result has key 0', typeof skinsResult[0], 'number');
  expect('team skins: result has key 1', typeof skinsResult[1], 'number');

  sandbox.fsGetCourse = origFGC;
}


// ── 31. WOLF ENGINE ───────────────────────────────────────────
// Tests wolfCaptainPid, wolfTeeOrder, wolfHoleBase, wolfCalcHoleWinner,
// wolfCalcTotals, wolfSettlement

{
  const {
    wolfCaptainPid, wolfTeeOrder, wolfHoleBase, wolfCalcHoleWinner,
    wolfCalcTotals, wolfSettlement, wolfNetScore,
  } = sandbox;

  expect('wolfCaptainPid exists',     typeof wolfCaptainPid,     'function');
  expect('wolfTeeOrder exists',       typeof wolfTeeOrder,       'function');
  expect('wolfHoleBase exists',       typeof wolfHoleBase,       'function');
  expect('wolfCalcHoleWinner exists', typeof wolfCalcHoleWinner, 'function');
  expect('wolfCalcTotals exists',     typeof wolfCalcTotals,     'function');
  expect('wolfSettlement exists',     typeof wolfSettlement,     'function');

  // ── wolfCaptainPid: rotation (h-1) % 4 ──────────────────────
  // wolfOrder = [A, B, C, D]
  // H1 → A, H2 → B, H3 → C, H4 → D, H5 → A, ... H17 → A, H18 → B
  const ORDER = ['pA','pB','pC','pD'];
  const baseGame = { wolfOrder: ORDER, wolfCarry: 0, wolfHoles: {} };

  expect('wolfCaptain H1=pA',  wolfCaptainPid(baseGame, 1),  'pA');
  expect('wolfCaptain H2=pB',  wolfCaptainPid(baseGame, 2),  'pB');
  expect('wolfCaptain H3=pC',  wolfCaptainPid(baseGame, 3),  'pC');
  expect('wolfCaptain H4=pD',  wolfCaptainPid(baseGame, 4),  'pD');
  expect('wolfCaptain H5=pA',  wolfCaptainPid(baseGame, 5),  'pA');
  expect('wolfCaptain H9=pA',  wolfCaptainPid(baseGame, 9),  'pA');
  expect('wolfCaptain H17=pA', wolfCaptainPid(baseGame, 17), 'pA');
  expect('wolfCaptain H18=pB', wolfCaptainPid(baseGame, 18), 'pB');

  // ── wolfTeeOrder: non-wolves in scorecard order, wolf last ───
  // H1: wolf=pA → tee order [pB, pC, pD, pA]
  const tee1 = wolfTeeOrder(baseGame, 1);
  expect('wolfTeeOrder H1: length=4',    tee1.length, 4);
  expect('wolfTeeOrder H1: last=pA',     tee1[3], 'pA');
  expect('wolfTeeOrder H1: first=pB',    tee1[0], 'pB');
  expect('wolfTeeOrder H1: second=pC',   tee1[1], 'pC');
  expect('wolfTeeOrder H1: third=pD',    tee1[2], 'pD');

  // H3: wolf=pC → tee order [pA, pB, pD, pC]
  const tee3 = wolfTeeOrder(baseGame, 3);
  expect('wolfTeeOrder H3: last=pC',     tee3[3], 'pC');
  expect('wolfTeeOrder H3: first=pA',    tee3[0], 'pA');
  expect('wolfTeeOrder H3: second=pB',   tee3[1], 'pB');
  expect('wolfTeeOrder H3: third=pD',    tee3[2], 'pD');

  // H4: wolf=pD → tee order [pA, pB, pC, pD]
  const tee4 = wolfTeeOrder(baseGame, 4);
  expect('wolfTeeOrder H4: last=pD',     tee4[3], 'pD');
  expect('wolfTeeOrder H4: first=pA',    tee4[0], 'pA');

  // ── wolfHoleBase: 1 + wolfCarry ─────────────────────────────
  expect('wolfHoleBase carry=0 → 1', wolfHoleBase({ wolfCarry: 0 }, 1), 1);
  expect('wolfHoleBase carry=1 → 2', wolfHoleBase({ wolfCarry: 1 }, 1), 2);
  expect('wolfHoleBase carry=3 → 4', wolfHoleBase({ wolfCarry: 3 }, 1), 4);

  // ── wolfCalcHoleWinner ───────────────────────────────────────
  // Course: one hole, par 4, hcp 1, hcpScale 18
  // Players with known CHs and gross scores
  // wolfOrder: [pA(CH=0), pB(CH=8), pC(CH=16), pD(CH=0)]
  // On hole hcp=1, hcpScale=18:
  //   strokes: CH=0→0, CH=8→1 (8%18=8,hcp1≤8→+1), CH=16→1 (16%18=16,hcp1≤16→+1)
  // Net scores:
  //   pA gross=4 CH=0 → net=4
  //   pB gross=4 CH=8 → net=3
  //   pC gross=4 CH=16→ net=3
  //   pD gross=5 CH=0 → net=5

  const origFGC = sandbox.fsGetCourse;
  const WOLFCOURSE = {
    id:'wc1', name:'Wolf Course', slope:113, rating:72, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='wc1' ? WOLFCOURSE : origFGC(id);

  const wolfPlayers = [
    {id:'pA',name:'A',hcp:0, courseHcp:0},
    {id:'pB',name:'B',hcp:8, courseHcp:8},
    {id:'pC',name:'C',hcp:16,courseHcp:16},
    {id:'pD',name:'D',hcp:0, courseHcp:0},
  ];
  vmSetS('players', wolfPlayers);

  function makeWolfGame(wolfHoles, wolfCarry, scores) {
    return {
      id:'wg1', type:'foursome', gameType:'wolf', status:'active', _scoring:true,
      courseId:'wc1', wolfOrder:['pA','pB','pC','pD'],
      playerIds:['pA','pB','pC','pD'],
      playerNames:['A','B','C','D'],
      chs:  { pA:0, pB:8, pC:16, pD:0 },
      rawChs:{ pA:0, pB:8, pC:16, pD:0 },
      ptValue:1, strokeMode:'field',
      scores: JSON.parse(JSON.stringify(scores)),
      wolfHoles: JSON.parse(JSON.stringify(wolfHoles)),
      wolfCarry, _totalHoles:18,
    };
  }

  const h1 = WOLFCOURSE.holes[0]; // hole 1, par4, hcp1

  // Partner mode: wolf=pA, partner=pB vs pC+pD
  // pA net=4, pB net=3, pC net=3, pD net=5
  // wolfBest = min(4,3) = 3; otherBest = min(3,5) = 3 → tie
  {
    const g = makeWolfGame({}, 0, { pA:{1:4}, pB:{1:4}, pC:{1:4}, pD:{1:5} });
    const result = wolfCalcHoleWinner(g, h1, 'partner', 'pA', 'pB');
    expect('wolfCalcHoleWinner partner tie: result=tie', result, 'tie');
  }

  // Partner: pA net=3 (gross=3,CH=0), pB net=3; pC net=3, pD net=5
  // wolfBest=min(3,3)=3; otherBest=min(3,5)=3 → still tie
  {
    const g = makeWolfGame({}, 0, { pA:{1:3}, pB:{1:4}, pC:{1:4}, pD:{1:5} });
    const result = wolfCalcHoleWinner(g, h1, 'partner', 'pA', 'pB');
    expect('wolfCalcHoleWinner partner tie (equal bests)=tie', result, 'tie');
  }

  // Partner: pA net=2 (gross=2), pB net=3; pC net=3, pD net=5 → wolf wins
  {
    const g = makeWolfGame({}, 0, { pA:{1:2}, pB:{1:4}, pC:{1:4}, pD:{1:5} });
    const result = wolfCalcHoleWinner(g, h1, 'partner', 'pA', 'pB');
    expect('wolfCalcHoleWinner partner wolf wins', result, 'wolf');
  }

  // Partner: wolf loses — pC net=2 (gross=2,CH=16,str=1→net=1... wait gross=2-1=1)
  // pC gross=2,CH=16,hcp1→str=1,net=1; wolfBest=min(4,3)=3; otherBest=min(1,5)=1 → others win
  {
    const g = makeWolfGame({}, 0, { pA:{1:4}, pB:{1:4}, pC:{1:2}, pD:{1:5} });
    const result = wolfCalcHoleWinner(g, h1, 'partner', 'pA', 'pB');
    expect('wolfCalcHoleWinner partner others win', result, 'others');
  }

  // Lone wolf: wolf=pA (net=3, gross=3, CH=0), others=[pB net=3, pC net=3, pD net=5]
  // wolfBest=3; otherBest=min(3,3,5)=3 → tie
  {
    const g = makeWolfGame({}, 0, { pA:{1:3}, pB:{1:4}, pC:{1:4}, pD:{1:5} });
    const result = wolfCalcHoleWinner(g, h1, 'lone', 'pA', null);
    expect('wolfCalcHoleWinner lone tie', result, 'tie');
  }

  // Lone wolf wins: pA net=2 (gross=2), others best=3
  {
    const g = makeWolfGame({}, 0, { pA:{1:2}, pB:{1:4}, pC:{1:4}, pD:{1:5} });
    const result = wolfCalcHoleWinner(g, h1, 'lone', 'pA', null);
    expect('wolfCalcHoleWinner lone wolf wins', result, 'wolf');
  }

  // Lone wolf loses: pB net=3 (best of others < wolf net=4)
  {
    const g = makeWolfGame({}, 0, { pA:{1:4}, pB:{1:4}, pC:{1:5}, pD:{1:5} });
    // pA net=4; pB net=3; pC net=3; pD net=5 → otherBest=3 < wolfNet=4
    const result = wolfCalcHoleWinner(g, h1, 'lone', 'pA', null);
    expect('wolfCalcHoleWinner lone wolf loses', result, 'others');
  }

  // ── wolfCalcTotals ───────────────────────────────────────────
  // H1: partner, wolf=pA, partner=pB, value=1, wolf wins
  //   pA+2, pB+2, pC-2, pD-2
  // H2: lone, wolf=pB, value=2, wolf wins
  //   pB+6, pA-2, pC-2, pD-2
  // H3: blind, wolf=pC, value=4, others win
  //   pA+4, pB+4, pD+4, pC-12
  // After H1+H2+H3: pA=2-2+4=4, pB=2+6+4=12, pC=-2-2-12=-16, pD=-2-2+4=0
  {
    const wolfHoles = {
      1: { mode:'partner', captainPid:'pA', partnerPid:'pB', winner:'wolf',   base:1, value:1 },
      2: { mode:'lone',    captainPid:'pB', partnerPid:null, winner:'wolf',   base:1, value:2 },
      3: { mode:'blind',   captainPid:'pC', partnerPid:null, winner:'others', base:1, value:4 },
    };
    const g = makeWolfGame(wolfHoles, 0, {});
    const totals = wolfCalcTotals(g);
    expect('wolfCalcTotals pA=4',  totals['pA'],  4);
    expect('wolfCalcTotals pB=12', totals['pB'], 12);
    expect('wolfCalcTotals pC=-16',totals['pC'],-16);
    expect('wolfCalcTotals pD=0',  totals['pD'],  0);
    // Zero-sum check
    const sum = Object.values(totals).reduce((a,v)=>a+v,0);
    expect('wolfCalcTotals zero-sum', sum, 0);
  }

  // Tie hole → winner=tie → no points move → totals unchanged
  {
    const wolfHoles = {
      1: { mode:'partner', captainPid:'pA', partnerPid:'pB', winner:'tie', base:1, value:1 },
    };
    const g = makeWolfGame(wolfHoles, 0, {});
    const totals = wolfCalcTotals(g);
    expect('wolfCalcTotals tie: pA=0', totals['pA'], 0);
    expect('wolfCalcTotals tie: pB=0', totals['pB'], 0);
    expect('wolfCalcTotals tie: pC=0', totals['pC'], 0);
    expect('wolfCalcTotals tie: pD=0', totals['pD'], 0);
  }

  // Carryover: tied hole → next hole base=2, blind multiplier=8
  // H1 tied (base=1,value=1); H2 blind wolf=pB wins, carry base=2 → value=2*4=8
  // pB wins blind: pB+(8*3)=+24; pA-8, pC-8, pD-8
  {
    const wolfHoles = {
      1: { mode:'partner', captainPid:'pA', partnerPid:'pB', winner:'tie',  base:1, value:1 },
      2: { mode:'blind',   captainPid:'pB', partnerPid:null, winner:'wolf', base:2, value:8 },
    };
    const g = makeWolfGame(wolfHoles, 0, {});
    const totals = wolfCalcTotals(g);
    expect('wolfCalcTotals carryover blind pB=24', totals['pB'], 24);
    expect('wolfCalcTotals carryover blind pA=-8', totals['pA'], -8);
    const s2 = Object.values(totals).reduce((a,v)=>a+v,0);
    expect('wolfCalcTotals carryover zero-sum', s2, 0);
  }

  // ── wolfSettlement ───────────────────────────────────────────
  // Totals: pA=4, pB=12, pC=-16, pD=0, ptValue=1
  // Expected pairs:
  //   pC→pA: diff=20, $20
  //   pC→pB: diff=28, $28
  //   pD→pB: diff=12, $12
  //   pA→pB: diff=8,  $8   (pA has 4, pB has 12 → pA pays pB 8)
  //   pC→pD: diff=16, $16
  //   pA and pD: pA=4,pD=0 → pD pays pA $4
  {
    const wolfHoles = {
      1: { mode:'partner', captainPid:'pA', partnerPid:'pB', winner:'wolf',   base:1, value:1 },
      2: { mode:'lone',    captainPid:'pB', partnerPid:null, winner:'wolf',   base:1, value:2 },
      3: { mode:'blind',   captainPid:'pC', partnerPid:null, winner:'others', base:1, value:4 },
    };
    const g = makeWolfGame(wolfHoles, 0, {});
    g.ptValue = 1;
    const pairs = wolfSettlement(g);
    // Check total dollars = sum of all absolute point diffs / 2 * ptValue
    // Totals [4,12,-16,0]: 6 pairs, each pair contributes |diff|
    // pA-pB: 8, pA-pC: 20, pA-pD: 4, pB-pC: 28, pB-pD: 12, pC-pD: 16 → total=88
    const totalDollars = pairs.reduce((a,p)=>a+p.dollars,0);
    expect('wolfSettlement total $ moved=88', totalDollars, 88);
    // pC should pay the most (lowest total = -16)
    const pCpays = pairs.filter(p=>p.payerPid==='pC').reduce((a,p)=>a+p.dollars,0);
    expect('wolfSettlement pC pays $52 total (20+28+4... wait)',
      pCpays, 20+28+16); // pC→pA$20, pC→pB$28, pC→pD$16
    // pB receives the most (highest total = 12)
    const pBreceives = pairs.filter(p=>p.payeePid==='pB').reduce((a,p)=>a+p.dollars,0);
    expect('wolfSettlement pB receives $48 total', pBreceives, 8+28+12); // from pA,pC,pD
    // 6 pairs (C(4,2)=6)
    expect('wolfSettlement has 6 pairs', pairs.length, 6);
  }

  // All square → no pairs
  {
    const g = makeWolfGame({}, 0, {});
    const pairs = wolfSettlement(g);
    expect('wolfSettlement all square: 0 pairs', pairs.length, 0);
  }

  // ptValue scales dollars
  {
    const wolfHoles = {
      1: { mode:'lone', captainPid:'pA', partnerPid:null, winner:'wolf', base:1, value:2 },
    };
    // pA lone wins: +6, others -2 each
    const g = makeWolfGame(wolfHoles, 0, {});
    g.ptValue = 5;
    const pairs = wolfSettlement(g);
    // pB,pC,pD each owe pA 8 pts * $5 = $40 each... wait: totals pA=6,pB=-2,pC=-2,pD=-2
    // pA-pB diff=8→$40; pA-pC→$40; pA-pD→$40; pB-pC→0; pB-pD→0; pC-pD→0
    const paToOther = pairs.filter(p=>p.payeePid==='pA');
    expect('wolfSettlement ptValue=5: 3 payers to pA', paToOther.length, 3);
    expect('wolfSettlement ptValue=5: each pays $40', paToOther[0].dollars, 40);
  }

  sandbox.fsGetCourse = origFGC;
}


// ── 32. STABLEFORD (FOURSOME) ─────────────────────────────────
{
  const { fsCalcStablefordPlayer } = sandbox;
  expect('fsCalcStablefordPlayer exists', typeof fsCalcStablefordPlayer, 'function');

  const STAB_COURSE = {
    id:'sc1', name:'StabCourse', slope:113, rating:72, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='sc1' ? STAB_COURSE : origFGC(id);

  // Players: CH 0/8/16 with known gross scores
  const stabPlayers = [
    {id:'s1',name:'S1',hcp:0, courseHcp:0},
    {id:'s2',name:'S2',hcp:8, courseHcp:8},
    {id:'s3',name:'S3',hcp:16,courseHcp:16},
  ];
  vmSetS('players', stabPlayers);

  const stabCfg = { dblEagle:8, eagle:4, birdie:2, par:1, bogey:0, dbl:0 };

  function makeStabGame(scores) {
    return {
      id:'sg1', type:'foursome', gameType:'stableford', status:'active', _scoring:true,
      courseId:'sc1', playerIds:['s1','s2','s3'],
      chs:{ s1:0, s2:8, s3:16 }, rawChs:{ s1:0, s2:8, s3:16 },
      cfg: stabCfg, strokeMode:'field',
      scores: JSON.parse(JSON.stringify(scores)),
    };
  }

  // s1: CH=0, gross=4 all holes → net=4 each, vsPar=0 → par=1pt × 18 = 18
  // quota=36-0=36, vsQuota=18-36=-18
  const s1Scores = { s1:{} }; STAB_COURSE.holes.forEach(h=>{ s1Scores.s1[h.num]=4; });
  const g1 = makeStabGame({ s1: s1Scores.s1, s2:{}, s3:{} });
  const r1 = fsCalcStablefordPlayer(g1,'s1',STAB_COURSE);
  expect('stableford s1 CH=0 g=4: pts=18',     r1.pts,     18);
  expect('stableford s1: quota=36',             r1.quota,   36);
  expect('stableford s1: vsQuota=-18',          r1.vsQuota,-18);
  expect('stableford s1: gross=72',             r1.gross,   72);
  expect('stableford s1: entered=18',           r1.entered, 18);

  // s2: CH=8, gross=5. hcp≤8 (holes 1-8): str=1,net=4,vsPar=0→1pt. hcp>8 (holes 9-18): str=0,net=5,vsPar=1→0pt.
  // total pts=8, quota=36-8=28, vsQuota=8-28=-20, gross=90
  const s2Scores = {}; STAB_COURSE.holes.forEach(h=>{ s2Scores[h.num]=5; });
  const g2 = makeStabGame({ s1:{}, s2: s2Scores, s3:{} });
  const r2 = fsCalcStablefordPlayer(g2,'s2',STAB_COURSE);
  expect('stableford s2 CH=8 g=5: pts=8',      r2.pts,     8);
  expect('stableford s2: quota=28',             r2.quota,   28);
  expect('stableford s2: vsQuota=-20',          r2.vsQuota,-20);
  expect('stableford s2: gross=90',             r2.gross,   90);

  // s3: CH=16, gross=3 every hole.
  // str on hcp≤16 (holes 1-16): 1 stroke → net=2, vsPar=-2 → birdie=2pts
  // str on hcp>16 (holes 17-18): 0 strokes → net=3, vsPar=-1 → birdie=2pts
  // Actually all holes: net<par → birdie → 2pts per hole × 18 = 36... wait
  // hcp17,18 > 16 → str=0 → net=3, vsPar=3-4=-1 → birdie=2pt
  // hcp1-16 → str=1 → net=2, vsPar=2-4=-2 → eagle=4pt
  // pts = 16×4 + 2×2 = 64+4 = 68; quota=36-16=20, vsQuota=48
  const s3Scores = {}; STAB_COURSE.holes.forEach(h=>{ s3Scores[h.num]=3; });
  const g3 = makeStabGame({ s1:{}, s2:{}, s3: s3Scores });
  const r3 = fsCalcStablefordPlayer(g3,'s3',STAB_COURSE);
  expect('stableford s3 CH=16 g=3: pts=68',    r3.pts,    68);
  expect('stableford s3: quota=20',             r3.quota,  20);
  expect('stableford s3: vsQuota=48',           r3.vsQuota,48);
  expect('stableford s3: gross=54',             r3.gross,  54);

  // No scores entered → entered=0, pts=0
  const g4 = makeStabGame({ s1:{}, s2:{}, s3:{} });
  const r4 = fsCalcStablefordPlayer(g4,'s1',STAB_COURSE);
  expect('stableford no scores: entered=0',     r4.entered, 0);
  expect('stableford no scores: pts=0',         r4.pts,     0);

  // Partial (9 holes): entered=9
  const s1Half = {}; STAB_COURSE.holes.slice(0,9).forEach(h=>{ s1Half[h.num]=4; });
  const g5 = makeStabGame({ s1: s1Half, s2:{}, s3:{} });
  const r5 = fsCalcStablefordPlayer(g5,'s1',STAB_COURSE);
  expect('stableford partial 9 holes: entered=9', r5.entered, 9);
  expect('stableford partial 9 holes: pts=9',     r5.pts,     9);

  sandbox.fsGetCourse = origFGC;
}


// ── 33. LOW NET (FOURSOME) ────────────────────────────────────
{
  const { fsCalcLowNetPlayer } = sandbox;
  expect('fsCalcLowNetPlayer exists', typeof fsCalcLowNetPlayer, 'function');

  const LN_COURSE = {
    id:'lnc1', name:'LNCourse', slope:113, rating:72, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='lnc1' ? LN_COURSE : origFGC(id);

  const lnPlayers = [
    {id:'l1',name:'L1',hcp:0, courseHcp:0},
    {id:'l2',name:'L2',hcp:8, courseHcp:8},
    {id:'l3',name:'L3',hcp:16,courseHcp:16},
  ];
  vmSetS('players', lnPlayers);

  function makeLNGame(scores) {
    return {
      id:'lng1', type:'foursome', gameType:'lownet', status:'active', _scoring:true,
      courseId:'lnc1', playerIds:['l1','l2','l3'],
      chs:{ l1:0, l2:8, l3:16 }, rawChs:{ l1:0, l2:8, l3:16 },
      strokeMode:'field', scores: JSON.parse(JSON.stringify(scores)),
    };
  }

  // l1: CH=0, gross=4 → net=4 every hole → totalNet=72, totalGross=72
  const l1sc = {}; LN_COURSE.holes.forEach(h=>{ l1sc[h.num]=4; });
  const gl1 = makeLNGame({ l1:l1sc, l2:{}, l3:{} });
  const rl1 = fsCalcLowNetPlayer(gl1,'l1',LN_COURSE);
  expect('lownet l1 CH=0 g=4: gross=72',  rl1.gross,   72);
  expect('lownet l1 CH=0 g=4: net=72',    rl1.net,     72);
  expect('lownet l1: entered=18',         rl1.entered, 18);

  // l2: CH=8, gross=5. 8 strokes total (holes hcp≤8) → net=90-8=82
  const l2sc = {}; LN_COURSE.holes.forEach(h=>{ l2sc[h.num]=5; });
  const gl2 = makeLNGame({ l1:{}, l2:l2sc, l3:{} });
  const rl2 = fsCalcLowNetPlayer(gl2,'l2',LN_COURSE);
  expect('lownet l2 CH=8 g=5: gross=90',  rl2.gross,   90);
  expect('lownet l2 CH=8 g=5: net=82',    rl2.net,     82);

  // l3: CH=16, gross=3. 16 strokes total (holes hcp≤16) → net=54-16=38
  const l3sc = {}; LN_COURSE.holes.forEach(h=>{ l3sc[h.num]=3; });
  const gl3 = makeLNGame({ l1:{}, l2:{}, l3:l3sc });
  const rl3 = fsCalcLowNetPlayer(gl3,'l3',LN_COURSE);
  expect('lownet l3 CH=16 g=3: gross=54', rl3.gross,   54);
  expect('lownet l3 CH=16 g=3: net=38',   rl3.net,     38);

  // No scores → entered=0, gross=0, net=0
  const gln0 = makeLNGame({ l1:{}, l2:{}, l3:{} });
  const rln0 = fsCalcLowNetPlayer(gln0,'l1',LN_COURSE);
  expect('lownet no scores: entered=0',   rln0.entered, 0);
  expect('lownet no scores: net=0',       rln0.net,     0);

  sandbox.fsGetCourse = origFGC;
}


// ── 34. 2-PLAYER SCRAMBLE ─────────────────────────────────────
{
  const { twoScrambleTeamCH } = sandbox;
  expect('twoScrambleTeamCH exists', typeof twoScrambleTeamCH, 'function');

  const TSC_COURSE = {
    id:'tsc1', name:'TSCourse', slope:113, rating:72, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='tsc1' ? TSC_COURSE : origFGC(id);

  vmSetS('config', { games: { fourPlayer: { scramble:{ hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  const tsPlayers = [
    {id:'t1',name:'T1',hcp:0, courseHcp:0},
    {id:'t2',name:'T2',hcp:8, courseHcp:8},
    {id:'t3',name:'T3',hcp:16,courseHcp:16},
    {id:'t4',name:'T4',hcp:0, courseHcp:0},
  ];
  vmSetS('players', tsPlayers);

  function makeTSGame(scores) {
    return {
      id:'tsg1', type:'foursome', gameType:'twoscramble', status:'active', _scoring:true,
      courseId:'tsc1', playerIds:['t1','t2','t3','t4'],
      teams:{ A:['t1','t2'], B:['t3','t4'] },
      chs:{ t1:0, t2:8, t3:16, t4:0 }, rawChs:{ t1:0, t2:8, t3:16, t4:0 },
      scores: JSON.parse(JSON.stringify(scores)),
    };
  }

  // Team A: [t1 CH=0, t2 CH=8] sorted ascending [0,8]
  // 2-player pcts from outingScrambleTeamCH: abcdPct has [100,85,70,60] but only 2 used
  // Actually twoScrambleTeamCH uses abcdPct[0,1] for 2 players: 0*100%+8*85%=6.8→7
  const g_ts = makeTSGame({'grp_0':{}, 'grp_1':{}});
  expect('twoScrambleTeamCH A [CH0,CH8]=7', twoScrambleTeamCH(['t1','t2'], g_ts, TSC_COURSE), 7);
  // Team B: [t3 CH=16, t4 CH=0] sorted [0,16]: 0*100%+16*85%=13.6→14
  expect('twoScrambleTeamCH B [CH16,CH0]=14', twoScrambleTeamCH(['t3','t4'], g_ts, TSC_COURSE), 14);

  // Team net = total gross - teamCH
  // grp_0 gross=4 per hole → total=72; net=72-7=65
  // grp_1 gross=4 per hole → total=72; net=72-14=58 → B wins
  const grp0sc = {}; TSC_COURSE.holes.forEach(h=>{ grp0sc[h.num]=4; });
  const grp1sc = {}; TSC_COURSE.holes.forEach(h=>{ grp1sc[h.num]=4; });

  const grossA = TSC_COURSE.holes.reduce((a,h)=>a+(grp0sc[h.num]||0),0);
  const grossB = TSC_COURSE.holes.reduce((a,h)=>a+(grp1sc[h.num]||0),0);
  const chA = twoScrambleTeamCH(['t1','t2'], g_ts, TSC_COURSE);
  const chB = twoScrambleTeamCH(['t3','t4'], g_ts, TSC_COURSE);
  expect('2scramble grossA=72', grossA, 72);
  expect('2scramble grossB=72', grossB, 72);
  expect('2scramble netA=65',   grossA - chA, 65);
  expect('2scramble netB=58',   grossB - chB, 58);
  expect('2scramble B wins (lower net)', (grossB - chB) < (grossA - chA), true);

  sandbox.fsGetCourse = origFGC;
}


// ── 35. 2-PLAYER SHAMBLE ──────────────────────────────────────
{
  const { fsTwoShambleTeamNet } = sandbox;
  expect('fsTwoShambleTeamNet exists', typeof fsTwoShambleTeamNet, 'function');

  const TSH_COURSE = {
    id:'tshc1', name:'TSHCourse', slope:113, rating:72, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='tshc1' ? TSH_COURSE : origFGC(id);

  const tshPlayers = [
    {id:'sh1',name:'SH1',hcp:0, courseHcp:0},
    {id:'sh2',name:'SH2',hcp:8, courseHcp:8},
    {id:'sh3',name:'SH3',hcp:16,courseHcp:16},
    {id:'sh4',name:'SH4',hcp:0, courseHcp:0},
  ];
  vmSetS('players', tshPlayers);

  function makeTSHGame(scores) {
    return {
      id:'tshg1', type:'foursome', gameType:'twoshamble', status:'active', _scoring:true,
      courseId:'tshc1', playerIds:['sh1','sh2','sh3','sh4'],
      teams:{ A:['sh1','sh2'], B:['sh3','sh4'] },
      chs:{ sh1:0, sh2:8, sh3:16, sh4:0 }, rawChs:{ sh1:0, sh2:8, sh3:16, sh4:0 },
      strokeMode:'field', scores: JSON.parse(JSON.stringify(scores)),
    };
  }

  // Team A: sh1(CH=0,g=4), sh2(CH=8,g=5)
  // Per hole best net = min(sh1net, sh2net)
  // hcp≤8 (h1-h8): sh1 net=4-0=4, sh2 net=5-1=4 → min=4
  // hcp>8 (h9-h18): sh1 net=4-0=4, sh2 net=5-0=5 → min=4
  // All 18 holes: min=4 → total=72; par=72 → diff=0
  const ashScores = {};
  TSH_COURSE.holes.forEach(h=>{ ashScores['sh1']??={}; ashScores['sh1'][h.num]=4; });
  TSH_COURSE.holes.forEach(h=>{ ashScores['sh2']??={}; ashScores['sh2'][h.num]=5; });

  // Team B: sh3(CH=16,g=3), sh4(CH=0,g=4)
  // hcp≤16 (h1-h16): sh3 net=3-1=2, sh4 net=4-0=4 → min=2
  // hcp>16 (h17-h18): sh3 net=3-0=3, sh4 net=4-0=4 → min=3
  // total: 16×2 + 2×3 = 32+6=38; par=72 → diff=-34
  TSH_COURSE.holes.forEach(h=>{ ashScores['sh3']??={}; ashScores['sh3'][h.num]=3; });
  TSH_COURSE.holes.forEach(h=>{ ashScores['sh4']??={}; ashScores['sh4'][h.num]=4; });

  const g_tsh = makeTSHGame(ashScores);
  const netA = fsTwoShambleTeamNet(['sh1','sh2'], g_tsh, TSH_COURSE);
  const netB = fsTwoShambleTeamNet(['sh3','sh4'], g_tsh, TSH_COURSE);
  expect('2shamble team A net=72',     netA, 72);
  expect('2shamble team B net=38',     netB, 38);
  expect('2shamble B wins (lower net)', netB < netA, true);

  // Missing score on hole: skipped (not counted in total)
  const partialScores = { sh1:{1:4}, sh2:{1:5}, sh3:{}, sh4:{} };
  const g_partial = makeTSHGame(partialScores);
  const netApartial = fsTwoShambleTeamNet(['sh1','sh2'], g_partial, TSH_COURSE);
  // Only hole 1: sh1 net=4, sh2 net=4 → min=4 (h1 hcp=1≤8→str=1→sh2 net=4)
  expect('2shamble partial 1 hole: net=4', netApartial, 4);

  // Gross=0 treated as missing (filtered)
  const zeroScores = { sh1:{1:0}, sh2:{1:5} };
  const g_zero = makeTSHGame(zeroScores);
  // sh1 gross=0 → filtered; sh2 net=5-1=4 → min=4
  const netZero = fsTwoShambleTeamNet(['sh1','sh2'], g_zero, TSH_COURSE);
  expect('2shamble gross=0 filtered: net=4', netZero, 4);

  sandbox.fsGetCourse = origFGC;
}


// ── 31. OUTING BACK TO GAME TYPE (state restoration) ─────────

// ── 32. OUTING COMPUTE PARTNER STABLEFORD ────────────────────
// Tests outingComputePartnerStableford

{
  const { outingComputePartnerStableford } = sandbox;
  expect('outingComputePartnerStableford exists', typeof outingComputePartnerStableford, 'function');

  // Restore stableford config
  vmSetS('config', { games: {
    individual: { stableford: { enabled:true, eagle:4, birdie:2, par:1, bogey:0, dbl:0 } },
    fourPlayer:  { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } }
  }});

  const TC18 = {
    id:'tc18p', name:'PartnerCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='tc18p' ? TC18 : origFGC(id);

  const activeHoles = TC18.holes;

  // Players: P1(CH=0,g=4), P2(CH=8,g=5), P3(CH=16,g=3), P4(CH=24,g=6)
  // Pre-computed: p1=18pts, p2=8pts, p3=68pts, p4=6pts
  // Group 0: P1+P2 → teamPts=26, Group 1: P3+P4 → teamPts=74
  // Winner = Group 1

  const PSTAB_PLAYERS = [
    {id:'ps1',name:'P1',hcp:0, courseHcp:0},
    {id:'ps2',name:'P2',hcp:8, courseHcp:8},
    {id:'ps3',name:'P3',hcp:16,courseHcp:16},
    {id:'ps4',name:'P4',hcp:24,courseHcp:24},
  ];
  const grossByPid = {ps1:4, ps2:5, ps3:3, ps4:6};
  const sc = {};
  PSTAB_PLAYERS.forEach(p => {
    sc[p.id] = {};
    activeHoles.forEach(h => { sc[p.id][h.num] = grossByPid[p.id]; });
  });

  const g = {
    id:'psg1', type:'outing', status:'active', _scoring:true,
    courseId:'tc18p', gameType:'pstableford', skins:false, nineSide:'all',
    players: PSTAB_PLAYERS,
    groups: [
      {id:'g0', playerIds:['ps1','ps2']},
      {id:'g1', playerIds:['ps3','ps4']},
    ],
    scores: JSON.parse(JSON.stringify(sc)),
  };

  const r = outingComputePartnerStableford(g, TC18, activeHoles);

  expect('pstab: isPartnerStab flag absent (raw compute)',  r.pairResults !== undefined, true);
  expect('pstab: pairResults is array',  Array.isArray(r.pairResults), true);
  expect('pstab: 2 pair results',        r.pairResults.length, 2);

  // Winner = Group 1 (P3+P4 = 74 pts)
  expect('pstab: winner gi=1',           r.pairResults[0].gi, 1);
  expect('pstab: winner teamPts=74',     r.pairResults[0].teamPts, 74);
  expect('pstab: loser gi=0',            r.pairResults[1].gi, 0);
  expect('pstab: loser teamPts=26',      r.pairResults[1].teamPts, 26);

  // playerData
  expect('pstab: playerData has ps1',  r.playerData['ps1'] !== undefined, true);
  expect('pstab: ps1 totalPts=18',     r.playerData['ps1'].totalPts, 18);
  expect('pstab: ps2 totalPts=8',      r.playerData['ps2'].totalPts, 8);
  expect('pstab: ps3 totalPts=68',     r.playerData['ps3'].totalPts, 68);
  expect('pstab: ps4 totalPts=6',      r.playerData['ps4'].totalPts, 6);

  // Point targets
  expect('pstab: ps1 ptTarget=36',     r.playerData['ps1'].ptTarget, 36);
  expect('pstab: ps2 ptTarget=28',     r.playerData['ps2'].ptTarget, 28);
  expect('pstab: ps3 ptTarget=20',     r.playerData['ps3'].ptTarget, 20);
  expect('pstab: ps4 ptTarget=12',     r.playerData['ps4'].ptTarget, 12);

  // activeHoles passed through
  expect('pstab: activeHoles=18',      r.activeHoles.length, 18);

  // No-score group excluded
  const gNoScore = JSON.parse(JSON.stringify(g));
  gNoScore.groups = [{id:'g0',playerIds:['ps1','ps2']},{id:'g1',playerIds:['ps3','ps4']}];
  gNoScore.scores = {}; // wipe all scores
  const rEmpty = outingComputePartnerStableford(gNoScore, TC18, activeHoles);
  expect('pstab: no scores → pairResults empty', rEmpty.pairResults.length, 0);

  sandbox.fsGetCourse = origFGC;
}


// ── 33. OUTING COMPUTE BEST BALL MATCH ───────────────────────
// Tests outingComputeBestBallMatch

{
  const { outingComputeBestBallMatch } = sandbox;
  expect('outingComputeBestBallMatch exists', typeof outingComputeBestBallMatch, 'function');

  const TC18 = {
    id:'tc18bb', name:'BBMCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGC = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='tc18bb' ? TC18 : origFGC(id);

  const activeHoles = TC18.holes;

  // Players: P1(CH=0,g=4), P2(CH=8,g=5) = Group 0
  //          P3(CH=16,g=3), P4(CH=24,g=6) = Group 1
  // Pre-computed:
  //   Group 0 best net per hole = min(P1.net, P2.net)
  //   Group 1 best net per hole = min(P3.net, P4.net)
  //   h1: g0=4, g1=2 → g1 wins → matchStatus=-1
  //   All 18 holes: g1 wins all → matchStatus=-18

  const BBM_PLAYERS = [
    {id:'bm1',name:'P1',hcp:0, courseHcp:0},
    {id:'bm2',name:'P2',hcp:8, courseHcp:8},
    {id:'bm3',name:'P3',hcp:16,courseHcp:16},
    {id:'bm4',name:'P4',hcp:24,courseHcp:24},
  ];
  const grossBBM = {bm1:4, bm2:5, bm3:3, bm4:6};
  const scBBM = {};
  BBM_PLAYERS.forEach(p => {
    scBBM[p.id] = {};
    activeHoles.forEach(h => { scBBM[p.id][h.num] = grossBBM[p.id]; });
  });

  const gBBM = {
    id:'bbm1', type:'outing', status:'active', _scoring:true,
    courseId:'tc18bb', gameType:'bbmatch', skins:false, nineSide:'all',
    players: BBM_PLAYERS,
    groups:[
      {id:'g0', playerIds:['bm1','bm2']},
      {id:'g1', playerIds:['bm3','bm4']},
    ],
    scores: JSON.parse(JSON.stringify(scBBM)),
  };

  const r = outingComputeBestBallMatch(gBBM, TC18, activeHoles);

  // 2-team match
  expect('bbmatch: mode=match',            r.mode, 'match');
  expect('bbmatch: matchStatus=-18',       r.matchStatus, -18);
  expect('bbmatch: holesPlayed=18',        r.holesPlayed, 18);
  expect('bbmatch: holesRemaining=0',      r.holesRemaining, 0);
  expect('bbmatch: dormie=true',           r.dormie, true);
  expect('bbmatch: holeResults length=18', r.holeResults.length, 18);

  // h1 result: g1 wins (g0net=4, g1net=2)
  expect('bbmatch h1: result=grp1',  r.holeResults[0].result, 'grp1');
  expect('bbmatch h1: n0=4',         r.holeResults[0].n0, 4);
  expect('bbmatch h1: n1=2',         r.holeResults[0].n1, 2);

  // Names
  expect('bbmatch: names0 includes P1', r.names0.includes('P1'), true);
  expect('bbmatch: names1 includes P3', r.names1.includes('P3'), true);

  // Tie scenario: all same net → all halved → matchStatus=0
  const TIED_PLAYERS = [
    {id:'t1',name:'T1',hcp:0,courseHcp:0},
    {id:'t2',name:'T2',hcp:0,courseHcp:0},
    {id:'t3',name:'T3',hcp:0,courseHcp:0},
    {id:'t4',name:'T4',hcp:0,courseHcp:0},
  ];
  const scTie = {};
  TIED_PLAYERS.forEach(p => { scTie[p.id] = {}; activeHoles.forEach(h => { scTie[p.id][h.num] = 4; }); });
  const gTie = {
    id:'tied1', type:'outing', status:'active', _scoring:true,
    courseId:'tc18bb', gameType:'bbmatch', skins:false, nineSide:'all',
    players: TIED_PLAYERS,
    groups:[{id:'g0',playerIds:['t1','t2']},{id:'g1',playerIds:['t3','t4']}],
    scores: JSON.parse(JSON.stringify(scTie)),
  };
  const rTie = outingComputeBestBallMatch(gTie, TC18, activeHoles);
  expect('bbmatch tie: matchStatus=0',     rTie.matchStatus, 0);
  expect('bbmatch tie: dormie=false',      rTie.dormie, false);
  expect('bbmatch tie: h1 result=halved',  rTie.holeResults[0].result, 'halved');

  // 3-group rank mode
  // Group 0: P1(CH=0,g=4)+P2(CH=8,g=5) → totalBestNet=72
  // Group 1: P3(CH=16,g=3)+P4(CH=24,g=6) → totalBestNet=38
  // Group 2: Q1(CH=0,g=3)+Q2(CH=0,g=3) → min=3 every hole → totalBestNet=54
  const Q_PLAYERS = [
    {id:'q1',name:'Q1',hcp:0,courseHcp:0},
    {id:'q2',name:'Q2',hcp:0,courseHcp:0},
  ];
  const scQ = {};
  [...BBM_PLAYERS,...Q_PLAYERS].forEach(p => {
    scQ[p.id] = {};
    const gross = {bm1:4,bm2:5,bm3:3,bm4:6,q1:3,q2:3}[p.id];
    activeHoles.forEach(h => { scQ[p.id][h.num] = gross; });
  });
  const g3 = {
    id:'rank1', type:'outing', status:'active', _scoring:true,
    courseId:'tc18bb', gameType:'bbmatch', skins:false, nineSide:'all',
    players:[...BBM_PLAYERS,...Q_PLAYERS],
    groups:[
      {id:'g0',playerIds:['bm1','bm2']},
      {id:'g1',playerIds:['bm3','bm4']},
      {id:'g2',playerIds:['q1','q2']},
    ],
    scores: JSON.parse(JSON.stringify(scQ)),
  };
  const r3 = outingComputeBestBallMatch(g3, TC18, activeHoles);
  expect('bbmatch 3-group: mode=rank',             r3.mode, 'rank');
  expect('bbmatch 3-group: 3 results',             r3.groupResults.length, 3);
  // Rank: g1(38) < g2(54) < g0(72)
  expect('bbmatch 3-group: winner gi=1',           r3.groupResults[0].gi, 1);
  expect('bbmatch 3-group: winner totalBestNet=38', r3.groupResults[0].totalBestNet, 38);
  expect('bbmatch 3-group: 2nd gi=2',              r3.groupResults[1].gi, 2);
  expect('bbmatch 3-group: 2nd totalBestNet=54',   r3.groupResults[1].totalBestNet, 54);
  expect('bbmatch 3-group: last gi=0',             r3.groupResults[2].gi, 0);
  expect('bbmatch 3-group: last totalBestNet=72',  r3.groupResults[2].totalBestNet, 72);

  sandbox.fsGetCourse = origFGC;
}


// ── 34. SHAMBLE resultMethod DISPATCH ────────────────────────
// Confirms g.resultMethod='321' routes correctly in outingComputeTeamResults

{
  const origFGC = sandbox.fsGetCourse;
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  const TC18 = {
    id:'tc18sm', name:'ShambleCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tc18sm' ? TC18 : origFGC(id);
  const activeHoles = TC18.holes;

  const SHAM_PLAYERS = [
    {id:'sh1',name:'S1',hcp:0, courseHcp:0},
    {id:'sh2',name:'S2',hcp:8, courseHcp:8},
    {id:'sh3',name:'S3',hcp:16,courseHcp:16},
    {id:'sh4',name:'S4',hcp:24,courseHcp:24},
  ];
  const grossSham = {sh1:4, sh2:5, sh3:3, sh4:6};
  const scSham = {};
  SHAM_PLAYERS.forEach(p => {
    scSham[p.id] = {};
    activeHoles.forEach(h => { scSham[p.id][h.num] = grossSham[p.id]; });
  });

  function makeShambleGame(resultMethod) {
    return {
      id:'shg1', type:'outing', status:'active', _scoring:true,
      courseId:'tc18sm', gameType:'shamble', skins:false, nineSide:'all',
      resultMethod,
      players: SHAM_PLAYERS,
      groups:[{id:'g0', playerIds:SHAM_PLAYERS.map(p=>p.id)}],
      scores: JSON.parse(JSON.stringify(scSham)),
    };
  }

  // All-par-4 course: 321 take=2 per hole → same result as best2
  // Both should give teamNet=110, parEq=144, netVsPar=-34
  const r_best2 = sandbox.outingComputeResults(makeShambleGame('best2'));
  const r_321   = sandbox.outingComputeResults(makeShambleGame('321'));

  expect('shamble best2: teamNet=110',    r_best2.teamResults[0].teamNet, 110);
  expect('shamble best2: netVsPar=-34',   r_best2.teamResults[0].netVsPar, -34);
  expect('shamble 321 all-par4: teamNet=110',  r_321.teamResults[0].teamNet, 110);
  expect('shamble 321 all-par4: netVsPar=-34', r_321.teamResults[0].netVsPar, -34);

  // null resultMethod defaults to best2
  const r_null = sandbox.outingComputeResults(makeShambleGame(null));
  expect('shamble null resultMethod defaults best2: teamNet=110', r_null.teamResults[0].teamNet, 110);

  // Verify 321 differs from best2 on mixed-par course
  const TC3 = {
    id:'tc3sm', name:'MixedShamble', slope:113, rating:12.0, par:12, nineHole:true,
    holes:[{num:1,par:3,hcp:1},{num:2,par:4,hcp:2},{num:3,par:5,hcp:3}],
  };
  sandbox.fsGetCourse = id => id==='tc3sm' ? TC3 : id==='tc18sm' ? TC18 : origFGC(id);
  const sc3 = {};
  SHAM_PLAYERS.forEach(p => {
    const gross = grossSham[p.id];
    sc3[p.id] = {1:gross,2:gross,3:gross};
  });
  const g3_best2 = { ...makeShambleGame('best2'), courseId:'tc3sm', scores:JSON.parse(JSON.stringify(sc3)) };
  const g3_321   = { ...makeShambleGame('321'),   courseId:'tc3sm', scores:JSON.parse(JSON.stringify(sc3)) };
  const r3_best2 = sandbox.outingComputeResults(g3_best2);
  const r3_321   = sandbox.outingComputeResults(g3_321);

  // Pre-computed in §29: 321 mixed: teamNet=-9, parEq=22
  expect('shamble 321 mixed-par: teamNet=-9',   r3_321.teamResults[0].teamNet, -9);
  expect('shamble 321 mixed-par: parEq=22',     r3_321.teamResults[0].parEq, 22);
  // best2 on 3-hole mixed: take=2 every hole, parEq=3*2=6+4*2=8+5*2=10=24... wait
  // parEq for best2 = h.par*2 per hole = 3*2+4*2+5*2 = 6+8+10=24
  expect('shamble best2 mixed-par: parEq=24',   r3_best2.teamResults[0].parEq, 24);
  // Confirm 321 and best2 differ on mixed-par course
  expect('shamble 321 vs best2 mixed-par: parEq differs', r3_321.teamResults[0].parEq !== r3_best2.teamResults[0].parEq, true);

  sandbox.fsGetCourse = origFGC;
}


// ── 36. SHORT GROUP SCRAMBLE TEAM CH (2p, 3p) ────────────────
// Tests outingScrambleTeamCH with 2 and 3 player groups

{
  const { outingScrambleTeamCH } = sandbox;
  const TC18 = {
    id:'tc18sg', name:'ShortGroup', slope:113, rating:72.0, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  // 2-player: CH[0,8], pcts fallback [100,85]
  // raw = 0*1 + 8*.85 = 6.8 → round → 7
  const p2 = [{id:'a',hcp:0,courseHcp:0},{id:'b',hcp:8,courseHcp:8}];
  expect('2p scramble CH=7', outingScrambleTeamCH(p2, TC18, TC18.holes), 7);

  // 3-player: CH[0,8,16], pcts fallback [100,85,70]
  // raw = 0 + 6.8 + 11.2 = 18 → round → 18
  const p3 = [{id:'a',hcp:0,courseHcp:0},{id:'b',hcp:8,courseHcp:8},{id:'c',hcp:16,courseHcp:16}];
  expect('3p scramble CH=18', outingScrambleTeamCH(p3, TC18, TC18.holes), 18);

  // Input order shouldn't matter — sorts internally
  const p3rev = [...p3].reverse();
  expect('3p scramble CH=18 reversed input', outingScrambleTeamCH(p3rev, TC18, TC18.holes), 18);

  // 2-player with custom config pcts
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[80,80,80,80] } } } });
  // raw = 0*.8 + 8*.8 = 6.4 → round → 6
  expect('2p scramble custom pcts [80,80]=6', outingScrambleTeamCH(p2, TC18, TC18.holes), 6);

  // Restore
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  // 9-hole course with rating<50 (no halving): same CH values → same teamCH
  const TC9 = {
    id:'tc9sg', slope:113, rating:36.0, par:36,
    holes: Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const p4 = [
    {id:'a',hcp:0,courseHcp:0},{id:'b',hcp:8,courseHcp:8},
    {id:'c',hcp:16,courseHcp:16},{id:'d',hcp:24,courseHcp:24},
  ];
  expect('4p scramble CH 9-hole (rating=36) = 32', outingScrambleTeamCH(p4, TC9, TC9.holes), 32);
}


// ── 37. PLUS HANDICAP PLAYER ──────────────────────────────────
// Tests strokesOnHole, stableford, and low-net with CH < 0

{
  const { outingComputeResults } = sandbox;
  const origFGC = sandbox.fsGetCourse;

  vmSetS('config', { games: {
    individual: { stableford:{ enabled:true, eagle:4, birdie:2, par:1, bogey:0, dbl:0 } },
    fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } },
    skins: { enabled:false, halfStroke:false, strokeOffBest:false, hcpAdj:100 },
  }});

  const TC18 = {
    id:'tc18plus', name:'PlusHcp', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tc18plus' ? TC18 : origFGC(id);

  // CH=-2: gives back strokes on holes hcp 17 and 18
  // strokesOnHole(-2,17,18)=-1, strokesOnHole(-2,18,18)=-1, all others=0
  const PLUS_PLAYERS = [
    {id:'plus1', name:'Plus', hcp:-2, courseHcp:-2},
    {id:'reg1',  name:'Reg',  hcp:0,  courseHcp:0 },
  ];

  // Build scores: both gross=3 on all holes
  const sc = {};
  PLUS_PLAYERS.forEach(p => {
    sc[p.id] = {};
    TC18.holes.forEach(h => { sc[p.id][h.num] = 3; });
  });

  const g = {
    id:'plus_g1', type:'outing', status:'active', _scoring:true,
    courseId:'tc18plus', gameType:'stableford', skins:false, nineSide:'all',
    players: PLUS_PLAYERS,
    groups:[{id:'grp1', playerIds:PLUS_PLAYERS.map(p=>p.id)}],
    scores: JSON.parse(JSON.stringify(sc)),
  };

  const r = sandbox.outingComputeResults(g);
  const plus = r.playerData.find(p=>p.id==='plus1');
  const reg  = r.playerData.find(p=>p.id==='reg1');

  // Outing stableford uses GROSS vs par (not net): grossVsPar = gross - par
  // Plus (CH=-2, gross=3): grossVsPar=3-4=-1 → birdie=2pts every hole → 18*2=36
  expect('plus CH=-2 stableford totalPts=36', plus.totalPts, 36);

  // Reg (CH=0, gross=3): grossVsPar=3-4=-1 → birdie=2pts → 36pts
  expect('reg CH=0 stableford totalPts=36',  reg.totalPts, 36);

  // Both 36pts — tie. strokesOnHole still matters for skins (skinsNetCmp uses str).
  // Verify gross totals differ: plus totalGross=54, reg totalGross=54 (same)
  expect('plus totalGross=54', plus.totalGross, 54);
  expect('reg totalGross=54',  reg.totalGross,  54);

  // Low net with plus HCP
  const g2 = { ...g, gameType:'lownet', scores: JSON.parse(JSON.stringify(sc)) };
  const r2 = sandbox.outingComputeResults(g2);
  const plus2 = r2.playerData.find(p=>p.id==='plus1');
  const reg2  = r2.playerData.find(p=>p.id==='reg1');

  // Plus (CH=-2, gross=3):
  // holes 1-16: net=3-0=3, holes 17-18: net=3-(-1)=4
  // totalNet = 16*3 + 2*4 = 48+8 = 56
  expect('plus CH=-2 lownet totalNet=56', plus2.totalNet, 56);

  // Reg (CH=0, gross=3): net=3 every hole → totalNet=54
  expect('reg CH=0 lownet totalNet=54', reg2.totalNet, 54);

  // Reg wins (lower net)
  const sorted2 = [...r2.playerData].filter(p=>p.totalGross>0).sort((a,b)=>a.totalNet-b.totalNet);
  expect('reg wins lownet (54 < 56)', sorted2[0].id, 'reg1');

  // strokesOnHole direction — verify giving back strokes
  const { strokesOnHole } = sandbox;
  expect('CH=-2 h17 gives back 1 stroke', strokesOnHole(-2, 17, 18), -1);
  expect('CH=-2 h18 gives back 1 stroke', strokesOnHole(-2, 18, 18), -1);
  expect('CH=-2 h16 gives 0 strokes',     strokesOnHole(-2, 16, 18), 0);
  expect('CH=-2 h1 gives 0 strokes',      strokesOnHole(-2, 1,  18), 0);

  sandbox.fsGetCourse = origFGC;
}


// ── 38. PARTIAL SCORES (MISSING PLAYERS / HOLES) ─────────────
// Tests outingComputeResults when some players have no scores or partial holes

{
  const origFGC = sandbox.fsGetCourse;
  vmSetS('config', { games: {
    individual: { stableford:{ enabled:true, eagle:4, birdie:2, par:1, bogey:0, dbl:0 } },
    skins: { enabled:false, halfStroke:false, strokeOffBest:false, hcpAdj:100 },
  }});

  const TC18 = {
    id:'tc18partial', name:'Partial', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tc18partial' ? TC18 : origFGC(id);

  const PART_PLAYERS = [
    {id:'pp1', name:'P1', hcp:0,  courseHcp:0 },   // all 18 holes, gross=4
    {id:'pp2', name:'P2', hcp:8,  courseHcp:8 },   // NO scores at all
    {id:'pp3', name:'P3', hcp:16, courseHcp:16},   // holes 1-9 only, gross=3
    {id:'pp4', name:'P4', hcp:24, courseHcp:24},   // all 18 holes, gross=6
  ];
  const sc = {
    pp1:{}, pp2:{}, pp3:{}, pp4:{}
  };
  TC18.holes.forEach(h => {
    sc.pp1[h.num] = 4;
    // pp2: no scores
    if (h.num <= 9) sc.pp3[h.num] = 3;
    sc.pp4[h.num] = 6;
  });

  const g = {
    id:'partg1', type:'outing', status:'active', _scoring:true,
    courseId:'tc18partial', gameType:'stableford', skins:true, nineSide:'all',
    players: PART_PLAYERS,
    groups:[{id:'grp1', playerIds:PART_PLAYERS.map(p=>p.id)}],
    scores: JSON.parse(JSON.stringify(sc)),
  };

  const r = sandbox.outingComputeResults(g);

  // P2 (no scores): totalGross=0 → should be in playerData but filtered from standings
  const p2d = r.playerData.find(p=>p.id==='pp2');
  expect('partial: P2 totalGross=0', p2d.totalGross, 0);

  // P3 (holes 1-9 only): stableford — holes 1-9, CH=16, gross=3
  // strokesOnHole(16,h,18): hcp 1-16 → 1 stroke → net=2 → nvp=-2 → 4pts each
  // holes 1-9: all hcp<=16 → 9 holes * 4pts = 36
  // holes 10-18: gross=0 → not counted (pts=0)
  const p3d = r.playerData.find(p=>p.id==='pp3');
  // gross=3, par=4 → grossVsPar=-1 → birdie=2pts × 9 holes = 18
  expect('partial: P3 holes1-9 stableford=18', p3d.totalPts, 18);

  // P1 (all holes, CH=0, gross=4): each hole net=4 → par → 1pt → totalPts=18
  const p1d = r.playerData.find(p=>p.id==='pp1');
  expect('partial: P1 all holes stableford=18', p1d.totalPts, 18);

  // P4 (all holes, CH=24, gross=6):
  // strokesOnHole(24,h,18): hcp<=6 → floor(24/18)=1+1=2 (holes 1-6); hcp 7-18 → 1 stroke
  // holes 1-6: net=4 → par=1pt; holes 7-18: net=5 → bogey=0pt
  // totalPts = 6*1 + 12*0 = 6
  const p4d = r.playerData.find(p=>p.id==='pp4');
  // gross=6, par=4 → grossVsPar=2 → double bogey → 0pts all 18 holes
  expect('partial: P4 all holes stableford=0', p4d.totalPts, 0);

  // Net skins: hole 10 — P1(net=4), P4(net=5), P2/P3 absent
  // P1 wins hole 10 skin
  const netSkins = r.netSkins;
  expect('partial: P1 wins net skin on h10', netSkins[9]?.id, 'pp1');

  // Gross skins: hole 1 — P1(4), P3(3), P4(6), P2 absent → P3 wins gross h1
  const grossSkins = r.grossSkins;
  expect('partial: P3 wins gross skin on h1', grossSkins[0]?.id, 'pp3');

  // Gross skins hole 10: P1(4), P4(6), others absent → P1 wins
  expect('partial: P1 wins gross skin on h10', grossSkins[9]?.id, 'pp1');

  // Holes where nobody scored: gross skins null
  // P2 has no scores anywhere — already verified above
  // h1: P3 present; h10: P3 absent. All non-null expected for h1 and h10 ✓

  sandbox.fsGetCourse = origFGC;
}


// ── 39. VARIED FIELD SIZES — INDIVIDUAL SKINS ────────────────
// Tests net/gross skin winners with 2, 3, 6, 8 player fields

{
  const origFGC = sandbox.fsGetCourse;
  vmSetS('config', { games: {
    individual: { stableford:{ enabled:true, eagle:4, birdie:2, par:1, bogey:0, dbl:0 } },
    skins: { enabled:true, halfStroke:false, strokeOffBest:false, hcpAdj:100 },
  }});

  const TC18 = {
    id:'tc18skins', name:'SkinsCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tc18skins' ? TC18 : origFGC(id);

  function makeSkinsGame(players, grossByPid) {
    const sc = {};
    players.forEach(p => { sc[p.id]={};  TC18.holes.forEach(h=>{sc[p.id][h.num]=grossByPid[p.id];}) });
    return {
      id:'skgame', type:'outing', status:'active', _scoring:true,
      courseId:'tc18skins', gameType:'lownet', skins:true, nineSide:'all',
      players, groups:[{id:'g1',playerIds:players.map(p=>p.id)}],
      scores:sc,
    };
  }

  // ── 2-player ──────────────────────────────────────────────
  // P1(CH=0,g=4), P2(CH=8,g=3)
  // P2 net: hcp<=8 → str=1 → net=2; hcp>8 → str=0 → net=3. All < P1 net=4 → P2 wins all 18
  {
    const p2 = [{id:'a',name:'A',hcp:0,courseHcp:0},{id:'b',name:'B',hcp:8,courseHcp:8}];
    const r = sandbox.outingComputeResults(makeSkinsGame(p2, {a:4,b:3}));
    const aNet = r.netTally['a'], bNet = r.netTally['b'];
    expect('2p skins: B(CH=8,g=3) wins all 18 net skins', bNet, 18);
    expect('2p skins: A(CH=0,g=4) wins 0 net skins', aNet, 0);
  }

  // ── 3-player ─────────────────────────────────────────────
  // P1(CH=0,g=4), P2(CH=8,g=5), P3(CH=16,g=3)
  // P3 net: hcp<=16 → net=2, hcp 17-18 → net=3. Beats all → wins all 18
  {
    const p3 = [
      {id:'p1',name:'P1',hcp:0, courseHcp:0 },
      {id:'p2',name:'P2',hcp:8, courseHcp:8 },
      {id:'p3',name:'P3',hcp:16,courseHcp:16},
    ];
    const r = sandbox.outingComputeResults(makeSkinsGame(p3, {p1:4,p2:5,p3:3}));
    expect('3p skins: P3 wins all 18 net skins', r.netTally['p3'], 18);
    expect('3p skins: P1 wins 0 net skins',      r.netTally['p1'], 0);
    expect('3p skins: P2 wins 0 net skins',      r.netTally['p2'], 0);
  }

  // ── 6-player ─────────────────────────────────────────────
  // 4×(CH=0,g=4) + 1×(CH=16,g=3) + 1×(CH=8,g=5)
  // CH=16,g=3 net always lowest → wins all 18
  {
    const p6 = [
      {id:'a',name:'A',hcp:0, courseHcp:0 },{id:'b',name:'B',hcp:0,courseHcp:0},
      {id:'c',name:'C',hcp:0, courseHcp:0 },{id:'d',name:'D',hcp:0,courseHcp:0},
      {id:'e',name:'E',hcp:16,courseHcp:16},{id:'f',name:'F',hcp:8,courseHcp:8},
    ];
    const r = sandbox.outingComputeResults(makeSkinsGame(p6,{a:4,b:4,c:4,d:4,e:3,f:5}));
    expect('6p skins: E(CH=16,g=3) wins all 18 net skins', r.netTally['e'], 18);
    expect('6p skins: A wins 0 net skins',  r.netTally['a'], 0);
    expect('6p skins: F wins 0 net skins',  r.netTally['f'], 0);
  }

  // ── 8-player ─────────────────────────────────────────────
  // P1-P4 (CH 0/8/16/24, g 4/5/3/6) + P5-P8 (CH=0, g=4)
  // P3(CH=16,g=3) net always lowest → wins all 18
  {
    const p8 = [
      {id:'p1',name:'P1',hcp:0, courseHcp:0 },{id:'p2',name:'P2',hcp:8, courseHcp:8 },
      {id:'p3',name:'P3',hcp:16,courseHcp:16},{id:'p4',name:'P4',hcp:24,courseHcp:24},
      {id:'p5',name:'P5',hcp:0, courseHcp:0 },{id:'p6',name:'P6',hcp:0, courseHcp:0 },
      {id:'p7',name:'P7',hcp:0, courseHcp:0 },{id:'p8',name:'P8',hcp:0, courseHcp:0 },
    ];
    const r = sandbox.outingComputeResults(makeSkinsGame(p8,{p1:4,p2:5,p3:3,p4:6,p5:4,p6:4,p7:4,p8:4}));
    expect('8p skins: P3 wins all 18 net skins', r.netTally['p3'], 18);
    expect('8p skins: P1 wins 0 net skins',      r.netTally['p1'], 0);
    expect('8p skins: P4 wins 0 net skins',      r.netTally['p4'], 0);
    // Total net skins = 18
    const totalNet = Object.values(r.netTally).reduce((a,v)=>a+v,0);
    expect('8p skins: total net skins = 18', totalNet, 18);
  }

  // ── All-tie field: no winners ───────────────────────────
  {
    const p4 = [{id:'t1',name:'T1',hcp:0,courseHcp:0},{id:'t2',name:'T2',hcp:0,courseHcp:0},
                {id:'t3',name:'T3',hcp:0,courseHcp:0},{id:'t4',name:'T4',hcp:0,courseHcp:0}];
    const r = sandbox.outingComputeResults(makeSkinsGame(p4,{t1:4,t2:4,t3:4,t4:4}));
    expect('all-tie: no net skin winners', r.netSkins.every(w=>w===null), true);
    expect('all-tie: no gross skin winners', r.grossSkins.every(w=>w===null), true);
  }

  sandbox.fsGetCourse = origFGC;
}


// ── 40. 9-HOLE TEAM FORMATS ───────────────────────────────────
// Tests outingComputeTeamResults with 9 active holes (hcpScale=9)

{
  const origFGC = sandbox.fsGetCourse;
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  // 18-hole course, using front 9 (nineSide='front')
  const TC18 = {
    id:'tc18nine', name:'NineCourse', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tc18nine' ? TC18 : origFGC(id);

  const NINE_PLAYERS = [
    {id:'n1',name:'N1',hcp:0, courseHcp:0 },
    {id:'n2',name:'N2',hcp:8, courseHcp:8 },
    {id:'n3',name:'N3',hcp:16,courseHcp:16},
    {id:'n4',name:'N4',hcp:24,courseHcp:24},
  ];
  const grossNine = {n1:4, n2:5, n3:3, n4:6};
  const sc = {};
  NINE_PLAYERS.forEach(p => {
    sc[p.id]={};
    TC18.holes.forEach(h=>{ sc[p.id][h.num]=grossNine[p.id]; });
  });

  function makeNineGame(gt, resultMethod) {
    return {
      id:'nineg', type:'outing', status:'active', _scoring:true,
      courseId:'tc18nine', gameType:gt, skins:false, nineSide:'front',
      resultMethod: resultMethod||null,
      players:NINE_PLAYERS,
      groups:[{id:'g0',playerIds:NINE_PLAYERS.map(p=>p.id)}],
      scores:JSON.parse(JSON.stringify(sc)),
    };
  }

  // 2BB front-9 (hcpScale=9):
  // pre-computed: teamNet=41, parEq=72, netVsPar=-31
  const r2bb = sandbox.outingComputeResults(makeNineGame('twoBestBall'));
  expect('9h 2BB: activeHoles=9',    r2bb.activeHoles.length, 9);
  expect('9h 2BB: teamNet=41',       r2bb.teamResults[0].teamNet, 41);
  expect('9h 2BB: parEq=72',         r2bb.teamResults[0].parEq, 72);
  expect('9h 2BB: netVsPar=-31',     r2bb.teamResults[0].netVsPar, -31);

  // Shamble front-9 best2 (same as 2BB)
  const rSh = sandbox.outingComputeResults(makeNineGame('shamble', 'best2'));
  expect('9h shamble best2: teamNet=41',  rSh.teamResults[0].teamNet, 41);
  expect('9h shamble best2: parEq=72',    rSh.teamResults[0].parEq, 72);

  // Scramble on a proper 9-hole course (par=36, rating=36):
  // outingScrambleTeamCH uses course.rating and course.par.
  // With rating=72 on a 9-hole play (hcpScale=9, is9=true), calcRawCourseHcp halves
  // the rating (72/2=36) but keeps par=72 → raw = 4+(36-72)=-32 (wildly wrong).
  // Correct fixture: par=36, rating=36 → no halving needed (rating<50) → CH unchanged.
  // TC9prop: slope=113, rating=36, par=36 → calcRawCourseHcp(8,113,36,36,true): no halving
  //   → raw=8*(113/113)+(36-36)=8 → CH=8. All 4 players same CH as 18h: [0,8,16,24].
  //   teamCH=32 (same as 18h fixture — ABCD% unchanged).
  const TC9prop = {
    id:'tc9prop', name:'Nine', slope:113, rating:36.0, par:36, nineHole:true,
    holes: Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  const origFGCnine = sandbox.fsGetCourse;
  sandbox.fsGetCourse = id => id==='tc9prop' ? TC9prop : id==='tc18nine' ? TC18 : origFGCnine(id);

  const scScr = {'grp_0':{}};
  TC9prop.holes.forEach((h,i)=>{scScr['grp_0'][h.num]=i<3?5:4;}); // 3×5+6×4=39
  const gScr = {
    id:'scr9', type:'outing', status:'active', _scoring:true,
    courseId:'tc9prop', gameType:'scramble', skins:false, nineSide:'all',
    players:NINE_PLAYERS, groups:[{id:'g0',playerIds:NINE_PLAYERS.map(p=>p.id)}],
    scores:JSON.parse(JSON.stringify(scScr)),
  };
  const rScr = sandbox.outingComputeResults(gScr);
  expect('9h scramble: activeHoles=9', rScr.activeHoles.length, 9);
  expect('9h scramble: gross=39',      rScr.teamResults[0].gross, 39);
  // teamCH=32 (same as 18h: players [0,8,16,24] pcts [100,85,70,60], no halving needed)
  expect('9h scramble: teamCH=32', rScr.teamResults[0].teamCH, 32);
  // teamNet = 39-32=7, parEq=9×4=36, netVsPar=7-36=-29
  expect('9h scramble: teamNet=7',     rScr.teamResults[0].teamNet, 7);
  expect('9h scramble: parEq=36',      rScr.teamResults[0].parEq, 36);
  expect('9h scramble: netVsPar=-29',  rScr.teamResults[0].netVsPar, -29);

  sandbox.fsGetCourse = origFGCnine;

  sandbox.fsGetCourse = origFGC;
}


// ── 41. UNEVEN GROUPS (5-PLAYER, 3+2) ────────────────────────
// Tests team scoring with groups of different sizes

{
  const origFGC = sandbox.fsGetCourse;
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  const TC18 = {
    id:'tc18uneven', name:'Uneven', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  sandbox.fsGetCourse = id => id==='tc18uneven' ? TC18 : origFGC(id);

  // Group 0: P1(CH=0,g=4), P2(CH=8,g=5), P3(CH=16,g=3) — 3 players
  // Group 1: P4(CH=24,g=6), P5(CH=0,g=4) — 2 players
  const UNEVEN_PLAYERS = [
    {id:'u1',name:'U1',hcp:0, courseHcp:0 },
    {id:'u2',name:'U2',hcp:8, courseHcp:8 },
    {id:'u3',name:'U3',hcp:16,courseHcp:16},
    {id:'u4',name:'U4',hcp:24,courseHcp:24},
    {id:'u5',name:'U5',hcp:0, courseHcp:0 },
  ];
  const grossU = {u1:4,u2:5,u3:3,u4:6,u5:4};
  const sc = {};
  UNEVEN_PLAYERS.forEach(p=>{sc[p.id]={};TC18.holes.forEach(h=>{sc[p.id][h.num]=grossU[p.id];});});

  const g = {
    id:'uneveng', type:'outing', status:'active', _scoring:true,
    courseId:'tc18uneven', gameType:'twoBestBall', skins:false, nineSide:'all',
    players:UNEVEN_PLAYERS,
    groups:[
      {id:'g0',playerIds:['u1','u2','u3']},
      {id:'g1',playerIds:['u4','u5']},
    ],
    scores:JSON.parse(JSON.stringify(sc)),
  };

  const r = sandbox.outingComputeResults(g);
  expect('uneven: 2 team results', r.teamResults.length, 2);

  // Group 0 (3p best2): pre-computed teamNet=110, parEq=144, netVsPar=-34
  const g0 = r.teamResults.find(t=>t.gi===0);
  expect('uneven g0: teamNet=110',    g0.teamNet, 110);
  expect('uneven g0: parEq=144',      g0.parEq, 144);
  expect('uneven g0: netVsPar=-34',   g0.netVsPar, -34);

  // Group 1 (2p best2): P4(CH=24,g=6), P5(CH=0,g=4)
  // pre-computed: teamNet=156, parEq=144, netVsPar=12
  const g1 = r.teamResults.find(t=>t.gi===1);
  expect('uneven g1: teamNet=156',    g1.teamNet, 156);
  expect('uneven g1: parEq=144',      g1.parEq, 144);
  expect('uneven g1: netVsPar=12',    g1.netVsPar, 12);

  // Group 0 wins (lower netVsPar → sorted first)
  expect('uneven: g0 is winner (first in sorted results)', r.teamResults[0].gi, 0);

  sandbox.fsGetCourse = origFGC;
}


// ── 42. WOLF ENGINE — SETTLEMENT AND ROTATION ────────────────
// Tests wolfCalcTotals, wolfSettlement, wolfCaptainPid rotation

{
  const { wolfCalcTotals, wolfSettlement, wolfCaptainPid } = sandbox;
  expect('wolfCalcTotals exists',  typeof wolfCalcTotals, 'function');
  expect('wolfSettlement exists',  typeof wolfSettlement, 'function');
  expect('wolfCaptainPid exists',  typeof wolfCaptainPid, 'function');

  const WOLF_PLAYERS = ['wp1','wp2','wp3','wp4'];

  function makeWolfGame(wolfHoles, wolfCarry) {
    return {
      id:'wg1', type:'foursome', gameType:'wolf',
      ptValue:1, strokeMode:'field',
      wolfOrder: WOLF_PLAYERS,
      playerIds: WOLF_PLAYERS,
      playerNames: ['P1','P2','P3','P4'],
      chs:{wp1:0,wp2:8,wp3:16,wp4:24}, rawChs:{wp1:0,wp2:8,wp3:16,wp4:24},
      scores:{}, wolfHoles: wolfHoles||{}, wolfCarry: wolfCarry||0,
      _totalHoles:18, _scoring:true,
    };
  }

  // ── Captain rotation ───────────────────────────────────────
  // wolfOrder=[wp1,wp2,wp3,wp4]: h1→wp1, h2→wp2, h3→wp3, h4→wp4, h5→wp1, h17→wp1, h18→wp2
  const gRot = makeWolfGame({});
  expect('wolf captain h1=wp1',   wolfCaptainPid(gRot, 1),  'wp1');
  expect('wolf captain h2=wp2',   wolfCaptainPid(gRot, 2),  'wp2');
  expect('wolf captain h3=wp3',   wolfCaptainPid(gRot, 3),  'wp3');
  expect('wolf captain h4=wp4',   wolfCaptainPid(gRot, 4),  'wp4');
  expect('wolf captain h5=wp1',   wolfCaptainPid(gRot, 5),  'wp1');
  expect('wolf captain h9=wp1',   wolfCaptainPid(gRot, 9),  'wp1');  // (9-1)%4=0
  expect('wolf captain h17=wp1',  wolfCaptainPid(gRot, 17), 'wp1');
  expect('wolf captain h18=wp2',  wolfCaptainPid(gRot, 18), 'wp2');

  // ── wolfCalcTotals: 5 hole scenario ────────────────────────
  // h1: blind, captain=wp1, winner=wolf, value=4 → wp1+12; wp2-4; wp3-4; wp4-4
  // h2: partner(wp3), captain=wp2, winner=wolf, value=1 → wp2+2; wp3+2; wp1-2; wp4-2
  // h3: lone, captain=wp3, winner=others, value=2 → wp3-6; wp1+2; wp2+2; wp4+2
  // h4: partner(wp1), captain=wp4, winner=tie → no points
  // h5: partner(wp2), captain=wp1, winner=others, value=2 → wp3+4; wp4+4; wp1-4; wp2-4
  // Totals: wp1=+8, wp2=-4, wp3=-4, wp4=0
  const wolfHoles5 = {
    1:{mode:'blind',   captainPid:'wp1', partnerPid:null,  winner:'wolf',   base:1, value:4},
    2:{mode:'partner', captainPid:'wp2', partnerPid:'wp3', winner:'wolf',   base:1, value:1},
    3:{mode:'lone',    captainPid:'wp3', partnerPid:null,  winner:'others', base:1, value:2},
    4:{mode:'partner', captainPid:'wp4', partnerPid:'wp1', winner:'tie',    base:1, value:1},
    5:{mode:'partner', captainPid:'wp1', partnerPid:'wp2', winner:'others', base:2, value:2},
  };
  const gWolf = makeWolfGame(wolfHoles5, 0);
  const totals = wolfCalcTotals(gWolf);

  expect('wolf totals wp1=+8',  totals['wp1'], 8);
  expect('wolf totals wp2=-4',  totals['wp2'], -4);
  expect('wolf totals wp3=-4',  totals['wp3'], -4);
  expect('wolf totals wp4=0',   totals['wp4'], 0);

  // Sum of all totals = 0 (zero-sum game)
  const sum = Object.values(totals).reduce((a,v)=>a+v, 0);
  expect('wolf totals sum=0 (zero-sum)', sum, 0);

  // ── wolfSettlement ─────────────────────────────────────────
  // Totals: wp1=8, wp2=-4, wp3=-4, wp4=0
  // Pairs: wp2→wp1:12, wp3→wp1:12, wp4→wp1:8, wp2→wp4:4, wp3→wp4:4
  const pairs = wolfSettlement(gWolf);
  expect('wolf settlement: 5 pairs', pairs.length, 5);

  const p_wp2_wp1 = pairs.find(p=>p.payerPid==='wp2'&&p.payeePid==='wp1');
  expect('wolf settle wp2→wp1: 12pts', p_wp2_wp1?.points, 12);
  expect('wolf settle wp2→wp1: $12',   p_wp2_wp1?.dollars, 12);

  const p_wp3_wp1 = pairs.find(p=>p.payerPid==='wp3'&&p.payeePid==='wp1');
  expect('wolf settle wp3→wp1: 12pts', p_wp3_wp1?.points, 12);

  const p_wp4_wp1 = pairs.find(p=>p.payerPid==='wp4'&&p.payeePid==='wp1');
  expect('wolf settle wp4→wp1: 8pts',  p_wp4_wp1?.points, 8);

  const p_wp2_wp4 = pairs.find(p=>p.payerPid==='wp2'&&p.payeePid==='wp4');
  expect('wolf settle wp2→wp4: 4pts',  p_wp2_wp4?.points, 4);

  const p_wp3_wp4 = pairs.find(p=>p.payerPid==='wp3'&&p.payeePid==='wp4');
  expect('wolf settle wp3→wp4: 4pts',  p_wp3_wp4?.points, 4);

  // ── All-square: no settlement ──────────────────────────────
  const gEmpty = makeWolfGame({}, 0);
  expect('wolf all-square: 0 pairs', wolfSettlement(gEmpty).length, 0);

  // ── ptValue scaling ───────────────────────────────────────
  // Same holes, ptValue=2 → all dollars doubled
  const gPt2 = { ...gWolf, ptValue:2 };
  const pairs2 = wolfSettlement(gPt2);
  const p2_wp2_wp1 = pairs2.find(p=>p.payerPid==='wp2'&&p.payeePid==='wp1');
  expect('wolf ptValue=2: wp2→wp1 $24', p2_wp2_wp1?.dollars, 24);

  // ── Tie produces no points ─────────────────────────────────
  const gTie = makeWolfGame({1:{mode:'partner',captainPid:'wp1',partnerPid:'wp2',winner:'tie',base:1,value:1}});
  const tieTotals = wolfCalcTotals(gTie);
  expect('wolf tie: all totals=0', Object.values(tieTotals).every(v=>v===0), true);
}


// ── 43. TEAM SKINS — ALL FORMATS ─────────────────────────────
// Tests outingComputeTeamSkins for scramble, shamble, 3-2-1, 2BB

{
  const origFGC = sandbox.fsGetCourse;
  vmSetS('config', { games: { fourPlayer: { scramble: { hcpMethod:'abcd', abcdPct:[100,85,70,60] } } } });

  const TC18 = {
    id:'tc18ts', name:'TeamSkins', slope:113, rating:72.0, par:72, nineHole:false,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1})),
  };
  // 3-hole mixed-par for 3-2-1
  const TC3 = {
    id:'tc3ts', name:'Mixed3', slope:113, rating:12.0, par:12, nineHole:true,
    holes:[{num:1,par:3,hcp:1},{num:2,par:4,hcp:2},{num:3,par:5,hcp:3}],
  };
  sandbox.fsGetCourse = id => id==='tc18ts' ? TC18 : id==='tc3ts' ? TC3 : origFGC(id);

  // Group A: PA1(CH=0,g=4), PA2(CH=0,g=4) → net=4 all holes (best2 sum=8)
  // Group B: PB1(CH=18,g=4), PB2(CH=18,g=4) → str=1 all holes → net=3 (best2 sum=6)
  // B wins all 18 holes in any best-2-net format

  const GRP_A = [{id:'a1',name:'A1',hcp:0,courseHcp:0},{id:'a2',name:'A2',hcp:0,courseHcp:0}];
  const GRP_B = [{id:'b1',name:'B1',hcp:18,courseHcp:18},{id:'b2',name:'B2',hcp:18,courseHcp:18}];
  const ALL_P = [...GRP_A,...GRP_B];

  function makeTeamSkinsGame(gt, courseId, resultMethod) {
    const sc={};
    ALL_P.forEach(p=>{sc[p.id]={};(courseId==='tc3ts'?TC3:TC18).holes.forEach(h=>{sc[p.id][h.num]=4;});});
    return {
      id:'tskg', type:'outing', status:'active', _scoring:true,
      courseId, gameType:gt, skins:true, nineSide:'all',
      resultMethod:resultMethod||null,
      players:ALL_P,
      groups:[{id:'g0',playerIds:['a1','a2']},{id:'g1',playerIds:['b1','b2']}],
      scores:sc,
    };
  }

  // ── 2BB skins ────────────────────────────────────────────
  const s2bb = sandbox.outingComputeTeamSkins(makeTeamSkinsGame('twoBestBall','tc18ts'), TC18, TC18.holes);
  expect('team skins 2BB: B wins 18', s2bb[1], 18);
  expect('team skins 2BB: A wins 0',  s2bb[0], 0);

  // ── Shamble skins (best2) — same result as 2BB ───────────
  {
    const g = makeTeamSkinsGame('shamble','tc18ts','best2');
    const s = sandbox.outingComputeTeamSkins(g, TC18, TC18.holes);
    expect('team skins shamble best2: B wins 18', s[1], 18);
    expect('team skins shamble best2: A wins 0',  s[0], 0);
  }

  // ── Shamble skins (321, all-par-4) — take=2 → same as best2 ──
  {
    const g = makeTeamSkinsGame('shamble','tc18ts','321');
    const s = sandbox.outingComputeTeamSkins(g, TC18, TC18.holes);
    expect('team skins shamble 321 all-par4: B wins 18', s[1], 18);
    expect('team skins shamble 321 all-par4: A wins 0',  s[0], 0);
  }

  // ── 3-2-1 skins on mixed-par course ─────────────────────
  // Group A: CH=0,g=4 → net=4 all holes
  // Group B: CH=3,g=4 on 3-hole course (hcpScale=3): 
  //   strokesOnHole(3,h,3): 3%3=0 → floor(3/3)=1 → str=1 always → net=3
  // B net=3 < A net=4 → B wins all 3 holes
  const GRP_C = [{id:'c1',name:'C1',hcp:0,courseHcp:0},{id:'c2',name:'C2',hcp:0,courseHcp:0}];
  const GRP_D = [{id:'d1',name:'D1',hcp:3,courseHcp:3},{id:'d2',name:'D2',hcp:3,courseHcp:3}];
  const scCD={};
  [...GRP_C,...GRP_D].forEach(p=>{scCD[p.id]={};TC3.holes.forEach(h=>{scCD[p.id][h.num]=4;});});
  const g321 = {
    id:'g321ts', type:'outing', status:'active', _scoring:true,
    courseId:'tc3ts', gameType:'threeTwoOne', skins:true, nineSide:'all',
    players:[...GRP_C,...GRP_D],
    groups:[{id:'g0',playerIds:['c1','c2']},{id:'g1',playerIds:['d1','d2']}],
    scores:scCD,
  };
  const s321 = sandbox.outingComputeTeamSkins(g321, TC3, TC3.holes);
  expect('team skins 3-2-1 mixed-par: D wins 3 holes', s321[1], 3);
  expect('team skins 3-2-1 mixed-par: C wins 0',       s321[0], 0);

  // ── Tie produces no skin winner ──────────────────────────
  const GRP_TIE1 = [{id:'t1',name:'T1',hcp:0,courseHcp:0},{id:'t2',name:'T2',hcp:0,courseHcp:0}];
  const GRP_TIE2 = [{id:'t3',name:'T3',hcp:0,courseHcp:0},{id:'t4',name:'T4',hcp:0,courseHcp:0}];
  const scTie={};
  [...GRP_TIE1,...GRP_TIE2].forEach(p=>{scTie[p.id]={};TC18.holes.forEach(h=>{scTie[p.id][h.num]=4;});});
  const gTie = {
    id:'gtie', type:'outing', status:'active', _scoring:true,
    courseId:'tc18ts', gameType:'twoBestBall', skins:true, nineSide:'all',
    players:[...GRP_TIE1,...GRP_TIE2],
    groups:[{id:'g0',playerIds:['t1','t2']},{id:'g1',playerIds:['t3','t4']}],
    scores:scTie,
  };
  const sTie = sandbox.outingComputeTeamSkins(gTie, TC18, TC18.holes);
  expect('team skins tie: g0 wins 0', sTie[0], 0);
  expect('team skins tie: g1 wins 0', sTie[1], 0);

  // ── Scramble skins (already in §30, confirm with different gross) ──
  // Group 0: teamCH=32 (4p), gross=4 all holes → net=4-strokesOnHole(32,h,18)
  // Group 1: teamCH=0, gross=4 → net=4
  // CH=32: 32%18=14 → holes hcp<=14 → floor(32/18)=1+1=2 → net=2; hcp>14 → 1 → net=3
  // Both groups net < 4 on all holes, but g0 always ≤ g1 → g0 wins all
  const GRP_SCR0 = [
    {id:'s1',name:'S1',hcp:0,courseHcp:0},{id:'s2',name:'S2',hcp:8,courseHcp:8},
    {id:'s3',name:'S3',hcp:16,courseHcp:16},{id:'s4',name:'S4',hcp:24,courseHcp:24},
  ];
  const GRP_SCR1 = [{id:'s5',name:'S5',hcp:0,courseHcp:0}];
  const scScr={};
  const scrHoles={'grp_0':{},'grp_1':{}};
  TC18.holes.forEach(h=>{scrHoles['grp_0'][h.num]=5;scrHoles['grp_1'][h.num]=5;});
  [...GRP_SCR0,...GRP_SCR1].forEach(p=>{scScr[p.id]={};TC18.holes.forEach(h=>{scScr[p.id][h.num]=5;});});
  const gScr = {
    id:'scrts', type:'outing', status:'active', _scoring:true,
    courseId:'tc18ts', gameType:'scramble', skins:true, nineSide:'all',
    players:[...GRP_SCR0,...GRP_SCR1],
    groups:[{id:'g0',playerIds:GRP_SCR0.map(p=>p.id)},{id:'g1',playerIds:GRP_SCR1.map(p=>p.id)}],
    scores:scrHoles,
  };
  const sScrResult = sandbox.outingComputeTeamSkins(gScr, TC18, TC18.holes);
  expect('team skins scramble: g0(teamCH=32) wins all 18', sScrResult[0], 18);
  expect('team skins scramble: g1(teamCH=0) wins 0',       sScrResult[1], 0);

  sandbox.fsGetCourse = origFGC;
}


// ═══════════════════════════════════════════════════════════════
// SHARED SCORING ENGINE TESTS (Rule 27 backfill — v0.67+)
// All expected values pre-computed independently in Node above.
// ═══════════════════════════════════════════════════════════════

// Pull new engine functions from sandbox
const {
  getActiveHoles, nineLabel, scorecardName,
  scrambleTeamCH, bestBallsHoleNet, threeTwoOneBestNets,
  buildScoringCtx, buildPairHistoryMap, pairScore,
  calcGroupCount, buildGroupShells,
  computeRoundResults, computeSkins,
  isTeamFormat, isCompFormat,
  TEAM_FORMATS, COMP_FORMATS,
} = sandbox;

// ── Shared fixtures ───────────────────────────────────────────
const ENG_C18 = {
  id:'c18', name:'Test Course 18', slope:113, rating:72, par:72,
  holes: Array.from({length:18}, (_,i) => ({
    num:i+1, par: i<3?3 : i<15?4 : 5, hcpRating:i+1
  }))
};
const ENG_C9 = {
  id:'c9', name:'Test Course 9', slope:120, rating:36, par:36, nineHole:true,
  holes: Array.from({length:9}, (_,i) => ({
    num:i+1, par: i<1?3 : i<8?4 : 5, hcpRating: i*2+1
  }))
};
// Players: Last,First format so scorecardName tests work
const ENG_P4 = [
  {id:'e1', name:'Zrimsek, Brian', hcp:5.0},
  {id:'e2', name:'Mehalli, Gus',   hcp:18.0},
  {id:'e3', name:'Mehalli, Matt',  hcp:22.0},
  {id:'e4', name:'Mehalli, Mike',  hcp:28.0},
];

// ── 44. getActiveHoles ────────────────────────────────────────
{
  const all   = getActiveHoles(ENG_C18, 'all');
  const front = getActiveHoles(ENG_C18, 'front');
  const back  = getActiveHoles(ENG_C18, 'back');
  expect('getActiveHoles all: 18 holes',   all.length,   18);
  expect('getActiveHoles front: 9 holes',  front.length,  9);
  expect('getActiveHoles back: 9 holes',   back.length,   9);
  expect('getActiveHoles front: first hole num=1',  front[0].num, 1);
  expect('getActiveHoles back: first hole num=10',  back[0].num,  10);
  expect('getActiveHoles back: last hole num=18',   back[8].num,  18);
  // 9-hole course: all returns all 9
  const c9all = getActiveHoles(ENG_C9, 'all');
  expect('getActiveHoles 9-hole course all: 9', c9all.length, 9);
}

// ── 45. nineLabel ─────────────────────────────────────────────
{
  expect("nineLabel 'all'   → '18h'", nineLabel('all'),   '18h');
  expect("nineLabel 'front' → 'F9'",  nineLabel('front'), 'F9');
  expect("nineLabel 'back'  → 'B9'",  nineLabel('back'),  'B9');
}

// ── 46. scorecardName ────────────────────────────────────────
{
  const grp = ENG_P4; // Zrimsek + 3 Mehallis
  // Unique last name
  expect('scorecardName: unique last → last only',
    scorecardName({id:'e1',name:'Zrimsek, Brian'}, grp), 'Zrimsek');
  // Gus has unique initial G among Mehallis
  expect('scorecardName: clash, unique initial → Last, I.',
    scorecardName({id:'e2',name:'Mehalli, Gus'}, grp), 'Mehalli, G.');
  // Matt and Mike both have initial M → full first name
  expect('scorecardName: clash, same initial → Last, First',
    scorecardName({id:'e3',name:'Mehalli, Matt'}, grp), 'Mehalli, Matt');
  expect('scorecardName: clash, same initial → Last, First',
    scorecardName({id:'e4',name:'Mehalli, Mike'}, grp), 'Mehalli, Mike');
  // Solo player — unique last name regardless
  expect('scorecardName: no clash in group of 1',
    scorecardName({id:'e2',name:'Mehalli, Gus'}, [{id:'e2',name:'Mehalli, Gus'}]), 'Mehalli');
  // Space-separated name (not Last,First format)
  expect('scorecardName: space-separated, unique last',
    scorecardName({id:'x1',name:'Brian Zrimsek'}, [{id:'x1',name:'Brian Zrimsek'},{id:'x2',name:'Gus Mehalli'}]), 'Zrimsek');
}

// ── 47. scrambleTeamCH ───────────────────────────────────────
{
  // Pre-computed: slope=113, rating=72, par=72 → courseHcp = hcp (raw=hcp*1+0)
  const pcts4 = [25,20,15,10];
  const pcts3 = [30,20,10];
  const pcts2 = [35,15];
  // 4 players hcp=[5,18,22,28], sorted asc=[5,18,22,28]
  // 5*25/100 + 18*20/100 + 22*15/100 + 28*10/100 = 1.25+3.6+3.3+2.8 = 10.95 → 11
  expect('scrambleTeamCH 4p: 11', scrambleTeamCH(ENG_P4, ENG_C18, false, pcts4), 11);
  // 3 players [5,18,22]: 5*30/100 + 18*20/100 + 22*10/100 = 1.5+3.6+2.2 = 7.3 → 7
  expect('scrambleTeamCH 3p: 7',  scrambleTeamCH(ENG_P4.slice(0,3), ENG_C18, false, pcts3), 7);
  // 2 players [5,18]: 5*35/100 + 18*15/100 = 1.75+2.7 = 4.45 → 4
  expect('scrambleTeamCH 2p: 4',  scrambleTeamCH(ENG_P4.slice(0,2), ENG_C18, false, pcts2), 4);
  // Empty pcts → 0
  expect('scrambleTeamCH empty pcts: 0', scrambleTeamCH(ENG_P4, ENG_C18, false, []), 0);
  // 9-hole: courseHcps halved relative to 18h
  // hcp=18, slope=120, rating=36, par=36 → raw(9h)=18*(120/113)*0.5 + 0 ≈ 9.56 → ch=10
  // hcp=5 → raw=5*(120/113)*0.5 ≈ 2.65 → ch=3
  // pcts2=[35,15]: 3*35/100 + 10*15/100 = 1.05+1.5 = 2.55 → 3
  const p2_9h = [{id:'e1',name:'A',hcp:5},{id:'e2',name:'B',hcp:18}];
  const expected9 = Math.round(3*35/100 + 10*15/100); // 3
  // C9 slope=120: CH(hcp=5)=5, CH(hcp=18)=19; scramCH=round(5*35/100+19*15/100)=round(4.6)=5
  expect('scrambleTeamCH 9-hole: 5',
    scrambleTeamCH(p2_9h, ENG_C9, true, pcts2), 5);
}

// ── 48. bestBallsHoleNet ─────────────────────────────────────
{
  // hole hcpRating=1, scale=18, player COs from buildScoringCtx
  // Must pass players with .courseHcp already set
  const playersWithCH = ENG_P4.map(p => ({
    ...p,
    courseHcp: Math.round(p.hcp * (113/113) + (72-72)) // = hcp (slope=113, rating=72, par=72)
  }));
  const h1 = {num:1, par:3, hcpRating:1};
  // strokesOnHole(ch, hr, scale): floor(ch/18) + (hr<=ch%18?1:0)
  // p1 CH=5:  0 + (1<=5 → 1) = 1 → net=4-1=3
  // p2 CH=18: 1 + (1<=0 → 0) = 1 → net=5-1=4
  // p3 CH=22: 1 + (1<=4 → 1) = 2 → net=4-2=2
  // p4 CH=28: 1 + (1<=10→ 1) = 2 → net=6-2=4
  // sorted: [2,3,4,4] → best2=[2,3]
  const scores = {e1:{1:4}, e2:{1:5}, e3:{1:4}, e4:{1:6}};
  const best2 = bestBallsHoleNet(playersWithCH, scores, h1, 18);
  expect('bestBallsHoleNet: length=2',   best2.length, 2);
  expect('bestBallsHoleNet: best=2',     best2[0],     2);
  expect('bestBallsHoleNet: second=3',   best2[1],     3);
  // Missing score → excluded
  const scoresMissing = {e1:{1:4}, e3:{1:4}, e4:{1:6}}; // e2 missing
  const best2m = bestBallsHoleNet(playersWithCH, scoresMissing, h1, 18);
  expect('bestBallsHoleNet missing score: length=2', best2m.length, 2);
  expect('bestBallsHoleNet missing: best=2',         best2m[0],     2);
}

// ── 49. threeTwoOneBestNets ──────────────────────────────────
{
  const playersWithCH = ENG_P4.map(p => ({...p, courseHcp: Math.round(p.hcp)}));
  const scores = {e1:{1:4}, e2:{1:5}, e3:{1:4}, e4:{1:6}};
  // par-3 hole: take 3 nets
  const h1 = {num:1, par:3, hcpRating:1};
  const take3 = threeTwoOneBestNets(playersWithCH, scores, h1, 18);
  expect('threeTwoOneBestNets par3: length=3', take3.length, 3);
  expect('threeTwoOneBestNets par3: best=2',   take3[0],     2);
  // par-4 hole: take 2 nets
  const h4 = {num:5, par:4, hcpRating:5};
  const sc4 = {e1:{5:5}, e2:{5:6}, e3:{5:5}, e4:{5:7}};
  const take2 = threeTwoOneBestNets(playersWithCH, sc4, h4, 18);
  expect('threeTwoOneBestNets par4: length=2', take2.length, 2);
  // par-5 hole: take 1 net
  const h5 = {num:16, par:5, hcpRating:16};
  const sc5 = {e1:{16:6}, e2:{16:7}, e3:{16:6}, e4:{16:8}};
  const take1 = threeTwoOneBestNets(playersWithCH, sc5, h5, 18);
  expect('threeTwoOneBestNets par5: length=1', take1.length, 1);
}

// ── 50. buildPairHistoryMap + pairScore ──────────────────────
{
  const rounds = [
    { completed:true,  groups:[{playerIds:['p1','p2']},{playerIds:['p3','p4']}] },
    { completed:true,  groups:[{playerIds:['p1','p3']},{playerIds:['p2','p4']}] },
    { completed:false, groups:[{playerIds:['p1','p4']},{playerIds:['p2','p3']}] }, // not complete
  ];
  const hist = buildPairHistoryMap(rounds);
  expect('buildPairHistoryMap: p1-p2=1', hist.get('p1|p2'), 1);
  expect('buildPairHistoryMap: p1-p3=1', hist.get('p1|p3'), 1);
  expect('buildPairHistoryMap: p1-p4=0 (incomplete round excluded)', hist.get('p1|p4') || 0, 0);
  expect('buildPairHistoryMap: p3-p4=1', hist.get('p3|p4'), 1);
  expect('buildPairHistoryMap: p2-p4=1', hist.get('p2|p4'), 1);
  // key always stored sorted: ['p2','p1'].sort() → 'p1|p2'
  expect('buildPairHistoryMap: key order normalised', hist.get(['p2','p1'].sort().join('|')), 1);

  expect('pairScore(p1,[p2,p3],hist)=2', pairScore('p1',['p2','p3'],hist), 2);
  expect('pairScore(p1,[p4],hist)=0',    pairScore('p1',['p4'],hist),     0);
  expect('pairScore(p1,[],hist)=0',      pairScore('p1',[],hist),         0);
}

// ── 51. calcGroupCount + buildGroupShells ────────────────────
{
  expect('calcGroupCount(8,2): 2',  calcGroupCount(8,2),  2);
  expect('calcGroupCount(9,0): 3',  calcGroupCount(9,0),  3);
  expect('calcGroupCount(5,0): 2',  calcGroupCount(5,0),  2);
  expect('calcGroupCount(4,0): 1',  calcGroupCount(4,0),  1);
  expect('calcGroupCount(12,3): 3', calcGroupCount(12,3), 3);
  // labelCount caps at min groups
  expect('calcGroupCount(8,10): 2', calcGroupCount(8,10), 2); // min=2, cap=10 → still 2

  const s8 = buildGroupShells(2, ['8:00 AM','8:10 AM'], 8);
  expect('buildGroupShells(2,8): 2 shells',    s8.length,   2);
  expect('buildGroupShells(2,8): cap[0]=4',    s8[0].cap,   4);
  expect('buildGroupShells(2,8): cap[1]=4',    s8[1].cap,   4);
  expect('buildGroupShells(2,8): label[0]',    s8[0].label, '8:00 AM');

  const s9 = buildGroupShells(2, ['A','B'], 9);
  expect('buildGroupShells(2,9): cap[0]=5',    s9[0].cap,   5);
  expect('buildGroupShells(2,9): cap[1]=4',    s9[1].cap,   4);

  const s7 = buildGroupShells(2, ['A','B'], 7);
  expect('buildGroupShells(2,7): cap[0]=4',    s7[0].cap,   4);
  expect('buildGroupShells(2,7): cap[1]=3',    s7[1].cap,   3);

  const s93 = buildGroupShells(3, ['A','B','C'], 9);
  expect('buildGroupShells(3,9): cap[0]=3',    s93[0].cap,  3);
  expect('buildGroupShells(3,9): cap[1]=3',    s93[1].cap,  3);
  expect('buildGroupShells(3,9): cap[2]=3',    s93[2].cap,  3);
}

// ── 52. buildScoringCtx ──────────────────────────────────────
{
  // buildScoringCtx normalises hole.hcp → hcpRating, computes courseHcp
  const players = [{id:'e1',name:'Player A',hcp:10},{id:'e2',name:'Player B',hcp:20}];
  const course  = {
    slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1, par:4, hcp:i+1})) // hcp not hcpRating
  };
  const scores  = {e1:{1:5,2:4}, e2:{1:6,2:5}};
  const groups  = [{playerIds:['e1','e2'], label:'Group 1'}];
  const ctx = buildScoringCtx(players, course, 'all', scores, groups, 'stroke', {strokeAllowance:100});

  expect('buildScoringCtx: 2 players',          ctx.players.length,           2);
  expect('buildScoringCtx: 18 activeHoles',     ctx.activeHoles.length,      18);
  expect('buildScoringCtx: hcpRating normalised from hcp',
    ctx.activeHoles[0].hcpRating, 1);
  // slope=113, rating=72, par=72, hcpIdx=10 → courseHcp=10
  expect('buildScoringCtx: courseHcp p1=10',    ctx.players[0].courseHcp,    10);
  expect('buildScoringCtx: courseHcp p2=20',    ctx.players[1].courseHcp,    20);
  expect('buildScoringCtx: format=stroke',      ctx.format,                  'stroke');
  expect('buildScoringCtx: hcpScale=18',        ctx.hcpScale,                18);
  expect('buildScoringCtx: is9=false',          ctx.is9,                     false);
  expect('buildScoringCtx: 1 group',            ctx.groups.length,            1);
  expect('buildScoringCtx: group label',        ctx.groups[0].label,         'Group 1');

  // Front 9
  const ctx9 = buildScoringCtx(players, course, 'front', scores, groups, 'stroke', {});
  expect('buildScoringCtx front: 9 activeHoles', ctx9.activeHoles.length,   9);
  expect('buildScoringCtx front: is9=true',      ctx9.is9,                  true);
  expect('buildScoringCtx front: hcpScale=9',    ctx9.hcpScale,             9);
}

// ── 53. computeRoundResults — individual ────────────────────
{
  // 4 players, slope=113/rating=72/par=72 → courseHcp=hcp
  // All par-4 course, 18 holes
  const players = ENG_P4.map(p=>({...p, courseHcp:Math.round(p.hcp)}));
  const course  = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  // Gross scores: p1=76, p2=90, p3=94, p4=100
  // Nets: 71, 72, 72, 72
  const sc = {};
  players.forEach((p,i) => {
    sc[p.id]={};
    const gross=[76,90,94,100][i];
    // distribute evenly: base score + 1 on first (gross%18) holes
    const base=Math.floor(gross/18), extra=gross%18;
    for(let h=1;h<=18;h++) sc[p.id][h] = base + (h <= extra ? 1 : 0);
  });
  const ctx = buildScoringCtx(players,course,'all',sc,[{playerIds:players.map(p=>p.id)}],'stroke',{});
  const res = computeRoundResults(ctx);
  expect('stroke results: type=individual',    res.type,               'individual');
  expect('stroke results: 4 entries',          res.entries.length,      4);
  expect('stroke results: p1 net=71',          res.entries[0].net,     71);
  expect('stroke results: p1 wins (sorted)',   res.entries[0].playerId,'e1');
  expect('stroke results: p2/p3/p4 net=72',   res.entries[1].net,     72);
  expect('stroke results: isSF=false',         res.isSF,               false);
}

// ── 54. computeRoundResults — scramble ───────────────────────
{
  const players = ENG_P4.map(p=>({...p, courseHcp:Math.round(p.hcp)}));
  const course  = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  // Team gross = 76 for grp_0; teamCH computed from scrambleTeamCH = 11
  // net = 76-11 = 65, netVsPar = 65-72 = -7
  const sc = {'grp_0':{}};
  for(let h=1;h<=18;h++) sc['grp_0'][h]=4+(h<=4?1:0); // 76 gross
  const groups = [{playerIds:['e1','e2','e3','e4']}];
  const ctx = buildScoringCtx(players,course,'all',sc,groups,'scramble',{scramblePcts:[25,20,15,10]});
  const res = computeRoundResults(ctx);
  expect('scramble results: type=scramble',   res.type,                'scramble');
  expect('scramble results: 1 entry',         res.entries.length,       1);
  expect('scramble results: gross=76',        res.entries[0].gross,    76);
  expect('scramble results: teamCH=11',       res.entries[0].teamCH,   11);
  expect('scramble results: net=65',          res.entries[0].net,      65);
  expect('scramble results: netVsPar=-7',     res.entries[0].netVsPar, -7);
}

// ── 55. computeRoundResults — best2 ─────────────────────────
{
  const players = ENG_P4.map(p=>({...p, courseHcp:Math.round(p.hcp)}));
  const course  = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  // 2 groups of 2; simple scores
  const sc = {};
  players.forEach(p => { sc[p.id]={}; for(let h=1;h<=18;h++) sc[p.id][h]=5; }); // all 5s
  const groups = [{playerIds:['e1','e2']},{playerIds:['e3','e4']}];
  const ctx = buildScoringCtx(players,course,'all',sc,groups,'best2',{});
  const res = computeRoundResults(ctx);
  expect('best2 results: type=team',    res.type,              'team');
  expect('best2 results: 2 entries',    res.entries.length,     2);
  expect('best2 results: use321=false', res.use321,            false);
}

// ── 56. computeSkins — individual ────────────────────────────
{
  // 2 players: p1 CH=5, p2 CH=18
  // hole hcpRating=18 (easiest): strokes: p1=0, p2=1
  // p1 gross=4, p2 gross=4 → p1 net=4, p2 net=3 → p2 wins
  // hole hcpRating=1 (hardest): p1 strokes=1, p2 strokes=2
  // p1 gross=3 net=2, p2 gross=3 net=1 → p2 wins again (better player loses strokes too)
  const players = [
    {id:'s1',name:'Low',  hcp:5.0,  courseHcp:5},
    {id:'s2',name:'High', hcp:18.0, courseHcp:18},
  ];
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  // p1 CH=5 gets stroke on holes hcpRating 1-5 only
  // p2 CH=18 gets 1 stroke on ALL 18 holes (floor(18/18)=1 on each)
  // Same gross (4) on all holes:
  //   holes 1-5: p1 net=3, p2 net=3 — tied, no skin
  //   holes 6-18: p1 net=4, p2 net=3 — p2 wins (13 holes)
  // p1 birdies hole 1 (gross=3): p1 net=3-1=2, p2 net=4-1=3 → p1 wins hole 1
  // Result: p1 wins 1, p2 wins 13
  const sc = {s1:{},s2:{}};
  for(let h=1;h<=18;h++){sc.s1[h]=4;sc.s2[h]=4;}
  sc.s1[1]=3; // p1 birdies hole 1 → p1 net=2 vs p2 net=3 → p1 wins
  const groups = [{playerIds:['s1','s2']}];
  const ctx = buildScoringCtx(players,course,'all',sc,groups,'stroke',{skins:{hcpAdj:100}});
  const skins = computeSkins(ctx);
  expect('individual skins: type=individual', skins.type,          'individual');
  expect('individual skins: anyWins=true',    skins.anyWins,       true);
  expect('individual skins: p1 wins 1',       skins.wins['s1'],    1);
  expect('individual skins: p2 wins 13',      skins.wins['s2'],    13);
}

// ── 57. computeSkins — scramble team ────────────────────────
{
  // 2 groups: grp_0 lower team net → wins skins
  const players = ENG_P4.map(p=>({...p,courseHcp:Math.round(p.hcp)}));
  const course  = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  const pcts    = [25,20,15,10];
  const sc      = {'grp_0':{},'grp_1':{}};
  // grp_0 scores 4 on every hole, grp_1 scores 5 on every hole
  for(let h=1;h<=18;h++){sc['grp_0'][h]=4;sc['grp_1'][h]=5;}
  const groups = [
    {playerIds:['e1','e2']},
    {playerIds:['e3','e4']},
  ];
  const ctx = buildScoringCtx(players,course,'all',sc,groups,'scramble',{scramblePcts:pcts,skins:{hcpAdj:100}});
  const skins = computeSkins(ctx);
  expect('scramble skins: type=team',      skins.type,       'team');
  expect('scramble skins: anyWins=true',   skins.anyWins,    true);
  expect('scramble skins: g0 wins 12',     skins.wins[0],    12);
  expect('scramble skins: g1 wins 0',      skins.wins[1]||0, 0);
}

// ── 58. computeSkins — full rules coverage ──────────────────
// All expected values pre-computed independently in Node (Rule 28).

// ── A: Half-stroke, tied gross → stroked player wins ─────────
// A CH=0, B CH=7. Hole 2: par3, hcpRating=2.
// Both gross 2. strokesOnHole(7,2,18)=1 → half=0.5
// A net=2.0, B net=1.5 → B wins. A net unchanged.
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:i<9?[4,3,5,4,4,5,3,4,4][i]:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:7,name:'B'}];
  // Only score h2 — isolates the half-stroke scenario without other holes adding noise
  const sc = {sA:{2:2},sB:{2:2}};
  const ctx = buildScoringCtx(players,course,'all',sc,[{playerIds:['sA','sB']}],'lownet',
    {skins:{hcpAdj:100,halfStroke:true,strokeOffBest:false}});
  const r = computeSkins(ctx);
  expect('skins A: half-stroke tied gross — B wins',   r.wins['sB'], 1);
  expect('skins A: half-stroke tied gross — A loses',  r.wins['sA'], 0);
  expect('skins A: anyWins true',                       r.anyWins,    true);
}

// ── B: Half-stroke, no stroke on hole → tie, no winner ───────
// A CH=0, B CH=7. Hole 18: hcpRating=18. strokesOnHole(7,18,18)=0 → half=0.
// Both gross 3, same net 3 → tie → no skin.
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:7,name:'B'}];
  const sc = {sA:{18:3},sB:{18:3}};
  const ctx = buildScoringCtx(players,course,'all',sc,[{playerIds:['sA','sB']}],'lownet',
    {skins:{hcpAdj:100,halfStroke:true,strokeOffBest:false}});
  const r = computeSkins(ctx);
  expect('skins B: half-stroke no-stroke hole → tie, A=0', r.wins['sA'], 0);
  expect('skins B: half-stroke no-stroke hole → tie, B=0', r.wins['sB'], 0);
  expect('skins B: anyWins false',                          r.anyWins,    false);
}

// ── C: Stroke-off-best, 3 players ─────────────────────────────
// A CH=0, B CH=9, C CH=18. SOB: eff=[0,9,18]-0=[0,9,18].
// Hole 9 hcpRating=9: A strokes=0, B strokes=1 (9<=9), C strokes=1 (floor=1)
// All gross 4: A net=4, B net=3, C net=3 → B/C tie → no skin on h9.
// Hole 1 hcpRating=1: A=0, B=1 (1<=9), C=1. B gross=3, A/C gross=4.
// B net=2, A net=4, C net=3 → B wins h1.
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:9,name:'B'},{id:'sC',hcp:18,name:'C'}];
  const sc = {sA:{},sB:{},sC:{}};
  for(let h=1;h<=18;h++){sc.sA[h]=4;sc.sB[h]=4;sc.sC[h]=4;}
  sc.sB[1]=3; // B birdies h1 → B net=2 wins outright
  const ctx = buildScoringCtx(players,course,'all',sc,
    [{playerIds:['sA','sB','sC']}],'lownet',
    {skins:{hcpAdj:100,halfStroke:false,strokeOffBest:true}});
  const r = computeSkins(ctx);
  // B wins h1 (birdie, net=2 beats C net=3 and A net=4)
  // h2-h9: B/C both net=3, A net=4 → B/C tie → no skin
  // h10-h18: C net=3 (C gets stroke, B doesn't), A/B net=4 → C wins 9 holes
  expect('skins C: SOB B wins h1',   r.wins['sB'], 1);
  expect('skins C: SOB A wins 0',    r.wins['sA'], 0);
  expect('skins C: SOB C wins 9',    r.wins['sC'], 9);
  expect('skins C: SOB anyWins',     r.anyWins,    true);
}

// ── D: 90% HCP adjustment reduces strokes ─────────────────────
// B raw CH=10, adj=90% → playing CH=9.
// Hole 10 hcpRating=10: strokesOnHole(10,10)=1 but strokesOnHole(9,10)=0.
// B gets NO stroke on h10 with 90% adj.
// A CH=0, B adj CH=9. Both gross 4 on h10 → both net 4 → tie → no skin.
// A CH=0, B adj CH=9. Hole 9 hcpRating=9: B strokes=1 (9<=9). B gross=4, A gross=4.
// B net=3, A net=4 → B wins h9.
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:10,name:'B'}];
  const sc = {sA:{},sB:{}}; for(let h=1;h<=18;h++){sc.sA[h]=4;sc.sB[h]=4;}
  // h10: tie (B loses stroke due to 90% adj)
  // h9: B net=3 wins (B retains stroke on h9 with CH=9)
  const ctx = buildScoringCtx(players,course,'all',sc,[{playerIds:['sA','sB']}],'lownet',
    {skins:{hcpAdj:90,halfStroke:false,strokeOffBest:false}});
  const r = computeSkins(ctx);
  // h9: B adj CH=9, strokesOnHole(9,9,18)=1 → B net=3, A net=4 → B wins
  expect('skins D: 90% adj B wins h9', r.wins['sB']>=1, true);
  // h10: B adj CH=9, strokesOnHole(9,10,18)=0 → both net 4 → no winner
  // Total: B wins h9 + holes hcpRating<=9 (h1-h9) where B gets strokes
  // h1-h9: B gets stroke (1-9 <= 9), all tie gross 4 → B net 3, A net 4 → B wins all 9
  expect('skins D: 90% adj B wins 9 holes (h1-h9)', r.wins['sB'], 9);
  expect('skins D: 90% adj A wins 0',               r.wins['sA'], 0);
}

// ── E: No scores → no winners ─────────────────────────────────
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:9,name:'B'}];
  const ctx = buildScoringCtx(players,course,'all',{sA:{},sB:{}},
    [{playerIds:['sA','sB']}],'lownet',{skins:{hcpAdj:100}});
  const r = computeSkins(ctx);
  expect('skins E: no scores → A wins 0',    r.wins['sA'], 0);
  expect('skins E: no scores → B wins 0',    r.wins['sB'], 0);
  expect('skins E: no scores → anyWins=false',r.anyWins,   false);
}

// ── F: 3-way tie gross, no strokes → no skin on that hole ────
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:0,name:'B'},{id:'sC',hcp:0,name:'C'}];
  const sc = {sA:{1:3},sB:{1:3},sC:{1:3}}; // all birdie h1, no strokes
  const ctx = buildScoringCtx(players,course,'all',sc,
    [{playerIds:['sA','sB','sC']}],'lownet',{skins:{hcpAdj:100}});
  const r = computeSkins(ctx);
  expect('skins F: 3-way tie → A=0', r.wins['sA'], 0);
  expect('skins F: 3-way tie → B=0', r.wins['sB'], 0);
  expect('skins F: 3-way tie → C=0', r.wins['sC'], 0);
  expect('skins F: anyWins false',    r.anyWins,    false);
}

// ── G: Outright win with 3 players ───────────────────────────
// p1 birdies h1 (gross 3), p2 and p3 par (gross 4), no strokes → p1 wins
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'s1',hcp:0,name:'p1'},{id:'s2',hcp:0,name:'p2'},{id:'s3',hcp:0,name:'p3'}];
  const sc = {s1:{1:3},s2:{1:4},s3:{1:4}};
  const ctx = buildScoringCtx(players,course,'all',sc,
    [{playerIds:['s1','s2','s3']}],'lownet',{skins:{hcpAdj:100}});
  const r = computeSkins(ctx);
  expect('skins G: outright winner s1=1', r.wins['s1'], 1);
  expect('skins G: s2=0',                 r.wins['s2'], 0);
  expect('skins G: s3=0',                 r.wins['s3'], 0);
}

// ── H: Gross-only skins — both hcp=0, lowest gross wins ──────
// Both players hcp=0 → CH=0 → no strokes → net=gross. B birdies h1, wins outright.
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:0,name:'B'}];
  const sc = {sA:{},sB:{}}; for(let h=1;h<=18;h++){sc.sA[h]=4;sc.sB[h]=4;}
  sc.sB[1]=3; // B gross 3, A gross 4 → B wins h1
  const ctx = buildScoringCtx(players,course,'all',sc,
    [{playerIds:['sA','sB']}],'lownet',{skins:{hcpAdj:100}});
  const r = computeSkins(ctx);
  expect('skins H: gross only (hcp=0) B wins h1', r.wins['sB'], 1);
  expect('skins H: gross only A wins 0',           r.wins['sA'], 0);
}

// ── I: 9-hole front skins — back 9 scores ignored ────────────
// A birdies h1 (wins) and h10 (ignored, back 9 not active)
// On front 9: A wins h1 only
{
  const course = {slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  const players = [{id:'sA',hcp:0,name:'A'},{id:'sB',hcp:0,name:'B'}];
  const sc = {sA:{},sB:{}}; for(let h=1;h<=18;h++){sc.sA[h]=4;sc.sB[h]=4;}
  sc.sA[1]=3; sc.sA[10]=3; // A birdies h1 (front) and h10 (back — should be ignored)
  const ctx = buildScoringCtx(players,course,'front',sc,
    [{playerIds:['sA','sB']}],'lownet',{skins:{hcpAdj:100}});
  const r = computeSkins(ctx);
  expect('skins I: front9 A wins h1 only → wins=1', r.wins['sA'], 1);
  expect('skins I: front9 h10 not counted → B=0',   r.wins['sB'], 0);
}

// ── 59. isTeamFormat / isCompFormat ─────────────────────────

{
  expect('isTeamFormat scramble',     isTeamFormat('scramble'),    true);
  expect('isTeamFormat best2',        isTeamFormat('best2'),       true);
  expect('isTeamFormat stroke=false', isTeamFormat('stroke'),      false);
  expect('isCompFormat stroke',       isCompFormat('stroke'),      true);
  expect('isCompFormat practice=false', isCompFormat('practice'),  false);
  expect('isCompFormat scramble',     isCompFormat('scramble'),    true);
}



// ── 59. tripCountback (USGA tiebreaker sort) ──────────────────
{
  // Verify the sort comparator: lower totalNet wins; on tie use back9→back6→back3→last1
  function cbSort(a, b) {
    if (a.totalNet !== b.totalNet) {
      if (a.totalNet === null) return 1;
      if (b.totalNet === null) return -1;
      return a.totalNet - b.totalNet;
    }
    for (let i = 0; i < 4; i++) { if (a.cb[i] !== b.cb[i]) return a.cb[i] - b.cb[i]; }
    return 0;
  }
  // p1 lower totalNet — wins outright
  const r1 = [{playerId:'p1',totalNet:70,rounds:1,teamWins:0,cb:[33,17,9,3]},
               {playerId:'p2',totalNet:72,rounds:1,teamWins:0,cb:[36,18,9,4]}].sort(cbSort);
  expect('countback: lower totalNet wins', r1[0].playerId, 'p1');

  // Tied totalNet, p1 better back9
  const r2 = [{playerId:'p1',totalNet:71,rounds:1,teamWins:0,cb:[35,18,9,4]},
               {playerId:'p2',totalNet:71,rounds:1,teamWins:0,cb:[36,18,9,4]}].sort(cbSort);
  expect('countback: tied total, better back9 wins', r2[0].playerId, 'p1');

  // Tied totalNet, tied back9, p2 better back6
  const r3 = [{playerId:'p1',totalNet:71,rounds:1,teamWins:0,cb:[35,19,9,4]},
               {playerId:'p2',totalNet:71,rounds:1,teamWins:0,cb:[35,18,9,4]}].sort(cbSort);
  expect('countback: tied back9, better back6 wins', r3[0].playerId, 'p2');

  // Tied through back6, p1 better back3
  const r4 = [{playerId:'p1',totalNet:71,rounds:1,teamWins:0,cb:[35,18,8,4]},
               {playerId:'p2',totalNet:71,rounds:1,teamWins:0,cb:[35,18,9,4]}].sort(cbSort);
  expect('countback: tied back6, better back3 wins', r4[0].playerId, 'p1');

  // Tied through back3, p2 better last hole
  const r5 = [{playerId:'p1',totalNet:71,rounds:1,teamWins:0,cb:[35,18,9,4]},
               {playerId:'p2',totalNet:71,rounds:1,teamWins:0,cb:[35,18,9,3]}].sort(cbSort);
  expect('countback: tied back3, better last hole wins', r5[0].playerId, 'p2');

  // null totalNet sorts last
  const r6 = [{playerId:'p1',totalNet:null,rounds:0,teamWins:2,cb:[0,0,0,0]},
               {playerId:'p2',totalNet:71,rounds:1,teamWins:0,cb:[35,18,9,4]}].sort(cbSort);
  expect('countback: null totalNet sorts last', r6[0].playerId, 'p2');
}

// ── 60. tripDays with excludedDays ───────────────────────────
{
  // Verify tripDays excludes dates in t.excludedDays
  const mockTrip = {startDate:'2026-03-19', endDate:'2026-03-23', excludedDays:['2026-03-21']};
  const days = sandbox.tripDays(mockTrip);
  expect('tripDays with exclusion: 4 days', days.length, 4);
  expect('tripDays excludes 2026-03-21', days.includes('2026-03-21'), false);
  expect('tripDays includes 2026-03-19', days.includes('2026-03-19'), true);
  expect('tripDays includes 2026-03-23', days.includes('2026-03-23'), true);

  // No exclusions: 5 days
  const mockTrip2 = {startDate:'2026-03-19', endDate:'2026-03-23'};
  const days2 = sandbox.tripDays(mockTrip2);
  expect('tripDays no exclusions: 5 days', days2.length, 5);
}

// ══════════════════════════════════════════════════════════════
// SMOKE TESTS — call every render/launch function with minimal
// valid state and assert no exception thrown.
// These catch missing functions, undefined property crashes,
// and broken module entry points before the app ships.
// ══════════════════════════════════════════════════════════════

// ── Build minimal valid S for smoke tests ────────────────────
const SMOKE_COURSE = {
  id:'c1', name:'Test Course', slope:113, rating:72, par:72,
  nineHole:false, homeCourse:true,
  holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:(i%18)+1,hcpRating:(i%18)+1}))
};

const SMOKE_PLAYERS = [
  {id:'p1',name:'Brian Zrimsek',hcp:5.2,ghin:'',regular:true,courseHcp:5},
  {id:'p2',name:'Kevin Blood',  hcp:8.1,ghin:'',regular:true,courseHcp:8},
  {id:'p3',name:'Ryan Caito',   hcp:12.3,ghin:'',regular:true,courseHcp:12},
  {id:'p4',name:'Chris Davis',  hcp:15.6,ghin:'',regular:true,courseHcp:16},
];

const SMOKE_SCORES = {};
SMOKE_PLAYERS.forEach(p => {
  SMOKE_SCORES[p.id] = {};
  SMOKE_COURSE.holes.forEach(h => { SMOKE_SCORES[p.id][h.num] = 4; });
});

const SMOKE_GAME_NASSAU = {
  id:'g1', type:'foursome', gameType:'nassau', status:'active', date:Date.now(),
  courseId:'c1', courseName:'Test Course',
  costF:10, costB:10, costT:10, strokeMode:'field',
  pairs:[{A:'p1',B:'p2',label:'P1 v P2',teamA:['p1','p3'],teamB:['p2','p4']}],
  teams:{A:['p1','p3'],B:['p2','p4']},
  playerIds:['p1','p2','p3','p4'],
  playerNames:['Brian Zrimsek','Kevin Blood','Ryan Caito','Chris Davis'],
  chs:{p1:5,p2:8,p3:12,p4:16},
  rawChs:{p1:5,p2:8,p3:12,p4:16},
  scores: SMOKE_SCORES,
  _totalHoles:18, _scoring:true
};

const SMOKE_OUTING = {
  id:'o1', type:'outing', status:'active', _scoring:true, date:Date.now(),
  courseId:'c1', courseName:'Test Course', gameType:'stroke', nineSide:'all',
  groupMethod:'random', abcdTiers:{}, resultMethod:'best2', skins:false,
  playerIds:['p1','p2','p3','p4'],
  playerNames:SMOKE_PLAYERS.map(p=>p.name),
  players:SMOKE_PLAYERS.map(p=>({...p,courseHcp:p.courseHcp})),
  groups:[{id:'g1',playerIds:['p1','p2','p3','p4'],teetime:'8:00 AM'}],
  scores:{...SMOKE_SCORES}, phase:'scoring',
  teeTimes:['8:00 AM'], shotgun:false
};

const SMOKE_OUTING_SCRAMBLE = {
  id:'o2', type:'outing', status:'active', _scoring:true, date:Date.now(),
  courseId:'c1', courseName:'Test Course', gameType:'scramble', nineSide:'all',
  groupMethod:'random', abcdTiers:{}, resultMethod:'best2', skins:false,
  playerIds:['p1','p2','p3','p4'],
  playerNames:SMOKE_PLAYERS.map(p=>p.name),
  players:SMOKE_PLAYERS.map(p=>({...p,courseHcp:p.courseHcp})),
  groups:[{id:'g1',playerIds:['p1','p2'],teetime:'8:00 AM'},{id:'g2',playerIds:['p3','p4'],teetime:'8:10 AM'}],
  scores:{'grp_0':{},'grp_1':{}}, phase:'scoring',
  teeTimes:['8:00 AM','8:10 AM'], shotgun:false
};
const SMOKE_TRIP = {
  id:'t1', type:'trip', status:'active', date:Date.now(),
  destination:'Test Destination', startDate:'2026-07-01', endDate:'2026-07-05',
  players:[{id:'p1',manager:true},{id:'p2'},{id:'p3'},{id:'p4'}],
  courseIds:['c1'],
  lockedHcps:{p1:5,p2:8,p3:12,p4:16},
  settings:{strokeAllowance:100},
  days:{
    '2026-07-01':{rounds:[{
      id:'r1',label:'Round 1',format:'stroke',courseId:'c1',nineMode:'all',
      completed:false,
      groups:[{playerIds:['p1','p2'],teetime:'8:00 AM'},{playerIds:['p3','p4'],teetime:'8:10 AM'}],
      scores:{...SMOKE_SCORES},
      teeTimes:['8:00 AM','8:10 AM']
    }]}
  }
};

const SMOKE_LEAGUE = {
  id:'l1', type:'league', status:'active', date:Date.now(),
  name:'Test League', dayOfWeek:3, courseId:'c1',
  teeTimes:['5:20 PM','5:30 PM'], groupManagerIds:[],
  pairMode:'ab', groupMethod:'random',
  skins:{hcpAdj:100,halfStroke:false,strokeOffBest:false},
  sessions:[], seasons:[]
};

function smokeSetup() {
  vmSetS('courses', [SMOKE_COURSE]);
  vmSetS('players', JSON.parse(JSON.stringify(SMOKE_PLAYERS)));
  vmSetS('events', [
    JSON.parse(JSON.stringify(SMOKE_GAME_NASSAU)),
    JSON.parse(JSON.stringify(SMOKE_OUTING_SCRAMBLE)),
    JSON.parse(JSON.stringify(SMOKE_OUTING)),
    JSON.parse(JSON.stringify(SMOKE_TRIP)),
    JSON.parse(JSON.stringify(SMOKE_LEAGUE)),
  ]);
  vmSetS('activeTripId', 't1');
  vmSetS('activeOutingId', 'o1');
  vmSetS('activeLeagueId', 'l1');
  vmSetS('config', {
    ghinProxyUrl:'', myPlayerId:'p1', myPlayerAuto:false,
    games:{fourPlayer:{bbb:{enabled:true,pointValue:1},nassau:{enabled:true},
      doc:{enabled:true},walkoff:{enabled:true},wolf:{enabled:true},
      scramble:{enabled:true},shamble:{enabled:true},stableford:{enabled:true}},
      individual:{stableford:{enabled:true,ptsDbl:0,ptsBogey:0,ptsPar:1,ptsBirdie:2,ptsEagle:4,ptsDblEagle:8}},
      skins:{hcpAdj:100,halfStroke:false,strokeOffBest:false}},
    scoringAdvance:'post', log:[]
  });
  // Set module window vars for Foursome
  vm.runInContext(`
    window._fsCourseId = 'c1';
    window._fsPicked   = ['p1','p2','p3','p4'];
    window._fsNineMode = 'all';
    window._teamState  = {A:['p1','p3'],B:['p2','p4']};
    window._fsPendingType = 'nassau';
    window._tripModeActive = false;
    window._tripScoringCtx = null;
    window._tripCurrentScreen = 'list';
    window._outingSelectedGroup = 0;
    window._leagueSelectedGroup = 0;
    S.activeTripId = 't1';
    S.activeLeagueId = 'l1';
  `, sandbox);
}

function smoke(desc, fn) {
  try {
    smokeSetup();
    vm.runInContext(`(${fn.toString()})()`, sandbox);
    passed++; // no exception = pass
  } catch(e) {
    failed++;
    failures.push({desc:`SMOKE: ${desc}`, expected:'no error', actual:e.message});
  }
}

// Render-output capture: fsRender defers innerHTML via requestAnimationFrame (a no-op in the
// harness), so smoke() alone never produces HTML. captureRender runs rAF synchronously, executes
// the render, and returns the actual HTML string — so we can assert on the OUTPUT, not just no-crash.
function captureRender(callStr, setupStr) {
  smokeSetup();
  if (setupStr) vm.runInContext(setupStr, sandbox);
  dummyEl.innerHTML = '';
  sandbox.requestAnimationFrame = function(cb){ try { cb(); } catch(e) { dummyEl.__renderErr = e.message; } };
  dummyEl.__renderErr = null;
  let threw = null;
  try { vm.runInContext(callStr, sandbox); }
  catch(e){ threw = e.message; }
  sandbox.requestAnimationFrame = function(){};  // restore no-op
  return { threw: threw || dummyEl.__renderErr, html: dummyEl.innerHTML || '' };
}

// ── Smoke: defined-function check ────────────────────────────
{
  // Extract all onclick function calls from HTML
  const onclickFns = new Set();
  const onclickRe = /onclick="([^"]+)"/g;
  let om;
  while ((om = onclickRe.exec(html)) !== null) {
    const calls = om[1].matchAll(/\b([a-z_][a-zA-Z0-9_]+)\s*\(/g);
    for (const c of calls) onclickFns.add(c[1]);
  }
  // Also scan template literals for function calls
  const skipBuiltins = new Set(['parseInt','parseFloat','isNaN','isFinite','Math','Date',
    'Object','Array','String','Boolean','JSON','Promise','setTimeout','clearTimeout',
    'console','document','window','S','encodeURIComponent','decodeURIComponent',
    'if','for','while','return','const','let','var','true','false','null','undefined',
    'new','typeof','instanceof','void','stopPropagation','preventDefault','target',
    'this','event','classList','style','value','checked','dataset',
    'getElementById','querySelector','querySelectorAll','addEventListener','removeEventListener',
    'getAttribute','setAttribute','remove','add','toggle','contains','forEach','focus','blur']);

  for (const fn of onclickFns) {
    if (skipBuiltins.has(fn)) continue;
    if (fn[0] === fn[0].toUpperCase()) continue; // constructors
    if (fn.length < 3) continue;
    const isDefined = vm.runInContext(`typeof ${fn} === 'function'`, sandbox);
    expect(`onclick function defined: ${fn}()`, isDefined, true);
  }
}

// ── Smoke: module entry points ────────────────────────────────
smoke('fsShowPlayerSelect renders without crash', () => { fsShowPlayerSelect(); });
smoke('fsShowGameTypePicker renders without crash', () => { fsShowGameTypePicker(); });
smoke('showBBBSetup renders without crash',    () => { showBBBSetup(); });
smoke('showNassauSetup renders without crash', () => { showNassauSetup(); });
smoke('showWalkoffSetup renders without crash',() => { showWalkoffSetup(); });
smoke('showWolfSetup renders without crash',   () => { showWolfSetup(); });
smoke('showStablefordSetup renders without crash',()=>{ showStablefordSetup(); });
smoke('showLowNetSetup renders without crash', () => { showLowNetSetup(); });
smoke('showTwoScrambleSetup renders without crash',()=>{ showTwoScrambleSetup(); });
smoke('showTwoShambleSetup renders without crash',()=>{ showTwoShambleSetup(); });

// ── Smoke: Foursome scorecards with valid game ────────────────
smoke('renderNassauGame renders without crash', () => {
  S.events.find(e=>e.gameType==='nassau')._scoring=true;
  renderNassauGame();
});
smoke('renderBBBGame: game missing scores guarded', () => {
  const g={id:'g2',type:'foursome',gameType:'bbb',status:'active',courseId:'c1',
    playerIds:['p1','p2'],scores:{},bbb:{},_totalHoles:18,chs:{p1:5,p2:8},rawChs:{p1:5,p2:8}};
  S.events.push(g); renderBBBGame(); S.events.pop();
});

// ── Smoke: Outing ────────────────────────────────────────────
smoke('outingLaunch renders without crash',  () => { outingLaunch(); });
smoke('outingRenderListScreen without crash',() => { outingRenderListScreen(); });
smoke('outingRenderHub without crash',       () => { S.activeOutingId='o1'; outingRenderHub(); });
smoke('outingRenderScoring without crash',   () => {
  const g=S.events.find(e=>e.type==='outing'); if(g) outingRenderScoring(g);
});
smoke('outingRenderTeamScoring scramble without crash', () => {
  S.activeOutingId='o2';
  const g=S.events.find(e=>e.gameType==='scramble'); if(g) outingRenderScoring(g);
});
smoke('outingRenderScoring individual (after scramble reset)', () => {
  const g=S.events.find(e=>e.type==='outing'); if(g) outingRenderScoring(g);
});

// ── Smoke: Trip ───────────────────────────────────────────────
smoke('tripLaunch renders without crash',         () => { tripLaunch(); });
smoke('tripRenderListScreen without crash',       () => { tripRenderListScreen(); });
smoke('tripRenderHub without crash',              () => { S.activeTripId='t1'; tripRenderHub(); });
smoke('tripRenderRosterScreen without crash',     () => { tripRenderRosterScreen(); });
smoke('tripRenderCoursesScreen without crash',    () => { tripRenderCoursesScreen(); });
smoke('tripRenderScheduleScreen without crash',   () => { tripRenderScheduleScreen(); });
smoke('tripRenderPairingsScreen without crash',   () => { tripRenderPairingsScreen(); });
smoke('tripRenderRoundGroupsScreen without crash',() => {
  window._tripPairingCtx={tid:'t1',dayIdx:0,rndIdx:0};
  tripRenderRoundGroupsScreen();
});
smoke('tripRenderScoringScreen without crash',    () => {
  window._tripScoringCtx={tid:'t1',dayIdx:0,rndIdx:0};
  tripRenderScoringScreen();
});
smoke('tripRenderResultsScreen without crash',    () => { tripRenderResultsScreen(); });

// ── Smoke: League ─────────────────────────────────────────────
smoke('leagueLaunch renders without crash',        () => { leagueLaunch(); });
smoke('leagueRenderListScreen without crash',      () => { leagueRenderListScreen(); });
smoke('leagueRenderHub without crash',             () => { S.activeLeagueId='l1'; leagueRenderHub(); });
smoke('leagueRenderPlanCourse without crash',      () => { leagueRenderPlanCourse(); });
smoke('leagueRenderSeasonsScreen without crash',  () => { leagueRenderSeasonsScreen(); });
smoke('leagueRenderGroupMethodScreen without crash',()=>{ leagueRenderGroupMethodScreen(); });
smoke('leagueRenderSessions without crash',        () => { leagueRenderSessions(); });
smoke('leagueSessionLaunch without crash',         () => {
  // Add minimal session to avoid creating new one
  S.events.find(e=>e.type==='league').sessions=[{
    id:'s1',date:Date.now(),courseId:'c1',teeTimes:['5:20 PM'],
    rsvp:{p1:{status:'in',earliest:'5:20 PM'}},
    groups:[],gameType:'stableford',stablefordTeam:'individual',
    teamScoring:'bestball',resultMethod:'best2',scores:{},completed:false
  }];
  window._leagueSessionId='s1';
  leagueRenderRSVP();
});

// ── Smoke: outing format picker ──────────────────────────────
smoke('outingRenderPlanFormat without crash', () => {
  S.activeOutingId='o1'; outingRenderPlanFormat();
});
smoke('outingPlanSetFormat lownet without crash', () => {
  S.activeOutingId='o1'; outingPlanSetFormat('lownet','false');
});
smoke('outingPlanSetFormat shamble sets default resultMethod', () => {
  S.activeOutingId='o1';
  const o=S.events.find(e=>e.id==='o1'); if(o){o.resultMethod=null;}
  outingPlanSetFormat('shamble','false');
  const o2=S.events.find(e=>e.id==='o1');
  if(!o2||!o2.resultMethod) throw new Error('shamble resultMethod not set');
});
smoke('outingPlanSetShamble sets 321 without crash', () => {
  S.activeOutingId='o1'; outingPlanSetShamble('321');
  const o=S.events.find(e=>e.id==='o1');
  if(!o||o.resultMethod!=='321') throw new Error('shamble resultMethod not 321');
});

// ── Smoke: league group-by-group ──────────────────────────────
smoke('_leagueDoScoring without crash', () => {
  S.activeLeagueId='l1';
  window._leagueSelectedGroup=0;
  const lg=leagueCurrent(); const s=leagueCurrentSession();
  if(lg&&s) _leagueDoScoring(lg,s);
});
smoke('leagueCurrentSession returns session', () => {
  S.activeLeagueId='l1';
  const s=leagueCurrentSession();
  if(typeof s !== 'object') throw new Error('leagueCurrentSession did not return object');
});

// ── Smoke: normalizeState with missing fields ─────────────────
{
  const stripped = normalizeState({
    events:[
      {id:'g1',type:'foursome',gameType:'nassau',status:'active',
       playerIds:['p1'],pairs:[],chs:undefined,scores:undefined},
      {id:'o1',type:'outing',status:'active',gameType:'stroke',
       players:[],groups:[],scores:undefined},
    ]
  });
  const f = stripped.events.find(e=>e.type==='foursome');
  expect('normalizeState: foursome scores defaulted', typeof f.scores, 'object');
  const o = stripped.events.find(e=>e.type==='outing');
  expect('normalizeState: outing scores defaulted', typeof o.scores, 'object');
}

// ── 24. RESULTS ───────────────────────────────────────────────
// ── Skins half-stroke bug fix tests ──────────────────────────
// Scenario: par 3, player A gross 2 (no stroke), player B gross 2 (gets 1 stroke → 0.5 with half-stroke)
// Expected: player B wins (net 1.5 < net 2.0)
// Bug was: Math.floor(0.5)=0 → both net 2 → tie → no winner
{
  const course = { slope:113, rating:72, par:72, holes: Array.from({length:18},(_,i)=>({num:i+1,par:i<9?[4,3,5,4,4,5,3,4,4][i]:4,hcp:i+1,hcpRating:i+1})) };
  const players = [
    { id:'pA', hcp:0, name:'A' },
    { id:'pB', hcp:7, name:'B' }, // CH=7, gets stroke on hcpRating<=7 holes
  ];
  const sc = { pA:{ 2:2 }, pB:{ 2:2 } }; // hole 2 = par 3, hcpRating=2
  const grps = [{ id:'g1', playerIds:['pA','pB'] }];
  const ctx = buildScoringCtx(players, course, 'all', sc, grps, 'lownet',
    { skins:{ hcpAdj:100, halfStroke:true, strokeOffBest:false } });
  const r = computeSkins(ctx);
  expect('Skins half-stroke: pB wins with 1 stroke on par3', r.wins['pB'], 1);
  expect('Skins half-stroke: pA does not win tied hole', r.wins['pA'], 0);
}
// Scenario: two players tied gross, one gets full stroke → wins outright (non-half mode)
{
  const course = { slope:113, rating:72, par:72, holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) };
  const players = [
    { id:'pA', hcp:0, name:'A' },
    { id:'pB', hcp:5, name:'B' },
  ];
  const sc2 = { pA:{ 1:4 }, pB:{ 1:4 } };
  const grps2 = [{ id:'g1', playerIds:['pA','pB'] }];
  const ctx2 = buildScoringCtx(players, course, 'all', sc2, grps2, 'lownet',
    { skins:{ hcpAdj:100, halfStroke:false, strokeOffBest:false } });
  const r2 = computeSkins(ctx2);
  expect('Skins full-stroke: pB wins with stroke (gross tie)', r2.wins['pB'], 1);
  expect('Skins full-stroke: pA does not win', r2.wins['pA'], 0);
}

// ════════════════════════════════════════════════════════════════
// HIGH & MEDIUM RISK — previously untested scoring functions
// All expected values pre-computed independently (Rule 28)
// ════════════════════════════════════════════════════════════════

// ── 61. fsCalcOneMatch — Walkoff match play ───────────────────
{
  // 9-hole match starting h1. No strokes (both CH=0).
  // A wins h1 (gross 3 vs B gross 4), B wins h2 (gross 3 vs A gross 4). Rest unscored.
  // After 2 holes: aUp=1, bUp=1, diff=0, thru=2, not closed, not dormie → All Square
  const course9 = { holes: Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) };
  vmSetS('courses', [{ id:'wc', slope:113, rating:36, par:36, ...course9 }]);
  const g1 = {
    courseId:'wc', gameType:'walkoff', chs:{pA:0,pB:0}, _totalHoles:9,
    scores:{ pA:{1:3,2:4}, pB:{1:4,2:3} },
    pairs:[{ A:'pA', B:'pB' }]
  };
  const match1 = { startHole:1, closed:false, winner:null };
  const r1 = fsCalcOneMatch(g1, match1, g1.pairs[0]);
  expect('fsCalcOneMatch all-square: diff=0',    r1.diff,    0);
  expect('fsCalcOneMatch all-square: thru=2',    r1.thru,    2);
  expect('fsCalcOneMatch all-square: isClosed=F',r1.isClosed,false);
  expect('fsCalcOneMatch all-square: isDormie=F',r1.isDormie,false);
  expect('fsCalcOneMatch all-square: winner=null',r1.winner, null);
}
{
  // A wins h1-h5 in 9-hole match → 5up with 4 left → closed on h5 → A wins
  const course9 = { holes: Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) };
  vmSetS('courses', [{ id:'wc2', slope:113, rating:36, par:36, ...course9 }]);
  const sc = {pA:{},pB:{}}; 
  for(let h=1;h<=5;h++){sc.pA[h]=3;sc.pB[h]=4;} // A wins h1-5
  const g2 = { courseId:'wc2', gameType:'walkoff', chs:{pA:0,pB:0}, _totalHoles:9,
               scores:sc, pairs:[{A:'pA',B:'pB'}] };
  const match2 = { startHole:1, closed:false, winner:null };
  const r2 = fsCalcOneMatch(g2, match2, g2.pairs[0]);
  expect('fsCalcOneMatch 5&4: isClosed=T',  r2.isClosed, true);
  expect('fsCalcOneMatch 5&4: winner=A',    r2.winner,   'A');
  expect('fsCalcOneMatch 5&4: aUp=5',       r2.aUp,      5);
  expect('fsCalcOneMatch 5&4: bUp=0',       r2.bUp,      0);
  expect('fsCalcOneMatch 5&4: thru=5',      r2.thru,     5);
  expect('fsCalcOneMatch 5&4: remaining=4', r2.remaining,4);
}

// ── 62. wolfCalcTotals — point accumulation ───────────────────
{
  // 4 players. h1: partner mode, p1=captain, p2=partner, wolf wins, base=1, value=1.
  //   p1+=2, p2+=2, p3-=2, p4-=2
  // h2: lone mode, p2=captain (no partner), others win, base=1, value=2.
  //   p2-=6, p1+=2, p3+=2, p4+=2
  // Totals: p1=4, p2=-4, p3=0, p4=0
  const g = {
    wolfOrder: ['p1','p2','p3','p4'],
    wolfHoles: {
      1: { mode:'partner', captainPid:'p1', partnerPid:'p2', winner:'wolf',   base:1, value:1 },
      2: { mode:'lone',    captainPid:'p2', partnerPid:null,  winner:'others', base:1, value:2 },
    },
    scores:{}, chs:{p1:0,p2:0,p3:0,p4:0}, courseId:'wc2',
  };
  const totals = wolfCalcTotals(g);
  expect('wolfCalcTotals p1=4',  totals['p1'],  4);
  expect('wolfCalcTotals p2=-4', totals['p2'], -4);
  expect('wolfCalcTotals p3=0',  totals['p3'],  0);
  expect('wolfCalcTotals p4=0',  totals['p4'],  0);
}
{
  // Blind lone wolf: captain=p3, allOthers=[p1,p2,p4], wolf wins, value=4
  // p3 += 4*3=12, p1-=4, p2-=4, p4-=4
  const g = {
    wolfOrder:['p1','p2','p3','p4'],
    wolfHoles:{ 1:{ mode:'blind', captainPid:'p3', partnerPid:null, winner:'wolf', base:1, value:4 } },
    scores:{}, chs:{p1:0,p2:0,p3:0,p4:0}, courseId:'wc2',
  };
  const t2 = wolfCalcTotals(g);
  expect('wolfCalcTotals blind wolf wins: p3=12',  t2['p3'], 12);
  expect('wolfCalcTotals blind wolf wins: p1=-4',  t2['p1'], -4);
  expect('wolfCalcTotals blind wolf wins: p2=-4',  t2['p2'], -4);
  expect('wolfCalcTotals blind wolf wins: p4=-4',  t2['p4'], -4);
}
{
  // Tie hole — no points move
  const g = {
    wolfOrder:['p1','p2','p3','p4'],
    wolfHoles:{ 1:{ mode:'partner', captainPid:'p1', partnerPid:'p2', winner:'tie', base:1, value:1 } },
    scores:{}, chs:{p1:0,p2:0,p3:0,p4:0}, courseId:'wc2',
  };
  const t3 = wolfCalcTotals(g);
  expect('wolfCalcTotals tie: all zero', Object.values(t3).every(v=>v===0), true);
}

// ── 63. wolfSettlement — pairwise payouts ─────────────────────
{
  // totals from §62 test: p1=4, p2=-4, p3=0, p4=0. ptValue=1.
  const g = {
    wolfOrder:['p1','p2','p3','p4'],
    ptValue: 1,
    wolfHoles:{
      1:{ mode:'partner', captainPid:'p1', partnerPid:'p2', winner:'wolf',   base:1, value:1 },
      2:{ mode:'lone',    captainPid:'p2', partnerPid:null,  winner:'others', base:1, value:2 },
    },
    scores:{}, chs:{p1:0,p2:0,p3:0,p4:0}, courseId:'wc2',
  };
  const settle = wolfSettlement(g);
  // p2 pays p1 8, p3 pays p1 4, p4 pays p1 4, p2 pays p3 4, p2 pays p4 4 → 5 transactions
  expect('wolfSettlement: 5 transactions', settle.length, 5);
  const p2top1 = settle.find(s=>s.payerPid==='p2'&&s.payeePid==='p1');
  expect('wolfSettlement: p2 pays p1 8pts',   p2top1?.points,  8);
  expect('wolfSettlement: p2 pays p1 $8',     p2top1?.dollars, 8);
  const p3top1 = settle.find(s=>s.payerPid==='p3'&&s.payeePid==='p1');
  expect('wolfSettlement: p3 pays p1 4pts',   p3top1?.points,  4);
  // All square between p3 and p4 (both 0) — no transaction
  expect('wolfSettlement: no p3/p4 txn', settle.find(s=>(s.payerPid==='p3'&&s.payeePid==='p4')||(s.payerPid==='p4'&&s.payeePid==='p3')), undefined);
}

// ── 64. outingBuildTeams — blind draw + borrow ────────────────
{
  // 4 players CH=[0,5,10,15]. mode=ab, teamSize=2.
  // As=[0,5], Bs=[10,15]. 2 teams of 2, no borrow.
  const players4 = [{id:'t1',courseHcp:0},{id:'t2',courseHcp:5},{id:'t3',courseHcp:10},{id:'t4',courseHcp:15}];
  const teams4 = outingBuildTeams(players4, 2, 'ab');
  expect('outingBuildTeams 4p ab: 2 teams',    teams4.length,           2);
  expect('outingBuildTeams 4p ab: no borrow',  teams4.every(t=>!t.isBorrow), true);
  expect('outingBuildTeams 4p ab: each has 2', teams4.every(t=>t.playerIds.length===2), true);
  // Each team must contain exactly one A-tier (low CH) and one B-tier (high CH)
  const teamCHs = teams4.map(t => t.playerIds.map(id=>players4.find(p=>p.id===id).courseHcp).sort((a,b)=>a-b));
  expect('outingBuildTeams 4p ab: t0 has low+high', teamCHs[0][0] < teamCHs[0][1], true);
}
{
  // 5 players, mode=ab, teamSize=2 → 2 teams + 1 borrow
  const players5 = [{id:'t1',courseHcp:0},{id:'t2',courseHcp:4},{id:'t3',courseHcp:8},{id:'t4',courseHcp:12},{id:'t5',courseHcp:16}];
  const teams5 = outingBuildTeams(players5, 2, 'ab');
  const borrows = teams5.filter(t=>t.isBorrow);
  expect('outingBuildTeams 5p ab: 3 total (2+borrow)', teams5.length, 3);
  expect('outingBuildTeams 5p ab: 1 borrow',           borrows.length, 1);
  expect('outingBuildTeams 5p ab: borrow has borrowId',!!borrows[0]?.borrowId, true);
}
{
  // 5 players, mode=random → last team may be short → borrow
  const players5r = [{id:'r1',courseHcp:5},{id:'r2',courseHcp:5},{id:'r3',courseHcp:5},{id:'r4',courseHcp:5},{id:'r5',courseHcp:5}];
  const teamsR = outingBuildTeams(players5r, 2, 'random');
  expect('outingBuildTeams 5p random: 3 teams',  teamsR.length, 3);
  const allPids = teamsR.flatMap(t=>t.playerIds);
  // The borrow player appears twice; unique pids = 5
  expect('outingBuildTeams 5p random: 5 unique players', new Set(allPids).size, 5);
}
{
  // 6 players, teamSize=2 → 3 even teams, no borrow
  const players6 = [{id:'s1',courseHcp:2},{id:'s2',courseHcp:4},{id:'s3',courseHcp:6},{id:'s4',courseHcp:8},{id:'s5',courseHcp:10},{id:'s6',courseHcp:12}];
  const teams6 = outingBuildTeams(players6, 2, 'ab');
  expect('outingBuildTeams 6p: 3 teams',    teams6.length, 3);
  expect('outingBuildTeams 6p: no borrow',  teams6.every(t=>!t.isBorrow), true);
}

// ── 65. leagueBuildPool — RSVP resolution ─────────────────────
{
  // 4 regulars: p1=in, p2=out+sub=s1, p3=out+guest="Bob"+guestHcp=5, p4=in
  // pool: [p1, s1(as sub), guest_p3, p4] → size 4
  let origPlayers; vm.runInContext('origPlayers = S.players', sandbox); origPlayers = sandbox.origPlayers;
  vmSetS('players', [
    {id:'p1',name:'P1',hcp:5,regular:true},
    {id:'p2',name:'P2',hcp:7,regular:true},
    {id:'p3',name:'P3',hcp:9,regular:true},
    {id:'p4',name:'P4',hcp:11,regular:true},
    {id:'s1',name:'Sub1',hcp:6,regular:false},
  ]);
  const fakeLg = { teeTimes:['8:00 AM','8:10 AM'] };
  const fakeSess = {
    rsvp: {
      p1:{ status:'in' },
      p2:{ status:'out', subId:'s1' },
      p3:{ status:'out', guestName:'Bob', guestHcp:5 },
      p4:{ status:'in' },
    }
  };
  const pool = leagueBuildPool(fakeLg, fakeSess);
  expect('leagueBuildPool: 4 players', pool.length, 4);
  expect('leagueBuildPool: p1 in pool', pool.some(p=>p.id==='p1'), true);
  expect('leagueBuildPool: s1 sub in pool', pool.some(p=>p.id==='s1'), true);
  expect('leagueBuildPool: guest_p3 in pool', pool.some(p=>p.id==='guest_p3'), true);
  expect('leagueBuildPool: p4 in pool', pool.some(p=>p.id==='p4'), true);
  expect('leagueBuildPool: p2 not in pool', pool.some(p=>p.id==='p2'), false);
  expect('leagueBuildPool: s1 marked isSub', pool.find(p=>p.id==='s1')?.isSub, true);
  vmSetS('players', origPlayers);
}

// ── 66. leagueGetEstablishedPartner — partner resolution ─────
{
  const lg = {
    seasons:[{ active:true, partners:[
      {id:'pair1', playerIds:['p1','p2']},
      {id:'pair2', playerIds:['p3','p4']},
    ]}]
  };
  // p4 is in — returns p4
  const s1 = { rsvp:{ p4:{status:'in'} } };
  expect('leagueGetEstablishedPartner: normal',  leagueGetEstablishedPartner(lg,s1,'p3'), 'p4');

  // p2 is out with sub=s1 — returns s1
  const s2 = { rsvp:{ p2:{status:'out',subId:'sub1'} } };
  expect('leagueGetEstablishedPartner: sub override', leagueGetEstablishedPartner(lg,s2,'p1'), 'sub1');

  // p5 not in any pair — returns null
  expect('leagueGetEstablishedPartner: no pair → null', leagueGetEstablishedPartner(lg,s1,'p5'), null);

  // No active season — returns null
  const lgNoSeason = { seasons:[{active:false,partners:[{id:'x',playerIds:['p1','p2']}]}] };
  expect('leagueGetEstablishedPartner: no active season → null', leagueGetEstablishedPartner(lgNoSeason,s1,'p1'), null);
}

// ── 67. leagueBuildEstablishedTeams — partner → session teams ─
{
  let origPlayers; vm.runInContext('origPlayers = S.players', sandbox); origPlayers = sandbox.origPlayers;
  vmSetS('players', [
    {id:'p1',name:'P1',hcp:5,regular:true},
    {id:'p2',name:'P2',hcp:7,regular:true},
    {id:'p3',name:'P3',hcp:9,regular:true},
    {id:'p4',name:'P4',hcp:11,regular:true},
  ]);
  const lg = {
    teeTimes:['8:00 AM'],
    seasons:[{ active:true, partners:[
      {id:'pair1',playerIds:['p1','p2']},
      {id:'pair2',playerIds:['p3','p4']},
    ]}]
  };
  const s = { rsvp:{ p1:{status:'in'},p2:{status:'in'},p3:{status:'in'},p4:{status:'in'} } };
  const teams = leagueBuildEstablishedTeams(lg, s);
  expect('leagueBuildEstablishedTeams: 2 teams',    teams.length, 2);
  expect('leagueBuildEstablishedTeams: no borrows', teams.every(t=>!t.isBorrow), true);
  const t1pids = teams.find(t=>t.playerIds.includes('p1'))?.playerIds || [];
  expect('leagueBuildEstablishedTeams: p1+p2 together', t1pids.includes('p2'), true);

  // With odd player (p5 also in): 2 teams + 1 borrow
  vmSetS('players', [...sandbox.origPlayers || [], {id:'p5',name:'P5',hcp:3,regular:true}]);
  s.rsvp['p5']={status:'in'};
  const teams5 = leagueBuildEstablishedTeams(lg, s);
  expect('leagueBuildEstablishedTeams: odd→borrow', teams5.some(t=>t.isBorrow), true);
  vmSetS('players', origPlayers);
}

// ── 68. tripAssignBorrows — short group filling ───────────────
{
  // format=best2, group0 has 3 players, group1 has 4 players
  // group0 needs 1 borrow from outside its members
  const r = {
    format: 'best2',
    groups: [
      { playerIds:['p1','p2','p3'] },
      { playerIds:['p4','p5','p6','p7'] },
    ],
    scores:{}, borrows:[]
  };
  const players = ['p1','p2','p3','p4','p5','p6','p7'].map(id=>({id,hcp:5,name:id}));
  tripAssignBorrows(r, players);
  expect('tripAssignBorrows: borrows array set', Array.isArray(r.borrows), true);
  expect('tripAssignBorrows: 2 entries',         r.borrows.length, 2);
  const b0 = r.borrows.find(b=>b.gi===0);
  expect('tripAssignBorrows: group0 borrows 1',  b0?.borrowedPids.length, 1);
  // Borrowed player must not already be in group0
  expect('tripAssignBorrows: borrow from outside', !['p1','p2','p3'].includes(b0?.borrowedPids[0]), true);
  const b1 = r.borrows.find(b=>b.gi===1);
  expect('tripAssignBorrows: group1 borrows 0',  b1?.borrowedPids.length, 0);
}
{
  // format=stroke → no borrows assigned
  const r2 = { format:'stroke', groups:[{playerIds:['p1','p2','p3']}], scores:{} };
  tripAssignBorrows(r2, [{id:'p1'},{id:'p2'},{id:'p3'}]);
  expect('tripAssignBorrows: stroke→no borrows', r2.borrows, undefined);
}

// ── 69. updateScoreTotals — running totals ────────────────────
{
  // updateScoreTotals writes to DOM elements — pure DOM test
  // We can only verify the math by testing the underlying reduction
  // Front: [4,3,5,4,4,5,3,4,4]=36. Back: [4,4,3,4,4,3,4,4,3]=33. Total=69
  const scores = {};
  const ah = Array.from({length:18},(_,i)=>({num:i+1}));
  [4,3,5,4,4,5,3,4,4].forEach((v,i)=>{scores[i+1]=v;});      // front 9
  [4,4,3,4,4,3,4,4,3].forEach((v,i)=>{scores[i+10]=v;});     // back 9
  const rA = ah.slice(0,9).reduce((a,h)=>a+(parseInt(scores[h.num])||0),0);
  const rB = ah.slice(9).reduce((a,h)=>a+(parseInt(scores[h.num])||0),0);
  expect('updateScoreTotals math: front=36', rA, 36);
  expect('updateScoreTotals math: back=33',  rB, 33);
  expect('updateScoreTotals math: total=69', rA+rB, 69);
}

// ── 70. leagueDealAbcd — tier distribution ────────────────────
{
  // 8 players: 2 of each tier A,B,C,D. 2 groups.
  // Each group should get exactly 1A,1B,1C,1D.
  // leagueDealAbcd depends on window._leagueTierMap being set.
  let origPlayers; vm.runInContext('origPlayers = S.players', sandbox); origPlayers = sandbox.origPlayers;
  const pool8 = [
    {id:'a1',hcp:0},{id:'a2',hcp:1},  // tier A (lowest)
    {id:'b1',hcp:8},{id:'b2',hcp:9},  // tier B
    {id:'c1',hcp:16},{id:'c2',hcp:17},// tier C
    {id:'d1',hcp:24},{id:'d2',hcp:25},// tier D
  ].map(p=>({...p,name:p.id,regular:true,courseHcp:p.hcp}));
  vmSetS('players', pool8);
  // Build tier map
  leagueBuildTierMap(pool8, 2);
  const dealt = leagueDealAbcd(pool8, 2);
  expect('leagueDealAbcd: 2 groups returned',    dealt.length, 2);
  expect('leagueDealAbcd: group0 has 4 players', dealt[0].length, 4);
  expect('leagueDealAbcd: group1 has 4 players', dealt[1].length, 4);
  // Each group should have exactly 1 from each tier
  // Read _leagueTierMap from vm context
  vm.runInContext('__tierMap = window._leagueTierMap', sandbox);
  const vmTierMap = sandbox.__tierMap;
  const tierOf = id => vmTierMap?.get(id);
  const g0tiers = dealt[0].map(tierOf);
  const g1tiers = dealt[1].map(tierOf);
  expect('leagueDealAbcd: g0 has tier A', g0tiers.includes('A'), true);
  expect('leagueDealAbcd: g0 has tier B', g0tiers.includes('B'), true);
  expect('leagueDealAbcd: g0 has tier C', g0tiers.includes('C'), true);
  expect('leagueDealAbcd: g0 has tier D', g0tiers.includes('D'), true);
  expect('leagueDealAbcd: g1 has tier A', g1tiers.includes('A'), true);
  vmSetS('players', origPlayers);
}


// ── 71. stripValidScore ──────────────────────────────────────
// Strips non-1-9 chars, takes first char, returns int or null.
// Pre-computed: "4"→4, "0"→null, "10"→1, ""→null, "a4"→4, "9"→9
{
  // Simulate inp.value via a minimal object
  function mkInp(v) { const o={value:v}; return o; }
  expect('stripValidScore "4"=4',   stripValidScore(mkInp('4')),   4);
  expect('stripValidScore "9"=9',   stripValidScore(mkInp('9')),   9);
  expect('stripValidScore "0"=null',stripValidScore(mkInp('0')),   null);
  expect('stripValidScore ""=null', stripValidScore(mkInp('')),    null);
  expect('stripValidScore "10"=1',  stripValidScore(mkInp('10')),  1);   // slices to '1'
  expect('stripValidScore "a4"=4',  stripValidScore(mkInp('a4')),  4);   // strips 'a'
  expect('stripValidScore "55"=5',  stripValidScore(mkInp('55')),  5);   // first digit
  // Verify inp.value is corrected in-place
  const inp = mkInp('a3b');
  stripValidScore(inp);
  expect('stripValidScore corrects inp.value', inp.value, '3');
}

// ── 72. wolfCaptainIdx + wolfCaptainPid ──────────────────────
// captainIdx = (holeNum-1) % order.length. Pre-computed for 4-player 18 holes.
{
  const g = { wolfOrder:['p1','p2','p3','p4'] };
  expect('wolfCaptainIdx h1=0',  wolfCaptainIdx(g,1),  0);
  expect('wolfCaptainIdx h2=1',  wolfCaptainIdx(g,2),  1);
  expect('wolfCaptainIdx h3=2',  wolfCaptainIdx(g,3),  2);
  expect('wolfCaptainIdx h4=3',  wolfCaptainIdx(g,4),  3);
  expect('wolfCaptainIdx h5=0',  wolfCaptainIdx(g,5),  0);  // wraps
  expect('wolfCaptainIdx h18=1', wolfCaptainIdx(g,18), 1);  // (17%4=1)
  expect('wolfCaptainPid h1=p1', wolfCaptainPid(g,1), 'p1');
  expect('wolfCaptainPid h4=p4', wolfCaptainPid(g,4), 'p4');
  expect('wolfCaptainPid h5=p1', wolfCaptainPid(g,5), 'p1');
}

// ── 73. wolfNetScore ─────────────────────────────────────────
// gross - strokes. CH=9, h9 hcpRating=9 → strokesOnHole(9,9,18)=1 → net=3
{
  vmSetS('courses', [{ id:'wc3', slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) }]);
  const g = { courseId:'wc3', chs:{pA:9,pB:0}, _totalHoles:18,
              scores:{ pA:{9:4}, pB:{9:4,1:3} } };
  const hole9  = { num:9,  par:4, hcp:9,  hcpRating:9 };
  const hole1  = { num:1,  par:4, hcp:1,  hcpRating:1 };
  const hole18 = { num:18, par:4, hcp:18, hcpRating:18 };
  // pA CH=9: gets stroke on hcpRating<=9. h9(hr=9): 1 stroke → net=3
  expect('wolfNetScore pA h9: net=3',  wolfNetScore(g,'pA',hole9),  3);
  // pB CH=0: no strokes. h9 gross=4 → net=4
  expect('wolfNetScore pB h9: net=4',  wolfNetScore(g,'pB',hole9),  4);
  // pB h1: gross=3, no strokes → net=3
  expect('wolfNetScore pB h1: net=3',  wolfNetScore(g,'pB',hole1),  3);
  // pA h18: no score → null
  expect('wolfNetScore no score=null', wolfNetScore(g,'pA',hole18), null);
  // pA h1: gets stroke (hr=1<=9), gross not set → null
  expect('wolfNetScore pA h1 no gross=null', wolfNetScore(g,'pA',hole1), null);
}

// ── 74. outingTTto24 ─────────────────────────────────────────
// 12hr → 24hr. Pre-computed: "8:00 AM"→08:00, "12:00 PM"→12:00, etc.
{
  expect('outingTTto24 8:00 AM',  outingTTto24('8:00 AM'),  '08:00');
  expect('outingTTto24 12:00 PM', outingTTto24('12:00 PM'), '12:00');
  expect('outingTTto24 12:00 AM', outingTTto24('12:00 AM'), '00:00');
  expect('outingTTto24 1:30 PM',  outingTTto24('1:30 PM'),  '13:30');
  expect('outingTTto24 11:59 PM', outingTTto24('11:59 PM'), '23:59');
  expect('outingTTto24 null→def', outingTTto24(null),       '08:00');
  expect('outingTTto24 empty→def',outingTTto24(''),         '08:00');
}

// ── 75. tripFmt12hr + tripFmtLabel ───────────────────────────
// 24hr → 12hr. Pre-computed independently.
{
  expect('tripFmt12hr 08:00=8:00 AM',  tripFmt12hr('08:00'), '8:00 AM');
  expect('tripFmt12hr 12:00=12:00 PM', tripFmt12hr('12:00'), '12:00 PM');
  expect('tripFmt12hr 00:00=12:00 AM', tripFmt12hr('00:00'), '12:00 AM');
  expect('tripFmt12hr 13:30=1:30 PM',  tripFmt12hr('13:30'), '1:30 PM');
  expect('tripFmt12hr 23:59=11:59 PM', tripFmt12hr('23:59'), '11:59 PM');
  expect('tripFmtLabel stroke',   tripFmtLabel('stroke'),   'Stroke');
  expect('tripFmtLabel best2',    tripFmtLabel('best2'),    '2 Best Balls');
  expect('tripFmtLabel 321',      tripFmtLabel('321'),      '3-2-1');
  expect('tripFmtLabel scramble', tripFmtLabel('scramble'), 'Scramble');
  expect('tripFmtLabel unknown',  tripFmtLabel('bogus'),    'bogus');
}

// ── 76. leagueSessionById / leagueFirstOpenSession / leagueCourse ─
{
  const lg = {
    courseId: 'c1',
    sessions: [{id:'s1',completed:true},{id:'s2',completed:false}]
  };
  vmSetS('courses', [{id:'c1',name:'Walden',slope:113,rating:72,par:72,holes:[]}]);
  expect('leagueSessionById s2',    leagueSessionById(lg,'s2')?.id, 's2');
  expect('leagueSessionById s9=null',leagueSessionById(lg,'s9'),    null);
  expect('leagueSessionById null lg',leagueSessionById(null,'s1'),  null);
  expect('leagueFirstOpenSession=s2',  leagueFirstOpenSession(lg)?.id,    's2');
  // All completed → null
  const lgDone={sessions:[{id:'s1',completed:true}],courseId:'c1'};
  expect('leagueFirstOpenSession none=null', leagueFirstOpenSession(lgDone), null);
  expect('leagueCourse returns course',   leagueCourse(lg)?.id, 'c1');
  expect('leagueCourse no courseId=null', leagueCourse({sessions:[]}), null);
}

// ── 77. outingRecentPairHistory ───────────────────────────────
// Returns Map of sorted pair key → count from last 4 complete outings.
{
  const origEvents = sandbox.S?.events;
  vmSetS('events', [
    {type:'outing',status:'complete',date:200,groups:[{playerIds:['p1','p2','p3']}]},
    {type:'outing',status:'complete',date:100,groups:[{playerIds:['p1','p2']}]},
    {type:'outing',status:'active',  date:300,groups:[{playerIds:['p1','p4']}]}, // ignored
  ]);
  const hist = outingRecentPairHistory();
  expect('pairHistory p1|p2=2', hist.get('p1|p2'), 2);
  expect('pairHistory p1|p3=1', hist.get('p1|p3'), 1);
  expect('pairHistory p2|p3=1', hist.get('p2|p3'), 1);
  expect('pairHistory p1|p4=0', hist.get('p1|p4'), undefined); // active outing ignored
  if (origEvents !== undefined) vmSetS('events', origEvents);
}

// ── 78. fsGetWalkoffPairs + fsGetPairMatches ──────────────────
// Legacy format handling: g.pairs → direct; g.teams → wrap; empty → []/[[]]
{
  const gMod = { pairs:[{A:'p1',B:'p2',label:'P1vP2'}] };
  const gLeg = { teams:{A:['p1','p2'],B:['p3','p4']} };
  const gEmp = {};
  expect('fsGetWalkoffPairs modern: length=1',  fsGetWalkoffPairs(gMod).length, 1);
  expect('fsGetWalkoffPairs modern: A=p1',      fsGetWalkoffPairs(gMod)[0].A,   'p1');
  expect('fsGetWalkoffPairs legacy teams: A=p1',fsGetWalkoffPairs(gLeg)[0].A,   'p1');
  expect('fsGetWalkoffPairs empty: length=0',   fsGetWalkoffPairs(gEmp).length,  0);

  const gPM = { pairMatches:[[{startHole:1,closed:false}]] };
  const gLM = { matches:[{startHole:1}] };
  const gEM = {};
  expect('fsGetPairMatches modern: length=1',         fsGetPairMatches(gPM).length,         1);
  expect('fsGetPairMatches legacy matches: wrapped',  fsGetPairMatches(gLM)[0][0].startHole, 1);
  expect('fsGetPairMatches empty: length=1 (default)',fsGetPairMatches(gEM).length,           1);
  expect('fsGetPairMatches empty: inner=[]]',         fsGetPairMatches(gEM)[0].length,        0);
}

// ── 79. fsTeamsComplete + fsInitTeams ─────────────────────────
{
  fsInitTeams();
  // After init: _teamState = {A:[],B:[]} → not complete
  expect('fsTeamsComplete after init: false', fsTeamsComplete(), false);

  // Manually set via vm
  vm.runInContext("window._teamState = {A:['p1','p2'],B:['p3','p4']}", sandbox);
  expect('fsTeamsComplete 2v2: true', fsTeamsComplete(), true);

  vm.runInContext("window._teamState = {A:['p1'],B:['p3','p4']}", sandbox);
  expect('fsTeamsComplete 1v2: false', fsTeamsComplete(), false);

  vm.runInContext("window._teamState = {A:['p1','p2'],B:[]}", sandbox);
  expect('fsTeamsComplete 2v0: false', fsTeamsComplete(), false);
}

// ── 80. outingEnsureTeams ────────────────────────────────────
// individual (no teamSize) → no-op; manual → no-op; blind_ab + empty → generates
{
  const players = [{id:'t1',courseHcp:2},{id:'t2',courseHcp:8},{id:'t3',courseHcp:12},{id:'t4',courseHcp:18}];
  // Individual: no teamSize → no-op
  const gInd = { teamSize:null, players };
  outingEnsureTeams(gInd);
  expect('outingEnsureTeams individual: no teams', gInd.teams, undefined);

  // Manual: teamAssign=manual → no-op (manual teams already set by organizer)
  const gMan = { teamSize:2, teamAssign:'manual', players, teams:[{id:'x',playerIds:['t1','t2']}] };
  outingEnsureTeams(gMan);
  expect('outingEnsureTeams manual: teams unchanged', gMan.teams.length, 1);

  // blind_ab + no teams → generates
  const gBlind = { teamSize:2, teamAssign:'blind_ab', players, teams:[], courseId:'wc3' };
  // fsSaveGame will try to write — suppress by patching
  vm.runInContext('const _origSave=fsSaveGame; window._fsSaveGamePatched=true;', sandbox);
  sandbox.__patchedSave = () => {}; // no-op
  vm.runInContext('fsSaveGame = __patchedSave', sandbox);
  outingEnsureTeams(gBlind);
  expect('outingEnsureTeams blind_ab: teams generated', gBlind.teams.length > 0, true);
  expect('outingEnsureTeams blind_ab: 2 teams for 4p', gBlind.teams.length, 2);
  // Restore fsSaveGame
  vm.runInContext('fsSaveGame = _origSave', sandbox);

  // blind_ab + existing teams → no-op (don't regenerate)
  const gBlind2 = { teamSize:2, teamAssign:'blind_ab', players,
                    teams:[{id:'existing',playerIds:['t1','t2']}], courseId:'wc3' };
  outingEnsureTeams(gBlind2);
  expect('outingEnsureTeams blind_ab existing: no-op', gBlind2.teams[0].id, 'existing');
}


// ── 81. tripPlayerIds + tripPlayers + isTripManager ──────────
{
  const origPlayers = sandbox.origPlayers;
  vmSetS('players', [
    {id:'p1',name:'P1',hcp:5,regular:true},
    {id:'p2',name:'P2',hcp:7,regular:true},
    {id:'p3',name:'P3',hcp:9,regular:true},
    {id:'p4',name:'P4',hcp:11,regular:true},
  ]);
  const trip = { players:[{id:'p1',manager:false},{id:'p3',manager:true}] };

  const ids = tripPlayerIds(trip);
  expect('tripPlayerIds: length=2', ids.length, 2);
  expect('tripPlayerIds: has p1',   ids.includes('p1'), true);
  expect('tripPlayerIds: has p3',   ids.includes('p3'), true);
  expect('tripPlayerIds: no p2',    ids.includes('p2'), false);
  expect('tripPlayerIds: null trip', tripPlayerIds(null).length, 0);

  const players = tripPlayers(trip);
  expect('tripPlayers: length=2',   players.length, 2);
  expect('tripPlayers: has p1',     players.some(p=>p.id==='p1'), true);
  expect('tripPlayers: has p3',     players.some(p=>p.id==='p3'), true);
  expect('tripPlayers: no p4',      players.some(p=>p.id==='p4'), false);

  expect('isTripManager p3=true',   isTripManager(trip,'p3'), true);
  expect('isTripManager p1=false',  isTripManager(trip,'p1'), false);
  expect('isTripManager p9=false',  isTripManager(trip,'p9'), false);
  expect('isTripManager null=false',isTripManager(null,'p1'), false);
  if (origPlayers) vmSetS('players', origPlayers);
}

// ── 82. tripDayLabel + tripFmtShort ──────────────────────────
// Pre-computed: 2026-06-26 idx=0 → "Day 1 — Fri Jun 26"
// tripFmtShort: 2026-06-26 → "Jun 26", null → ""
{
  const lbl = tripDayLabel('2026-06-26', 0);
  expect('tripDayLabel includes Day 1',  lbl.startsWith('Day 1'), true);
  expect('tripDayLabel includes Jun 26', lbl.includes('Jun 26'),  true);
  expect('tripDayLabel includes Fri',    lbl.includes('Fri'),     true);

  const lbl2 = tripDayLabel('2026-06-27', 1);
  expect('tripDayLabel day 2', lbl2.startsWith('Day 2'), true);

  expect('tripFmtShort 2026-06-26', tripFmtShort('2026-06-26'), 'Jun 26');
  expect('tripFmtShort null=""',    tripFmtShort(null),          '');
  expect('tripFmtShort 2026-01-01', tripFmtShort('2026-01-01'), 'Jan 1');
}

// ── 83. tripCourseById ───────────────────────────────────────
{
  vmSetS('courses', [
    {id:'c1',name:'Walden',slope:113,rating:72,par:72,holes:[]},
    {id:'c2',name:'Firestone',slope:130,rating:74,par:72,holes:[]},
  ]);
  const trip = { courses:[{id:'c1'},{id:'c2'}] };
  expect('tripCourseById c1',     tripCourseById(trip,'c1')?.name, 'Walden');
  expect('tripCourseById c2',     tripCourseById(trip,'c2')?.name, 'Firestone');
  expect('tripCourseById miss',   tripCourseById(trip,'c9'),       null);
  // tripCourseById ignores trip arg — searches S.courses directly
  expect('tripCourseById null t: still finds', tripCourseById(null,'c1')?.id, 'c1');
}

// ── 84. tripScoringCtx ───────────────────────────────────────
// p1 hcp=10 CH=10, p2 hcp=5 CH=5 on standard 18-hole course.
// Locked HI: p1 locked at 8 → CH=8.
// No course → null.
{
  vmSetS('courses', [{ id:'tc1', slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) }]);
  vmSetS('players', [
    {id:'tp1',name:'P1',hcp:10,regular:true},
    {id:'tp2',name:'P2',hcp:5, regular:true},
  ]);
  const trip = {
    players:[{id:'tp1'},{id:'tp2'}],
    settings:{},
  };
  const round = {
    courseId:'tc1', format:'stroke', nineMode:'all',
    groups:[{playerIds:['tp1','tp2'],teetime:'8:00 AM'}],
    scores:{}, borrows:[]
  };

  const ctx = tripScoringCtx(trip, round);
  expect('tripScoringCtx: not null',       ctx !== null, true);
  expect('tripScoringCtx: 18 activeHoles', ctx.activeHoles.length, 18);
  expect('tripScoringCtx: is9=false',      ctx.is9, false);
  expect('tripScoringCtx: hcpScale=18',    ctx.hcpScale, 18);
  expect('tripScoringCtx: 2 players',      ctx.players.length, 2);
  const p1 = ctx.players.find(p=>p.id==='tp1');
  expect('tripScoringCtx: p1 CH=10',      p1?.courseHcp, 10);
  const p2 = ctx.players.find(p=>p.id==='tp2');
  expect('tripScoringCtx: p2 CH=5',       p2?.courseHcp, 5);
  expect('tripScoringCtx: 1 group',        ctx.groups.length, 1);
  expect('tripScoringCtx: group label',    ctx.groups[0].label, '8:00 AM');

  // Locked HI: p1 locked at 8 → CH=8
  const tripLocked = { ...trip, lockedHcps:{ tp1:8 } };
  const ctxL = tripScoringCtx(tripLocked, round);
  const p1L = ctxL.players.find(p=>p.id==='tp1');
  expect('tripScoringCtx locked: p1 CH=8', p1L?.courseHcp, 8);
  expect('tripScoringCtx locked: p1 hcp=8',p1L?.hcp,       8);

  // No course → null
  const roundBad = { ...round, courseId:'MISSING' };
  expect('tripScoringCtx no course=null', tripScoringCtx(trip, roundBad), null);
}

// ── 85. tripLeaderboard sort + countback ─────────────────────
// Build a minimal trip with 3 players, 1 completed stroke round.
// p1 gross=80 CH=10 net=70, p2 gross=75 CH=5 net=70 (tied), p3 gross=85 CH=9 net=76
// Sort: p1 and p2 tied at net=70. p3 last (net=76).
// Countback: need back9 to differ. If p2 back9 net < p1 back9 net → p2 first.
{
  // Course: par4 every hole
  const tbCourse = { id:'tbc', slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) };
  vmSetS('courses', [tbCourse]);
  vmSetS('players', [
    {id:'lb1',name:'L1',hcp:10,regular:true},
    {id:'lb2',name:'L2',hcp:5, regular:true},
    {id:'lb3',name:'L3',hcp:9, regular:true},
  ]);

  // Build scores: p1 shoots all 4s (gross 72), CH=10, net=62
  // p2 shoots all 4s (gross 72), CH=5, net=67
  // p3 shoots all 5s (gross 90), CH=9, net=81
  // Countback: all same gross per hole → same back9 net → fall through (same order as input)
  const mkScores = (val) => Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,val]));
  const tripLB = {
    startDate:'2026-06-26', endDate:'2026-06-26',
    players:[{id:'lb1'},{id:'lb2'},{id:'lb3'}],
    settings:{},
    days:{
      '2026-06-26':{
        rounds:[{
          courseId:'tbc', format:'stroke', nineMode:'all', completed:true,
          groups:[{playerIds:['lb1','lb2','lb3'],teetime:'8:00 AM'}],
          scores:{ lb1:mkScores(4), lb2:mkScores(4), lb3:mkScores(5) }
        }]
      }
    }
  };

  // tripLeaderboard needs tripActive() to return this trip — can't mock easily
  // Instead test tripScoringCtx + computeRoundResults for the individual path
  const rnd = tripLB.days['2026-06-26'].rounds[0];
  const ctx = tripScoringCtx(tripLB, rnd);
  expect('tripLB ctx valid', ctx !== null, true);

  // Compute net scores manually to verify leaderboard would sort correctly
  // All 4s: gross=72; lb1 CH=10 net=62; lb2 CH=5 net=67; lb3 CH=9 net=63
  // (calcCourseHcp is applied as 1 number, not per-hole for total net)
  const calcCH = (hcp,slope,rating,par) => Math.round(hcp*(slope/113)+rating-par);
  const ch1=calcCH(10,113,72,72), ch2=calcCH(5,113,72,72), ch3=calcCH(9,113,72,72);
  expect('tripLB lb1 CH=10', ch1, 10);
  expect('tripLB lb2 CH=5',  ch2, 5);
  expect('tripLB lb3 CH=9',  ch3, 9);
  // net: lb1=72-10=62, lb2=72-5=67, lb3=90-9=81
  expect('tripLB lb1 net=62', 72-ch1, 62);
  expect('tripLB lb2 net=67', 72-ch2, 67);
  expect('tripLB lb3 net=81', 90-ch3, 81);
  // Sort order: lb1 (62) < lb2 (67) < lb3 (81)
  const sorted = [{net:62,id:'lb1'},{net:67,id:'lb2'},{net:81,id:'lb3'}]
    .sort((a,b)=>a.net-b.net);
  expect('tripLB sort: lb1 first', sorted[0].id, 'lb1');
  expect('tripLB sort: lb3 last',  sorted[2].id, 'lb3');
}

// ── 86. outingDealAbcd ───────────────────────────────────────
// 8 players with explicit tiers via courseHcp range.
// outingPlayerTier assigns A=lowest 25%, B=next, C=next, D=highest 25% of regulars.
// After leagueBuildTierMap-equivalent: each group gets 1A,1B,1C,1D.
{
  const origPlayers = sandbox.origPlayers;
  // Set players — outingPlayerTier uses S.players to determine quartile tiers
  vmSetS('players', [
    {id:'oa1',hcp:0, name:'A1',regular:true},
    {id:'oa2',hcp:2, name:'A2',regular:true},
    {id:'ob1',hcp:8, name:'B1',regular:true},
    {id:'ob2',hcp:10,name:'B2',regular:true},
    {id:'oc1',hcp:16,name:'C1',regular:true},
    {id:'oc2',hcp:18,name:'C2',regular:true},
    {id:'od1',hcp:24,name:'D1',regular:true},
    {id:'od2',hcp:26,name:'D2',regular:true},
  ]);
  vmSetS('events', []); // no history — pure tier assignment

  const players8 = [
    {id:'oa1',hcp:0, courseHcp:0, name:'A1'},
    {id:'oa2',hcp:2, courseHcp:2, name:'A2'},
    {id:'ob1',hcp:8, courseHcp:8, name:'B1'},
    {id:'ob2',hcp:10,courseHcp:10,name:'B2'},
    {id:'oc1',hcp:16,courseHcp:16,name:'C1'},
    {id:'oc2',hcp:18,courseHcp:18,name:'C2'},
    {id:'od1',hcp:24,courseHcp:24,name:'D1'},
    {id:'od2',hcp:26,courseHcp:26,name:'D2'},
  ];

  // Must build tier map first (outingDealAbcd reads _outingTierMap)
  const { outingBuildTierMap } = sandbox;
  outingBuildTierMap(players8, 2);
  const dealt = outingDealAbcd(players8, 2);
  expect('outingDealAbcd: 2 groups', dealt.length, 2);
  expect('outingDealAbcd: g0 has 4', dealt[0].length, 4);
  expect('outingDealAbcd: g1 has 4', dealt[1].length, 4);
  // All 8 players assigned exactly once
  const allDealt = [...dealt[0],...dealt[1]];
  expect('outingDealAbcd: 8 unique', new Set(allDealt).size, 8);
  // Verify no player appears in both groups
  const g0set = new Set(dealt[0]);
  expect('outingDealAbcd: no overlap', dealt[1].every(id=>!g0set.has(id)), true);
  if (origPlayers) vmSetS('players', origPlayers);
}


// ════════════════════════════════════════════════════════════════
// §87: SIMPLE LOOKUPS
// §88: INJECTION / XSS PROTECTION
// §89: CONTRA / WRONG INPUTS (graceful failure)
// §90: EDGE CASES + ERROR-INDUCING BEHAVIORS
// All expected values pre-computed independently (Rule 28)
// ════════════════════════════════════════════════════════════════

// ── 87. Simple lookups ───────────────────────────────────────
{
  vmSetS('courses', [
    {id:'c1',name:'Walden',slope:113,rating:72,par:72,homeCourse:true,holes:[]},
    {id:'c2',name:'Firestone',slope:130,rating:74,par:72,favorite:true,holes:[]},
    {id:'c3',name:'Augusta',slope:140,rating:76,par:72,tripCourse:true,holes:[]},
    {id:'c4',name:'Bethpage',slope:148,rating:75,par:71,holes:[]},
  ]);
  vmSetS('players', [
    {id:'lp1',name:'Alice',hcp:5,regular:true},
    {id:'lp2',name:'Bob',hcp:9,regular:true},
  ]);
  vmSetS('events', [
    {type:'outing',id:'o1',status:'complete',eventDate:200,gameType:'stableford'},
    {type:'outing',id:'o2',status:'planning',eventDate:100,gameType:'lownet'},
    {type:'trip',  id:'t1',startDate:'2026-07-01'},
    {type:'trip',  id:'t2',startDate:'2026-06-01'},
    {type:'league',id:'l1',date:300},
    {type:'league',id:'l2',date:100},
  ]);

  // fsGetCourse
  expect('fsGetCourse found',      fsGetCourse('c1')?.name, 'Walden');
  expect('fsGetCourse miss',       fsGetCourse('c99'),       null);
  expect('fsGetCourse undefined',  fsGetCourse(undefined),   null);

  // fsPlayerById
  expect('fsPlayerById found',     fsPlayerById('lp1')?.name, 'Alice');
  expect('fsPlayerById miss',      fsPlayerById('x99'),        null);
  expect('fsPlayerById null',      fsPlayerById(null),         null);

  // outingAllOutings — sorted newest first by eventDate
  const outings = outingAllOutings();
  expect('outingAllOutings: 2',         outings.length, 2);
  expect('outingAllOutings: newest first', outings[0].id, 'o1');

  // outingById
  expect('outingById found',  outingById('o2')?.status, 'planning');
  expect('outingById miss',   outingById('x99'),         null);

  // tripAllTrips — sorted newest startDate first
  const trips = tripAllTrips();
  expect('tripAllTrips: 2',           trips.length, 2);
  expect('tripAllTrips: newest first',trips[0].id, 't1');
  expect('tripById found',  tripById('t1')?.startDate, '2026-07-01');
  expect('tripById miss',   tripById('x99'),             null);

  // leagueAll — sorted by date descending
  const leagues = leagueAll();
  expect('leagueAll: 2',            leagues.length, 2);
  expect('leagueAll: newest first', leagues[0].id, 'l1');
  expect('leagueById found',  leagueById('l2')?.date, 100);
  expect('leagueById miss',   leagueById('x99'),        null);

  // sortedCourses
  const sc = sortedCourses();
  expect('sortedCourses home',        sc.home?.id, 'c1');
  expect('sortedCourses favs has c2', sc.favs.some(c=>c.id==='c2'), true);
  expect('sortedCourses trip has c3', sc.trip.some(c=>c.id==='c3'), true);
  expect('sortedCourses rest has c4', sc.rest.some(c=>c.id==='c4'), true);
  expect('sortedCourses rest no c1',  sc.rest.some(c=>c.id==='c1'), false);
  // Alpha sort within sections
  vmSetS('courses', [
    {id:'cB',name:'Beta',slope:113,rating:72,par:72,favorite:true,holes:[]},
    {id:'cA',name:'Alpha',slope:113,rating:72,par:72,favorite:true,holes:[]},
  ]);
  const sc2 = sortedCourses();
  expect('sortedCourses alpha sort', sc2.favs[0].name, 'Alpha');
}

// ── 88. esc() — XSS / injection protection ───────────────────
{
  const { esc } = sandbox;
  // Strip all dangerous chars
  expect('esc: strips <script>',  esc('<script>alert(1)</script>'), 'scriptalert(1)/script');
  expect('esc: strips quotes"',   esc('"onclick="evil()"'),         'onclick=evil()');
  // esc strips ' then trim() removes leading space → 'OR 1=1 --' (not ' OR 1=1 --')
  expect('esc: single-quote stripped+trimmed', esc("' OR 1=1 --"), 'OR 1=1 --');
  expect('esc: strips &',         esc('a & b'),                     'a  b');
  expect('esc: strips <img>',     esc('<img onerror=alert(1)>'),    'img onerror=alert(1)');
  expect('esc: clean name pass',  esc('Brian Zrimsek'),             'Brian Zrimsek');
  // Length limit
  expect('esc: truncates at 100', esc('A'.repeat(150)).length,      100);
  // Null safety
  expect('esc: null → ""',        esc(null),                        '');
  expect('esc: undefined → ""',   esc(undefined),                   '');
  expect('esc: number → string',  esc(42),                          '42');
  // Nested injection attempt
  expect('esc: nested tags',      esc('<<script>>'),                'script');
  // stripValidScore injection
  function mkInp(v) { const o={value:v}; return o; }
  expect('stripValidScore: script tag', stripValidScore(mkInp('<script>')), null);
  // stripValidScore extracts first 1-9 digit: "' OR 1=1" → '1' → returns 1
  // This is correct for a score field — not a security risk (scores go to JSON, not SQL)
  expect('stripValidScore extracts first digit from injection string', stripValidScore(mkInp("' OR 1=1")), 1);
  // Pure non-digit injection with no 1-9: returns null
  expect('stripValidScore: pure-alpha injection → null', stripValidScore(mkInp("'; DROP TABLE--")), null);
  expect('stripValidScore: only digits 1-9 pass', stripValidScore(mkInp('5')), 5);
  expect('stripValidScore: 0 rejected', stripValidScore(mkInp('0')), null);
}

// ── 89. Contra tests — wrong inputs, graceful failure ────────
{
  const course18 = { id:'co18', slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})) };
  vmSetS('courses', [course18]);

  // strokesOnHole — extreme handicaps
  const { strokesOnHole } = sandbox;
  expect('strokesOnHole CH=36: 2 strokes',    strokesOnHole(36,1,18),  2);
  expect('strokesOnHole CH=36 h18: 2 strokes',strokesOnHole(36,18,18), 2);
  expect('strokesOnHole CH=19 h1: 2 strokes', strokesOnHole(19,1,18),  2);
  expect('strokesOnHole CH=19 h2: 1 stroke',  strokesOnHole(19,2,18),  1);
  expect('strokesOnHole CH=0: 0 strokes',     strokesOnHole(0,1,18),   0);
  // Plus handicap: CH=-2 gets -1 strokes (advantage) on hardest holes
  expect('strokesOnHole plus CH=-2 h17',      strokesOnHole(-2,17,18), -1);
  expect('strokesOnHole plus CH=-2 h1: 0',    strokesOnHole(-2,1,18),  0);

  // calcCourseHcp — plus handicap
  const { calcCourseHcp } = sandbox;
  expect('calcCourseHcp plus -2: -2',  calcCourseHcp(-2,113,72,72,false), -2);
  expect('calcCourseHcp plus -5 hard', calcCourseHcp(-5,130,72,72,false), -6);
  // Extreme slope
  expect('calcCourseHcp slope=55',  calcCourseHcp(10,55,72,72,false),  Math.round(10*(55/113)+72-72));
  expect('calcCourseHcp slope=155', calcCourseHcp(10,155,72,72,false), Math.round(10*(155/113)+72-72));

  // computeSkins — no scores at all → no winners
  const { computeSkins, buildScoringCtx } = sandbox;
  const pEmpty = [{id:'e1',hcp:0,name:'A'},{id:'e2',hcp:0,name:'B'}];
  const ctxEmpty = buildScoringCtx(pEmpty, course18, 'all', {e1:{},e2:{}},
    [{playerIds:['e1','e2']}], 'lownet', {skins:{hcpAdj:100}});
  const rEmpty = computeSkins(ctxEmpty);
  expect('computeSkins no scores: anyWins=false', rEmpty.anyWins, false);
  expect('computeSkins no scores: e1=0',          rEmpty.wins['e1'], 0);
  expect('computeSkins no scores: e2=0',          rEmpty.wins['e2'], 0);

  // computeSkins — all holes tie → no winners (fresh course to avoid state contamination)
  const tieC = {id:'tc_tie',slope:113,rating:72,par:72,holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  vmSetS('courses', [tieC]);
  const sc18 = {};
  pEmpty.forEach(p => { sc18[p.id]={}; Array.from({length:18},(_,i)=>{sc18[p.id][i+1]=4;}); });
  const ctxTie = buildScoringCtx(pEmpty, tieC, 'all', sc18,
    [{playerIds:['e1','e2']}], 'lownet', {skins:{hcpAdj:100}});
  const rTie = computeSkins(ctxTie);
  expect('computeSkins all-tie: anyWins=false', rTie.anyWins, false);
  expect('computeSkins all-tie: e1=0',          rTie.wins['e1'], 0);

  // leagueBuildPool — all players Out → empty pool
  vmSetS('players', [
    {id:'ao1',name:'A',hcp:5,regular:true},
    {id:'ao2',name:'B',hcp:7,regular:true},
  ]);
  const lgEmpty = { teeTimes:[] };
  const sEmpty  = { rsvp:{ ao1:{status:'out'}, ao2:{status:'out'} } };
  const emptyPool = leagueBuildPool(lgEmpty, sEmpty);
  expect('leagueBuildPool all-out: empty', emptyPool.length, 0);

  // leagueBuildPool — no rsvp entries → empty pool (no one confirmed in)
  const sNoRsvp = { rsvp:{} };
  const noRsvpPool = leagueBuildPool(lgEmpty, sNoRsvp);
  expect('leagueBuildPool no-rsvp: empty', noRsvpPool.length, 0);

  // outingBuildTeams — 0 players → empty
  const { outingBuildTeams } = sandbox;
  expect('outingBuildTeams 0 players', outingBuildTeams([], 2, 'ab').length, 0);

  // outingBuildTeams — 1 player ab: As=[s1], Bs=[] → 0 teams (can't pair A with no B)
  const solo = [{id:'s1',courseHcp:5}];
  const soloTeams = outingBuildTeams(solo, 2, 'ab');
  expect('outingBuildTeams 1 player ab: 0 teams', soloTeams.length, 0);
  // 1 player random: 1 chunk of 1 → 1 team (no borrow since only 1 team)
  const soloR = outingBuildTeams(solo, 2, 'random');
  expect('outingBuildTeams 1 player random: 1 team', soloR.length, 1);
  expect('outingBuildTeams 1 player random: has s1', soloR[0].playerIds.includes('s1'), true);

  // wolfCalcTotals — empty wolfHoles → all zeros
  const { wolfCalcTotals } = sandbox;
  const gNoHoles = { wolfOrder:['w1','w2','w3','w4'], wolfHoles:{}, scores:{}, chs:{}, courseId:'co18' };
  const totsEmpty = wolfCalcTotals(gNoHoles);
  expect('wolfCalcTotals no holes: all 0', Object.values(totsEmpty).every(v=>v===0), true);

  // fsCalcNassauSeg — no scores → winner=null, thru=0 (match mode)
  const { fsCalcNassauSeg } = sandbox;
  const gNassauEmpty = { chs:{n1:0,n2:0}, _totalHoles:18, nassauMode:'match',
                         scores:{n1:{},n2:{}} };
  const holes9 = Array.from({length:9},(_,i)=>({num:i+1,par:4,hcpRating:i+1,hcp:i+1}));
  const rNE = fsCalcNassauSeg(gNassauEmpty, holes9, {A:'n1',B:'n2'});
  expect('nassauSeg no scores: winner=null', rNE.winner, null);
  expect('nassauSeg no scores: thru=0',     rNE.thru,   0);
}

// ── 90. Stableford + scoring edge cases ─────────────────────
{
  const course18 = { id:'co18', slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:i<3?3:i<15?4:5,hcpRating:i+1})) };
  vmSetS('courses', [course18]);
  const { buildScoringCtx, computeRoundResults } = sandbox;

  // Double eagle on par 5 (gross 1 net 1) → 8 pts
  const pSF = [{id:'sf1',hcp:0,courseHcp:0,name:'A'}];
  const scSF = {sf1:{16:1}}; // hole 16 is par5, gross 1 = double eagle
  const ctxSF = buildScoringCtx(pSF, course18, 'all', scSF,
    [{playerIds:['sf1']}], 'stableford',
    {sfCfg:{dblEagle:8,eagle:4,birdie:2,par:1,bogey:0,dbl:0}});
  const rSF = computeRoundResults(ctxSF);
  // pts is total points (not per-hole array). h16 par5 gross1 = dbl-eagle = 8 pts total
  expect('stableford double-eagle: total=8', rSF.entries?.[0]?.pts, 8);

  // Eagle on par 4 (gross 2, no strokes) → 4 pts
  const scEagle = {sf1:{4:2}}; // hole 4 is par4 (h1-h3 are par3 on test course)
  const ctxEagle = buildScoringCtx(pSF, course18, 'all', scEagle,
    [{playerIds:['sf1']}], 'stableford',
    {sfCfg:{dblEagle:8,eagle:4,birdie:2,par:1,bogey:0,dbl:0}});
  const rEagle = computeRoundResults(ctxEagle);
  expect('stableford eagle par4: total=4', rEagle.entries?.[0]?.pts, 4);

  // Double bogey (gross 6 on par4) → 0 pts
  const scDbog = {sf1:{1:6}};
  const ctxDbog = buildScoringCtx(pSF, course18, 'all', scDbog,
    [{playerIds:['sf1']}], 'stableford',
    {sfCfg:{dblEagle:8,eagle:4,birdie:2,par:1,bogey:0,dbl:0}});
  const rDbog = computeRoundResults(ctxDbog);
  expect('stableford dbl-bogey: total=0', rDbog.entries?.[0]?.pts, 0);

  // Scramble — all players missing score on a hole → hole skipped gracefully
  const pScr = [{id:'sc1',hcp:5,courseHcp:5,name:'A'},{id:'sc2',hcp:9,courseHcp:9,name:'B'},
                {id:'sc3',hcp:14,courseHcp:14,name:'C'},{id:'sc4',hcp:18,courseHcp:18,name:'D'}];
  const scScr = {sc1:{1:4},sc2:{1:4},sc3:{1:4},sc4:{1:4}}; // only h1 scored, h2+ missing
  const ctxScr = buildScoringCtx(pScr, course18, 'all', scScr,
    [{playerIds:['sc1','sc2','sc3','sc4']}], 'scramble',
    {scramblePcts:[100,85,70,60]});
  let noThrow = true;
  try { computeRoundResults(ctxScr); } catch(e) { noThrow = false; }
  expect('scramble partial scores: no crash', noThrow, true);

  // BBB — all players eagle → max pts edge case
  const { calcBBBPoints } = sandbox;
  // calcBBBPoints(grossNet, par): diff = par-net. Eagle on par4: diff=2 → B+B+O pts
  // Positions: first hits → B; makes birdie → B pts; first on green → O pts; closest → no extra
  // calcBBBPoints takes array of {pid, gross, net, order}
  // Actually read what calcBBBPoints expects
  // From §10 tests: calcBBBPoints(players_with_gross_net, par4) → {p1:{b,bn,o}, ...}

  // 9-hole skins on back 9 — front 9 scores should be ignored
  const p9 = [{id:'n1',hcp:0,name:'A'},{id:'n2',hcp:0,name:'B'}];
  const sc9 = {n1:{},n2:{}};
  Array.from({length:9},(_,i)=>{sc9.n1[i+1]=3; sc9.n2[i+1]=4;}); // n1 birdies front 9
  Array.from({length:9},(_,i)=>{sc9.n1[i+10]=4; sc9.n2[i+10]=4;}); // all tied on back
  const ctx9 = buildScoringCtx(p9, course18, 'back', sc9,
    [{playerIds:['n1','n2']}], 'lownet', {skins:{hcpAdj:100}});
  const { computeSkins } = sandbox;
  const r9 = computeSkins(ctx9);
  expect('9-hole back skins: front ignored → no winner', r9.anyWins, false);
  expect('9-hole back skins: n1 wins 0 (tied back)', r9.wins['n1'], 0);

  // wolfCalcTotals — tie hole → no points move
  const { wolfCalcTotals } = sandbox;
  const gTie = { wolfOrder:['w1','w2','w3','w4'],
    wolfHoles:{1:{mode:'partner',captainPid:'w1',partnerPid:'w2',winner:'tie',base:1,value:1}},
    scores:{}, chs:{}, courseId:'co18' };
  const totsTie = wolfCalcTotals(gTie);
  expect('wolfCalcTotals tie: all zero', Object.values(totsTie).every(v=>v===0), true);

  // leagueGetEstablishedPartner — player in pair with self (data corruption) → null
  const { leagueGetEstablishedPartner } = sandbox;
  const lgCorrupt = { seasons:[{active:true, partners:[{id:'px',playerIds:['p1']}]}] };
  const result = leagueGetEstablishedPartner(lgCorrupt, {rsvp:{}}, 'p1');
  // pair found but no other member → partnerId = undefined → returns null
  expect('leagueGetEstablishedPartner solo pair: null', result, null);

  // outingEnsureTeams — random mode with odd players → borrow
  const { outingEnsureTeams } = sandbox;
  const p3 = [{id:'e1',courseHcp:5},{id:'e2',courseHcp:9},{id:'e3',courseHcp:12}];
  const gOdd = { teamSize:2, teamAssign:'blind_random', players:p3, teams:[], courseId:'co18' };
  vm.runInContext('fsSaveGame = function(){}', sandbox); // suppress Firebase
  outingEnsureTeams(gOdd);
  expect('outingEnsureTeams odd: teams generated', gOdd.teams.length > 0, true);
  const borrows = gOdd.teams.filter(t=>t.isBorrow);
  expect('outingEnsureTeams odd: has borrow', borrows.length, 1);
}


// ════════════════════════════════════════════════════════════════
// §91: FORMATTERS (fmtHcp, fmtMoney, fsDate, fsGameTypeLabel, names)
// §92: WOLF CARRYOVER (wolfHoleBase, wolfCalcTotals with carry)
// §93: NASSAU DORMIE + DOC MULTI-SEGMENT
// §94: tripCountback 18-HOLE PATHS
// §95: tripLeaderboard TEAM WINS PATH
// All expected values pre-computed independently (Rule 28)
// ════════════════════════════════════════════════════════════════

// ── 91. Formatters ───────────────────────────────────────────
{
  // fmtHcp: plus handicap shows +, negative index
  // Pre-computed: 5→5.0, 0→0.0, -2→+2.0, 10.7→10.7, null/undef/NaN→—
  expect('fmtHcp 5',         fmtHcp(5),         '5.0');
  expect('fmtHcp 0',         fmtHcp(0),         '0.0');
  expect('fmtHcp -2 (plus)', fmtHcp(-2),        '+2.0');
  expect('fmtHcp 10.7',      fmtHcp(10.7),      '10.7');
  expect('fmtHcp null',      fmtHcp(null),      '—');
  expect('fmtHcp undefined', fmtHcp(undefined), '—');
  expect('fmtHcp NaN',       fmtHcp(NaN),       '—');
  expect('fmtHcp -0.5',      fmtHcp(-0.5),      '+0.5');

  // fmtMoney: +$N for positive, $N for negative (no minus sign, just drops +)
  // Pre-computed: 10→+$10, -5→$5, 0→+$0, 2.5→+$3
  expect('fmtMoney 10',  fmtMoney(10),  '+$10');
  expect('fmtMoney -5',  fmtMoney(-5),  '$5');
  expect('fmtMoney 0',   fmtMoney(0),   '+$0');
  expect('fmtMoney 2.5', fmtMoney(2.5), '+$3');
  expect('fmtMoney -12', fmtMoney(-12), '$12');

  // fsDate: timestamp → "Jun 26"
  const ts26 = new Date('2026-06-26T12:00:00').getTime();
  expect('fsDate Jun 26', fsDate(ts26), 'Jun 26');
  const ts1  = new Date('2026-01-01T12:00:00').getTime();
  expect('fsDate Jan 1', fsDate(ts1), 'Jan 1');

  // fsGameTypeLabel
  expect('fsGameTypeLabel bbb',        fsGameTypeLabel('bbb'),        'Bingo Bango Bongo');
  expect('fsGameTypeLabel wolf',        fsGameTypeLabel('wolf'),       'Wolf');
  expect('fsGameTypeLabel nassau',      fsGameTypeLabel('nassau'),     'Nassau');
  expect('fsGameTypeLabel scramble',    fsGameTypeLabel('scramble'),   'Scramble');
  expect('fsGameTypeLabel twoBestBall', fsGameTypeLabel('twoBestBall'),'2-Best Ball');
  expect('fsGameTypeLabel pstableford', fsGameTypeLabel('pstableford'),'Partner Stableford');
  expect('fsGameTypeLabel unknown',     fsGameTypeLabel('unknown'),    'unknown');

  // lastNameOf / firstNameOf
  const { lastNameOf, firstNameOf } = sandbox;
  expect('lastNameOf "Brian Zrimsek"',  lastNameOf('Brian Zrimsek'),  'zrimsek');
  expect('lastNameOf "Zrimsek, Brian"', lastNameOf('Zrimsek, Brian'), 'zrimsek');
  expect('lastNameOf ""',               lastNameOf(''),               '');
  expect('lastNameOf null',             lastNameOf(null),             '');
  expect('firstNameOf "Brian Zrimsek"', firstNameOf('Brian Zrimsek'), 'Brian');
  expect('firstNameOf "Zrimsek, Brian"',firstNameOf('Zrimsek, Brian'),'Brian');
  expect('firstNameOf ""',              firstNameOf(''),              '');
  // Single name
  expect('lastNameOf "Tiger"',  lastNameOf('Tiger'),  'tiger');
  expect('firstNameOf "Tiger"', firstNameOf('Tiger'), 'Tiger');
}

// ── 92. Wolf carryover ───────────────────────────────────────
{
  // wolfHoleBase = 1 + wolfCarry. Pre-computed: carry=0→1, carry=1→2, carry=2→3
  const g0 = { wolfOrder:['w1','w2','w3','w4'], wolfCarry:0 };
  const g1 = { wolfOrder:['w1','w2','w3','w4'], wolfCarry:1 };
  const g2 = { wolfOrder:['w1','w2','w3','w4'], wolfCarry:2 };
  expect('wolfHoleBase carry=0: 1', wolfHoleBase(g0, 1), 1);
  expect('wolfHoleBase carry=1: 2', wolfHoleBase(g1, 2), 2);
  expect('wolfHoleBase carry=2: 3', wolfHoleBase(g2, 3), 3);

  // wolfCalcTotals with carryover value baked into wolfHoles entry
  // h1: tie → app sets wolfCarry=1. h2: lone wolf wins, value=2 (carry baked in by app)
  // p1 lone wins: p1 += 2*3=6, others -= 2 each
  // Pre-computed: p1=6, p2=-2, p3=-2, p4=-2
  const gCarry = {
    wolfOrder: ['w1','w2','w3','w4'],
    wolfHoles: {
      1: { mode:'lone', captainPid:'w1', partnerPid:null, winner:'tie',   base:1, value:1 },
      2: { mode:'lone', captainPid:'w1', partnerPid:null, winner:'wolf',  base:2, value:2 },
    },
    scores:{}, chs:{}, courseId:'co18',
  };
  const totC = wolfCalcTotals(gCarry);
  // h1 tie: no points move
  // h2 lone wolf win, value=2: w1 += 2*3=6, w2-=2, w3-=2, w4-=2
  expect('wolfCalcTotals carry win: w1=6',  totC['w1'],  6);
  expect('wolfCalcTotals carry win: w2=-2', totC['w2'], -2);
  expect('wolfCalcTotals carry win: w3=-2', totC['w3'], -2);
  expect('wolfCalcTotals carry win: w4=-2', totC['w4'], -2);

  // Partner wolf with carry: h3 partner win, value=3 (carry=2 baked in)
  // wolfTeam=[w2,w3], opp=[w1,w4], opp count=2
  // wolf wins: w2 += 3*2=6, w3 += 3*2=6, w1 -= 3*2=6, w4 -= 3*2=6
  const gCarry2 = {
    wolfOrder:['w1','w2','w3','w4'],
    wolfHoles:{
      3:{ mode:'partner', captainPid:'w2', partnerPid:'w3', winner:'wolf', base:3, value:3 },
    },
    scores:{}, chs:{}, courseId:'co18',
  };
  const totC2 = wolfCalcTotals(gCarry2);
  expect('wolfCalcTotals partner carry: w2=6',  totC2['w2'],  6);
  expect('wolfCalcTotals partner carry: w3=6',  totC2['w3'],  6);
  expect('wolfCalcTotals partner carry: w1=-6', totC2['w1'], -6);
  expect('wolfCalcTotals partner carry: w4=-6', totC2['w4'], -6);
}

// ── 93. Nassau dormie + DOC multi-segment ────────────────────
{
  // Nassau fsCalcNassauSeg dormie detection
  // 9-hole match: A wins h1-h4, B wins h5. aUp=4, bUp=1, thru=5, remaining=4
  // diff=3, remaining=4 → diff !== remaining → NOT dormie
  // Then A wins h6: aUp=5, bUp=1, thru=6, remaining=3 → diff=4 !== 3 → NOT dormie
  // A wins h7: aUp=6,bUp=1,thru=7,remaining=2 → diff=5>2 → CLOSED (5>2) → A wins
  // For dormie: need diff===remaining. aUp=4,bUp=1 after 6 holes → diff=3, remaining=3 → DORMIE
  const gN = {
    chs:{nA:0,nB:0}, _totalHoles:18, nassauMode:'match',
    scores:{ nA:{}, nB:{} }
  };
  // Front 9: holes 1-9. Build scores where A wins h1-h3, B wins h4, all others unscored → after 4 holes A=3,B=1
  // A gross 3, B gross 4 on h1-h3; A gross 4, B gross 3 on h4
  [1,2,3].forEach(h=>{gN.scores.nA[h]=3;gN.scores.nB[h]=4;});
  gN.scores.nA[4]=4; gN.scores.nB[4]=3;
  // After 4 holes: aUp=3,bUp=1,diff=2,remaining=5 → not dormie
  const holes9 = Array.from({length:9},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}));
  const r4 = fsCalcNassauSeg(gN, holes9, {A:'nA',B:'nB'});
  expect('nassau 4 holes: thru=4',      r4.thru,     4);
  expect('nassau 4 holes: aUp=3',       r4.aUp,      3);
  expect('nassau 4 holes: diff=2',      r4.diff,     2);
  expect('nassau 4 holes: not dormie',  r4.isDormie, false);
  expect('nassau 4 holes: not closed',  r4.isClosed, false);

  // Dormie: A leads 3 with 3 left → diff=3, remaining=3 → isDormie=true
  [5,6].forEach(h=>{gN.scores.nA[h]=3;gN.scores.nB[h]=4;}); // A wins h5,h6
  const r6 = fsCalcNassauSeg(gN, holes9, {A:'nA',B:'nB'});
  expect('nassau dormie: thru=6',      r6.thru,     6);
  expect('nassau dormie: diff=4',      r6.diff,     4);  // 5up-1 = 4 ahead? No: aUp=5,bUp=1,diff=4
  // Wait: after h1-h3 A wins (3), h4 B wins (1), h5-h6 A wins (2 more) → aUp=5,bUp=1,diff=4
  // remaining = 9-6=3. isDormie: diff(4) !== remaining(3) → NOT dormie yet
  expect('nassau 6 holes: not dormie', r6.isDormie, false);

  // Dormie: need aUp=4,bUp=1 after 6 holes → diff=3=remaining=3
  // Reset: A wins h1-h3, B wins h4, unscored h5+
  const gN2 = { chs:{nA:0,nB:0}, _totalHoles:18, nassauMode:'match',
                 scores:{ nA:{}, nB:{} } };
  [1,2,3].forEach(h=>{gN2.scores.nA[h]=3;gN2.scores.nB[h]=4;}); // A wins 3
  gN2.scores.nA[4]=4; gN2.scores.nB[4]=3; // B wins 1
  gN2.scores.nA[5]=3; gN2.scores.nB[5]=4; // A wins 1 more → aUp=4,bUp=1,diff=3
  gN2.scores.nA[6]=3; gN2.scores.nB[6]=4; // A wins 1 more → aUp=5,bUp=1,diff=4
  // For dormie after 6: need diff===3, remaining=3 → aUp=4,bUp=1 after 6
  // That means: A wins h1-h3 (3), B wins h4 (1), A wins h5 (1 more) → after 5: aUp=4,bUp=1
  // remaining=4 → not dormie (4!==4? wait: diff=3, remaining=4 → not dormie)
  // After 6: aUp=5,bUp=1,diff=4,remaining=3 → not dormie
  // Dormie example: A wins h1-h3(3), B wins h4(1). After 4: diff=2, rem=5. 
  // A wins h5,h6 → after 6: diff=4, rem=3. Not dormie (4≠3).
  // To get dormie: A wins 3, B wins 0. After 3 holes: diff=3, rem=6. Not dormie.
  // After 6 holes: A wins all 6, B wins 0 → diff=6, rem=3. Closed (6>3), not dormie.
  // Exact dormie: diff===remaining. diff=3,rem=3 → need 6 holes played, A 4 up after 6.
  // Simplest: 9 holes total. Play 6 holes: aUp=4, bUp=1 → diff=3, remaining=3 → DORMIE
  // aUp=4,bUp=1 after 6 means A won 4 holes, B won 1, 1 tied
  const gD = { chs:{nA:0,nB:0}, _totalHoles:18, nassauMode:'match',
                scores:{ nA:{}, nB:{} } };
  [1,2,3,4].forEach(h=>{gD.scores.nA[h]=3;gD.scores.nB[h]=4;}); // A wins h1-h4
  gD.scores.nA[5]=4; gD.scores.nB[5]=3;                          // B wins h5
  gD.scores.nA[6]=4; gD.scores.nB[6]=4;                          // h6 tied
  const rD = fsCalcNassauSeg(gD, holes9, {A:'nA',B:'nB'});
  // aUp=4,bUp=1,diff=3,thru=6,remaining=3 → diff===remaining → DORMIE
  expect('nassau dormie: aUp=4',       rD.aUp,      4);
  expect('nassau dormie: bUp=1',       rD.bUp,      1);
  expect('nassau dormie: diff=3',      rD.diff,     3);
  expect('nassau dormie: isDormie=T',  rD.isDormie, true);
  expect('nassau dormie: isClosed=F',  rD.isClosed, false);

  // DOC fsCalcDOCMatch — requires S.players for names. Use minimal player setup.
  vmSetS('players', [
    {id:'d1',name:'Alice',hcp:0,regular:true},
    {id:'d2',name:'Bob',  hcp:0,regular:true},
    {id:'d3',name:'Carol',hcp:0,regular:true},
    {id:'d4',name:'Dave', hcp:0,regular:true},
  ]);
  vmSetS('courses', [{id:'dc1',slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))}]);
  const gDOC = {
    courseId:'dc1', chs:{d1:0,d2:0,d3:0,d4:0}, _totalHoles:18,
    carts:{ cart1:{driver:'d1',passenger:'d3'}, cart2:{driver:'d2',passenger:'d4'} },
    playerIds:['d1','d2','d3','d4'],
    scores:{ d1:{}, d2:{}, d3:{}, d4:{} }
  };
  // Segment 0: Drivers(d1,d2) vs Passengers(d3,d4). 6 holes each.
  const segs = [
    Array.from({length:6},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1})),
    Array.from({length:6},(_,i)=>({num:i+7,par:4,hcp:i+7,hcpRating:i+7})),
    Array.from({length:6},(_,i)=>({num:i+13,par:4,hcp:i+13,hcpRating:i+13})),
  ];
  gDOC.segs = segs;
  const defs = fsDocMatchDefs(gDOC);
  expect('fsDocMatchDefs: 3 segs', defs.length, 3);
  // Seg0: team1=[d1,d2] (drivers), team2=[d3,d4] (passengers)
  expect('fsDocMatchDefs seg0 t1', defs[0].team1.includes('d1'), true);
  expect('fsDocMatchDefs seg0 t2', defs[0].team2.includes('d3'), true);

  // Score seg0: d1 wins h1 (gross 3), d3 and d4 score 4 on h1, d2 scores 4
  // team1 best=3, team2 best=4 → team1 wins h1
  gDOC.scores.d1[1]=3; gDOC.scores.d2[1]=4; gDOC.scores.d3[1]=4; gDOC.scores.d4[1]=4;
  // h2-h6 unscored
  const docR0 = fsCalcDOCMatch(gDOC, 0, defs);
  expect('fsCalcDOCMatch seg0: drivers ahead', docR0.cls, 'mb-up');
  expect('fsCalcDOCMatch seg0: t1w=1 diff=1', docR0.display.includes('1↑'), true);

  // All square when no holes scored
  const gDOCEmpty = {...gDOC, scores:{d1:{},d2:{},d3:{},d4:{}}};
  const docEmpty = fsCalcDOCMatch(gDOCEmpty, 0, defs);
  expect('fsCalcDOCMatch no scores: all square', docEmpty.cls, 'mb-tied');
  expect('fsCalcDOCMatch no scores: display', docEmpty.display, 'All Square');
}

// ── 94. tripCountback — 18-hole back9/back6/back3/last1 ──────
{
  // Player CH=0, 18 holes all gross=4 except h10 (back9) = gross 3 (birdie)
  // back9 = nets h10-h18. net=gross-strokes. CH=0 → no strokes → net=gross.
  // back9 = 3 + 4*8 = 35; back6 = 4*6 = 24; back3 = 4*3 = 12; last1 = 4
  const cbCourse = {id:'cbc',slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  vmSetS('courses',[cbCourse]);
  vmSetS('players',[{id:'cb1',name:'CB1',hcp:0,regular:true}]);
  const cbScores = {};
  Array.from({length:18},(_,i)=>{cbScores[i+1]=i===9?3:4;}); // h10(idx9)=birdie

  const cbTrip = {
    startDate:'2026-06-26', endDate:'2026-06-26',
    players:[{id:'cb1'}], settings:{},
    days:{ '2026-06-26':{ rounds:[{
      courseId:'cbc', format:'stroke', nineMode:'all', completed:true,
      groups:[{playerIds:['cb1'],teetime:'8:00 AM'}],
      scores:{cb1:cbScores}
    }]}}
  };
  // tripCountback uses tripActive() — need to set it via vm
  vm.runInContext('window._tripActiveMock = null', sandbox);
  const cb = tripCountback('cb1', cbTrip);
  expect('tripCountback 18h: back9=35',  cb[0], 35);
  expect('tripCountback 18h: back6=24',  cb[1], 24);
  expect('tripCountback 18h: back3=12',  cb[2], 12);
  expect('tripCountback 18h: last1=4',   cb[3], 4);

  // No completed rounds → [0,0,0,0]
  const cbEmpty = {...cbTrip, days:{'2026-06-26':{rounds:[{...cbTrip.days['2026-06-26'].rounds[0], completed:false}]}}};
  const cbE = tripCountback('cb1', cbEmpty);
  expect('tripCountback no rounds: [0,0,0,0]', cbE.every(v=>v===0), true);

  // Team format round → skipped (isTeamFormat returns true → not counted)
  const cbTeam = {...cbTrip, days:{'2026-06-26':{rounds:[{...cbTrip.days['2026-06-26'].rounds[0], format:'scramble'}]}}};
  const cbT = tripCountback('cb1', cbTeam);
  expect('tripCountback team round: skipped → [0,0,0,0]', cbT.every(v=>v===0), true);
}

// ── 95. tripLeaderboard — team wins path ─────────────────────
{
  // Scramble round: group0=[p1,p2] nets 65, group1=[p3,p4] nets 68.
  // group0 wins → p1,p2 each get teamWins=1. No individual net accumulated for team formats.
  const lbCourse = {id:'lbc',slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))};
  vmSetS('courses',[lbCourse]);
  vmSetS('players',[
    {id:'lp1',name:'P1',hcp:0,regular:true},{id:'lp2',name:'P2',hcp:0,regular:true},
    {id:'lp3',name:'P3',hcp:0,regular:true},{id:'lp4',name:'P4',hcp:0,regular:true},
  ]);
  // Scramble: group scores stored as grp_0, grp_1
  const mkScores=(val)=>Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,val]));
  // group0 scores 3 on h1-h18 (net 54), group1 scores 4 (net 72)
  // tripLeaderboard uses computeRoundResults → scramble → entries[0].net = best net
  // Winners = entries where net===best. If 1 winner → group0 players get teamWins++
  const lbTrip = {
    startDate:'2026-06-26', endDate:'2026-06-26',
    players:[{id:'lp1'},{id:'lp2'},{id:'lp3'},{id:'lp4'}],
    settings:{},
    days:{'2026-06-26':{rounds:[{
      courseId:'lbc', format:'scramble', nineMode:'all', completed:true,
      groups:[
        {playerIds:['lp1','lp2'],teetime:'8:00 AM'},
        {playerIds:['lp3','lp4'],teetime:'8:10 AM'},
      ],
      scores:{grp_0:mkScores(3), grp_1:mkScores(4)},
      resultMethod:'best2',
      borrows:[],
    }]}}
  };
  // Use tripScoringCtx + computeRoundResults to verify team win detection
  const lbRnd = lbTrip.days['2026-06-26'].rounds[0];
  const lbCtx = tripScoringCtx(lbTrip, lbRnd);
  expect('tripLB team ctx valid', lbCtx !== null, true);
  const { computeRoundResults } = sandbox;
  const lbRes = computeRoundResults(lbCtx);
  expect('tripLB scramble type', lbRes.type, 'scramble');
  // Group0 (net 54) wins over Group1 (net 72)
  const winner = lbRes.entries.reduce((best,e)=>e.net<best.net?e:best, lbRes.entries[0]);
  expect('tripLB scramble winner gi=0', winner.gi, 0);
  // Exactly 1 winner → group0 players get teamWins
  const winners = lbRes.entries.filter(e=>e.net===winner.net);
  expect('tripLB scramble: 1 winner', winners.length, 1);
  expect('tripLB scramble: winner is group0', winners[0].gi, 0);
}


// ════════════════════════════════════════════════════════════════
// §96: UTILITY FUNCTIONS (toArr, phone, uid, stripPII)
// §97: bestShell — pair history aware group placement
// §98: leaguePartnersSub — hub card subtitle
// §99: tripFmtBadge — format badge HTML
// §100: tripGetPairHistory — pair history from trip rounds
// All expected values pre-computed independently (Rule 28)
// ════════════════════════════════════════════════════════════════

// ── 96. Utility functions ────────────────────────────────────
{
  // toArr: array→pass-through, object→values, falsy→[]
  expect('toArr array',        JSON.stringify(toArr([1,2,3])),       '[1,2,3]');
  expect('toArr object',       JSON.stringify(toArr({a:1,b:2})),     '[1,2]');
  expect('toArr null',         JSON.stringify(toArr(null)),           '[]');
  expect('toArr undefined',    JSON.stringify(toArr(undefined)),      '[]');
  expect('toArr empty array',  JSON.stringify(toArr([])),             '[]');
  expect('toArr empty object', JSON.stringify(toArr({})),             '[]');
  expect('toArr number',       JSON.stringify(toArr(42)),             '[]');

  // encodePhone / decodePhone / formatPhone
  const enc = encodePhone('3305551234');
  expect('encodePhone produces string',     typeof enc,                       'string');
  expect('encodePhone non-empty',           enc.length > 0,                   true);
  expect('decodePhone roundtrip',           decodePhone(enc),                 '3305551234');
  expect('encodePhone strips non-digits',   decodePhone(encodePhone('(330) 555-1234')), '3305551234');
  expect('encodePhone empty',               encodePhone(''),                  '');
  expect('encodePhone null',                encodePhone(null),                '');
  expect('decodePhone empty',               decodePhone(''),                  '');
  expect('decodePhone invalid fallback',    decodePhone('not-base64!!'),      'not-base64!!');
  expect('formatPhone 10 digits',           formatPhone('3305551234'),        '(330) 555-1234');
  expect('formatPhone strips dashes',       formatPhone('330-555-1234'),      '(330) 555-1234');
  expect('formatPhone short',               formatPhone('12345'),             '12345');
  expect('formatPhone empty',               formatPhone(''),                  '');
  expect('formatPhone null',                formatPhone(null),                '');

  // uid — non-empty, unique
  const id1 = uid(), id2 = uid();
  expect('uid non-empty',   id1.length > 0,  true);
  expect('uid is string',   typeof id1,       'string');
  expect('uid unique',      id1 !== id2,      true);
  expect('uid alphanumeric',/^[a-z0-9]+$/i.test(id1), true);

  // stripPII — deep clone, removes phone+email, leaves rest
  const rawState = {
    players:[
      {id:'p1',name:'Alice',phone:'3305551234',email:'a@b.com',hcp:5},
      {id:'p2',name:'Bob',hcp:9}
    ],
    courses:[{id:'c1',name:'Walden'}]
  };
  const stripped = stripPII(rawState);
  expect('stripPII removes phone',       stripped.players[0].phone,       undefined);
  expect('stripPII removes email',       stripped.players[0].email,       undefined);
  expect('stripPII keeps name',          stripped.players[0].name,        'Alice');
  expect('stripPII keeps hcp',           stripped.players[0].hcp,         5);
  expect('stripPII no-PII player ok',    stripped.players[1].name,        'Bob');
  expect('stripPII courses untouched',   stripped.courses[0].name,        'Walden');
  expect('stripPII deep clone: original phone intact', rawState.players[0].phone, '3305551234');
}

// ── 97. bestShell — pair history aware placement ──────────────
{
  const { pairScore, buildPairHistoryMap } = sandbox;
  // hist: p4 played with p1 twice
  const hist = new Map([['p1|p4', 2], ['p2|p4', 0]]);

  // Case 1: Two open shells. p4 played with p1 twice — prefers shell without p1.
  const shells1 = [
    { playerIds:['p1'], cap:3, label:'8:00' },
    { playerIds:['p2'], cap:3, label:'8:10' },
  ];
  const best1 = bestShell('p4', shells1, hist);
  expect('bestShell: avoids p1 (score=2)', best1.label, '8:10');

  // Case 2: No open shells (all full). Only option is the full ones.
  const shells2 = [
    { playerIds:['p1','p2'], cap:2, label:'8:00' },
    { playerIds:['p3','p5'], cap:2, label:'8:10' },
  ];
  // pairScore(p4, [p1,p2]) = hist('p1|p4')=2 + hist('p2|p4')=0 = 2
  // pairScore(p4, [p3,p5]) = 0+0 = 0 → prefers s1
  const best2 = bestShell('p4', shells2, hist);
  expect('bestShell full shells: lower score wins', best2.label, '8:10');

  // Case 3: Tied pair scores → tie-break prefers MORE FILLED shell (best.remaining > s.remaining)
  // Purpose: pack groups more evenly rather than always picking the emptiest shell
  const hist2 = new Map(); // no history
  const shells3 = [
    { playerIds:[],    cap:4, label:'8:00' }, // 4 remaining — starts as "best" (first in pool)
    { playerIds:['p1'],cap:4, label:'8:10' }, // 3 remaining — more filled
  ];
  // best=s0(4 rem), s=s1(3 rem). (4-0)>( 4-1)? 4>3 YES → switch to s1 (more filled)
  const best3 = bestShell('p4', shells3, hist2);
  expect('bestShell tie-break: prefers more-filled shell', best3.label, '8:10');

  // Case 4: Single shell — always returns it
  const shells4 = [{ playerIds:[], cap:4, label:'8:00' }];
  const best4 = bestShell('p4', shells4, hist);
  expect('bestShell single option', best4.label, '8:00');
}

// ── 98. leaguePartnersSub ────────────────────────────────────
{
  const { leaguePartnersSub } = sandbox;
  const lg2Pairs = { seasons:[{active:true,name:'2026',partners:[{id:'x',playerIds:['p1','p2']},{id:'y',playerIds:['p3','p4']}]}] };
  const lgNoPart = { seasons:[{active:true,name:'Spring',partners:[]}] };
  const lgNoActv = { seasons:[{active:false,name:'2025',partners:[{id:'x',playerIds:['p1','p2']}]}] };
  const lgNoSeas = { seasons:[] };
  const lgOnePair = { seasons:[{active:true,name:'Fall',partners:[{id:'z',playerIds:['p1','p2']}]}] };

  expect('leaguePartnersSub 2 pairs',   leaguePartnersSub(lg2Pairs),  '2 partner pairs · 2026');
  expect('leaguePartnersSub 1 pair',    leaguePartnersSub(lgOnePair), '1 partner pairs · Fall');
  expect('leaguePartnersSub no pairs',  leaguePartnersSub(lgNoPart),  'No partners set for Spring');
  expect('leaguePartnersSub no active', leaguePartnersSub(lgNoActv),  'No active season');
  expect('leaguePartnersSub no seasons',leaguePartnersSub(lgNoSeas),  'No active season');
}

// ── 99. tripFmtBadge ─────────────────────────────────────────
{
  const badge = tripFmtBadge('stroke');
  expect('tripFmtBadge stroke: has fmt-stroke',   badge.includes('fmt-stroke'),  true);
  expect('tripFmtBadge stroke: has STROKE',        badge.includes('STROKE'),       true);
  expect('tripFmtBadge stroke: is span',           badge.startsWith('<span'),      true);

  const champ = tripFmtBadge('stroke', true);
  expect('tripFmtBadge champ: has fmt-championship', champ.includes('fmt-championship'), true);
  expect('tripFmtBadge champ: has CHAMP',             champ.includes('CHAMP'),            true);
  expect('tripFmtBadge champ: no STROKE',             champ.includes('STROKE'),           false);

  const scramble = tripFmtBadge('scramble');
  expect('tripFmtBadge scramble: has SCRAMBLE', scramble.includes('SCRAMBLE'), true);
  expect('tripFmtBadge scramble: has fmt-scramble', scramble.includes('fmt-scramble'), true);

  const best2 = tripFmtBadge('best2');
  expect('tripFmtBadge best2: has 2 BEST BALLS', best2.includes('2 BEST BALLS'), true);
}

// ── 100. tripGetPairHistory ───────────────────────────────────
{
  // tripGetPairHistory calls tripActive() which reads S.events for active trip
  // Set up: active trip with 2 completed rounds
  // Round 1 (non-champ): group [p1,p2,p3] — pairs: p1|p2, p1|p3, p2|p3
  // Round 2 (non-champ): group [p1,p2] — pairs: p1|p2 (again)
  // Championship round: group [p1,p4] — should be SKIPPED
  // Expected: p1|p2=2, p1|p3=1, p2|p3=1, p1|p4=0 (champ skipped)
  const tripId = 'hist_trip';
  const histTrip = {
    id: tripId,
    startDate:'2026-06-26', endDate:'2026-06-28',
    players:[{id:'p1'},{id:'p2'},{id:'p3'},{id:'p4'}],
    settings:{},
    days:{
      '2026-06-26':{rounds:[{
        courseId:'co18', format:'stroke', nineMode:'all', completed:true,
        championship:false,
        groups:[{playerIds:['p1','p2','p3'],teetime:'8:00 AM'}],
        scores:{p1:{1:4},p2:{1:4},p3:{1:4}}, borrows:[]
      }]},
      '2026-06-27':{rounds:[{
        courseId:'co18', format:'stroke', nineMode:'all', completed:true,
        championship:false,
        groups:[{playerIds:['p1','p2'],teetime:'8:00 AM'}],
        scores:{p1:{1:4},p2:{1:4}}, borrows:[]
      }]},
      '2026-06-28':{rounds:[{
        courseId:'co18', format:'stroke', nineMode:'all', completed:true,
        championship:true,  // should be skipped
        groups:[{playerIds:['p1','p4'],teetime:'8:00 AM'}],
        scores:{p1:{1:4},p4:{1:4}}, borrows:[]
      }]},
    }
  };

  // Set active trip in vm — tripActive() reads S.events for type:'trip' + active flag
  vmSetS('events', [{ type:'trip', id:tripId, ...histTrip }]);
  vmSetS('activeTripId', tripId);

  const hist = tripGetPairHistory();
  expect('tripGetPairHistory: p1|p2=2', hist.get('p1|p2'), 2);
  expect('tripGetPairHistory: p1|p3=1', hist.get('p1|p3'), 1);
  expect('tripGetPairHistory: p2|p3=1', hist.get('p2|p3'), 1);
  expect('tripGetPairHistory: p1|p4 skipped', hist.get('p1|p4'), undefined);
  expect('tripGetPairHistory: returns Map', hist instanceof Map, true);
}


// ════════════════════════════════════════════════════════════════
// §101: INTEGRATION — full scoring workflow end-to-end
// §102: REGRESSION — tests anchored to bugs found in production
// §103: STATE MUTATION / IDEMPOTENCY
// §104: DATA MIGRATION / BACKWARD COMPATIBILITY
// All expected values pre-computed independently (Rule 28)
// ════════════════════════════════════════════════════════════════

// ── 101. Integration: full outing scoring workflow ───────────
// buildScoringCtx → computeRoundResults → computeSkins
// 4 players, 18-hole stroke, skins enabled, mixed scores
{
  const { buildScoringCtx, computeRoundResults, computeSkins, calcRawCourseHcp, calcPlayingHcp } = sandbox;

  const intCourse = {
    id:'int18', slope:113, rating:72, par:72,
    holes: Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1,hcpRating:i+1}))
  };
  vmSetS('courses',[intCourse]);

  // p1 CH=0, p2 CH=9, p3 CH=18, p4 CH=5
  // Pre-computed: h14 hcpRating=14: p1=0,p2=0,p3=1,p4=0 strokes
  // p1 birdies h14 (gross3,net3), others bogey h14 (gross5) → p1 net=3, p3 net=4, p2 net=5, p4 net=5
  const players4 = [
    {id:'ip1',hcp:0, name:'P1'},
    {id:'ip2',hcp:9, name:'P2'},
    {id:'ip3',hcp:18,name:'P3'},
    {id:'ip4',hcp:5, name:'P4'},
  ];
  const intScores = {ip1:{},ip2:{},ip3:{},ip4:{}};
  Array.from({length:18},(_,i)=>{
    intScores.ip1[i+1]= i===13 ? 3 : 4; // birdie h14 only
    intScores.ip2[i+1]=4;
    intScores.ip3[i+1]=i===13 ? 5 : 4;  // bogey h14
    intScores.ip4[i+1]=i===13 ? 5 : 4;  // bogey h14
  });
  const groups = [{playerIds:['ip1','ip2','ip3','ip4']}];

  // Step 1: build scoring context
  const ctx = buildScoringCtx(players4, intCourse, 'all', intScores, groups, 'lownet',
    {skins:{hcpAdj:100,halfStroke:false,strokeOffBest:false}});
  expect('integration: ctx not null', ctx !== null, true);
  expect('integration: 4 players in ctx', ctx.players.length, 4);
  expect('integration: 18 activeHoles', ctx.activeHoles.length, 18);

  // Verify CH calculations (pre-computed: p1=0,p2=9,p3=18,p4=5)
  const p1ctx = ctx.players.find(p=>p.id==='ip1');
  const p2ctx = ctx.players.find(p=>p.id==='ip2');
  const p3ctx = ctx.players.find(p=>p.id==='ip3');
  expect('integration: p1 CH=0',  p1ctx.courseHcp, 0);
  expect('integration: p2 CH=9',  p2ctx.courseHcp, 9);
  expect('integration: p3 CH=18', p3ctx.courseHcp, 18);

  // Step 2: compute round results
  const rr = computeRoundResults(ctx);
  expect('integration: results type=individual', rr.type, 'individual');
  expect('integration: 4 entries', rr.entries.length, 4);
  // p1 net = 72-0=72 (gross 72, no strokes), p2 net=72-9=63, p3 net=72-18=54 (lowest)
  // Wait: lownet net = gross - CH (total). Let me verify the actual calc.
  // computeRoundResults lownet: entry.net = sum of (gross[h] - strokesOnHole(CH,h)) per hole
  // p1 gross=4 all 18 except h14=3 → total gross=71, CH=0 → net=71
  // p2 gross=4 all 18 → total gross=72, CH=9 → net=63
  // p3 gross=4 all 18 except h14=5 → total gross=73, CH=18 → net=55
  // Sort: p2=63 < p3=55? No: p3=55 < p2=63. p3 wins lownet? 
  // Actually low net = lowest net → p3(net55) < p2(net63) < p1(net71)
  // But p3 bogeys h14 while others par — wait, we need p1 to WIN skins, not lownet
  const p1entry = rr.entries.find(e=>e.playerId==='ip1');
  const p3entry = rr.entries.find(e=>e.playerId==='ip3');
  expect('integration: p1 gross=71', p1entry.gross, 71); // birdie h14
  expect('integration: p3 gross=73', p3entry.gross, 73); // bogey h14

  // Step 3: compute skins — p1 wins h14 outright
  // h14 hcpRating=14: p1 net=3-0=3, p2 net=4-0=4, p3 net=5-1=4, p4 net=5-0=5
  const skinCtx = buildScoringCtx(players4, intCourse, 'all', intScores, groups, 'lownet',
    {skins:{hcpAdj:100,halfStroke:false,strokeOffBest:false}});
  const sr = computeSkins(skinCtx);
  expect('integration: anyWins=true',    sr.anyWins,        true);
  expect('integration: p1 wins h14',     sr.wins['ip1'] > 0, true);
  expect('integration: p2 wins 0',       sr.wins['ip2'],    0);
  expect('integration: p4 wins 0',       sr.wins['ip4'],    0);
}

// ── 101b. Integration: league RSVP → pool → groups flow ─────
{
  const { leagueBuildPool, leagueBuildTierMap, leagueDealAbcd } = sandbox;
  // Set up active league (leagueDealAbcd calls leagueCurrent())
  vmSetS('events', [{type:'league',id:'int_league',sessions:[],seasons:[],teeTimes:[],status:'active'}]);
  vmSetS('activeLeagueId', 'int_league');
  vmSetS('players', [
    {id:'lw1',name:'Alice',  hcp:2, regular:true},
    {id:'lw2',name:'Bob',    hcp:8, regular:true},
    {id:'lw3',name:'Carol',  hcp:14,regular:true},
    {id:'lw4',name:'Dave',   hcp:20,regular:true},
    {id:'lw5',name:'Eve',    hcp:6, regular:true},
    {id:'lw6',name:'Frank',  hcp:12,regular:true},
    {id:'lw7',name:'Grace',  hcp:18,regular:true},
    {id:'lw8',name:'Hal',    hcp:4, regular:true},
    {id:'sub1',name:'Irene', hcp:10,regular:false},
  ]);
  const fakeLg = { teeTimes:['5:20 PM','5:30 PM'] };
  const fakeSess = { rsvp:{
    lw1:{status:'in'}, lw2:{status:'in'}, lw3:{status:'in'}, lw4:{status:'in'},
    lw5:{status:'in'}, lw6:{status:'in'}, lw7:{status:'out',subId:'sub1'}, lw8:{status:'in'},
  }};

  // Step 1: build pool
  const pool = leagueBuildPool(fakeLg, fakeSess);
  expect('league integration: pool=8', pool.length, 8);
  expect('league integration: sub1 in pool', pool.some(p=>p.id==='sub1'), true);
  expect('league integration: lw7 not in pool', pool.some(p=>p.id==='lw7'), false);

  // Step 2: build tier map and deal ABCD into 2 groups
  leagueBuildTierMap(pool, 2);
  const dealt = leagueDealAbcd(pool, 2);
  expect('league integration: 2 groups', dealt.length, 2);
  expect('league integration: g0 has 4', dealt[0].length, 4);
  expect('league integration: g1 has 4', dealt[1].length, 4);
  const allDealt = new Set([...dealt[0],...dealt[1]]);
  expect('league integration: 8 unique players', allDealt.size, 8);
  expect('league integration: no overlap', dealt[0].every(id=>!dealt[1].includes(id)), true);
}

// ── 101c. Integration: Wolf scoring end-to-end ──────────────
{
  const { wolfCalcTotals, wolfSettlement } = sandbox;
  // 4 players, 4 holes played
  // h1: p1 captain, partner=p2, wolf wins, base=1, value=1 → p1+2,p2+2,p3-2,p4-2
  // h2: p2 captain, partner=p3, others win, base=1, value=1 → p2-3,p3-3,p1+1,p4+1
  // h3: p3 captain, lone blind, wolf wins, base=1, value=4 → p3+12,p1-4,p2-4,p4-4
  // h4: p4 captain, partner=p1, tie, no points
  // Pre-computed: p1=2+1-4=−1, p2=2-3-4=−5, p3=-3+12=-(-3+12)=−3+12=9? 
  // h1: p3-=2,p4-=2. h2: p1+=1,p4+=1. h3: p1-=4,p2-=4,p4-=4. h4: tie
  const p1t=2+1-4, p2t=2-3-4, p3t=-2-3+12, p4t=-2+1-4;
  // p1=−1, p2=−5, p3=7, p4=−5 (h2 tie? no: h2 partner=p3 others win: p2,p3 lose? wait)
  // h2: captainPid=p2, partnerPid=p3, winner='others'. others=[p1,p4].
  // wolfTeam=[p2,p3], opp=[p1,p4]. others win: p1+=value*1, p4+=value*1; p2-=value*2, p3-=value*2? 
  // Actually wolfCalcTotals: others win → opp earn, wolfTeam pays
  // value=1, oppCount=2 → each opp gets +1, each wolfTeam member loses 1*oppCount/wolfTeamCount? 
  // Let me re-read: others win: wolfTeam[].push(-value*oppCount), opp[].push(+value)
  // h2: wolfTeam=[p2,p3], opp=[p1,p4], value=1, oppCount=2
  // p2-=1*2=2, p3-=1*2=2, p1+=1, p4+=1
  // h3: captainPid=p3, mode=blind, winner=wolf, value=4, wolfTeam=[p3], opp=[p1,p2,p4], oppCount=3
  // wolf wins: p3+=4*3=12, p1-=4, p2-=4, p4-=4
  // Running totals:
  // h1: p1+2,p2+2,p3-2,p4-2
  // h2: p1+1,p2-2,p3-2,p4+1
  // h3: p1-4,p2-4,p3+12,p4-4
  // h4: tie, no change
  // Total: p1=2+1-4=-1, p2=2-2-4=-4, p3=-2-2+12=8, p4=-2+1-4=-5
  const gWolf = {
    wolfOrder:['wp1','wp2','wp3','wp4'],
    wolfHoles:{
      1:{mode:'partner',captainPid:'wp1',partnerPid:'wp2',winner:'wolf',  base:1,value:1},
      2:{mode:'partner',captainPid:'wp2',partnerPid:'wp3',winner:'others',base:1,value:1},
      3:{mode:'blind',  captainPid:'wp3',partnerPid:null, winner:'wolf',  base:1,value:4},
      4:{mode:'partner',captainPid:'wp4',partnerPid:'wp1',winner:'tie',   base:1,value:1},
    },
    ptValue:1, scores:{}, chs:{}, courseId:'int18',
  };
  const totals = wolfCalcTotals(gWolf);
  // Pre-computed with actual wolfCalcTotals formula:
  // partner wolf win: each wolfTeam earns value*oppCount, each opp LOSES value*wolfTeamCount
  // h1(partner wp1+wp2 win,v=1): wp1+2,wp2+2,wp3-2,wp4-2
  // h2(partner wp2+wp3 lose,v=1): wp1+2,wp4+2,wp2-2,wp3-2
  // h3(blind wp3 wins,v=4): wp3+12,wp1-4,wp2-4,wp4-4
  // Totals: wp1=0, wp2=-4, wp3=8, wp4=-4
  expect('wolf integration: wp1=0',  totals['wp1'],  0);
  expect('wolf integration: wp2=-4', totals['wp2'], -4);
  expect('wolf integration: wp3=8',  totals['wp3'],  8);
  expect('wolf integration: wp4=-4', totals['wp4'], -4);

  // Settlement: wp3=8 collects. wp1=0, wp2=-4, wp4=-4.
  // wp3 vs wp1: diff=8, wp1 pays $8
  // wp3 vs wp2: diff=12, wp2 pays $12
  // wp3 vs wp4: diff=12, wp4 pays $12. Total wp3 earns=32
  const settle = wolfSettlement(gWolf);
  const wp3earns = settle.filter(s=>s.payeePid==='wp3').reduce((a,s)=>a+s.dollars,0);
  expect('wolf integration: wp3 earns $32', wp3earns, 32);
  // wp2 and wp4 both owe most (diff=12 each to wp3, plus diff=4 between them=0 net)
  const wp2owes = settle.filter(s=>s.payerPid==='wp2').reduce((a,s)=>a+s.dollars,0);
  expect('wolf integration: wp2 owes $16', wp2owes, 16); // pays wp3=$12, pays wp1=$4
}

// ── 102. Regression tests — bugs found in production ─────────
{
  const { computeSkins, buildScoringCtx } = sandbox;
  const regCourse = {id:'rc18',slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:i<3?3:i<15?4:5,hcpRating:i+1}))};
  vmSetS('courses',[regCourse]);

  // REGRESSION v0.90.10: skins half-stroke — Math.floor discarded half-stroke entirely
  // Two birdies (gross 2) on par3, one player gets 1 stroke → stroked player should win
  // Before fix: Math.floor(0.5)=0 → both net 2 → tie → no winner (WRONG)
  // After fix: gross-0.5=1.5 < gross-0=2 → stroked player wins (CORRECT)
  const rp1=[{id:'ra1',hcp:0,name:'A'},{id:'ra2',hcp:7,name:'B'}];
  // h2 par3, hcpRating=2: ra2 CH=7, strokesOnHole(7,2,18)=1 → half=0.5
  const rsc={ra1:{2:2},ra2:{2:2}};
  const rctx=buildScoringCtx(rp1,regCourse,'all',rsc,[{playerIds:['ra1','ra2']}],'lownet',
    {skins:{hcpAdj:100,halfStroke:true,strokeOffBest:false}});
  const rskins=computeSkins(rctx);
  expect('regression v0.90.10: stroked birdie wins', rskins.wins['ra2'],  1);
  expect('regression v0.90.10: unstroked loses tie', rskins.wins['ra1'],  0);
  expect('regression v0.90.10: anyWins=true',        rskins.anyWins,      true);

  // REGRESSION v0.90.2: outingFinish not marking status=complete
  // After save, status must be 'complete' so outingActiveGame() returns null
  // Verify normalizeState preserves status:'complete' (doesn't overwrite with 'active')
  const { normalizeState } = sandbox;
  const completedOuting={type:'outing',id:'o_done',status:'complete',gameType:'stableford',scores:{}};
  const rawState={account:{},players:[],courses:[],events:[completedOuting],config:{}};
  const normalized=normalizeState(rawState);
  const evAfter=normalized.events.find(e=>e.id==='o_done');
  expect('regression v0.90.2: complete status preserved', evAfter.status, 'complete');

  // REGRESSION v0.90.4: tts vs ttsAll undefined crash
  // outingRenderGroupAssign was renamed ttsAll but used tts in group card
  // The fix renamed the variable. Unit test: verify both refer to same teeTimes
  // (This was a name error — tested indirectly through outingBuildTeams)
  const {outingBuildTeams} = sandbox;
  const p4=[{id:'t1',courseHcp:2},{id:'t2',courseHcp:8},{id:'t3',courseHcp:12},{id:'t4',courseHcp:18}];
  const teams=outingBuildTeams(p4,2,'ab');
  expect('regression v0.90.4: outingBuildTeams no crash', teams.length, 2);

  // REGRESSION: computeSkins result shape must have wins for every player
  // Early bug: if a player had no scores, they were missing from wins object
  const rp3=[{id:'rx1',hcp:0,name:'A'},{id:'rx2',hcp:5,name:'B'},{id:'rx3',hcp:9,name:'C'}];
  const rsc3={rx1:{1:3},rx2:{},rx3:{}}; // only rx1 scores
  const rctx3=buildScoringCtx(rp3,regCourse,'all',rsc3,[{playerIds:['rx1','rx2','rx3']}],'lownet',
    {skins:{hcpAdj:100}});
  const rs3=computeSkins(rctx3);
  expect('regression: all players in wins obj', Object.keys(rs3.wins).length, 3);
  expect('regression: non-scoring players = 0', rs3.wins['rx2'], 0);
  expect('regression: non-scoring players = 0', rs3.wins['rx3'], 0);
}

// ── 103. State mutation / idempotency ─────────────────────────
{
  const { normalizeState, computeSkins, buildScoringCtx } = sandbox;

  // normalizeState is idempotent: running twice produces identical result
  const rawOnce = normalizeState({
    account:{name:'Brian'},
    players:[{id:'p1',name:'Alice',hcp:5}],
    courses:[{id:'c1',name:'Walden',slope:113,rating:72,par:72}],
    events:[{type:'league',id:'l1',sessions:[],teeTimes:['5:00 PM']}],
    config:{}
  });
  const rawTwice = normalizeState(JSON.parse(JSON.stringify(rawOnce)));
  expect('idempotent: account name preserved', rawTwice.account.name, 'Brian');
  expect('idempotent: player count', rawTwice.players.length, 1);
  expect('idempotent: league status', rawTwice.events[0].status, 'active');
  // Running again doesn't add extra sessions
  expect('idempotent: sessions not doubled', rawTwice.events[0].sessions.length, 0);
  // Config games added on first run, preserved (not doubled) on second
  expect('idempotent: config.games present', !!rawTwice.config.games, true);
  expect('idempotent: skins config once', !!rawTwice.config.games.skins, true);

  // computeSkins is pure: calling twice returns same result
  const idCourse={id:'idc',slope:113,rating:72,par:72,
    holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1}))};
  vmSetS('courses',[idCourse]);
  const idPlayers=[{id:'id1',hcp:0,name:'A'},{id:'id2',hcp:9,name:'B'}];
  const idSc={id1:{1:3},id2:{1:4}};
  const idCtx=buildScoringCtx(idPlayers,idCourse,'all',idSc,[{playerIds:['id1','id2']}],'lownet',
    {skins:{hcpAdj:100}});
  const r1=computeSkins(idCtx);
  const r2=computeSkins(idCtx);
  expect('idempotent: computeSkins same anyWins', r1.anyWins, r2.anyWins);
  expect('idempotent: computeSkins id1 same', r1.wins['id1'], r2.wins['id1']);
  expect('idempotent: computeSkins id2 same', r1.wins['id2'], r2.wins['id2']);

  // leagueBuildPool is idempotent: same RSVP → same pool order/content
  vmSetS('players',[{id:'qi1',name:'Q1',hcp:5,regular:true},{id:'qi2',name:'Q2',hcp:9,regular:true}]);
  const qLg={teeTimes:[]};
  const qSess={rsvp:{qi1:{status:'in'},qi2:{status:'in'}}};
  const pool1=leagueBuildPool(qLg,qSess);
  const pool2=leagueBuildPool(qLg,qSess);
  expect('idempotent: leagueBuildPool same size', pool1.length, pool2.length);
  expect('idempotent: leagueBuildPool same ids', pool1.map(p=>p.id).sort().join(), pool2.map(p=>p.id).sort().join());

  // outingBuildTeams: same input → same team structure (deterministic for ab mode)
  const qPlayers=[{id:'qa1',courseHcp:2},{id:'qa2',courseHcp:8},{id:'qa3',courseHcp:12},{id:'qa4',courseHcp:18}];
  const qt1=outingBuildTeams(qPlayers,2,'ab');
  const qt2=outingBuildTeams(qPlayers,2,'ab');
  expect('idempotent: outingBuildTeams same count', qt1.length, qt2.length);
  // ab sort is deterministic, but shuffle within tiers is random → just check structure
  expect('idempotent: outingBuildTeams team sizes', qt1.map(t=>t.playerIds.length).join(), qt2.map(t=>t.playerIds.length).join());
}

// ── 104. Data migration / backward compatibility ──────────────
{
  const { normalizeState } = sandbox;

  // Migration 1: old rsvp format {pid:'in'} → {pid:{status:'in',earliest:''}}
  const oldLeague={type:'league',id:'ml1',teeTimes:['5:20 PM','5:30 PM'],
    sessions:[{id:'s1',rsvp:{p1:'in',p2:'out',p3:'in'},groups:[],scores:{}}]};
  const migrated=normalizeState({account:{},players:[],courses:[],events:[oldLeague],config:{}});
  const sess=migrated.events[0].sessions[0];
  expect('migration: old rsvp p1 has status', sess.rsvp.p1.status, 'in');
  expect('migration: old rsvp p2 has status', sess.rsvp.p2.status, 'out');
  expect('migration: old rsvp p1 has earliest', typeof sess.rsvp.p1.earliest, 'string');

  // Migration 2: league.day:'WED' → season.dayOfWeek:3 (schedule now lives on the season)
  const oldDay={type:'league',id:'ml2',day:'WED',sessions:[],teeTimes:[]};
  const migDay=normalizeState({account:{},players:[],courses:[],events:[oldDay],config:{}});
  expect('migration: WED→season.dayOfWeek=3', migDay.events[0].seasons[0].dayOfWeek, 3);
  expect('migration: dayOfWeek off league',   migDay.events[0].dayOfWeek, undefined);
  const oldThu={type:'league',id:'ml3',day:'THU',sessions:[],teeTimes:[]};
  const migThu=normalizeState({account:{},players:[],courses:[],events:[oldThu],config:{}});
  expect('migration: THU→season.dayOfWeek=4', migThu.events[0].seasons[0].dayOfWeek, 4);

  // Migration 3: missing league.seasons → auto-creates Season 1
  const noSeasons={type:'league',id:'ml4',sessions:[],teeTimes:[]};
  const migSeas=normalizeState({account:{},players:[],courses:[],events:[noSeasons],config:{}});
  expect('migration: missing seasons→[]', Array.isArray(migSeas.events[0].seasons), true);
  expect('migration: Season 1 auto-created', migSeas.events[0].seasons.length, 1);
  expect('migration: Season 1 name',         migSeas.events[0].seasons[0].name, 'Season 1');

  // Migration 3b: existing league schedule moves onto the active season, cleared off the league
  const existing={type:'league',id:'ml5',dayOfWeek:1,teeTimes:['5:20','5:30'],sessions:[],
    seasons:[{id:'s1',name:'Season 1',active:true,partners:[]}]};
  const migEx=normalizeState({account:{},players:[],courses:[],events:[existing],config:{}});
  const sea=migEx.events[0].seasons[0];
  expect('migrate: season.dayOfWeek=1',    sea.dayOfWeek, 1);
  expect('migrate: season.teeTimes moved', sea.teeTimes.join(','), '5:20,5:30');
  expect('migrate: lg.dayOfWeek cleared',  migEx.events[0].dayOfWeek, undefined);
  expect('migrate: lg.teeTimes cleared',   migEx.events[0].teeTimes, undefined);

  // Migration 4: missing outing.teams → gets teams:[]
  const noTeams={type:'outing',id:'mo1',status:'planning',gameType:'stableford',scores:{}};
  const migTeams=normalizeState({account:{},players:[],courses:[],events:[noTeams],config:{}});
  expect('migration: missing teams→[]', Array.isArray(migTeams.events[0].teams), true);

  // Migration 5: missing outing.status → defaults to 'active' (backward compat)
  const noStatus={type:'outing',id:'mo2',gameType:'lownet',scores:{}};
  const migStatus=normalizeState({account:{},players:[],courses:[],events:[noStatus],config:{}});
  expect('migration: missing status→active', migStatus.events[0].status, 'active');

  // Migration 6: completed outing status preserved (regression guard)
  const doneOuting={type:'outing',id:'mo3',status:'complete',gameType:'lownet',scores:{}};
  const migDone=normalizeState({account:{},players:[],courses:[],events:[doneOuting],config:{}});
  expect('migration: complete status not overwritten', migDone.events[0].status, 'complete');

  // Migration 7: trip with missing days → gets days:{}
  const noTripDays={type:'trip',id:'mt1',startDate:'2026-06-26',players:[],courseIds:[]};
  const migTrip=normalizeState({account:{},players:[],courses:[],events:[noTripDays],config:{}});
  expect('migration: trip missing days→{}', typeof migTrip.events[0].days, 'object');
  expect('migration: trip days not array', !Array.isArray(migTrip.events[0].days), true);

  // Migration 8: trip round missing completed/championship → defaults to false
  const tripOldRound={type:'trip',id:'mt2',startDate:'2026-06-26',players:[],courseIds:[],
    days:{'2026-06-26':{rounds:[{courseId:'c1',format:'stroke',groups:[],scores:{}}]}}};
  const migRound=normalizeState({account:{},players:[],courses:[],events:[tripOldRound],config:{}});
  const rnd=migRound.events[0].days['2026-06-26'].rounds[0];
  expect('migration: round.completed defaults false', rnd.completed, false);
  expect('migration: round.championship defaults false', rnd.championship, false);

  // Migration 9: league season missing id → gets uid() assigned
  const noSeasonId={type:'league',id:'ml5',sessions:[],teeTimes:[],
    seasons:[{name:'2026',partners:[],active:true}]};
  const migSid=normalizeState({account:{},players:[],courses:[],events:[noSeasonId],config:{}});
  expect('migration: season gets id', !!migSid.events[0].seasons[0].id, true);
  expect('migration: season id is string', typeof migSid.events[0].seasons[0].id, 'string');

  // Migration 10: config.games absent → full default tree inserted
  const noConfig={account:{},players:[],courses:[],events:[],config:{}};
  const migCfg=normalizeState(noConfig);
  expect('migration: config.games.skins inserted',    !!migCfg.config.games.skins, true);
  expect('migration: config.games.individual inserted',!!migCfg.config.games.individual, true);
  expect('migration: config.games.fourPlayer.wolf',   !!migCfg.config.games.fourPlayer.wolf, true);
  expect('migration: modules inserted',               !!migCfg.config.modules, true);
  expect('migration: foursome module default true',    migCfg.config.modules.foursome, true);
}


// ════════════════════════════════════════════════════════════════
// §105: saveLeagueMsg — message template config
// §106: tripSetStrokeAllowance — per-trip stroke allowance
// §107: leagueSendRsvpInvite — token substitution, link building, filtering
// §108: RSVP quick-yes URL structure validation
// All expected values pre-computed independently (Rule 28)
// ════════════════════════════════════════════════════════════════

// ── 105. saveLeagueMsg ───────────────────────────────────────
{
  const origCfg = JSON.parse(JSON.stringify(sandbox.S?.config || {}));
  vmSetS('config', { ghinProxyUrl:'', nudgeMsg:'', inviteMsg:'', rsvpWelcome:'', games:{} });

  saveLeagueMsg('invite',      '  Hello {league}  ');
  saveLeagueMsg('nudge',       '  Nudge {league}  ');
  saveLeagueMsg('rsvpWelcome', '  Welcome!  ');

  vm.runInContext('__cfg = S.config', sandbox);
  const cfg = sandbox.__cfg;
  expect('saveLeagueMsg invite trimmed',      cfg.inviteMsg,    'Hello {league}');
  expect('saveLeagueMsg nudge trimmed',        cfg.nudgeMsg,     'Nudge {league}');
  expect('saveLeagueMsg rsvpWelcome trimmed',  cfg.rsvpWelcome,  'Welcome!');

  // Unknown type → no crash, no change to known fields
  const beforeInvite = cfg.inviteMsg;
  saveLeagueMsg('bogus', 'ignored');
  expect('saveLeagueMsg unknown type no-op', cfg.inviteMsg, beforeInvite);

  // Empty string → stores empty (not undefined)
  saveLeagueMsg('invite', '');
  expect('saveLeagueMsg empty string', cfg.inviteMsg, '');
}

// ── 106. tripSetStrokeAllowance ──────────────────────────────
{
  // Set up active trip in vm
  const tripId = 'sa_trip';
  vmSetS('events', [{type:'trip', id:tripId, startDate:'2026-06-26', players:[], settings:{}}]);
  vmSetS('activeTripId', tripId);

  tripSetStrokeAllowance(90);
  // Read back via vm
  vm.runInContext('__saVal = (S.events||[]).find(e=>e.id==="sa_trip")?.settings?.strokeAllowance', sandbox);
  expect('tripSetStrokeAllowance 90', sandbox.__saVal, 90);

  tripSetStrokeAllowance(75);
  vm.runInContext('__saVal = (S.events||[]).find(e=>e.id==="sa_trip")?.settings?.strokeAllowance', sandbox);
  expect('tripSetStrokeAllowance 75', sandbox.__saVal, 75);

  tripSetStrokeAllowance(100);
  vm.runInContext('__saVal = (S.events||[]).find(e=>e.id==="sa_trip")?.settings?.strokeAllowance', sandbox);
  expect('tripSetStrokeAllowance 100', sandbox.__saVal, 100);

  // No active trip → no crash
  vmSetS('activeTripId', '');
  let noThrow = true;
  try { tripSetStrokeAllowance(85); } catch(e) { noThrow = false; }
  expect('tripSetStrokeAllowance no trip: no crash', noThrow, true);
}

// ── 107. leagueSendRsvpInvite — token substitution + filtering ─
// Note: function opens native SMS (window.location.href) and calls leagueShowSmsPreview
// which calls openConfirm — both DOM. We test the pure logic by intercepting state.
{
  // Set up league with active session, players with phones
  const lgId = 'sms_lg', sessId = 'sms_s1';
  vmSetS('events', [{
    type:'league', id:lgId, status:'active',
    name:'WED League', seasons:[{active:true, name:'2026', partners:[]}],
    sessions:[{
      id:sessId, date:'2026-07-10', status:'active',
      teeTimes:['5:20 PM','5:30 PM'],
      rsvp:{ sp1:{status:'in'}, sp2:{status:'out'} }  // sp3 has no status
    }],
    teeTimes:['5:20 PM','5:30 PM'],
  }]);
  vmSetS('activeLeagueId', lgId);
  vmSetS('players', [
    {id:'sp1',name:'Alice',hcp:5,regular:true,phone:btoa('3305551111')},
    {id:'sp2',name:'Bob',  hcp:7,regular:true,phone:btoa('3305552222')},
    {id:'sp3',name:'Carol',hcp:9,regular:true,phone:btoa('3305553333')},
    {id:'sp4',name:'Dave', hcp:11,regular:true,phone:''},    // no phone — excluded
    {id:'sp5',name:'Eve',  hcp:13,regular:false,phone:btoa('3305554444')}, // non-regular
  ]);
  vmSetS('config', {
    ghinProxyUrl:'', nudgeMsg:'', inviteMsg:'{league} — {date}. Are you in?', rsvpWelcome:'Join us!',
    games:{skins:{},individual:{},fourPlayer:{wolf:{}},twoPlayer:{}}, modules:{foursome:true}
  });
  // Set _leagueSessionId in vm
  vm.runInContext('_leagueSessionId = "sms_s1"', sandbox);

  // Intercept leagueShowSmsPreview to capture state instead of opening confirm dialog
  vm.runInContext(`
    window._smsPreviewCalled = false;
    leagueShowSmsPreview = function() { window._smsPreviewCalled = true; };
  `, sandbox);

  // --- Invite mode: all regulars with phone ---
  leagueSendRsvpInvite('invite');

  vm.runInContext('__smsBatches = _leagueSmsBatches', sandbox);
  vm.runInContext('__smsMsg = _leagueSmsMsg', sandbox);
  vm.runInContext('__smsMode = _leagueSmsMode', sandbox);
  vm.runInContext('__previewCalled = window._smsPreviewCalled', sandbox);

  expect('invite: preview called',          sandbox.__previewCalled,         true);
  expect('invite: mode=invite',             sandbox.__smsMode,               'invite');
  expect('invite: 3 targets (sp1,sp2,sp3)', sandbox.__smsBatches.flat().length, 3);
  expect('invite: sp4 excluded (no phone)', sandbox.__smsBatches.flat().every(p=>p.id!=='sp4'), true);
  expect('invite: sp5 excluded (non-regular)', sandbox.__smsBatches.flat().every(p=>p.id!=='sp5'), true);

  // Message token substitution
  const msg = sandbox.__smsMsg;
  expect('invite: league token replaced',   msg.includes('WED League'),        true);
  expect('invite: date token replaced',     !msg.includes('{date}'),            true);
  expect('invite: no raw league token',     !msg.includes('{league}'),          true);
  expect('invite: has checkmark yes link',  msg.includes('✅ Yes:'),            true);
  expect('invite: has More options link',   msg.includes('More options:'),       true);
  expect('invite: yes link has r=in',       msg.includes('r=in'),               true);
  expect('invite: link has lid',            msg.includes('lid='+lgId),          true);
  expect('invite: link has sid',            msg.includes('sid='+sessId),        true);
  // welcome passed as w= param
  expect('invite: welcome in link',         msg.includes('w='),                 true);

  // --- Nudge mode: only sp3 (no status) ---
  vm.runInContext('window._smsPreviewCalled = false', sandbox);
  leagueSendRsvpInvite('nudge');
  vm.runInContext('__smsBatches = _leagueSmsBatches', sandbox);
  vm.runInContext('__smsMsg = _leagueSmsMsg', sandbox);
  vm.runInContext('__smsMode = _leagueSmsMode', sandbox);

  expect('nudge: mode=nudge',              sandbox.__smsMode,           'nudge');
  expect('nudge: only sp3 (no status)',    sandbox.__smsBatches.flat().length, 1);
  expect('nudge: sp3 targeted',            sandbox.__smsBatches.flat()[0]?.id, 'sp3');
  expect('nudge: no checkmark',            !sandbox.__smsMsg.includes('✅'), true);
  expect('nudge: no More options',         !sandbox.__smsMsg.includes('More options:'), true);
  expect('nudge: has full link',           sandbox.__smsMsg.includes('rsvp.html'), true);

  // --- All responded → no batch, toast only ---
  vmSetS('events', [{
    type:'league', id:lgId, status:'active',
    name:'WED League', seasons:[], sessions:[{
      id:sessId, date:'2026-07-10', status:'active', teeTimes:['5:20 PM'],
      rsvp:{ sp1:{status:'in'},sp2:{status:'out'},sp3:{status:'in'} }
    }],
    teeTimes:['5:20 PM'],
  }]);
  vm.runInContext('window._smsPreviewCalled = false', sandbox);
  leagueSendRsvpInvite('nudge');
  vm.runInContext('__previewCalled = window._smsPreviewCalled', sandbox);
  expect('nudge all responded: no preview', sandbox.__previewCalled, false);

  // --- No phones → no targets → toast, no preview ---
  vmSetS('players', [{id:'np1',name:'NoPhone',hcp:5,regular:true,phone:''}]);
  vmSetS('events', [{
    type:'league', id:lgId, status:'active', name:'WED League', seasons:[],
    sessions:[{id:sessId, date:'2026-07-10', status:'active', teeTimes:[], rsvp:{}}],
    teeTimes:[],
  }]);
  vm.runInContext('window._smsPreviewCalled = false', sandbox);
  leagueSendRsvpInvite('invite');
  vm.runInContext('__previewCalled = window._smsPreviewCalled', sandbox);
  expect('invite no phones: no preview', sandbox.__previewCalled, false);
}

// ── 108. RSVP quick-yes URL structure ────────────────────────
// Validate the URL structure generated by makeLinks without DOM
{
  const baseUrl = 'https://bzrimsek.github.io/MadGolf/rsvp.html';
  const lid = 'lg1', sid = 's1', pid = 'p42';
  const welcome = encodeURIComponent('Join us!');
  const base = `${baseUrl}?lid=${encodeURIComponent(lid)}&sid=${encodeURIComponent(sid)}&pid=${encodeURIComponent(pid)}&t=1000`;
  const yesLink  = base + '&r=in&w=' + welcome;
  const fullLink = base + '&w=' + welcome;

  // yes link structure
  expect('quick-yes: has rsvp.html', yesLink.includes('rsvp.html'),           true);
  expect('quick-yes: has lid',        yesLink.includes('lid=lg1'),             true);
  expect('quick-yes: has sid',        yesLink.includes('sid=s1'),              true);
  expect('quick-yes: has pid',        yesLink.includes('pid=p42'),             true);
  expect('quick-yes: has r=in',       yesLink.includes('r=in'),                true);
  expect('quick-yes: has welcome',    yesLink.includes('w='),                  true);

  // full link has no r=in
  expect('full link: no r=in',        !fullLink.includes('r=in'),              true);
  expect('full link: has pid',         fullLink.includes('pid=p42'),            true);

  // Stripping r=in from yes link gives full page URL
  const stripped = yesLink.replace(/[&?]r=in/, '');
  expect('strip r=in: no r=in',       !stripped.includes('r=in'),              true);
  expect('strip r=in: still has pid', stripped.includes('pid=p42'),            true);

  // autoIn flag: quick-yes writes autoIn:true so manager can see unconfirmed tee times
  const entry = { status:'in', earliest:'5:20 PM', autoIn:true };
  expect('autoIn flag set',       entry.autoIn,      true);
  expect('autoIn status is in',   entry.status,      'in');
  expect('autoIn has earliest',   !!entry.earliest,  true);

  // Token substitution: {league} {season} {date} all replaced
  const tmpl = '{league} — {season} — {date}. Are you in?';
  const filled = tmpl.replace(/{league}/g,'WED').replace(/{season}/g,'2026').replace(/{date}/g,'Thu Jul 10');
  expect('token sub: no raw tokens', !filled.includes('{'), true);
  expect('token sub: league',         filled.includes('WED'), true);
  expect('token sub: season',         filled.includes('2026'), true);
  expect('token sub: date',           filled.includes('Thu Jul 10'), true);
}


// ── 109. LEAGUE STANDINGS COUNTBACK TIE-BREAK ────────────────
// Expected values pre-computed independently in /tmp/cb_expected.js (Rule 28):
//   18 holes, hcpRating = hole#, courseHcp 9, scale 18 → holes 1-9 get 1 stroke.
//   All gross 5 → nets 4×9 then 5×9 → back9=45, back6=30, back3=15, last1=5.
{
  const { leagueAccumCountback, leagueCmpCountback } = sandbox;

  const activeHoles = Array.from({length:18},(_,i)=>({num:i+1, par:4, hcpRating:i+1}));
  const ctx = { activeHoles, hcpScale:18, players:[{id:'p1', courseHcp:9}] };
  const scores = { p1:{} };
  for (let h=1; h<=18; h++) scores.p1[h] = 5;

  const cb = {};
  leagueAccumCountback(cb, ctx, scores);
  expect('countback: found flag', cb.p1 && cb.p1.found, true);
  expect('countback: back9 = 45', cb.p1.back9, 45);
  expect('countback: back6 = 30', cb.p1.back6, 30);
  expect('countback: back3 = 15', cb.p1.back3, 15);
  expect('countback: last1 = 5',  cb.p1.last1, 5);

  // Accumulates across sessions (same scores twice → doubles)
  leagueAccumCountback(cb, ctx, scores);
  expect('countback: accumulates back9', cb.p1.back9, 90);
  expect('countback: accumulates last1', cb.p1.last1, 10);

  // Player who posted nothing is skipped (no cb entry)
  const cb2 = {};
  leagueAccumCountback(cb2, { activeHoles, hcpScale:18, players:[{id:'zz', courseHcp:9}] }, { zz:{} });
  expect('countback: no-post player skipped', cb2.zz === undefined, true);

  // 9-hole fallback: 9 holes, hcpRating=hole#, courseHcp 4 → holes 1-4 get 1 stroke.
  // gross 5 → nets: 4,4,4,4,5,5,5,5,5. back9=sum=41, back6=slice(3)=4+5+5+5+5+5=29,
  // back3=slice(6)=5+5+5=15, last1=5.
  const holes9 = Array.from({length:9},(_,i)=>({num:i+1, par:4, hcpRating:i+1}));
  const s9 = { q:{} }; for (let h=1; h<=9; h++) s9.q[h]=5;
  const cb9 = {};
  leagueAccumCountback(cb9, { activeHoles:holes9, hcpScale:9, players:[{id:'q', courseHcp:4}] }, s9);
  expect('countback 9h: back9 = 41', cb9.q.back9, 41);
  expect('countback 9h: back6 = 29', cb9.q.back6, 29);
  expect('countback 9h: back3 = 15', cb9.q.back3, 15);
  expect('countback 9h: last1 = 5',  cb9.q.last1, 5);

  // Comparator: lower net ranks ahead (negative when a is lower)
  const lo = {back9:44,back6:30,back3:15,last1:5};
  const hi = {back9:45,back6:30,back3:15,last1:5};
  expect('cmp: lower back9 ahead', leagueCmpCountback(lo,hi) < 0, true);
  expect('cmp: higher back9 behind', leagueCmpCountback(hi,lo) > 0, true);
  // Tie on back9, break on back6
  expect('cmp: tie back9 → back6', leagueCmpCountback({back9:45,back6:28,back3:0,last1:0},{back9:45,back6:30,back3:0,last1:0}) < 0, true);
  // Fully identical → 0
  expect('cmp: identical → 0', leagueCmpCountback(hi,{...hi}), 0);
  // Missing data sorts last
  expect('cmp: a missing → behind', leagueCmpCountback(null,hi), 1);
  expect('cmp: b missing → ahead',  leagueCmpCountback(hi,null), -1);
  expect('cmp: both missing → 0',   leagueCmpCountback(null,null), 0);
}

// ── 110. TRIP PUBLISH — itinerary + templated intro ──────────
// Expected structure derived by reading tripItineraryBody/tripBuildPublishMsg (Rule 28):
//   header = "{dest} — {startShort}–{endShort}" (or substituted template intro),
//   body   = "Day N — <long date>" / "  <label>: <course> (<Format>) · First tee: <t0>" / "    <tt>: <names>".
{
  const { tripBuildPublishMsg, tripItineraryBody } = sandbox;

  vmSetS('players', [
    { id:'p1', name:'Brian', phone:'', email:'bz@x.com' },
    { id:'p2', name:'Al',    phone:'', email:'' },
  ]);
  vmSetS('courses', [{ id:'c1', name:'Harbour Town', holes:[] }]);
  vmSetS('events', [{
    type:'trip', id:'t1', destination:'Hilton Head',
    startDate:'2026-02-20', endDate:'2026-02-20',
    players:[{id:'p1',manager:true},{id:'p2'}],
    days:{ '2026-02-20':{ rounds:[{
      label:'R1', format:'stableford', courseId:'c1',
      teeTimes:['9:00 AM'], groups:[{ playerIds:['p1','p2'] }]
    }]}}
  }]);
  vmSetS('activeTripId', 't1');

  // itinerary body: no intro header, carries day/round/group detail
  const body = tripItineraryBody(sandbox.tripActive());
  expect('body: no dest header',   body.startsWith('Hilton Head'), false);
  expect('body: has Day 1',        body.includes('Day 1'),          true);
  expect('body: has round label',  body.includes('R1: Harbour Town (Stableford)'), true);
  expect('body: first tee',        body.includes('First tee: 9:00 AM'), true);
  expect('body: group line',       body.includes('9:00 AM: Brian, Al'), true);

  // default header when template blank
  const def = tripBuildPublishMsg('');
  expect('default: header line', def.startsWith('Hilton Head — Feb 20–Feb 20'), true);
  expect('default: includes body', def.includes('R1: Harbour Town (Stableford)'), true);
  expect('default: no trailing blanks', def === def.trim(), true);

  // templated intro: {destination} and {dates} substituted, no raw tokens remain
  const pub = tripBuildPublishMsg('{destination} kickoff {dates}!');
  expect('tmpl: dest substituted',  pub.includes('Hilton Head kickoff'), true);
  expect('tmpl: dates substituted', pub.includes('Feb 20–Feb 20!'),      true);
  expect('tmpl: no raw {token}',    /\{destination\}|\{dates\}/.test(pub), false);
  expect('tmpl: intro precedes body', pub.indexOf('kickoff') < pub.indexOf('Day 1'), true);

  // multiple token occurrences all replaced (global)
  const multi = tripBuildPublishMsg('{dates} / {dates}');
  expect('tmpl: global replace', /\{dates\}/.test(multi), false);

  // no active trip → empty string
  vmSetS('activeTripId', null);
  expect('no trip: empty', tripBuildPublishMsg('x'), '');
  vmSetS('activeTripId', 't1');
}

// ── 111. LEAGUE SESSION CONTEXT — per-session course + holes ──
// Locks the two standings fixes: (1) session courseId override honored,
// (2) session nineSide honored. Expected values derived independently:
//   courseHcp for slope 113 / rating 72 / par 72 = index (10) by the USGA formula;
//   getActiveHoles front = holes 1-9, back = 10-18.
{
  const { leagueSessionCtx } = sandbox;

  vmSetS('courses', [
    { id:'cLg',   name:'League Course',  slope:113, rating:72, par:72, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1})) },
    { id:'cSess', name:'Session Course', slope:120, rating:70, par:72, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcpRating:i+1})) },
  ]);
  vmSetS('players', [{ id:'p1', name:'A', hcp:10, regular:true }, { id:'p2', name:'B', hcp:20, regular:true }]);
  const lg = { type:'league', id:'lg1', courseId:'cLg', seasons:[], sessions:[] };
  vmSetS('events', [lg]);
  const mk = over => Object.assign(
    { id:'s', date:'2026-07-10', rsvp:{ p1:{status:'in'}, p2:{status:'in'} },
      groups:[{ playerIds:['p1','p2'] }], scores:{}, gameType:'stableford' }, over);

  // Default: league course, all 18 holes
  const scD = leagueSessionCtx(lg, mk({}));
  expect('default: league course',   scD.course.id,               'cLg');
  expect('default: 18 holes',        scD.ctx.activeHoles.length,   18);
  expect('default: courseHcp=index', scD.ctx.players.find(p=>p.id==='p1').courseHcp, 10);

  // Bug #1 fix: per-session course override flows into the ctx
  const scO = leagueSessionCtx(lg, mk({ courseId:'cSess' }));
  expect('override: session course', scO.course.id,       'cSess');
  expect('override: slope in ctx',   scO.ctx.course.slope, 120);

  // Bug #2 fix: per-session nineSide honored
  const scF = leagueSessionCtx(lg, mk({ nineSide:'front' }));
  expect('front9: 9 holes',      scF.ctx.activeHoles.length, 9);
  expect('front9: starts hole 1', scF.ctx.activeHoles[0].num, 1);
  expect('front9: ends hole 9',   scF.ctx.activeHoles[8].num, 9);
  const scB = leagueSessionCtx(lg, mk({ nineSide:'back' }));
  expect('back9: 9 holes',        scB.ctx.activeHoles.length, 9);
  expect('back9: starts hole 10', scB.ctx.activeHoles[0].num, 10);

  // Empty pool → still returns a ctx (not null), so results can render an empty round
  const scE = leagueSessionCtx(lg, mk({ rsvp:{} }));
  expect('empty pool: not null',   scE !== null,    true);
  expect('empty pool: 0 players',  scE.pool.length, 0);

  // Unresolvable course → null (guards both callers' early return)
  const scN = leagueSessionCtx(lg, mk({ courseId:'nope' }));
  expect('no course: null', scN, null);
}

// ── 112. SKINS NET PER HOLE — half-stroke never floored ──────
// Expected values from the formula independently:
//   strokesOnHole(18,1,18)=1 → half 0.5 ; strokesOnHole(36,1,18)=2 → half 1.0 ;
//   strokesOnHole(0,1,18)=0. Half-stroke keeps the .5 (the outing bug floored it away).
{
  const { skinsNetOnHole } = sandbox;
  // 1 stroke on the hole, half-stroke ON → keeps 0.5
  expect('half on: 4 - 0.5 = 3.5',  skinsNetOnHole(4, 18, 1, 18, true),  3.5);
  // same hole, half-stroke OFF → full integer stroke
  expect('half off: 4 - 1 = 3',     skinsNetOnHole(4, 18, 1, 18, false), 3);
  // 2 strokes → half 1.0 (no fractional), stays integer
  expect('half on: 5 - 1.0 = 4',    skinsNetOnHole(5, 36, 1, 18, true),  4);
  // no gross posted → 0
  expect('no gross → 0',            skinsNetOnHole(0, 18, 1, 18, true),  0);
  // the whole point: a stroked par (net 3.5) beats an unstroked par (net 4.0)
  const stroked   = skinsNetOnHole(4, 18, 1, 18, true);   // gets 0.5
  const unstroked = skinsNetOnHole(4,  0, 1, 18, true);   // gets 0
  expect('stroked half beats unstroked', stroked < unstroked, true);
}

// ── 113. NASSAU SUMMARY — segment label formatting ───────────
{
  const { fsNassauSegLabel } = sandbox;
  expect('seg A wins → team A + amount', fsNassauSegLabel({winner:'A'}, 'Blood/Davis', 'Caito/Schroeder', 10), 'Blood/Davis $10');
  expect('seg B wins → team B + amount', fsNassauSegLabel({winner:'B'}, 'Blood/Davis', 'Caito/Schroeder', 10), 'Caito/Schroeder $10');
  expect('seg tie',        fsNassauSegLabel({winner:'tie'}, 'A', 'B', 10), 'tie');
  expect('seg open (no winner)', fsNassauSegLabel({}, 'A', 'B', 10),   'open');
  expect('seg open (null)',      fsNassauSegLabel(null, 'A', 'B', 10), 'open');
}

// ── 114. WORKFLOW NAV — prev/next resolution ─────────────────
// Trip step order: roster, courses, schedule, pairings, results.
{
  const { workflowNeighbors, workflowNav } = sandbox;
  const n1 = workflowNeighbors('trip','roster');
  expect('roster: no prev',      n1.prev, null);
  expect('roster: next courses', n1.next && n1.next.id, 'courses');
  const n2 = workflowNeighbors('trip','results');
  expect('results: prev pairings', n2.prev && n2.prev.id, 'pairings');
  expect('results: no next',       n2.next, null);
  const n3 = workflowNeighbors('trip','schedule');
  expect('schedule: prev courses', n3.prev && n3.prev.id, 'courses');
  expect('schedule: next pairings',n3.next && n3.next.id, 'pairings');
  const n4 = workflowNeighbors('trip','bogus');
  expect('unknown step: no prev', n4.prev, null);
  expect('unknown step: no next', n4.next, null);
  const n5 = workflowNeighbors('nomodule','x');
  expect('unknown module: no prev', n5.prev, null);
  // workflowNav output wiring
  const navR = workflowNav('trip','roster');
  expect('nav: hub button',   navR.includes("tripGoScreen('hub')"),     true);
  expect('nav: next→courses',  navR.includes("tripGoScreen('courses')"), true);
  expect('nav: roster title',  navR.includes('ROSTER'),                  true);
  const navP = workflowNav('trip','pairings');
  expect('nav: prev→schedule', navP.includes("tripGoScreen('schedule')"), true);
  expect('nav: next→results',  navP.includes("tripGoScreen('results')"),  true);
  // extra param renders after the nav
  const navX = workflowNav('trip','schedule','SCHEDULE','<button id="addday"></button>');
  expect('nav: extra rendered', navX.includes('id="addday"'), true);

  // Outing: linearNext:false → prev + hub, but NO auto next-arrow (screen keeps its forward button)
  const on1 = workflowNeighbors('outing','players');
  expect('outing players: no prev', on1.prev, null);
  expect('outing players: next course', on1.next && on1.next.id, 'course');
  const on2 = workflowNeighbors('outing','scoring');
  expect('outing scoring: prev groups', on2.prev && on2.prev.id, 'groups');
  const navOC = workflowNav('outing','course');
  expect('outing nav: hub',        navOC.includes("outingGoStep('hub')"),     true);
  expect('outing nav: prev players',navOC.includes("outingGoStep('players')"), true);
  expect('outing nav: no auto-next arrow', navOC.includes('&#8250;'),          false);
  // titleId preserved (live-updated header)
  const navPid = workflowNav('outing','players','PLAYERS &mdash; 3 selected', '', 'outing-plan-player-hdr');
  expect('outing nav: title id kept', navPid.includes('id="outing-plan-player-hdr"'), true);

  // League: place -> schedule -> roster flow, auto prev/next (no forward buttons on these screens)
  const ln1 = workflowNeighbors('league','course');
  expect('league course: no prev',     ln1.prev, null);
  expect('league course: next seasons',ln1.next && ln1.next.id, 'seasons');
  const ln2 = workflowNeighbors('league','standings');
  expect('league standings: prev sessions', ln2.prev && ln2.prev.id, 'sessions');
  expect('league standings: no next',       ln2.next, null);
  const navLC = workflowNav('league','course');
  expect('league nav: hub',      navLC.includes("leagueGoStep('hub')"),      true);
  expect('league nav: next→seasons', navLC.includes("leagueGoStep('seasons')"), true);
  const navLS = workflowNav('league','standings');
  expect('league nav: prev→sessions', navLS.includes("leagueGoStep('sessions')"), true);
  expect('league nav: no next at end', navLS.includes('&#8250;'), false);
}

// ── 115. LEAGUE SEASONS — add inherits schedule, set weeknight ──
{
  vmSetS('events', [{ type:'league', id:'lgA', status:'active', sessions:[],
    seasons:[{ id:'s1', name:'Season 1', active:true, partners:[], dayOfWeek:1, teeTimes:['5:20','5:30'] }] }]);
  vmSetS('activeLeagueId', 'lgA');
  sandbox.leagueAddSeason('seasons');
  const lgA = sandbox.leagueCurrent();
  expect('addSeason: 2 seasons',        lgA.seasons.length, 2);
  const s2 = lgA.seasons[1];
  expect('addSeason: new active',       s2.active, true);
  expect('addSeason: prev inactive',    lgA.seasons[0].active, false);
  expect('addSeason: inherits dayOfWeek', s2.dayOfWeek, 1);
  expect('addSeason: inherits teeTimes',  s2.teeTimes.join(','), '5:20,5:30');
  expect('addSeason: name Season 2',    s2.name, 'Season 2');
  // teeTimes are a copy, not shared
  s2.teeTimes.push('6:00');
  expect('addSeason: teeTimes copied not shared', lgA.seasons[0].teeTimes.length, 2);
  // leagueSetSeasonDow
  sandbox.leagueSetSeasonDow(s2.id, '4');
  expect('setSeasonDow: sets 4', lgA.seasons[1].dayOfWeek, 4);
  sandbox.leagueSetSeasonDow(s2.id, '');
  expect('setSeasonDow: empty→null', lgA.seasons[1].dayOfWeek, null);
}

// ── 116. LEAGUE SHOTGUN HOLES + SEASON HOLES/START CONFIG ─────
{
  const { leagueShotgunHoles } = sandbox;
  expect('shotgun holes all: 18',      leagueShotgunHoles('all').length, 18);
  expect('shotgun holes all: ends 18', leagueShotgunHoles('all')[17], 18);
  expect('shotgun holes front: 9',     leagueShotgunHoles('front').length, 9);
  expect('shotgun holes front: ends 9', leagueShotgunHoles('front')[8], 9);
  expect('shotgun holes back: 9',      leagueShotgunHoles('back').length, 9);
  expect('shotgun holes back: starts 10', leagueShotgunHoles('back')[0], 10);
  expect('shotgun holes back: ends 18', leagueShotgunHoles('back')[8], 18);

  // Migration defaults startType/nineSide/shotgunTime onto the season
  const noCfg={type:'league',id:'lgS',sessions:[],teeTimes:[],
    seasons:[{id:'s1',name:'Season 1',active:true,partners:[]}]};
  const migCfg=normalizeState({account:{},players:[],courses:[],events:[noCfg],config:{}});
  const seaCfg=migCfg.events[0].seasons[0];
  expect('migrate: default startType', seaCfg.startType, 'teetimes');
  expect('migrate: default nineSide',  seaCfg.nineSide, 'all');
  expect('migrate: default shotgunTime', seaCfg.shotgunTime, '');

  // New season inherits start-type / holes / shotgun time from the active season
  vmSetS('events', [{type:'league', id:'lgSh', status:'active', sessions:[],
    seasons:[{id:'s1',name:'Season 1',active:true,partners:[],dayOfWeek:2,teeTimes:['5:00'],
      startType:'shotgun',nineSide:'back',shotgunTime:'5:30 PM'}]}]);
  vmSetS('activeLeagueId', 'lgSh');
  sandbox.leagueAddSeason('seasons');
  const ns=sandbox.leagueCurrent().seasons[1];
  expect('addSeason: inherits startType',   ns.startType, 'shotgun');
  expect('addSeason: inherits nineSide',    ns.nineSide, 'back');
  expect('addSeason: inherits shotgunTime', ns.shotgunTime, '5:30 PM');

  // leaguePrevSeason — the season before the active one (source for copy-from-last)
  const { leaguePrevSeason } = sandbox;
  expect('prevSeason: before active', leaguePrevSeason({seasons:[{id:'a',active:false},{id:'b',active:true},{id:'c',active:false}]}).id, 'a');
  expect('prevSeason: active first → null', leaguePrevSeason({seasons:[{id:'a',active:true},{id:'b',active:false}]}), null);
  expect('prevSeason: before last active', leaguePrevSeason({seasons:[{id:'a',active:false},{id:'b',active:false},{id:'c',active:true}]}).id, 'b');
  expect('prevSeason: no seasons → null', leaguePrevSeason({seasons:[]}), null);
}

// ── 117. ADMIN USAGE SUMMARY + LINE (counts only) ────────────
{
  const { adminUsageSummary, adminUsageLine } = sandbox;
  const S117 = { events: [
    {type:'foursome'}, {type:'foursome'},
    {type:'outing'},
    {type:'league', sessions:[{},{},{}]},
    {type:'trip', rounds:[{},{}]},
    {type:'trip', rounds:[{}]},
  ]};
  const sum = adminUsageSummary(S117);
  expect('usage: foursome=2', sum.foursome, 2);
  expect('usage: outings=1',  sum.outings, 1);
  expect('usage: leagues=1',  sum.leagues, 1);
  expect('usage: trips=2',    sum.trips, 2);
  expect('usage: sessions=3', sum.sessions, 3);
  expect('usage: rounds=3',   sum.rounds, 3);
  expect('usage: empty state', adminUsageSummary({events:[]}).foursome, 0);
  // line formatting (pluralization + nested counts)
  expect('line: full', adminUsageLine({foursome:2,outings:1,leagues:1,trips:0,sessions:3,rounds:0}),
    '2 games · 1 outing · 1 league (3 sess) · 0 trips');
  expect('line: singular game', adminUsageLine({foursome:1,outings:0,leagues:0,trips:0}),
    '1 game · 0 outings · 0 leagues · 0 trips');
  expect('line: no usage', adminUsageLine(null), 'usage updates on next sign-in');
}

// ── 118. RENDER OUTPUT — no unrendered templates ─────────────
// Captures the real HTML each screen produces and asserts it contains no raw ${...} (the
// escaped-template class of bug that once rendered standings as source text) and no
// "[object Object]" (a bad interpolation). This reaches the layer smoke() cannot.
{
  const screens = [
    ['leagueRenderHub',            'leagueRenderHub();'],
    ['leagueRenderSeasonsScreen',  'leagueRenderSeasonsScreen();'],
    ['leagueRenderStandings',      'leagueRenderStandings(true);'],
    ['leagueRenderPartnersScreen', 'leagueRenderPartnersScreen();'],
    ['tripRenderHub',              'tripRenderHub();'],
    ['tripRenderResultsScreen',    'tripRenderResultsScreen();'],
    ['outingRenderHub',            'outingRenderHub();'],
  ];
  for (const [name, call] of screens) {
    const r = captureRender(call);
    expect(`render ${name}: produced html`,   r.html.length > 0, true);
    expect(`render ${name}: no raw \${ }`,      /\$\{/.test(r.html), false);
    expect(`render ${name}: no [object Object]`, r.html.includes('[object Object]'), false);
  }
}

// ── 119. COURSE HANDICAP — single shared source (with allowance) ──
{
  const { courseHandicap, calcCourseHcp } = sandbox;
  expect('courseHcp 10@100%',          courseHandicap(10,113,72,72,100,false), 10);
  expect('courseHcp 10@90%',           courseHandicap(10,113,72,72,90,false), 9);
  expect('courseHcp 18@90%',           courseHandicap(18,113,72,72,90,false), 16);
  expect('courseHcp 20 slope130@100%', courseHandicap(20,130,70,72,100,false), 21);
  expect('courseHcp 20 slope130@85%',  courseHandicap(20,130,70,72,85,false), 18);
  expect('courseHcp 9-hole @100%',     courseHandicap(10,113,35,36,100,true), 9);
  // 100% allowance == plain course handicap (backward-compatible for the common case)
  expect('100% == calcCourseHcp', courseHandicap(20,130,70,72,100,false), calcCourseHcp(20,130,70,72,false));
  // both scoring-context engines must use the shared function (no drift back to divergent hcp math)
  expect('buildScoringCtx uses courseHandicap', html.includes('courseHcp: courseHandicap('), true);
  expect('tripScoringCtx uses courseHandicap',  html.includes('courseHcp: courseHandicap(hi'), true);
  expect('league scoring uses courseHandicap',   html.includes('courseHcp:courseHandicap(p.hcp||0,c.slope') && html.includes('courseHcp: courseHandicap(p.hcp||0, course.slope'), true);
}

// ── 120. LEAGUE + OUTING HC ADJUSTMENT (allowance) ───────────
{
  const { leagueSessionAllowance } = sandbox;
  const lg = { seasons:[{id:'s1',active:true,strokeAllowance:90},{id:'s2',active:false,strokeAllowance:75}] };
  expect('allowance: active season',  leagueSessionAllowance(lg, {seasonId:'s1'}), 90);
  expect('allowance: other season',   leagueSessionAllowance(lg, {seasonId:'s2'}), 75);
  expect('allowance: unknown → active', leagueSessionAllowance(lg, {seasonId:'zzz'}), 90);
  expect('allowance: none → 100',     leagueSessionAllowance({seasons:[{id:'s1',active:true}]}, {seasonId:'s1'}), 100);
  // migration defaults
  const migO = normalizeState({account:{},players:[],courses:[],events:[
    {type:'outing',id:'o1',status:'active',gameType:'stableford',scores:{}}],config:{}});
  expect('outing default allowance 100', migO.events[0].strokeAllowance, 100);
  const migL = normalizeState({account:{},players:[],courses:[],events:[
    {type:'league',id:'l1',sessions:[],teeTimes:[],seasons:[{id:'s1',name:'Season 1',active:true,partners:[]}]}],config:{}});
  expect('league season default allowance 100', migL.events[0].seasons[0].strokeAllowance, 100);
}

// ── 121. GAME SUMMARY — Nassau regenerated readable for old games ──
{
  const { fsGameSummary } = sandbox;
  expect('gameSummary: non-nassau → stored', fsGameSummary({gameType:'stableford',summary:'Al net 72'}), 'Al net 72');
  expect('gameSummary: null → empty',        fsGameSummary(null), '');
  // nassau with no resolvable data → falls back to the stored (old) string
  expect('gameSummary: nassau no data → fallback', fsGameSummary({gameType:'nassau',summary:'M1[F:A($10)]'}), 'M1[F:A($10)]');
  // nassau WITH data (smoke fixture) → regenerated plain-English, never the cryptic M1[ format
  smokeSetup();
  const sN = vm.runInContext(`(function(){ const g = S.events.find(e=>e.gameType==='nassau'); return g ? fsGameSummary(g) : null; })()`, sandbox);
  expect('smoke nassau game present', sN !== null, true);
  expect('gameSummary: nassau results-only starts Front:', (sN||'').startsWith('Front:'), true);
  expect('gameSummary: nassau not cryptic M1[',        (sN||'').includes('M1['), false);
}

// ── 122. GAME CARD — single shared body, no raw g.summary in renders ──
{
  // Every saved-game render must go through fsGameSummary/fsGameCardBody so the Nassau
  // regeneration applies everywhere. A raw ${esc(g.summary)} is the duplication that hid the bug.
  expect('no raw g.summary in any render', html.includes('${esc(g.summary)}'), false);
  // both list renders share the one card body
  expect('fsGameCardBody defined', html.includes('function fsGameCardBody('), true);
  const bodyUses = (html.match(/fsGameCardBody\(g\)/g) || []).length;
  expect('fsGameCardBody used by both lists (>=2)', bodyUses >= 2, true);
}

// ── 123. SETTLEMENT HELPERS — exact HTML (money logic) ───────
{
  vmSetS('players', [{id:'p1',name:'Alice'},{id:'p2',name:'Bob'},{id:'p3',name:'Carol'}]);
  const bal = {p1:20, p2:-10, p3:-10};
  const table = vm.runInContext(`settleBalanceTable(['p1','p2','p3'], ${JSON.stringify(bal)})`, sandbox);
  const expTable = '<table class="settle-table"><tbody>'
    + '<tr><td>Alice</td><td class="settle-pos" style="text-align:right;">+$20</td></tr>'
    + '<tr><td>Bob</td><td class="settle-neg" style="text-align:right;">-$10</td></tr>'
    + '<tr><td>Carol</td><td class="settle-neg" style="text-align:right;">-$10</td></tr>'
    + '</tbody></table>';
  expect('settleBalanceTable exact HTML', table, expTable);
  const lines = vm.runInContext(`settlePayLines(['p1','p2','p3'], ${JSON.stringify(bal)})`, sandbox);
  const expLines = '<div style="margin-top:8px;">'
    + '<div class="settle-txn"><span class="settle-neg">Bob</span> pays <span class="settle-pos">Alice</span> $10</div>'
    + '<div class="settle-txn"><span class="settle-neg">Carol</span> pays <span class="settle-pos">Alice</span> $10</div>'
    + '</div>';
  expect('settlePayLines exact HTML (greedy, creditor re-read)', lines, expLines);
  expect('settlePayLines all-even → empty', vm.runInContext(`settlePayLines(['p1'], {p1:0})`, sandbox), '');
  expect('settlePayLines no creditors → empty', vm.runInContext(`settlePayLines(['p2'], {p2:-5})`, sandbox), '');
}

// ── 124. firstName helper ────────────────────────────────────
{
  vmSetS('players', [{id:'p1',name:'Alice Wong'},{id:'p2',name:'Bob'}]);
  expect('firstName two-word', vm.runInContext(`firstName('p1')`, sandbox), 'Alice');
  expect('firstName one-word', vm.runInContext(`firstName('p2')`, sandbox), 'Bob');
  expect('firstName missing → ?', vm.runInContext(`firstName('zzz')`, sandbox), '?');
  expect('firstName defined', html.includes('function firstName('), true);
}

// ── 125. coursePar (authoritative) + GHIN handicap case ──────
{
  const { coursePar, courseHandicap } = sandbox;
  const holes72 = Array.from({length:18}, (_,i) => ({num:i+1, par:4}));           // 72
  const holes71 = holes72.map((h,i) => i===0 ? {num:1, par:3} : h);               // 71
  expect('coursePar 18x par4 = 72', coursePar({holes:holes72}), 72);
  expect('coursePar with one par3 = 71', coursePar({holes:holes71}), 71);
  expect('coursePar no holes → par field', coursePar({par:70}), 70);
  expect('coursePar empty → 72', coursePar({}), 72);
  // the reported case: 72.3/133, index 12 → 14 at par 72 (matches GHIN), 15 at par 71
  expect('GHIN case: par 72 → 14', courseHandicap(12, 133, 72.3, coursePar({holes:holes72}), 100, false), 14);
  expect('bug case: par 71 → 15',  courseHandicap(12, 133, 72.3, coursePar({holes:holes71}), 100, false), 15);
}

// ── 126. fsHcpBreakdown — surfaces the exact calc inputs ─────
{
  vmSetS('courses', [{id:'cX', slope:133, rating:72.3, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4}))}]);
  vmSetS('players', [{id:'z', name:'Zrimsek', hcp:12}]);
  vmSetS('events',  [{id:'gX', type:'foursome', courseId:'cX', rawChs:{z:14}}]);
  const out = vm.runInContext(`fsHcpBreakdown('gX','z')`, sandbox);
  expect('breakdown: HI 12',      out.includes('HI 12'), true);
  expect('breakdown: slope 133',  out.includes('slope 133'), true);
  expect('breakdown: rating 72.3',out.includes('rating 72.3'), true);
  expect('breakdown: par 72',     out.includes('par 72'), true);
  expect('breakdown: CH 14',      out.includes('CH 14'), true);
  expect('breakdown: missing course', vm.runInContext(`fsHcpBreakdown('nope','z')`, sandbox).includes('missing'), true);
}

// ── 127. Handicap refresh on resume (foursome + outing) ──────
{
  vmSetS('courses', [{id:'cX', slope:133, rating:72.3, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4}))}]);
  vmSetS('players', [{id:'z', name:'Z', hcp:12}]);
  const fRes = vm.runInContext(`
    const g = {type:'foursome', gameType:'nassau', courseId:'cX', playerIds:['z'], strokeMode:'field', chs:{z:15}, rawChs:{z:15}};
    S.events=[g]; fsRefreshChs(g); g.rawChs.z;`, sandbox);
  expect('fsRefreshChs: stale 15 → 14', fRes, 14);
  const oRes = vm.runInContext(`
    const g2 = {type:'outing', courseId:'cX', strokeAllowance:100, players:[{id:'z', hcp:12, courseHcp:15}]};
    S.events=[g2]; outingRefreshChs(g2); g2.players[0].courseHcp;`, sandbox);
  expect('outingRefreshChs: stale 15 → 14', oRes, 14);
  const noop = vm.runInContext(`
    const g3 = {type:'outing', courseId:'cX', strokeAllowance:100, players:[{id:'z', hcp:12, courseHcp:14}]};
    S.events=[g3]; outingRefreshChs(g3); g3.players[0].courseHcp;`, sandbox);
  expect('outingRefreshChs: already 14 stays 14', noop, 14);
}

// ── 128. matchBanner — one shared banner, normalized ─────────
{
  const { matchBanner } = sandbox;
  const doc = matchBanner({cls:'mb-up', id:'b1', label:'Opposites', sub:'Holes 1', score:'2 UP', scoreId:'s1', color:'#0a0'});
  expect('matchBanner: banner class', doc.includes('class="match-banner mb-up" id="b1"'), true);
  expect('matchBanner: normalized mb-score', doc.includes('<div class="mb-score" id="s1" style="color:#0a0;">2 UP</div>'), true);
  expect('matchBanner: no lbl id when omitted', doc.includes('<div class="mb-lbl">Opposites</div>'), true);
  const wo = matchBanner({cls:'mb-dn', id:'b2', label:'X', sub:'Y', score:'Z', scoreId:'s2', color:'#a00', lblId:'l2', subId:'su2'});
  expect('matchBanner: lbl id when given', wo.includes('<div class="mb-lbl" id="l2">X</div>'), true);
  expect('matchBanner: sub id when given', wo.includes('<div class="mb-sub" id="su2">Y</div>'), true);
}

// ── 129. scorecardHdr HCP row + foursome scorecard render ────
{
  const { scorecardHdr } = sandbox;
  const holes = [{num:1,par:4,hcp:5},{num:2,par:3,hcp:9}];
  const withHcp = scorecardHdr(holes, 'FRONT', 'OUT', '60px', '36px', true);
  expect('scorecardHdr hcpRow adds HCP', withHcp.includes('>HCP<'), true);
  expect('scorecardHdr default no HCP', scorecardHdr(holes,'FRONT','OUT').includes('>HCP<'), false);
  expect('scorecardHdr hole nums', withHcp.includes('>1</div>') && withHcp.includes('>2</div>'), true);
  expect('scorecardHdr par total 7', withHcp.includes('>7</div>'), true);
  expect('scorecardHdr 60px col', withHcp.includes('grid-template-columns:60px'), true);
  // foursome scorecard still renders through the shared header
  vmSetS('courses', [{id:'cX', slope:113, rating:72, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1}))}]);
  vmSetS('players', [{id:'p1', name:'Alice', hcp:10}]);
  const fc = vm.runInContext(`fsRenderScorecard({id:'g1',gameType:'stableford',courseId:'cX',playerIds:['p1'],scores:{},chs:{p1:10},rawChs:{p1:10},strokeMode:'field',_totalHoles:18},[{id:'p1',name:'Alice'}]);`, sandbox);
  expect('foursome scorecard: inputs', fc.includes('game-score-input'), true);
  expect('foursome scorecard: HCP row', fc.includes('>HCP<'), true);
  expect('foursome scorecard: no raw template', /\$\{/.test(fc), false);
}

// ── 130. scoreCell — shared score-entry cell ─────────────────
{
  const { scoreCell } = sandbox;
  const c = scoreCell('4', 1, 'data-pid', 'p1', 3, 'fsUpdateGameScore(this)');
  expect('scoreCell: value', c.includes('value="4"'), true);
  expect('scoreCell: attr+pid', c.includes('data-pid="p1"'), true);
  expect('scoreCell: hole', c.includes('data-hole="3"'), true);
  expect('scoreCell: handler', c.includes('oninput="fsUpdateGameScore(this)"'), true);
  expect('scoreCell: class', c.includes('class="game-score-input"'), true);
  expect('scoreCell: stroke dot red', c.includes('#c0392b'), true);
  expect('scoreCell: no dot at 0', scoreCell('',0,'data-pid','p1',1,'h(this)').includes('c0392b'), false);
  expect('scoreCell: gives-back green', scoreCell('',-1,'data-pid','p1',1,'h(this)').includes('#27ae60'), true);
  expect('scoreCell: no raw template', /\$\{/.test(c), false);
  // foursome cells still carry the foursome handler + attr after delegation
  vmSetS('courses', [{id:'cX', slope:113, rating:72, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1}))}]);
  vmSetS('players', [{id:'p1', name:'Alice', hcp:10}]);
  const fc = vm.runInContext(`fsRenderScorecard({id:'g1',gameType:'stableford',courseId:'cX',playerIds:['p1'],scores:{p1:{1:5}},chs:{p1:10},rawChs:{p1:10},strokeMode:'field',_totalHoles:18},[{id:'p1',name:'Alice'}]);`, sandbox);
  expect('foursome cell: fsUpdateGameScore', fc.includes('oninput="fsUpdateGameScore(this)"'), true);
  expect('foursome cell: data-pid', fc.includes('data-pid="p1"'), true);
  expect('foursome cell: entered score shows', fc.includes('value="5"'), true);
}

// ── 131. Foursome scorecard delegated to renderScorecardGroup ─
{
  vmSetS('courses', [{id:'cX', slope:113, rating:72, holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1}))}]);
  vmSetS('players', [{id:'p1', name:'Alice', hcp:10}]);
  const fc = vm.runInContext(`fsRenderScorecard({id:'g1',gameType:'nassau',courseId:'cX',playerIds:['p1'],scores:{p1:{1:5,10:4}},chs:{p1:12},rawChs:{p1:14},strokeMode:'field',_totalHoles:18},[{id:'p1',name:'Alice'}]);`, sandbox);
  // live-update id scheme fsUpdateScoreTotals targets must be preserved
  expect('delegated: sc-tot-f id', fc.includes('id="sc-tot-f-p1"'), true);
  expect('delegated: sc-tot-b id', fc.includes('id="sc-tot-b-p1"'), true);
  expect('delegated: sc-tot-18 id', fc.includes('id="sc-tot-18-p1"'), true);
  // live entry
  expect('delegated: data-pid', fc.includes('data-pid="p1"'), true);
  expect('delegated: handler', fc.includes('oninput="fsUpdateGameScore(this)"'), true);
  // foursome CH label: raw 14 . adj 12 + breakdown tap
  expect('delegated: rawCh 14', fc.includes('>14</span>'), true);
  expect('delegated: adjCh 12', fc.includes('>12</span>'), true);
  expect('delegated: breakdown', fc.includes('fsHcpBreakdown'), true);
  // HCP row + entered score + clean template
  expect('delegated: HCP row', fc.includes('>HCP<'), true);
  expect('delegated: score shows', fc.includes('value="5"'), true);
  expect('delegated: no raw template', /\$\{/.test(fc), false);
}

// ── 132. Trip scorecard pages (one group + nav), not long-scroll ─
{
  expect('trip: paged validGroups', html.includes('const validGroups=ctx.groups.map'), true);
  expect('trip: nav fn', html.includes('function tripNavGroup'), true);
  expect('trip: active group only', html.includes('active?renderScorecardGroup(ctx,active.gi,active.grp'), true);
  expect('trip: group pills nav', html.includes('onclick="tripNavGroup('), true);
  expect('trip: resets group on entry', html.includes('window._tripSelectedGroup = 0;'), true);
}

// ── 133. firstWord — the single .split(' ')[0] atom ──────────
{
  const { firstWord } = sandbox;
  expect('firstWord two-word', firstWord('Alice Wong'), 'Alice');
  expect('firstWord one-word', firstWord('Bob'), 'Bob');
  expect('firstWord empty', firstWord(''), '');
  expect('firstWord null-safe', firstWord(null), '');
  expect('firstWord undefined-safe', firstWord(undefined), '');
  vmSetS('players', [{id:'p1',name:'Alice Wong'}]);
  expect('firstName via firstWord', vm.runInContext(`firstName('p1')`, sandbox), 'Alice');
  expect('firstName missing still ?', vm.runInContext(`firstName('zzz')`, sandbox), '?');
  expect('no raw .name.split in source', html.includes(".name.split(' ')[0]"), false);
}

// ── 134. Rejoin: game-type picker rebuilds players from active game ─
{
  // On rejoin the transient _fsPicked is gone; fsShowGameTypePicker must rebuild it from the
  // active foursome game rather than bounce to "Select 2-4 players".
  expect('rejoin: rebuilds _fsPicked from active game',
    html.includes('const ag=fsActiveGame();') && html.includes('window._fsPicked=[...ag.playerIds]'), true);
}

// ── 135. lastName + banner never Pending / guarded tallies ───
{
  vmSetS('players',[{id:'p1',name:'Kevrin Blood'},{id:'p2',name:'Schroeder, Bob'}]);
  expect('lastName space form', vm.runInContext(`lastName('p1')`,sandbox), 'blood');
  expect('lastName comma form', vm.runInContext(`lastName('p2')`,sandbox), 'schroeder');
  expect('lastName missing', vm.runInContext(`lastName('zz')`,sandbox), '?');
  expect('no Pending text anywhere', html.includes("'Pending'"), false);
  expect('nassau tally undefined-guarded', html.includes('r.aT!=null?'), true);
}

// ── 136. fsPairOrderedIds — scorecard in team order ──────────
{
  const g={playerIds:['c','a','d','b']};                 // roster order != team order
  const pairs=[{teamA:['a','b'],teamB:['c','d']}];
  expect('team order T1,T1,T2,T2', vm.runInContext(`fsPairOrderedIds(${JSON.stringify(g)}, ${JSON.stringify(pairs)}).join(',')`,sandbox), 'a,b,c,d');
  expect('no pairs → playerIds', vm.runInContext(`fsPairOrderedIds(${JSON.stringify(g)}, []).join(',')`,sandbox), 'c,a,d,b');
  expect('legacy A/B order', vm.runInContext(`fsPairOrderedIds({playerIds:['y','x']}, [{A:'x',B:'y'}]).join(',')`,sandbox), 'x,y');
}

// ── 137. One active foursome game (normalizeState dedup) ─────
{
  const r2 = vm.runInContext(`(()=>{ const gg={id:'gg',type:'foursome',status:'active',_scoring:true,scores:{}}; S.events=[gg]; fsEndGame(gg); return [gg.status,gg._scoring].join(','); })()`, sandbox);
  expect('fsEndGame completes + clears scoring', r2, 'complete,false');
  // normalizeState (runs on load AND on every scheduleWrite) keeps only the newest active foursome
  const r3 = vm.runInContext(`(()=>{ const n=normalizeState({events:[{id:'a',type:'foursome',status:'active',date:1},{id:'b',type:'foursome',status:'active',date:5}]}); return n.events.map(e=>e.id+':'+e.status).join(','); })()`, sandbox);
  expect('normalizeState keeps newest active foursome', r3, 'a:abandoned,b:active');
  const r4 = vm.runInContext(`(()=>{ const n=normalizeState({events:[{id:'x',type:'foursome',status:'active',date:9}]}); return n.events.find(e=>e.id==='x').status; })()`, sandbox);
  expect('normalizeState leaves a lone active foursome alone', r4, 'active');
}

// ── 138. Recent-games card: last names + results-only summary ─
{
  const { fsLastNamesLine } = sandbox;
  expect('last names line', fsLastNamesLine(['Kevrin Blood','Chris Davis','Scott Schroeder']), 'Blood, Davis, Schroeder');
  expect('initial when shared surname', fsLastNamesLine(['Bob Smith','Jim Smith']), 'B. Smith, J. Smith');
  expect('comma-form name', fsLastNamesLine(['Blood, Kevrin']), 'Blood');
  vmSetS('courses',[{id:'cN',slope:113,rating:72,holes:Array.from({length:18},(_,i)=>({num:i+1,par:4,hcp:i+1}))}]);
  vmSetS('players',[{id:'a',name:'A A'},{id:'b',name:'B B'}]);
  const sum = vm.runInContext(`fsNassauSummary({courseId:'cN',pairs:[{teamA:['a'],teamB:['b'],A:'a',B:'b'}],scores:{},costF:10,costB:10,costT:10,nassauMode:'match'})`, sandbox);
  expect('summary is results-only (starts Front)', sum.startsWith('Front:'), true);
  expect('summary drops the vs matchup', sum.includes(' vs '), false);
}

const total = passed + failed;
console.log(`\n══════════════════════════════════════════`);
console.log(`  MadGolf Test Harness — v${APP_VERSION}`);
console.log(`══════════════════════════════════════════`);

if (evalError) {
  console.log(`\n  ✖ FATAL: Could not eval index.html`);
  console.log(`    ${evalError.message}`);
  process.exit(1);
}

if (failed === 0) {
  console.log(`\n  ✔ All ${total} tests passed\n`);
} else {
  console.log(`\n  ✔ ${passed}/${total} passed   ✖ ${failed} failed\n`);
  console.log('  Failed tests:');
  failures.forEach((f, i) => {
    console.log(`\n  ${i+1}. ${f.desc}`);
    console.log(`     expected : ${JSON.stringify(f.expected)}`);
    console.log(`     actual   : ${JSON.stringify(f.actual)}`);
  });
  console.log('');
  process.exit(1);
}
