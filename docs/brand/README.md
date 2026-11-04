# Searchkeep brand: Horizon

## The mark

A line chart that runs past a dashed horizon and ends in a dot. The horizon is the 16 months Google
Search Console keeps; everything left of it is history Searchkeep kept for you. The dot is today,
in the brand's one bright color.

| File                                     | Use                                               |
| ---------------------------------------- | ------------------------------------------------- |
| [`icon.svg`](icon.svg)                   | App icon, avatars, large sizes (48 px and up)     |
| [`icon-small.svg`](icon-small.svg)       | Favicons and anything 16 px or smaller (tiny cut) |
| [`mark.svg`](mark.svg)                   | The mark alone, in Night, on light backgrounds    |
| [`logo-on-dark.svg`](logo-on-dark.svg)   | Horizontal lockup on dark backgrounds             |
| [`logo-on-light.svg`](logo-on-light.svg) | Horizontal lockup on light backgrounds            |
| [`wordmark.svg`](wordmark.svg)           | The wordmark alone                                |

The same geometry lives in code: `apps/site/src/lib/brand.ts` and its copy in
`packages/dashboard/src/lib/brand.ts`. Change both together. `markSvg()` builds the mark for icons,
the OG image and the Worker's setup page; `apps/site/scripts/render-assets.mjs` renders the PNGs.

The mark has three cuts on its 48 × 48 grid:

| Cut   | Size         | Line           | Dot | Horizon      |
| ----- | ------------ | -------------- | --- | ------------ |
| full  | 24 px and up | 4              | r 5 | dashed, 40 % |
| small | 17–23 px     | 5              | r 6 | none         |
| tiny  | 16 px        | 7, three bends | r 8 | none         |

- The line is always the ink color (Night on light, white on dark). Only the dot is Signal.
- Keep clear space around the mark of at least a quarter of its height.
- No gradients, glows or shadows on the mark, and no other color for the dot.

## The line as a device

The hero of searchkeep.dev, the OG image and the closing call to action draw the same idea at full
width: a line that climbs past a dashed "16-month window" marker and ends in the Signal dot. Use it
as a quiet, single-weight line (2 px on screen), never as a filled area or a gradient.

## Wordmark and type

- **Wordmark:** `searchkeep`, lowercase, Inter Tight 600 with −0.035em tracking, converted to
  outlines so it never depends on a font loading. In running text the name is written
  **Searchkeep**.
- **Display type:** Inter Tight (headings, hero, OG image).
- **Text type:** Inter. **Mono:** IBM Plex Mono (labels, axes, code).
- Fonts are self-hosted (Fontsource). The dashboard loads no web fonts at all.
- A headline may end in a Signal full stop ("kept**.**"). Use it once per view.

## Color

| Token  | Hex       | Use                                                    |
| ------ | --------- | ------------------------------------------------------ |
| Night  | `#0b0c0e` | Dark backgrounds, the app icon tile, ink on light      |
| Fog    | `#f4f5f7` | Light backgrounds                                      |
| Signal | `#ff5b1f` | The dot, the full stop, live indicators. Never a wash. |
| Slate  | `#5b616b` | Secondary text on light, the dashed horizon            |
| Ember  | `#c2410c` | Accent text on light (links, eyebrows): 5.2:1 on white |
| Flare  | `#ff7a45` | Accent text on dark                                    |

Primary buttons are Night on light and white on dark; Signal stays a point, not a fill.
