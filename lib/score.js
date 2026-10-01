// lib/score.js — turns CONTENT STATS rows into scored "scripts".
//
// One reel is posted to up to four platforms, and each post is its own row.
// Instagram and Facebook titles are just the "Comment X" caption, so rows are
// grouped back into one script by creator + posting day, using the YouTube
// Short as the anchor (it carries the real title and the transcript).
//
// Scoring: each post's views are divided by that creator's median views on the
// same platform and format, so big and small creators are judged fairly and
// Instagram isn't compared against YouTube. The script's score is the average
// of those ratios. Posts younger than MIN_AGE days get no verdict yet.

import { prop, num, text, choice, multi, dateOf } from './notion.js';

export const MIN_AGE = 3;        // days before a post is judged at all
export const SETTLED_AGE = 7;    // younger than this is marked "early"
export const WIN = 1.5;          // score at or above = winner
export const FLOP = 0.6;         // score at or below = underperformed
export const BREAKOUT = 3;       // one platform at 3x usual or more also counts as a winner
const BASELINE_DAYS = 90;        // medians use posts from this far back
const MIN_SAMPLE = 4;            // need this many posts for a median

const PLAT = { youtube: 'yt', tiktok: 'tt', instagram: 'ig', facebook: 'fb' };

export function normalizeRow(page) {
  const p = page.properties || {};
  let title = '';
  for (const k in p) if (p[k].type === 'title') { title = text(p[k]); break; }
  const plat = PLAT[choice(prop(p, 'Platform')).toLowerCase()] || 'ig';
  const fmt = choice(prop(p, 'Format')).toLowerCase() || (plat === 'ig' || plat === 'tt' ? 'short' : 'long');
  return {
    id: page.id,
    client: choice(prop(p, 'Client')),
    plat,
    format: fmt === 'long' ? 'long' : 'short',
    title: title || '',
    url: (prop(p, 'URL') || {}).url || '',
    thumb: (prop(p, 'Thumbnail') || {}).url || '',
    key: text(prop(p, 'Video Key')),
    posted: (dateOf(prop(p, 'Posted')) || '').slice(0, 10),
    duration: num(prop(p, 'Duration (sec)')),
    views: num(prop(p, 'Views')) || 0,
    likes: num(prop(p, 'Likes')),
    comments: num(prop(p, 'Comments')),
    shares: num(prop(p, 'Shares')),
    saves: num(prop(p, 'Saves')),
    transcript: text(prop(p, 'Transcript')),
    topics: multi(prop(p, 'Topic')),
    topicSuggestion: text(prop(p, 'Topic Suggestion')),
    hookLine: text(prop(p, 'Hook Line')),
    hookType: choice(prop(p, 'Hook Type')),
    structure: text(prop(p, 'Structure')),
    why: text(prop(p, 'Why It Worked')),
    wps: num(prop(p, 'Words per sec')),
    analyzed: dateOf(prop(p, 'Analyzed'))
  };
}

const dayMs = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const ageOf = (posted, today) => (posted ? Math.round((dayMs(today) - dayMs(posted)) / 864e5) : 9999);
const median = a => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const eng = r => (r.likes || 0) + (r.comments || 0) + (r.shares || 0) + (r.saves || 0);

// Words that appear in captions all the time and say nothing about the topic.
const STOP = new Set(('comment comments type drop send sending link links full free guide video videos here your youre '
  + 'with this that from what will ill dm the and for you get all check bio breakdown watch exact over setup '
  + 'want just into have more make made using about them they their then than code claude like').split(' '));
const tokens = s => new Set(String(s || '').toLowerCase().replace(/https?:\S+/g, ' ')
  .replace(/[^a-z0-9$ ]+/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };
const capKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);

const GENERIC = /^((facebook|instagram) reel)?$/i;
// Same reel = same length on every platform (give or take a second or two).
const durClose = (a, b) => a != null && b != null && Math.abs(a - b) <= 2;
const clusterDur = c => { const d = c.map(r => r.duration).filter(x => x != null); return d.length ? d[0] : null; };

