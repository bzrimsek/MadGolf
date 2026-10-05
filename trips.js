/* TRIPS: whole golf trips, simulated through the real screens (BZ, 2026-10-05:
 * "looking to use this app for a coming golf trip and need those features to
 * be solid - exercise the input screens and simulate a number of trips,
 * including the remote scoring pages and leaderboard pages").
 *
 *   node trips.js                Chromium at phone size
 *   WALK_INDEX=copy.html node trips.js
 *
 * Every trip is built by tapping and typing, as the organizer would: trip,
 * roster, courses, rounds (format, nine, tee times, championship), handicaps,
 * pairings, scoring group by group, results. Two groups score from their own
 * phones (score.html) while a third scores in the app, and the public board
 * (live.html) is read back.
 *
 * EXPECTED VALUES ARE WORKED OUT HERE, NOT ASKED OF THE APP (rule 28): course
 * handicaps by the WHS formula, net totals, standings and countback are
 * computed in this file from the scores it typed. Where the app disagrees,
 * the step fails and says by how much.
 *
 * BZ's rules for a trip (2026-10-05):
 *   - The trip game is individual NET STROKES over every competitive
 *     individual round, Stableford days included (points decide only that
 *     day's own game).
 *   - Handicaps lock at the first round; a later index change does not move
 *     the trip.
 *   - The championship round seats the field by standing, leaders last off.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const lib = require('./walk-lib.js');
const { fake, ORIGIN, UID, DIR } = lib;
const { reporter, wire, listen } = lib._internal;

const STATE_PATH = '/bz-apps/golf/' + UID + '/state';

/* ---- THE FIELD: sixteen players across the range a real trip has - a plus
   handicap, a scratch, the middle, and a 36. */
const HIS = [-1.2, 0.4, 2.1, 3.4, 5.2, 7.7, 8.1, 10.0, 12.3, 14.6, 15.6, 18.9, 20.1, 24.3, 28.4, 36.0];
const NAMES = ['Ace Plus', 'Sam Scratch', 'Ben Low', 'Cal Hale', 'Brian Zrimsek', 'Sam Ortiz', 'Kevin Blood',
  'Joe Novak', 'Ryan Caito', 'Dan Fry', 'Chris Davis', 'Pat Moss', 'Tom Price', 'Lou Gray', 'Ned Bell', 'Max High'];
const PLAYERS = NAMES.map((n, i) => ({ id: 'p' + (i + 1), name: n, hcp: HIS[i], ghin: '', regular: true }));

function course(id, name, slope, rating, pars, order) {
  const holes = pars.map((par, i) => ({ num: i + 1, par, hcp: order[i], hcpRating: order[i], yards: 380 }));
  return { id, name, slope, rating, par: pars.reduce((a, b) => a + b, 0), nineHole: false, homeCourse: false, holes };
}
const C1 = course('c1', 'Pine Needles', 125, 71.4,
  [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5],
  [7, 13, 17, 1, 11, 5, 15, 9, 3, 8, 14, 18, 2, 12, 6, 16, 10, 4]);
C1.tees = [{ id: 'c1-blue', color: 'Blue', slope: 132, rating: 73.1 }];
const C2 = course('c2', 'Mid Pines', 138, 74.2,
  [4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 4],
  [3, 9, 15, 7, 1, 11, 17, 5, 13, 4, 10, 16, 2, 8, 12, 18, 6, 14]);

function seed() {
  return { account: { name: 'Trip Tester', email: 'trip@example.com', photoURL: '', createdAt: 1 },
    players: JSON.parse(JSON.stringify(PLAYERS)), courses: JSON.parse(JSON.stringify([C1, C2])),
    events: [], activeOutingId: null, activeTripId: null, activeRound: null,
    config: { ghinProxyUrl: '', myPlayerId: 'p5', log: [] } };
}

/* ---- THE SCORES THE SIMULATOR TYPES. Deterministic, varied by player,
   hole and round, and worse for higher handicaps, as golf is. */
function grossFor(pid, hole, par, roundKey) {
  const i = parseInt(pid.slice(1), 10);
  const hi = HIS[i - 1];
  const wobble = ((i * 7 + hole * 3 + roundKey * 5) % 5) - 1;          // -1..3
  const skill = hi < 3 ? -1 : hi < 12 ? 0 : hi < 22 ? 1 : 2;
  return Math.max(2, Math.min(9, par + Math.max(-1, Math.min(3, wobble)) + skill));
}

/* ---- THE ANSWER, WORKED HERE (WHS, the same formula a scorer uses by hand). */
const round1 = x => Math.round(x * 10) / 10;
const roundHalfAway = x => x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
function playingHcp(hi, slope, rating, holes, allowance) {
  const nine = holes.length === 9;
  const par = holes.reduce((a, h) => a + h.par, 0);
  const idx = nine ? round1(hi / 2) : hi;
  const cr = nine ? rating / 2 : rating;
  const ch = idx * slope / 113 + (cr - par);
  return roundHalfAway(ch * (allowance || 100) / 100);
}

/* ======================================================================= */
const pause = (page, ms) => page.waitForTimeout(ms || 220);
async function tap(page, sel) {
  try { await page.locator(sel).first().click(); }
  catch (e) {
    const where = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.modal-overlay.open')].map(x => x.id
        + ' "' + x.innerText.replace(/\s+/g, ' ').slice(0, 120) + '"');
      const a = document.querySelector('.tab.active');
      return (m.length ? 'modal ' + m.join(',') + ' over ' : '') + (a ? a.id + ': ' + a.innerText.replace(/\s+/g, ' ').slice(0, 90) : '?');
    }).catch(() => '?');
    throw new Error('could not tap ' + sel + ' — on screen: ' + where);
  }
  await pause(page);
}
const trips = page => page.evaluate(() => (S.events || []).filter(e => e.type === 'trip')
  .map(e => JSON.parse(JSON.stringify(e))));
