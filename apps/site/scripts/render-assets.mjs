// Renders static/og.png, the PNG icons and static/favicon.svg from the brand geometry with Playwright.
// Playwright is not a dependency of this package; run with a global install:
//   pnpm --filter @searchkeep/site run render:assets
// Brand source: docs/brand (geometry in src/lib/brand.ts, imported directly: Node strips the types).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NIGHT, SIGNAL, WORDMARK, WORDMARK_VIEWBOX, markSvg } from '../src/lib/brand.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (f) => resolve(root, 'static', f);
const font = (f) => pathToFileURL(resolve(root, 'node_modules', f)).href;

/** The app icon: the mark in white on a Night tile, rounded (default) or full-bleed; `inset` pads the glyph. */
const tile = ({ cut = 'full', rounded = true, inset = 0.14 } = {}) => {
  const t = 64 * inset;
  const s = 64 - 2 * t;
  const glyph = markSvg({ cut, ink: '#ffffff' }).replace('<svg ', `<svg x="${t}" y="${t}" width="${s}" height="${s}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" ${rounded ? 'rx="15"' : ''} fill="${NIGHT}"/>${glyph}</svg>`;
};

// The OG image's line: same shape as the site's hero line, on a 1200 × 200 band.
const ys = [
  178, 182, 172, 176, 166, 169, 160, 164, 155, 159, 148, 152, 144, 138, 142, 132, 136, 127, 130, 120, 124, 114, 118, 108, 112, 102, 105, 96,
  98, 88, 80,
];
const pts = ys.map((y, i) => `${Math.round((i * 1124) / (ys.length - 1))},${y - 60}`).join(' ');
const end = { x: 1124, y: ys.at(-1) - 60 };

const fonts = `
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Inter Tight'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Plex Mono'; font-weight: 400; src: url('${font('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')}') format('woff2'); }
`;

const og = `<!doctype html><html><head><style>
${fonts}
* { margin: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; }
body { font-family: 'Inter', sans-serif; color: #f3f4f6; background: ${NIGHT}; overflow: hidden; position: relative; -webkit-font-smoothing: antialiased; }
.wrap { position: absolute; inset: 0; padding: 60px 76px; }
.top { display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 14px; }
.brand .mark { width: 46px; height: 46px; }
.brand .word { height: 38px; }
.domain { font-family: 'Plex Mono', monospace; font-size: 22px; color: #8a9099; }
h1 { margin-top: 58px; font-family: 'Inter Tight', sans-serif; font-size: 88px; line-height: 0.98; letter-spacing: -0.04em; font-weight: 600; }
h1 i { font-style: normal; color: ${SIGNAL}; }
p { margin-top: 22px; font-size: 27px; line-height: 1.35; color: #a4a9b1; letter-spacing: -0.01em; }
.band { position: absolute; left: 0; right: 0; bottom: 0; height: 200px; }
.band svg { position: absolute; inset: 0; overflow: visible; }
.label { position: absolute; top: 6px; font-family: 'Plex Mono', monospace; font-size: 17px; color: #8a9099; white-space: nowrap; }
</style></head><body>
<div class="wrap">
  <div class="top">
    <div class="brand">${markSvg({ cut: 'full', ink: '#ffffff' }).replace('<svg ', '<svg class="mark" ')}<svg class="word" viewBox="${WORDMARK_VIEWBOX}"><path fill="#f3f4f6" d="${WORDMARK}"/></svg></div>
    <div class="domain">searchkeep.dev</div>
  </div>
  <h1>Your search data,<br/>kept<i>.</i></h1>
  <p>SEO &amp; GEO analytics in your own Cloudflare account.</p>
</div>
<div class="band">
  <svg width="1200" height="200" viewBox="0 0 1200 200" fill="none">
    <line x1="0" y1="199.5" x2="1200" y2="199.5" stroke="#23262c"/>
    <line x1="520" y1="0" x2="520" y2="200" stroke="#5b616b" stroke-width="1.5" stroke-dasharray="4 6"/>
    <polyline points="${pts}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${end.x}" cy="${end.y}" r="20" stroke="${SIGNAL}" stroke-opacity="0.45" stroke-width="2"/>
    <circle cx="${end.x}" cy="${end.y}" r="9" fill="${SIGNAL}"/>
  </svg>
  <span class="label" style="right: ${1200 - 508}px">← kept by Searchkeep</span>
  <span class="label" style="left: 532px">Search Console’s 16-month window →</span>
</div>
</body></html>`;

const icon = (size, opts) => `<!doctype html><html><head><style>
* { margin: 0; } html, body { width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
</style></head><body>${tile(opts)}</body></html>`;

// The SVG favicon: browsers show it at 16 px, so it uses the tiny cut with a larger glyph.
writeFileSync(out('favicon.svg'), tile({ cut: 'tiny', inset: 0.1 }).replace(' width="100%" height="100%"', '') + '\n');
console.log('wrote favicon.svg');

const browser = await chromium.launch();
try {
  const shots = [
    { file: 'og.png', html: og, w: 1200, h: 630 },
    { file: 'favicon-32.png', html: icon(32, { cut: 'small', inset: 0.12 }), w: 32, h: 32, transparent: true },
    { file: 'icon-192.png', html: icon(192, {}), w: 192, h: 192, transparent: true },
    { file: 'icon-512.png', html: icon(512, {}), w: 512, h: 512, transparent: true },
    // iOS rounds the corners itself: full-bleed square.
    { file: 'apple-touch-icon.png', html: icon(180, { rounded: false, inset: 0.18 }), w: 180, h: 180 },
    // Android adaptive icons crop to a circle: keep the glyph inside the 80% safe zone.
    { file: 'icon-maskable-512.png', html: icon(512, { rounded: false, inset: 0.24 }), w: 512, h: 512 },
  ];
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
    await page.setContent(s.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out(s.file), omitBackground: !!s.transparent });
    await page.close();
    console.log('wrote', s.file);
  }
} finally {
  await browser.close();
}
