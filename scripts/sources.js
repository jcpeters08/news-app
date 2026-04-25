// Curated source allowlist with AllSides-style bias ratings.
// Used to filter NewsAPI results and tag stories with a lean badge.
// Ratings reflect AllSides / Ad Fontes consensus as of 2025; update as needed.

export const BIAS = {
  LEFT: 'left',
  LEAN_LEFT: 'lean-left',
  CENTER: 'center',
  LEAN_RIGHT: 'lean-right',
  RIGHT: 'right',
};

export const BIAS_LABEL = {
  [BIAS.LEFT]: 'Left',
  [BIAS.LEAN_LEFT]: 'Lean Left',
  [BIAS.CENTER]: 'Center',
  [BIAS.LEAN_RIGHT]: 'Lean Right',
  [BIAS.RIGHT]: 'Right',
};

// Map NewsAPI source IDs to bias rating.
// Source IDs from https://newsapi.org/v2/sources
export const SOURCE_BIAS = {
  // Left
  'msnbc': BIAS.LEFT,
  'the-huffington-post': BIAS.LEFT,
  'vice-news': BIAS.LEFT,

  // Lean Left
  'cnn': BIAS.LEAN_LEFT,
  'nbc-news': BIAS.LEAN_LEFT,
  'cbs-news': BIAS.LEAN_LEFT,
  'abc-news': BIAS.LEAN_LEFT,
  'the-washington-post': BIAS.LEAN_LEFT,
  'the-new-york-times': BIAS.LEAN_LEFT,
  'politico': BIAS.LEAN_LEFT,
  'time': BIAS.LEAN_LEFT,
  'bloomberg': BIAS.LEAN_LEFT,
  'business-insider': BIAS.LEAN_LEFT,
  'axios': BIAS.LEAN_LEFT,

  // Center
  'reuters': BIAS.CENTER,
  'associated-press': BIAS.CENTER,
  'bbc-news': BIAS.CENTER,
  'the-wall-street-journal': BIAS.CENTER,
  'usa-today': BIAS.CENTER,
  'the-hill': BIAS.CENTER,
  'csmonitor': BIAS.CENTER,
  'newsweek': BIAS.CENTER,

  // Lean Right
  'fox-news': BIAS.LEAN_RIGHT,
  'national-review': BIAS.LEAN_RIGHT,
  'the-washington-times': BIAS.LEAN_RIGHT,
  'the-american-conservative': BIAS.LEAN_RIGHT,

  // Right
  'breitbart-news': BIAS.RIGHT,
  'the-blaze': BIAS.RIGHT,
};

// Tech/medicine outlets — used for the medicine-tech category, not lean-rated for politics.
export const TECH_MED_SOURCES = [
  'reuters',
  'associated-press',
  'bbc-news',
  'the-verge',
  'ars-technica',
  'wired',
  'techcrunch',
  'medical-news-today',
  'new-scientist',
  'national-geographic',
  'bloomberg',
  'cnn',
  'nbc-news',
];

export const POLITICS_SOURCES = Object.keys(SOURCE_BIAS);

// Curated RSS feeds for the GenAI section — focused on advanced Claude/ChatGPT users.
// Comments note why each source is here.
export const GENAI_FEEDS = [
  // Anthropic — Claude announcements & engineering deep dives
  { url: 'https://www.anthropic.com/news/rss.xml', source: 'Anthropic', weight: 10 },
  // OpenAI — ChatGPT/API announcements
  { url: 'https://openai.com/blog/rss.xml', source: 'OpenAI', weight: 10 },
  // Simon Willison — tips, deep dives, advanced usage
  { url: 'https://simonwillison.net/atom/everything/', source: 'Simon Willison', weight: 9 },
  // Latent Space — practitioner-focused podcast/blog
  { url: 'https://www.latent.space/feed', source: 'Latent Space', weight: 7 },
  // Hacker News — front page; we'll filter for Claude/ChatGPT/LLM keywords
  { url: 'https://hnrss.org/frontpage', source: 'Hacker News', weight: 5, filterKeywords: true },
];

export const GENAI_KEYWORDS = [
  'claude', 'anthropic', 'chatgpt', 'openai', 'gpt-4', 'gpt-5', 'o1', 'o3',
  'llm', 'mcp', 'prompt', 'agent', 'rag', 'tool use', 'function calling',
  'fine-tun', 'context window',
];
