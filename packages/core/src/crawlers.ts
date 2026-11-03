import type { CrawlerPurpose } from './types.js';

export interface CrawlerSignature {
  /** Case-insensitive substring of the user agent. */
  match: string;
  name: string;
  operator: string;
  purpose: CrawlerPurpose;
}

/**
 * Known AI crawlers and assistants, most specific first. Purposes follow the
 * operators' own documentation: `training` (model training), `search`
 * (AI search indexes), `user` (fetches triggered by a user's question).
 */
export const AI_CRAWLERS: CrawlerSignature[] = [
  { match: 'ChatGPT-User', name: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user' },
  { match: 'OAI-SearchBot', name: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search' },
  { match: 'GPTBot', name: 'GPTBot', operator: 'OpenAI', purpose: 'training' },
  { match: 'Claude-User', name: 'Claude-User', operator: 'Anthropic', purpose: 'user' },
  { match: 'Claude-SearchBot', name: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search' },
  { match: 'ClaudeBot', name: 'ClaudeBot', operator: 'Anthropic', purpose: 'training' },
  { match: 'anthropic-ai', name: 'anthropic-ai', operator: 'Anthropic', purpose: 'training' },
  { match: 'Perplexity-User', name: 'Perplexity-User', operator: 'Perplexity', purpose: 'user' },
  { match: 'PerplexityBot', name: 'PerplexityBot', operator: 'Perplexity', purpose: 'search' },
  { match: 'Google-CloudVertexBot', name: 'Google-CloudVertexBot', operator: 'Google', purpose: 'training' },
  { match: 'Gemini-Deep-Research', name: 'Gemini-Deep-Research', operator: 'Google', purpose: 'user' },
  { match: 'MistralAI-User', name: 'MistralAI-User', operator: 'Mistral', purpose: 'user' },
  { match: 'DuckAssistBot', name: 'DuckAssistBot', operator: 'DuckDuckGo', purpose: 'search' },
  { match: 'meta-externalfetcher', name: 'Meta-ExternalFetcher', operator: 'Meta', purpose: 'user' },
  { match: 'meta-externalagent', name: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'training' },
  { match: 'Applebot-Extended', name: 'Applebot-Extended', operator: 'Apple', purpose: 'training' },
  { match: 'Amazonbot', name: 'Amazonbot', operator: 'Amazon', purpose: 'search' },
  { match: 'Bytespider', name: 'Bytespider', operator: 'ByteDance', purpose: 'training' },
  { match: 'CCBot', name: 'CCBot', operator: 'Common Crawl', purpose: 'training' },
  { match: 'cohere-training-data-crawler', name: 'cohere-training-data-crawler', operator: 'Cohere', purpose: 'training' },
  { match: 'cohere-ai', name: 'cohere-ai', operator: 'Cohere', purpose: 'user' },
  { match: 'YouBot', name: 'YouBot', operator: 'You.com', purpose: 'search' },
  { match: 'PhindBot', name: 'PhindBot', operator: 'Phind', purpose: 'search' },
  { match: 'Diffbot', name: 'Diffbot', operator: 'Diffbot', purpose: 'training' },
  { match: 'Timpibot', name: 'Timpibot', operator: 'Timpi', purpose: 'training' },
  { match: 'ImagesiftBot', name: 'ImagesiftBot', operator: 'ImageSift', purpose: 'training' },
  { match: 'PetalBot', name: 'PetalBot', operator: 'Huawei', purpose: 'search' },
  { match: 'Kangaroo Bot', name: 'Kangaroo Bot', operator: 'Kangaroo LLM', purpose: 'training' },
  { match: 'AI2Bot', name: 'AI2Bot', operator: 'Allen Institute for AI', purpose: 'training' },
  { match: 'DeepSeekBot', name: 'DeepSeekBot', operator: 'DeepSeek', purpose: 'training' },
  { match: 'xAI-Bot', name: 'xAI-Bot', operator: 'xAI', purpose: 'training' },
];

export function classifyCrawler(userAgent: string): CrawlerSignature | null {
  const ua = userAgent.toLowerCase();
  for (const sig of AI_CRAWLERS) {
    if (ua.includes(sig.match.toLowerCase())) return sig;
  }
  return null;
}

/**
 * Referrer hostnames of AI assistants and answer engines. Visits from these are
 * the "clicked from AI" step of the GEO funnel.
 */
export const AI_REFERRER_HOSTS: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'www.perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'bard.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'chat.deepseek.com': 'DeepSeek',
  'you.com': 'You.com',
  'www.phind.com': 'Phind',
  'phind.com': 'Phind',
  'poe.com': 'Poe',
  'chat.mistral.ai': 'Mistral',
  'grok.com': 'Grok',
  'meta.ai': 'Meta AI',
  'www.meta.ai': 'Meta AI',
  'kagi.com': 'Kagi',
};

export function aiReferrerName(host: string): string | null {
  return AI_REFERRER_HOSTS[host.toLowerCase()] ?? null;
}
