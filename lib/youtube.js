// lib/youtube.js — free YouTube transcript fetcher (no API key).
//
// Uses the same public caption tracks the YouTube player loads. YouTube
// sometimes blocks cloud servers from this; when that happens the error says
// "blocked" so the analyzer stops and reports it instead of burning retries.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class TranscriptError extends Error {
  constructor(msg, kind) { super(msg); this.kind = kind; } // kind: 'none' | 'blocked' | 'error'
}

const decode = s => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function pickTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const en = t => /^en/i.test(t.languageCode || '');
  return tracks.find(t => en(t) && t.kind !== 'asr') || tracks.find(en) || tracks.find(t => t.kind !== 'asr') || tracks[0];
}

async function readTrack(baseUrl) {
  const url = baseUrl.replace(/&fmt=[^&]+/, '');
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  const xml = await r.text();
  if (!r.ok || !xml) return '';
  const parts = [];
  // Classic format: <text start="" dur="">...</text>; newer srv3: <p t="" d=""><s>..</s></p>
  xml.replace(/<text[^>]*>([\s\S]*?)<\/text>/g, (_, t) => { parts.push(decode(t)); return ''; });
  if (!parts.length) xml.replace(/<p [^>]*>([\s\S]*?)<\/p>/g, (_, t) => { parts.push(decode(t)); return ''; });
  return parts.filter(Boolean).join(' ').replace(/\[(music|applause|laughter)\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function tracksViaPlayer(videoId, apiKey) {
  const clients = [
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34 },
    { clientName: 'WEB', clientVersion: '2.20250312.04.00' }
  ];
  for (const client of clients) {
    try {
      const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ context: { client: { ...client, hl: 'en', gl: 'US' } }, videoId })
      });
      const j = await r.json().catch(() => null);
      const status = j && j.playabilityStatus && j.playabilityStatus.status;
      if (status === 'LOGIN_REQUIRED' && /bot/i.test(JSON.stringify(j.playabilityStatus))) throw new TranscriptError('YouTube blocked the request (bot check)', 'blocked');
      const tracks = j && j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (tracks && tracks.length) return tracks;
    } catch (e) { if (e.kind === 'blocked') throw e; }
  }
  return null;
}

export async function fetchTranscript(videoId) {
  const page = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }
  });
  const html = await page.text();
  if (page.status === 429 || /g-recaptcha|www\.google\.com\/sorry/.test(html)) throw new TranscriptError('YouTube blocked the request (captcha)', 'blocked');
  if (!page.ok) throw new TranscriptError(`YouTube returned ${page.status}`, 'error');

  let tracks = null;
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  if (key) tracks = await tracksViaPlayer(videoId, key);
  if (!tracks) {
    const m = html.match(/"captionTracks":(\[.*?\])/);
    if (m) { try { tracks = JSON.parse(m[1].replace(/\\u0026/g, '&')); } catch (e) { tracks = null; } }
  }
  const track = pickTrack(tracks);
  if (!track) {
    if (/"playabilityStatus":\{"status":"LOGIN_REQUIRED"/.test(html)) throw new TranscriptError('YouTube asked to sign in (bot check)', 'blocked');
    throw new TranscriptError('This video has no captions', 'none');
  }
  const text = await readTrack(track.baseUrl);
  if (!text) throw new TranscriptError('Caption track came back empty (likely blocked)', 'blocked');
  return { text, lang: track.languageCode || '', auto: track.kind === 'asr' };
}

// "yt:abc123" or a YouTube URL -> "abc123"
export function youtubeId(keyOrUrl) {
  const s = String(keyOrUrl || '');
  if (s.startsWith('yt:')) return s.slice(3);
  const m = s.match(/(?:v=|shorts\/|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : (/^[\w-]{11}$/.test(s) ? s : null);
}
