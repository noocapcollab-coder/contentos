// lib/topics.js — the topic list and hook types the analyzer picks from.
//
// To add a topic: add it here AND add the same option to the Topic column in
// CONTENT STATS. When the AI sees a video that fits none of these, it tags it
// "Other" and writes its idea into the Topic Suggestion column, so you can scan
// that column now and then and promote good suggestions into this list.

export const TOPICS = [
  'Claude', 'Claude Code', 'ChatGPT', 'Gemini', 'GitHub', 'n8n & Automation',
  'AI Agents', 'AI Images', 'AI Video', 'AI Websites', 'Make Money with AI',
  'Productivity', 'AI News', 'Tool Roundup', 'Other'
];

// Each hook type with the one-line definition the AI is given.
export const HOOK_TYPES = {
  'Bold claim': 'a strong, surprising statement up front ("This free repo replaces a $50 app")',
  'Result first': 'shows or states the finished result before explaining how',
  'Question': 'opens by asking the viewer a direct question',
  'Tool reveal': 'names or unveils a specific tool/feature as the hook ("Claude just added...")',
  'Secret list': 'promises a list of little-known things ("3 websites that feel illegal to know")',
  'Stop doing this': 'calls out a mistake or tells the viewer to stop something',
  'Free or cheap': 'leads with price, free access, or cost savings',
  'Comparison': 'pits two things against each other (X vs Y, X replaced Y)',
  'Story': 'opens with a personal "I tried / I did" story',
  'Tutorial': 'jumps straight into how-to steps with no real hook',
  'News drop': 'leads with fresh news or a just-released update'
};
