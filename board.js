/* THE LEADERBOARD tabs of live.html, the one page for everyone in a round
 * (BZ, 2026-10-05). Its own file so the board's look lives in one place.
 *
 * The rows are worked out by the app (liveUnitPayload) and published; this
 * draws them and nothing else. It uses the page's esc() - the app's own,
 * copied into both pages by pages.py.
 *
 *   MGBoard.views(data)                    the published views
 *   MGBoard.tabs(views, active, handler)   the view tabs (handler is a global function name)
 *   MGBoard.table(view)                    the table for one view
 */
(function () {
  'use strict';
  const css = [
    'table.mgb{width:100%;border-collapse:collapse;font-size:13px;}',
    '.mgb td{padding:8px 6px;border-bottom:1px solid var(--surf3);}',
    '.mgb td.pos{width:34px;text-align:center;color:var(--muted);font-size:12px;}',
    '.mgb td.name{font-weight:600;}',
    '.mgb td.pri{text-align:center;font-weight:700;}',
    '.mgb tr.lead td.name{font-weight:700;}',
    '.mgb tr.lead td.pri{color:var(--gold);font-size:15px;}',
    '.mgb td.sec{text-align:right;color:var(--muted);font-size:11px;white-space:nowrap;}',
    '.mgb th{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;padding:4px 4px 6px;border-bottom:2px solid var(--surf3);text-align:left;}',
    '.mgb th.num,.mgb td.num{text-align:center;padding-left:3px;padding-right:3px;white-space:nowrap;}',
    '.mgb td.num{font-variant-numeric:tabular-nums;}',
    '.mgb th.pos{text-align:center;}',
    '.mgb-tabs{display:flex;gap:6px;margin-bottom:8px;}',
    '.mgb-tabs .tab{flex:1;text-align:center;}',
    '.mgb-msg{color:var(--muted);text-align:center;padding:36px 12px;line-height:1.5;}'
  ].join('\n');
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // Positions arrive as text ('1', 'T3'): a medal for an untied 1-3, the label otherwise.
  const medal = p => { const q = String(p); return q === '1' ? '🥇' : q === '2' ? '🥈' : q === '3' ? '🥉' : esc(q); };

  function views(d) { return (d && (d.views || (d.rows ? [{ id: 'main', label: '', rows: d.rows }] : []))) || []; }

  function tabs(vs, active, handler) {
    return vs.map((v, i) => '<div class="tab holes-toggle ' + (i === active ? 'active' : '') + '" onclick="' + handler + '(' + i + ')">'
      + esc(v.label) + '</div>').join('');
  }

  /* COLUMNS, like a pro leaderboard with one more (BZ: "Gross, Net, +/- would
     be the three columns. Not random text."). A view that names its cols gets
     a header row and one cell per value; the +/- column decides, so it carries
     the leader's gold. A view without cols (outing, season) keeps two columns. */
  function table(v) {
    v = v || {};
    const cols = v.cols || null;
    const key = cols ? cols.findIndex(c => /^\+\//.test(c) || c === 'Pts') : -1;
    const rows = (v.rows || []).map((r, i) => {
      const lead = i === 0 ? ' class="lead"' : '';
      if (cols && r.vals) {
        return '<tr' + lead + '><td class="pos">' + medal(r.pos) + '</td><td class="name">' + esc(r.name) + '</td>'
          + r.vals.map((x, j) => '<td class="num' + (j === key ? ' pri' : '') + '">' + esc(x) + '</td>').join('') + '</tr>';
      }
      return '<tr' + lead + '><td class="pos">' + medal(r.pos) + '</td><td class="name">' + esc(r.name)
        + '</td><td class="pri">' + esc(r.primary) + '</td><td class="sec">' + esc(r.secondary || '') + '</td></tr>';
    }).join('');
    const head = cols ? '<thead><tr><th class="pos">Pos</th><th class="name">Player</th>'
      + cols.map(c => '<th class="num">' + esc(c) + '</th>').join('') + '</tr></thead>' : '';
    return rows ? '<table class="mgb">' + head + '<tbody>' + rows + '</tbody></table>'
      : '<div class="mgb-msg">No scores posted yet.</div>';
  }

  window.MGBoard = { views, tabs, table, medal };
})();
