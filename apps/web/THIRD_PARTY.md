# Third-party assets: apps/web

Audited 2026-10-24 (`docs/security-audit.md`, section "Licences"). The built app ships the licence texts of
everything it bundles at `/third-party-notices.txt` (`public/third-party-notices.txt`, generated from the
packages' own `LICENSE` files), because the minified bundle strips the libraries' licence comments.

## Fonts (self-hosted via npm; no external font CDN at runtime)

| Font | Package | Copyright | Licence | Use |
|---|---|---|---|---|
| Instrument Sans (variable: weight 400-700, width 75-100%) | `@fontsource-variable/instrument-sans` 5.3.0 | 2022 The Instrument Sans Project Authors | SIL Open Font License 1.1 (OFL-1.1) | All reading text |
| Archivo (variable: weight 100-900, width 62-125%) | `@fontsource-variable/archivo` 5.3.0 | 2020 The Archivo Project Authors | OFL-1.1 | Display: scores, shirt numbers, big moments, broadcast plates |
| Manrope | `@fontsource/manrope` 5.3.0 | 2019 The Manrope Project Authors | OFL-1.1 | Only the fictional sample partner graphics template in the Studio |
| Barlow Condensed | `@fontsource/barlow-condensed` 5.3.0 | 2017 The Barlow Project Authors | OFL-1.1 | Only the fictional sample partner graphics template in the Studio |

The fonts are used unmodified (Fontsource subsets of the upstream releases) and are not sold on their own, which
OFL-1.1 permits. Browsers download only the subsets a page uses (Latin in practice); Vite inlines a few of the
smallest subsets into the stylesheet as `data:` URIs, which the Content-Security-Policy allows (`font-src 'self'
data:`). The fresh-session E2E test confirms no request leaves the app's own origin (no Google Fonts).

## Original assets (made for BYLINE; no third-party marks)

- BYLINE wordmark (`src/components/brand/Wordmark.tsx`) and favicon (`public/favicon.svg`).
- Crests for the fictional clubs Northbridge Athletic (`NBA`) and Riverton City (`RVC`) (`src/components/brand/Crest.tsx`).
- Line icons (`src/components/icons/Icon.tsx`).
- Stage textures (grass, curtain, shirts, ball): generated on a canvas at runtime (`src/components/Stage/textures.ts`);
  there are no image, video, audio or 3D model files in the web app.

None of these assets copy or imitate any real club, league or broadcaster mark. All clubs, players and match data are
fictional and synthetic. The repository's only other media are screenshots of BYLINE itself (`docs/screenshots/`).

## Runtime libraries (bundled into the built app)

| Package | Version | Licence |
|---|---|---|
| react, react-dom, scheduler | 19.3.1, 19.3.1, 0.28.0 | MIT |
| three | 0.186.1 | MIT |
| zod | 4.6.7 | MIT |

## Dev and build tools (not shipped)

370 packages in the full npm tree: MIT 305, Apache-2.0 25, ISC 12, BSD-2-Clause 9, BSD-3-Clause 3, MPL-2.0 4
(axe-core and @axe-core/playwright for the accessibility audit; lightningcss for the CSS build), MIT-0 2, CC0-1.0 2,
BlueOak-1.0.0 2, CC-BY-4.0 1 (caniuse-lite browser data), Python-2.0 1 (argparse). None of these is copied into the
built app; MPL-2.0 obligations apply only to modified MPL files, and none are modified.
