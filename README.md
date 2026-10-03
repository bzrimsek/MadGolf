# MadGolf

A golf-scoring app for phones: Foursome games (Nassau, skins, Stableford,
wolf and more), Outings, Leagues and Trips, with a public live leaderboard
that any group can score into from a link.

Live: https://bzrimsek.github.io/MadGolf/

It is one HTML file (`index.html`) with a service worker. No build step.

## How a release ships

```
python bump.py "what changed"
python push.py "short subject"
```

`push.py` sends the build to the `build` branch. GitHub runs the gate
(`.github/workflows/gate.yml`): the audit, ~2850 unit tests, a linter, the
wiring checks, and a walk through the app in a real Chromium and in WebKit.
Only a green gate moves `main`, which is what the site serves.

## Running the checks

```
npm ci
node check.js --all
```

`DEV-RULES.md` is the working agreement, shared across BZ's apps.

© BiZStoryGuru LLC. All rights reserved.
