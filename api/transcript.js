// api/transcript.js — test the free transcript fetcher from Vercel.
//   /api/transcript?v=<YouTube id or URL>&team=<TEAM_KEY>
// Returns the spoken words, or why it couldn't get them ("blocked" means
// YouTube is refusing Vercel's servers and we need the fallback).

import { teamOk } from '../lib/notion.js';
import { fetchTranscript, youtubeId } from '../lib/youtube.js';

export default async function handler(req, res) {
  const q = req.query || {};
  if (!teamOk(q)) return res.status(401).json({ error: 'Open this with your team link (it has ?team= in it).' });
  const id = youtubeId(q.v || 'yt:9OBRowVcTYs');
  if (!id) return res.status(400).json({ error: 'Pass ?v= with a YouTube video id or link' });
  const t0 = Date.now();
  try {
    const t = await fetchTranscript(id);
    return res.status(200).json({ ok: true, source: t.source || 'free', video: id, ms: Date.now() - t0, words: t.text.split(/\s+/).length, lang: t.lang, auto: t.auto, text: t.text });
  } catch (e) {
    return res.status(200).json({ ok: false, video: id, ms: Date.now() - t0, kind: e.kind || 'error', error: String(e.message || e) });
  }
}
