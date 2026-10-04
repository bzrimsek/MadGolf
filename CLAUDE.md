# MadGolf

A golf-scoring PWA for BZ: Foursome games, Outings, Leagues and Trips, with a
public live board. One file, `index.html` (~14.5k lines), plus three pages
strangers open from a text message (`live.html`, `score.html`, `rsvp.html`)
and a service worker. No build step, no framework — what is in `index.html`
is what runs. Live at https://bzrimsek.github.io/MadGolf/.

**The rules are the shared rule book, `..\DEV-RULES.md`** (loaded for every
app by `Apps I've Built\CLAUDE.md`). This file holds only what is true of
MadGolf. A rule goes there, never here.

---

## Building

Moved from the web container to BZ's PC on 2026-10-03, with Bottlefolio's
automation. Run Python as the install's own
`%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe` (the `python` on PATH
is the WindowsApps alias and cannot see the Playwright browsers).

```
python bump.py "what changed, in full sentences"
python push.py "short subject for the commit"
```

- **`bump.py`** is the only way to set a version (rule 9). It writes the
  header, `APP_VERSION`, `BUILD_TIME`, `sw.js` `CACHE_NAME`, the headline in
  the index.html changelog block (last 10 kept), the full entry in
  `CHANGELOG.md`, and the lock pair `madgolf-vX.html` + `madgolf-vX-sw.js`,
  removing the previous pair. The version is three-part; patch rolls at 100.
  MadGolf draws its version on screen from `APP_VERSION`; there is no static
  UI string. Replaces the old multi-app `..\bump.py madgolf auto/touch`.
- **`push.py`** runs the audit here, refuses while an earlier gate run is
  still going, sends every changed file to the `build` branch as ONE commit
  (and removes retired files such as `ship.py`), then follows the cloud gate
  step by step. Only a green gate moves `main`, which is what the site
  serves; red leaves the live site untouched. `--dry-run` sends nothing.
  `DEV-RULES.md` is published from `..\DEV-RULES.md`; never keep a copy here.
- **`node check.js`** runs what a change can break, four at a time;
  `node check.js --all` runs everything. It reads `checks.json`, the same
  table `gate.py` reads in the cloud.

The checks (report each as it lands, rule 25c):

```
python audit.py index.html   # versions agree, lock pair == working files, changelog filled
node madgolf-test.js index.html   # ~2850 unit tests, ~2s
node lint.js                 # nothing undefined/duplicated/unreachable, all 4 pages
node consistency.js          # wiring: handlers, ids, write doors, sizes, delivery lists
node browser.js              # the walk, real Chromium at 390px
node ios.js                  # the same walk in WebKit at iPhone size
node layout.js               # every screen: headers centered, buttons one line
                             #   --shots / --shots-all photograph into shots-layout/
```

Credentials: BZ's `gh auth login` (has the `workflow` scope push.py needs).

## Files

| | |
|---|---|
| `index.html` | the app |
| `sw.js` | service worker; `CACHE_NAME` bumps with the version and is what makes phones update |
| `live.html` `score.html` `rsvp.html` | public live board, per-foursome score entry, RSVP |
| `madgolf-test.js` | the unit harness |
| `checks.json` `check.js` `gate.py` | which checks exist, run here, run in the cloud |
| `consistency-sizes.json` | rule 30f allowance: functions over 100 code lines, by name, never to grow |
| `consistency-doors.json` | every function that writes to the database, by name; a new one fails |
| `walk-lib.js` `fake-firebase.js` | the browser walk and the in-memory Firebase it runs against |
| `rules.js` | read / pull / diff / deploy the `bz-apps/golf` Firebase rules branch only |
| `CHANGELOG.md` | every build's full entry |
| `_superseded/` | old locks and handoffs; the record, never current |

## Shape of the code

- Modules by prefix: FOURSOME `fs*` (game types doc, nassau, walkoff, wolf,
  bbb, stableford, lownet, scramble…), OUTING `outing*`, LEAGUE `league*`,
  TRIP `trip*`. Every event lives in `S.events[]`, keyed by `type`.
- `computeRoundResults(ctx)` is the shared round engine →
  `{type:'individual'|'team'|'scramble', entries, isSF}`.
- **Context shapes differ — this bit us:** `leagueSessionCtx(lg, s)` returns a
  WRAPPER `{course, gameType, nineMode, pool, ctx}`; `tripScoringCtx(t, r)`
  and `outingScoringCtx(o)` return the engine ctx directly. Using the wrong
  one throws "Cannot destructure property 'players' of 'ctx'".
