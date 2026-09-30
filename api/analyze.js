// api/analyze.js — reads new YouTube videos and fills in the hook analysis.
//
//   Batch:    /api/analyze?team=<TEAM_KEY>&n=6        (the Winners tab loops this)
//   Library:  /api/analyze?team=<TEAM_KEY>&formats=1  (rebuilds WINNING FORMATS)
//   Cron:     every day from vercel.json (batch at 2am IST, library at 3am IST;
//             Vercel crons use UTC, so the file says 20:30 and 21:30 UTC).
//             Anything a run can't finish in time is picked up by the next run
//             or by the Winners tab button.
//
// For each YouTube row with no "Analyzed" date: pull the transcript for free,
// ask Claude Haiku for topic, hook line, hook type, structure and why it works,
// and write it all back to that row in CONTENT STATS.
//
// Env vars: NOTION_TOKEN, STATS_DS, ANTHROPIC_API_KEY. Optional: TEAM_KEY,
// CRON_SECRET, FORMATS_DS (defaults to the WINNING FORMATS database), ANALYZE_MODEL.

import { STATS_DS, FORMATS_DS, queryAll, patchPage, createPage, rt, teamOk, todayIST, daysAgoIST, prop, text } from '../lib/notion.js';
import { normalizeRow, buildScripts, formatLibrary } from '../lib/score.js';
import { TOPICS, HOOK_TYPES } from '../lib/topics.js';
import { fetchTranscript, youtubeId } from '../lib/youtube.js';

const LOOKBACK_DAYS = 120;
const TIME_BUDGET_MS = 42000; // stop starting new videos after this (functions cap at 60s)

function isCron(req) {
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET) return auth === `Bearer ${process.env.CRON_SECRET}`;
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

const SYSTEM = `You analyse short-form video scripts for an AI content agency. You reply with one JSON object and nothing else.
Write every text field in plain, natural English that sounds like a person talking. Never stack three parallel items, never write "it's not X, it's Y", and never chain short choppy fragments.`;

function prompt(v, transcript) {
  const hooks = Object.entries(HOOK_TYPES).map(([k, d]) => `- ${k}: ${d}`).join('\n');
  return `Creator: ${v.client}
Title: ${v.title}
Length: ${v.duration ? Math.round(v.duration) + ' seconds' : 'unknown'} (${v.format}-form)
${transcript ? `Transcript:\n"""${transcript.slice(0, 6000)}"""` : 'Transcript: not available, judge from the title only.'}

Topics, choose 1 or 2 from this list only: ${TOPICS.join(', ')}.
If nothing fits, use ["Other"] and write a short new topic name in topic_suggestion.

Hook types, choose exactly one:
${hooks}

Return JSON with these keys:
{"topics": [], "topic_suggestion": "", "hook_line": "the opening spoken line(s) that form the hook, copied word for word, at most 30 words", "hook_type": "", "structure": "the beat order after the hook as short steps joined with →, e.g. Bold claim → proof number → how it works → surprise feature → CTA", "why": "one or two sentences on the lever the hook pulls on the viewer (curiosity gap, fear of missing out, a surprising number and so on) and how the script keeps them watching"}
${transcript ? '' : 'Without a transcript leave hook_line, structure and why as empty strings.'}`;
}

async function askClaude(content) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      // Only needed for keys that aren't tied to a workspace.
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {})
    },
    body: JSON.stringify({
      model: process.env.ANALYZE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: 'user', content }]
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Anthropic: ' + ((j.error && j.error.message) || r.status));
  const out = (j.content || []).map(c => c.text || '').join('');
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude did not return JSON');
  return JSON.parse(m[0]);
}

async function analyzeOne(v) {
  let transcript = v.transcript;
  let captions = 'ok';
  if (!transcript) {
    try {
      transcript = (await fetchTranscript(youtubeId(v.key || v.url))).text;
    } catch (e) {
      if (e.kind !== 'none') throw e; // blocked, bad key, out of credit: stop, don't mark as analysed
      captions = 'none';
      transcript = '';
    }
  }
  const a = await askClaude(prompt(v, transcript));
  const topics = (Array.isArray(a.topics) ? a.topics : []).filter(t => TOPICS.includes(t)).slice(0, 2);
  const hookType = HOOK_TYPES[a.hook_type] ? a.hook_type : null;
  const words = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const props = {
    Topic: { multi_select: (topics.length ? topics : ['Other']).map(name => ({ name })) },
    'Topic Suggestion': rt(a.topic_suggestion || ''),
    'Hook Line': rt(captions === 'none' ? '' : a.hook_line || ''),
    'Structure': rt(captions === 'none' ? '' : a.structure || ''),
    'Why It Worked': rt(captions === 'none' ? 'No captions on YouTube, so only the topic was tagged.' : a.why || ''),
    'Hook Type': { select: captions === 'none' || !hookType ? null : { name: hookType } },
    'Words per sec': { number: words && v.duration ? +(words / v.duration).toFixed(2) : null },
    Analyzed: { date: { start: todayIST() } }
  };
  if (transcript && !v.transcript) props.Transcript = rt(transcript.slice(0, 1900));
  await patchPage(v.id, props);
  return { id: v.id, title: v.title, client: v.client, hookType: props['Hook Type'].select ? hookType : null, captions };
}