// Drop re-uploads and double-synced rows.
function dedupe(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = `${r.client}|${r.plat}|${r.format}|${r.posted}|${capKey(r.title) || r.key}`;
    const cur = best.get(k);
    if (!cur || r.views > cur.views) best.set(k, r);
  }
  let out = [...best.values()];
  // Facebook sometimes lands twice: once as "Facebook reel" with rounded views and
  // once with the real caption. Keep the captioned one when both are the same length.
  out = out.filter(r => !(GENERIC.test(r.title.trim()) && out.some(o =>
    o !== r && o.client === r.client && o.plat === r.plat && o.posted === r.posted && !GENERIC.test(o.title.trim())
    && (durClose(o.duration, r.duration) || (r.duration == null && Math.abs(o.views - r.views) <= o.views * 0.05)))));
  return out;
}

// Median views per creator + platform + format, from settled posts only.
export function baselines(rows, today) {
  const groups = new Map();
  for (const r of rows) {
    const age = ageOf(r.posted, today);
    if (age < SETTLED_AGE || age > BASELINE_DAYS) continue;
    const k = `${r.client}|${r.plat}|${r.format}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.views);
  }
  const out = {};
  for (const [k, v] of groups) if (v.length >= MIN_SAMPLE) out[k] = { median: median(v), n: v.length };
  return out;
}

function makeScript(anchor, members) {
  const all = [anchor, ...members].filter(Boolean);
  const yt = all.find(r => r.plat === 'yt');
  const titled = yt || all.find(r => r.plat === 'tt') || all.find(r => r.plat === 'ig') || all[0];
  return {
    id: (yt || all[0]).key || (yt || all[0]).id,
    client: all[0].client,
    posted: all.map(r => r.posted).sort()[0],
    format: all[0].format,
    title: titled.title && !/^(facebook|instagram) reel$/i.test(titled.title.trim())
      ? titled.title : `Untitled ${titled.plat === 'fb' ? 'Facebook' : 'Instagram'} reel (no caption)`,
    thumb: (yt && yt.thumb) || (all.find(r => r.thumb) || {}).thumb || '',
    duration: (yt && yt.duration) || (all.find(r => r.duration) || {}).duration || null,
    anchorId: yt ? yt.id : null,
    members: all
  };
}

// Group one creator's rows into scripts.
function groupClient(rows) {
  const scripts = [];
  const byDay = new Map();
  for (const r of rows) {
    if (r.format === 'long') { scripts.push(makeScript(r, [])); continue; }
    if (!byDay.has(r.posted)) byDay.set(r.posted, []);
    byDay.get(r.posted).push(r);
  }
  for (const dayRows of byDay.values()) {
    const anchors = dayRows.filter(r => r.plat === 'yt');
    // Instagram and Facebook with the same caption are the same reel.
    const clusters = [];
    const byCap = new Map();
    for (const r of dayRows) {
      if (r.plat === 'yt') continue;
      const ck = (r.plat === 'ig' || r.plat === 'fb') && capKey(r.title) ? capKey(r.title) : null;
      if (ck && byCap.has(ck) && !byCap.get(ck).some(x => x.plat === r.plat)) { byCap.get(ck).push(r); continue; }
      const c = [r];
      clusters.push(c);
      if (ck) byCap.set(ck, c);
    }
    const slots = anchors.map(a => ({ a, members: [], plats: new Set(['yt']) }));
    // A cluster can join a Short if the platforms don't clash and the lengths don't disagree.
    const fitsSlot = (c, s) => c.every(r => !s.plats.has(r.plat))
      && !(clusterDur(c) != null && s.a.duration != null && !durClose(clusterDur(c), s.a.duration));
    const loose = [];
    for (const c of clusters) {
      const ct = tokens(c.map(r => r.title).join(' '));
      let pick = null, best = 0;
      for (const s of slots) {
        if (!fitsSlot(c, s)) continue;
        // Matching length is strong evidence; shared words in caption/transcript break ties.
        const score = (durClose(clusterDur(c), s.a.duration) ? 10 : 0) + overlap(ct, tokens(s.a.title + ' ' + (s.a.transcript || '')));
        if (score > best) { best = score; pick = s; }
      }
      if (!pick && slots.length === 1 && fitsSlot(c, slots[0])) pick = slots[0];
      if (pick) { pick.members.push(...c); c.forEach(r => pick.plats.add(r.plat)); }
      else loose.push(c);
    }
    // Elimination: a leftover reel that fits only one remaining Short goes there.
    for (let changed = true; changed && slots.length > 1;) {
      changed = false;
      for (let i = loose.length - 1; i >= 0; i--) {
        const c = loose[i];
        const fits = slots.filter(s => fitsSlot(c, s));
        if (fits.length === 1) {
          fits[0].members.push(...c);
          c.forEach(r => fits[0].plats.add(r.plat));
          loose.splice(i, 1);
          changed = true;
        }
      }
    }
    for (const s of slots) scripts.push(makeScript(s.a, s.members));
    // No anchor to hang on: merge loose clusters while their platforms don't clash.
    const merged = [];
    for (const c of loose) {
      const into = anchors.length ? null : merged.find(m => c.every(r => !m.some(x => x.plat === r.plat))
        && !(clusterDur(c) != null && clusterDur(m) != null && !durClose(clusterDur(c), clusterDur(m))));
      if (into) into.push(...c); else merged.push([...c]);
    }
    for (const m of merged) scripts.push(makeScript(null, m));
  }
  return scripts;
}

// rows: normalized rows (any creators). Returns every script, scored.
export function buildScripts(rows, today) {
  const clean = dedupe(rows.filter(r => r.client && r.posted));
  const base = baselines(clean, today);
  const byClient = new Map();
  for (const r of clean) {
    if (!byClient.has(r.client)) byClient.set(r.client, []);
    byClient.get(r.client).push(r);
  }
  const scripts = [];
  for (const list of byClient.values()) scripts.push(...groupClient(list));

  for (const s of scripts) {
    s.age = ageOf(s.posted, today);
    s.early = s.age < SETTLED_AGE;
    let views = 0, engs = 0, engViews = 0;
    const ratios = [];
    s.platforms = s.members.map(r => {
      const b = base[`${r.client}|${r.plat}|${r.format}`];
      const ratio = b && b.median > 0 && s.age >= MIN_AGE ? r.views / b.median : null;
      if (ratio != null) ratios.push(ratio);
      views += r.views;
      if (r.likes != null) { engs += eng(r); engViews += r.views; }
      return {
        id: r.id, plat: r.plat, views: r.views, url: r.url, key: r.key,
        er: r.likes != null && r.views ? +(eng(r) / r.views * 100).toFixed(1) : null,
        ratio: ratio == null ? null : +ratio.toFixed(2),
        median: b ? Math.round(b.median) : null
      };
    }).sort((a, b) => b.views - a.views);
    s.views = views;
    s.er = engViews ? +(engs / engViews * 100).toFixed(1) : null;
    // Geometric mean, so one platform spiking doesn't make the whole script a winner.
    s.score = ratios.length
      ? +Math.exp(ratios.reduce((t, x) => t + Math.log(Math.max(x, 0.01)), 0) / ratios.length).toFixed(2)
      : null;
    s.best = s.platforms.filter(p => p.ratio != null).sort((a, b) => b.ratio - a.ratio)[0] || null;
    // A reel that goes viral on one platform is a winner even if the others were flat.
    s.breakout = s.best && s.best.ratio >= BREAKOUT && s.score != null && s.score < WIN ? s.best.plat : null;
    s.verdict = s.score == null ? (s.age < MIN_AGE ? 'new' : 'unscored')
      : s.score >= WIN || s.breakout ? 'win' : s.score <= FLOP ? 'flop' : 'ok';

    // Hook analysis lives on the YouTube row, or on whichever row was analysed
    // directly (an Instagram/TikTok reel with no matching Short).
    const a = s.members.find(r => r.id === s.anchorId && r.analyzed) || s.members.find(r => r.analyzed)
      || s.members.find(r => r.id === s.anchorId) || {};
    // The row the "Analyse this video" button reads: the Short, else TikTok, Instagram, Facebook.
    const rank = { yt: 0, tt: 1, ig: 2, fb: 3 };
    const target = s.members.filter(r => r.plat === 'yt' || r.url).sort((x, y) => rank[x.plat] - rank[y.plat])[0];
    s.analyzeId = target ? target.id : null;
    s.analyzePlat = target ? target.plat : null;
    s.analyzed = !!a.analyzed;
    s.analyzedPlat = a.analyzed ? a.plat : null;
    s.analyzedOn = a.analyzed || null;
    s.hookLine = a.hookLine || '';
    s.hookType = a.hookType || '';
    s.structure = a.structure || '';
    s.why = a.why || '';
    s.wps = a.wps || null;
    s.topics = a.topics || [];
    s.topicSuggestion = a.topicSuggestion || '';
    s.transcript = a.transcript || '';
    delete s.members;
  }
  return scripts;
}

// Re-judge scripts on one platform only (yt/tt/ig/fb): the score becomes that
// platform's views vs the creator's usual there, so "Instagram" shows what works on Instagram.
export function platformView(scripts, plat) {
  if (!plat || plat === 'all') return scripts;
  return scripts.map(s => {
    const p = s.platforms.find(x => x.plat === plat);
    if (!p) return null;
    const score = p.ratio;
    return Object.assign({}, s, {
      score, best: p, breakout: null,
      views: p.views, er: p.er,
      verdict: score == null ? (s.age < MIN_AGE ? 'new' : 'unscored') : score >= WIN ? 'win' : score <= FLOP ? 'flop' : 'ok'
    });
  }).filter(Boolean);
}

// Per creator + hook type: how that format has performed.
export function formatLibrary(scripts) {
  const groups = new Map();
  for (const s of scripts) {
    if (!s.hookType || s.score == null) continue;
    const k = `${s.client}|${s.hookType}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const out = [];
  for (const [k, list] of groups) {
    const [client, hookType] = k.split('|');
    const n = list.length;
    const wins = list.filter(s => s.verdict === 'win').length;
    const flops = list.filter(s => s.verdict === 'flop').length;
    const avg = list.reduce((t, s) => t + s.score, 0) / n;
    const best = list.slice().sort((a, b) => b.score - a.score)[0];
    const wpsList = list.map(s => s.wps).filter(Boolean);
    const topicCount = {};
    list.forEach(s => s.topics.forEach(t => { topicCount[t] = (topicCount[t] || 0) + 1; }));
    const status = avg >= 1.25 && wins >= 2 ? 'Use' : (avg < 0.75 && n >= 3) ? 'Avoid' : 'Test';
    out.push({
      key: k, client, hookType, status,
      confidence: n >= 6 ? 'High' : n >= 3 ? 'Medium' : 'Low',
      videos: n, wins, flops, avgScore: +avg.toFixed(2),
      bestHook: best.hookLine, bestTitle: best.title,
      bestUrl: (best.platforms.find(p => p.plat === 'yt') || best.platforms[0] || {}).url || '',
      structure: best.structure, why: best.why,
      wps: wpsList.length ? +(wpsList.reduce((t, x) => t + x, 0) / wpsList.length).toFixed(1) : null,
      topics: Object.entries(topicCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0])
    });
  }
  const rank = { Use: 0, Test: 1, Avoid: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.avgScore - a.avgScore);
}