const tripNow = async (page) => {
  const id = await page.evaluate(() => S.activeTripId);
  return (await trips(page)).find(t => t.id === id);
};
const expect = (c, m) => { if (!c) throw new Error(m); };
/* TRIPS_SHOTS=1 photographs the trip screens worth a look into shots-trips/ (never pushed). */
async function shot(page, name) {
  if (!process.env.TRIPS_SHOTS) return;
  const dir = require('path').join(DIR, 'shots-trips'); require('fs').mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: require('path').join(dir, name + '.png') }).catch(() => {});
}

async function step(ctx, name, fn) {
  let said = '';
  const extra = [];
  try { said = (await fn()) || ''; }
  catch (e) {
    extra.push((e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 300));
    await ctx.page.evaluate(() => document.querySelectorAll('.modal-overlay.open')
      .forEach(m => m.classList.remove('open'))).catch(() => {});
  }
  ctx.rep.end(name + (said ? ' — ' + said : ''), extra);
}

async function goHub(page) {
  await page.evaluate(() => { tripGoScreen('hub'); }); await pause(page, 300);
}
async function hubCard(page, screen) {
  await goHub(page);
  await tap(page, `[onclick="tripGoScreen('${screen}')"]`);
}

/* Build a trip through the screens. */
async function createTrip(page, dest, start, end, pids, courseIds) {
  await page.click('#tab-home'); await pause(page);
  await tap(page, '#homeGrid [onclick="launchEvent(\'trip\')"]');
  // The list offers "+ Create a Trip" when empty and "+ New Trip" once one exists.
  await page.evaluate(() => tripGoScreen('list')); await pause(page);
  await page.locator('button').filter({ hasText: /\+ (Create a|New) Trip/ }).first().click(); await pause(page);
  await page.fill('#ttm-dest', dest);
  await page.fill('#ttm-start', start);
  await page.fill('#ttm-end', end);
  await tap(page, '#tripModal button:has-text("Save")');
  await hubCard(page, 'roster');
  for (const p of pids) { await page.check(`input[onchange*="tripRosterToggle('${p}'"]`); await pause(page, 60); }
  await hubCard(page, 'courses');
  for (const c of courseIds) { await page.check(`input[onchange*="tripToggleCourse('${c}'"]`); await pause(page, 80); }
}

async function addRound(page, dayIdx, o) {
  await hubCard(page, 'schedule');
  await tap(page, `[onclick="tripOpenRoundModal(${dayIdx},null)"]`);
  await page.fill('#rm-label', o.label);
  await page.selectOption('#rm-course', o.course);
  await page.selectOption('#rm-format', o.format); await pause(page, 120);
  await page.selectOption('#rm-nine', o.nine || 'all');
  if (o.twoMan) {
    await page.selectOption('#rm-twoman', o.twoMan.game); await pause(page, 80);
    if (o.twoMan.sfMode) await page.selectOption('#rm-twoman-sf', o.twoMan.sfMode);
  }
  // A toggle switch: the checkbox is hidden under its slider, so tap the switch.
  if (o.champ) { await page.locator('label.switch:has(#rm-champ)').click(); await pause(page, 80); }
  for (const tt of o.tts || []) {
    await page.fill('#rm-newtt', tt);
    await tap(page, '#roundModal button:has-text("+ Add")');
  }
  await shot(page, 'round-form-' + o.label.replace(/\W+/g, '-'));
  await tap(page, '#roundModal button:has-text("Save")');
}

async function pairRound(page, dayIdx, rndIdx) {
  await hubCard(page, 'pairings');
  await tap(page, `[onclick="tripOpenPairingRound(${dayIdx},${rndIdx})"]`);
  await tap(page, '[onclick="tripGenerateGroups()"]');
  await tap(page, 'button:has-text("Save ✓")');
}

/* Score every group of a round in the app, typing each box like a thumb:
   set the value and fire the box's own oninput. Returns what was typed. */
async function scoreRound(page, dayIdx, rndIdx, roundKey, onlyGroups) {
  await goHub(page);
  await page.evaluate(([d, r]) => tripStartScoring(d, r), [dayIdx, rndIdx]); await pause(page, 500);
  const t = await tripNow(page);
  const r = t.days[Object.keys(t.days).sort()[dayIdx]].rounds[rndIdx];
  const c = [C1, C2].find(x => x.id === r.courseId);
  const typed = {};
  for (let gi = 0; gi < r.groups.length; gi++) {
    if (onlyGroups && onlyGroups.indexOf(gi) < 0) continue;
    if (r.groups.length > 1) { await page.evaluate(i => tripNavGroup(i), gi); await pause(page, 300); }
    const boxes = await page.evaluate(() => [...document.querySelectorAll('#trip-scoring-body input[type=text]')]
      .map(i => ({ pid: i.dataset.tpid || null, key: i.dataset.tgrpkey || null, hole: +i.dataset.hole })));
    expect(boxes.length, 'group ' + (gi + 1) + ' shows no score boxes');
    for (const b of boxes) {
      const par = c.holes[b.hole - 1].par;
      const v = b.pid ? grossFor(b.pid, b.hole, par, roundKey) : par;
      if (b.pid) { (typed[b.pid] = typed[b.pid] || {})[b.hole] = v; }
      await page.evaluate(([sel, val]) => {
        const i = document.querySelector(sel); i.value = String(val);
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }, [b.pid ? `#trip-scoring-body input[data-tpid="${b.pid}"][data-hole="${b.hole}"]`
                : `#trip-scoring-body input[data-tgrpkey="${b.key}"][data-hole="${b.hole}"]`, v]);
    }
    await pause(page, 150);
  }
  return typed;
}
async function saveRound(page) {
  await tap(page, 'button:has-text("Results →")');
  await tap(page, 'button:has-text("💾 Save")');
}

