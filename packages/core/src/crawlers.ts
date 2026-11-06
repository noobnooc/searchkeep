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
  return classifyWith(AI_CRAWLERS, userAgent);
}

/**
 * Search engine crawlers, most specific first. `match` is the exact spelling in
 * the user agent (Cloudflare matches it case-sensitively). Purposes: `search`
 * (web search index), `media` (image and video indexes), `ads` (ad landing page
 * checks), `other` (previews, testing tools and other fetchers). AI crawlers of
 * the same operators (Google-CloudVertexBot, ...) are in `AI_CRAWLERS`.
 */
export const SEARCH_CRAWLERS: CrawlerSignature[] = [
  { match: 'Googlebot-Image', name: 'Googlebot-Image', operator: 'Google', purpose: 'media' },
  { match: 'Googlebot-Video', name: 'Googlebot-Video', operator: 'Google', purpose: 'media' },
  { match: 'Googlebot-News', name: 'Googlebot-News', operator: 'Google', purpose: 'search' },
  { match: 'Google-InspectionTool', name: 'Google-InspectionTool', operator: 'Google', purpose: 'other' },
  { match: 'Storebot-Google', name: 'Storebot-Google', operator: 'Google', purpose: 'other' },
  { match: 'GoogleOther', name: 'GoogleOther', operator: 'Google', purpose: 'other' },
  { match: 'AdsBot-Google', name: 'AdsBot-Google', operator: 'Google', purpose: 'ads' },
  { match: 'Mediapartners-Google', name: 'Mediapartners-Google', operator: 'Google', purpose: 'ads' },
  { match: 'Googlebot', name: 'Googlebot', operator: 'Google', purpose: 'search' },
  { match: 'adidxbot', name: 'AdIdxBot', operator: 'Microsoft', purpose: 'ads' },
  { match: 'BingPreview', name: 'BingPreview', operator: 'Microsoft', purpose: 'other' },
  { match: 'MicrosoftPreview', name: 'MicrosoftPreview', operator: 'Microsoft', purpose: 'other' },
  { match: 'bingbot', name: 'Bingbot', operator: 'Microsoft', purpose: 'search' },
  { match: 'YandexImages', name: 'YandexImages', operator: 'Yandex', purpose: 'media' },
  { match: 'YandexMobileBot', name: 'YandexBot', operator: 'Yandex', purpose: 'search' },
  { match: 'YandexBot', name: 'YandexBot', operator: 'Yandex', purpose: 'search' },
  { match: 'Baiduspider-image', name: 'Baiduspider-image', operator: 'Baidu', purpose: 'media' },
  { match: 'Baiduspider', name: 'Baiduspider', operator: 'Baidu', purpose: 'search' },
  { match: 'DuckDuckBot', name: 'DuckDuckBot', operator: 'DuckDuckGo', purpose: 'search' },
  { match: 'Applebot', name: 'Applebot', operator: 'Apple', purpose: 'search' },
  { match: 'Slurp', name: 'Yahoo Slurp', operator: 'Yahoo', purpose: 'search' },
  { match: 'SeznamBot', name: 'SeznamBot', operator: 'Seznam', purpose: 'search' },
  { match: 'Yeti/', name: 'Yeti', operator: 'Naver', purpose: 'search' },
  { match: 'Sogou', name: 'Sogou', operator: 'Sogou', purpose: 'search' },
  { match: 'Qwantbot', name: 'Qwantbot', operator: 'Qwant', purpose: 'search' },
  { match: 'coccocbot', name: 'coccocbot', operator: 'Coc Coc', purpose: 'search' },
  { match: 'MojeekBot', name: 'MojeekBot', operator: 'Mojeek', purpose: 'search' },
];

export function classifySearchCrawler(userAgent: string): CrawlerSignature | null {
  // An AI fetcher that mentions a search engine (rare) stays an AI crawler.
  if (classifyCrawler(userAgent)) return null;
  return classifyWith(SEARCH_CRAWLERS, userAgent);
}

function classifyWith(list: CrawlerSignature[], userAgent: string): CrawlerSignature | null {
  const ua = userAgent.toLowerCase();
  for (const sig of list) {
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
