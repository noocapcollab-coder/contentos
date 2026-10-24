// api/highlights.js — the simple "what worked" view for one creator:
// their most-viewed videos ever, in the last 30 days and in the last 10 days.
//
//   Team view:    /api/highlights?client=Chris&team=<TEAM_KEY>
//   Client link:  /api/highlights?k=<portal key>   (locked to that one creator)
//
// Each list holds the top 15 by views across all platforms; the page filters by
// platform and format and shows the first few.

import { STATS_DS, notion, teamOk, daysAgoIST } from '../lib/notion.js';
import { normalizeRow } from '../lib/score.js';
import { clientByKey, clientByName } from '../lib/clients.js';

const CACHE_MS = 5 * 60000;
const cache = new Map();

async function top(client, since) {
  const filter = { and: [{ property: 'Client', select: { equals: client } }] };
  if (since) filter.and.push({ property: 'Posted', date: { on_or_after: since } });
  const j = await notion(`/data_sources/${STATS_DS()}/query`, 'POST', {
    filter, sorts: [{ property: 'Views', direction: 'descending' }], page_size: 15
  });
  return (j.results || []).map(normalizeRow).map(v => ({
    id: v.id, title: v.title, plat: v.plat, format: v.format, url: v.url, thumb: v.thumb,
    posted: v.posted, views: v.views, likes: v.likes, comments: v.comments, shares: v.shares
  }));
}

export default async function handler(req, res) {
  const q = req.query || {};
  if (!process.env.NOTION_TOKEN || !process.env.STATS_DS) return res.status(500).json({ error: 'NOTION_TOKEN and STATS_DS must be set in Vercel' });
  let c;
  if (q.k) {
    c = clientByKey(String(q.k));
    if (!c) return res.status(403).json({ error: 'This link is no longer active. Ask your NOOCAP contact for a new one.' });
  } else {
    if (!teamOk(q)) return res.status(401).json({ error: 'Open this page with your team link (it has ?team= in it).' });
    c = clientByName(q.client);
    if (!c) return res.status(400).json({ error: `No client called "${q.client}"` });
  }

  try {
    const hit = cache.get(c.name);
    let data;
    if (hit && !q.fresh && Date.now() - hit.at < CACHE_MS) data = hit.data;
    else {
      const [ever, d30, d10] = await Promise.all([top(c.name, null), top(c.name, daysAgoIST(30)), top(c.name, daysAgoIST(10))]);
      data = { client: c.name, ever, d30, d10 };
      cache.set(c.name, { at: Date.now(), data });
    }
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