- **Headers (BZ, 2026-10-04): centered, buttons on one line.** A screen
  header is written as `[buttons] <title> [buttons]` (`.fs-scr-hdr` +
  `.fs-scr-title`, or a `.card-title` holding a button and a `<span>`
  title, or `.sec-hdr`/`.day-card-hdr`, or any `data-hdr` + `data-hdr-title`).
  `scrHdrWatch()` groups each one into `.scr-l` / title / `.scr-r` as it is
  drawn, on a 3-column grid that centers the title on the screen; when the
  title would be cut or off-center, `scrHdrFit()` stacks it above the buttons
  (`.hdr-stack`). Never hand-center a header or shrink a label to fit:
  `layout.js` fails any header off-center by more than 6px, any button label
  on two lines and any button row that spills. List-group headers come from
  `listSecHdr()`. Form field labels stay left.
- Score-entry order (By Player / By Hole) lives in the info strip under the
  scoring header, on Trip, Outing and League alike.
- `computeSkins(ctx)` never decides whether skins are on. League shows skins
  only when `lg.skins`; trips always compute them. Always pass `skinsOn`.
- Rule 30's helpers here: `leagueSessionCtx`, `liveRoundRows`,
  `fsScorecardData`. The canvas drawing (`fsScorecardCanvas`,
  `fsLeaderboardCanvas`) cannot be unit-tested; its row data is.

## Firebase

- Project `madgolf-c8789`, database `madgolf-c8789-default-rtdb`, per-user
  path `bz-apps/golf/{uid}/`. Modular SDK 10.12.2 from gstatic in a
  `<script type="module">` block that hands helpers to the plain scripts on
  `window`.
- **Rule 21's guard here is `_fbLoaded`.** `fbWrite` (authed REST PUT of
  `/state.json?auth=<token>`) throws if it is false. `scheduleWrite()`
  normalizes, saves locally, debounces the remote write and republishes live.
- The web API key in index.html/score.html/rsvp.html is not a secret; it
  identifies the project and authorises nothing.
- Admin UID `QTKjcW0ArKPae2Y0uGicSKhwjnr1`.
- Live scoring: `live/{shareId}` is public read; the organizer publishes
  (`publishLiveUnit`, PATCH so `scores` survives); `score.html` signs in
  anonymously and writes only `live/{shareId}/scores/{pid}/{hole}`.
  `liveMonitorPoll` (15s) folds those in with `liveMergeScores`, a union
  that never overwrites the organizer's own group.

## Services BZ owns

- Course proxy `https://course-proxy.brianzrimsek.workers.dev/` (RapidAPI
  Golf Course API; key in the Worker's `GOLF_API_KEY` secret). GHIN proxy
  `https://ghin-proxy.brianzrimsek.workers.dev/`. Neither Worker's source is
  in this folder or the repo.

## Harness mechanics

- New test sections go BEFORE `const total = passed + failed;` in
  `madgolf-test.js`. `expect(desc, actual, expected)`; `vmSetS('key', val)`;
  `sandbox.fnName`; `smokeSetup()`; read `S` back with
  `vm.runInContext("S…", sandbox)`, not `sandbox.S`.
- Every `onclick`/`onchange` in the source is auto-validated: one new
  handler raises the test count by one with no test edit.
- Cross-consistency (rule 30a) uses the recording-DOM pattern: sections 148
  (Nassau), 174 (DOC), 175 (walk-off).
- Async code (anything that awaits the network) is tested in `_asyncSections`
  just before the report, which waits for it (§183, the GHIN buttons). The
  sandbox's `fetchWithTimeout`/`toast` are replaced with
  `vm.runInContext("fetchWithTimeout = ...")`, because the app's own
  declarations shadow the sandbox's stubs.
- Edits with backslashes or unicode escapes: use the Edit tool, not a Python
  heredoc — a heredoc collapses `\\f` into a form feed (it happened twice on
  2026-10-03).

## Open items (2026-10-03)

- **Firebase rules automation waits on a MadGolf admin key.** BZ runs
  `npx firebase login` (or downloads a key to
  `%USERPROFILE%\.madgolf\firebase-admin.json`); then `node rules.js pull`
  makes `firebase-rules.json` from the LIVE rules, `FIREBASE_SA` becomes a
  repo secret, and `rulestest.js` + the `rules` gate step join. Until then
  the rules are managed in the console and the gate never deploys them.
- From the August handoff, still open: Anonymous Auth must be enabled in the
  Firebase console before `score.html` can write; regenerate the RapidAPI
  key (it was pasted in chat) and update `GOLF_API_KEY`; on-device check of
  live scoring end to end, the v0.91.15 outing group fix, and both share
  images; #5b the organizer's screen does not auto-refresh on merged scores.
