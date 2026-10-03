/* The shared walk: MadGolf loaded UNMODIFIED in a real browser engine, signed
 * in against an in-memory Firebase, driven along the routes a person takes.
 *
 * browser.js runs it in Chromium, ios.js in WebKit at iPhone size. Each step
 * prints one line as it lands; a failure carries ✖ and the reasons under it.
 * The last line is `  ✓ <tag> passed: <N> steps in <S>s` only when every step
 * passed, and run() resolves to the exit code.
 *
 * NOTHING HERE MAY REACH THE NETWORK. Every request is served from the project
 * folder (on the fake origin http://app.local/), answered by a stub, or
 * refused - and a refused request fails the step it happened in, by URL. The
 * database is fake-firebase.js, in this process. No run can touch the real one.
 *
 * On every step: a page error, an unhandled rejection, a console.error, an
 * unrouted request, or the page being wider than the screen fails the step.
 *
 *   WALK_INDEX=path/to/index.html   walk a copy instead of ./index.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fake = require('./fake-firebase.js');

const DIR = __dirname;
const ORIGIN = 'http://app.local';
const UID = 'walkuid0000000000000000000001';
const STATE_PATH = '/bz-apps/golf/' + UID + '/state';
const SLACK = 1;   // px of sub-pixel rounding allowed on width

/* ---- THE SEED: what a signed-in account already holds when it loads.
   Shapes follow madgolf-test.js's SMOKE_* fixtures and normalizeState. */
function seedState() {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5];
  const holes = Array.from({ length: 18 }, (_, i) => ({
    num: i + 1, par: pars[i % 9], hcp: ((i * 7) % 18) + 1, hcpRating: ((i * 7) % 18) + 1, yards: 380 }));
  const course = { id: 'c1', name: 'Walk Hills CC', slope: 125, rating: 71.4,
    par: holes.reduce((a, h) => a + h.par, 0), nineHole: false, homeCourse: true, holes,
    tees: [{ name: 'White', slope: 125, rating: 71.4 }] };
  const names = ['Brian Zrimsek', 'Kevin Blood', 'Ryan Caito', 'Chris Davis',
    'Mike Hale', 'Tom Price', 'Joe Novak', 'Sam Ortiz'];
  const hcps = [5.2, 8.1, 12.3, 15.6, 3.4, 20.1, 10.0, 7.7];
  const players = names.map((n, i) => ({ id: 'p' + (i + 1), name: n, hcp: hcps[i], ghin: '', regular: true }));
  return { account: { name: 'Walk Tester', email: 'walk@example.com', photoURL: '', createdAt: 1 },
    players, courses: [course], events: [], activeOutingId: null, activeTripId: null, activeRound: null,
    config: { ghinProxyUrl: 'https://ghin-proxy.brianzrimsek.workers.dev', myPlayerId: 'p1', log: [] } };
}
/* The score the walk enters for player pN on hole h: 3..6, varied by player
   and hole so totals differ and results have a winner. */
const scoreFor = (pid, h) => 3 + ((parseInt(String(pid).replace(/\D/g, ''), 10) * 3 + h) % 4);
const grossFor = (pid, holes) => holes.reduce((a, h) => a + scoreFor(pid, h), 0);
const H18 = Array.from({ length: 18 }, (_, i) => i + 1);

/* Hosts the app reaches that are not Firebase. Each is answered by a stub and
   logged. GHIN is never driven (ghinFetch is undefined in index.html). */
