// Renders static/og.png and the PNG icons from the brand geometry with Playwright.
// Playwright is not a dependency of this package; run with a global install:
//   pnpm --filter @searchkeep/site run render:assets
// Brand source: docs/brand (geometry mirrored in src/lib/brand.ts).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (f) => resolve(root, 'static', f);
const font = (f) => pathToFileURL(resolve(root, 'node_modules/@fontsource-variable', f)).href;

// Read the brand constants from src/lib/brand.ts without a TS toolchain.
const brandTs = readFileSync(resolve(root, 'src/lib/brand.ts'), 'utf8');
const constant = (name) => brandTs.match(new RegExp(`export const ${name} = '([^']+)'`))[1];
const MARK = constant('MARK');
const MARK_SMALL = constant('MARK_SMALL');
const WORDMARK = constant('WORDMARK');
const WORDMARK_VIEWBOX = constant('WORDMARK_VIEWBOX');
const INK = '#04140c';
const GRAD = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3ffb9"/><stop offset=".55" stop-color="#31eb91"/><stop offset="1" stop-color="#00cb87"/></linearGradient>`;

/** The tile: rounded (default) or full-bleed square; `inset` is the padding around the glyph. */
const tile = ({ d = MARK, rounded = true, inset = 0.16 } = {}) => {
  const t = 64 * inset;
  const s = 1 - 2 * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%"><defs>${GRAD('g')}</defs><rect width="64" height="64" ${rounded ? 'rx="16.6"' : ''} fill="url(#g)"/><path transform="translate(${t} ${t}) scale(${s})" fill="${INK}" d="${d}"/></svg>`;
};

const fonts = `
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${font('inter/files/inter-latin-opsz-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Funnel'; font-weight: 300 800; src: url('${font('funnel-display/files/funnel-display-latin-wght-normal.woff2')}') format('woff2'); }
`;

const og = `<!doctype html><html><head><style>
${fonts}
* { margin: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; }
body { font-family: 'Inter', sans-serif; color: #f3f4f5; background: #08090a; overflow: hidden; position: relative; -webkit-font-smoothing: antialiased; }
.bg { position: absolute; inset: 0;
  background:
    radial-gradient(38% 60% at 80% 52%, rgb(49 235 145 / 0.22), transparent 70%),
    radial-gradient(30% 40% at 100% 0%, rgb(90 120 255 / 0.14), transparent 70%),
    linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, rgb(255 255 255 / 0.045) 1px, transparent 1px) 0 0 / 40px 40px;
  -webkit-mask-image: radial-gradient(85% 95% at 72% 50%, #000 25%, transparent 80%);
}
.wrap { position: absolute; inset: 0; padding: 68px 76px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 18px; }
.brand .tile { width: 52px; height: 52px; border-radius: 14px; box-shadow: 0 10px 30px -8px rgb(49 235 145 / 0.55), 0 0 0 1px rgb(255 255 255 / .1); overflow: hidden; }
.brand .word { height: 40px; }
h1 { margin-top: 92px; font-family: 'Funnel', sans-serif; font-size: 86px; line-height: 0.98; letter-spacing: -0.045em; font-weight: 640; }
h1 span { background: linear-gradient(180deg, #f3f4f5 10%, #9aa0a8); -webkit-background-clip: text; color: transparent; }
p { margin-top: 26px; font-size: 27px; line-height: 1.38; color: #b3b7be; letter-spacing: -0.012em; max-width: 590px; }
.foot { margin-top: auto; display: flex; gap: 14px; font-size: 20px; color: #8b9099; align-items: center; }
.foot b { color: #f3f4f5; font-weight: 600; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: #4f545c; }
.keep { position: absolute; right: 78px; top: 118px; width: 360px; height: 360px; }
.keep svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 40px rgb(49 235 145 / 0.45)) drop-shadow(0 30px 60px rgb(0 0 0 / 0.6)); }
.ground { position: absolute; right: 30px; top: 428px; width: 456px; height: 1px; background: linear-gradient(90deg, transparent, rgb(105 248 165 / 0.55), transparent); }
.floor { position: absolute; right: 88px; top: 410px; width: 340px; height: 60px; border-radius: 50%; background: radial-gradient(closest-side, rgb(49 235 145 / 0.28), transparent); filter: blur(6px); }
</style></head><body>
<div class="bg"></div>
<div class="keep"><svg viewBox="0 0 64 64"><defs>${GRAD('k')}</defs><path fill="url(#k)" d="${MARK}"/></svg></div>
<div class="floor"></div>
<div class="ground"></div>
<div class="wrap">
  <div class="brand"><div class="tile">${tile()}</div><svg class="word" viewBox="${WORDMARK_VIEWBOX}"><path fill="#f3f4f5" d="${WORDMARK}"/></svg></div>
  <h1>Your search data,<br/><span>kept.</span></h1>
  <p>SEO &amp; GEO analytics that lives in your own Cloudflare account.</p>
  <div class="foot"><b>searchkeep.dev</b><i class="dot"></i>Open source · MIT<i class="dot"></i>MCP + dashboard</div>
</div>
</body></html>`;

const icon = (size, opts) => `<!doctype html><html><head><style>
* { margin: 0; } html, body { width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
</style></head><body>${tile(opts)}</body></html>`;

const browser = await chromium.launch();
try {
  const shots = [
    { file: 'og.png', html: og, w: 1200, h: 630 },
    { file: 'favicon-32.png', html: icon(32, { d: MARK_SMALL }), w: 32, h: 32, transparent: true },
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
