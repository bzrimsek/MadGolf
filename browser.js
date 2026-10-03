/* The walk in Chromium (headless) at phone width, 390x844.
 *
 *   node browser.js              walk ./index.html
 *   WALK_INDEX=copy.html node browser.js
 *
 * Exit 0 only when every step passes; the last line is then exactly
 * `  ✓ walk passed: <N> steps in <S>s`. See walk-lib.js for what is walked.
 */
'use strict';
const { chromium } = require('playwright');
const { run } = require('./walk-lib.js');

run({ browserType: chromium, tag: 'walk', context: { viewport: { width: 390, height: 844 } } })
  .then(code => process.exit(code))
  .catch(e => { console.log('  ✖ browser.js threw: ' + (e.stack || e.message)); process.exit(1); });