/* The trip leaderboard as the screen shows it: [name, net] in order. */
async function boardOnScreen(page) {
  await hubCard(page, 'results');
  return page.evaluate(() => {
    const h = [...document.querySelectorAll('.tab.active *')].find(e => /^Trip Leaderboard$/i.test(e.textContent.trim()));
    if (!h) return null;
    let el = h.nextElementSibling;
    while (el && el.tagName !== 'TABLE') el = el.nextElementSibling;
    if (!el) return [];
    return [...el.querySelectorAll('tbody tr')].map(tr => {
      const td = [...tr.querySelectorAll('td')].map(x => x.textContent.trim());
      return { pos: td[0], name: td[1], net: td[2] === '—' ? null : Number(td[2]), rnds: Number(td[3]) };
    });
  });
}

/* The trip standings worked out here, from the stored scores. */
function expectedBoard(t, players) {
  const net = {}, cb = {};
  const allow = (t.settings && t.settings.strokeAllowance) || 100;
  Object.keys(t.days || {}).sort().forEach(d => (t.days[d].rounds || []).forEach(r => {
    if (!r.completed || !['stroke', 'stableford'].includes(r.format)) return;
    const c = [C1, C2].find(x => x.id === r.courseId);
    const holes = r.nineMode === 'front' ? c.holes.slice(0, 9) : r.nineMode === 'back' ? c.holes.slice(9) : c.holes;
    const groupPids = new Set((r.groups || []).flatMap(g => g.playerIds || []));
    players.filter(p => groupPids.has(p.id)).forEach(p => {
      const sc = (r.scores || {})[p.id] || {};
      if (!holes.every(h => sc[h.num] != null)) return;
      const gross = holes.reduce((a, h) => a + Number(sc[h.num]), 0);
      const hi = t.lockedHcps && t.lockedHcps[p.id] != null ? t.lockedHcps[p.id] : p.hcp;
      const tee = r.playerTees && r.playerTees[p.id] && (c.tees || []).find(x => x.id === r.playerTees[p.id]);
      const ph = playingHcp(hi, tee ? tee.slope : c.slope, tee ? tee.rating : c.rating, holes, allow);
      net[p.id] = (net[p.id] || 0) + gross - ph;
      // Countback on the last nine/six/three/one, net of the strokes each hole gets.
      const scale = holes.length;
      const strokes = h => {
        const a = Math.abs(ph), k = Math.floor(a / scale), extra = a % scale;
        return ph >= 0 ? k + (h.hcp <= extra ? 1 : 0) : -(k + (h.hcp > scale - extra ? 1 : 0));
      };
      const rank = (r.nineMode === 'front' || r.nineMode === 'back')
        ? h => (holes.slice().sort((x, y) => x.hcp - y.hcp).indexOf(h) + 1) : h => h.hcp;
      const nets = holes.map(h => Number(sc[h.num]) - strokes({ hcp: rank(h) }));
      const tail = n => nets.slice(-n).reduce((a, b) => a + b, 0);
      const c0 = cb[p.id] || [0, 0, 0, 0];
      cb[p.id] = [c0[0] + tail(9), c0[1] + tail(6), c0[2] + tail(3), c0[3] + tail(1)];
    });
  }));
  return Object.keys(net).map(pid => ({ pid, name: players.find(p => p.id === pid).name, net: net[pid], cb: cb[pid] }))
    .sort((a, b) => a.net - b.net || a.cb[0] - b.cb[0] || a.cb[1] - b.cb[1] || a.cb[2] - b.cb[2] || a.cb[3] - b.cb[3]);
}
/* The day's 2-man result, worked here: teams A/B on each foursome by playing
   handicap (A1+B2 / A2+B1 unless re-paired), nets with WHS strokes (re-ranked
   on a nine), best ball against par or Stableford points. */
const SF_PTS = d => d <= -3 ? 8 : d === -2 ? 4 : d === -1 ? 2 : d === 0 ? 1 : 0;
function expectedTwoMan(t, r) {
  const c = [C1, C2].find(x => x.id === r.courseId);
  const allow = (t.settings && t.settings.strokeAllowance) || 100;
  const holes = r.nineMode === 'front' ? c.holes.slice(0, 9) : r.nineMode === 'back' ? c.holes.slice(9) : c.holes;
  const order = holes.slice().sort((a, b) => a.hcp - b.hcp);
  const rate = h => holes.length === 9 ? order.indexOf(h) + 1 : h.hcp;
  const ph = {};
  (r.groups || []).flatMap(g => g.playerIds).forEach(pid => {
    const hi = t.lockedHcps && t.lockedHcps[pid] != null ? t.lockedHcps[pid] : PLAYERS.find(p => p.id === pid).hcp;
    ph[pid] = playingHcp(hi, c.slope, c.rating, holes, allow);
  });
  const strokes = (chv, rating) => {
    const n = holes.length, a = Math.abs(chv), k = Math.floor(a / n), x = a % n;
    return chv >= 0 ? k + (rating <= x ? 1 : 0) : -(k + (rating > n - x ? 1 : 0));
  };
  const teams = [];
  (r.groups || []).forEach((g, gi) => {
    const ids = g.playerIds.slice().sort((a, b) => ph[a] - ph[b] || (a < b ? -1 : 1));
    if (ids.length !== 4) return;
    const [a1, a2, b1, b2] = ids;
    const opts = [[[a1, b2], [a2, b1]], [[a1, b1], [a2, b2]], [[a1, a2], [b1, b2]]];
    opts[((r.pairPick || {})[gi] || 0) % 3].forEach(x => teams.push(x));
  });
  const game = r.twoMan.game, agg = r.twoMan.sfMode === 'aggregate';
  const last = pid => PLAYERS.find(p => p.id === pid).name.split(' ').slice(-1)[0];
  return teams.map(pids => {
    let tot = 0, par = 0;
    holes.forEach(h => {
      const nets = pids.map(pid => Number(r.scores[pid][h.num]) - strokes(ph[pid], rate(h)));
      par += h.par;
      if (game === 'bestball') tot += Math.min(...nets);
      else { const pts = nets.map(n => SF_PTS(n - h.par)); tot += agg ? pts[0] + pts[1] : Math.max(...pts); }
    });
    return { name: pids.map(last).join(' / '), score: game === 'bestball' ? tot - par : tot };
  }).sort((a, b) => game === 'bestball' ? a.score - b.score : b.score - a.score);
}
async function twoManOnScreen(page) {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll('.tab.active *')]
      .find(e => e.children.length === 0 && /^2-Man (Best Ball|Stableford)/.test(e.textContent.trim()));
    if (!h) return null;
    let el = h.nextElementSibling; while (el && el.tagName !== 'TABLE') el = el.nextElementSibling;
    return el ? [...el.querySelectorAll('tbody tr')].map(tr => {
      const td = [...tr.querySelectorAll('td')].map(x => x.textContent.trim());
      return { name: td[1], score: td[2] };
    }) : [];
  });
}
const shown2 = (game, n) => game === 'bestball' ? (n === 0 ? 'E' : n > 0 ? '+' + n : '' + n) : n + ' pts';
function compareBoards(want, got) {
  const out = [];
  if (!got) return ['no Trip Leaderboard on the Results screen'];
  if (got.length !== want.length) out.push('the board has ' + got.length + ' rows, expected ' + want.length);
  want.forEach((w, i) => {
    const g = got[i];
    if (!g) return;
    if (g.name !== w.name || g.net !== w.net) {
      const at = got.find(x => x.name === w.name);
      out.push('#' + (i + 1) + ' should be ' + w.name + ' net ' + w.net + '; screen shows ' + g.name + ' ' + g.net
        + (at ? ' (' + w.name + ' shown at net ' + at.net + ')' : ''));
    }
  });
  return out.slice(0, 6);
}

