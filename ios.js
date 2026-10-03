/* The same walk in WebKit - the engine iOS ships - at iPhone size: 390x844,
 * mobile, touch, 3x, an iPhone Safari user agent. Every other browser check
 * drives Chromium, so a WebKit-only fault is invisible without this.
 *
 * It is not an iPhone: no moving toolbar, no home-screen mode. It proves the
 * app is not broken in the engine iPhones use. If WebKit cannot launch, that
 * is a failure, named - never a skip.
 *
 *   node ios.js
 *   WALK_INDEX=copy.html node ios.js
 */
'use strict';
const { webkit } = require('playwright');
const { run } = require('./walk-lib.js');

run({
  browserType: webkit, tag: 'ios',
  context: {
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  }
})
  .then(code => process.exit(code))
  .catch(e => { console.log('  ✖ ios.js threw: ' + (e.stack || e.message)); process.exit(1); });
