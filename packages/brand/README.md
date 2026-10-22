# @thinkmade/brand

The ThinkMade logo system. Every file is generated from code, so the brand stays consistent.

## The symbol: the thinking fingerprint

Two offset ridges circle a terracotta core. The ridges suggest a fingerprint, so the mark is personal. They also suggest ideas gathering around one insight. The gaps sit on opposite sides, so the ridges also read as a path inward to understanding.

It avoids the usual AI imagery. There are no brains, circuits, robots, sparkles or gradients.

## Typeface

The wordmark uses Newsreader SemiBold, an editorial serif from Production Type, licensed under the SIL Open Font License 1.1. "Think" is Deep Charcoal and "Made" is Terracotta. All text in the SVG files is converted to outlines, so it renders the same everywhere without the font installed.

## Colors

| Name | Hex |
|---|---|
| Warm Ivory | `#F7F4EE` |
| Deep Charcoal | `#292929` |
| Terracotta | `#C56B4E` |
| Sage Green | `#829284` |
| Soft White | `#FFFFFF` |

## Files

Editable vector sources are in `assets/`:

- `symbol.svg`, `symbol-dark.svg` and `symbol-mono.svg` are the symbol alone.
- `wordmark.svg` and `wordmark-dark.svg` are the name alone.
- `logo-horizontal*.svg` and `logo-stacked*.svg` combine the two, in light, dark and mono.
- `app-icon.svg` is the rounded app icon and `app-icon-maskable.svg` is the full-bleed maskable icon.
- `social-card.svg` is the 1200 × 630 sharing image.

The build also writes these into `apps/web/public/`:

- PNG app icons at 48, 72, 96, 128, 144, 192, 256, 384 and 512 px.
- Maskable icons at 192 and 512 px, with the symbol inside the central 80% safe zone.
- The Apple touch icon at 180 px, full bleed, because iOS applies its own mask.
- `favicon.svg`, plus 16 and 32 px PNG favicons.
- `social-card.png` and `manifest-icons.json` for the PWA manifest.

## Rebuilding

Change the geometry or colors in `src/logo.ts`, then run:

```bash
npm run build:icons -w packages/brand
```

## Size testing

The symbol was reviewed at 16, 32, 48, 64, 128, 180 and 192 px on light, dark and terracotta backgrounds. Both ridges and the core stay distinct at 32 px. At 16 px the mark reads as a ringed dot, which is acceptable for a browser tab.

## Trademark

Nobody has run a trademark search or clearance on this name or mark. Do not describe the brand as legally unique until that is done.