/* ======================================================================= */
async function main() {
  const indexFile = path.resolve(process.env.WALK_INDEX || path.join(DIR, 'index.html'));
  const rep = reporter('trips');
  console.log('  · trips: ' + path.relative(process.cwd(), indexFile) + ' in chromium at 390x844');
  const store = fake.createStore({ 'bz-apps': { golf: { [UID]: { state: seed() } } } },
    { getDelay: p => (p === STATE_PATH ? 150 : 0) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(5000);
  await wire(context, store, rep, indexFile);
  await context.addInitScript(fake.userInit({ uid: UID, email: 'trip@example.com', displayName: 'Trip Tester' }));
  const page = await context.newPage();
  const ctx = { rep, page };
  listen(page, rep);
  await page.goto(ORIGIN + '/index.html');
  await page.waitForFunction(() => window._fbLoaded === true || (typeof _fbLoaded !== 'undefined' && _fbLoaded), null, { timeout: 8000 })
    .catch(() => {});
  await pause(page, 800);

  /* ================= TRIP 1: Pinehurst, 12 players, stroke + Stableford ===== */
  const T1 = PLAYERS.slice(0, 12).map(p => p.id);
  await step(ctx, 'Trip 1: create Pinehurst, twelve players, two courses', async () => {
    await createTrip(page, 'Pinehurst', '2026-10-15', '2026-10-17', T1, ['c1', 'c2']);
    const t = await tripNow(page);
    expect(t && t.destination === 'Pinehurst', 'the trip was not created');
    expect((t.players || []).length === 12, 'roster holds ' + (t.players || []).length + ', expected 12');
    expect((t.courseIds || []).length === 2, 'courses: ' + JSON.stringify(t.courseIds));
    return '12 players, 2 courses';
  });
  await step(ctx, 'Trip 1: schedule - day 1 stroke + afternoon Stableford front nine, day 2 Stableford, day 3 championship', async () => {
    await addRound(page, 0, { label: 'Day 1 AM', course: 'c1', format: 'stroke', tts: ['08:00', '08:10', '08:20'] });
    await addRound(page, 0, { label: 'Day 1 PM', course: 'c1', format: 'stableford', nine: 'front', tts: ['13:00', '13:10', '13:20'] });
    await addRound(page, 1, { label: 'Day 2', course: 'c2', format: 'stableford', tts: ['08:30', '08:40', '08:50'] });
    await addRound(page, 2, { label: 'Championship', course: 'c2', format: 'stroke', champ: true, tts: ['09:00', '09:10', '09:20'] });
    const t = await tripNow(page);
    const days = Object.keys(t.days).sort();
    const shape = days.map(d => t.days[d].rounds.map(r => r.format + (r.nineMode !== 'all' ? '/' + r.nineMode : '')
      + (r.championship ? '/champ' : '') + '/' + r.teeTimes.length + 'tt').join('+')).join(' | ');
    expect(shape === 'stroke/3tt+stableford/front/3tt | stableford/3tt | stroke/champ/3tt', 'schedule saved as ' + shape);
    return shape;
  });

  const played = [];   // [dayIdx, rndIdx, roundKey]
  async function playRound(label, d, r, key) {
    await step(ctx, label + ': pair, score every group, save', async () => {
      await pairRound(page, d, r);
      const t0 = await tripNow(page);
      const rr = t0.days[Object.keys(t0.days).sort()[d]].rounds[r];
      const sizes = rr.groups.map(g => g.playerIds.length).join('/');
      expect(rr.groups.length === 3 && sizes === '4/4/4', 'groups came out ' + sizes);
      const typed = await scoreRound(page, d, r, key);
      await saveRound(page);
      const t = await tripNow(page);
      const rs = t.days[Object.keys(t.days).sort()[d]].rounds[r];
      expect(rs.completed, 'the round is not marked complete after Save');
      let wrong = 0;
      Object.keys(typed).forEach(pid => Object.keys(typed[pid]).forEach(h => {
        if (Number((rs.scores[pid] || {})[h]) !== typed[pid][h]) wrong++;
      }));
      expect(!wrong, wrong + ' typed scores did not reach the stored round');
      played.push([d, r, key]);
      return Object.keys(typed).length + ' players scored, groups ' + sizes;
    });
  }
  await playRound('Trip 1 day 1 AM (stroke)', 0, 0, 1);
  await step(ctx, 'Trip 1: handicaps locked at the first round', async () => {
    const t = await tripNow(page);
    expect(t.lockedHcps, 'no handicaps were locked when the first round started');
    const off = T1.filter(pid => t.lockedHcps[pid] !== PLAYERS.find(p => p.id === pid).hcp);
    expect(!off.length, 'locked values differ from the index for ' + off.join(', '));
    return '12 locked';
  });
  await step(ctx, 'Trip 1: standings after day 1 AM match the scorecards', async () => {
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);
    const bad = compareBoards(want, await boardOnScreen(page));
    expect(!bad.length, bad.join(' | '));
    return 'led by ' + want[0].name + ' net ' + want[0].net;
  });
  await playRound('Trip 1 day 1 PM (Stableford, front nine)', 0, 1, 2);
  await step(ctx, 'Trip 1: a nine-hole round adds a nine-hole net, not an 18-hole one', async () => {
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);
    const bad = compareBoards(want, await boardOnScreen(page));
    expect(!bad.length, bad.join(' | '));
    return 'led by ' + want[0].name + ' net ' + want[0].net;
  });
  await step(ctx, 'Trip 1: an index change mid-trip does not move the locked standings', async () => {
    await page.evaluate(() => { const p = S.players.find(x => x.id === 'p11'); p.hcp = 4.0; scheduleWrite(); });
    await pause(page, 300);
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);   // uses lockedHcps, so p11 still plays off 15.6
    const bad = compareBoards(want, await boardOnScreen(page));
    expect(!bad.length, bad.join(' | '));
    return 'Chris Davis still plays off his locked 15.6';
  });
  await playRound('Trip 1 day 2 (Stableford, Mid Pines)', 1, 0, 3);
  await step(ctx, 'Trip 1: championship groups set by standing, leaders off last', async () => {
    await pairRound(page, 2, 0);
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);
    const r = t.days[Object.keys(t.days).sort()[2]].rounds[0];
    const last = r.groups[r.groups.length - 1].playerIds.slice().sort().join();
    const top4 = want.slice(0, 4).map(e => e.pid).sort().join();
    const first = r.groups[0].playerIds.slice().sort().join();
    const bottom4 = want.slice(-4).map(e => e.pid).sort().join();
    expect(last === top4, 'the last tee time (' + r.groups[r.groups.length - 1].teetime + ') holds ['
      + r.groups[r.groups.length - 1].playerIds + '], the top four are [' + want.slice(0, 4).map(e => e.pid) + ']');
    expect(first === bottom4, 'the first tee time holds [' + r.groups[0].playerIds + '], the bottom four are ['
      + want.slice(-4).map(e => e.pid) + ']');
    return 'leaders ' + want.slice(0, 4).map(e => e.name.split(' ')[1]).join('/') + ' at ' + r.groups[r.groups.length - 1].teetime;
  });

  /* ---- THE CHAMPIONSHIP, LIVE: two groups on their own phones, one in the app. */
  let shareId = null;
  await step(ctx, 'Trip 1 championship: go live - board and one scoring link per group', async () => {
    await hubCard(page, 'results');
    await tap(page, 'button:has-text("Go Live & share links")'); await pause(page, 500);
    const url = await page.locator('#liveShareUrl').innerText();
    shareId = (url.match(/[?&]id=([a-z0-9]+)/) || [])[1];
    expect(shareId, 'no share id in "' + url + '"');
    const links = await page.locator('#liveShareGroups button:has-text("Text")').count();
    expect(links === 3, links + ' scoring links, expected 3');
    await tap(page, '#liveShareModal button:has-text("Done")');
    return 'live/' + shareId;
  });
  const remoteTyped = {};
  await step(ctx, 'score.html: groups 1 and 2 score all 18 holes from their own phones at once', async () => {
    expect(shareId, 'no live round');
    const live = store.read('/bz-apps/golf/live/' + shareId);
    const holes = live.course.holes;
    const phone = async gi => {
      const sp = await context.newPage(); listen(sp, rep);
      await sp.goto(ORIGIN + '/score.html?id=' + shareId + '&g=' + gi);
      await sp.waitForSelector('.prow', { timeout: 6000 });
      const pids = live.groups[gi].players.map(p => p.id);
      for (let h = 0; h < holes.length; h++) {
        for (let k = 0; k < pids.length; k++) {
          const want = grossFor(pids[k], holes[h].num, holes[h].par, 4);
          const row = sp.locator('.prow').nth(k);
          let cur = null;
          for (let guard = 0; guard < 12 && cur !== want; guard++) {
            const v = (await row.locator('.val').innerText()).trim();
            cur = /^\d+$/.test(v) ? Number(v) : null;
            if (cur === want) break;
            const base = cur == null ? holes[h].par : cur;
            await row.locator(base < want || (cur == null && want >= holes[h].par) ? 'button:has-text("+")' : 'button:has-text("−")').click();
            await sp.waitForTimeout(40);
            if (cur == null && want === holes[h].par) {   // first tap sets par +/-1; come back to par
              await row.locator('button:has-text("−")').click(); await sp.waitForTimeout(40);
            }
          }
          (remoteTyped[pids[k]] = remoteTyped[pids[k]] || {})[holes[h].num] = want;
        }
        if (h < holes.length - 1) { await sp.locator('button.done').click(); await sp.waitForTimeout(40); }
      }
      await sp.waitForTimeout(600);
      await sp.close();
    };
    await Promise.all([phone(0), phone(1)]);
    const sc = store.read('/bz-apps/golf/live/' + shareId + '/scores') || {};
    let wrong = 0, n = 0;
    Object.keys(remoteTyped).forEach(pid => Object.keys(remoteTyped[pid]).forEach(h => {
      n++; if (Number((sc[pid] || {})[h]) !== remoteTyped[pid][h]) wrong++;
    }));
    expect(!wrong, wrong + ' of ' + n + ' remote scores were not stored as tapped');
    return n + ' scores from two phones';
  });
  await step(ctx, 'the app takes in the remote scores and the third group scores in the app', async () => {
    await page.evaluate(() => liveMonitorPoll()); await pause(page, 800);
    const typed = await scoreRound(page, 2, 0, 4, [2]);
    const t = await tripNow(page);
    const r = t.days[Object.keys(t.days).sort()[2]].rounds[0];
    let missing = 0;
    Object.keys(remoteTyped).forEach(pid => Object.keys(remoteTyped[pid]).forEach(h => {
      if (Number((r.scores[pid] || {})[h]) !== remoteTyped[pid][h]) missing++;
    }));
    expect(!missing, missing + ' remote scores did not reach the round in the app');
    return Object.keys(typed).length + ' scored in the app';
  });
  await step(ctx, 'an organizer correction to a remote score is not overwritten by the next poll', async () => {
    const pid = Object.keys(remoteTyped)[0];
    const was = remoteTyped[pid][1];
    const t0 = await tripNow(page);
    const gi = t0.days[Object.keys(t0.days).sort()[2]].rounds[0].groups.findIndex(g => g.playerIds.indexOf(pid) >= 0);
    await page.evaluate(i => tripNavGroup(i), gi); await pause(page, 300);
    await page.evaluate(([p, v]) => {
      const i = document.querySelector(`#trip-scoring-body input[data-tpid="${p}"][data-hole="1"]`);
      i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true }));
    }, [pid, was + 1]);
    await pause(page, 300);
    await page.evaluate(() => liveMonitorPoll()); await pause(page, 800);
    const t = await tripNow(page);
    const v = Number(t.days[Object.keys(t.days).sort()[2]].rounds[0].scores[pid][1]);
    expect(v === was + 1, 'the organizer typed ' + (was + 1) + ' for hole 1; after the next poll the round holds ' + v
      + ' (the phone\'s ' + was + ')');
    // put it back so the standings below are the tapped ones
    await page.evaluate(([p, v2]) => {
      const i = document.querySelector(`#trip-scoring-body input[data-tpid="${p}"][data-hole="1"]`);
      i.value = String(v2); i.dispatchEvent(new Event('input', { bubbles: true }));
    }, [pid, was]);
    return 'the correction held';
  });
  await step(ctx, 'Trip 1: save the championship; final standings match the scorecards', async () => {
    await saveRound(page);
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);
    const bad = compareBoards(want, await boardOnScreen(page));
    expect(!bad.length, bad.join(' | '));
    return 'champion ' + want[0].name + ' net ' + want[0].net;
  });
  await step(ctx, 'live.html: the public board shows the trip standings in the same order', async () => {
    expect(shareId, 'no live round');
    await page.evaluate(() => scheduleLiveRepublish && scheduleLiveRepublish()); await pause(page, 4800);
    const lp = await context.newPage(); listen(lp, rep);
    await lp.goto(ORIGIN + '/live.html?id=' + shareId);
    await lp.waitForSelector('#board tr', { timeout: 6000 });
    const tabs = await lp.locator('#tabs .tab').allInnerTexts();
    const tripTab = lp.locator('#tabs .tab').filter({ hasText: /^Trip$/i });
    expect(await tripTab.count(), 'the live board has no Trip tab (tabs: ' + tabs.join('/') + ')');
    await tripTab.first().click(); await lp.waitForTimeout(300);
    const names = (await lp.locator('#board tr td.name').allInnerTexts()).map(s => s.trim());
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS).map(e => e.name);
    await lp.close();
    expect(names.length === want.length, 'the live Trip view lists ' + names.length + ', expected ' + want.length
      + ' (views: ' + tabs.join('/') + ')');
    const firstOff = want.findIndex((n, i) => names[i] !== n);
    expect(firstOff < 0, 'live board #' + (firstOff + 1) + ' is ' + names[firstOff] + ', the standings say ' + want[firstOff]);
    return names.length + ' rows, led by ' + names[0];
  });

  /* ================= TRIP 2: eight players, team formats + a stroke day ==== */
  const T2 = ['p2', 'p4', 'p6', 'p8', 'p10', 'p12', 'p14', 'p16'];
  await step(ctx, 'Trip 2: a second trip - eight players, scramble, 2 best balls, stroke', async () => {
    await createTrip(page, 'Myrtle Beach', '2026-11-05', '2026-11-07', T2, ['c1']);
    await addRound(page, 0, { label: 'Scramble', course: 'c1', format: 'scramble', tts: ['10:00', '10:10'] });
    await addRound(page, 1, { label: 'Best 2', course: 'c1', format: 'best2', tts: ['10:00', '10:10'] });
    await addRound(page, 2, { label: 'Stroke', course: 'c1', format: 'stroke', tts: ['10:00', '10:10'] });
    const t = await tripNow(page);
    expect((t.players || []).length === 8, 'roster ' + (t.players || []).length);
    return 'Myrtle Beach';
  });
  for (const [d, label] of [[0, 'scramble'], [1, '2 best balls'], [2, 'stroke']]) {
    await step(ctx, 'Trip 2 ' + label + ': pair, score, save', async () => {
      await pairRound(page, d, 0);
      await scoreRound(page, d, 0, 10 + d);
      await saveRound(page);
      const t = await tripNow(page);
      const r = t.days[Object.keys(t.days).sort()[d]].rounds[0];
      expect(r.completed, 'not complete after Save');
      return r.groups.length + ' groups';
    });
  }
  await step(ctx, 'Trip 2: standings - stroke day by net, team days tallied', async () => {
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);
    const got = await boardOnScreen(page);
    const bad = compareBoards(want, (got || []).filter(r => r.net !== null));
    expect(!bad.length, bad.join(' | '));
    return want.length + ' ranked on the stroke day';
  });
  await step(ctx, 'Trip 1 is still intact after Trip 2 was played', async () => {
    const all = await trips(page);
    const t1 = all.find(t => t.destination === 'Pinehurst');
    const n = Object.values(t1.days).reduce((a, d) => a + d.rounds.filter(r => r.completed).length, 0);
    expect(n === 4, 'Pinehurst shows ' + n + ' completed rounds, expected 4');
    return '4 rounds kept';
  });

  /* ================= TRIP 4: daily 2-man games over the trip ============== */
  const T4 = ['p3', 'p5', 'p6', 'p9', 'p11', 'p12', 'p13', 'p15'];
  await step(ctx, 'Trip 4: eight players; day 1 stroke + 2-man best ball, day 2 Stableford + 2-man Stableford (both added)', async () => {
    await createTrip(page, 'Kiawah', '2027-03-10', '2027-03-11', T4, ['c2']);
    await addRound(page, 0, { label: 'Day 1', course: 'c2', format: 'stroke', tts: ['08:00', '08:10'], twoMan: { game: 'bestball' } });
    await addRound(page, 1, { label: 'Day 2', course: 'c2', format: 'stableford', tts: ['08:00', '08:10'], twoMan: { game: 'stableford', sfMode: 'aggregate' } });
    const t = await tripNow(page);
    const rs = Object.keys(t.days).sort().map(d => t.days[d].rounds[0].twoMan);
    expect(rs[0] && rs[0].game === 'bestball', 'day 1 saved its 2-man game as ' + JSON.stringify(rs[0]));
    expect(rs[1] && rs[1].game === 'stableford' && rs[1].sfMode === 'aggregate', 'day 2 saved ' + JSON.stringify(rs[1]));
    return 'best ball, Stableford (both added)';
  });
  await step(ctx, 'Trip 4: the groups screen shows the teams, and Re-pair steps through the pairings', async () => {
    await pairRound(page, 0, 0);
    await hubCard(page, 'pairings');
    await tap(page, '[onclick="tripOpenPairingRound(0,0)"]');
    const before = await page.locator('.tab.active').innerText();
    expect(/2-MAN BEST BALL TEAMS/.test(before), 'no 2-man teams card on the groups screen');
    const line = async () => (await page.locator('.tab.active div:has(> button:has-text("Re-pair"))').first().innerText())
      .replace(/Re-pair/, '').trim();
    const a = await line();
    await tap(page, 'button:has-text("Re-pair")'); const b = await line();
    await tap(page, 'button:has-text("Re-pair")'); const c2 = await line();
    await tap(page, 'button:has-text("Re-pair")'); const d = await line();
    expect(a !== b && b !== c2 && a !== c2, 'Re-pair did not give three different pairings: ' + [a, b, c2].join(' | '));
    expect(d === a, 'a third Re-pair should come back to the first pairing; got ' + d);
    await shot(page, 'groups-2man-teams');
    await tap(page, 'button:has-text("Save ✓")');
    return a;
  });
  for (const [d, key, label] of [[0, 21, 'day 1 (2-man best ball)'], [1, 22, 'day 2 (2-man Stableford, both added)']]) {
    await step(ctx, 'Trip 4 ' + label + ': score, and the 2-man result matches the cards', async () => {
      if (d === 1) await pairRound(page, 1, 0);
      await scoreRound(page, d, 0, key);
      await tap(page, 'button:has-text("Results →")');
      const t = await tripNow(page);
      const r = t.days[Object.keys(t.days).sort()[d]].rounds[0];
      const want = expectedTwoMan(t, r);
      const got = await twoManOnScreen(page);
      await page.evaluate(() => { const b = document.querySelector('.tab.active .fs-scr-body'); if (b) b.scrollTop = b.scrollHeight; });
      await shot(page, 'results-2man-day' + (d + 1));
      expect(got, 'no 2-man section on the round results');
      expect(got.length === want.length, got.length + ' teams shown, expected ' + want.length);
      const bad = want.map((w, i) => (got[i] && got[i].name === w.name && got[i].score === shown2(r.twoMan.game, w.score)) ? null
        : '#' + (i + 1) + ' should be ' + w.name + ' ' + shown2(r.twoMan.game, w.score) + ', shown '
          + (got[i] ? got[i].name + ' ' + got[i].score : 'nothing')).filter(Boolean);
      expect(!bad.length, bad.join(' | '));
      await tap(page, 'button:has-text("💾 Save")');
      return want.map(w => w.name + ' ' + shown2(r.twoMan.game, w.score)).join(', ');
    });
  }
  await step(ctx, 'Trip 4: the 2-man games leave the trip standings as net strokes', async () => {
    const t = await tripNow(page);
    const want = expectedBoard(t, PLAYERS);
    const bad = compareBoards(want, await boardOnScreen(page));
    expect(!bad.length, bad.join(' | '));
    return 'led by ' + want[0].name + ' net ' + want[0].net;
  });
  await step(ctx, 'live.html: a 2-man round publishes a 2-Man tab in the same order', async () => {
    await addRound(page, 1, { label: 'Day 2 PM', course: 'c2', format: 'stroke', tts: ['14:00', '14:10'], twoMan: { game: 'bestball' } });
    await pairRound(page, 1, 1);
    await page.evaluate(() => { const t = tripActive(); const d = Object.keys(t.days).sort()[1]; unitShareLive('trip', t, t.days[d].rounds[1]); });
    await pause(page, 600);
    const url = await page.locator('#liveShareUrl').innerText();
    const sid = (url.match(/[?&]id=([a-z0-9]+)/) || [])[1];
    await tap(page, '#liveShareModal button:has-text("Done")');
    await scoreRound(page, 1, 1, 23);
    await page.evaluate(() => scheduleWrite()); await pause(page, 4800);
    const t = await tripNow(page);
    const r = t.days[Object.keys(t.days).sort()[1]].rounds[1];
    const want = expectedTwoMan(t, r).map(w => w.name);
    const lp = await context.newPage(); listen(lp, rep);
    await lp.goto(ORIGIN + '/live.html?id=' + sid);
    await lp.waitForSelector('#board tr', { timeout: 6000 });
    const tab = lp.locator('#tabs .tab').filter({ hasText: /^2-Man$/ });
    expect(await tab.count(), 'no 2-Man tab on the live board');
    await tab.first().click(); await lp.waitForTimeout(300);
    const names = (await lp.locator('#board tr td.name').allInnerTexts()).map(x => x.trim());
    await lp.close();
    expect(names.join() === want.join(), 'live 2-Man shows [' + names.join(', ') + '], expected [' + want.join(', ') + ']');
    await saveRound(page);
    return names.length + ' teams, led by ' + names[0];
  });

  /* ================= TRIP 3: the edges ===================================== */
  const T3 = ['p1', 'p2', 'p7', 'p9'];
  await step(ctx, 'Trip 3: four players with a plus handicap; a reload in the middle of a round', async () => {
    await createTrip(page, 'Bandon', '2026-12-01', '2026-12-02', T3, ['c1']);
    await addRound(page, 0, { label: 'R1', course: 'c1', format: 'stroke', tts: ['08:00'] });
    await pairRound(page, 0, 0);
    await page.evaluate(() => tripStartScoring(0, 0)); await pause(page, 500);
    // nine holes typed, then the phone reloads
    await page.evaluate(() => [...document.querySelectorAll('#trip-scoring-body input[type=text]')]
      .filter(i => +i.dataset.hole <= 9).forEach(i => { i.value = '4'; i.dispatchEvent(new Event('input', { bubbles: true })); }));
    await pause(page, 2600);   // the debounced write
    await page.reload(); await pause(page, 1500);
    const t = await tripNow(page);
    const r = t.days[Object.keys(t.days).sort()[0]].rounds[0];
    const kept = Object.values(r.scores || {}).reduce((a, h) => a + Object.keys(h).length, 0);
    expect(kept === 36, kept + ' of 36 front-nine scores survived the reload');
    const resume = await page.locator('text=/REJOIN|RESUME/i').count();
    expect(resume, 'nothing on screen offers to resume the round after the reload');
    return '36 kept, resume offered';
  });
  await step(ctx, 'Trip 3: a card saved with holes missing does not total lower than a full one', async () => {
    // After the reload the app asks "Resume scoring R1 — Bandon?": take it, as a person would.
    if (await page.evaluate(() => document.getElementById('confirmModal').classList.contains('open'))) {
      await tap(page, '#confirmModal button:has-text("Confirm")'); await pause(page, 500);
    } else {
      await page.evaluate(() => tripStartScoring(0, 0)); await pause(page, 500);
    }
    // back nine for three players only; p9 is left with nine holes
    await page.evaluate(() => [...document.querySelectorAll('#trip-scoring-body input[type=text]')]
      .filter(i => +i.dataset.hole > 9 && i.dataset.tpid !== 'p9')
      .forEach(i => { i.value = '4'; i.dispatchEvent(new Event('input', { bubbles: true })); }));
    await pause(page, 300);
    await saveRound(page);
    const got = await boardOnScreen(page);
    const p9 = (got || []).find(r => r.name === 'Ryan Caito');
    const leader = (got || [])[0];
    expect(!p9 || p9 !== leader, 'Ryan Caito, nine holes short, leads the trip at net ' + (p9 && p9.net));
    return p9 ? 'Caito shown at ' + p9.net + ' (' + (got.indexOf(p9) + 1) + ' of ' + got.length + ')' : 'Caito not ranked';
  });

  /* ---- THE ONE-TAP TEST, as BZ will use it from Settings. */
  await step(ctx, 'Settings: Test live scoring builds a trip, goes live, and a phone link saves a score', async () => {
    await page.click('#tab-settings'); await pause(page, 300);
    await tap(page, 'button:has-text("Test live scoring")'); await pause(page, 600);
    const url = await page.locator('#liveShareUrl').innerText();
    const sid = (url.match(/[?&]id=([a-z0-9]+)/) || [])[1];
    expect(sid, 'the share sheet did not open with a live link');
    const links = await page.locator('#liveShareGroups button:has-text("Text")').count();
    expect(links === 1, links + ' scoring links, expected 1 (one group)');
    await tap(page, '#liveShareModal button:has-text("Done")');
    const t = await tripNow(page);
    expect(t && t.destination === 'Test Trip' && t.players.length === 4, 'no 4-player Test Trip was made');
    const live = store.read('/bz-apps/golf/live/' + sid);
    const sp = await context.newPage(); listen(sp, rep);
    await sp.goto(ORIGIN + '/score.html?id=' + sid + '&g=0');
    await sp.waitForSelector('.prow', { timeout: 6000 });
    await sp.locator('.prow').first().locator('button:has-text("+")').click();
    await sp.waitForFunction(() => /Saved/.test(document.getElementById('saved').textContent), null, { timeout: 4000 });
    await sp.close();
    const pid = live.groups[0].players[0].id;
    const par1 = live.course.holes[0].par;
    const saved = store.read('/bz-apps/golf/live/' + sid + '/scores/' + pid + '/1');
    expect(saved === par1 + 1, 'the phone saved ' + saved + ' for hole 1, expected par + 1 = ' + (par1 + 1));
    await page.evaluate(() => liveMonitorPoll()); await pause(page, 800);
    const t2 = await tripNow(page);
    const got = Number(Object.values(t2.days)[0].rounds[0].scores[pid][1]);
    expect(got === par1 + 1, 'the app shows ' + got + ' for hole 1 after the poll');
    return 'Test Trip live, hole 1 = ' + saved + ' from the phone, in the app';
  });

  /* ---- AND ON EVERY STEP: the app never wrote before its first load. */
  await step(ctx, 'nothing was written to the database before the first load', async () => {
    const firstLoad = store.log.find(e => e.op === 'get' && e.path === STATE_PATH && e.servedSeq);
    const early = store.log.filter(e => e.op === 'put' && e.path === STATE_PATH && firstLoad && e.seq < firstLoad.servedSeq);
    expect(!early.length, early.length + ' writes before the load');
    return store.log.filter(e => e.op === 'put' && e.path === STATE_PATH).length + ' writes, all after';
  });

  await browser.close();
  return rep.summary();
}

main().then(code => process.exit(code))
  .catch(e => { console.log('  ✖ trips.js threw: ' + (e.stack || e.message)); process.exit(1); });
