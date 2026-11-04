// Renders every brand asset of searchkeep.dev from the brand geometry with Playwright:
//   static/og.png and static/og/<page>.png (one per page in src/lib/og.ts, each with its own line),
//   static/favicon.svg, favicon.ico, favicon-32.png, the app icons, safari-pinned-tab.svg,
//   and docs/assets/social-preview.png (the GitHub repository's social preview).
// Playwright is not a dependency of this package; run with a global install:
//   pnpm --filter @searchkeep/site run render:assets
// Brand source: docs/brand (geometry in src/lib/brand.ts, imported directly: Node strips the types).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MARK_CUTS, MARK_DOT, MARK_HORIZON, MARK_VIEWBOX, NIGHT, SIGNAL, WORDMARK, WORDMARK_VIEWBOX, markSvg } from '../src/lib/brand.ts';
import { OG_PAGES, ogFile, pageLine } from '../src/lib/og.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (f) => resolve(root, 'static', f);
const font = (f) => pathToFileURL(resolve(root, 'node_modules', f)).href;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The app icon: the mark in white on a Night tile, rounded (default) or full-bleed; `inset` pads the glyph. */
const tile = ({ cut = 'full', rounded = true, inset = 0.14 } = {}) => {
  const t = 64 * inset;
  const s = 64 - 2 * t;
  const glyph = markSvg({ cut, ink: '#ffffff' }).replace('<svg ', `<svg x="${t}" y="${t}" width="${s}" height="${s}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" ${rounded ? 'rx="15"' : ''} fill="${NIGHT}"/>${glyph}</svg>`;
};

const fonts = `
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Inter Tight'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Plex Mono'; font-weight: 400; src: url('${font('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')}') format('woff2'); }
`;

// The home page's line: the same shape as the site's hero line.
const HOME_LINE = [
  118, 122, 112, 116, 106, 109, 100, 104, 95, 99, 88, 92, 84, 78, 82, 72, 76, 67, 70, 60, 64, 54, 58, 48, 52, 42, 45, 36, 38, 28, 20,
];

/**
 * The horizon band along the bottom of a card: `ys` are y values in [20, 120], drawn across `w`
 * on a band `h` tall, with the dashed 16-month marker at `cut` (0–1).
 */
function band({ ys, w, h = 200, cut = 0.44, labels = true }) {
  const endX = w - 76;
  const sy = (y) => Math.round(((y - 20) / 100) * (h - 70) + 30);
  const pts = ys.map((y, i) => `${Math.round((i * endX) / (ys.length - 1))},${sy(y)}`).join(' ');
  const end = { x: endX, y: sy(ys.at(-1)) };
  const cx = Math.round(w * cut);
  return `<div class="band" style="height:${h}px">
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    <line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}" stroke="#23262c"/>
    <line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="#5b616b" stroke-width="1.5" stroke-dasharray="4 6"/>
    <polyline points="${pts}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${end.x}" cy="${end.y}" r="20" stroke="${SIGNAL}" stroke-opacity="0.45" stroke-width="2"/>
    <circle cx="${end.x}" cy="${end.y}" r="9" fill="${SIGNAL}"/>
  </svg>
  ${labels ? `<span class="label" style="right:${w - cx + 12}px">← kept by Searchkeep</span><span class="label" style="left:${cx + 12}px">Search Console’s 16-month window →</span>` : ''}
</div>`;
}

/** An Open Graph card. Without `page` it is the home card ("Your search data, kept."). */
function card({ page, w = 1200, h = 630 } = {}) {
  const head = page
    ? `<div class="section"><i></i>${esc(page.section)}</div><h1 class="page">${esc(page.title)}<i>.</i></h1><p class="desc">${esc(page.description)}</p>`
    : `<h1>Your search data,<br/>kept<i>.</i></h1><p>SEO &amp; GEO analytics in your own Cloudflare account.</p>`;
  return `<!doctype html><html><head><style>
${fonts}
* { margin: 0; box-sizing: border-box; }
html, body { width: ${w}px; height: ${h}px; }
body { font-family: 'Inter', sans-serif; color: #f3f4f6; background: ${NIGHT}; overflow: hidden; position: relative; -webkit-font-smoothing: antialiased; }
.wrap { position: absolute; inset: 0; padding: 60px 76px; }
.top { display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 14px; }
.brand .mark { width: 46px; height: 46px; }
.brand .word { height: 38px; }
.domain { font-family: 'Plex Mono', monospace; font-size: 22px; color: #8a9099; }
h1 { margin-top: 58px; font-family: 'Inter Tight', sans-serif; font-size: 88px; line-height: 0.98; letter-spacing: -0.025em; font-weight: 600; }
h1 i { font-style: normal; color: ${SIGNAL}; }
h1.page { margin-top: 18px; font-size: 76px; line-height: 1.02; max-width: 1000px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.section { margin-top: 52px; display: flex; align-items: center; gap: 12px; font-family: 'Plex Mono', monospace; font-size: 20px; letter-spacing: 0.06em; text-transform: uppercase; color: #a4a9b1; }
.section i { width: 9px; height: 9px; border-radius: 50%; background: ${SIGNAL}; }
p { margin-top: 22px; font-size: 27px; line-height: 1.35; color: #a4a9b1; letter-spacing: -0.01em; max-width: 960px; }
p.desc { margin-top: 18px; font-size: 25px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.band { position: absolute; left: 0; right: 0; bottom: 0; }
.band svg { position: absolute; inset: 0; overflow: visible; }
.label { position: absolute; top: 6px; font-family: 'Plex Mono', monospace; font-size: 17px; color: #8a9099; white-space: nowrap; }
</style></head><body>
<div class="wrap">
  <div class="top">
    <div class="brand">${markSvg({ cut: 'full', ink: '#ffffff' }).replace('<svg ', '<svg class="mark" ')}<svg class="word" viewBox="${WORDMARK_VIEWBOX}"><path fill="#f3f4f6" d="${WORDMARK}"/></svg></div>
    <div class="domain">searchkeep.dev</div>
  </div>
  ${head}
</div>
${page ? band({ ys: pageLine(page.path), w, h: 150, labels: false }) : band({ ys: HOME_LINE, w })}
</body></html>`;
}

const icon = (size, opts) => `<!doctype html><html><head><style>
* { margin: 0; } html, body { width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
</style></head><body>${tile(opts)}</body></html>`;

/** Packs PNG images into one .ico file (PNG-compressed entries, supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

// The SVG favicon: browsers show it at 16 px, so it uses the tiny cut with a larger glyph.
writeFileSync(out('favicon.svg'), tile({ cut: 'tiny', inset: 0.1 }).replace(' width="100%" height="100%"', '') + '\n');
// Safari pinned tabs: one color, no tile; Safari fills it with the mask-icon color.
const full = MARK_CUTS.full;
writeFileSync(
  out('safari-pinned-tab.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="none"><line x1="${MARK_HORIZON.x}" y1="${MARK_HORIZON.y1}" x2="${MARK_HORIZON.x}" y2="${MARK_HORIZON.y2}" stroke="#000" stroke-width="2" stroke-dasharray="2.5 3"/><polyline points="${full.line}" stroke="#000" stroke-width="${full.stroke}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${full.dot}" fill="#000"/></svg>\n`,
);
console.log('wrote favicon.svg, safari-pinned-tab.svg');

const browser = await chromium.launch();
const shoot = async ({ html, w, h, transparent = false, path }) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const data = await page.screenshot({ path, omitBackground: transparent });
  await page.close();
  return data;
};
try {
  const shots = [
    { file: 'og.png', html: card(), w: 1200, h: 630 },
    { file: 'favicon-32.png', html: icon(32, { cut: 'small', inset: 0.12 }), w: 32, h: 32, transparent: true },
    { file: 'icon-192.png', html: icon(192, {}), w: 192, h: 192, transparent: true },
    { file: 'icon-512.png', html: icon(512, {}), w: 512, h: 512, transparent: true },
    // iOS rounds the corners itself: full-bleed square.
    { file: 'apple-touch-icon.png', html: icon(180, { rounded: false, inset: 0.18 }), w: 180, h: 180 },
    // Android adaptive icons crop to a circle: keep the glyph inside the 80% safe zone.
    { file: 'icon-maskable-512.png', html: icon(512, { rounded: false, inset: 0.24 }), w: 512, h: 512 },
  ];
  for (const s of shots) {
    await shoot({ ...s, path: out(s.file) });
    console.log('wrote', s.file);
  }

  // favicon.ico: 16 (tiny cut), 32 (small cut) and 48 (full cut) for crawlers and old browsers.
  const entries = [];
  for (const [size, cut, inset] of [
    [16, 'tiny', 0.08],
    [32, 'small', 0.12],
    [48, 'full', 0.14],
  ]) {
    entries.push({ size, data: await shoot({ html: icon(size, { cut, inset }), w: size, h: size, transparent: true }) });
  }
  writeFileSync(out('favicon.ico'), ico(entries));
  console.log('wrote favicon.ico');

  // One OG image per page, each with its own line.
  rmSync(out('og'), { recursive: true, force: true });
  mkdirSync(out('og'), { recursive: true });
  for (const page of OG_PAGES) {
    const file = ogFile(page.path);
    await shoot({ html: card({ page }), w: 1200, h: 630, path: out(`og/${file}`) });
    console.log('wrote', `og/${file}`);
  }

  // The GitHub repository's social preview (Settings → General → Social preview): 1280 × 640.
  const social = resolve(root, '../../docs/assets/social-preview.png');
  await shoot({ html: card({ w: 1280, h: 640 }), w: 1280, h: 640, path: social });
  console.log('wrote docs/assets/social-preview.png', readFileSync(social).length, 'bytes');
} finally {
  await browser.close();
}
