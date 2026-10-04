/* LAYOUT: headers centered, action buttons on one line (BZ, 2026-10-04).
 *
 *   node layout.js               scan every screen the walk reaches, at 390px
 *   node layout.js --report      print every finding (default: summary + list)
 *
 * Rides along with the walk (walk-lib.js): a probe inside the page measures
 * every screen and modal each time one draws, so screens the walk only
 * passes through are measured too, not just where each step ends.
 *
 * A HEADER is a screen title, a modal title, a card title, a section title or
 * a section label. Centered means its TEXT's midpoint is within 6px of the
 * midpoint of the screen (or modal) it heads - not of its own box, because a
 * title squeezed between a Back button and two action buttons can be
 * text-align:center and still sit far off the middle of the phone.
 *
 * A BUTTON WRAPS when its label takes more than one line, or when a row of
 * action buttons spills onto a second row. Both waste the space BZ asked to
 * have used.
 */
'use strict';
const { chromium } = require('playwright');
const { run } = require('./walk-lib.js');

const PROBE = `(() => {
  const found = new Map();
  window.__layout = found;
  /* The app's brand bar (logo, MadGolf, sync dot) is not a header of a
     screen, and is left as BZ's brand layout. */
  const HEAD = '.fs-scr-title, .scr-t, .modal h2, .card-title:not(.scr-grid), .sec-title, .section-label, .day-label, .list-sec';
  const label = el => (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48);
  const where = () => {
    const m = [...document.querySelectorAll('.modal-overlay.open')].pop();
    if (m) { const h = m.querySelector('h2'); return 'modal ' + (m.id || '?') + (h ? ' "' + label(h) + '"' : ''); }
    const t = document.querySelector('.tab.active');
    const h = t && t.querySelector('.fs-scr-title');
    return (t ? t.id : '?') + (h ? ' "' + label(h) + '"' : '');
  };
  const textBox = el => {
    const r = document.createRange(); r.selectNodeContents(el);
    const rs = [...r.getClientRects()].filter(x => x.width > 0);
    if (!rs.length) return null;
    return { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)) };
  };
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
    && getComputedStyle(el).visibility !== 'hidden'; };
  function measure() {
    if (window.__layoutAll && window.__layoutShot) window.__layoutShot(where());
    const roots = [...document.querySelectorAll('.modal-overlay.open .modal')];
    if (!roots.length) { const t = document.querySelector('.tab.active'); if (t) roots.push(t); }
    const at = where();
    roots.forEach(root => {
      const rb = root.getBoundingClientRect();
      const mid = rb.left + root.clientWidth / 2;
      root.querySelectorAll(HEAD).forEach(el => {
        if (!shown(el) || !label(el)) return;
        /* An inline header is one piece of a line (a format badge, then the
           round's name): the LINE is what is centered, so measure that. */
        const tb = textBox(getComputedStyle(el).display === 'inline' && el.parentElement ? el.parentElement : el);
        if (!tb) return;
        const off = Math.round((tb.left + tb.right) / 2 - mid);
        /* A title squeezed until it is cut off, or to nothing, is worse than
           one that is off-centre (the Low Net header showed none at all). */
        // An inline element has no clientWidth; only a box can be cut off.
        const boxy = getComputedStyle(el).display !== 'inline';
        if (boxy && (el.scrollWidth > el.clientWidth + 1 || el.clientWidth < 24)) {
          found.set('T|' + at + '|' + label(el), { kind: 'header', at, cls: 'CUT OFF', text: label(el),
            off: el.clientWidth + '/' + el.scrollWidth + 'px shown' });
          if (window.__layoutShot) window.__layoutShot(at);
          return;
        }
        if (Math.abs(off) > 6) {
          const cls = el.matches('.modal h2') ? 'modal title' : el.className.split(' ')[0] || el.tagName;
          found.set('H|' + at + '|' + cls + '|' + label(el), { kind: 'header', at, cls, text: label(el), off });
        }
      });
      /* AND HEADERS WRITTEN INLINE: a block in the header font (Bebas Neue)
         standing alone on its line - not a score in a row, not a hub card's
         title beside its icon - is a header, whatever its class. 37 such
         blocks were styled by hand (2026-10-04). Numbers are totals, not titles. */
      root.querySelectorAll('div, span').forEach(el => {
        /* Inside something tappable ([onclick]: a game-type card, a hub card)
           it is the title of an OPTION, not a header. */
        if (el.matches(HEAD) || el.closest('button, .btn, [onclick], table, .hole-grid, .fs-scr-hdr, .scr-grid, .hdr-stack')) return;
        const cs = getComputedStyle(el);
        if (cs.fontFamily.indexOf('Bebas') < 0 || cs.display !== 'block' || !shown(el)) return;
        const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        if (!own || /^[-+]?[\\d.,%$]+$/.test(own)) return;
        /* Part of a ROW (a hub card: icon, title over subtitle, chevron; a
           game picker option; a banner with its score) up to three levels up
           is that row's title, not a header. */
        let inRow = false;
        for (let a = el.parentElement, i = 0; a && i < 3 && !inRow; a = a.parentElement, i++) {
          const as = getComputedStyle(a);
          inRow = (as.display.indexOf('flex') >= 0 && as.flexDirection.indexOf('column') < 0
            || as.display.indexOf('grid') >= 0) && [...a.children].filter(shown).length > 1;
        }
        if (inRow) return;
        const tb = textBox(el); if (!tb) return;
        const r = el.getBoundingClientRect();
        const off = Math.round((tb.left + tb.right) / 2 - (r.left + el.clientWidth / 2));
        if (Math.abs(off) > 6) found.set('I|' + at + '|' + label(el), { kind: 'header', at, cls: 'inline header', text: label(el), off });
      });
      root.querySelectorAll('button, .btn, [onclick].btn-back').forEach(b => {
        if (!shown(b) || b.closest('.hole-cell')) return;
        const text = label(b); if (!text) return;
        /* A button holding its own block layout (the Home tiles: icon, name,
           subtitle) is a card with several lines by design, not a label. */
        if ([...b.children].some(c => /block|flex|grid/.test(getComputedStyle(c).display))) return;
        const cs = getComputedStyle(b);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const inner = b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const lines = Math.round(inner / lh);
        const clipped = b.scrollWidth > b.clientWidth + 1;
        if ((lines > 1 || clipped) && window.__layoutShot) window.__layoutShot(at);
        if (lines > 1 || clipped) {
          found.set('B|' + at + '|' + text, { kind: 'button', at, text, lines, clipped,
            width: Math.round(b.getBoundingClientRect().width) });
        }
      });
      // A ROW of two or more buttons that spilled onto a second line.
      const rows = new Set();
      root.querySelectorAll('button, .btn').forEach(b => { if (shown(b) && b.parentElement) rows.add(b.parentElement); });
      /* Only a sideways flex row counts (a grid or a column stacks on purpose),
         and only a real spill: a button that starts below another one ends,
         not two buttons of different heights side by side. */
      rows.forEach(p => {
        const ps = getComputedStyle(p);
        if (ps.display.indexOf('flex') < 0 || ps.flexDirection.indexOf('column') === 0) return;
        const bs = [...p.children].filter(c => (c.matches('button, .btn')) && shown(c));
        if (bs.length < 2) return;
        const rs = bs.map(c => c.getBoundingClientRect());
        const spilled = rs.some(a => rs.some(b => a.top >= b.bottom - 2));
        if (spilled) {
          const lines = new Set(rs.map(r => Math.round(r.top))).size;
          const text = bs.map(label).join(' | ');
          found.set('R|' + at + '|' + text, { kind: 'row', at, text, rows: lines });
        }
      });
    });
  }
  let t = null;
  const go = () => { clearTimeout(t); t = setTimeout(() => { try { measure(); } catch (e) {} }, 120); };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(go).observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style'] });
    go();
  });
})();`;