async function runBatch(q, started, cron) {
  // The button asks for small batches so the page can show progress; a cron run
  // takes as many as fit in the time budget (two or three days of new videos).
  const n = cron ? 40 : Math.min(Math.max(parseInt(q.n, 10) || 6, 1), 12);
  // One video at a time: Supadata's small plans allow about one request a second.
  const lanes = 1;
  const filter = { and: [
    { property: 'Platform', select: { equals: 'YouTube' } },
    { property: 'Analyzed', date: { is_empty: true } },
    { property: 'Posted', date: { on_or_after: daysAgoIST(LOOKBACK_DAYS) } }
  ] };
  if (q.client) filter.and.push({ property: 'Client', select: { equals: String(q.client) } });
  const pages = await queryAll(STATS_DS(), { filter, sorts: [{ property: 'Posted', direction: 'descending' }], page_size: n + 1 }, 1);
  const todo = pages.map(normalizeRow);
  const batch = todo.slice(0, n);
  const done = [], errors = [];
  let blocked = null;
  for (let i = 0; i < batch.length; i += lanes) {
    if (Date.now() - started > TIME_BUDGET_MS || blocked) break;
    const results = await Promise.allSettled(batch.slice(i, i + lanes).map(analyzeOne));
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') done.push(r.value);
      else if (r.reason && r.reason.kind === 'blocked') blocked = String(r.reason.message);
      else errors.push({ title: batch[i + k].title, error: String((r.reason && r.reason.message) || r.reason) });
    });
    if (errors.some(e => /Anthropic|Supadata/.test(e.error))) break; // bad key or out of credit: stop early
  }
  return { done, errors, blocked, more: todo.length > done.length && !blocked };
}

async function rebuildLibrary() {
  const pages = await queryAll(STATS_DS(), { filter: { property: 'Posted', date: { on_or_after: daysAgoIST(LOOKBACK_DAYS) } } });
  const scripts = buildScripts(pages.map(normalizeRow), todayIST()).filter(s => s.age <= 90);
  const lib = formatLibrary(scripts);

  const existing = await queryAll(FORMATS_DS(), {});
  const byKey = new Map();
  for (const p of existing) byKey.set(text(prop(p.properties || {}, 'Key')), p.id);

  let written = 0;
  const jobs = lib.map(f => async () => {
    const props = {
      Format: { title: [{ type: 'text', text: { content: `${f.client} · ${f.hookType}` } }] },
      Client: { select: { name: f.client } },
      'Hook Type': { select: { name: f.hookType } },
      Status: { select: { name: f.status } },
      Confidence: { select: { name: f.confidence } },
      Videos: { number: f.videos }, Wins: { number: f.wins }, Flops: { number: f.flops },
      'Avg Score': { number: f.avgScore },
      'Typical Structure': rt(f.structure),
      'Best Hook': rt(f.bestHook),
      'Best Example': { url: f.bestUrl || null },
      'Why It Works': rt(f.why),
      'Avg Words per sec': { number: f.wps },
      Topics: rt(f.topics.join(', ')),
      Key: rt(f.key),
      Updated: { date: { start: todayIST() } }
    };
    const id = byKey.get(f.key);
    if (id) await patchPage(id, props); else await createPage(FORMATS_DS(), props);
    written++;
  });
  for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(j => j()));
  return { formats: lib.length, written, scripts: scripts.length };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const cron = isCron(req);
  if (!cron && !teamOk(q)) return res.status(401).json({ error: 'Open this with your team link (it has ?team= in it).' });
  if (!process.env.NOTION_TOKEN || !process.env.STATS_DS) return res.status(500).json({ error: 'NOTION_TOKEN and STATS_DS must be set in Vercel' });
  const started = Date.now();
  try {
    if (q.formats) return res.status(200).json({ ok: true, ...(await rebuildLibrary()) });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel' });
    const out = await runBatch(q, started, cron);
    return res.status(200).json({ ok: true, ms: Date.now() - started, ...out });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
