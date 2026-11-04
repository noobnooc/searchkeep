# Searchkeep brand

## The mark: "the keep"

A keep is the stronghold tower of a castle. Searchkeep's mark is a keep whose battlements rise like
a bar chart: your search data, kept in a place you own, and growing. The doorway is the way in that
only you hold the key to (self-hosted, behind your own Cloudflare Access).

| File                                     | Use                                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| [`icon.svg`](icon.svg)                   | App icon, avatars, large sizes (48 px and up)           |
| [`icon-small.svg`](icon-small.svg)       | Favicons and anything 32 px or smaller (simplified cut) |
| [`mark.svg`](mark.svg)                   | The glyph alone, in mint, on dark backgrounds           |
| [`logo-on-dark.svg`](logo-on-dark.svg)   | Horizontal lockup on dark backgrounds                   |
| [`logo-on-light.svg`](logo-on-light.svg) | Horizontal lockup on light backgrounds                  |
| [`wordmark.svg`](wordmark.svg)           | The wordmark alone                                      |

The same geometry lives in code as constants: `apps/site/src/lib/brand.ts` and its copy in
`packages/dashboard/src/lib/brand.ts`. Change both together.

- Keep clear space around the mark of at least a quarter of its height.
- The small cut joins the battlements to the tower and widens the gaps so it stays crisp at 16 px.
  Do not use the full mark below 32 px.
- Do not recolor the tile, rotate the mark, or add effects other than a soft mint glow on dark
  backgrounds.

## Wordmark and type

- **Wordmark:** `searchkeep`, lowercase, Funnel Display 600 with −0.04em tracking, converted to
  outlines so it never depends on a font loading. In running text the name is written
  **Searchkeep**.
- **Display type:** Funnel Display (headings, hero, OG image).
- **Text type:** Inter. **Code:** JetBrains Mono.
- Fonts are self-hosted (Fontsource). The dashboard loads no web fonts at all.

## Color

| Token        | Hex       | Use                                  |
| ------------ | --------- | ------------------------------------ |
| Mint 1       | `#a3ffb9` | Tile gradient start                  |
| Mint 2       | `#31eb91` | Tile gradient middle, primary accent |
| Mint 3       | `#00cb87` | Tile gradient end                    |
| Mint (glyph) | `#69f8a5` | The mark alone on dark backgrounds   |
| Ink          | `#04140c` | The mark on the tile; text on mint   |
| Night        | `#08090a` | Dark backgrounds                     |
| Paper        | `#fbfbfa` | Light backgrounds                    |