const STUB_HOSTS = [
  [/^https:\/\/fonts\.googleapis\.com\//, { contentType: 'text/css', body: '/* fonts stubbed */' }],
  [/^https:\/\/fonts\.gstatic\.com\//, { contentType: 'font/woff2', body: '' }],
  [/^https:\/\/ghin-proxy\.brianzrimsek\.workers\.dev\//, { contentType: 'application/json', body: '{}' }],
  [/^https:\/\/course-proxy\.brianzrimsek\.workers\.dev\//, { contentType: 'application/json', body: '[]' }],
  [/^https:\/\/course\.bluegolf\.com\//, { contentType: 'text/html', body: '' }],
];

const typeOf = n => n.endsWith('.json') ? 'application/json' : n.endsWith('.js') ? 'text/javascript'
  : n.endsWith('.webp') ? 'image/webp' : n.endsWith('.png') ? 'image/png' : 'text/html';

/* ---- REPORTING. A fault that arrives between steps is kept and charged to
   the next one rather than dropped. */
function reporter(tag) {
  const t0 = Date.now();
  let steps = 0, failed = 0;
  const r = {
    faults: [],
    fail(m) { r.faults.push(m); },
    end(name, extra) {
      steps++;
      const f = r.faults.splice(0).concat(extra || []);
      if (f.length) {
        failed++;
        console.log('  ✖ ' + name);
        f.slice(0, 8).forEach(x => console.log('      ✖ ' + String(x).split('\n')[0].slice(0, 240)));
        if (f.length > 8) console.log('      … and ' + (f.length - 8) + ' more');
      } else {
        console.log('  ✓ ' + name);
      }
    },
    summary() {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      if (failed) { console.log('  ✖ ' + tag + ' failed: ' + failed + ' of ' + steps + ' steps in ' + s + 's'); return 1; }
      console.log('  ✓ ' + tag + ' passed: ' + steps + ' steps in ' + s + 's');
      return 0;
    }
  };
  return r;
}

/* ---- THE NETWORK. Playwright tries the LAST registered route first, so the
   catch-all goes in first and every specific route after it. */
async function wire(context, store, rep, indexFile) {
  await context.route('**/*', route => {
    const u = route.request().url();
    rep.fail('unrouted network request: ' + route.request().method() + ' ' + u.slice(0, 160));
    return route.abort('blockedbyclient');
  });
  for (const [re, resp] of STUB_HOSTS) {
    await context.route(re, route => {
      store.log.push({ seq: ++store.seq, op: 'stub', path: route.request().url().slice(0, 120) });
      return route.fulfill(Object.assign({ status: 200, headers: { 'access-control-allow-origin': '*' } }, resp));
    });
  }
  await context.route(fake.IDTK_PATTERN, r => store.handleIdentity(r));
  await context.route(fake.SDK_PATTERN, r => fake.serveSdk(r));
  await context.route(new RegExp('^https://' + fake.RTDB_HOST.replace(/\./g, '\\.') + '/'), r => store.handleRest(r));
  await context.route(ORIGIN + '/**', route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1)) || 'index.html';
    const f = name === 'index.html' ? indexFile
      : name === 'live.html' && process.env.WALK_LIVE ? path.resolve(process.env.WALK_LIVE)
      : name === 'score.html' && process.env.WALK_SCORE ? path.resolve(process.env.WALK_SCORE)
      : path.join(DIR, name);
    if (name.includes('..') || !fs.existsSync(f)) {
      rep.fail('404 from the app folder: ' + name);
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 200, contentType: typeOf(name), body: fs.readFileSync(f) });
  });
}

function listen(page, rep) {
  page.on('pageerror', e => rep.fail('pageerror: ' + (e.message || String(e)).split('\n')[0]));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // A refused request is already reported by URL, which says more.
    if (/ERR_BLOCKED_BY_CLIENT|blocked by client/i.test(t)) return;
    rep.fail('console.error: ' + t.slice(0, 200));
  });
}
/* Unhandled promise rejections, reported the same way in both engines. */
const INIT_REJECTIONS = `window.addEventListener('unhandledrejection', e => {
  const r = e.reason; console.error('unhandled rejection: ' + (r && r.message ? r.message : String(r)));
});`;

/* ---- WIDTH. In this app the document never scrolls: body and <main> are
   overflow:hidden and each screen (.tab.active) is overflow-y:auto - which
   makes it scroll SIDEWAYS too. So a too-wide screen does not widen the
   document at all; it slides inside the tab. Measuring only
   document.scrollingElement passed a 600px element (proved, 2026-10-03).

   So every box a phone shows is measured: the document, body, main, the
   active screen, an open modal, and every vertical scroller inside them. A
   box that DECLARES overflow-x itself (the scorecard wrappers, inline
   style="overflow-x:auto") is a sideways scroller on purpose and is not
   measured; anything else that is wider than it shows is a fault. */
async function overflow(page) {
  return page.evaluate(slack => {
    const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase()
      + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
    const meant = el => /overflow(-x)?\s*:\s*(auto|scroll)/.test(el.getAttribute('style') || '');
    const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const roots = [document.querySelector('.tab.active'), ...document.querySelectorAll('.modal-overlay.open')]
      .filter(Boolean);
    const boxes = new Set([document.scrollingElement || document.documentElement, document.body,
      document.querySelector('main'), ...roots].filter(Boolean));
    roots.forEach(r => r.querySelectorAll('*').forEach(el => {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && !meant(el) && shown(el)) boxes.add(el);
    }));
    const out = [];
    for (const box of boxes) {
      if (meant(box) || box.scrollWidth <= box.clientWidth + slack) continue;
      // The outermost thing inside that reaches past the box's right edge.
      const edge = box === document.documentElement || box === document.scrollingElement
        ? box.clientWidth : box.getBoundingClientRect().left + box.clientWidth;
      let culprit = '';
      for (const el of box.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= edge + slack) continue;
        let a = el.parentElement, held = false;
        for (; a && a !== box; a = a.parentElement) if (meant(a)) { held = true; break; }
        if (held) continue;
        culprit = ' - ' + name(el) + ' is ' + Math.round(r.width) + 'px wide';
        break;
      }
      out.push(name(box) + ' is ' + box.scrollWidth + 'px wide in ' + box.clientWidth + 'px (horizontal overflow)' + culprit);
      if (out.length >= 3) break;
    }
    return out;
  }, SLACK);
}

/* What is on screen: printed under a step that threw, so it says where. */
async function screen(page) {
  return page.evaluate(() => {
    const act = document.querySelector('.tab.active');
    const modal = [...document.querySelectorAll('.modal-overlay.open')].map(m => m.id);
    return (act ? act.id : '?') + (modal.length ? ' + modal ' + modal.join(',') : '') + ': '
      + (act ? act.innerText : document.body.innerText).replace(/\s+/g, ' ').slice(0, 160);
  }).catch(() => '(page gone)');
}

