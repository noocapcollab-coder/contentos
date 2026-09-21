// api/stats.js — returns one client's video stats from the CONTENT STATS
// Notion database (filled by n8n).
//
//   Team view:    /api/stats?client=Lindsay        (add &team=<TEAM_KEY> if TEAM_KEY is set)
//   Client link:  /api/stats?k=<portal key>        (locked to that one client)
//   Skip cache:   add &fresh=1
//
// Env vars in Vercel: NOTION_TOKEN, STATS_DS (the CONTENT STATS data source id),
// and optionally TEAM_KEY to stop outsiders opening the team view.

import { CLIENTS, clientByKey, clientByName } from '../lib/clients.js';

const NOTION = 'https://api.notion.com/v1';
const DAYS_BACK = 90;
const CACHE_MS = 60000;
const cache = new Map();

const headers = () => ({
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json'
});

const PLAT = { youtube: 'yt', tiktok: 'tt', instagram: 'ig', facebook: 'fb' };

// Case-insensitive property lookup, since Notion column casing drifts.
function prop(props, name) {
  const want = name.toLowerCase();
  for (const k in props) if (k.toLowerCase() === want) return props[k];
  return null;
}
const num = p => (p && typeof p.number === 'number' ? p.number : null);
const text = p => (p ? (p.title || p.rich_text || []).map(t => t.plain_text).join('') : '');
const choice = p => (p ? (p.select && p.select.name) || (p.status && p.status.name) || '' : '');
const dateOf = p => (p && p.date && p.date.start) || null;
function json(p, fallback) {
  try { const s = text(p); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function normalize(page) {
  const p = page.properties || {};
  let title = '';
  for (const k in p) if (p[k].type === 'title') { title = text(p[k]); break; }
  const platName = choice(prop(p, 'Platform')).toLowerCase();
  const urlProp = prop(p, 'URL');
  const history = json(prop(p, 'Views History'), []);
  const comments = json(prop(p, 'Top Comments'), []);
  return {
    id: page.id,
    title: title || 'Untitled video',
    plat: PLAT[platName] || 'ig',
    format: choice(prop(p, 'Format')).toLowerCase() || null,
    url: (urlProp && urlProp.url) || '',
    thumb: (prop(p, 'Thumbnail') || {}).url || '',
    duration: num(prop(p, 'Duration (sec)')),
    posted: dateOf(prop(p, 'Posted')),
    views: num(prop(p, 'Views')) || 0,
    likes: num(prop(p, 'Likes')),
    comments: num(prop(p, 'Comments')),
    shares: num(prop(p, 'Shares')),
    saves: num(prop(p, 'Saves')),
    watch: num(prop(p, 'Avg Watch (sec)')),
    history: Array.isArray(history) ? history : [],
    topComments: Array.isArray(comments) ? comments.slice(0, 3) : [],
    synced: dateOf(prop(p, 'Last Synced')) || page.last_edited_time
  };
}

async function fetchClient(name, since, until) {
  const rows = [];
  let cursor;
  do {
    const r = await fetch(`${NOTION}/data_sources/${process.env.STATS_DS}/query`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        filter: { and: [
          { property: 'Client', select: { equals: name } },
          { property: 'Posted', date: { on_or_after: since } },
          { property: 'Posted', date: { on_or_before: until } }
        ] },
        sorts: [{ property: 'Posted', direction: 'descending' }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {})
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j && j.message) || `Notion returned ${r.status}`);
    rows.push(...j.results.map(normalize));
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return rows;
}

export default async function handler(req, res) {
  if (!process.env.NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN is not set in Vercel' });
  if (!process.env.STATS_DS) return res.status(500).json({ error: 'STATS_DS is not set in Vercel' });

  const q = req.query || {};
  let client;
  let portal = false;

  if (q.k) {
    const c = clientByKey(String(q.k));
    if (!c) return res.status(403).json({ error: 'This link is no longer active. Ask your NOOCAP contact for a new one.' });
    client = c.name;
    portal = true;
  } else {
    if (process.env.TEAM_KEY && q.team !== process.env.TEAM_KEY) {
      return res.status(401).json({ error: 'Open this page with your team link (it has ?team= in it).' });
    }
    const c = q.client ? clientByName(q.client) : CLIENTS[0];
    if (!c) return res.status(400).json({ error: `No client called "${q.client}"` });
    client = c.name;
  }

  // Date window (IST). The page asks for its range plus the period before it.
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  let until = isDate(q.to) ? String(q.to) : today;
  let since = isDate(q.from) ? String(q.from) : new Date(Date.parse(until) - DAYS_BACK * 864e5).toISOString().slice(0, 10);
  if (since > until) [since, until] = [until, since];
  const ckey = `${client}|${since}|${until}`;

  try {
    const hit = cache.get(ckey);
    let videos;
    if (hit && !q.fresh && Date.now() - hit.at < CACHE_MS) videos = hit.videos;
    else {
      videos = await fetchClient(client, since, until);
      if (cache.size > 200) cache.clear();
      cache.set(ckey, { at: Date.now(), videos });
    }
    const syncedAt = videos.reduce((m, v) => (v.synced && v.synced > m ? v.synced : m), '') || null;
    res.setHeader('Cache-Control', 'private, max-age=0');
    return res.status(200).json({
      client,
      portal,
      clients: portal ? [client] : CLIENTS.map(c => c.name),
      syncedAt,
      videos
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
