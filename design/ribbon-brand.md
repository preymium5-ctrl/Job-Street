# Ribbon brand

The user-supplied JobstreetCroatia ribbon logo is the reference for the website's navy, teal and white identity. The website uses a transparent JSC monogram with an HTML wordmark, keeping the lettering sharp at every size. Existing company copy and website routes are preserved.

## Palette

| Role | Color |
| --- | --- |
| Navy | `#102F4D` |
| Heading navy | `#123B5D` |
| Teal action | `#007F76` |
| Teal hover | `#006C65` |
| Mint highlight | `#00C6A7` |
| Light mint | `#DEF7F1` |
| Page background | `#F5FAF9` |

White labels use the darker teal action surfaces. Mint is used for highlights on navy and for the fee-message glow. Semantic error colors remain red.

## Logo assets

- `public/brand/jobstreet-croatia-ribbon.png`: optimized transparent website mark.
- `design/images/jobstreet-croatia-ribbon-source.png`: full-resolution transparent source.
- `app/icon.svg`, `app/icon1.png`, `app/apple-icon.png`, `app/favicon.ico`: generated favicon formats with opaque white backgrounds.
- `scripts/generate-icons.mjs`: regenerate favicon formats from the website mark.

The transparent source was prepared with the built-in ImageGen tool, then resized for web delivery with Sharp. The original user-provided artwork is the reference; the white background and lower wordmark were removed for the standalone mark.

## ImageGen prompt

> Use case: background-extraction. Asset type: website brand mark and favicon source. Edit target: the supplied JobstreetCroatia ribbon logo image. Extract ONLY the upper interwoven JSC ribbon monogram, faithfully preserving its exact distinctive silhouettes, interlocking folds, smooth navy-to-teal gradients, proportions, crisp edges, and orientation. Remove the white background completely and remove the entire lower JobstreetCroatia wordmark. Do not redesign, reinterpret, add letters, add a shadow, add a border, or change the colors. Genuinely transparent alpha background, including all internal negative spaces. Center and tightly frame the standalone wide monogram with a small even transparent safety margin. High-resolution, sharp clean production logo artwork. The original supplied logo is the identity to preserve.