async function step(ctx, name, fn) {
  const { rep } = ctx;
  const extra = [];
  let said = '';
  try {
    said = (await fn()) || '';
  } catch (e) {
    extra.push('threw: ' + (e && e.message ? e.message.split('\n')[0] : String(e)).slice(0, 200));
    if (ctx.page) {
      extra.push('on screen: ' + await screen(ctx.page));
      // Close whatever the failure left open, so the next step is judged on
      // its own screen rather than failing behind this one's modal.
      await ctx.page.evaluate(() => document.querySelectorAll('.modal-overlay.open')
        .forEach(m => m.classList.remove('open'))).catch(() => {});
    }
  }
  if (ctx.page) {
    await ctx.page.waitForTimeout(40);
    try { extra.push(...await overflow(ctx.page)); }
    catch (e) { extra.push('could not measure width: ' + e.message.split('\n')[0]); }
  }
  rep.end(name + (said ? ' — ' + said : ''), extra);
  return !extra.length;
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }

/* ---- HELPERS THAT DRIVE THE APP. */
const pause = (page, ms) => page.waitForTimeout(ms || 250);
async function tap(page, sel) { await page.locator(sel).first().click(); await pause(page); }
const activeText = page => page.evaluate(() => {
  const a = document.querySelector('.tab.active'); return a ? a.innerText.replace(/\s+/g, ' ') : ''; });
const modalOpen = (page, id) => page.evaluate(id => {
  const m = document.getElementById(id); return !!(m && m.classList.contains('open')); }, id);

/* Type every score like a person: tap the first box, type a digit, and let
   the app's auto-advance carry focus to the next box. Fast fill() races the
   app's 50ms advance timer and puts a digit in the wrong box, which no
   thumb can do - so this waits for focus to move, as a person would. */
async function typeScores(page) {
  await page.locator('.tab.active input.game-score-input').first().click();
  let typed = 0;
  for (;;) {
    const cur = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.classList.contains('game-score-input') || a.value) return null;
      a.dataset.walkCur = '1';
      return [a.dataset.pid, +a.dataset.hole];
    });
    if (!cur) break;
    await page.keyboard.type(String(scoreFor(cur[0], cur[1])));
    typed++;
    try {
      await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.walkCur !== '1',
        null, { timeout: 1500 });
    } catch (e) { break; }
  }
  return typed;
}
/* Every other scorecard: set each empty box and fire ITS OWN oninput, the
   handler a keystroke runs. Fast, and no focus race. */
function enterScores(page) {
  return page.evaluate(() => {
    const ins = [...document.querySelectorAll('.tab.active input.game-score-input')].filter(i => !i.value);
    ins.forEach(i => {
      const pidAttr = [...i.attributes].find(a => /^data-\w*pid$/.test(a.name));
      const n = parseInt((pidAttr ? pidAttr.value : '1').replace(/\D/g, ''), 10) || 1;
      i.value = String(3 + ((n * 3 + +i.dataset.hole) % 4));
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return ins.length;
  });
}
const eventsOf = (page, type) => page.evaluate(t => (S.events || []).filter(e => e.type === t)
  .map(e => JSON.parse(JSON.stringify(e))), type);
const countFilled = sc => Object.values(sc || {}).reduce((a, h) => a + Object.values(h || {}).filter(v => v != null).length, 0);

/* ======================================================================= */
async function run(opts) {
  const { browserType, tag } = opts;
  const indexFile = path.resolve(process.env.WALK_INDEX || path.join(DIR, 'index.html'));
  const rep = reporter(tag);
  console.log('  · ' + tag + ': ' + path.relative(process.cwd(), indexFile) + ' in ' + browserType.name()
    + ' at ' + opts.context.viewport.width + 'x' + opts.context.viewport.height);

  const store = fake.createStore({ 'bz-apps': { golf: { [UID]: { state: seedState() } } } },
    /* The state read takes 150ms, as a real one does, so a write fired while
       the load is in flight is caught in the act rather than raced past. */
    { getDelay: p => (p === STATE_PATH ? 150 : 0) });

  let browser;
  try {
    browser = await browserType.launch();
  } catch (e) {
    rep.fail(browserType.name() + ' could not launch: ' + e.message.split('\n')[0]);
    rep.end('launch ' + browserType.name());
    return rep.summary();
  }
  const ctx = { rep, page: null };
  try {
    const context = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts.context));
    context.setDefaultTimeout(4000);
    await wire(context, store, rep, indexFile);
    await context.addInitScript(fake.userInit({ uid: UID, email: 'walk@example.com', displayName: 'Walk Tester' }));
    await context.addInitScript(INIT_REJECTIONS);
    const page = await context.newPage();
    ctx.page = page;
    listen(page, rep);
    await walk(ctx, page, store, context);
  } catch (e) {
    rep.fail('the walk crashed: ' + (e.stack || e.message).split('\n').slice(0, 2).join(' | '));
    rep.end('walk');
  }
  try { await browser.close(); } catch (e) { /* already gone */ }
  return rep.summary();
}

