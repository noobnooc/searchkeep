/**
 * A deliberately tiny syntax tinter for the handful of languages the docs use.
 * Runs at prerender time; the output is static HTML with `t-*` classes.
 */

export type Lang = 'bash' | 'json' | 'jsonc' | 'ts' | 'text' | 'http' | 'regex';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Rule {
  cls: string;
  re: RegExp;
}

const RULES: Record<Exclude<Lang, 'text'>, Rule[]> = {
  bash: [
    { cls: 'comment', re: /#[^\n]*/y },
    { cls: 'string', re: /"(?:\\.|[^"\\])*"|'[^']*'/y },
    { cls: 'var', re: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/y },
    { cls: 'flag', re: /(?<=\s)--?[A-Za-z][\w-]*/y },
    { cls: 'op', re: /\|\||&&|[|<>]/y },
    {
      cls: 'fn',
      re: /(?<=^|\n|\|\s|&&\s|\$\(\s?)(?:npx|pnpm|wrangler|gcloud|curl|jq|claude|git|cd|cat|echo|export|npm|node)\b/y,
    },
  ],
  json: [
    { cls: 'prop', re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
    { cls: 'string', re: /"(?:\\.|[^"\\])*"/y },
    { cls: 'number', re: /-?\b\d+(?:\.\d+)?\b/y },
    { cls: 'keyword', re: /\b(?:true|false|null)\b/y },
  ],
  jsonc: [
    { cls: 'comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
    { cls: 'prop', re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
    { cls: 'string', re: /"(?:\\.|[^"\\])*"/y },
    { cls: 'number', re: /-?\b\d+(?:\.\d+)?\b/y },
    { cls: 'keyword', re: /\b(?:true|false|null)\b/y },
  ],
  ts: [
    { cls: 'comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
    { cls: 'string', re: /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
    {
      cls: 'keyword',
      re: /\b(?:import|from|export|const|let|async|await|function|return|interface|type|new|if|else|true|false|null|undefined)\b/y,
    },
    { cls: 'number', re: /\b\d+(?:\.\d+)?\b/y },
    { cls: 'fn', re: /\b[a-zA-Z_]\w*(?=\()/y },
  ],
  http: [
    { cls: 'keyword', re: /^(?:GET|POST|PUT|DELETE|HTTP\/\d(?:\.\d)?)\b/my },
    { cls: 'prop', re: /^[A-Za-z-]+(?=:)/my },
    { cls: 'number', re: /\b\d{3}\b/y },
  ],
  regex: [
    { cls: 'op', re: /[|()?*+]/y },
    { cls: 'var', re: /\\[a-zA-Z]/y },
  ],
};

export function highlight(code: string, lang: Lang = 'text'): string {
  if (lang === 'text') return escape(code);
  const rules = RULES[lang];
  let out = '';
  let plain = '';
  let i = 0;
  outer: while (i < code.length) {
    for (const rule of rules) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        if (plain) {
          out += escape(plain);
          plain = '';
        }
        out += `<span class="t-${rule.cls}">${escape(m[0])}</span>`;
        i += m[0].length;
        continue outer;
      }
    }
    // Skip whole identifiers so rules never match in the middle of a word.
    const word = /[A-Za-z0-9_]+/y;
    word.lastIndex = i;
    const w = word.exec(code);
    if (w && w.index === i) {
      plain += w[0];
      i += w[0].length;
    } else {
      plain += code[i];
      i += 1;
    }
  }
  if (plain) out += escape(plain);
  return out;
}