let findings = [];
run({
  browserType: chromium, tag: 'layout walk',
  context: { viewport: { width: 390, height: 844 } },
  initScripts: [PROBE],
  /* --shots: a phone screenshot of each screen the first time it has a
     button finding, into shots-layout/ (never pushed). */
  onPage: !process.argv.some(a => /^--shots/.test(a)) ? null : async page => {
    if (process.argv.indexOf('--shots-all') >= 0) await page.addInitScript(() => { window.__layoutAll = true; });
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, 'shots-layout'); fs.mkdirSync(dir, { recursive: true });
    const done = new Set();
    await page.exposeFunction('__layoutShot', async at => {
      if (done.has(at)) return; done.add(at);
      const f = path.join(dir, String(done.size).padStart(2, '0') + '-' + at.replace(/[^\w]+/g, '_').slice(0, 50) + '.png');
      await page.screenshot({ path: f }).catch(() => {});
    });
  },
  after: async page => {
    await page.waitForTimeout(300);
    findings = await page.evaluate(() => [...(window.__layout || new Map()).values()]);
  }
}).then(() => {
  const by = k => findings.filter(f => f.kind === k);
  const H = by('header'), B = by('button'), R = by('row');
  console.log('\n  HEADERS NOT CENTERED: ' + H.length);
  const hc = {}; H.forEach(f => { hc[f.cls] = (hc[f.cls] || 0) + 1; });
  Object.keys(hc).sort((a, b) => hc[b] - hc[a]).forEach(k => console.log('    ' + k + ': ' + hc[k]));
  H.forEach(f => console.log('    ' + (f.off > 0 ? '+' : '') + f.off + 'px  ' + f.cls + '  "' + f.text + '"  @ ' + f.at));
  console.log('\n  BUTTON LABELS ON MORE THAN ONE LINE (or cut off): ' + B.length);
  B.forEach(f => console.log('    ' + f.lines + ' lines' + (f.clipped ? ', CUT OFF' : '') + ', ' + f.width + 'px  "' + f.text + '"  @ ' + f.at));
  console.log('\n  BUTTON ROWS SPILLING ONTO A SECOND LINE: ' + R.length);
  R.forEach(f => console.log('    ' + f.rows + ' rows  [' + f.text + ']  @ ' + f.at));
  const n = H.length + B.length + R.length;
  console.log(n ? '\n  ✖ layout: ' + n + ' finding(s)' : '\n  ✓ layout passed: headers centered, buttons on one line');
  process.exit(n ? 1 : 0);
}).catch(e => { console.log('  ✖ layout.js threw: ' + (e.stack || e.message)); process.exit(1); });