async function walk(ctx, page, store, context) {
  const statePuts = () => store.log.filter(e => e.op === 'put' && e.path === STATE_PATH);
  const firstLoad = () => store.log.find(e => e.op === 'get' && e.path === STATE_PATH && e.servedSeq);

  /* ---- 1. LOAD, SIGNED IN. Everything after this assumes the seeded
     account loaded; if it did not, the rest would only test an empty app. */
  const loaded = await step(ctx, 'loads signed in and takes the account from the database', async () => {
    await page.goto(ORIGIN + '/index.html');
    await page.waitForFunction(() => typeof _fbLoaded !== 'undefined' && _fbLoaded === true, null, { timeout: 8000 });
    await pause(page, 300);
    const s = await page.evaluate(() => ({
      auth: getComputedStyle(document.getElementById('authScreen')).display,
      welcome: (document.getElementById('homeWelcome') || {}).textContent || '',
      tiles: document.querySelectorAll('#homeGrid [onclick^="launchEvent"]').length,
      players: S.players.length, courses: S.courses.length }));
    expect(s.auth === 'none', 'the sign-in screen is still showing (display ' + s.auth + ')');
    expect(s.players === 8 && s.courses === 1, 'the seeded account did not load: ' + s.players + ' players, ' + s.courses + ' courses');
    expect(s.tiles === 4, 'home shows ' + s.tiles + ' module tiles, expected 4');
    expect(/Walk/.test(s.welcome), 'home does not greet the account holder: "' + s.welcome + '"');
    return '8 players, 1 course, 4 tiles';
  });

  /* ---- 2. NO WRITE BEFORE THE LOAD. Judged by order in the store's log: no
     PUT of state may arrive before the first state read was answered. */
  await step(ctx, 'nothing is written before the first load completes', async () => {
    const load = firstLoad();
    expect(load, 'the app never read its state from the database');
    const early = statePuts().filter(p => p.seq < load.servedSeq);
    expect(!early.length, early.length + ' state write(s) reached the database BEFORE the load was answered '
      + '(PUT #' + early.map(e => e.seq).join(', #') + ' vs load answered at #' + load.servedSeq + ')');
    return 'load answered at #' + load.servedSeq + ', no state PUT before it';
  });
  if (!loaded) {
    ctx.rep.end('the rest of the walk', ['not walked: the account did not load, so every screen after this '
      + 'would be judged on an empty app']);
    return;
  }

  /* ---- 3. FOURSOME: NASSAU, TYPED. */
  await step(ctx, 'Foursome: pick course and four players, choose Nassau, assign teams', async () => {
    await tap(page, '#homeGrid [onclick="launchEvent(\'foursome\')"]');
    await page.selectOption('#fs-course-sel', 'c1');
    for (const p of ['p1', 'p2', 'p3', 'p4']) await page.check('#fsp_' + p);
    await tap(page, 'button:has-text("Next →")');
    await tap(page, '[onclick="fsSelectGameType(\'nassau\')"]');
    const sels = page.locator('select[onchange^="fsDoTeamAssign"]');
    expect(await sels.count() === 4, 'Nassau setup shows ' + await sels.count() + ' team slots, expected 4');
    const pick = ['p1', 'p3', 'p2', 'p4'];
    for (let i = 0; i < 4; i++) { await sels.nth(i).selectOption(pick[i]); await pause(page, 80); }
    await tap(page, 'button:has-text("Start →")');
    const n = await page.locator('.tab.active input.game-score-input').count();
    expect(n === 72, 'the Nassau scorecard has ' + n + ' score boxes, expected 72');
    return '72 score boxes';
  });
  await step(ctx, 'Foursome: type all 18 holes for four players, auto-advance carrying focus', async () => {
    const typed = await typeScores(page);
    const g = (await eventsOf(page, 'foursome')).find(e => e.status === 'active');
    expect(g, 'no active foursome game after scoring');
    const filled = countFilled(g.scores);
    expect(typed === 72 && filled === 72, 'typed ' + typed + ', stored ' + filled + ' of 72 scores');
    for (const p of ['p1', 'p2', 'p3', 'p4']) {
      const got = H18.reduce((a, h) => a + (g.scores[p] || {})[h], 0);
      expect(got === grossFor(p, H18), p + ' stored a total of ' + got + ', typed ' + grossFor(p, H18));
    }
    return '72 typed, 72 stored, totals match';
  });
  await step(ctx, 'Foursome: save the Nassau and settle it', async () => {
    await tap(page, 'button:has-text("Save →")');
    await pause(page, 300);
    const g = (await eventsOf(page, 'foursome'))[0];
    expect(g && g.status === 'complete', 'the Nassau is not complete after Save (status ' + (g && g.status) + ')');
    expect(/Front:.*Back:.*Total:/.test(g.summary || ''), 'the Nassau settled to "' + g.summary + '"');
    return g.summary;
  });

  /* ---- 4. FOURSOME: STABLEFORD, TWO PLAYERS. */
  await step(ctx, 'Foursome: a second game type - Stableford for two', async () => {
    await page.click('#tab-home'); await pause(page);
    await tap(page, '#homeGrid [onclick="launchEvent(\'foursome\')"]');
    await page.selectOption('#fs-course-sel', 'c1');
    for (const p of ['p5', 'p6']) await page.check('#fsp_' + p);
    await tap(page, 'button:has-text("Next →")');
    await tap(page, '[onclick="fsSelectGameType(\'stableford\')"]');
    await tap(page, 'button:has-text("Start →")');
    const n = await enterScores(page);
    await pause(page, 300);
    expect(n === 36, 'the Stableford card had ' + n + ' boxes, expected 36');
    await tap(page, 'button:has-text("Save →")');
    await pause(page, 300);
    const done = (await eventsOf(page, 'foursome')).filter(e => e.status === 'complete');
    const st = done.find(e => e.gameType === 'stableford');
    expect(st, 'no completed Stableford game after Save');
    expect(countFilled(st.scores) === 36, 'Stableford stored ' + countFilled(st.scores) + ' of 36 scores');
    expect(/pts/.test(st.summary || ''), 'the Stableford settled to "' + st.summary + '"');
    return st.summary;
  });

  /* ---- 5. HISTORY: BOTH GAMES, AND A SCORECARD THAT ADDS UP. */
  await step(ctx, 'History lists both games and opens the Nassau scorecard', async () => {
    await page.click('#tab-history'); await pause(page);
    const cards = page.locator('#tab-history-content [onclick^="fsSViewHistory"]');
    expect(await cards.count() === 2, 'History lists ' + await cards.count() + ' games, expected 2');
    const nassau = cards.filter({ hasText: 'Nassau' });
    expect(await nassau.count() === 1, 'the Nassau is not in History');
    await nassau.first().click(); await pause(page, 350);
    expect(await modalOpen(page, 'historyModal'), 'the history scorecard did not open');
    /* The scorecard is a grid of .hole-grid rows; each player's row starts
       with their name and ends in a total cell (#sc-tot-f-<pid> for the
       front nine). That total must be what was typed. */
    const front = H18.slice(0, 9);
    const bad = [];
    for (const [pid, last] of [['p1', 'Zrimsek'], ['p2', 'Blood'], ['p3', 'Caito'], ['p4', 'Davis']]) {
      const row = await page.evaluate(([pid]) => {
        const t = document.querySelector('#historyModal #sc-tot-f-' + pid);
        const r = t && t.closest('.hole-grid');
        return r ? { name: r.firstElementChild.textContent.trim().split(/\s+/)[0], out: t.textContent.trim() } : null;
      }, [pid]);
      const want = String(grossFor(pid, front));
      if (!row) bad.push(last + ' has no front-nine total on the scorecard');
      else if (row.name !== last || row.out !== want) {
        bad.push(row.name + ' shows OUT ' + row.out + ' where ' + last + ' typed ' + want);
      }
    }
    expect(!bad.length, bad.join('; '));
    await page.evaluate(() => closeModal('historyModal')); await pause(page);
    return '2 games, 4 front-nine totals correct';
  });

  /* ---- 6. OUTING. */
  let shareId = null;
  await step(ctx, 'Outing: create, add eight players, pick the course', async () => {
    await page.click('#tab-home'); await pause(page);
    await tap(page, '#homeGrid [onclick="launchEvent(\'outing\')"]');
    await tap(page, 'button:has-text("+ Plan an Outing")');
    await page.fill('#outingModal-name', 'Walk Invitational');
    await tap(page, '#outingModal button:has-text("Save")');
    await tap(page, '[onclick="outingHubPlayers()"]');
    for (let i = 1; i <= 8; i++) { await page.check(`input[onchange*="outingPlanTogglePlayer('p${i}'"]`); await pause(page, 60); }
    await tap(page, 'button:has-text("Course →")');
    await tap(page, '[onclick="outingPlanSetCourse(\'c1\')"]');
    const o = (await eventsOf(page, 'outing'))[0];
    expect(o && o.name === 'Walk Invitational', 'the outing was not created');
    expect((o.playerIds || []).length === 8, 'the outing holds ' + (o.playerIds || []).length + ' players, expected 8');
    expect(o.courseId === 'c1', 'the outing course is ' + o.courseId);
    return '8 players on Walk Hills CC';
  });
  await step(ctx, 'Outing: Low Net with skins, assign two groups', async () => {
    await tap(page, 'button:has-text("Hub")');
    await tap(page, '[onclick="outingHubFormat()"]');
    await tap(page, `[onclick*="outingPlanSetFormat('lownet'"]`);
    await page.check('#outing-skins-chk'); await pause(page);
    await tap(page, 'button:has-text("Groups →")');
    await tap(page, '[onclick="outingGenerateAndAssign(false)"]');
    const o = (await eventsOf(page, 'outing'))[0];
    const sizes = (o.groups || []).map(g => (g.playerIds || []).length);
    expect(sizes.length === 2 && sizes[0] + sizes[1] === 8, 'groups came out as [' + sizes + '], expected two groups of 8 players');
    expect(o.gameType === 'lownet' && o.skins, 'format is ' + o.gameType + (o.skins ? ' + skins' : ''));
    return 'groups of ' + sizes.join(' and ');
  });
  await step(ctx, 'Outing: score both groups, all 18 holes', async () => {
    await tap(page, '[onclick="outingHubStartScoring()"]');
    const a = await enterScores(page); await pause(page, 300);
    await tap(page, 'button:has-text("Group 2")');
    const b = await enterScores(page); await pause(page, 300);
    const o = (await eventsOf(page, 'outing'))[0];
    expect(a + b === 144, 'entered ' + a + ' + ' + b + ' boxes, expected 144');
    expect(countFilled(o.scores) === 144, 'the outing stored ' + countFilled(o.scores) + ' of 144 scores');
    return '144 stored';
  });
  await step(ctx, 'Outing: results show all eight, gross totals right, skins paid', async () => {
    await tap(page, 'button:has-text("Results →")');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.tab.active tr')]
      .map(r => [...r.cells].map(c => c.innerText.trim())));
    const players = (await page.evaluate(() => S.players.map(p => [p.id, p.name])));
    let found = 0;
    for (const [pid, nm] of players) {
      const row = rows.find(r => r.some(c => c === nm || c.endsWith(nm)) && r.includes(String(grossFor(pid, H18))));
      if (row) found++;
    }
    expect(found === 8, 'only ' + found + ' of 8 players appear on the results with their correct gross');
    expect(/SKINS/i.test(await activeText(page)), 'no skins on the outing results');
    return '8 rows, gross correct';
  });
  await step(ctx, 'Outing: go live - the board and scoring links are published', async () => {
    await tap(page, 'button:has-text("Go Live & share links")');
    await pause(page, 400);
    expect(await modalOpen(page, 'liveShareModal'), 'the live share sheet did not open');
    const url = await page.locator('#liveShareUrl').innerText();
    shareId = (url.match(/[?&]id=([a-z0-9]+)/) || [])[1];
    expect(shareId, 'no share id in the live link "' + url + '"');
    const links = await page.locator('#liveShareGroups button:has-text("Text")').count();
    expect(links === 2, links + ' scoring links, expected one per group (2)');
    const live = store.read('/bz-apps/golf/live/' + shareId);
    expect(live && live.views && live.groups, 'nothing was published at live/' + shareId);
    await tap(page, '#liveShareModal button:has-text("Done")');
    return 'live/' + shareId + ', 2 scoring links';
  });
  await step(ctx, 'Outing: save, and the outing is complete', async () => {
    await tap(page, 'button:has-text("💾 Save")');
    await pause(page, 300);
    const o = (await eventsOf(page, 'outing'))[0];
    expect(o.status === 'complete', 'the outing is ' + o.status + ' after Save');
    expect(/Results/.test(await activeText(page)), 'the outing hub offers no results');
  });

  /* ---- 7. LEAGUE. */
  await step(ctx, 'League: create, start a session, RSVP one out', async () => {
    await page.click('#tab-home'); await pause(page);
    await tap(page, '#homeGrid [onclick="launchEvent(\'league\')"]');
    await tap(page, 'button:has-text("+ New League")');
    await page.fill('#leagueModal-name', 'Wednesday Walkers');
    await tap(page, '#leagueModal button:has-text("Save")');
    await tap(page, '[onclick="leagueSessionLaunch()"]');
    await tap(page, `button[onclick="leagueRsvpSet('p6','out')"]`);
    const lg = (await eventsOf(page, 'league'))[0];
    const s = lg && (lg.sessions || [])[0];
    expect(s, 'no league session was created');
    const ins = Object.values(s.rsvp || {}).filter(v => (v || {}).status === 'in').length;
    expect(ins === 7, ins + ' players are in, expected 7');
    return '7 in, 1 out';
  });
  await step(ctx, 'League: assign groups, Stableford, score both groups', async () => {
    await tap(page, 'button:has-text("Groups →")');
    await tap(page, '[onclick="leagueAssignGroups()"]');
    await tap(page, 'button:has-text("Type →")');
    await tap(page, `[onclick*="leagueSetGameType('stableford_ind')"]`);
    await tap(page, 'button:has-text("Scoring →")');
    const a = await enterScores(page); await pause(page, 300);
    await tap(page, 'button:has-text("Next Group →")');
    const b = await enterScores(page); await pause(page, 300);
    const s = (await eventsOf(page, 'league'))[0].sessions[0];
    const sizes = (s.groups || []).map(g => g.playerIds.length);
    expect(sizes.join() === '4,3', 'groups came out as [' + sizes + '], expected [4,3]');
    expect(a + b === 126 && countFilled(s.scores) === 126, 'entered ' + (a + b) + ', stored '
      + countFilled(s.scores) + ' of 126 scores');
    return 'groups 4+3, 126 stored';
  });
  await step(ctx, 'League: results rank all seven, session saved', async () => {
    await tap(page, 'button:has-text("Results →")');
    const rows = await page.evaluate(() => {
      const t = document.querySelector('.tab.active table');
      return t ? [...t.querySelectorAll('tr')].filter(r => r.querySelector('td')).length : 0; });
    expect(rows === 7, 'the results table has ' + rows + ' player rows, expected 7');
    await tap(page, 'button:has-text("Save Session")');
    const s = (await eventsOf(page, 'league'))[0].sessions[0];
    expect(s.completed, 'the session is not marked complete after Save');
    return rows + ' rows';
  });
  await step(ctx, 'League: switch standings on and read them', async () => {
    await tap(page, 'button:has-text("Back to League")');
    await tap(page, '[onclick="leagueRenderSeasonsScreen()"]');
    await tap(page, '[onclick="leagueSetTrackStandings(true)"]');
    await page.evaluate(() => leagueRenderHub()); await pause(page);
    await tap(page, '[onclick="leagueRenderStandings()"]');
    const rows = await page.locator('.tab.active tbody tr').count();
    expect(rows === 7, 'standings list ' + rows + ' players, expected 7');
    const top = await page.locator('.tab.active tbody tr').first().innerText();
    expect(/\b3\b/.test(top), 'the leader does not have 3 points: "' + top.replace(/\s+/g, ' ') + '"');
    return '7 rows, leader on 3 pts';
  });

  /* ---- 8. TRIP. */
  await step(ctx, 'Trip: create, roster of four, course, one round with a tee time', async () => {
    await page.click('#tab-home'); await pause(page);
    await tap(page, '#homeGrid [onclick="launchEvent(\'trip\')"]');
    await tap(page, 'button:has-text("+ Create a Trip")');
    await page.fill('#ttm-dest', 'Pinehurst');
    await page.fill('#ttm-start', '2026-10-03');
    await page.fill('#ttm-end', '2026-10-05');
    await tap(page, '#tripModal button:has-text("Save")');
    await tap(page, '[onclick="tripGoScreen(\'roster\')"]');
    for (const p of ['p1', 'p2', 'p3', 'p4']) { await page.check(`input[onchange*="tripRosterToggle('${p}'"]`); await pause(page, 80); }
    await tap(page, 'button:has-text("COURSES ›")');
    await page.check(`input[onchange*="tripToggleCourse('c1'"]`); await pause(page);
    await tap(page, 'button:has-text("SCHEDULE ›")');
    await tap(page, '[onclick="tripOpenRoundModal(0,null)"]');
    await page.fill('#rm-label', 'Round 1');
    await page.fill('#rm-newtt', '08:00');
    await tap(page, '#roundModal button:has-text("+ Add")');
    await tap(page, '#roundModal button:has-text("Save")');
    const t = (await eventsOf(page, 'trip'))[0];
    const rounds = Object.values(t.days || {}).reduce((a, d) => a + (d.rounds || []).length, 0);
    expect(t.destination === 'Pinehurst', 'no trip was created');
    expect((t.players || []).length === 4, 'the trip roster holds ' + (t.players || []).length + ', expected 4');
    expect(rounds === 1, 'the trip has ' + rounds + ' rounds, expected 1');
    return '4 players, 1 round';
  });
  await step(ctx, 'Trip: pair the round and score it', async () => {
    await tap(page, 'button:has-text("PAIRINGS ›")');
    await tap(page, '[onclick="tripOpenPairingRound(0,0)"]');
    await tap(page, '[onclick="tripGenerateGroups()"]');
    await tap(page, 'button:has-text("Save ✓")');
    await tap(page, '[onclick="tripGoScreen(\'hub\')"]');
    await tap(page, '[onclick="tripStartScoring(0,0)"]');
    const n = await enterScores(page); await pause(page, 300);
    expect(n === 72, 'the trip card had ' + n + ' boxes, expected 72');
    await tap(page, 'button:has-text("Results →")');
    await tap(page, 'button:has-text("💾 Save")');
    return '72 entered';
  });
  await step(ctx, 'Trip: the leaderboard ranks all four', async () => {
    const txt = await activeText(page);
    expect(/Trip Leaderboard/i.test(txt), 'no trip leaderboard after saving the round');
    const rows = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.tab.active *')].find(e => /^Trip Leaderboard$/i.test(e.textContent.trim()));
      let el = h; while (el && !el.querySelector('table')) el = el.parentElement;
      return el ? el.querySelector('table').querySelectorAll('tbody tr').length : -1;
    });
    expect(rows === 4, 'the trip leaderboard has ' + rows + ' rows, expected 4');
    const t = (await eventsOf(page, 'trip'))[0];
    const r = Object.values(t.days)[0].rounds[0];
    expect(r.completed, 'the round is not marked complete');
    return '4 rows';
  });

  /* ---- 9. THE OTHER TABS. */
  await step(ctx, 'Players: the roster lists eight, and a new player can be added', async () => {
    await page.click('#tab-players'); await pause(page);
    const before = await page.locator('#tab-players-content [onclick^="rosterDeletePlayer"]').count();
    expect(before === 8, 'the roster shows ' + before + ' players, expected 8');
    await tap(page, '#tab-players-content [onclick="openPlayerModal()"]');
    expect(await modalOpen(page, 'playerModal'), 'the add-player form did not open');
    await page.fill('#pName', 'Walk Newcomer');
    await page.fill('#pHcp', '14.2');
    await page.check('#pRegular');
    await tap(page, '#playerModal [onclick="savePlayer()"]');
    const after = await page.evaluate(() => S.players.length);
    expect(after === 9, 'there are ' + after + ' players after adding one, expected 9');
    return '8 + 1';
  });
  await step(ctx, 'Courses: the course is listed and its editor opens', async () => {
    await page.click('#tab-courses'); await pause(page);
    const txt = (await page.locator('#tab-courses-content').innerText()).replace(/\s+/g, ' ');
    expect(/Walk Hills CC/.test(txt) && /Par 72/.test(txt), 'the course list does not show Walk Hills CC, par 72');
    await tap(page, '#tab-courses-content [onclick="editCourse(\'c1\')"]');
    expect(await modalOpen(page, 'courseModal'), 'the course editor did not open');
    await page.evaluate(() => closeModal('courseModal')); await pause(page);
  });
  await step(ctx, 'Games: every section opens', async () => {
    await page.click('#tab-games'); await pause(page);
    const secs = page.locator('#tab-games-content [onclick^="toggleGameSection"]');
    const n = await secs.count();
    expect(n >= 3, 'the Games tab has ' + n + ' sections');
    for (let i = 0; i < n; i++) { await secs.nth(i).click(); await pause(page, 120); }
    const len = (await page.locator('#tab-games-content').innerText()).length;
    expect(len > 300, 'the Games tab shows almost nothing once opened (' + len + ' chars)');
    return n + ' sections';
  });
  await step(ctx, 'Settings: the account and modules are shown', async () => {
    await page.click('#tab-settings'); await pause(page);
    const txt = (await page.locator('#tab-settings-content').innerText()).replace(/\s+/g, ' ');
    expect(/walk@example\.com/.test(txt), 'Settings does not show the signed-in account');
    expect(/Foursome/.test(txt) && /Trip/.test(txt), 'Settings does not list the modules');
  });

  /* ---- 10. THE WORK REACHED THE DATABASE. */
  await step(ctx, 'everything entered reached the database, after the load', async () => {
    await page.waitForFunction(() => !_dirty, null, { timeout: 6000 }).catch(() => {});
    await pause(page, 300);
    const puts = statePuts(), load = firstLoad();
    expect(puts.length > 0, 'no state write ever reached the database');
    expect(puts.every(p => p.seq > load.servedSeq), 'a state write arrived before the load was answered');
    expect(puts.every(p => p.auth), 'a state write went without an auth token');
    const st = store.read(STATE_PATH) || {};
    const ev = st.events || [];
    const n = t => ev.filter(e => e.type === t).length;
    expect(n('foursome') === 2 && n('outing') === 1 && n('league') === 1 && n('trip') === 1,
      'the stored state holds foursome ' + n('foursome') + ', outing ' + n('outing') + ', league '
      + n('league') + ', trip ' + n('trip') + ' - expected 2/1/1/1');
    expect((st.players || []).length === 9, 'the stored roster holds ' + (st.players || []).length + ', expected 9');
    return puts.length + ' state PUTs, all after load #' + load.servedSeq;
  });

  /* ---- 11. THE LIVE BOARD AND THE SCORING LINK, against what the app
     itself published to live/{shareId}. */
  await step(ctx, 'live.html: the published outing board renders all eight', async () => {
    expect(shareId, 'the outing was never published, so there is no board to open');
    const lp = await context.newPage();
    ctx.page = lp; listen(lp, ctx.rep);
    await lp.goto(ORIGIN + '/live.html?id=' + shareId);
    await lp.waitForSelector('#board tr', { timeout: 5000 });
    const rows = await lp.locator('#board tr').count();
    const title = await lp.locator('#title').innerText();
    expect(title === 'Walk Invitational', 'the board is titled "' + title + '"');
    expect(rows === 8, 'the board shows ' + rows + ' rows, expected 8');
    const firstName = (await lp.locator('#board tr td.name').first().innerText()).trim();
    expect(firstName.length > 2, 'the leader has no name');
    return rows + ' rows, led by ' + firstName;
  });
  let sp = null;
  await step(ctx, 'score.html: a group scoring link loads its own players', async () => {
    expect(shareId, 'the outing was never published, so there is no scoring link');
    sp = await context.newPage();
    ctx.page = sp; listen(sp, ctx.rep);
    await sp.goto(ORIGIN + '/score.html?id=' + shareId + '&g=0');
    await sp.waitForSelector('.prow', { timeout: 5000 });
    const names = (await sp.locator('.prow .nm').allInnerTexts()).map(s => s.trim()).sort();
    const live = store.read('/bz-apps/golf/live/' + shareId);
    const want = live.groups[0].players.map(p => p.name).sort();
    expect(names.join() === want.join(), 'the scoring page shows [' + names + '], group 1 is [' + want + ']');
    expect(store.log.some(e => e.op === 'identity'), 'score.html did not sign in anonymously');
    return names.length + ' players, hole 1';
  });
  await step(ctx, 'score.html: tapping + saves the score to the live board', async () => {
    expect(sp, 'the scoring page never loaded');
    const live = store.read('/bz-apps/golf/live/' + shareId);
    const pid = live.groups[0].players[0].id;
    await sp.locator('.prow').first().locator('button:has-text("+")').click();
    await sp.waitForFunction(() => /Saved/.test(document.getElementById('saved').textContent), null, { timeout: 4000 });
    const saved = store.read('/bz-apps/golf/live/' + shareId + '/scores/' + pid + '/1');
    expect(saved === 5, 'hole 1 for ' + pid + ' stored ' + saved + ', expected par 4 + 1 = 5');
    return 'live/' + shareId + '/scores/' + pid + '/1 = 5';
  });
  ctx.page = page;
}

module.exports = { run, seedState, scoreFor, overflow, screen, fake, ORIGIN, UID, DIR,
  _internal: { reporter, wire, listen } };
