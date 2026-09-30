// api/winners.js — scored scripts and the format library for the Winners tab.
//
//   /api/winners?team=<TEAM_KEY>&client=Duncan&days=30&format=short
//   client can be a name or "all". Add &fresh=1 to skip the 5-minute cache.
// Team view only: clients never see this.

import { STATS_DS, queryAll, teamOk, todayIST, daysAgoIST } from '../lib/notion.js';
import { normalizeRow, buildScripts, formatLibrary, WIN, FLOP, MIN_AGE, BREAKOUT } from '../lib/score.js';
import { CLIENTS, clientByName } from '../lib/clients.js';

const LOOKBACK_DAYS = 120;
const CACHE_MS = 5 * 60000;
let cache = null; // { at, rows }

async function allRows(fresh) {
  if (cache && !fresh && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const pages = await queryAll(STATS_DS(), {
    filter: { property: 'Posted', date: { on_or_after: daysAgoIST(LOOKBACK_DAYS) } },
    sorts: [{ property: 'Posted', direction: 'descending' }]
  });
  const rows = pages.map(normalizeRow);
  cache = { at: Date.now(), rows };
  return rows;
}

export default async function handler(req, res) {
  const q = req.query || {};
  if (!teamOk(q)) return res.status(401).json({ error: 'Open this page with your team link (it has ?team= in it).' });
  if (!process.env.NOTION_TOKEN || !process.env.STATS_DS) return res.status(500).json({ error: 'NOTION_TOKEN and STATS_DS must be set in Vercel' });

  const all = !q.client || String(q.client).toLowerCase() === 'all';
  const c = all ? null : clientByName(q.client);
  if (!all && !c) return res.status(400).json({ error: `No client called "${q.client}"` });
  const days = [7, 14, 21, 30, 60, 90].includes(+q.days) ? +q.days : 30;
  const format = q.format === 'long' ? 'long' : 'short';

  try {
    const today = todayIST();
    const rows = await allRows(!!q.fresh);
    const scripts = buildScripts(rows, today);
    const mine = scripts.filter(s => (all || s.client === c.name) && s.format === format);
    const inWindow = mine.filter(s => s.age <= days);
    // The library looks at the last 90 days whatever window is picked, so it has enough to go on.
    const library = formatLibrary(mine.filter(s => s.age <= 90));

    const ytRows = rows.filter(r => r.plat === 'yt' && (all || r.client === c.name));
    const topics = {};
    inWindow.forEach(s => s.topics.forEach(t => { topics[t] = (topics[t] || 0) + 1; }));

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      client: all ? 'all' : c.name,
      clients: CLIENTS.map(x => x.name),
      days, format,
      rules: { win: WIN, flop: FLOP, minAge: MIN_AGE, breakout: BREAKOUT },
      scripts: inWindow.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      library,
      topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
      analysis: { youtube: ytRows.length, analyzed: ytRows.filter(r => r.analyzed).length },
      syncedAt: new Date(cache.at).toISOString()
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
