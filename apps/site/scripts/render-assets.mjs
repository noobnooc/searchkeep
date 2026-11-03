// Renders static/og.png and the PNG icons from HTML/SVG with Playwright.
// Playwright is not a dependency of this package; run with a global install:
//   pnpm --filter @searchkeep/site run render:assets
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (f) => resolve(root, 'static', f);
const font = (f) => pathToFileURL(resolve(root, 'node_modules/@fontsource-variable', f)).href;
const markSvg = readFileSync(out('favicon.svg'), 'utf8');

const fonts = `
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${font('inter/files/inter-latin-opsz-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Mono'; font-weight: 100 900; src: url('${font('jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')}') format('woff2'); }
`;

const og = `<!doctype html><html><head><style>
${fonts}
* { margin: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; }
body {
  font-family: 'Inter', sans-serif; color: #f3f4f5; background: #08090a; overflow: hidden; position: relative;
  -webkit-font-smoothing: antialiased; font-optical-sizing: auto; font-feature-settings: 'cv11', 'ss01', 'ss03';
}
.bg { position: absolute; inset: 0;
  background:
    radial-gradient(40% 55% at 78% 40%, oklch(0.8 0.18 160 / 0.22), transparent 70%),
    radial-gradient(35% 45% at 100% 0%, oklch(0.6 0.13 250 / 0.22), transparent 70%),
    linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px) 0 0 / 48px 48px,
    linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px) 0 0 / 48px 48px;
  -webkit-mask-image: radial-gradient(90% 90% at 70% 40%, #000 30%, transparent 85%);
}
.wrap { position: absolute; inset: 0; padding: 72px 80px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 620; letter-spacing: -0.03em; }
.brand svg { width: 48px; height: 48px; border-radius: 12px; box-shadow: 0 8px 32px -6px oklch(0.8 0.18 160 / 0.5); }
h1 { margin-top: 96px; font-size: 74px; line-height: 0.98; letter-spacing: -0.05em; font-weight: 650; }
h1 span { background: linear-gradient(180deg, #f3f4f5 20%, #8d929b); -webkit-background-clip: text; color: transparent; }
p { margin-top: 26px; font-size: 27px; line-height: 1.35; color: #b3b7be; letter-spacing: -0.015em; max-width: 560px; }
.foot { margin-top: auto; display: flex; gap: 14px; font-size: 20px; color: #8b9099; align-items: center; }
.foot b { color: #f3f4f5; font-weight: 600; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: #646973; }
.card { position: absolute; right: 64px; top: 168px; width: 372px; padding: 26px 28px; border-radius: 22px;
  background: linear-gradient(180deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.015)), #0d0e10;
  border: 1px solid rgb(255 255 255 / 0.11);
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 40px 80px -30px #000; }
.ct { display: flex; justify-content: space-between; font-size: 17px; font-weight: 600; color: #f3f4f5; }
.ct span { color: #646973; font-weight: 500; }
.row { margin-top: 24px; }
.rh { display: flex; justify-content: space-between; font-size: 18px; color: #b3b7be; }
.rh b { color: #f3f4f5; font-variant-numeric: tabular-nums; }
.tr { margin-top: 10px; height: 14px; border-radius: 7px; background: #17181b; overflow: hidden; }
.fill { height: 100%; border-radius: 7px; }
.f0 { width: 100%; background: color-mix(in oklch, oklch(0.86 0.17 160) 45%, #1e1f23); }
.f1 { width: 23%; background: color-mix(in oklch, oklch(0.86 0.17 160) 72%, #1e1f23); }
.f2 { width: 9.2%; background: oklch(0.86 0.17 160); box-shadow: 0 0 18px oklch(0.8 0.18 160 / 0.6); }
.src { margin-top: 6px; font-size: 13px; color: #646973; font-family: 'Mono', monospace; }
</style></head><body>
<div class="bg"></div>
<div class="wrap">
  <div class="brand">${markSvg}<span>Searchkeep</span></div>
  <h1>Your search data,<br/><span>kept.</span></h1>
  <p>SEO &amp; GEO analytics that lives in your own Cloudflare account.</p>
  <div class="foot"><b>searchkeep.dev</b><i class="dot"></i>Open source · MIT<i class="dot"></i>MCP + dashboard</div>
</div>
<div class="card">
  <div class="ct">GEO funnel <span>pages · 28 days</span></div>
  <div class="row"><div class="rh">Crawled by AI <b>412</b></div><div class="tr"><div class="fill f0"></div></div><div class="src">cloudflare ai crawl control</div></div>
  <div class="row"><div class="rh">Cited in answers <b>96</b></div><div class="tr"><div class="fill f1"></div></div><div class="src">bing ai performance</div></div>
  <div class="row"><div class="rh">Clicked from AI <b>38</b></div><div class="tr"><div class="fill f2"></div></div><div class="src">web analytics referrers</div></div>
</div>
</body></html>`;

const icon = (size, padded) => `<!doctype html><html><head><style>
* { margin: 0; } html, body { width: ${size}px; height: ${size}px; background: ${padded ? '#08090a' : 'transparent'}; }
body { display: grid; place-items: center; }
svg { width: ${padded ? Math.round(size * 0.72) : size}px; height: ${padded ? Math.round(size * 0.72) : size}px; }
</style></head><body>${markSvg}</body></html>`;

const browser = await chromium.launch();
try {
  const shots = [
    { file: 'og.png', html: og, w: 1200, h: 630 },
    { file: 'favicon-32.png', html: icon(32, false), w: 32, h: 32, transparent: true },
    { file: 'icon-192.png', html: icon(192, false), w: 192, h: 192, transparent: true },
    { file: 'icon-512.png', html: icon(512, false), w: 512, h: 512, transparent: true },
    { file: 'apple-touch-icon.png', html: icon(180, true), w: 180, h: 180 },
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
