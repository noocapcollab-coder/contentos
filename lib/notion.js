// lib/notion.js — small shared helpers for talking to Notion.
// api/stats.js keeps its own copy of these so the live dashboard is untouched;
// the Winners endpoints (winners, analyze, transcript) use this file.

export const NOTION = 'https://api.notion.com/v1';
export const STATS_DS = () => process.env.STATS_DS;
export const FORMATS_DS = () => process.env.FORMATS_DS || 'c609afd5-4491-4b83-96ad-38b5accc8f54';

export const headers = () => ({
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json'
});

// Case-insensitive property lookup, since Notion column casing drifts.
export function prop(props, name) {
  const want = name.toLowerCase();
  for (const k in props) if (k.toLowerCase() === want) return props[k];
  return null;
}
export const num = p => (p && typeof p.number === 'number' ? p.number : null);
export const text = p => (p ? (p.title || p.rich_text || []).map(t => t.plain_text).join('') : '');
export const choice = p => (p ? (p.select && p.select.name) || (p.status && p.status.name) || '' : '');
export const multi = p => (p && Array.isArray(p.multi_select) ? p.multi_select.map(o => o.name) : []);
export const dateOf = p => (p && p.date && p.date.start) || null;

// Notion caps each rich-text chunk at 2000 characters.
export function rt(s) {
  s = String(s == null ? '' : s);
  const out = [];
  for (let i = 0; i < s.length && out.length < 50; i += 1900) out.push({ type: 'text', text: { content: s.slice(i, i + 1900) } });
  return { rich_text: out };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// fetch with a retry on Notion's rate limit (429) and brief 5xx blips.
export async function notion(path, method, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${NOTION}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await wait(600 * (attempt + 1)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j && j.message) || `Notion returned ${r.status}`);
    return j;
  }
  throw new Error('Notion kept rate-limiting, try again in a minute');
}

// Every page of a data source query.
export async function queryAll(ds, body, maxPages = 30) {
  const rows = [];
  let cursor;
  let pages = 0;
  do {
    const j = await notion(`/data_sources/${ds}/query`, 'POST', { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) });
    rows.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : null;
    pages++;
  } while (cursor && pages < maxPages);
  return rows;
}

export const patchPage = (id, properties) => notion(`/pages/${id}`, 'PATCH', { properties });
export const createPage = (ds, properties) =>
  notion('/pages', 'POST', { parent: { type: 'data_source_id', data_source_id: ds }, properties });

// Team gate shared by the Winners endpoints (same rule as api/stats.js).
export function teamOk(q) {
  return !process.env.TEAM_KEY || q.team === process.env.TEAM_KEY;
}

// Today's date in IST, as YYYY-MM-DD.
export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const daysAgoIST = n => new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
